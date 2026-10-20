/** Export the layout as a NumPy snippet (mounting matrices, RW matrix, mass properties). */
import * as AM from '../core/attitude.js';
import { TYPES } from './componentTypes.js';
import { compAxis } from './component.js';
import { frameMatrix } from './frame.js';

export function exportPython(sc, MP) {
  const f = sc.frame || { origin: [0, 0, 0], xAxis: '+X', zAxis: '+Z' };
  const lines = ['# AttTool export — spacecraft frame SCF = body frame B, component frame C (+Z_C = boresight/spin/dipole/normal)', '# C_CB maps SCF vectors into the component frame: v_C = C_CB @ v_B. Positions are in SCF.', 'import numpy as np', '',
    '# SCF definition relative to the bus geometry frame G (origin at bus centre): p_S = C_SG @ (p_G - scf_origin_G)',
    `scf_origin_G = np.array([${f.origin.map(x => x.toFixed(4)).join(', ')}])  # m`,
    `C_SG = np.array([${frameMatrix(f).map(r => '[' + r.map(x => x.toFixed(1)).join(', ') + ']').join(', ')}])`, ''];
  for (const c of sc.comps) {
    const C = AM.q2C(c.q); const nm = c.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    lines.push(`# ${c.name} (${TYPES[c.type].label})`, `${nm}_pos_B = np.array([${c.pos.map(x => x.toFixed(4)).join(', ')}])  # m`, `${nm}_C_CB = np.array([`, ...C.map(r => `    [${r.map(x => x.toFixed(6)).join(', ')}],`), '])', `${nm}_q_BC = np.array([${[c.q.w, c.q.x, c.q.y, c.q.z].map(x => x.toFixed(6)).join(', ')}])  # scalar-first`, '');
  }
  const ws = sc.comps.filter(c => c.type === 'rw'); if (ws.length) lines.push('# reaction-wheel spin-axis matrix (columns = wheels)', `A_rw = np.array([${[0, 1, 2].map(r => '[' + ws.map(c => compAxis(c)[r].toFixed(6)).join(', ') + ']').join(', ')}])`, '');
  lines.push('# mass properties about CoM, body axes', `mass = ${MP.M.toFixed(3)}  # kg`, `com_B = np.array([${MP.com.map(x => x.toFixed(5)).join(', ')}])`, `J = np.array([${MP.I.map(r => '[' + r.map(x => x.toFixed(5)).join(', ') + ']').join(', ')}])  # kg m^2`);
  return lines.join('\n');
}
