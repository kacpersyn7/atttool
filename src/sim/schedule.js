/**
 * Editing the mode schedule (state.orbit.schedule, see sim/guidance.js). Pure functions on the orbit
 * settings. Edits replace the array, so a scenario never shares it with another.
 */
import { newId } from '../spacecraft/component.js';
import { SEGMENT_KEYS } from './guidance.js';
import { currentDate, formatEpoch, validDate } from './scenario.js';
import { MAX_CHANGES } from './scenarioLibrary.js';

/** Default slew time of a new change (s). */
export const DEFAULT_SLEW = 60;

/** Copy of an attitude quaternion. */
const qCopy = q => ({ w: q.w, x: q.x, y: q.y, z: q.z });

/**
 * Add a change at the current time (whole seconds) that starts with the settings `g` flying now (the orbit
 * settings or a change; an inertial one keeps its attitude, else Rotation Lab's rotQ). @returns the change, or
 * null if the schedule is full or the time is outside the date limits.
 */
export function addChange(o, g, rotQ) {
  const sched = o.schedule || [], start = formatEpoch(new Date(Math.floor(currentDate(o).getTime() / 1000) * 1000));
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

/** Move change `id` to start at UTC `str`. @returns false, changing nothing, if it isn't a date within the limits. */
export function setChangeStart(o, id, str) {
  const c = (o.schedule || []).find(c => c.id === id); if (!c || !validDate(str)) return false;
  o.schedule = o.schedule.map(x => x === c ? { ...c, start: str } : x); return true;
}

/** Set the mode of change c; one made inertial takes Rotation Lab's attitude rotQ if it has none. */
export function setChangeMode(c, mode, rotQ) { c.mode = mode; if (mode === 'inertial' && !c.q) c.q = qCopy(rotQ); }

/** An inertial change takes Rotation Lab's attitude rotQ now. */
export function takeRotation(c, rotQ) { c.q = qCopy(rotQ); }
