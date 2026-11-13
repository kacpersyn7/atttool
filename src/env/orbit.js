/**
 * Two-body Keplerian orbit with optional first-order J2 secular drift of RAAN, argument of perigee and mean anomaly.
 * Elements object: { a (km), e, i, raan, argp, nu0 (rad) }.
 */
import { v, m } from '../core/linalg.js';
import { Ra } from '../core/attitude.js';
import { MU, RE, J2, WE } from './constants.js';

/** Solve Kepler's equation M = E - e sin E (Newton). */
export function kepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
  return E;
}

/**
 * First-order J2 secular rates (rad/s) of mean elements a (km), e, i (rad): node, argument of perigee, and the
 * mean anomaly beyond the two-body n (Vallado, Fundamentals of Astrodynamics, eq. 9-41).
 */
export function j2Rates(a, e, i) {
  const n = Math.sqrt(MU / (a * a * a)), p = a * (1 - e * e), k = 1.5 * n * J2 * (RE / p) ** 2, s2 = Math.sin(i) ** 2;
  return { n, raan: -k * Math.cos(i), argp: k * (2 - 2.5 * s2), M: k * Math.sqrt(1 - e * e) * (1 - 1.5 * s2) };
}

/** Semi-major axis (km) whose mean-anomaly rate with J2 (n + Ṁ_J2) is nTot (rad/s): how a TLE's mean motion is flown. */
export function smaForMeanMotion(nTot, e, i) {
  let a = Math.cbrt(MU / (nTot * nTot));
  for (let k = 0; k < 8; k++) { const r = j2Rates(a, e, i); a = Math.cbrt(MU / (nTot - r.M) ** 2); } // converges by a factor ~3e-4 per step
  return a;
}

/**
 * Propagate elements to t seconds after epoch. With j2, the node, the argument of perigee and the mean anomaly
 * drift at their first-order J2 secular rates (j2Rates).
 * @returns {{r:number[], v:number[], nu:number, raan:number, argp:number, period:number}} ECI km, km/s; period is the
 *   two-body one.
 */
export function propagate(el, t, j2) {
  const { a, e } = el;
  const n = Math.sqrt(MU / (a * a * a));
  const p = a * (1 - e * e);
  let raan = el.raan, argp = el.argp, Mdot = n;
  if (j2) { const r = j2Rates(a, e, el.i); raan += r.raan * t; argp += r.argp * t; Mdot += r.M; }
  const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(el.nu0 / 2));
  const M0 = E0 - e * Math.sin(E0);
  const M = M0 + Mdot * t;
  const E = kepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = p / (1 + e * Math.cos(nu));
  const rp = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const vp = [-Math.sqrt(MU / p) * Math.sin(nu), Math.sqrt(MU / p) * (e + Math.cos(nu)), 0];
  const R = m.mul(Ra(3, raan), m.mul(Ra(1, el.i), Ra(3, argp)));
  return { r: m.mulv(R, rp), v: m.mulv(R, vp), nu, raan, argp, period: 2 * Math.PI / n };
}

/**
 * Classical elements from an inertial state vector (r km, v km/s) — the inverse of
 * propagate(el, 0). Singular cases are resolved so the round trip is exact:
 *   circular (e ≈ 0)            → argp = 0, nu0 = argument of latitude
 *   equatorial (i ≈ 0 or 180°)  → raan = 0, argp = longitude of perigee
 *   circular + equatorial       → raan = argp = 0, nu0 = true longitude
 * @returns {{a, e, i, raan, argp, nu0, flags: string[]} | {error: string}} angles in rad
 */
export function rv2coe(r, vel) {
  const rn = v.norm(r), vn = v.norm(vel);
  if (!(rn > 1e-6) || !Number.isFinite(vn)) return { error: 'position must be non-zero' };
  const hv = v.cross(r, vel), hn = v.norm(hv);
  if (hn < 1e-9) return { error: 'position and velocity are parallel (radial trajectory)' };
  const energy = vn * vn / 2 - MU / rn;
  if (energy >= 0) return { error: 'not a closed orbit: speed ≥ escape speed (' + Math.sqrt(2 * MU / rn).toFixed(3) + ' km/s here)' };
  const a = -MU / (2 * energy);
  const ev = v.scale(v.sub(v.scale(r, vn * vn - MU / rn), v.scale(vel, v.dot(r, vel))), 1 / MU);
  const e = v.norm(ev);
  const i = Math.acos(Math.max(-1, Math.min(1, hv[2] / hn)));
  const nv = [-hv[1], hv[0], 0], nn = v.norm(nv); // node vector
  const EPS = 1e-10, flags = [];
  const ang = (x, y) => Math.acos(Math.max(-1, Math.min(1, v.dot(x, y) / (v.norm(x) * v.norm(y)))));
  const wrap = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const equatorial = nn / hn < EPS, circular = e < EPS;
  let raan = 0, argp = 0, nu0;
  if (!equatorial) { raan = Math.atan2(nv[1], nv[0]); } else flags.push('equatorial');
  if (circular) flags.push('circular');
  // reference direction in the orbit plane from which ω and ν are measured
  const hHat = v.scale(hv, 1 / hn);
  const nodeDir = equatorial ? [1, 0, 0] : v.scale(nv, 1 / nn);
  // in-plane angle from u to w, signed by the orbit normal
  const inPlane = (u, w) => { const t = ang(u, w); return v.dot(v.cross(u, w), hHat) < 0 ? 2 * Math.PI - t : t; };
  if (!circular) { argp = inPlane(nodeDir, ev); nu0 = inPlane(ev, r); }
  else nu0 = inPlane(nodeDir, r);
  if (equatorial && i > Math.PI / 2) { /* retrograde equatorial: node direction stays +X */ }
  return { a, e: circular ? 0 : e, i, raan: wrap(raan), argp: wrap(argp), nu0: wrap(nu0), flags };
}

