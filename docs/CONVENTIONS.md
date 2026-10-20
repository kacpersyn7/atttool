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
| **B = SCF** | Spacecraft frame, the body frame for attitude. All component positions and orientations are given in it. Origin: any point (default: bus centre; e.g. the launcher-interface face centre). Axes: bus axes, possibly permuted or flipped (`sc.frame.xAxis`, `zAxis`; Y = Z × X). |
| **G** | Bus geometry frame: origin at the bus centre, axes along the box edges. Only the bus box is defined in G. `v_S = C_SG · v_G`, `p_S = C_SG · (p_G − origin)`. Example EO bus: +Z payload face (nadir in nominal flight), +X flight direction. |
| **C** | A component's own frame. +Z_C is its boresight, spin axis, dipole axis or panel normal. |

Orbital frames (VVLH, LVLH, VNC) follow the [STK definitions](https://help.agi.com/stk/Content/gator/eq-coordsys.htm), with ĥ = (r × v)/|r × v|. Before v0.3 the tool called VVLH "LVLH"; old saves are migrated automatically.

## Direction cosine matrices

`C_BR` transforms coordinates **from R to B**:

```
v_B = C_BR · v_R          rows of C_BR = B axes written in R
C_RB = C_BRᵀ              chains read right to left:  C_CI = C_CB · C_BI
```

In code, matrices are arrays of rows: `C[row][col]`.

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

- **Orbit:** Keplerian two-body with optional J2 secular drift of Ω and ω. No drag, no SRP.
- **Sun:** low-precision almanac formula (~0.01°). **Eclipse:** cylindrical shadow (no penumbra).
- **Magnetic field:** tilted dipole, pole at 80.8°N 72.7°W, B₀ = 29 900 nT. Real IGRF differs by up to ~20 %.
- **Earth:** sphere, R = 6378.137 km. GMST from the IAU-82 polynomial; UT1 ≈ UTC.
- **Star tracker availability:** blinded if the Sun is inside the Sun-exclusion angle (outside eclipse) or the Earth limb is closer than the Earth-exclusion angle. The Moon is ignored.
