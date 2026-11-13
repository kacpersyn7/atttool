/**
 * Editing the mode schedule (state.orbit.schedule, see sim/guidance.js). Pure functions on the orbit
 * settings. Edits replace the array, so a scenario never shares it with another.
 */
import { newId } from '../spacecraft/component.js';
import { SEGMENT_KEYS, flownBefore, scheduleOrder } from './guidance.js';
import * as ENV from '../env/index.js';
import { clampTime, currentDate, epochDate, formatEpoch, orbitElements, parseEpoch, validDate } from './scenario.js';
import { MAX_CHANGES, NAME_MAX, cleanChangeName } from './scenarioLibrary.js';
import { OFFSET_MAX } from './events.js';
export { NAME_MAX };
/** A change name as kept (scenarioLibrary.cleanChangeName). */
export const cleanName = cleanChangeName;

/** Default slew time of a new change (s). */
export const DEFAULT_SLEW = 60;

/** Copy of an attitude quaternion. */
const qCopy = q => ({ w: q.w, x: q.x, y: q.y, z: q.z });

/**
 * Add a change that starts with the settings `g` flying now (the orbit settings or a change; an inertial one keeps
 * its attitude, else Rotation Lab's rotQ), so nothing moves until it is edited. It starts at the current time, or at
 * t (s from the epoch) when given (whole seconds), or when the slew into `g` ends if that is still under way. @returns the change, or null if the
 * schedule is full or the time is outside the date limits.
 */
export function addChange(o, g, rotQ, t = o.t) {
  const sched = o.schedule || [], now = epochDate(o).getTime() + t * 1000, d = g !== o ? parseEpoch(g.start) : null;
  const slewEnd = d ? d.getTime() + Math.max(0, +g.slew || 0) * 1000 : -Infinity;
  const start = formatEpoch(new Date((now < slewEnd ? Math.ceil(slewEnd / 1000) : Math.floor(now / 1000)) * 1000));
  if (sched.length >= MAX_CHANGES || !validDate(start)) return null;
  const c = { id: newId(), start, slew: 0, autoSlew: true }; // automatic: worked out from the turn (autoSlews)
  for (const k of SEGMENT_KEYS) c[k] = g[k];
  if (c.mode === 'inertial') c.q = qCopy(g !== o && g.q ? g.q : rotQ);
  o.schedule = [...sched, c]; return c;
}

/** Remove change `id`. @returns true if it was there. */
export function deleteChange(o, id) {
  const sched = o.schedule || [], n = sched.length; o.schedule = sched.filter(c => c.id !== id); return o.schedule.length < n;
}

/** Move change `id` to start at UTC `str` (the change object stays, the array is replaced). @returns false, changing nothing, if it isn't a date within the limits. */
export function setChangeStart(o, id, str) {
  const c = (o.schedule || []).find(c => c.id === id); if (!c || !validDate(str)) return false;
  // an event-based change (#58) keeps its event: a new start is where to look from, or for 'after' a new offset
  if (c.on && c.on.kind === 'after') {
    const ref = o.schedule.find(x => x.id === c.on.ref), d = ref && parseEpoch(ref.start);
    if (d) c.on = { ...c.on, offset: Math.round((parseEpoch(str).getTime() - d.getTime()) / 1000) };
  } else if (c.on) { c.on = { ...c.on, from: str }; delete c.on.miss; }
  c.start = str; o.schedule = [...o.schedule]; return true;
}

/**
 * Things worth a warning, by change id: 'overlap' (it starts while the slew into what flew before it is still
 * under way, so it blends from that slew), 'overridden' (a later change in the list starts at the same moment,
 * so this one never flies) and 'tie' (the change that flies, over the ones it overrides).
 */
export function scheduleNotes(o) {
  const sched = o.schedule || [], order = scheduleOrder(sched), notes = {};
  const add = (id, n) => { const l = notes[id] = notes[id] || []; if (!l.includes(n)) l.push(n); };
  order.forEach((x, j) => {
    const c = sched[x.i];
    if (j + 1 < order.length && order[j + 1].ms === x.ms) { add(c.id, 'overridden'); return; }
    if (j > 0 && order[j - 1].ms === x.ms) add(c.id, 'tie');
    const k = flownBefore(order, j); if (k < 0) return;
    const p = order[k], pc = sched[p.i];
    if (x.ms < p.ms + Math.max(0, +pc.slew || 0) * 1000) add(c.id, 'overlap');
  });
  for (const c of sched) if (c && c.on && c.on.miss) add(c.id, 'miss'); // its event was not found (#58)
  return notes;
}

