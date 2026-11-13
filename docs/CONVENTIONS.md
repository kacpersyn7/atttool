# Conventions

Every number in AttTool follows one consistent set of rules. Most bugs in attitude code come from mixing two of them. The in-app **Conventions** dialog (`src/ui/conventions.js`) shows the same content, so keep the two in sync.

## Frames

| Frame | Definition |
|---|---|
| **R** | Generic reference frame in the Rotation Lab. In *Inertial* guidance it is ECI. |
| **ECI** | X to the vernal equinox ♈, Z to the celestial north pole (J2000-like; precession ignored). |
| **ECEF** | Earth-fixed, rotates about Z by GMST. The ground track and targets live here. |
| **VVLH** | Z = −r̂ (nadir), Y = −ĥ (negative orbit normal), X = Y × Z (toward velocity; equals v̂ on a circular orbit). Default reference for nadir pointing. |
| **LVLH** | X = r̂ (radial out), Z = ĥ (orbit normal), Y = Z × X (toward velocity). |
| **VNC** | X = v̂ (velocity), Y = ĥ (orbit normal), Z = X × Y. |
| **B = SCF** | Spacecraft frame = body frame for attitude. The satellite is built in it like a CAD model: the bus and every component are parts with a position (m) and orientation in SCF. Put the origin where you like (e.g. the launcher-interface face). |
| **G** | Bus box frame: its centre and edges. Placed in SCF by `sc.bus.pos` and `sc.bus.q` (`q2C(q) = C_G←SCF`). |
| **C** | A component's own frame. +Z_C is its boresight, spin axis, dipole axis or panel normal. |

