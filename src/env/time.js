/** Time scales. Dates are JS Date objects interpreted as UTC (UT1 ≈ UTC, good to ~1 s). */
import { D2R } from '../core/linalg.js';

/** Julian date of a JS Date. */
export function jd(date) { return date.getTime() / 86400000 + 2440587.5; }

/** Greenwich mean sidereal time (rad), IAU-82 style polynomial truncated after T². */
export function gmst(date) {
  const T = (jd(date) - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd(date) - 2451545.0) + 0.000387933 * T * T;
  return (((g % 360) + 360) % 360) * D2R;
}
