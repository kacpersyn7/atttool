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

## Payload pointing error and the payload view

- **Reference:** the ground target (`orbit.tgtLat`, `tgtLon` geocentric; `tgtAlt` in m above the sphere, −500 to 9000) in every guidance mode, while the spacecraft is above the target's local horizontal (elevation > 0; for a high peak the line of sight clears the Earth slightly earlier than that). In *Ground target tracking* it is zero by construction.
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

- **Orbit:** Keplerian two-body with optional J2 secular drift of Ω and ω. No drag, no SRP. The orbit is defined by elements, by a **J2000/GCRF state vector** at the epoch (converted exactly to osculating elements; with J2 these feed a mean-element secular model, so long runs drift slightly), or by a **TLE**.
- **Epoch and current time:** the epoch belongs to the orbit definition: the date its elements or state hold at. The current time is separate, kept as seconds from the epoch, and may be before it. Moving the current time keeps the orbit. Moving the epoch keeps the current UTC and re-dates the orbit: the same RAAN or r, v on another date, so a different LTAN and ground track (an LTAN preset recomputes RAAN instead). Far from the epoch the Sun geometry and the drift of the plane hold, but not the position along the orbit, since there is no drag.
- **TLE:** the mean elements are flown with the same Keplerian + J2 model, **not SGP4** (no drag, no Kozai/Brouwer correction, TEME treated as ECI). Good near the TLE epoch, drifting by kilometres per day.
- **ECI** ignores precession and nutation, so it is J2000 ≈ GCRF to well under a degree over decades.
- **Sun:** low-precision almanac formula (~0.01°). **Eclipse:** cylindrical shadow (no penumbra).
- **Moon:** low-precision Astronomical Almanac series (Vallado Alg. 31; ~0.3°, ~0.5 % in distance). The direction used everywhere is seen from the spacecraft (`A.moon`, includes the ~1° parallax in LEO). Phase and brightness are ignored.
- **Magnetic field:** tilted dipole, pole at 80.8°N 72.7°W, B₀ = 29 900 nT. Real IGRF differs by up to ~20 %.
- **Earth:** sphere, R = 6378.137 km. GMST from the IAU-82 polynomial; UT1 ≈ UTC.
- **Star tracker availability:** blinded if the Sun is inside the Sun-exclusion angle (outside eclipse), the Earth limb is closer than the Earth-exclusion angle, or the Moon is inside the Moon-exclusion angle and not hidden behind the Earth (any phase). Timeline priority: Sun, then Earth, then Moon.
