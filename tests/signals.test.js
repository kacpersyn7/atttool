import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import * as ENV from '../src/env/index.js';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { applyPreset, orbitElements, epochDate } from '../src/sim/scenario.js';
import { attitudeAt } from '../src/sim/guidance.js';
import { sensorEval } from '../src/sim/sensors.js';
import { computeTimeline } from '../src/sim/timeline.js';
import { signalCatalog, findSignal, plotWindow, quatContinuity, sampleSignals, valueAt, signalsToCSV, columnName } from '../src/sim/signals.js';
import { close, closeArr } from './helpers.js';

function state(mode = 'offsets') {
  const s = {
    rot: { q: AM.q.unit({ w: 0.9, x: 0.1, y: -0.3, z: 0.2 }) },
    orbit: { epoch: '2026-10-05T10:00', hp: 550, ha: 550, i: 97.6, raan: 0, argp: 0, nu0: 0, j2: true, t: 1234, mode, refFrame: 'vvlh', roll: 0, pitch: 0, yaw: 0, sunAxis: '-Z', sunSec: 'nadir', tgtLat: 52.23, tgtLon: 21.01, tgtComp: '' },
    sc: defaultSC(),
  };
  applyPreset(s.orbit, 'sso1030'); s.orbit.t = 1234;
  return s;
}
const period = s => ENV.propagate(orbitElements(s.orbit), 0, false).period;

test('signals: catalog has attitude, environment and per-part signals', () => {
  const s = state(), cat = signalCatalog(s);
  for (const id of ['qBI', 'qBR', 'qBN', 'eulR', 'eulN', 'rate', 'sunB', 'nadB', 'bB', 'beta', 'alt']) assert.ok(findSignal(s, id), id);
  const str = s.sc.comps.find(c => c.type === 'str');
  assert.ok(cat.some(x => x.id === 'sun:' + str.id) && cat.some(x => x.id === 'limb:' + str.id));
  assert.match(findSignal(s, 'qBR').label, /VVLH/);
  assert.equal(findSignal(s, 'sun:nope'), null);
});

test('signals: q_BI is sign-continuous over an orbit and is the attitude C_BI', () => {
  const s = state(), { t0, t1 } = plotWindow(s);
  const { t, series } = sampleSignals(s, ['qBI'], t0, t1, { N: 400 });
  const q = series[0].v;
  // nadir pointing turns once per orbit, so C2q's own sign choice flips somewhere; the series must not
  let flipsRaw = 0;
  for (let n = 1; n < t.length; n++) {
    const a = AM.C2q(attitudeAt(s, t[n - 1]).CBI), b = AM.C2q(attitudeAt(s, t[n]).CBI);
    if (a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z < 0) flipsRaw++;
    assert.ok(q[n].reduce((acc, x, k) => acc + x * q[n - 1][k], 0) > 0.99, 'continuous at ' + n);
  }
  assert.ok(flipsRaw > 0, 'the test case does exercise a sign flip');
  assert.ok(q[0][0] >= 0);
  for (const n of [0, 137, 399]) closeArr(AM.q2C({ w: q[n][0], x: q[n][1], y: q[n][2], z: q[n][3] }), attitudeAt(s, t[n]).CBI, 1e-12);
});

test('signals: nadir pointing in VVLH has body rate −n about Y and zero Euler angles', () => {
  const s = state(), T = period(s);
  const { series } = sampleSignals(s, ['rate', 'eulR', 'qBR'], 0, T, { N: 25 });
  const n = 360 / T; // deg/s, circular orbit (J2 changes it by < 0.2 %)
  // x, z: only the J2 node drift remains, 0.9856°/day = 1.14e-5 °/s for this sun-synchronous orbit
  const drift = 360 / 365.2422 / 86400;
  for (const w of series[0].v) { assert.ok(Math.hypot(w[0], w[2]) < drift * 1.05); close(w[1], -n, n * 2e-3); }
  for (const e of series[1].v) closeArr(e, [0, 0, 0], 1e-9);
  for (const q of series[2].v) closeArr(q, [1, 0, 0, 0], 1e-9);
});

test('signals: Euler vs nominal returns the commanded offsets (φ θ ψ)', () => {
  const s = state(); Object.assign(s.orbit, { roll: 10, pitch: -5, yaw: 20 });
  const v = valueAt(s, findSignal(s, 'eulN'), 500);
  closeArr(v, [10, -5, 20], 1e-9);
});

test('signals: β angle, altitude, Sun and part angles match the environment models', () => {
  const s = state(), str = s.sc.comps.find(c => c.type === 'str');
  const { series } = sampleSignals(s, ['beta', 'alt', 'sunB', 'sun:' + str.id, 'limb:' + str.id], 300, 300, { N: 1 });
  const A = attitudeAt(s, 300);
  close(series[0].v[0][0], ENV.betaAngle(A.st.r, A.st.v, A.sun) * AM.R2D, 1e-12);
  close(series[1].v[0][0], 550, 0.5);
  closeArr(series[2].v[0], AM.m.mulv(A.CBI, A.sun), 1e-12);
  close(series[3].v[0][0], sensorEval(str, A).sunAng, 1e-12);
  close(series[4].v[0][0], sensorEval(str, A).limb, 1e-12);
});

test('signals: orbit window matches the availability timeline; last-N window ends now', () => {
  const s = state(); s.orbit.t = period(s) * 2.3;
  const w = plotWindow(s), tl = computeTimeline(s, 0, null, 10);
  close(w.t0, tl.W0, 1e-9); close(w.t1 - w.t0, tl.T, 1e-9);
  const l = plotWindow(s, { kind: 'last', min: 15 }); close(l.t1, s.orbit.t, 1e-9); close(l.t1 - l.t0, 900, 1e-9);
  s.orbit.t = 60; const e = plotWindow(s, { kind: 'last', min: 15 }); assert.equal(e.t0, 0); assert.equal(e.t1, 900);
});

test('signals: quatContinuity and valueAt pick the nearby sign', () => {
  const r = quatContinuity([[-1, 0, 0, 0], [0.9, 0.1, 0, 0], [-0.8, -0.2, 0, 0]]);
  assert.deepEqual(r.map(q => Math.sign(q[0])), [1, 1, 1]);
  const s = state(), sig = findSignal(s, 'qBI'), v = valueAt(s, sig, 100), w = valueAt(s, sig, 100, v.map(x => -x));
  closeArr(w, v.map(x => -x), 1e-15);
});

test('signals: CSV at a fixed step, with decimal-comma option', () => {
  const s = state(), samples = sampleSignals(s, ['qBI', 'eulR', 'alt'], 0, 10, { step: 1 });
  assert.equal(samples.t.length, 11);
  const csv = signalsToCSV(samples, epochDate(s.orbit).getTime()).trim().split('\n');
  assert.equal(csv.length, 12);
  assert.equal(csv[0], 't [s],UTC,qBI_q0,qBI_q1,qBI_q2,qBI_q3,eulR_roll [deg],eulR_pitch [deg],eulR_yaw [deg],alt [km]');
  assert.match(csv[1], /^0,2026-10-\d\dT\d\d:\d\d:\d\d\.000Z,/);
  assert.equal(csv[3].split(',').length, 10);
  const pl = signalsToCSV(samples, 0, { comma: true }).split('\n');
  assert.equal(pl[0].split(';').length, 10); assert.match(pl[2], /^1;1970-01-01T00:00:01\.000Z;0,\d+;/);
  const str = s.sc.comps.find(c => c.type === 'str');
  assert.match(columnName(findSignal(s, 'sun:' + str.id), 0), /^sunAngle_STR_1 \[deg\]$/);
});
