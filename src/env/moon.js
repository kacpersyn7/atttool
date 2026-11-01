/** Moon position (low precision). */
import { D2R } from '../core/linalg.js';
import { RE } from './constants.js';
import { jd } from './time.js';

/**
 * Geocentric Moon position in ECI (km), low-precision series from the Astronomical Almanac
 * (Vallado, "Fundamentals of Astrodynamics", Algorithm 31): ~0.3° in longitude, ~0.2° in
 * latitude, ~0.5 % in distance. UTC is used for TDB (the ~70 s difference moves the Moon ~0.01°).
 * From LEO the Moon's direction differs from the geocentric one by up to ~1° (parallax), so use
 * `moonECI(date) − r` for the direction seen by a spacecraft.
 */
export function moonECI(date) {
  const T = (jd(date) - 2451545.0) / 36525;
  const s = (a, b) => Math.sin((a + b * T) * D2R), c = (a, b) => Math.cos((a + b * T) * D2R);
  const lam = (218.32 + 481267.8813 * T + 6.29 * s(134.9, 477198.85) - 1.27 * s(259.2, -413335.38) + 0.66 * s(235.7, 890534.23)
    + 0.21 * s(269.9, 954397.70) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.6, 966404.05)) * D2R;
  const bet = (5.13 * s(93.3, 483202.03) + 0.28 * s(228.2, 960400.87) - 0.28 * s(318.3, 6003.18) - 0.17 * s(217.6, -407332.20)) * D2R;
  const par = (0.9508 + 0.0518 * c(134.9, 477198.85) + 0.0095 * c(259.2, -413335.38) + 0.0078 * c(235.7, 890534.23) + 0.0028 * c(269.9, 954397.70)) * D2R;
  const eps = (23.439291 - 0.0130042 * T) * D2R;
  const d = RE / Math.sin(par);
  const cb = Math.cos(bet), sb = Math.sin(bet), cl = Math.cos(lam), sl = Math.sin(lam), ce = Math.cos(eps), se = Math.sin(eps);
  return [d * cb * cl, d * (ce * cb * sl - se * sb), d * (se * cb * sl + ce * sb)];
}