/** Set the mode of change c; one made inertial takes Rotation Lab's attitude rotQ if it has none. */
export function setChangeMode(c, mode, rotQ) { c.mode = mode; if (mode === 'inertial' && !c.q) c.q = qCopy(rotQ); }

/** An inertial change takes Rotation Lab's attitude rotQ now. */
export function takeRotation(c, rotQ) { c.q = qCopy(rotQ); }

/* ---------- the timeline band (#56) ---------- */

/** The id of the change flying at t (s from the epoch; '' before the first). Ties: the later in the list, as guidance. */
export function changeAtTime(o, t) {
  const sched = o.schedule || [], e0 = epochDate(o).getTime(); let id = '';
  for (const x of scheduleOrder(sched)) if ((x.ms - e0) / 1000 <= t) id = sched[x.i].id;
  return id;
}

/**
 * The change whose start is nearest to t (s from the epoch), within tol seconds and inside [t0, t1] (the window
 * shown). For starts at the same moment, the one that flies (the later in the list). Null if none.
 */
export function startNear(o, t, tol, t0 = -Infinity, t1 = Infinity) {
  const sched = o.schedule || [], e0 = epochDate(o).getTime(); let best = null, bd = Infinity;
  for (const x of scheduleOrder(sched)) {
    const s = (x.ms - e0) / 1000; if (s < t0 || s > t1) continue;
    const d = Math.abs(s - t); if (d <= tol && d <= bd) { bd = d; best = { id: sched[x.i].id, t: s }; }
  }
  return best;
}

/* ---------- names and editing helpers (#55) ---------- */

/** Set the name of change `id`. @returns false for an unknown change. */
export function renameChange(o, id, name) {
  const c = (o.schedule || []).find(c => c.id === id); if (!c) return false;
  c.name = cleanName(name); o.schedule = [...o.schedule]; return true;
}

/** UTC string of epoch-relative seconds t, whole seconds. */
const utcOf = (o, t) => formatEpoch(new Date(Math.floor(epochDate(o).getTime() / 1000 + t) * 1000));

/**
 * Copy change `id` (settings, slew, name) to start at the current time, in whole seconds, or when a slew under
 * way ends (as addChange), so nothing already scheduled moves; then a minute later while another change starts
 * at that second. @returns the copy, or null (unknown, full, or outside the date limits).
 */
export function duplicateChange(o, id) {
  const sched = o.schedule || [], c = sched.find(c => c.id === id); if (!c || sched.length >= MAX_CHANGES) return null;
  const order = scheduleOrder(sched), now = currentDate(o).getTime(), sec = ms => Math.floor(ms / 1000);
  let p = -1; for (let j = 0; j < order.length; j++) if (order[j].ms <= now) p = j;
  const slewEnd = p < 0 ? -Infinity : order[p].ms + Math.max(0, +sched[order[p].i].slew || 0) * 1000;
  let s = now < slewEnd ? Math.ceil(slewEnd / 1000) : sec(now);
  const taken = new Set(order.map(x => sec(x.ms))); while (taken.has(s)) s += 60;
  const start = formatEpoch(new Date(s * 1000)); if (!validDate(start)) return null;
  const copy = { ...JSON.parse(JSON.stringify(c)), id: newId(), start };
  o.schedule = [...sched, copy]; return copy;
}

/**
 * Move change `id` by dt seconds. An event-based change (#58) keeps its event and moves its offset instead (so
 * ±1 min fine-tunes it rather than jumping to the next occurrence). @returns false if it would leave the date limits.
 */
export function nudgeChange(o, id, dt) {
  const c = (o.schedule || []).find(c => c.id === id), d = c && parseEpoch(c.start); if (!d) return false;
  if (c.on) {
    const off = Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, (+c.on.offset || 0) + dt)); if (!validDate(formatEpoch(new Date(d.getTime() + dt * 1000)))) return false;
    c.on = { ...c.on, offset: off }; c.start = formatEpoch(new Date(d.getTime() + dt * 1000)); o.schedule = [...o.schedule]; return true;
  }
  return setChangeStart(o, id, formatEpoch(new Date(d.getTime() + dt * 1000)));
}

/**
 * The start (s from the epoch) of the next change after the current time (dir +1), or of the previous one
 * before it (dir -1). Going back, a change that started within the last second of real time (scaled by the
 * playback speed) counts as the one just jumped to, so pressing again goes further back, also while playing.
 * Null if none.
 */
export function adjacentChange(o, dir) {
  const e0 = epochDate(o).getTime(), ts = [...new Set(scheduleOrder(o.schedule).map(x => (x.ms - e0) / 1000))];
  if (dir > 0) { const t = ts.find(x => x > o.t + 1e-6); return t === undefined ? null : t; }
  const grace = Math.max(1, o.playing ? +o.speed || 1 : 1);
  const back = ts.filter(x => x < o.t - grace); return back.length ? back[back.length - 1] : null;
}

