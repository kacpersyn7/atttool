import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import { mkComp, compAxis, qFromBoresight, envelope, sanitizeSpacecraft } from '../src/spacecraft/component.js';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { ensureFleet, activeItem, selectSpacecraft, addSpacecraft, duplicateSpacecraft, renameSpacecraft, deleteSpacecraft } from '../src/spacecraft/library.js';
import { defaultState, migrate } from '../src/state/store.js';
import { payloadComp } from '../src/sim/guidance.js';
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

test('default spacecraft stands on the XY plane (bus −Z face at the origin), SCF = VVLH in nominal flight', () => {
  const sc = defaultSC(); closeArr(busPose(sc).pos, [0, 0, 0.5]); closeArr(busPointToSCF(sc, [0, 0, -0.5]), [0, 0, 0]);
  closeArr(sc.comps.find(c => c.name === 'PL cam').pos, [0, 0, 0.92]); closeArr(busPose(sc).C, AM.m.I());
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

/* ---------------- parts table ---------------- */
import { partRows, layoutWarnings, rowsToTSV, paramText } from '../src/spacecraft/partsTable.js';

test('parts table: bus first, one row per component, nominal angles', () => {
  const sc = defaultSC(); const rows = partRows(sc);
  assert.equal(rows.length, sc.comps.length + 1); assert.equal(rows[0].id, 'bus');
  const pl = rows.find(r => r.name === 'PL cam');
  close(pl.toEarth, 0, 1e-9); close(pl.toAlong, 90, 1e-9); close(pl.toNormal, 90, 1e-9); // payload looks at nadir
  const sa = rows.find(r => r.name === 'SA +Y'); close(sa.toEarth, 180, 1e-9);               // arrays face zenith
  const css = rows.find(r => r.name === 'CSS-+X'); close(css.toAlong, 0, 1e-9);
  closeArr(rows.find(r => r.name === 'MTQ-X').ypr.map(Math.round), AM.C2euler('321', AM.q2C(sc.comps.find(c => c.name === 'MTQ-X').q)).map(x => Math.round(x * AM.R2D)));
  assert.equal(paramText(sc.comps.find(c => c.type === 'str')), 'FOV 20° · Sun excl. 30° · Earth excl. 20° · Moon excl. 15°');
  // a different nominal alignment changes the angles
  sc.align = { ref: 'lvlh', mode: 'axes', x: '+Z', y: '+X' }; // radial out = SCF +Z → payload looks away from Earth
  close(partRows(sc).find(r => r.name === 'PL cam').toEarth, 180, 1e-9);
});

test('layout warnings: duplicates, export-name clashes, same position, no mass', () => {
  const sc = defaultSC(); assert.deepEqual(layoutWarnings(sc), []);
  const a = sc.comps[0];
  sc.comps.push({ ...a, id: 'd1' });                              // duplicate name + same position
  sc.comps.push({ ...a, id: 'd2', name: 'PL_cam', pos: [9, 9, 9] }); // same export name, different name
  sc.comps.push({ ...sc.comps[3], id: 'd3', name: 'Dummy', pos: [5, 5, 5], mass: 0 });
  const w = layoutWarnings(sc).map(x => x.text).join('\n');
  assert.match(w, /Duplicate name "PL cam"/); assert.match(w, /same export name PL_cam/);
  assert.match(w, /same position/); assert.match(w, /Dummy has no mass/);
});

test('parts table TSV has a header and one line per row', () => {
  const sc = defaultSC(); const t = rowsToTSV(partRows(sc)).split('\n');
  assert.equal(t.length, sc.comps.length + 2); assert.equal(t[0].split('\t').length, t[1].split('\t').length);
  assert.match(t[2], /^PL cam\tPayload camera\t0\.000000\t0\.000000\t0\.920000/);
});

/* ---------- spacecraft library (#37) ---------- */

/** A small state: one spacecraft, migrated as an old save would be. */
function libState() { const s = { sc: defaultSC(), orbit: { tgtComp: '' } }; ensureFleet(s); return s; }

test('library: an old save becomes a library of one, with the spacecraft active', () => {
  const s = libState(), sc = s.sc;
  assert.equal(s.fleet.items.length, 1); assert.equal(s.fleet.items[0].sc, null); assert.equal(s.fleet.active, s.fleet.items[0].id);
  assert.equal(s.sc, sc); assert.equal(activeItem(s).name, 'Spacecraft 1');
  const again = JSON.stringify(s.fleet); ensureFleet(s); assert.equal(JSON.stringify(s.fleet), again, 'idempotent');
});

test('library: migrate() upgrades parked spacecraft too and survives a save round trip', () => {
  const s = defaultState(); migrate(s); const first = s.fleet.active;
  addSpacecraft(s, defaultSC(), 'B'); selectSpacecraft(s, first);
  const parked = s.fleet.items.find(i => i.name === 'B').sc, str = parked.comps.find(c => c.type === 'str'); delete str.moonExcl;
  const back = JSON.parse(JSON.stringify(s)); migrate(back);
  assert.equal(back.fleet.active, first); assert.equal(back.fleet.items.length, 2);
  assert.equal(back.fleet.items.find(i => i.name === 'B').sc.comps.find(c => c.type === 'str').moonExcl, 15);
  assert.equal(back.fleet.items.find(i => i.id === first).sc, null);
});

test('library: switching swaps the spacecraft and keeps each one\'s data and pointing axis', () => {
  const s = libState(), a = s.sc, ida = s.fleet.active; s.orbit.tgtComp = 'pa';
  const b = defaultSC(); b.bus.mass = 123; const idb = addSpacecraft(s, b, 'B');
  assert.equal(s.sc, b); assert.equal(s.orbit.tgtComp, ''); assert.equal(s.fleet.active, idb);
  s.orbit.tgtComp = 'pb';
  assert.equal(selectSpacecraft(s, ida), true);
  assert.equal(s.sc, a); assert.equal(s.orbit.tgtComp, 'pa');
  assert.equal(s.fleet.items.find(i => i.id === idb).sc.bus.mass, 123); assert.equal(activeItem(s).sc, null);
  assert.equal(selectSpacecraft(s, ida), false, 'already active'); assert.equal(selectSpacecraft(s, 'nope'), false);
  selectSpacecraft(s, idb); assert.equal(s.orbit.tgtComp, 'pb');
});

test('library: duplicate is an independent copy with the same pointing axis', () => {
  const s = libState(), a = s.sc; s.orbit.tgtComp = 'pa';
  duplicateSpacecraft(s);
  assert.notEqual(s.sc, a); assert.deepEqual(s.sc, a); assert.equal(s.orbit.tgtComp, 'pa'); assert.equal(activeItem(s).name, 'Spacecraft 1 copy');
  s.sc.bus.mass = 1; assert.notEqual(a.bus.mass, 1);
});

test('library: names stay unique and non-blank', () => {
  const s = libState(), id1 = s.fleet.active, id2 = addSpacecraft(s, defaultSC(), 'Spacecraft 1');
  assert.equal(activeItem(s).name, 'Spacecraft 1 2');
  assert.equal(renameSpacecraft(s, id2, ' Spacecraft 1 '), false); assert.equal(renameSpacecraft(s, id2, '  '), false);
  assert.equal(renameSpacecraft(s, id2, ' Sat '), true); assert.equal(activeItem(s).name, 'Sat');
  assert.equal(renameSpacecraft(s, id1, 'Sat'), false);
});

test('library: delete keeps the last one and activates a neighbour', () => {
  const s = libState(), a = s.fleet.active;
  assert.equal(deleteSpacecraft(s, a), false, 'last one stays');
  const b = addSpacecraft(s, defaultSC(), 'B'), c = addSpacecraft(s, defaultSC(), 'C'), scA = s.fleet.items[0];
  assert.ok(scA.sc); assert.equal(deleteSpacecraft(s, c), true); assert.equal(s.fleet.active, b, 'last item: the one before');
  selectSpacecraft(s, a); const scB = s.fleet.items[1].sc;
  assert.equal(deleteSpacecraft(s, a), true); assert.equal(s.fleet.active, b); assert.equal(s.sc, scB); assert.equal(s.fleet.items.length, 1);
  assert.equal(deleteSpacecraft(s, 'nope'), false);
});

test('library: repairs a damaged library without losing the active spacecraft', () => {
  const s = libState(), sc = s.sc;
  s.fleet.items.push({ id: 'x', name: 'Broken', sc: null }, { id: 'y', name: 'No bus', sc: {} }); ensureFleet(s);
  assert.equal(s.fleet.items.length, 1);
  s.fleet.active = 'gone'; ensureFleet(s); assert.equal(s.sc, sc); assert.equal(activeItem(s).sc, null);
  s.fleet = 'junk'; ensureFleet(s); assert.equal(s.fleet.items.length, 1);
});

test('library: the pointing axis falls back to the payload when the part is not on the spacecraft', () => {
  const s = libState(); s.orbit.tgtComp = 'not-here';
  assert.equal(payloadComp(s).type, 'payload');
});

