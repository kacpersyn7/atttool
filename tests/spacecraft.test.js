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
  assert.throws(() => sanitizeSpacecraft({ bus: {}, comps: [{ type: 'warpdrive', q: { w: 1, x: 0, y: 0, z: 0 } }] }), /Unknown component type/);
  assert.throws(() => sanitizeSpacecraft({ foo: 1 }), /bus/);
  const sc = sanitizeSpacecraft({ sc: { bus: { x: 1, y: 1, z: 1, mass: 1 }, comps: [{ type: 'str', name: 'S', pos: [0, 0, 0], q: { w: 2, x: 0, y: 0, z: 0 } }] } });
  close(sc.comps[0].q.w, 1); assert.ok(sc.comps[0].id);
});

test('Python export mentions every component and the inertia', () => {
  const sc = defaultSC(); const out = exportPython(sc, massProps(sc));
  for (const c of sc.comps) assert.ok(out.includes('# ' + c.name), c.name);
  assert.match(out, /^J = np\.array/m); assert.match(out, /A_rw = /);
});

/* ---------------- spacecraft frame (SCF) ---------------- */
import { frameMatrix, setFrame, busPose, originPresets, NOMINAL_AXES, AXIS_SPECS, validAxes, checkFrame, pointG2S } from '../src/spacecraft/frame.js';

const worldOf = (sc, c) => { // component position and axes in the bus geometry frame G
  const C = frameMatrix(sc.frame);
  return { p: AM.v.add(AM.m.mulv(AM.m.T(C), c.pos), sc.frame.origin), CCG: AM.m.mul(AM.q2C(c.q), C) };
};

test('frameMatrix is a proper rotation for all 24 valid axis pairs', () => {
  let n = 0;
  for (const x of AXIS_SPECS) for (const z of AXIS_SPECS) if (validAxes(x, z)) {
    const C = frameMatrix({ origin: [0, 0, 0], xAxis: x, zAxis: z }); n++;
    close(AM.m.det(C), 1, 1e-15); closeArr(AM.m.mul(C, AM.m.T(C)), AM.m.I(), 1e-15);
  }
  assert.equal(n, 24);
});

test('default frame keeps the old layout numbers', () => {
  const sc = defaultSC(); closeArr(busPose(sc).pos, [0, 0, 0]); closeArr(busPose(sc).C, AM.m.I());
});

test('changing the SCF keeps components physically in place', () => {
  const sc = defaultSC(); const before = sc.comps.map(c => worldOf(sc, c));
  const mp0 = massProps(sc);
  setFrame(sc, { origin: [0, 0.1, -0.5], xAxis: '-Z', zAxis: '-Y' });
  sc.comps.forEach((c, i) => { const w = worldOf(sc, c); closeArr(w.p, before[i].p, 1e-5, c.name + ' pos'); closeArr(w.CCG, before[i].CCG, 1e-9, c.name + ' axes'); });
  // mass properties: same mass, same principal moments, CoM moved by exactly the origin shift
  const mp1 = massProps(sc);
  close(mp1.M, mp0.M, 1e-9); closeArr(mp1.E.vals, mp0.E.vals, 1e-6);
  closeArr(mp1.com, pointG2S(sc.frame, mp0.com), 1e-5);
  // and back again
  setFrame(sc, { origin: [0, 0, 0], xAxis: '+X', zAxis: '+Z' });
  sc.comps.forEach((c, i) => closeArr(c.pos, before[i].p, 1e-5));
});

test('origin at the −Z face: bus centre sits half a bus height along +Z', () => {
  const sc = defaultSC(); const face = originPresets(sc.bus).find(p => p[0] === 'face-Z')[2];
  setFrame(sc, { origin: face, xAxis: '+X', zAxis: '+Z' });
  closeArr(busPose(sc).pos, [0, 0, sc.bus.z / 2]);
});

test('JSON frame validation', () => {
  assert.deepEqual(checkFrame(undefined), { origin: [0, 0, 0], xAxis: '+X', zAxis: '+Z' });
  assert.throws(() => checkFrame({ origin: [0, 0, 0], xAxis: '+X', zAxis: '-X' }), /frame/);
  assert.throws(() => sanitizeSpacecraft({ bus: { x: 1, y: 1, z: 1, mass: 1 }, frame: { origin: [0, 0] }, comps: [] }), /frame/);
});

test('nominal-flight presets: SCF axes match each orbital frame when the bus flies nadir (bus axes = VVLH)', async () => {
  const ENV = await import('../src/env/index.js');
  const s = ENV.propagate({ a: 7000, e: 0.001, i: 1.7, raan: 0.3, argp: 0, nu0: 0 }, 900, false);
  const CVI = ENV.vvlh(s.r, s.v); // C_G,I in nominal nadir flight
  for (const [id, axes] of Object.entries(NOMINAL_AXES)) {
    const C_SI = AM.m.mul(frameMatrix({ origin: [0, 0, 0], ...axes }), CVI);
    closeArr(C_SI, ENV.orbitFrame(id, s.r, s.v), 2e-3, id); // tolerance: VNC X = v̂ vs VVLH X ⊥ r on a near-circular orbit
  }
});
