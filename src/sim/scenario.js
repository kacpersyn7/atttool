/**
 * Scenario: turns the user-facing orbit settings (state.orbit) into model inputs —
 * epoch, Keplerian elements — and holds the orbit presets.
 *
 * The orbit can be defined four ways (o.def):
 *   'elements'  perigee/apogee altitude + angles (o.hp, o.ha, o.i, o.raan, o.argp, o.nu0)
 *   'rv'        J2000/GCRF state vector at the epoch (o.r km, o.v km/s)
 *   'tle'       a two-line element set (o.tle); the epoch comes from the TLE
 *   'ssrgt'     sun-synchronous repeat ground track: o.rgtR orbits in o.rgtD days, LTAN o.rgtLtan (h), orbit no. 1
 *               crossing the equator northbound at longitude o.rgtLon (deg); solved by ssrgtSolution
 * Each definition keeps its own inputs and epoch when another is chosen (switchDefinition, #81). One not used yet
 * starts from the current orbit: elements and r,v exactly, a repeat track with its LTAN (it solves the rest).
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
/** Release: resumes playback if the press paused it. The page stays (#100): releasing at an end doesn't turn it; ‹ › do (scrubTurn). */
export function scrubEnd(h, o) {
  if (h.held && h.resume) o.playing = true;
  h.held = h.moved = h.resume = false;
}

/**
 * The page (window start) of the time t = o.t for a slider span, the same in the slider, the timeline and the plots
 * (#100): o.page = { w, span } is the page the slider shows, kept while it holds t, so a time on a page boundary stays
 * on the page shown (the end of one, not the start of the next). Without one for this span: the page of t.
 */
export function pageAt(o, span) { const p = o.page; return scrubWindow(o.t, p && p.span === span ? p.w : NaN, span); }

/**
 * ‹ / › (#100): the time and the slider window one page (span) back (dir −1) or on (+1), so the thumb stays where it
 * is: with the Orbit span, the same point of the orbit one orbit later. Near a date limit the time goes as far as it
 * can and the window is the page of it (w NaN: scrubWindowAt works it out). @returns { t, w }
 */
export function scrubTurn(o, w0, span, dir) {
  const want = o.t + dir * span, t = clampTime(o, want);
  return { t, w: t === want ? w0 + dir * span : NaN };
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
  if (o.def === 'ssrgt') { const r = ssrgtSolution(o); if (r) return r.E; }
  if (o.def === 'rv' && o.r && o.v) { // an osculating state: with J2, flown with its mean a (#85); one saved before that (rvOsc false) as it was
    const c = ENV.rv2coe(o.r, o.v); if (!c.error) { const E = { a: c.a, e: c.e, i: c.i, raan: c.raan, argp: c.argp, nu0: c.nu0 }; return o.j2 && o.rvOsc !== false ? ENV.meanFromOsculating(E) : E; }
  }
  if (o.def === 'tle') { // its mean motion is the mean anomaly's rate: with J2 on, the semi-major axis is the one that flies at it
    const t = tleOf(o); if (t) return { a: o.j2 ? ENV.smaForMeanMotion(t.n * 2 * Math.PI / 86400, t.e, t.i * D2R) : t.a, e: t.e, i: t.i * D2R, raan: t.raan * D2R, argp: t.argp * D2R, nu0: ENV.meanToTrue(t.M * D2R, t.e) };
  }
  return fieldElements(o);
}

const TWO_PI = 2 * Math.PI, wrap2pi = x => ((x % TWO_PI) + TWO_PI) % TWO_PI;
let rgtCache = { key: null, val: null };
/**
 * The orbit of a sun-synchronous repeat ground track (o.def 'ssrgt'), or null if the cycle has no solution:
 * { E (elements at the epoch: circular, a and i from ENV.solveRepeatSSO, RAAN from the LTAN at the epoch as the LTAN
 * presets do, phase so that orbit no. 1 crosses the equator northbound at o.rgtLon), t1 (s from the epoch when it
 * does), a, i, raanRate, uRate, period (node to node, s) }. The node's longitude falls at WE − Ω̇; the first time it
 * equals o.rgtLon (within a day) is t1, and the phase puts the satellite on the node then.
 */
