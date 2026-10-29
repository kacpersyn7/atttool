/**
 * Orientation of a part in its parent frame, editable as yaw-pitch-roll (3-2-1), a DCM or a
 * quaternion. The value is a quaternion q with q2C(q) = C_child←parent (Shuster reading).
 */
import * as AM from '../core/attitude.js';
import { h, seg, slider, numCell, liveText } from './dom.js';
import { dcmInput } from './matrixInput.js';
import { deg, rad, fmt } from './format.js';

/**
 * @param {object} o
 * @param {string} o.id            prefix for element ids
 * @param {() => object} o.get     current quaternion
 * @param {(q: object) => void} o.set
 * @param {string} o.child         name of the child frame in labels, e.g. 'C' or 'box'
 * @param {() => string} o.tab     'ypr' | 'dcm' | 'quat'
 * @param {(t: string) => void} o.setTab
 * @param {() => number} o.dcmDir  0: C_child←SCF shown, 1: transposed
 * @param {(d: number) => void} o.setDcmDir
 */
export function orientationEditor({ id, get, set, child, tab, setTab, dcmDir, setDcmDir }) {
  // Euler angles are cached so slider edits stay stable near singularities; recomputed when q changes elsewhere.
  let eul = null, eulFor = null;
  const qKey = q => [q.w, q.x, q.y, q.z].map(x => x.toFixed(12)).join();
  const angles = () => { const q = get(), k = qKey(q); if (k !== eulFor) { eul = AM.C2euler('321', AM.q2C(q)).map(deg); eulFor = k; } return eul; };
  const setAngle = (i, x) => { const e = angles().slice(); e[i] = x; const q = AM.C2q(AM.euler2C('321', e.map(rad))); eul = e; eulFor = qKey(q); set(q); };
  const axLbl = (name, color, ax) => h('span', null, name + ' · ', h('span', { class: 'ax', style: 'color:var(--ax-' + color + ')' }, ax));

  const ypr = h('div', { class: 'ori-pane' },
    slider({ id: id + 'y', label: axLbl('Yaw', 'z', 'Z'), min: -180, max: 180, step: .5, get: () => angles()[0], set: x => setAngle(0, x) }),
    slider({ id: id + 'p', label: axLbl('Pitch', 'y', 'Y′'), min: -90, max: 90, step: .5, get: () => angles()[1], set: x => setAngle(1, x) }),
    slider({ id: id + 'r', label: axLbl('Roll', 'x', 'X″'), min: -180, max: 180, step: .5, get: () => angles()[2], set: x => setAngle(2, x) }),
    h('p', { class: 'tip' }, `3-2-1 rotation of the ${child} axes from the SCF axes: yaw about Z, then pitch about the new Y′, then roll about X″.`));

  const dcm = h('div', { class: 'ori-pane' },
    dcmInput({ id: id + 'dcm', get: () => AM.q2C(get()), set: C => set(AM.C2q(C)), dir: dcmDir, setDir: setDcmDir,
      labels: [`C_${child}←SCF (rows = ${child} axes)`, `C_SCF←${child} (columns = ${child} axes)`] }),
    h('p', { class: 'tip' }, 'Paste from MATLAB, e.g. [1 0 0; 0 0 1; 0 -1 0], or NumPy / plain rows. Pick the direction your matrix maps.'));

  const qset = (k, x) => { const q = Object.assign({}, get()); q[k] = x; if (AM.q.norm(q) > 1e-9) set(AM.q.unit(q)); };
  const quat = h('div', { class: 'ori-pane' },
    h('div', { class: 'grid4' }, [['w', 'q₀ (scalar)'], ['x', 'q₁'], ['y', 'q₂'], ['z', 'q₃']].map(([k, l]) => numCell(id + 'q' + k, l, () => get()[k], x => qset(k, x), .01, 6))),
    h('div', { class: 'kv' }, h('dt', null, 'Rotation φ about ê'), h('dd', null, liveText(() => { const a = AM.q2axisAngle(get()); return deg(a.angle).toFixed(2) + '° · [' + a.axis.map(x => fmt(x, 3)).join(' ') + ']'; }))),
    h('p', { class: 'tip' }, `Scalar first, renormalised on edit. A(q) = C_${child}←SCF (Shuster); the same numbers are the Hamilton quaternion of the active SCF → ${child} rotation.`));

  const panes = { ypr, dcm, quat };
  const showTab = () => { for (const [k, p] of Object.entries(panes)) p.hidden = k !== tab(); };
  showTab();
  return h('div', { class: 'ori' },
    seg([['ypr', 'Yaw-Pitch-Roll'], ['dcm', 'DCM'], ['quat', 'Quaternion']], tab, t => { setTab(t); showTab(); }),
    ypr, dcm, quat);
}
