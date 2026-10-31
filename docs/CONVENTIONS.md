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

q and −q are the same attitude. `q.canon` makes the scalar part ≥ 0.

Component orientation `c.q` is q_BC: `q2C(c.q) = C_CB`.

## Units

| Quantity | Unit |
|---|---|
| Distance (orbit, environment) | km |
| Distance (spacecraft layout) | m |
| Time | s since epoch; epoch is UTC `YYYY-MM-DDTHH:MM` |
| Angles in code | rad. UI and state store degrees (`S.orbit.i`, `S.rot.euler`, …) |
| Magnetic field | nT |
| Inertia | kg·m² |
| 3D scene, Orbit workspace | 1 unit = 1000 km |

## Environment models (deliberately simple)

- **Orbit:** Keplerian two-body with optional J2 secular drift of Ω and ω. No drag, no SRP. The orbit is defined by elements, by a **J2000/GCRF state vector** at the epoch (converted exactly to osculating elements; with J2 these feed a mean-element secular model, so long runs drift slightly), or by a **TLE**.
- **TLE:** the mean elements are flown with the same Keplerian + J2 model, **not SGP4** (no drag, no Kozai/Brouwer correction, TEME treated as ECI). Good near the TLE epoch, drifting by kilometres per day.
- **ECI** ignores precession and nutation, so it is J2000 ≈ GCRF to well under a degree over decades.
- **Sun:** low-precision almanac formula (~0.01°). **Eclipse:** cylindrical shadow (no penumbra).
- **Magnetic field:** tilted dipole, pole at 80.8°N 72.7°W, B₀ = 29 900 nT. Real IGRF differs by up to ~20 %.
- **Earth:** sphere, R = 6378.137 km. GMST from the IAU-82 polynomial; UT1 ≈ UTC.
- **Star tracker availability:** blinded if the Sun is inside the Sun-exclusion angle (outside eclipse) or the Earth limb is closer than the Earth-exclusion angle. The Moon is ignored.
