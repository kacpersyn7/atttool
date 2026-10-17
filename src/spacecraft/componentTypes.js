/**
 * Catalogue of component types. Each entry provides display defaults and nominal parameters
 * copied onto new components by `mkComp`.
 *   fov       full field of view (deg)          — sensors / antennas (drawn as a cone if `cone`)
 *   sunExcl   Sun exclusion half-angle (deg)    — star tracker
 *   earthExcl Earth-limb exclusion (deg)        — star tracker
 *   dipole    max magnetic dipole (A·m²)        — magnetorquer
 *   hmax      max wheel momentum (N·m·s)        — reaction wheel
 *   w, h      panel size (m)                    — solar array
 *
 * To add a new type: add an entry here, a mesh in gfx/spacecraftMesh.js (`compMesh`),
 * and — if it senses something — a rule in sim/sensors.js.
 */
export const TYPES = {
  payload: { label: 'Payload camera', color: '#e8ecf2', fov: 2.5, mass: 15, cone: true },
  str: { label: 'Star tracker', color: '#9db8e0', fov: 20, sunExcl: 30, earthExcl: 20, mass: 0.4, cone: true },
  css: { label: 'Sun sensor', color: '#f0c64a', fov: 120, mass: 0.05, cone: true },
  mtq: { label: 'Magnetorquer', color: '#cf7e43', dipole: 15, mass: 0.6, len: 0.36 },
  rw: { label: 'Reaction wheel', color: '#8a9ab3', hmax: 0.4, mass: 1.1 },
  mag: { label: 'Magnetometer', color: '#57c7b8', mass: 0.12 },
  gyro: { label: 'Gyro / IMU', color: '#a58cf0', mass: 0.7 },
  gnss: { label: 'GNSS antenna', color: '#dfe3ea', fov: 160, mass: 0.15, cone: true },
  ant: { label: 'X-band antenna', color: '#c9ced8', fov: 60, mass: 0.4, cone: true },
  thr: { label: 'Thruster', color: '#b8bcc6', mass: 0.25 },
  sa: { label: 'Solar array', color: '#2b4f97', mass: 2.5, w: 1.0, h: 0.7 },
};

/** Parameter keys copied from the type onto a new component. */
export const PARAM_KEYS = ['fov', 'sunExcl', 'earthExcl', 'dipole', 'hmax', 'w', 'h', 'len'];

/** Human name of a component's +Z axis. */
export function axisName(type) {
  return type === 'mtq' ? 'dipole axis' : type === 'rw' ? 'spin axis' : type === 'sa' ? 'panel normal' : type === 'thr' ? 'nozzle axis' : 'boresight';
}
