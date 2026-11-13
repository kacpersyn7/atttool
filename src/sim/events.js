/**
 * Schedule changes that start on events (#58): eclipse entry or exit, the change's target rising above or setting
 * below an elevation, or a time after another change. A change with c.on = { kind, from, offset, elev?, ref? } starts
 * at the first such event at or after `from` (UTC), plus `offset` seconds (negative: before it); 'after' starts
 * `offset` seconds after change `ref` starts. resolveEventStarts writes the result into c.start, so everything else
 * reads starts as before (and an older AttTool that ignores c.on still flies at the resolved time).
 *
 * The events depend only on the orbit (never on the attitude), so resolving is a fixed point. Pure functions.
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { DATE_MAX, DATE_MIN, epochDate, formatEpoch, orbitElements, parseEpoch, targetECEF, validDate } from './scenario.js';

const D2R = Math.PI / 180;

/** Event kinds, with their names for the UI. */
export const EVENT_KINDS = [
  ['eclipseOut', 'Eclipse exit'], ['eclipseIn', 'Eclipse entry'],
  ['rise', 'Target rises above'], ['set', 'Target sets below'], ['after', 'After another change'],
];
/** How far ahead an event is looked for (s): eclipses come every orbit when they come at all; a target can take a day or two. */
export const EVENT_WINDOW = { eclipseOut: 2 * 86400, eclipseIn: 2 * 86400, rise: 3 * 86400, set: 3 * 86400 };
/** Limits of the offset (s) and of the rise/set elevation (deg). */
export const OFFSET_MAX = 6 * 3600, ELEV_MAX = 89;

/**
 * A smooth function that is negative exactly in the cylindrical shadow (ENV.eclipse): on the night side, the distance
 * from the shadow axis minus Rₑ; on the day side, |r| − Rₑ plus the sunward distance (equal at the terminator).
 * Searching it, rather than the yes/no eclipse(), lets a short eclipse between samples be found.
 */
export function shadowMargin(r, sun) {
  const d = AM.v.dot(r, sun);
  if (d >= 0) return AM.v.norm(r) - ENV.RE + d;
  return AM.v.norm(AM.v.sub(r, AM.v.scale(sun, d))) - ENV.RE;
}

/**
 * The first time in [t0, t1] (s) when g goes from ≤ 0 to > 0, to `tol` s; null if it doesn't. Samples every `step`
 * and refines any peak between samples (golden section), so a rise shorter than the step is still found.
 */
export function firstRise(g, t0, t1, step, tol = 0.05) {
  const r = (Math.sqrt(5) - 1) / 2;
  const peak = (a, b) => { // somewhere in (a, b) where g > 0, or null
    let c = b - r * (b - a), d = a + r * (b - a), gc = g(c), gd = g(d);
    for (let k = 0; k < 60 && b - a > tol; k++) {
      if (gc > 0) return c; if (gd > 0) return d;
      if (gc > gd) { b = d; d = c; gd = gc; c = b - r * (b - a); gc = g(c); } else { a = c; c = d; gc = gd; d = a + r * (b - a); gd = g(d); }
    }
    return gc > 0 ? c : gd > 0 ? d : null;
  };
  const edge = (lo, hi) => { for (let k = 0; k < 60 && hi - lo > tol; k++) { const m = (lo + hi) / 2; if (g(m) > 0) hi = m; else lo = m; } return hi; };
  let s0 = t0, g0 = g(t0), s1 = Math.min(t1, t0 + step), g1 = g(s1);
  // already up at t0: wait for it to go down first
  while (g0 > 0 && s1 < t1) { s0 = s1; g0 = g1; s1 = Math.min(t1, s1 + step); g1 = g(s1); }
  if (g0 > 0) return null;
  if (g1 > 0) return edge(s0, s1);
  if (g1 <= g0) { const p = peak(s0, s1); if (p !== null) return edge(s0, p); }
  while (s1 < t1) {
    const s2 = Math.min(t1, s1 + step), g2 = g(s2);
    if (g2 > 0) return edge(s1, s2);
    if (g1 > g0 && g1 >= g2) { const p = peak(s0, s2); if (p !== null) return edge(s0, p); }
    s0 = s1; g0 = g1; s1 = s2; g1 = g2;
  }
  if (g1 > g0) { const p = peak(s0, s1); if (p !== null) return edge(s0, p); }
  return null;
}

/** The function whose rise is event `on` (s from the epoch → value), for orbit settings o and change c. */
function eventFunction(o, c, E) {
  const e0 = epochDate(o).getTime(), st = t => ENV.propagate(E, t, o.j2), date = t => new Date(e0 + t * 1000);
  if (c.on.kind === 'eclipseOut' || c.on.kind === 'eclipseIn') {
    const sgn = c.on.kind === 'eclipseOut' ? 1 : -1; // exit: the margin goes up through 0; entry: down
    return t => sgn * shadowMargin(st(t).r, ENV.sunECI(date(t)));
  }
  const tE = targetECEF(c), E0 = (+c.on.elev || 0) * D2R, sgn = c.on.kind === 'rise' ? 1 : -1;
  return t => {
    const tI = ENV.ecef2eci(tE, date(t)), los = AM.v.sub(tI, st(t).r);
    return sgn * (Math.PI / 2 - AM.v.angle(tI, AM.v.scale(los, -1)) - E0);
  };
}