/** What undo restores of a change; its other settings (roll, axes, target, its attitude q, …) keep their current values. */
const TRACKED = ['start', 'slew', 'autoSlew', 'name', 'mode', 'on'];

/**
 * Undo for schedule edits: record(o, edit) runs edit() and, if it changed something (it returns neither false
 * nor null), keeps the schedule from before; undo(o) puts the last one back. Undo restores which changes exist
 * and their start, slew, name and mode; a change that is still there keeps its other settings as they are now,
 * so edits made since in Attitude guidance are not lost. Kept per scenario by the caller (clear on a switch).
 */
export function scheduleHistory(limit = 50) {
  const stack = [];
  const push = snap => { stack.push(snap); if (stack.length > limit) stack.shift(); };
  return {
    push(o) { push(JSON.stringify(o.schedule || [])); },
    record(o, edit) { const snap = JSON.stringify(o.schedule || []), r = edit(); if (r !== false && r !== null) push(snap); return r; },
    undo(o) {
      if (!stack.length) return false;
      const now = new Map((o.schedule || []).map(c => [c.id, c]));
      o.schedule = JSON.parse(stack.pop()).map(c => {
        const cur = now.get(c.id); if (!cur) return c;
        const keep = Object.fromEntries(Object.entries(cur).filter(([k]) => !TRACKED.includes(k)));
        const back = { ...keep, ...Object.fromEntries(TRACKED.filter(k => k in c).map(k => [k, c[k]])) };
        if (!('name' in c)) delete back.name; if (!('autoSlew' in c)) delete back.autoSlew; if (!('on' in c)) delete back.on;
        return back;
      });
      return true;
    },
    clear() { stack.length = 0; },
    get size() { return stack.length; },
  };
}

/* ---------- the scenario as a whole: its span, and playing it from start to end ---------- */

/** Margin after the last change's slew for the automatic end (s). */
export const AUTO_END_MARGIN = 300;

/**
 * The span of the scenario, in s from the epoch: start = the epoch, or the first change if that is earlier;
 * end = o.end (UTC) if it is a valid date after the start, else automatic: when the last change (the one that
 * flies, for changes at the same moment) has finished its slew, plus AUTO_END_MARGIN; the attitude stops moving
 * there, since any earlier slew has ended or blends into that one. One orbit without a schedule. Both within the
 * date limits.
 * @returns {{ start, end, auto (the end is automatic), autoEnd (what automatic would be) }}
 */
export function scenarioSpan(o) {
  const e0 = epochDate(o).getTime(), sched = o.schedule || [], order = scheduleOrder(sched);
  const start = clampTime(o, Math.min(0, order.length ? (order[0].ms - e0) / 1000 : 0));
  const last = order[order.length - 1];
  const autoEnd = clampTime(o, last
    ? (last.ms - e0) / 1000 + Math.max(0, +sched[last.i].slew || 0) + AUTO_END_MARGIN
    : start + ENV.propagate(orbitElements(o), 0, false).period);
  const d = validDate(o.end) ? parseEpoch(o.end) : null, typed = d ? clampTime(o, (d.getTime() - e0) / 1000) : null;
  const auto = typed === null || typed <= start;
  return { start, end: auto ? autoEnd : typed, auto, autoEnd };
}

/** Play the scenario from its start: o.run makes playback stop (or loop, o.runLoop) at its end. */
export function startRun(o) { o.t = scenarioSpan(o).start; o.run = true; o.playing = true; }

/**
 * After a playback step from time t0 to o.t: when the step reached the end of a run, loop back or stop there.
 * A run that was already past its end (the time was moved there, or the end was moved before it) just ends,
 * leaving the time alone. Works also when the step stopped at a date limit. @returns true if anything changed.
 */
export function runStep(o, t0 = o.t) {
  if (!o.run) return false;
  const sp = scenarioSpan(o);
  if (t0 >= sp.end) { o.run = false; return true; }
  if (o.t < sp.end) return false;
  if (o.runLoop) { o.t = sp.start; o.playing = true; return true; }
  o.t = sp.end; o.playing = false; o.run = false; return true;
}

/** How far a run has got, 0..1 (null when no run is going). */
export function runProgress(o) {
  if (!o.run) return null; const sp = scenarioSpan(o); if (!(sp.end > sp.start)) return 1;
  return Math.max(0, Math.min(1, (o.t - sp.start) / (sp.end - sp.start)));
}