export function ssrgtSolution(o) {
  const ep = epochDate(o), key = JSON.stringify([o.rgtR, o.rgtD, o.rgtLtan, o.rgtLon, ep.getTime()]);
  if (rgtCache.key === key) return rgtCache.val;
  // the Earth turns as the GMST model says (its rate differs from WE by a few parts in 10⁹, metres over a cycle)
  const w = (wrap2pi(ENV.gmst(new Date(ep.getTime() + 86400e3)) - ENV.gmst(ep)) + TWO_PI) / 86400;
  const sol = Number.isInteger(o.rgtR) && Number.isInteger(o.rgtD) ? ENV.solveRepeatSSO(o.rgtR, o.rgtD, w) : null; let val = null;
  if (sol) {
    const raan = wrap2pi(ENV.sunRA(ep) + (o.rgtLtan - 12) * 15 * D2R);
    const t1 = wrap2pi(raan - ENV.gmst(ep) - o.rgtLon * D2R) / (w - sol.raanRate);
    val = { E: { a: sol.a, e: 0, i: sol.i, raan, argp: 0, nu0: wrap2pi(-sol.uRate * t1) }, t1, ...sol };
  }
  rgtCache = { key, val }; return val;
}

/**
 * How well a repeat ground track closes in the model: the distance (km) on the ground between where orbit no. 1
 * crosses the equator and where orbit no. 1 + R does, D days later (centimetres: GMST's rate is not quite
 * constant and it is evaluated with rounding over D days). Null without a solution.
 */
export function ssrgtClosure(o) {
  const s = ssrgtSolution(o); if (!s) return null;
  const at = t => { const st = ENV.propagate(s.E, t, true); return ENV.eci2ecef(st.r, new Date(epochDate(o).getTime() + t * 1000)); };
  const p1 = at(s.t1), p2 = at(s.t1 + o.rgtR * s.period);
  const u1 = p1.map(x => x / Math.hypot(...p1)), u2 = p2.map(x => x / Math.hypot(...p2)); // on the sphere: the chord, not acos (useless near 1)
  return ENV.RE * Math.hypot(u1[0] - u2[0], u1[1] - u2[1], u1[2] - u2[2]);
}

/** Problem with the current definition (shown in the UI), or null. */
export function definitionError(o) {
  if (o.def === 'rv') {
    if (!o.r || !o.v || ![...o.r, ...o.v].every(Number.isFinite)) return 'Enter all six numbers.';
    const c = ENV.rv2coe(o.r, o.v); if (c.error) return c.error;
    const hp = c.a * (1 - c.e) - ENV.RE; if (hp < 0) return `Perigee is ${(-hp).toFixed(0)} km below the surface.`;
  }
  if (o.def === 'tle') { if (!o.tle) return 'Paste a TLE.'; try { ENV.parseTLE(o.tle); } catch (e) { return e.message; } }
  if (o.def === 'ssrgt') {
    if (!(Number.isInteger(o.rgtR) && o.rgtR > 0 && Number.isInteger(o.rgtD) && o.rgtD > 0)) return 'The repeat cycle needs whole numbers of orbits and days.';
    if (!o.j2) return 'A repeat ground track needs J2: both the sun-synchronous plane and the repeat depend on it.';
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (!ssrgtSolution(o)) return `No sun-synchronous orbit between 150 and 3000 km makes ${pl(o.rgtR, 'orbit')} in ${pl(o.rgtD, 'day')} (${(o.rgtR / o.rgtD).toFixed(3)} per day; LEO is about 12 to 16).`;
  }
  return null;
}

/** Local time of ascending node at epoch (hours). */
export function ltanOf(o) { const r = orbitElements(o).raan * R2D - ENV.sunRA(epochDate(o)) * R2D; return ((12 + r / 15) % 24 + 24) % 24; }

/**
 * The inputs of each orbit definition: what its tab shows, with the epoch they hold at (the epoch belongs to the
 * definition; a TLE carries its own).
 */
