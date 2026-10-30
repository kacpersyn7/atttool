import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import { formatMatlab } from '../src/core/matrixText.js';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { compAxis } from '../src/spacecraft/component.js';
import { massProps } from '../src/spacecraft/massProperties.js';
import { exportPython } from '../src/spacecraft/exportPython.js';
import { exportMatlab } from '../src/spacecraft/exportMatlab.js';
import { codeName, parseOrientations, planImport, applyImport } from '../src/spacecraft/orientationImport.js';
import { close, closeArr } from './helpers.js';

const plan = (sc, text, opts) => planImport(sc, parseOrientations(text), opts);
const byName = (rows, n) => rows.find(r => r.label === n || r.name === n);
const counts = rows => rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});

test('codeName: identifier-safe and keeps axis signs distinct', () => {
  assert.equal(codeName('CSS-+X'), 'CSS_pX'); assert.equal(codeName('CSS--X'), 'CSS_mX');
  assert.equal(codeName('SA −Y'), 'SA_mY'); assert.equal(codeName('SA +Y'), 'SA_pY');
  assert.equal(codeName('STR-1'), 'STR_1'); assert.equal(codeName('X-band'), 'X_band'); assert.equal(codeName('PL cam'), 'PL_cam');
  const names = defaultSC().comps.map(c => codeName(c.name).toLowerCase());
  assert.equal(new Set(names).size, names.length, 'example names stay unique');
});

test('MATLAB and Python exports import back unchanged', () => {
  const sc = defaultSC(), MP = massProps(sc);
  for (const text of [exportMatlab(sc, MP), exportPython(sc, MP)]) {
    const rows = plan(sc, text);
    assert.equal(rows.length, sc.comps.length + 1); // + bus; C_SR_nominal, A_rw, J, com_B ignored
    assert.deepEqual(counts(rows), { same: rows.length });
  }
});

test('a pasted MATLAB DCM rotates the part by the expected angle', () => {
  const sc = defaultSC(); const str = sc.comps.find(c => c.name === 'STR-1');
  const R = AM.q2C(AM.axisAngle2q([0, 0, 1], 30 * AM.D2R)); // extra 30° about the part's own Z
  const newC = AM.m.mul(R, AM.q2C(str.q));
  const rows = plan(sc, `% from the ICD\nSTR_1_C_CB = ${formatMatlab(newC, 9)};\nSTR-2 = [1 0 0; 0 1 0; 0 0 1]`);
  close(byName(rows, 'STR-1').angle, 30, 1e-6);
  assert.equal(byName(rows, 'STR-2').status, 'ok');
  assert.equal(applyImport(sc, rows), 2);
  closeArr(AM.q2C(str.q), newC, 1e-9);
  closeArr(compAxis(sc.comps.find(c => c.name === 'STR-2')), [0, 0, 1], 1e-12);
});

test('direction option: C_SCF←C matrices are transposed, quaternions conjugated', () => {
  const sc = defaultSC(); const C = AM.q2C(AM.axisAngle2q([1, 2, 3], 0.8));
  const a = plan(sc, `MAG = ${formatMatlab(AM.m.T(C), 9)}`, { dir: 'SC' })[0];
  closeArr(AM.q2C(a.q), C, 1e-8);
  const q = AM.C2q(C);
  const b = plan(sc, `MAG = [${[q.w, -q.x, -q.y, -q.z].join(' ')}]`, { dir: 'SC' })[0];
  closeArr(AM.q2C(b.q), C, 1e-12);
  // explicit suffixes override the option: _C_CB is always C_C←SCF
  const c = plan(sc, `MAG_C_CB = ${formatMatlab(C, 9)}`, { dir: 'SC' })[0];
  closeArr(AM.q2C(c.q), C, 1e-8);
});

test('quaternion order: scalar last', () => {
  const sc = defaultSC(); const q = AM.q.unit({ w: .5, x: .1, y: -.7, z: .2 });
  const r = plan(sc, `IMU = [${[q.x, q.y, q.z, q.w].join(', ')}]`, { order: 'last' })[0];
  closeArr(AM.q2C(r.q), AM.q2C(q), 1e-12);
});

test('JSON: map, list, flattened matrices, quaternion objects, positions, full config', () => {
  const sc = defaultSC(); const C = AM.q2C(AM.axisAngle2q([0, 1, 0], 0.4));
  const rows = plan(sc, JSON.stringify({
    'STR-1': C, 'STR-2': C.flat(), MAG: { q: { w: 1, x: 0, y: 0, z: 0 }, pos: [0.1, 0.2, 0.3] }, IMU_pos: [0, 0, 0.5],
  }));
  ['STR-1', 'STR-2'].forEach(n => closeArr(AM.q2C(byName(rows, n).q), C, 1e-12));
  closeArr(byName(rows, 'MAG').pos, [0.1, 0.2, 0.3]); assert.equal(byName(rows, 'IMU').q, undefined);
  const list = plan(sc, JSON.stringify([{ name: 'GNSS', dcm: C }, { name: 'THR', quat: [1, 0, 0, 0] }]));
  assert.deepEqual(list.map(r => r.status), ['ok', 'ok']);
  // orientations copied from another AttTool configuration
  const other = defaultSC(); other.comps.find(c => c.name === 'X-band').q = AM.axisAngle2q([1, 0, 0], 1);
  const cfg = plan(sc, JSON.stringify({ atttool: 1, sc: other }));
  close(byName(cfg, 'X-band').angle, AM.R2D, 1e-9);
  assert.equal(counts(cfg).same, sc.comps.length);
});

test('problems are reported, not applied', () => {
  const sc = defaultSC();
  const rows = plan(sc, [
    'NOPE = [1 0 0; 0 1 0; 0 0 1]',            // unmatched
    'MAG = [1 0 0; 0 1 0; 0 0 -1]',            // reflection
    'IMU = [1 2 3 4 5]',                       // wrong count
    'GNSS = [0.999 0.04 0; -0.04 0.999 0; 0 0 1]', // nearly a rotation
    'THR = [2 0 0 0]',                         // quaternion with |q| = 2
  ].join('\n'));
  assert.equal(byName(rows, 'NOPE').status, 'unmatched');
  assert.match(byName(rows, 'MAG').msg, /reflection/);
  assert.equal(byName(rows, 'IMU').status, 'error');
  assert.equal(byName(rows, 'GNSS').status, 'fixed'); assert.match(byName(rows, 'GNSS').msg, /orthonormalised/);
  assert.equal(byName(rows, 'THR').status, 'fixed'); assert.match(byName(rows, 'THR').msg, /renormalised/);
  assert.equal(plan(sc, 'GNSS = [0.999 0.04 0; -0.04 0.999 0; 0 0 1]', { fix: false })[0].status, 'error');
  const before = JSON.stringify(sc.comps.find(c => c.name === 'MAG'));
  applyImport(sc, rows);
  assert.equal(JSON.stringify(sc.comps.find(c => c.name === 'MAG')), before);
});

test('ambiguous names are not guessed', () => {
  const sc = defaultSC(); sc.comps.push({ ...sc.comps[0], id: 'dup', name: 'pl-cam' });
  assert.equal(plan(sc, 'PL_cam = [1 0 0 0]')[0].status, 'ambiguous');
  assert.equal(plan(sc, 'pl-cam = [1 0 0 0]')[0].label, 'pl-cam'); // an exact (case-insensitive) match wins
});
