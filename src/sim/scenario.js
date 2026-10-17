/**
 * Scenario: turns the user-facing orbit settings (state.orbit) into model inputs —
 * epoch, Keplerian elements — and holds the orbit presets.
 */
import { D2R, R2D } from '../core/linalg.js';
import * as ENV from '../env/index.js';

export const EPOCH0 = '2026-10-05T10:00';

/** Epoch as a Date. `o.epoch` is 'YYYY-MM-DDTHH:MM' in UTC. */
export function epochDate(o) { const d = new Date(o.epoch + ':00Z'); return isNaN(d.getTime()) ? new Date(EPOCH0 + ':00Z') : d; }

/** Keplerian elements (km, rad) from perigee/apogee altitudes and angles in degrees. */
export function orbitElements(o) {
  const rp = ENV.RE + Math.min(o.hp, o.ha), ra = ENV.RE + Math.max(o.hp, o.ha);
  return { a: (ra + rp) / 2, e: (ra - rp) / (ra + rp), i: o.i * D2R, raan: o.raan * D2R, argp: o.argp * D2R, nu0: o.nu0 * D2R };
}

/** Local time of ascending node at epoch (hours). */
export function ltanOf(o) { const r = o.raan - ENV.sunRA(epochDate(o)) * R2D; return ((12 + r / 15) % 24 + 24) % 24; }

/** Orbit presets. `ltan` presets get a sun-synchronous inclination and RAAN computed at the epoch. */
export const PRESETS = {
  sso1030: { label: 'SSO 550 km · LTAN 10:30 (EO)', hp: 550, ha: 550, ltan: 10.5, argp: 0, nu0: 0 },
  ssodd: { label: 'SSO 600 km · dawn–dusk 06:00', hp: 600, ha: 600, ltan: 6, argp: 0, nu0: 0 },
  iss: { label: 'ISS-like 420 km · 51.6°', hp: 418, ha: 422, i: 51.64, raan: 120, argp: 0, nu0: 0 },
  molniya: { label: 'Molniya 600 × 39 800 km · 63.4°', hp: 600, ha: 39800, i: 63.4, raan: 60, argp: 270, nu0: 0 },
  geo: { label: 'GEO 35 786 km', hp: 35786, ha: 35786, i: 0.05, raan: 0, argp: 0, nu0: 0 },
};

/** Apply preset `k` to orbit settings `o` (mutates). Resets time to 0. Returns false if unknown. */
export function applyPreset(o, k) {
  const p = PRESETS[k]; if (!p) return false; o.preset = k;
  Object.assign(o, { hp: p.hp, ha: p.ha, argp: p.argp, nu0: p.nu0 });
  if (p.ltan !== undefined) {
    const a = ENV.RE + p.hp; o.i = +(ENV.ssoInc(a) * R2D).toFixed(3);
    const r = ENV.sunRA(epochDate(o)) * R2D + (p.ltan - 12) * 15; o.raan = +(((r % 360) + 360) % 360).toFixed(2);
  } else { o.i = p.i; o.raan = p.raan; }
  o.t = 0;
  return true;
}
