/**
 * Two-body Keplerian orbit with optional J2 secular drift of RAAN and argument of perigee.
 * Elements object: { a (km), e, i, raan, argp, nu0 (rad) }.
 */
import { v, m } from '../core/linalg.js';
import { Ra } from '../core/attitude.js';
import { MU, RE, J2 } from './constants.js';

/** Solve Kepler's equation M = E - e sin E (Newton). */
export function kepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
  return E;
}

/**
 * Propagate elements to t seconds after epoch.
 * @returns {{r:number[], v:number[], nu:number, raan:number, argp:number, period:number}} ECI km, km/s
 */
export function propagate(el, t, j2) {
  const { a, e } = el;
  const n = Math.sqrt(MU / (a * a * a));
  const p = a * (1 - e * e);
  let raan = el.raan, argp = el.argp;
  if (j2) {
    const k = 1.5 * n * J2 * (RE / p) ** 2;
    raan += -k * Math.cos(el.i) * t;
    argp += k * (2 - 2.5 * Math.sin(el.i) ** 2) * t;
  }
  const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(el.nu0 / 2));
  const M0 = E0 - e * Math.sin(E0);
  const M = M0 + n * t;
  const E = kepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = p / (1 + e * Math.cos(nu));
  const rp = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const vp = [-Math.sqrt(MU / p) * Math.sin(nu), Math.sqrt(MU / p) * (e + Math.cos(nu)), 0];
  const R = m.mul(Ra(3, raan), m.mul(Ra(1, el.i), Ra(3, argp)));
  return { r: m.mulv(R, rp), v: m.mulv(R, vp), nu, raan, argp, period: 2 * Math.PI / n };
}

/** Orbital period (s) for semi-major axis a (km). */
export function period(a) { return 2 * Math.PI * Math.sqrt(a * a * a / MU); }

/** LVLH frame: returns C_LI (rows = LVLH axes in ECI). z = nadir, y = -orbit normal, x completes. */
export function lvlh(r, vel) {
  const z = v.unit(v.scale(r, -1));
  const y = v.unit(v.scale(v.cross(r, vel), -1));
  const x = v.cross(y, z);
  return m.fromRows(x, y, z);
}

/** Inclination (rad) that makes the J2 RAAN drift match the mean Sun (sun-synchronous orbit). */
export function ssoInc(a, e = 0) {
  const n = Math.sqrt(MU / a ** 3), p = a * (1 - e * e), rate = 2 * Math.PI / (365.2422 * 86400);
  const c = -rate / (1.5 * n * J2 * (RE / p) ** 2); return Math.acos(Math.max(-1, Math.min(1, c)));
}
