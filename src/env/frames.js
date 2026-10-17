/** Earth-fixed / inertial frame conversions and Earth geometry (spherical Earth). */
import { v, m } from '../core/linalg.js';
import { Ra, Rp } from '../core/attitude.js';
import { RE } from './constants.js';
import { gmst } from './time.js';

export function ecef2eci(p, date) { return m.mulv(Ra(3, gmst(date)), p); }
export function eci2ecef(p, date) { return m.mulv(Rp(3, gmst(date)), p); }
/** Geocentric lat/lon (rad) + height (km) -> ECEF km. */
export function llh2ecef(lat, lon, h = 0) { const r = RE + h; return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)]; }
export function ecef2ll(p) { return { lat: Math.atan2(p[2], Math.hypot(p[0], p[1])), lon: Math.atan2(p[1], p[0]) }; }

/** First intersection of ray (origin o, unit dir d) with the Earth sphere, or null. */
export function rayEarth(o, d) {
  const b = v.dot(o, d), c = v.dot(o, o) - RE * RE, disc = b * b - c;
  if (disc < 0) return null; const t = -b - Math.sqrt(disc); return t > 0 ? v.add(o, v.scale(d, t)) : null;
}