Orbital frames (VVLH, LVLH, VNC) follow the [STK definitions](https://help.agi.com/stk/Content/gator/eq-coordsys.htm), with ĥ = (r × v)/|r × v|. Before v0.3 the tool called VVLH "LVLH"; old saves are migrated automatically.

## Nominal attitude (SCF vs orbital frame)

`sc.align` says how SCF flies relative to a reference frame R ∈ {VVLH, LVLH, VNC}: either an axis table ("R +X along SCF −Z, R +Y along SCF +X", R +Z completes the set) or a DCM. Stored as

```
C_SR = C_SCF←R          v_SCF = C_SR · v_R        columns = R axes written in SCF
C_BI = E(ψ, θ, φ) · C_SR · C_RI                    nominal attitude + 3-2-1 offsets (Orbit tab)
```

The default (VVLH, identity) is the pre-0.4 behaviour: SCF +Z nadir, +X along-track.

## Direction cosine matrices

`C_BR` transforms coordinates **from R to B**:

```
v_B = C_BR · v_R          rows of C_BR = B axes written in R
C_RB = C_BRᵀ              chains read right to left:  C_CI = C_CB · C_BI
```

In code, matrices are arrays of rows: `C[row][col]`. DCM fields accept MATLAB (`[a b c; d e f; g h i]`), NumPy or plain rows; each lets you choose which direction the pasted matrix maps.

## Euler angles

Sequence *i-j-k* (for example 3-2-1) means **intrinsic** rotations: θ₁ about axis *i* of R, then θ₂ about the *new* axis *j*, then θ₃ about the *newest* axis *k*.

```
C_BR = R_k(θ₃) · R_j(θ₂) · R_i(θ₁)        frame (passive) rotations, e.g.
R₃(ψ) = [[ c, s, 0],
         [-s, c, 0],
         [ 0, 0, 1]]
```

3-2-1 = yaw ψ, pitch θ, roll φ. Singular when θ₂ = ±90° (asymmetric sequences) or 0°/180° (symmetric ones). At the singularity `C2euler` returns θ₁ = 0.

`core/attitude.js`: `Rp(n, a)` is the passive rotation, `Ra(n, a) = Rp(n, a)ᵀ` is the active one.

## Quaternions

```
q = [q₀; q₁ q₂ q₃] = [cos(φ/2); ê sin(φ/2)]           stored as {w, x, y, z}
C_BR = A(q) = (q₀² − |q_v|²) I + 2 q_v q_vᵀ − 2 q₀ [q_v×]
```

This is the Shuster/JPL reading (Markley & Crassidis). The *same four numbers* are the Hamilton quaternion of the active rotation R→B (R(q) = C_RB, which is what three.js uses), so components can be copied straight into `THREE.Quaternion`. What differs between the conventions is the composition order:

- Hamilton: `q_CA = q_BA ∘ q_CB`
- Shuster: `q_CA = q_CB ⊗ q_BA`

q and −q are the same attitude. `q.canon` makes the scalar part ≥ 0. The HUD shows `C2q` as computed (largest component positive), so its sign can jump; the signal plots and their CSV keep the sign continuous along the series, starting with q₀ ≥ 0 (`sim/signals.js`).

Plotted Euler angles are the 3-2-1 sequence of the relative attitude, listed as φ roll, θ pitch, ψ yaw, wrapped to (−180°, 180°]. Body rate is ω of B relative to ECI in body axes (finite difference over 0.5 s).

Component orientation `c.q` is q_BC: `q2C(c.q) = C_CB`.

## Mode schedule

- **What it is:** a list of changes of guidance mode (`orbit.schedule`), each `{ id, start, slew, mode, …settings }`, an optional `name` (up to 40 characters) and an optional `autoSlew` (the slew time is worked out from the turn, see below). The scenario's own settings fly before the first change. Each change keeps its own mode settings, pointing payload (`tgtComp`) and ground target, and an inertial change keeps its own attitude `q`; only the shown frame stays scenario-wide. Everything about the payload (pointing error, payload view, the timeline's on-ground row) follows the payload of what flies at that moment.
- **Times are UTC** (the epoch format, 1900 to 2200), so a change stays at the same moment when the epoch moves. The change in force is the one with the latest start ≤ now; for equal starts the later in the list wins.
- **Event starts:** a change can start on an event (`on`): eclipse entry or exit (the cylindrical shadow), its own target rising above or setting below an elevation, or a time after another change (by id). It starts at the first such event at or after its search time (`on.from`), plus a signed offset; the result is written to `start`, so everything else reads it as usual. Eclipses are looked for up to 2 days ahead and rises/sets up to 3 days; short eclipses and grazing passes between samples are found by refining peaks, for every kind (a search that starts inside an eclipse or a pass first refines the end of it the same way). Not found, or a missing or circular reference: it starts at its search time, marked ⚠. Editing the start of an event change moves its search time (dragging, typing) or its offset (±1 min, and for 'after'). The events depend on the orbit and the change's own target (never on the attitude), so starts are worked out again whenever either changes. A duplicate looks for its own event from where it is put.
- **CSV** (`sim/scheduleCsv.js`): one row per change, with a header naming the columns (`utc` required; `mode` as nominal, target, sun or inertial; `name`; `slew_s` or auto; the mode settings; `q_w…q_z`; an event start; `id`). Parts are written and read by name. Comma, semicolon or tab separated, with decimal commas when not comma-separated. Rows go through the same checks as a scenario JSON; empty cells take the scenario's own values (an empty `mode` the scenario's mode, an empty `slew_s` 60 s, `pointing_part` `default` the first payload camera), and an event without `event_from_utc` looks from the change's start. Numbers are written exactly. Cells a spreadsheet would read as a formula (`+X`, a name starting with `=`) get a leading `'`, and the file starts with a byte-order mark, both for Excel; both are ignored on reading.
- **Slews:** over `slew` seconds (0 to 3600) after its start, a change blends from the attitude before it to its own by slerp, linear in time, with **both attitudes evaluated at t**. A 90° slew over 60 s with two fixed attitudes turns at a constant 1.5°/s. It ends exactly on the new attitude, and which way it turns is fixed at its start (a half turn doesn't change side). A change inside the previous slew blends from that slew, so with a slew time above 0 the attitude doesn't jump; the rate does, at the ends. A slew time of 0 jumps, and so does target tracking with `tgtSlew` 0 when the target rises or sets.
- **Target rise and set:** in target tracking, below the horizon the spacecraft holds the nominal attitude. It slews to the target over `tgtSlew` seconds (default 60, at most 900, a per-change setting) *before* the target rises, so tracking starts at the rise, and back to the nominal attitude over the same time after the set; 0 jumps. Same blend as a schedule slew, with the direction fixed at the rise or set. Only rises and sets while those settings fly count (a change looks no further back than its start, nor past the next change), and a pass shorter than the search step is still found.
- **The scenario as a whole:** it starts at the epoch (or at the first change if that is earlier) and ends at `orbit.end` (UTC), or, if that is empty or not after the start, automatically when the last change that flies has finished its slew plus 5 min, where the attitude stops moving (one orbit without a schedule). *▶ Scenario* plays that span and pauses at the end, or loops.
- **Slew rate:** the spacecraft has a maximum slew rate (`sc.maxRate`, deg/s, default 1). A change with an *automatic* slew time (`autoSlew`) slews for its turn at its start ÷ that rate, rounded up to whole seconds and at most 3600 s (the turn from what flew before, both ends at the start, as the turn readout; the minimum rate, 0.05°/s, keeps every turn within that). The slew times are worked out again by the 3D view whenever the schedule, the orbit or the spacecraft changes. A change with a fixed slew time that would need a higher mean rate is marked. It is a cap on the mean rate of the blend, not a dynamics model: no wheel torque, momentum or acceleration limits, and the target rise/set slews (`tgtSlew`) are not checked against it.
- **Kinematics only:** no wheels, torque or rate limits beyond that cap, so a fixed slew can ask for more than real hardware gives.

## Payload pointing error and the payload view

- **Reference:** the payload and ground target in force (`orbit.tgtComp`, `tgtLat`, `tgtLon` geocentric, or those of the schedule change flying; `tgtAlt` in m above the sphere, −500 to 9000) in every guidance mode, while the spacecraft is above the target's local horizontal (elevation > 0; for a high peak the line of sight clears the Earth slightly earlier than that). In *Ground target tracking* it is zero by construction.
- **Sign:** errors are *boresight minus target*.
- **Axes:** *along* = ground-relative velocity `v − ω_E × r` (the direction the ground track moves), *cross* = along × up, i.e. **right of the track** looking forward (−orbit normal for a nadir-looking spacecraft).
  - Angular error: in the frame z = boresight, x = along ⊥ z, y = z × x. `along = −atan2(los·x, los·z)`, `cross = −atan2(los·y, los·z)`; total = angle(boresight, line of sight). *along* and *cross* are separate tangent-plane angles: they add up (√(along² + cross²) = total) only for small errors, and lose their meaning beyond 90°.
  - Ground error: from the target to the boresight's hit on the sphere at the target's height (radius R_E + h), so a boresight on the target has zero error. Total = great-circle distance at that radius; *along* / *cross* split it by the initial azimuth at the target (in the target's local horizontal plane), so √(along² + cross²) = total exactly.
- **Payload view image:** gnomonic projection in the payload component frame C, looking along +Z_C: point → (x/z, y/z), +X_C drawn right, +Y_C down. Points beyond the spacecraft's horizon are culled. The ground track is the sub-satellite path ± a few minutes, drawn at the current Earth orientation. Scale bar = slant range × tan (no obliquity correction).
- **Relief displacement:** a target at height h is seen along a line that meets the sphere away from the point under it (the *foot*), by ≈ h·tan(i), where i = 90° − elevation is the incidence at the target (a little larger than the nadir angle at the spacecraft: 30° off nadir from 550 km gives i ≈ 33°, so 2 km of height moves the point by about 1.3 km). `pointing().relief` is the exact spherical value, with the sign of h. The payload view draws the foot as a hollow marker: the map and grid stay at height 0, so a target above the sphere leans away from the nadir relative to them (one below it, toward the nadir). The view, the 3D footprint and the "on ground" check use the boresight's hit at height 0: when tracking a peak below about √(2h/R_E) elevation (3° at 9 km) the line of sight passes over the sphere, so they report no hit and no relief, while the error against the target stays valid.
- **Map (payload view and Earth texture):** Natural Earth 1:50m land, lakes, rivers, country and province borders, and cities ≥ 50 000 people from 1:10m (public domain, v5.1.2), regenerated with `scripts/build-map.mjs`. Coordinates are quantized to 1/200° (~0.5 km) and the lines are good to a few km against Natural Earth's own coordinates. Those latitudes are geodetic but are placed on the spherical Earth as geocentric, like the target, so against the real Earth under a real orbit features shift by up to ~0.19° (~20 km at 45° latitude). The map is **schematic**: consistent with the target and the ground track, for orientation, not for measuring pointing errors. In the payload view each polygon is clipped in 3-D to the view pyramid and the spacecraft's horizon; where a polygon continues beyond the horizon its edge follows the limb, and a ring that contains the point opposite the sub-satellite point gets one extra Earth disc to keep the even-odd fill right (`sim/payloadMap.js`).

## Units

| Quantity | Unit |
|---|---|
| Distance (orbit, environment) | km |
| Distance (spacecraft layout) | m |
| Time | s from the epoch (`o.t`, negative before it); epoch and current time are UTC `YYYY-MM-DDTHH:MM` |
| Angles in code | rad. UI and state store degrees (`S.orbit.i`, `S.rot.euler`, …) |
| Magnetic field | nT |
| Inertia | kg·m² |
| 3D scene, Orbit workspace | 1 unit = 1000 km |

## Environment models (deliberately simple)

- **Orbit:** Keplerian two-body with optional first-order J2 secular drift of Ω, ω and the mean anomaly M (Vallado eq. 9-41). The M term moves along-track timing by up to ~30 km per orbit in LEO compared with leaving it out: −28 km (−3.7 s) at SSO 550 km, +5 km for the ISS. No drag, no SRP. The orbit is defined by elements, by a **J2000/GCRF state vector** at the epoch (converted exactly to osculating elements; with J2 these feed a mean-element secular model, so the short-period J2 part of the osculating semi-major axis, up to ~10 km in LEO, becomes a mean-motion error of tens of km per orbit along track), or by a **TLE**.
- **Epoch and current time:** the epoch belongs to the orbit definition: the date its elements or state hold at. The current time is separate, kept as seconds from the epoch, and may be before it. Moving the current time keeps the orbit. Moving the epoch keeps the current UTC and re-dates the orbit: the same RAAN or r, v on another date, so a different LTAN and ground track (an LTAN preset or a repeat track recomputes RAAN instead, and a repeat track its phase). Far from the epoch the Sun geometry and the drift of the plane hold, but not the position along the orbit, since there is no drag. The epoch and the current time can be set from 1900 to 2200.
- **Repeat ground track (SSRGT):** R orbits in D days, an LTAN and the longitude where reference orbit no. 1 crosses the equator northbound. Altitude and inclination (circular) are solved so the orbit is sun-synchronous (Ω̇ = the mean Sun's 0.9856°/day) and the argument of latitude turns R times while the Earth turns D times relative to the node, with the J2 secular rates of Ω, ω and M. The altitude shown is a − Rₑ: Sentinel-2's 143/10 gives 786.1 km and Sentinel-1's 175/12 692.8 km, as they quote; Landsat 8 (233/16, 699.6 km) and Sentinel-3 (385/27, 799.8 km) quote altitude against another reference (705 and 814.5 km). RAAN comes from the LTAN at the epoch, and the phase puts orbit no. 1 on the node at the reference longitude within the first day. The track closes in the model to well under a metre. With no drag it holds forever; a real one decays and needs regular manoeuvres to stay on its track. Switching to a repeat track keeps the LTAN and solves the rest; moving the epoch keeps the LTAN and the reference track and solves RAAN and the phase again.
- **TLE:** the mean elements are flown with the same Keplerian + J2 model, **not SGP4** (no drag, with J2 on only the first-order Kozai→Brouwer recovery of the semi-major axis (no SGP4 drag or periodic terms), TEME treated as ECI). Good near the TLE epoch, drifting by kilometres per day. Its mean motion is taken as the mean anomaly's rate: with J2 on, the semi-major axis is the one at which n + Ṁ_J2 equals it, so the TLE flies at the rate it states.
- **ECI** ignores precession and nutation, so it is J2000 ≈ GCRF to well under a degree over decades (precession is about 1.4° per century, so more than that near the ends of the 1900 to 2200 range).
- **Sun:** low-precision almanac formula (~0.01°). **Eclipse:** cylindrical shadow (no penumbra).
- **Moon:** low-precision Astronomical Almanac series (Vallado Alg. 31; ~0.3°, ~0.5 % in distance). The direction used everywhere is seen from the spacecraft (`A.moon`, includes the ~1° parallax in LEO). Phase and brightness are ignored.
- **Magnetic field:** tilted dipole, pole at 80.8°N 72.7°W, B₀ = 29 900 nT. Real IGRF differs by up to ~20 %.
- **Earth:** sphere, R = 6378.137 km. GMST from the IAU-82 polynomial; UT1 ≈ UTC.
- **Star tracker availability:** blinded if the Sun is inside the Sun-exclusion angle (outside eclipse), the Earth limb is closer than the Earth-exclusion angle, or the Moon is inside the Moon-exclusion angle and not hidden behind the Earth (any phase). Timeline priority: Sun, then Earth, then Moon.
