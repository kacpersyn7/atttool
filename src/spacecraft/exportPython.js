/** Export the layout as a NumPy snippet (mounting matrices, RW matrix, mass properties). */
import * as AM from '../core/attitude.js';
import { TYPES } from './componentTypes.js';
import { compAxis } from './component.js';
import { busPose } from './bus.js';
import { alignMatrix, defaultAlign } from './alignment.js';
import { codeName } from './orientationImport.js';

export function exportPython(sc, MP) {
  const bp = busPose(sc), al = sc.align || defaultAlign();
  const M = C => 'np.array([' + C.map(r => '[' + r.map(x => x.toFixed(6)).join(', ') + ']').join(', ') + '])';
  const lines = ['# AttTool export — everything in the spacecraft frame SCF (= body frame B). Component frame C: +Z_C = boresight/spin/dipole/normal.', '# C_CB maps SCF vectors into the component frame: v_C = C_CB @ v_B. Positions in m.', 'import numpy as np', '',
    '# bus box: centre and orientation in SCF (v_SCF = C_SG @ v_box)',
    `bus_pos_B = np.array([${bp.pos.map(x => x.toFixed(6)).join(', ')}])`, `bus_C_SG = ${M(bp.C)}`, '',
    `# nominal attitude: v_SCF = C_SR @ v_ref, ref = ${al.ref.toUpperCase()} (STK definition)`, `C_SR_nominal = ${M(alignMatrix(al))}`, ''];
  for (const c of sc.comps) {
    const C = AM.q2C(c.q); const nm = codeName(c.name);
    lines.push(`# ${c.name} (${TYPES[c.type].label})`, `${nm}_pos_B = np.array([${c.pos.map(x => x.toFixed(6)).join(', ')}])  # m`, `${nm}_C_CB = np.array([`, ...C.map(r => `    [${r.map(x => x.toFixed(6)).join(', ')}],`), '])', `${nm}_q_BC = np.array([${[c.q.w, c.q.x, c.q.y, c.q.z].map(x => x.toFixed(6)).join(', ')}])  # scalar-first`, '');
  }
  const ws = sc.comps.filter(c => c.type === 'rw'); if (ws.length) lines.push('# reaction-wheel spin-axis matrix (columns = wheels)', `A_rw = np.array([${[0, 1, 2].map(r => '[' + ws.map(c => compAxis(c)[r].toFixed(6)).join(', ') + ']').join(', ')}])`, '');
  lines.push('# mass properties about CoM, SCF axes', `mass = ${MP.M.toFixed(3)}  # kg`, `com_B = np.array([${MP.com.map(x => x.toFixed(5)).join(', ')}])`, `J = np.array([${MP.I.map(r => '[' + r.map(x => x.toFixed(5)).join(', ') + ']').join(', ')}])  # kg m^2`);
  return lines.join('\n');
}
