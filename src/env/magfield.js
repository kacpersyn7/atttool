/** Geomagnetic field: tilted dipole (≈ IGRF dipole term). Real field differs by up to ~20 %. */
import { D2R, v, m } from '../core/linalg.js';
import { Ra } from '../core/attitude.js';
import { RE } from './constants.js';
import { gmst } from './time.js';

export const POLE_LAT = 80.8 * D2R, POLE_LON = -72.7 * D2R, B0 = 29900; // B0 in nT

/** Magnetic field vector in ECI (nT) at ECI position r (km). */
export function bfieldECI(r, date) {
  const th = gmst(date);
  const npEcef = [Math.cos(POLE_LAT) * Math.cos(POLE_LON), Math.cos(POLE_LAT) * Math.sin(POLE_LON), Math.sin(POLE_LAT)];
  const np = m.mulv(Ra(3, th), npEcef);
  const mhat = v.scale(np, -1);
  const rn = v.norm(r), rh = v.scale(r, 1 / rn);
  const f = B0 * (RE / rn) ** 3;
  return v.scale(v.sub(v.scale(rh, 3 * v.dot(mhat, rh)), mhat), f);
}
