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

/** Limits of the target height (m): the Dead Sea to above Everest. */
export const TGT_ALT_MIN = -500, TGT_ALT_MAX = 9000;
/** Height of the ground target above the sphere (km); the state holds metres (o.tgtAlt; older saves: none, bad values: 0). */
export const targetHeight = o => { const a = +o.tgtAlt; return Number.isFinite(a) ? Math.max(TGT_ALT_MIN, Math.min(TGT_ALT_MAX, a)) / 1000 : 0; };
/** Ground target in ECEF (km), at its height above the sphere. */
export const targetECEF = o => ENV.llh2ecef(o.tgtLat * D2R, o.tgtLon * D2R, targetHeight(o));

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

/*
 * Time. The epoch belongs to the orbit definition: the date its elements or state hold at.
 * The current time is a separate thing, kept as o.t, seconds from the epoch (negative: before it).
 */

/** Dates that can be typed or reached by playback: the epoch and the current time stay within these. */
export const DATE_MIN = '1900-01-01T00:00', DATE_MAX = '2200-01-01T00:00';
const MS_MIN = Date.UTC(1900, 0, 1), MS_MAX = Date.UTC(2200, 0, 1);
const inDates = d => !!d && d.getTime() >= MS_MIN && d.getTime() <= MS_MAX;
/** A UTC date string in the epoch format within the limits. */
export const validDate = str => inDates(parseEpoch(str));
/** Largest |o.t| that those dates allow (s). */
export const T_MAX = (MS_MAX - MS_MIN) / 1000;
/** t limited so that the current date of orbit settings `o` stays within the dates. */
export const clampTime = (o, t) => { const e = epochDate(o).getTime(); return Math.max((MS_MIN - e) / 1000, Math.min((MS_MAX - e) / 1000, t)); };

/** The current time as a Date. */
export function currentDate(o) { return new Date(epochDate(o).getTime() + o.t * 1000); }

/** Go to the UTC date `str` (same format as the epoch). The orbit doesn't change. Returns false, changing nothing, if it isn't a date within the limits. */
export function setCurrentDate(o, str) {
  const d = parseEpoch(str); if (!inDates(d)) return false;
  o.t = (d.getTime() - epochDate(o).getTime()) / 1000; return true;
}

/**
 * Change the epoch, keeping the current UTC (o.t follows). The fields keep their values, so this re-dates
 * the orbit; an LTAN preset recomputes RAAN to hold its LTAN. Returns false, changing nothing, for a TLE
 * (it has its own epoch) or a date outside the limits.
 */
export function setEpoch(o, str) {
  if (o.def === 'tle' || !inDates(parseEpoch(str))) return false;
  const now = currentDate(o).getTime(), p = PRESETS[o.preset];
  o.epoch = str;
  if (o.def === 'elements' && p && p.ltan !== undefined) applyPreset(o, o.preset); // (resets o.t)
  o.t = clampTime(o, (now - epochDate(o).getTime()) / 1000);
  return true;
}

/** Playback step of dt seconds of real time; stops at the limit. */
export function advanceTime(o, dt) {
  if (!o.playing) return;
  const t = o.t + dt * o.speed; o.t = clampTime(o, t); if (o.t !== t) o.playing = false;
}

/** Spans the time slider can show (o.scrub, a shared display setting) and their labels. */
export const SCRUB_SPANS = [['orbit', 'Orbit'], ['day', 'Day'], ['3d', '3 days']];
/** Span of the time slider (s): one orbital period, a day or 3 days. */
export function scrubSpan(o) { return o.scrub === 'day' ? 86400 : o.scrub === '3d' ? 3 * 86400 : ENV.propagate(orbitElements(o), 0, false).period; }
/*
 * The slider shows one page of time: pages are whole spans counted from the epoch (page 0 runs from T+0 to
 * T+span), so the Orbit span shows the same orbit as the availability timeline (sim/timeline.js).
 */
/**
 * The page that holds t: its start (s from the epoch). A time on a boundary starts the next page, also when
 * t / span rounds to just below a whole number. The timeline and the plots use it for their orbit window too.
 */
export const scrubPage = (t, span) => Math.floor(t / span + 1e-9) * span;
/** scrubWindow, kept within the date limits of `o`: never a page that starts at or past the last date, and no page turn past a limit. */
export function scrubWindowAt(o, w0, span) {
  let w = scrubWindow(o.t, w0, span); const hi = clampTime(o, Infinity), lo = clampTime(o, -Infinity);
  if (w >= hi) w -= span; if (w + span <= lo) w += span;
  return w;
}
/**
 * Start of the slider window: `w0` while it holds t (its ends included, to a billionth of the span: a time on a
 * page boundary read back from the slider is off by rounding), else the page of t. No window yet: pass NaN.
 */
export const scrubWindow = (t, w0, span) => { const m = span * 1e-9; return t >= w0 - m && t <= w0 + span + m ? w0 : scrubPage(t, span); };
/** Start of the window after a slider move is released: at the right end the next page, at the left end the one before, so the next drag goes on. */
export const scrubRelease = (t, w0, span) => { const m = span * 1e-9; return t >= w0 + span - m ? w0 + span : t <= w0 + m ? w0 - span : w0; };
/** Time step (s) of a key on the slider: arrows 1 min (with Shift 1 s), Page Up/Down a tenth of the span; null for other keys. */
export function scrubKey(key, shift, span) {
  const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 }[key]; if (!dir) return null;
  return dir * (key.startsWith('Page') ? Math.round(span / 10) : shift ? 1 : 60);
}

