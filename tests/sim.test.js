import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { compAxis } from '../src/spacecraft/component.js';
import { applyPreset, orbitElements, ltanOf, PRESETS } from '../src/sim/scenario.js';
import { attitudeAt, payloadComp, bodyRate } from '../src/sim/guidance.js';
import { computeTimeline } from '../src/sim/timeline.js';
import { close, closeArr } from './helpers.js';

function state(mode = 'offsets', preset = 'sso1030') {
  const s = {
    rot: { q: AM.q.id() },
    orbit: { epoch: '2026-10-05T10:00', hp: 550, ha: 550, i: 97.6, raan: 0, argp: 0, nu0: 0, j2: true, t: 0, mode, refFrame: 'vvlh', roll: 0, pitch: 0, yaw: 0, sunAxis: '-Z', sunSec: 'nadir', tgtLat: 52.23, tgtLon: 21.01, tgtComp: '' },
    sc: defaultSC(),
  };
  applyPreset(s.orbit, preset);
  return s;
}

test('presets apply and SSO LTAN matches the preset', () => {
  for (const k of Object.keys(PRESETS)) { const s = state('offsets', k); assert.equal(s.orbit.preset, k); }
  close(ltanOf(state('offsets', 'sso1030').orbit), 10.5, 0.02);
  close(ltanOf(state('offsets', 'ssodd').orbit), 6, 0.02);
});

test('orbitElements: altitudes -> a, e', () => {
  const E = orbitElements({ hp: 600, ha: 39800, i: 63.4, raan: 0, argp: 0, nu0: 0 });
  assert.ok(E.e > 0.7 && E.e < 0.75);
});

test('offsets mode, VVLH, zero offsets: payload (+Z) points at the Earth centre', () => {
  const s = state('offsets'); const A = attitudeAt(s, 500);
  const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]);
  close(AM.v.dot(zI, AM.v.unit(A.st.r)), -1, 1e-12);
});

test('roll offset tilts the boresight by that angle', () => {
  const s = state('offsets'); s.orbit.roll = 25; const A = attitudeAt(s, 500);
  const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]);
  close(Math.acos(-AM.v.dot(zI, AM.v.unit(A.st.r))) * AM.R2D, 25, 1e-9);
});

test('alignment = LVLH identity: zero offsets put body X radial out and Z on the orbit normal', () => {
  const s = state('offsets'); s.sc.align = { ref: 'lvlh', mode: 'axes', x: '+X', y: '+Y' }; s.orbit.refFrame = 'lvlh'; const A = attitudeAt(s, 700);
  closeArr(A.CBI, A.CRI, 1e-15);
  const xI = AM.m.mulv(AM.m.T(A.CBI), [1, 0, 0]); close(AM.v.dot(xI, AM.v.unit(A.st.r)), 1, 1e-12);
});

test('target mode below the horizon holds the nominal attitude', () => {
  const s = state('target'); s.orbit.refFrame = 'lvlh'; s.orbit.tgtLat = -60; s.orbit.tgtLon = 150;
  const A = attitudeAt(s, 0); assert.ok(A.flag.below); closeArr(A.CBI, A.CNI, 1e-15); closeArr(A.CBI, A.CVI, 1e-15); // default = VVLH
});

test('nominal attitude from the alignment table flies the payload at nadir', () => {
  const s = state('offsets'); s.sc.align = { ref: 'lvlh', mode: 'axes', x: '-Z', y: '+X' }; // = VVLH with the bus as built
  for (const t of [0, 1500, 4000]) {
    const A = attitudeAt(s, t); closeArr(A.CBI, A.CVI, 1e-12);
    const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]); close(AM.v.dot(zI, AM.v.unit(A.st.r)), -1, 1e-12);
  }
});

test('nominalDirections agree with the flown nominal attitude for every reference frame', async () => {
  const { nominalDirections } = await import('../src/spacecraft/alignment.js');
  const s = state('offsets');
  for (const ref of ['vvlh', 'lvlh', 'vnc']) {
    s.sc.align = { ref, mode: 'dcm', dcm: AM.q2C(AM.axisAngle2q([1, -2, 0.5], 0.9)) };
    const A = attitudeAt(s, 800), d = nominalDirections(s.sc.align);
    closeArr(AM.m.mulv(A.CBI, AM.v.unit(AM.v.scale(A.st.r, -1))), d.nadir, 2e-3, ref + ' nadir');
    closeArr(AM.m.mulv(A.CBI, AM.v.unit(AM.v.cross(A.st.r, A.st.v))), d.normal, 1e-9, ref + ' normal');
  }
});

test('offsets are applied on top of the nominal attitude', () => {
  const s = state('offsets'); s.sc.align = { ref: 'lvlh', mode: 'axes', x: '-Z', y: '+X' }; s.orbit.roll = 25;
  const A = attitudeAt(s, 500); const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]);
  close(Math.acos(-AM.v.dot(zI, AM.v.unit(A.st.r))) * AM.R2D, 25, 1e-9);
});

