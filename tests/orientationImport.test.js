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

/* ---------------- Layout table → spreadsheet → import ---------------- */
import { partRows, rowsToTSV } from '../src/spacecraft/partsTable.js';

const tsvOf = (sc, opts) => rowsToTSV(partRows(sc), opts);
/** Edit one cell of the TSV: row by part name, column by header prefix. */
function editCell(tsv, part, colPrefix, value) {
  const L = tsv.split('\n').map(l => l.split('\t')); const c = L[0].findIndex(h => h.startsWith(colPrefix));
  L.find(r => r[0] === part)[c] = String(value); return L.map(r => r.join('\t')).join('\n');
}

test('table round trip: unchanged table imports as no change (dot and comma decimals)', () => {
  const sc = defaultSC();
  for (const comma of [false, true]) {
    const rows = plan(sc, tsvOf(sc, { comma }));
    assert.equal(rows.length, sc.comps.length + 1); assert.deepEqual(counts(rows), { same: rows.length }, 'comma=' + comma);
  }
});

test('table: edited yaw is used even though the quaternion and DCM columns are stale', () => {
  const sc = defaultSC(); let t = tsvOf(sc);
  const r0 = partRows(sc).find(r => r.name === 'MTQ-Z');
  t = editCell(t, 'MTQ-Z', 'Yaw', (r0.ypr[0] + 30).toFixed(2));
  const row = byName(plan(sc, t), 'MTQ-Z');
  assert.equal(row.status, 'ok'); assert.match(row.msg, /yaw-pitch-roll/); close(row.angle, 30, 0.02);
});

test('table: edited quaternion is used; two orientation columns edited differently is an error', () => {
  const sc = defaultSC(); const q = AM.axisAngle2q([0, 1, 0], 0.5);
  let t = tsvOf(sc);
  ['q0', 'q1', 'q2', 'q3'].forEach((c, i) => { t = editCell(t, 'MAG', c, [q.w, q.x, q.y, q.z][i].toFixed(6)); });
  const row = byName(plan(sc, t), 'MAG'); assert.match(row.msg, /quaternion/); closeArr(AM.q2C(row.q), AM.q2C(q), 1e-5);
  const bad = editCell(t, 'MAG', 'Yaw', '45.00');
  const b = byName(plan(sc, bad), 'MAG'); assert.equal(b.status, 'error'); assert.match(b.msg, /edited differently/);
});

test('table: position and mass edits, decimal commas, and apply', () => {
  const sc = defaultSC(); let t = tsvOf(sc, { comma: true });
  t = editCell(t, 'GNSS', 'x', '-0,300'); t = editCell(t, 'GNSS', 'Mass', '0,250');
  t = editCell(t, 'Bus', 'Mass', '80');
  const rows = plan(sc, t);
  const g = byName(rows, 'GNSS'); close(g.dPos, 0.05, 1e-9); close(g.dMass, 0.1, 1e-9); close(g.angle, 0, 1e-3);
  assert.equal(byName(rows, 'Bus').status, 'ok'); close(byName(rows, 'Bus').dMass, 5, 1e-9);
  assert.equal(applyImport(sc, rows), 2);
  closeArr(sc.comps.find(c => c.name === 'GNSS').pos, [-0.3, -0.25, 0], 1e-12); close(sc.bus.mass, 80, 0);
  assert.equal(plan(sc, editCell(tsvOf(sc), 'IMU', 'Mass', '-1'))
    .find(r => r.label === 'IMU').status, 'error');
});

test('mass in text and JSON forms', () => {
  const sc = defaultSC();
  const r = plan(sc, 'MAG_mass = 0.2;\nIMU_mass = [0.9]\nSTR_1_mass = 1e-1');
  close(byName(r, 'MAG').mass, 0.2, 0); close(byName(r, 'IMU').mass, 0.9, 0); close(byName(r, 'STR-1').mass, 0.1, 0);
  const j = plan(sc, JSON.stringify({ MAG: { mass: 0.3 }, IMU_mass: 1.2 }));
  close(byName(j, 'MAG').mass, 0.3, 0); close(byName(j, 'IMU').mass, 1.2, 0);
});

test('table: edits in display-only columns are reported, not silently dropped', () => {
  const sc = defaultSC(); let t = tsvOf(sc, { comma: true });
  t = editCell(t, 'STR-1', 'Parameters', 'FOV 25° · Sun excl. 30° · Earth excl. 20°');
  t = editCell(t, 'MAG', 'Axis x', '1,0000');
  t = editCell(t, 'GNSS', 'Mass', '0,2500'); t = editCell(t, 'GNSS', 'Angle to Earth', '12,0');
  const rows = plan(sc, t);
  const s1 = byName(rows, 'STR-1'); assert.equal(s1.status, 'ignored'); assert.match(s1.msg, /Parameters column is display-only/);
  assert.match(byName(rows, 'MAG').msg, /Axis/);
  const g = byName(rows, 'GNSS'); assert.equal(g.status, 'ok'); assert.match(g.msg, /Angle column/); close(g.dMass, 0.1, 1e-9);
  assert.equal(rows.filter(r => r.status === 'ignored' || r.msg).length, 3, 'nothing else flagged');
  assert.equal(applyImport(sc, rows), 1); // only the GNSS mass
});

test('table: cells Excel turned into dates are an error with a hint; header-less rows get a hint', () => {
  const sc = defaultSC(); const t = editCell(tsvOf(sc), 'IMU', 'z', '01.paź');
  const r = byName(plan(sc, t), 'IMU'); assert.equal(r.status, 'error'); assert.match(r.msg, /can't read z/); assert.match(r.msg, /Decimal comma/);
  const rowsOnly = tsvOf(sc).split('\n').slice(1, 4).join('\n');
  const h = plan(sc, rowsOnly); assert.equal(h.length, 1); assert.match(h[0].msg, /header row/);
});
