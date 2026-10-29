/**
 * Nominal attitude: how the spacecraft frame SCF sits relative to an orbital reference frame
 * (VVLH, LVLH or VNC, STK definitions — see env/orbit.js).
 *
 *   sc.align = { ref: 'lvlh', mode: 'axes', x: '-Z', y: '+X' }   // ref +X ↔ SCF −Z, ref +Y ↔ SCF +X
 *   sc.align = { ref: 'lvlh', mode: 'dcm', dcm: C_SR }             // any rotation
 *
 * C_SR = C_SCF←ref (v_SCF = C_SR · v_ref; columns = reference axes written in SCF).
 * Guidance flies C_BI = E(yaw, pitch, roll) · C_SR · C_RI, so zero offsets = nominal attitude.
 *
 * Pure: no DOM, no three.js, and no env/ import (orbital frames are referenced by id only).
 */
import * as AM from '../core/attitude.js';
import { checkRotation } from '../core/matrixText.js';

const { v, m } = AM;

export const AXIS_SPECS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
export const REF_IDS = ['vvlh', 'lvlh', 'vnc'];

/** What each reference axis means physically (for UI labels). */
export const REF_AXIS_MEANING = {
  vvlh: ['along-track (≈ velocity)', '−orbit normal', 'nadir (→ Earth)'],
  lvlh: ['radial (zenith)', 'along-track (≈ velocity)', 'orbit normal'],
  vnc: ['velocity', 'orbit normal', 'co-normal (≈ zenith)'],
};

/** Physical directions in reference-frame coordinates (exact for circular orbits). */
const PHYS = {
  vvlh: { nadir: [0, 0, 1], alongTrack: [1, 0, 0], normal: [0, -1, 0] },
  lvlh: { nadir: [-1, 0, 0], alongTrack: [0, 1, 0], normal: [0, 0, 1] },
  vnc: { nadir: [0, 0, -1], alongTrack: [1, 0, 0], normal: [0, 1, 0] },
};

export function axisVec(spec) { const a = [0, 0, 0]; a['XYZ'.indexOf(spec[1])] = spec[0] === '-' ? -1 : 1; return a; }
/** '+X'… for an axis-aligned unit vector, else null. */
export function specOf(vec) {
  const k = vec.findIndex(a => Math.abs(Math.abs(a) - 1) < 1e-9);
  return k < 0 ? null : (vec[k] < 0 ? '-' : '+') + 'XYZ'[k];
}
/** Two specs can be ref +X / +Y if they lie on different SCF axes. */
export const validPair = (a, b) => a[1] !== b[1];

/** Nominal attitude identical to the pre-0.4 behaviour: SCF = VVLH. */
export function defaultAlign(ref = 'vvlh') { return { ref, mode: 'axes', x: '+X', y: '+Y', dcm: null }; }

/** C_SCF←ref for an alignment. */
export function alignMatrix(al) {
  if (al.mode === 'dcm' && al.dcm) return al.dcm.map(r => r.slice());
  const a = axisVec(al.x), b = axisVec(al.y);
  return m.fromCols(a, b, v.cross(a, b));
}

/** Axis-table form of an alignment matrix if it is a signed permutation, else null. */
export function axesOf(C_SR) {
  const x = specOf(m.col(C_SR, 0)), y = specOf(m.col(C_SR, 1));
  return x && y && validPair(x, y) ? { x, y } : null;
}

/** Earth (nadir), along-track and orbit-normal directions in SCF during nominal flight. */
export function nominalDirections(al) {
  const C = alignMatrix(al), P = PHYS[al.ref] || PHYS.vvlh;
  return { nadir: m.mulv(C, P.nadir), alongTrack: m.mulv(C, P.alongTrack), normal: m.mulv(C, P.normal) };
}

/** Validate an alignment from untrusted input (JSON import); returns a clean copy or throws. */
export function checkAlign(a, fallbackRef = 'vvlh') {
  if (!a) return defaultAlign(fallbackRef);
  const bad = msg => { throw new Error('Invalid "align": ' + msg); };
  if (!REF_IDS.includes(a.ref)) bad('ref must be one of ' + REF_IDS.join(', '));
  if (a.mode === 'dcm') {
    const C = a.dcm;
    if (!Array.isArray(C) || C.length !== 3 || C.some(r => !Array.isArray(r) || r.length !== 3 || !r.every(Number.isFinite))) bad('dcm must be a 3×3 array');
    if (!checkRotation(C, 1e-4).ok) bad('dcm is not a rotation matrix');
    return { ref: a.ref, mode: 'dcm', x: a.x || '+X', y: a.y || '+Y', dcm: C.map(r => r.slice()) };
  }
  if (!AXIS_SPECS.includes(a.x) || !AXIS_SPECS.includes(a.y) || !validPair(a.x, a.y)) bad('x and y must be different SCF axes like "+X", "-Z"');
  return { ref: a.ref, mode: 'axes', x: a.x, y: a.y, dcm: null };
}