/*
 * Holding the slider thumb pauses playback until release. The hold is { held, moved, resume }.
 * Release can fire more than once (pointerup and change): the later calls change nothing.
 */
export const scrubHold = () => ({ held: false, moved: false, resume: false });
/** Primary press on the slider. A second press during a hold (another finger) changes nothing. */
export function scrubPress(h, o) { if (h.held) return; h.held = true; h.moved = false; h.resume = o.playing; o.playing = false; }
/** Release: resumes playback if the press paused it, and returns the new window start (see scrubRelease). */
export function scrubEnd(h, o, w0, span) {
  // pressing a thumb already at an end changes nothing and fires no input, but must still move the window on
  let w = h.held || h.moved ? scrubRelease(o.t, w0, span) : w0;
  if ((w > w0 && o.t >= clampTime(o, Infinity)) || (w < w0 && o.t <= clampTime(o, -Infinity))) w = w0; // nothing to turn to past a date limit
  if (h.held && h.resume) o.playing = true;
  h.held = h.moved = h.resume = false; return w;
}
/** Play or Pause pressed during a hold: that choice wins, release won't resume. */
export function scrubCancelResume(h) { h.resume = false; }

/** Days from the epoch if that is far enough for the model to lose the position along the orbit (no drag), else null. */
export function farFromEpoch(o) {
  const d = Math.abs(o.t) / 86400; return d >= (o.def === 'tle' ? 3 : 14) ? d : null;
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
 * (and, from a TLE, takes over its epoch). The current UTC stays, except on going to a TLE. Mutates o.
 */
export function switchDefinition(o, to) {
  if (to === o.def) return;
  const E = orbitElements(o), ep = epochDate(o);
  if (to === 'rv') { const s = ENV.propagate(E, 0, false); o.r = s.r.map(x => +x.toFixed(6)); o.v = s.v.map(x => +x.toFixed(9)); }
  if (to === 'elements') setFieldsFromElements(o, E);
  if (o.def === 'tle' && to !== 'tle') o.epoch = formatEpoch(ep);
  if (to === 'tle' && tleOf(o)) o.t = 0; // a TLE has its own date: start there, as when one is pasted
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
  t = clampTime(o, t); // the new epoch must be a date that can be read back
  const E = orbitElements(o), s = ENV.propagate(E, t, o.j2), d = new Date(epochDate(o).getTime() + t * 1000);
  o.r = s.r.map(x => +x.toFixed(6)); o.v = s.v.map(x => +x.toFixed(9));
  o.epoch = formatEpoch(new Date(Math.round(d.getTime()))); o.def = 'rv'; o.preset = 'custom'; o.t = 0;
}

/** Orbit presets. `ltan` presets get a sun-synchronous inclination and RAAN computed at the epoch. */
export const PRESETS = {
  sso1030: { label: 'SSO 550 km · LTAN 10:30 (EO)', hp: 550, ha: 550, ltan: 10.5, argp: 0, nu0: 0 },
  sso1100: { label: 'SSO 550 km · LTAN 11:00', hp: 550, ha: 550, ltan: 11, argp: 0, nu0: 0 },
  sso1200: { label: 'SSO 550 km · LTAN 12:00 (noon–midnight)', hp: 550, ha: 550, ltan: 12, argp: 0, nu0: 0 },
  sso1330: { label: 'SSO 700 km · LTAN 13:30 (afternoon)', hp: 700, ha: 700, ltan: 13.5, argp: 0, nu0: 0 },
  sso2230: { label: 'SSO 786 km · LTAN 22:30 (Sentinel-2-like)', hp: 786, ha: 786, ltan: 22.5, argp: 0, nu0: 0 },
  ssodd: { label: 'SSO 600 km · dawn–dusk 06:00', hp: 600, ha: 600, ltan: 6, argp: 0, nu0: 0 },
  ssodn: { label: 'SSO 600 km · dusk–dawn 18:00', hp: 600, ha: 600, ltan: 18, argp: 0, nu0: 0 },
  polar: { label: 'Polar 800 km · 90°', hp: 800, ha: 800, i: 90, raan: 0, argp: 0, nu0: 0 },
  leo53: { label: 'LEO 550 km · 53° (constellation-like)', hp: 550, ha: 550, i: 53, raan: 0, argp: 0, nu0: 0 },
  equat: { label: 'Equatorial LEO 600 km', hp: 600, ha: 600, i: 0.05, raan: 0, argp: 0, nu0: 0 },
  iss: { label: 'ISS-like 420 km · 51.6°', hp: 418, ha: 422, i: 51.64, raan: 120, argp: 0, nu0: 0 },
  meo: { label: 'GPS-like MEO 20 180 km · 55°', hp: 20180, ha: 20180, i: 55, raan: 0, argp: 0, nu0: 0 },
  gto: { label: 'GTO 250 × 35 786 km · 27°', hp: 250, ha: 35786, i: 27, raan: 0, argp: 178, nu0: 0 },
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