export const DEF_FIELDS = { elements: ['preset', 'hp', 'ha', 'i', 'raan', 'argp', 'nu0', 'epoch'], rv: ['r', 'v', 'epoch', 'rvOsc'], tle: ['tle'], ssrgt: ['rgtR', 'rgtD', 'rgtLtan', 'rgtLon', 'epoch'] };
/** Names of the definitions, as their tabs. */
export const DEF_NAMES = { elements: 'Elements', rv: 'r, v (J2000)', tle: 'TLE', ssrgt: 'Repeat track' };
const inputsOf = (o, def) => JSON.parse(JSON.stringify(Object.fromEntries(DEF_FIELDS[def].map(k => [k, o[k] ?? null]))));
/** What a tab keeps when it is left: its inputs, and `at`, the current UTC then (ms), to come back to from a TLE. */
const keptOf = (o, def) => ({ ...inputsOf(o, def), at: currentDate(o).getTime() });

/**
 * Fill the inputs of definition `to` from orbit `from` = { E (elements at its epoch), ep (its epoch), ltan, tle (it
 * is a TLE's) }: r,v is the state at the epoch, elements are written as fields, a repeat track takes the LTAN (to the
 * minute; altitude, inclination and phase are solved), each at that orbit's epoch, so it is the same orbit (a repeat
 * track: the same LTAN). A TLE can't be made from an orbit, so it is left as it is.
 */
function fillDefinition(o, to, from) {
  if (to === 'rv') { const s = ENV.osculatingState(from.E, 0, o.j2); o.r = s.r.map(x => +x.toFixed(6)); o.v = s.v.map(x => +x.toFixed(9)); o.rvOsc = true; } // the osculating state: it flies the same orbit
  if (to === 'elements') { setFieldsFromElements(o, from.E); o.preset = 'custom'; }
  if (to === 'ssrgt') o.rgtLtan = Math.round(from.ltan * 60) / 60;
  if (to !== 'tle' && (from.tle || from.epoch !== o.epoch)) o.epoch = from.tle ? formatEpoch(from.ep) : from.epoch;
}
const orbitOf = o => ({ E: orbitElements(o), ep: epochDate(o), epoch: o.epoch, ltan: ltanOf(o), tle: o.def === 'tle' });

/**
 * Switch o.def to `to` (#81). Each tab keeps what was entered in it, with its epoch: the tab left is kept in
 * o.defs, and a tab used before gets its own back, so its orbit flies again. A tab not used yet is filled from the
 * current orbit, so nothing moves (fillDefinition). o.defFrom remembers the tab left, for usePreviousOrbit.
 * The current UTC stays (the mode schedule is in UTC), within the date limits, except: going to a TLE starts at
 * its date, as when one is pasted; and leaving a TLE for a tab used before goes back to the time that tab was left
 * at, rather than staying at the TLE's date (often years away). Mutates o.
 */
export function switchDefinition(o, to) {
  if (to === o.def || !DEF_FIELDS[to]) return;
  const from = o.def, was = orbitOf(o), now = currentDate(o).getTime();
  const k0 = o.defs && o.defs[to], kept = k0 && !(to === 'rv' && !(k0.r && k0.v)) ? JSON.parse(JSON.stringify(k0)) : null; // an r,v never filled in counts as unused
  o.defs = { ...(o.defs || {}), [from]: keptOf(o, from) }; delete o.defs[to];
  if (kept) {
    const { at, ...inputs } = kept; Object.assign(o, inputs);
    if (to === 'rv' && inputs.rvOsc === undefined) o.rvOsc = false; // kept before #85: a mean state
    // an LTAN preset holds its LTAN at its epoch: fields that no longer match it (an older save) are no longer that preset
    const p = PRESETS[o.preset];
    if (to === 'elements' && p && p.ltan !== undefined) { const x = { ...o }; applyPreset(x, o.preset); if (['hp', 'ha', 'i', 'raan', 'argp', 'nu0'].some(k => x[k] !== o[k])) o.preset = 'custom'; }
  } else fillDefinition(o, to, was);
  o.def = to; o.defFrom = from;
  const e = epochDate(o).getTime();
  let t = (now - e) / 1000;
  if (to === 'tle' && tleOf(o)) t = 0;
  else if (from === 'tle' && kept && Number.isFinite(kept.at)) t = (kept.at - e) / 1000;
  o.t = clampTime(o, t);
}