/** Orbital period (s) for semi-major axis a (km). */
export function period(a) { return 2 * Math.PI * Math.sqrt(a * a * a / MU); }

/*
 * Orbital reference frames, named and defined as in STK
 * (https://help.agi.com/stk/Content/gator/eq-coordsys.htm). Each returns C_FI:
 * rows = the frame's axes expressed in ECI, so v_F = C_FI · v_ECI.
 */

/** VVLH (vehicle velocity, local horizontal): Z = −r̂ (nadir), Y = −ĥ, X = Y × Z (toward velocity). */
export function vvlh(r, vel) {
  const z = v.unit(v.scale(r, -1));
  const y = v.unit(v.scale(v.cross(r, vel), -1));
  const x = v.cross(y, z);
  return m.fromRows(x, y, z);
}

/** LVLH (local vertical, local horizontal): X = r̂ (radial out), Z = ĥ (orbit normal), Y = Z × X (toward velocity). */
export function lvlh(r, vel) {
  const x = v.unit(r);
  const z = v.unit(v.cross(r, vel));
  const y = v.cross(z, x);
  return m.fromRows(x, y, z);
}

/** VNC (velocity, normal, co-normal): X = v̂, Y = ĥ, Z = X × Y. */
export function vnc(r, vel) {
  const x = v.unit(vel);
  const y = v.unit(v.cross(r, vel));
  const z = v.cross(x, y);
  return m.fromRows(x, y, z);
}

/** Selectable orbital frames: id -> { label, axes (short axis labels), fn }. */
export const ORBIT_FRAMES = {
  vvlh: { label: 'VVLH (Z nadir)', axes: ['X_V', 'Y_V', 'Z_V ⊕'], fn: vvlh },
  lvlh: { label: 'LVLH (X radial, Z orbit normal)', axes: ['X_L r̂', 'Y_L', 'Z_L ĥ'], fn: lvlh },
  vnc: { label: 'VNC (X velocity)', axes: ['V', 'N', 'C'], fn: vnc },
};

/** C_FI for frame id `name` ('vvlh' | 'lvlh' | 'vnc'); unknown ids fall back to VVLH. */
export function orbitFrame(name, r, vel) { return (ORBIT_FRAMES[name] || ORBIT_FRAMES.vvlh).fn(r, vel); }

/** Rate (rad/s) of the mean Sun in right ascension: what a sun-synchronous node follows. */
export const SUN_RATE = 2 * Math.PI / (365.2422 * 86400);

/**
 * Sun-synchronous repeat ground track: the circular orbit that makes R revolutions (node to node) while the Earth
 * turns D times under its orbit plane, with the first-order J2 secular rates of propagate (Ω, ω and M). Both
 * conditions depend on a and i, so a is found by bisection with i = ssoInc(a) at each step.
 * `earthRate`: the Earth's rotation rate (rad/s) the ground track is drawn with (the GMST model's, for an exact repeat there).
 * @returns { a (km), i (rad), raanRate, uRate (rad/s, argument of latitude), period (s, node to node) }, or null if no
 *   orbit between 150 and 3000 km altitude repeats so.
 */
export function solveRepeatSSO(R, D, earthRate = WE) {
  if (!(R > 0 && D > 0)) return null;
  const want = (R / D) * (earthRate - SUN_RATE); // the argument of latitude must turn R times while the Earth turns D times relative to the node
  const g = a => { const i = ssoInc(a), r = j2Rates(a, 0, i); return { gap: r.n + r.M + r.argp - want, i, r }; };
  let lo = RE + 150, hi = RE + 3000;
  if (g(lo).gap < 0 || g(hi).gap > 0) return null; // the rate falls with altitude: no root in range
  for (let k = 0; k < 100 && hi - lo > 1e-9; k++) { const m = (lo + hi) / 2; if (g(m).gap > 0) lo = m; else hi = m; }
  const a = (lo + hi) / 2, { i, r } = g(a), uRate = r.n + r.M + r.argp;
  return { a, i, raanRate: r.raan, uRate, period: 2 * Math.PI / uRate };
}

/** Inclination (rad) that makes the J2 RAAN drift match the mean Sun (sun-synchronous orbit). */
export function ssoInc(a, e = 0) {
  const n = Math.sqrt(MU / a ** 3), p = a * (1 - e * e);
  const c = -SUN_RATE / (1.5 * n * J2 * (RE / p) ** 2); return Math.acos(Math.max(-1, Math.min(1, c)));
}
