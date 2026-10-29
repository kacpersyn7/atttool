import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import { mkComp, compAxis, qFromBoresight, envelope, sanitizeSpacecraft } from '../src/spacecraft/component.js';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { massProps } from '../src/spacecraft/massProperties.js';
import { exportPython } from '../src/spacecraft/exportPython.js';
import { close, closeArr } from './helpers.js';

test('qFromBoresight points +Z_C along the requested direction', () => {
  for (const d of [[1, 0, 0], [0, -1, 0], [0, 0, 1], [0.34, 0.5, -0.8]]) {
    closeArr(compAxis({ q: qFromBoresight(d, [1, 0, 0]) }), AM.v.unit(d), 1e-12);
  }
});

test('bus only: box inertia about its centre', () => {
  const MP = massProps({ bus: { x: 1, y: 2, z: 3, mass: 12 }, comps: [] });
  close(MP.M, 12); closeArr(MP.com, [0, 0, 0]);
  closeArr(MP.I, [[13, 0, 0], [0, 10, 0], [0, 0, 5]], 1e-12);
});

test('point mass shifts CoM and adds parallel-axis terms', () => {
  const sc = { bus: { x: 1, y: 1, z: 1, mass: 1 }, comps: [{ ...mkComp('mag', 'm', [1, 0, 0], [0, 0, 1]), mass: 1 }] };
  const MP = massProps(sc);
  closeArr(MP.com, [0.5, 0, 0], 1e-12);
  close(MP.I[0][0], 1 / 6, 1e-12);            // point mass on the X axis adds nothing about X
  close(MP.I[1][1], 1 / 6 + 0.5, 1e-12);      // 2 masses × 0.5² each
});

test('example spacecraft: sane mass properties', () => {
  const MP = massProps(defaultSC());
  assert.ok(MP.M > 90 && MP.M < 120, 'mass ' + MP.M);
  MP.E.vals.forEach(x => assert.ok(x > 0));
  closeArr(MP.I, AM.m.T(MP.I), 1e-12, 'symmetric');
});

test('4-wheel pyramid: equal momentum envelope on all axes', () => {
  const e = envelope(defaultSC().comps, 'rw', 'hmax');
  close(e[0], e[1], 1e-9); close(e[1], e[2], 1e-3);
});

test('import sanitising rejects unknown types and normalises q', () => {
  assert.throws(() => sanitizeSpacecraft({ bus: { x: 1, y: 1, z: 1, mass: 1 }, comps: [{ type: 'warpdrive', q: { w: 1, x: 0, y: 0, z: 0 } }] }), /Unknown component type/);
  assert.throws(() => sanitizeSpacecraft({ foo: 1 }), /bus/);
  const sc = sanitizeSpacecraft({ sc: { bus: { x: 1, y: 1, z: 1, mass: 1 }, comps: [{ type: 'str', name: 'S', pos: [0, 0, 0], q: { w: 2, x: 0, y: 0, z: 0 } }] } });
  close(sc.comps[0].q.w, 1); assert.ok(sc.comps[0].id);
});

test('Python export mentions every component and the inertia', () => {
  const sc = defaultSC(); const out = exportPython(sc, massProps(sc));
  for (const c of sc.comps) assert.ok(out.includes('# ' + c.name), c.name);
  assert.match(out, /^J = np\.array/m); assert.match(out, /A_rw = /);
});

/* ---------------- bus as a part, nominal alignment ---------------- */
import { busPose, normalizeBus, convertLegacyFrame, busPointToSCF } from '../src/spacecraft/bus.js';
import { alignMatrix, axesOf, nominalDirections, defaultAlign, checkAlign, AXIS_SPECS, validPair } from '../src/spacecraft/alignment.js';
import { parseMatrix3, formatMatlab, orthonormalize, checkRotation } from '../src/core/matrixText.js';

test('default spacecraft: bus at the origin, SCF = VVLH in nominal flight', () => {
  const sc = defaultSC(); closeArr(busPose(sc).pos, [0, 0, 0]); closeArr(busPose(sc).C, AM.m.I());
  closeArr(alignMatrix(sc.align), AM.m.I());
});

test('moving the bus shifts the CoM; turning a square bus 90° about Z keeps the inertia', () => {
  const sc = defaultSC(); sc.comps = []; sc.bus.x = sc.bus.y = 0.8;
  const mp0 = massProps(sc);
  sc.bus.pos = [0, 0, 0.5]; closeArr(massProps(sc).com, [0, 0, 0.5], 1e-12);
  sc.bus.q = AM.axisAngle2q([0, 0, 1], Math.PI / 2); closeArr(massProps(sc).I, mp0.I, 1e-12);
  // a rotated non-square bus swaps its moments
  sc.bus.y = 0.4; const a = massProps(sc).I; sc.bus.q = AM.q.id(); const b = massProps(sc).I;
  close(a[0][0], b[1][1], 1e-12); close(a[1][1], b[0][0], 1e-12);
});