/**
 * What "use the orbit from the tab before" would give this tab: its inputs (with the epoch) filled from the orbit
 * that o.defFrom's kept inputs define, or null when there is nothing to use (no tab before, this is a TLE, that one
 * is invalid, or it would change nothing).
 */
export function previousOrbit(o) {
  const from = o.defFrom, kept = from && o.defs && o.defs[from];
  if (!kept || from === o.def || o.def === 'tle' || !DEF_FIELDS[from]) return null;
  const { at, ...inputs } = JSON.parse(JSON.stringify(kept)), p = { ...o, ...inputs, def: from }; if (definitionError(p)) return null;
  const q = { ...o }; fillDefinition(q, o.def, orbitOf(p));
  const next = inputsOf(q, o.def);
  return JSON.stringify(next) === JSON.stringify(inputsOf(o, o.def)) ? null : { def: from, name: DEF_NAMES[from], inputs: next };
}

/** Replace this tab's inputs (and epoch) with the orbit of the tab before (previousOrbit). The current UTC stays. @returns false if there was none. */
export function usePreviousOrbit(o) {
  const p = previousOrbit(o); if (!p) return false;
  const now = currentDate(o).getTime(); Object.assign(o, p.inputs);
  o.t = clampTime(o, (now - epochDate(o).getTime()) / 1000); return true;
}

/**
 * Before setting o.def to `to` directly (a preset, restart from here): the tab left keeps its inputs (#81).
 * remember: it becomes the tab before (usePreviousOrbit); not after a restart.
 */
function leaveDefinition(o, to, remember = true) {
  if (o.def === to || !DEF_FIELDS[o.def]) return;
  o.defs = { ...(o.defs || {}), [o.def]: keptOf(o, o.def) }; delete o.defs[to]; o.defFrom = remember ? o.def : '';
}

/**
 * The state vector to start a full propagator from, t s after the epoch (#85): ENV.osculatingState of the orbit
 * flown, so the J2 mean motion is right. Its position is the drawn one moved radially by the J2 short-period term of
 * a (up to ~9 km in LEO, more on eccentric orbits): only a is corrected.
 */
export function stateForPropagator(o, t) { return ENV.osculatingState(orbitElements(o), t, o.j2); }

/** Write the altitude/angle fields from elements (km, rad). */
export function setFieldsFromElements(o, E) {
  // to the mm and 1e-8°: a repeat ground track switched to elements must still close (1 m in a moves it ~0.4 km a cycle)
  const km = x => +x.toFixed(6), deg = x => +(x * R2D).toFixed(8);
  o.hp = km(E.a * (1 - E.e) - ENV.RE); o.ha = km(E.a * (1 + E.e) - ENV.RE);
  o.i = deg(E.i); o.raan = deg(E.raan); o.argp = deg(E.argp); o.nu0 = deg(E.nu0);
}

/** Make the state at time t (s after epoch) the new initial state: epoch moves to t, r,v definition. */
export function restartFromState(o, t) {
  t = clampTime(o, t); // the new epoch must be a date that can be read back
  leaveDefinition(o, 'rv', false); if (o.def === 'rv') o.defFrom = '';
  const E = orbitElements(o), s = ENV.osculatingState(E, t, o.j2), d = new Date(epochDate(o).getTime() + t * 1000); // osculating: as r, v are read (#85)
  o.r = s.r.map(x => +x.toFixed(6)); o.v = s.v.map(x => +x.toFixed(9));
  o.epoch = formatEpoch(new Date(Math.round(d.getTime()))); o.def = 'rv'; o.rvOsc = true; o.preset = 'custom'; o.t = 0;
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
  const p = PRESETS[k]; if (!p) return false; leaveDefinition(o, 'elements'); o.preset = k; o.def = 'elements';
  Object.assign(o, { hp: p.hp, ha: p.ha, argp: p.argp, nu0: p.nu0 });
  if (p.ltan !== undefined) {
    const a = ENV.RE + p.hp; o.i = +(ENV.ssoInc(a) * R2D).toFixed(3);
    const r = ENV.sunRA(epochDate(o)) * R2D + (p.ltan - 12) * 15; o.raan = +(((r % 360) + 360) % 360).toFixed(2);
  } else { o.i = p.i; o.raan = p.raan; }
  o.t = 0;
  return true;
}