const cache = new Map(); // change id → { key, ms, miss }: a search only runs again when what it depends on changes
const ms = str => { const d = parseEpoch(str); return d ? d.getTime() : NaN; };
const lim = [ms(DATE_MIN), ms(DATE_MAX)];
const startOf = t => formatEpoch(new Date(Math.min(lim[1], Math.max(lim[0], Math.ceil(t / 1000) * 1000)))); // whole seconds, within the date limits

/**
 * Work out the starts of event-based changes into c.start (and c.on.miss when the event was not found: then it
 * starts at its search time). Fixed-time changes first, then 'after' changes in reference order; a reference to a
 * missing change or a cycle falls back to `from` and is marked missed. @returns true if a start changed.
 */
export function resolveEventStarts(state, E = orbitElements(state.orbit)) {
  const o = state.orbit, sched = o.schedule || []; if (!sched.some(c => c && c.on)) return false;
  const e0 = epochDate(o).getTime(), byId = new Map(sched.map(c => [c.id, c])), done = new Map(); let changed = false;
  const put = (c, t, miss) => {
    const s = startOf(t); if (c.start !== s) { c.start = s; changed = true; }
    if (miss && !c.on.miss) { c.on.miss = true; changed = true; } else if (!miss && c.on.miss) { delete c.on.miss; changed = true; }
    done.set(c.id, ms(c.start));
  };
  const orbitKey = JSON.stringify([E, o.j2, e0]);
  for (const c of sched) {
    if (!c.on || c.on.kind === 'after') continue;
    const from = ms(c.on.from), off = (+c.on.offset || 0) * 1000;
    if (!Number.isFinite(from)) { put(c, ms(c.start), true); continue; }
    const key = JSON.stringify([orbitKey, c.on.kind, c.on.from, c.on.elev, c.on.kind === 'rise' || c.on.kind === 'set' ? [c.tgtLat, c.tgtLon, c.tgtAlt] : 0]);
    let hit = cache.get(c.id);
    if (!hit || hit.key !== key) {
      const t0 = (from - e0) / 1000, t = firstRise(eventFunction(o, c, E), t0, t0 + EVENT_WINDOW[c.on.kind], 20);
      hit = { key, ms: t === null ? null : e0 + t * 1000 }; cache.set(c.id, hit);
    }
    put(c, hit.ms === null ? from : hit.ms + off, hit.ms === null);
  }
  const visiting = new Set();
  const after = c => { // 'after' changes, following their references
    if (done.has(c.id)) return done.get(c.id);
    const ref = byId.get(c.on.ref);
    if (!ref || visiting.has(c.id) || ref === c) { put(c, ms(c.on.from) || ms(c.start), true); return done.get(c.id); }
    visiting.add(c.id);
    const base = ref.on && ref.on.kind === 'after' ? after(ref) : ms(ref.start);
    visiting.delete(c.id);
    put(c, base + (+c.on.offset || 0) * 1000, false); return done.get(c.id);
  };
  for (const c of sched) if (c.on && c.on.kind === 'after') after(c);
  return changed;
}

/** An `on` from untrusted JSON: kept if its kind and fields are valid (offset and elevation are limited), else null. */
export function cleanOn(on, ids) {
  if (!on || typeof on !== 'object' || !EVENT_KINDS.some(([k]) => k === on.kind)) return null;
  const out = { kind: on.kind, from: typeof on.from === 'string' && validDate(on.from) ? on.from : null, offset: Number.isFinite(on.offset) ? Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, on.offset)) : 0 };
  if (on.kind === 'rise' || on.kind === 'set') out.elev = Number.isFinite(on.elev) ? Math.max(0, Math.min(ELEV_MAX, on.elev)) : 0;
  if (on.kind === 'after') { if (typeof on.ref !== 'string' || !ids.has(on.ref)) return null; out.ref = on.ref; }
  else if (!out.from) return null;
  return out;
}

/** A short description of a change's event, for its row and editor ('' for a fixed time). */
export function eventLabel(c, nameOf = () => 'a change') {
  if (!c || !c.on) return '';
  const off = +c.on.offset || 0, sign = off < 0 ? '−' : '+', offTxt = off ? ` ${sign} ${Math.abs(off)} s` : '';
  if (c.on.kind === 'after') return `${Math.abs(off)} s ${off < 0 ? 'before' : 'after'} ${nameOf(c.on.ref)}`;
  const name = (EVENT_KINDS.find(([k]) => k === c.on.kind) || [, ''])[1];
  return name + (c.on.kind === 'rise' || c.on.kind === 'set' ? ` ${+c.on.elev || 0}°` : '') + offTxt;
}
