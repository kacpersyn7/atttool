/**
 * Spacecraft component data model.
 *
 * Component: { id, type, name, pos:[x,y,z] (m, body frame), q:{w,x,y,z} (q_BC), mass, ...type params }
 * Orientation convention: q2C(c.q) = C_CB (rows = component axes in body). +Z_C is the
 * boresight / spin axis / dipole axis / panel normal.
 */
import * as AM from '../core/attitude.js';
import { TYPES, PARAM_KEYS } from './componentTypes.js';
import { normalizeBus, convertLegacyFrame } from './bus.js';
import { checkAlign } from './alignment.js';

let _id = 1;
export const newId = () => 'c' + (_id++) + Math.random().toString(36).slice(2, 5);

/** Orientation of a component whose +Z points along `dir` (body frame); `hint` fixes the roll about it. */
export function qFromBoresight(dir, hint) {
  dir = AM.v.unit(dir);
  if (!hint || Math.abs(AM.v.dot(AM.v.unit(hint), dir)) > 0.98) hint = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const C_CB = AM.triad([0, 0, 1], [1, 0, 0], dir, hint);
  return AM.C2q(C_CB);
}

/** Create a component of `type` at `pos`, pointing +Z along `dir`. */
export function mkComp(type, name, pos, dir, hint, extra = {}) {
  const T = TYPES[type];
  const c = { id: newId(), type, name, pos: pos.slice(), q: qFromBoresight(dir, hint), mass: T.mass };
  for (const k of PARAM_KEYS) if (T[k] !== undefined) c[k] = T[k];
  return Object.assign(c, extra);
}

/** Give a component any type parameter it lacks (parts saved before that parameter existed). */
export function fillParams(c) {
  const T = TYPES[c.type]; if (!T) return c;
  for (const k of PARAM_KEYS) if (T[k] !== undefined && c[k] === undefined) c[k] = T[k];
  return c;
}

/** C_BC: columns = component axes expressed in body. */
export function compCBC(c) { return AM.m.T(AM.q2C(c.q)); }
/** +Z_C expressed in body. */
export function compAxis(c) { return AM.m.col(compCBC(c), 2); }

/**
 * Actuator envelope per body axis: Σ param·|axis·e| over all components of `type`.
 * e.g. envelope(comps, 'rw', 'hmax') = momentum capacity about X, Y, Z. null if none.
 */
export function envelope(comps, type, key) {
  const cs = comps.filter(c => c.type === type); if (!cs.length) return null;
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => cs.reduce((s, c) => s + Math.abs(AM.v.dot(compAxis(c), e)) * (c[key] || 0), 0));
}

/** Default and limits of the spacecraft's maximum slew rate (deg/s): the schedule's automatic slew times use it.
 * The minimum lets any turn (at most 180°) fit in the longest slew time, 3600 s. */
export const MAX_RATE_DEFAULT = 1, MAX_RATE_MIN = 0.05, MAX_RATE_MAX = 30;
/** A maximum slew rate as kept: within the limits, else the default (older spacecraft have none). */
export const cleanMaxRate = x => Number.isFinite(x) && x >= MAX_RATE_MIN && x <= MAX_RATE_MAX ? x : MAX_RATE_DEFAULT;

/** Validate & normalise an imported spacecraft config. Throws Error with a readable message. */
export function sanitizeSpacecraft(json) {
  const sc = json.sc || json;
  if (!sc.bus || !Array.isArray(sc.comps)) throw new Error('Expected an object with "bus" and "comps".');
  if (!(sc.bus.x > 0 && sc.bus.y > 0 && sc.bus.z > 0)) throw new Error('Bus size x, y, z must be positive numbers.');
  normalizeBus(sc.bus); convertLegacyFrame(sc);
  sc.align = checkAlign(sc.align);
  if (!(sc.bus.mass >= 0)) throw new Error('Bus mass must be a number.');
  const isVec = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  sc.comps.forEach((c, k) => {
    if (!c || typeof c !== 'object') throw new Error(`Part ${k + 1} is not an object.`);
    if (!Object.hasOwn(TYPES, c.type)) throw new Error('Unknown component type "' + c.type + '".');
    const who = `Part ${k + 1}${c.name ? ' "' + c.name + '"' : ''}`;
    if (typeof c.name !== 'string' || !c.name) throw new Error(who + ' needs a "name".');
    if (!isVec(c.pos)) throw new Error(who + ' needs "pos": [x, y, z] in metres.');
    if (!c.q || ![c.q.w, c.q.x, c.q.y, c.q.z].every(Number.isFinite) || AM.q.norm(c.q) < 1e-9) throw new Error(who + ' needs "q": {w, x, y, z}.');
    if (c.mass === undefined) c.mass = TYPES[c.type].mass;
    if (!(c.mass >= 0)) throw new Error(who + ': "mass" must be a number.');
    c.id = c.id || newId(); c.q = AM.q.unit(c.q); delete c.eul; fillParams(c);
  });
  sc.maxRate = cleanMaxRate(sc.maxRate);
  return sc;
}
