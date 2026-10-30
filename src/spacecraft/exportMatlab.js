/**
 * Export the layout as a MATLAB script: per part the mounting DCM C_CB (SCF → part), the
 * quaternion (scalar first) and the position in SCF. Variable names match the Python export,
 * and "Import orientations" reads either file back.
 */
import * as AM from '../core/attitude.js';
import { formatMatlab } from '../core/matrixText.js';
import { TYPES } from './componentTypes.js';
import { compAxis } from './component.js';
import { busPose } from './bus.js';
import { alignMatrix, defaultAlign } from './alignment.js';
import { codeName } from './orientationImport.js';

const vec = a => '[' + a.map(x => +x.toFixed(6)).join(' ') + ']';

export function exportMatlab(sc, MP) {
  const al = sc.align || defaultAlign(), bp = busPose(sc);
  const L = ['% AttTool export: everything in the spacecraft frame SCF (= body frame B), positions in m.',
    '% C_CB maps SCF vectors into the part frame: v_C = C_CB * v_B.  q_BC is scalar first, A(q) = C_CB.', '',
    '% bus box: centre and orientation in SCF (v_SCF = bus_C_SG * v_box)',
    `bus_pos_B = ${vec(bp.pos)};`, `bus_C_SG = ${formatMatlab(bp.C, 9)};`, '',
    `% nominal attitude: v_SCF = C_SR * v_ref, ref = ${al.ref.toUpperCase()} (STK definition)`,
    `C_SR_nominal = ${formatMatlab(alignMatrix(al), 9)};`, ''];
  for (const c of sc.comps) {
    const n = codeName(c.name);
    L.push(`% ${c.name} (${TYPES[c.type].label})`, `${n}_pos_B = ${vec(c.pos)};`, `${n}_C_CB = ${formatMatlab(AM.q2C(c.q), 9)};`, `${n}_q_BC = ${vec([c.q.w, c.q.x, c.q.y, c.q.z])};`, '');
  }
  const ws = sc.comps.filter(c => c.type === 'rw');
  if (ws.length) L.push('% reaction-wheel spin-axis matrix (columns = wheels)', `A_rw = ${formatMatlab([0, 1, 2].map(r => ws.map(c => compAxis(c)[r])), 9)};`, '');
  if (MP) L.push('% mass properties about CoM, SCF axes', `mass = ${+MP.M.toFixed(4)};  % kg`, `com_B = ${vec(MP.com)};`, `J = ${formatMatlab(MP.I, 6)};  % kg m^2`);
  return L.join('\n');
}
