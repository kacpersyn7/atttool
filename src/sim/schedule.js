/**
 * Editing the mode schedule (state.orbit.schedule, see sim/guidance.js). Pure functions on the orbit
 * settings. Edits replace the array, so a scenario never shares it with another.
 */
import { newId } from '../spacecraft/component.js';
import { SEGMENT_KEYS, scheduleOrder } from './guidance.js';
import { currentDate, formatEpoch, parseEpoch, validDate } from './scenario.js';
import { MAX_CHANGES } from './scenarioLibrary.js';

/** Default slew time of a new change (s). */
export const DEFAULT_SLEW = 60;

/** Copy of an attitude quaternion. */
const qCopy = q => ({ w: q.w, x: q.x, y: q.y, z: q.z });

/**
 * Add a change that starts with the settings `g` flying now (the orbit settings or a change; an inertial one keeps
 * its attitude, else Rotation Lab's rotQ), so nothing moves until it is edited. It starts at the current time
 * (whole seconds), or when the slew into `g` ends if that is still under way. @returns the change, or null if the
 * schedule is full or the time is outside the date limits.
 */
export function addChange(o, g, rotQ) {
  const sched = o.schedule || [], now = currentDate(o).getTime(), d = g !== o ? parseEpoch(g.start) : null;
  const slewEnd = d ? d.getTime() + Math.max(0, +g.slew || 0) * 1000 : -Infinity;
  const start = formatEpoch(new Date((now < slewEnd ? Math.ceil(slewEnd / 1000) : Math.floor(now / 1000)) * 1000));
  if (sched.length >= MAX_CHANGES || !validDate(start)) return null;
  const c = { id: newId(), start, slew: DEFAULT_SLEW };
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
  c.start = str; o.schedule = [...o.schedule]; return true;
}

/**
 * Things worth a warning, by change id: 'overlap' (it starts while the slew into the change before it is still
 * under way, so it blends from that slew) and 'tie' (another change starts at the same moment: the later in the list flies).
 */
export function scheduleNotes(o) {
  const sched = o.schedule || [], order = scheduleOrder(sched), notes = {};
  const add = (id, n) => { (notes[id] = notes[id] || []).push(n); };
  order.forEach((x, j) => {
    if (j === 0) return; const p = order[j - 1], c = sched[x.i], pc = sched[p.i];
    if (x.ms === p.ms) { add(c.id, 'tie'); add(pc.id, 'tie'); }
    else if (x.ms < p.ms + Math.max(0, +pc.slew || 0) * 1000) add(c.id, 'overlap');
  });
  return notes;
}

/** Set the mode of change c; one made inertial takes Rotation Lab's attitude rotQ if it has none. */
export function setChangeMode(c, mode, rotQ) { c.mode = mode; if (mode === 'inertial' && !c.q) c.q = qCopy(rotQ); }

/** An inertial change takes Rotation Lab's attitude rotQ now. */
export function takeRotation(c, rotQ) { c.q = qCopy(rotQ); }
