/**
 * Scenario: turns the user-facing orbit settings (state.orbit) into model inputs —
 * epoch, Keplerian elements — and holds the orbit presets.
 *
 * The orbit can be defined three ways (o.def):
 *   'elements'  perigee/apogee altitude + angles (o.hp, o.ha, o.i, o.raan, o.argp, o.nu0)
 *   'rv'        J2000/GCRF state vector at the epoch (o.r km, o.v km/s)
 *   'tle'       a two-line element set (o.tle); the epoch comes from the TLE
 * Switching definitions keeps the current orbit (see switchDefinition).
 */
import { D2R, R2D } from '../core/linalg.js';
import * as ENV from '../env/index.js';

export const EPOCH0 = '2026-10-05T10:00';

/** Parse 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DDTHH:MM:SS(.sss)' (UTC) → Date, or null. */
export function parseEpoch(str) {
  const t = String(str || '').trim(); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(t)) return null;
  const d = new Date(t + (t.length === 16 ? ':00' : '') + 'Z'); return isNaN(d.getTime()) ? null : d;
}
/** Date → 'YYYY-MM-DDTHH:MM:SS(.sss)' (UTC), dropping zero seconds / milliseconds. */
export function formatEpoch(d) {
  const iso = d.toISOString().replace('Z', ''); return iso.replace(/\.000$/, '').replace(/:00$/, '');
}

/** Epoch as a Date. In TLE mode the TLE's own epoch is used. */
export function epochDate(o) {
  if (o.def === 'tle') { const t = tleOf(o); if (t) return t.epoch; }
  return parseEpoch(o.epoch) || parseEpoch(EPOCH0);
}

const tleCache = { text: null, val: null };
/** Parsed TLE of the orbit settings (cached), or null if none / invalid. */
export function tleOf(o) {
  if (!o.tle) return null;
  if (tleCache.text !== o.tle) { tleCache.text = o.tle; try { tleCache.val = ENV.parseTLE(o.tle); } catch { tleCache.val = null; } }
  return tleCache.val;
}

/** Elements from the altitude/angle fields. */
function fieldElements(o) {
  const rp = ENV.RE + Math.min(o.hp, o.ha), ra = ENV.RE + Math.max(o.hp, o.ha);
  return { a: (ra + rp) / 2, e: (ra - rp) / (ra + rp), i: o.i * D2R, raan: o.raan * D2R, argp: o.argp * D2R, nu0: o.nu0 * D2R };
}

/**
 * Keplerian elements (km, rad) at the epoch for the current definition.
 * Falls back to the element fields if the r,v state or the TLE is invalid (the UI shows the error).
 */
export function orbitElements(o) {
  if (o.def === 'rv' && o.r && o.v) { const c = ENV.rv2coe(o.r, o.v); if (!c.error) return { a: c.a, e: c.e, i: c.i, raan: c.raan, argp: c.argp, nu0: c.nu0 }; }
  if (o.def === 'tle') { const t = tleOf(o); if (t) return { a: t.a, e: t.e, i: t.i * D2R, raan: t.raan * D2R, argp: t.argp * D2R, nu0: ENV.meanToTrue(t.M * D2R, t.e) }; }
  return fieldElements(o);
}

/** Problem with the current definition (shown in the UI), or null. */
export function definitionError(o) {
  if (o.def === 'rv') {
    if (!o.r || !o.v || ![...o.r, ...o.v].every(Number.isFinite)) return 'Enter all six numbers.';
    const c = ENV.rv2coe(o.r, o.v); if (c.error) return c.error;
    const hp = c.a * (1 - c.e) - ENV.RE; if (hp < 0) return `Perigee is ${(-hp).toFixed(0)} km below the surface.`;
  }
  if (o.def === 'tle') { if (!o.tle) return 'Paste a TLE.'; try { ENV.parseTLE(o.tle); } catch (e) { return e.message; } }
  return null;
}

/** Local time of ascending node at epoch (hours). */
export function ltanOf(o) { const r = orbitElements(o).raan * R2D - ENV.sunRA(epochDate(o)) * R2D; return ((12 + r / 15) % 24 + 24) % 24; }

/**
 * Switch o.def to `to`, filling the new definition from the current orbit so nothing moves.
 * Elements → r,v uses the state at the epoch; anything → elements writes the fields from the elements
 * (and, from a TLE, takes over its epoch). Mutates o.
 */
export function switchDefinition(o, to) {
  if (to === o.def) return;
  const E = orbitElements(o), ep = epochDate(o);
  if (to === 'rv') { const s = ENV.propagate(E, 0, false); o.r = s.r.map(x => +x.toFixed(6)); o.v = s.v.map(x => +x.toFixed(9)); }
  if (to === 'elements') setFieldsFromElements(o, E);
  if (o.def === 'tle' && to !== 'tle') o.epoch = formatEpoch(ep);
  o.def = to; o.preset = 'custom';
}

/** Write the altitude/angle fields from elements (km, rad). */
export function setFieldsFromElements(o, E) {
  const r2 = x => +x.toFixed(3);
  o.hp = r2(E.a * (1 - E.e) - ENV.RE); o.ha = r2(E.a * (1 + E.e) - ENV.RE);
  o.i = +(E.i * R2D).toFixed(4); o.raan = +(E.raan * R2D).toFixed(4); o.argp = +(E.argp * R2D).toFixed(4); o.nu0 = +(E.nu0 * R2D).toFixed(4);
}

/** Make the state at time t (s after epoch) the new initial state: epoch moves to t, r,v definition. */
export function restartFromState(o, t) {
  const E = orbitElements(o), s = ENV.propagate(E, t, o.j2), d = new Date(epochDate(o).getTime() + t * 1000);
  o.r = s.r.map(x => +x.toFixed(6)); o.v = s.v.map(x => +x.toFixed(9));
  o.epoch = formatEpoch(new Date(Math.round(d.getTime()))); o.def = 'rv'; o.preset = 'custom'; o.t = 0;
}

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
  const p = PRESETS[k]; if (!p) return false; o.preset = k; o.def = 'elements';
  Object.assign(o, { hp: p.hp, ha: p.ha, argp: p.argp, nu0: p.nu0 });
  if (p.ltan !== undefined) {
    const a = ENV.RE + p.hp; o.i = +(ENV.ssoInc(a) * R2D).toFixed(3);
    const r = ENV.sunRA(epochDate(o)) * R2D + (p.ltan - 12) * 15; o.raan = +(((r % 360) + 360) % 360).toFixed(2);
  } else { o.i = p.i; o.raan = p.raan; }
  o.t = 0;
  return true;
}