test('bus geometry helpers follow the bus pose', () => {
  const sc = defaultSC(); sc.bus.pos = [1, 2, 3]; sc.bus.q = AM.axisAngle2q([1, 0, 0], Math.PI); // box upside down
  closeArr(busPointToSCF(sc, [0, 0, 0.5]), [1, 2, 2.5], 1e-12);
});

test('old saves and the v0.4 preview frame convert without moving anything', () => {
  const b = normalizeBus({ x: 1, y: 1, z: 1, mass: 1 }); closeArr(b.pos, [0, 0, 0]); assert.deepEqual(b.q, { w: 1, x: 0, y: 0, z: 0 });
  // preview: origin on the bus −Z face, SCF X = bus −Z, Z = bus −Y
  const sc = defaultSC(); sc.frame = { origin: [0, 0, -0.5], xAxis: '-Z', zAxis: '-Y' };
  convertLegacyFrame(sc); assert.equal(sc.frame, undefined);
  // bus centre was +0.5 along bus +Z from the origin = SCF −X
  closeArr(busPose(sc).pos, [-0.5, 0, 0], 1e-12);
  closeArr(busPose(sc).C, [[0, 0, -1], [1, 0, 0], [0, -1, 0]], 1e-12);
});

test('alignment table: all 24 axis pairs give proper rotations and round-trip', () => {
  let n = 0;
  for (const x of AXIS_SPECS) for (const y of AXIS_SPECS) if (validPair(x, y)) {
    const C = alignMatrix({ ref: 'lvlh', mode: 'axes', x, y }); n++;
    assert.ok(checkRotation(C).ok); assert.deepEqual(axesOf(C), { x, y });
  }
  assert.equal(n, 24);
});

test('nominal directions: "LVLH +X ↔ SCF −Z, +Y ↔ SCF +X" puts Earth on SCF +Z', () => {
  const d = nominalDirections({ ref: 'lvlh', mode: 'axes', x: '-Z', y: '+X' });
  closeArr(d.nadir, [0, 0, 1]); closeArr(d.alongTrack, [1, 0, 0]); closeArr(d.normal, [0, -1, 0]);
  // the default (VVLH identity) says the same
  const d0 = nominalDirections(defaultAlign()); closeArr(d0.nadir, d.nadir); closeArr(d0.normal, d.normal);
});

test('alignment validation for JSON import', () => {
  assert.deepEqual(checkAlign(undefined, 'lvlh'), defaultAlign('lvlh'));
  assert.throws(() => checkAlign({ ref: 'lvlh', mode: 'axes', x: '+X', y: '-X' }), /align/);
  assert.throws(() => checkAlign({ ref: 'xyz', mode: 'axes', x: '+X', y: '+Y' }), /align/);
  assert.throws(() => checkAlign({ ref: 'vvlh', mode: 'dcm', dcm: [[1, 0, 0], [0, 1, 0], [0, 0, -1]] }), /rotation/);
  const R = AM.q2C(AM.axisAngle2q([1, 1, 0], 0.3));
  closeArr(checkAlign({ ref: 'vnc', mode: 'dcm', dcm: R }).dcm, R);
  assert.throws(() => sanitizeSpacecraft({ bus: { x: 0, y: 1, z: 1, mass: 1 }, comps: [] }), /Bus size/);
});

test('matrix text: MATLAB, NumPy and plain rows', () => {
  closeArr(parseMatrix3('C = [1 0 0; 0 0.6 0.8; 0 -0.8 0.6];'), [[1, 0, 0], [0, .6, .8], [0, -.8, .6]]);
  closeArr(parseMatrix3('np.array([[1, 2, 3], [4, 5, 6], [7, 8, 9]])'), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  closeArr(parseMatrix3('1\t2\t3\n4 5 6\n7,8,9'), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  closeArr(parseMatrix3('1 2 3 4 5 6 7 8 9'), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  assert.throws(() => parseMatrix3('[1 2; 3 4]'), /9 numbers/);
  assert.throws(() => parseMatrix3('[1 2 x; 1 2 3; 1 2 3]'), /numbers/);
  const C = AM.q2C(AM.axisAngle2q([0.2, -0.5, 1], 1.1));
  closeArr(parseMatrix3(formatMatlab(C, 12)), C, 1e-11);
});

test('orthonormalize repairs a rounded DCM to the nearest rotation', () => {
  const R = AM.q2C(AM.axisAngle2q([1, 2, 3], 0.7));
  const noisy = R.map(r => r.map(x => +x.toFixed(3)));
  assert.equal(checkRotation(noisy).ok, false); assert.ok(checkRotation(noisy).fixable);
  const F = orthonormalize(noisy); assert.ok(checkRotation(F, 1e-12).ok); closeArr(F, R, 2e-3);
  assert.equal(checkRotation([[1, 0, 0], [0, 1, 0], [0, 0, -1]]).fixable, false); // reflection
});
