/**
 * Spacecraft component data model.
 *
 * Component: { id, type, name, pos:[x,y,z] (m, body frame), q:{w,x,y,z} (q_BC), mass, ...type params }
 * Orientation convention: q2C(c.q) = C_CB (rows = component axes in body). +Z_C is the
 * boresight / spin axis / dipole axis / panel normal.
 */
import * as AM from '../core/attitude.js';
import { TYPES, PARAM_KEYS } from './componentTypes.js';
import { checkFrame } from './frame.js';

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

/** Validate & normalise an imported spacecraft config. Throws Error with a readable message. */
export function sanitizeSpacecraft(json) {
  const sc = json.sc || json;
  if (!sc.bus || !Array.isArray(sc.comps)) throw new Error('Expected an object with "bus" and "comps".');
  sc.frame = checkFrame(sc.frame);
  sc.comps.forEach(c => {
    if (!TYPES[c.type]) throw new Error('Unknown component type "' + c.type + '".');
    c.id = c.id || newId(); c.q = AM.q.unit(c.q); delete c.eul;
  });
  return sc;
}