test('sun mode: chosen axis points exactly at the Sun', () => {
  const s = state('sun'); s.orbit.sunAxis = '-Z';
  const A = attitudeAt(s, 1000);
  closeArr(AM.m.mulv(A.CBI, A.sun), [0, 0, -1], 1e-12);
});

test('inertial mode uses the Rotation Lab quaternion', () => {
  const s = state('inertial'); s.rot.q = AM.axisAngle2q([0, 1, 0], 0.7);
  closeArr(attitudeAt(s, 0).CBI, AM.q2C(s.rot.q), 1e-15);
  closeArr(bodyRate(s, 10), [0, 0, 0], 1e-12);
});

test('target mode: boresight on the target when visible', () => {
  const s = state('target'); let seen = 0;
  for (let t = 0; t < 86400; t += 30) {
    const A = attitudeAt(s, t);
    if (A.flag && !A.flag.below) { seen++; const pc = payloadComp(s); const bI = AM.m.mulv(AM.m.T(A.CBI), compAxis(pc)); assert.ok(AM.v.norm(bI) > 0.99); }
  }
  assert.ok(seen > 0, 'target visible at least once per day');
});

test('timeline: SSO 10:30 has ~35 % eclipse and caches', () => {
  const s = state('offsets'); const tl = computeTimeline(s, 1, null, 180);
  const ecl = tl.stats[tl.rows.findIndex(r => r.kind === 'ecl')];
  assert.ok(ecl > 30 && ecl < 40, 'eclipse % ' + ecl);
  assert.equal(computeTimeline(s, 1, tl, 180), tl, 'cached');
  assert.notEqual(computeTimeline(s, 2, tl, 180), tl, 'invalidated by scVersion');
});

/* ---------------- orbit definitions ---------------- */
import { switchDefinition, restartFromState, epochDate, parseEpoch, formatEpoch, definitionError } from '../src/sim/scenario.js';
import * as ENV2 from '../src/env/index.js';

const posAt = (o, t) => ENV2.propagate(orbitElements(o), t, o.j2).r;

test('switching elements → r,v → elements keeps the orbit', () => {
  const s = state('offsets'); s.orbit.hp = 500; s.orbit.ha = 900; s.orbit.argp = 40; s.orbit.nu0 = 75;
  const before = [0, 3000, 50000].map(t => posAt(s.orbit, t));
  switchDefinition(s.orbit, 'rv'); assert.equal(s.orbit.def, 'rv');
  [0, 3000, 50000].forEach((t, k) => close(AM.v.norm(AM.v.sub(posAt(s.orbit, t), before[k])), 0, 1e-3, 'rv t=' + t));
  switchDefinition(s.orbit, 'elements');
  [0, 3000, 50000].forEach((t, k) => close(AM.v.norm(AM.v.sub(posAt(s.orbit, t), before[k])), 0, 0.05, 'elements t=' + t));
});

test('restart from the current state continues the same trajectory (with J2)', () => {
  const s = state('offsets'); s.orbit.j2 = true;
  const t0 = 4321.5, ahead = 2000, want = posAt(s.orbit, t0 + ahead), d0 = epochDate(s.orbit).getTime();
  restartFromState(s.orbit, t0);
  assert.equal(s.orbit.def, 'rv'); assert.equal(s.orbit.t, 0);
  close(epochDate(s.orbit).getTime() - d0, t0 * 1000, 1);
  close(AM.v.norm(AM.v.sub(posAt(s.orbit, ahead), want)), 0, 1e-3);
});

test('TLE definition: epoch and elements come from the TLE', () => {
  const s = state('offsets'); s.orbit.def = 'tle';
  s.orbit.tle = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  assert.equal(definitionError(s.orbit), null);
  assert.equal(epochDate(s.orbit).toISOString(), '2008-09-20T12:25:40.104Z');
  close(orbitElements(s.orbit).i * AM.R2D, 51.6416, 1e-9);
  switchDefinition(s.orbit, 'elements'); // keeps the TLE epoch as the scenario epoch
  assert.equal(s.orbit.epoch, '2008-09-20T12:25:40.104'); close(s.orbit.i, 51.6416, 1e-9);
});

test('epochs with seconds; definition errors', () => {
  assert.equal(parseEpoch('2026-10-05T10:00').toISOString(), '2026-10-05T10:00:00.000Z');
  assert.equal(parseEpoch('2026-10-05T10:00:07.25').toISOString(), '2026-10-05T10:00:07.250Z');
  assert.equal(parseEpoch('nonsense'), null);
  assert.equal(formatEpoch(new Date('2026-10-05T10:00:00Z')), '2026-10-05T10:00');
  const o = { def: 'rv', r: [7000, 0, 0], v: [0, 12, 0] }; assert.match(definitionError(o), /escape/);
  o.v = [0, 5, 0]; assert.match(definitionError(o), /below the surface/);
});
