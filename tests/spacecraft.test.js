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
