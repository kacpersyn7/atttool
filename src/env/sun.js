/** Sun direction, eclipse and beta angle. */
import { D2R, v } from '../core/linalg.js';
import { RE } from './constants.js';
import { jd } from './time.js';

/** Unit vector to the Sun in ECI (low-precision Astronomical Almanac formula, ~0.01°). */
export function sunECI(date) {
  const n = jd(date) - 2451545.0;
  const L = (280.460 + 0.9856474 * n) * D2R, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}

/** Right ascension of the Sun (rad). */
export function sunRA(date) { const s = sunECI(date); return Math.atan2(s[1], s[0]); }

/** Cylindrical Earth shadow (no penumbra). r: position km (ECI), sun: unit Sun vector. */
export function eclipse(r, sun) {
  const d = v.dot(r, sun);
  if (d > 0) return false;
  const perp = v.sub(r, v.scale(sun, d));
  return v.norm(perp) < RE;
}

/** Beta angle (rad): elevation of the Sun above the orbit plane. */
export function betaAngle(r, vel, sun) { const h = v.unit(v.cross(r, vel)); return Math.asin(v.dot(h, sun)); }
