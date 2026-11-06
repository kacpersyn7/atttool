import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import * as ENV from '../src/env/index.js';
import { close, closeArr } from './helpers.js';
import { attitudeAt, bodyRate, blendAttitude, scheduleOrder } from '../src/sim/guidance.js';
import { addChange, deleteChange, setChangeMode, setChangeStart, takeRotation, DEFAULT_SLEW } from '../src/sim/schedule.js';
import { computeTimeline, timelineKey } from '../src/sim/timeline.js';
import { pointing } from '../src/sim/payload.js';
import { applyPreset, currentDate, epochDate, restartFromState, setEpoch, targetECEF } from '../src/sim/scenario.js';
import { MAX_CHANGES, addScenario, cleanSchedule, exportScenario, importScenario, scenarioData, selectScenario } from '../src/sim/scenarioLibrary.js';
import { defaultState, migrate } from '../src/state/store.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const fresh = () => { const s = defaultState(); migrate(s); s.orbit.t = 0; return s; };
/** UTC of t seconds after the epoch of s, in the epoch format. */
const at = (s, t) => new Date(epochDate(s.orbit).getTime() + t * 1000).toISOString().slice(0, 19);
const qz = deg => ({ w: Math.cos(deg / 2 * D2R), x: 0, y: 0, z: Math.sin(deg / 2 * D2R) });
/** Rotation angle between two attitude matrices (deg). */
const angleBetween = (A, B) => { const d = AM.m.mul(A, AM.m.T(B)); return Math.acos(Math.max(-1, Math.min(1, (d[0][0] + d[1][1] + d[2][2] - 1) / 2))) * R2D; };
/** Inertial at 0°, then a change at t = 600 s to inertial at 90° about Z, slewing over 60 s. */
function inertialPair(slew = 60) {
  const s = fresh(); Object.assign(s.orbit, { mode: 'inertial' }); s.rot.q = qz(0);
  s.orbit.schedule = [{ id: 'a', start: at(s, 600), slew, mode: 'inertial', q: qz(90) }];
  return s;
}

test('slerp: endpoints, the short way round, constant angle per step', () => {
  const a = qz(10), b = qz(70);
  closeArr(Object.values(AM.q.slerp(a, b, 0)), Object.values(a), 1e-12); closeArr(Object.values(AM.q.slerp(a, b, 1)), Object.values(b), 1e-12);
  const half = AM.q.slerp(a, AM.q.neg(b), 0.5); close(Math.abs(half.w), Math.cos(20 * D2R), 1e-12, 'b and −b are the same attitude: 40°, not 320°');
  const C = f => AM.q2C(AM.q.slerp(a, b, f)); for (const f of [0.1, 0.25, 0.6]) close(angleBetween(C(f), C(0)), 60 * f, 1e-9);
  close(angleBetween(blendAttitude(AM.q2C(a), AM.q2C(b), 0.5), AM.q2C(qz(40))), 0, 1e-6);
});

test('schedule: no changes flies exactly the initial settings', () => {
  const s = fresh(), A = attitudeAt(s, 1234); assert.equal(A.seg, null); assert.equal(A.g, s.orbit);
  s.orbit.schedule = []; closeArr(attitudeAt(s, 1234).CBI, A.CBI, 0);
});

test('schedule: the change in force at each time, with the boundaries; the slew ends exactly on the new attitude', () => {
  const s = inertialPair(), C0 = AM.q2C(qz(0)), C90 = AM.q2C(qz(90));
  assert.equal(attitudeAt(s, 599).seg, null); closeArr(attitudeAt(s, 599).CBI, C0, 1e-12);
  const at600 = attitudeAt(s, 600); assert.equal(at600.seg.id, 'a'); assert.equal(at600.seg.slew, 0); closeArr(at600.CBI, C0, 1e-12, 'a slew starts from the old attitude');
  close(angleBetween(attitudeAt(s, 630).CBI, C0), 45, 1e-9, 'halfway'); close(attitudeAt(s, 630).seg.slew, 0.5, 1e-12);
  assert.deepEqual(attitudeAt(s, 660).CBI, C90, 'ends exactly on it'); assert.equal(attitudeAt(s, 660).seg.slew, null);
  assert.deepEqual(attitudeAt(s, 5000).CBI, C90);
  const z = inertialPair(0); assert.deepEqual(attitudeAt(z, 600).CBI, C90, 'slew 0: a jump');
});

test('schedule: a 90° slew over 60 s turns at 1.5°/s about the slew axis; nothing turns outside it', () => {
  const s = inertialPair();
  // bodyRate differences over 1 s, so it reads sin(1.5°) per second: 1.49983°/s
  const want = Math.sin(1.5 * D2R) * R2D;
  for (const t of [605, 630, 650]) { const w = bodyRate(s, t); close(Math.hypot(...w) * R2D, want, 1e-9, `t=${t}`); close(Math.abs(w[2]) * R2D, want, 1e-9, 'about Z'); }
  for (const t of [100, 598, 700]) close(Math.hypot(...bodyRate(s, t)), 0, 1e-12, `t=${t}`);
});

test('schedule: a change during the slew of the one before blends from it; the attitude never jumps', () => {
  const s = inertialPair(); s.orbit.schedule.push({ id: 'b', start: at(s, 630), slew: 60, mode: 'inertial', q: qz(-30) });
  assert.ok(angleBetween(attitudeAt(s, 629.999).CBI, attitudeAt(s, 630).CBI) < 1.5 * 0.001 + 1e-6, 'continuous at its start: only the 1 ms of turning at 1.5°/s');
  close(angleBetween(attitudeAt(s, 630).CBI, AM.q2C(qz(45))), 0, 1e-5, 'starts from the first slew, halfway'); // acos of the trace: good to ~1e-6° near 0
  close(angleBetween(attitudeAt(s, 690).CBI, AM.q2C(qz(-30))), 0, 0, 'ends on its own attitude');
});

test('schedule: list order does not matter; equal starts: the later in the list wins; unreadable starts are skipped', () => {
  const s = inertialPair(0); const e = { start: at(s, 300), slew: 0, mode: 'inertial' };
  s.orbit.schedule = [{ ...e, id: 'late', start: at(s, 900), q: qz(20) }, { ...e, id: 'x', q: qz(5) }, { ...e, id: 'y', q: qz(7) }, { ...e, id: 'bad', start: 'soon', q: qz(99) }];
  assert.deepEqual(scheduleOrder(s.orbit.schedule).map(o => s.orbit.schedule[o.i].id), ['x', 'y', 'late']);
  assert.equal(attitudeAt(s, 400).seg.id, 'y'); assert.equal(attitudeAt(s, 1000).seg.id, 'late');
});

test('schedule: times are UTC, so moving the epoch or restarting from a state keeps the same change at the same moment', () => {
  const s = inertialPair(), utc = currentDate(s.orbit).getTime() + 630e3; s.orbit.t = 630;
  const before = attitudeAt(s, s.orbit.t);
  assert.equal(setEpoch(s.orbit, '2026-10-06T00:00'), true); assert.equal(currentDate(s.orbit).getTime(), utc);
  assert.equal(attitudeAt(s, s.orbit.t).seg.id, 'a'); close(attitudeAt(s, s.orbit.t).seg.slew, 0.5, 1e-9); close(angleBetween(attitudeAt(s, s.orbit.t).CBI, before.CBI), 0, 1e-9);
  restartFromState(s.orbit, s.orbit.t); assert.equal(s.orbit.t, 0); close(attitudeAt(s, 0).seg.slew, 0.5, 1e-9);
});

test('schedule: each change has its own target; pointing and the guidance use the one in force', () => {
  const s = fresh(); applyPreset(s.orbit, 'sso1030'); Object.assign(s.orbit, { mode: 'target', tgtLat: 0, tgtLon: 0, tgtAlt: 0 });
  // follow the ground track: a target under the spacecraft at t = 900 s, set by a change at 800 s
  const sub = ENV.ecef2ll(ENV.eci2ecef(attitudeAt(s, 900).st.r, attitudeAt(s, 900).date));
  s.orbit.schedule = [{ id: 'c', start: at(s, 800), slew: 0, mode: 'target', tgtLat: sub.lat * R2D, tgtLon: sub.lon * R2D, tgtAlt: 0 }];
  const A = attitudeAt(s, 900), p = pointing(s, A);
  assert.equal(A.g.tgtLat, sub.lat * R2D); closeArr(p.tgt, ENV.ecef2eci(targetECEF(A.g), A.date), 1e-9); close(p.ang, 0, 1e-6, 'tracking it');
  assert.ok(A.flag && !A.flag.below);
  closeArr(pointing(s, attitudeAt(s, 700)).tgt, ENV.ecef2eci(targetECEF(s.orbit), attitudeAt(s, 700).date), 1e-9, 'before it: the initial target');
});

test('schedule: a Sun axis naming a part that is not on this spacecraft falls back to +Z instead of failing', () => {
  const s = inertialPair(0); s.orbit.schedule[0] = { id: 'a', start: at(s, 600), slew: 0, mode: 'sun', sunAxis: 'comp:gone', sunSecAxis: '+X', sunSec: 'nadir' };
  const A = attitudeAt(s, 700); assert.ok(A.CBI.flat().every(Number.isFinite)); close(AM.v.dot(AM.m.mulv(A.CBI, A.sun), [0, 0, 1]), 1, 1e-9, '+Z on the Sun');
});

test('schedule: the timeline shows a mode band with the slews and recomputes when the schedule changes', () => {
  const s = fresh(); assert.ok(!computeTimeline(s, 0, null, 12).rows.some(r => r.kind === 'mode'), 'no band without a schedule');
  s.orbit.mode = 'offsets'; s.orbit.schedule = [{ id: 'a', start: at(s, 1200), slew: 600, mode: 'sun', sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir' }];
  const tl = computeTimeline(s, 0, null, 60), r = tl.rows.find(r => r.kind === 'mode'); assert.ok(r);
  const dt = tl.T / 60, code = t => r.v[Math.floor((t - tl.W0) / dt)];
  assert.equal(code(600), 0, 'nominal'); assert.equal(code(1500), 12, 'slewing into Sun'); assert.equal(code(2400), 2, 'Sun');
  assert.equal(tl.stats[tl.rows.indexOf(r)], null, 'no percentage for the mode band');
  const k = timelineKey(s, 0, 0); s.orbit.schedule = [{ ...s.orbit.schedule[0], slew: 30 }]; assert.notEqual(timelineKey(s, 0, 0), k);
});

test('schedule edits: a change starts from what flies now, at whole seconds; edits replace the array', () => {
  const s = fresh(); s.orbit.t = 100.7; const o = s.orbit, before = o.schedule;
  const c = addChange(o, o, s.rot.q); assert.equal(c.start, at(s, 100)); assert.equal(c.slew, DEFAULT_SLEW); assert.equal(c.mode, o.mode); assert.notEqual(o.schedule, before);
  closeArr(attitudeAt(s, 500).CBI, attitudeAt({ ...s, orbit: { ...o, schedule: [] } }, 500).CBI, 1e-12, 'nothing moves until it is edited');
  setChangeMode(c, 'inertial', qz(33)); assert.deepEqual(c.q, qz(33)); takeRotation(c, qz(44)); assert.deepEqual(c.q, qz(44));
  const c2 = addChange(o, c, qz(0)); assert.deepEqual(c2.q, qz(44), 'an inertial change keeps its own attitude'); assert.notEqual(c2.q, c.q, 'a copy');
  const arr = o.schedule; assert.equal(setChangeStart(o, c.id, '2300-01-01T00:00'), false); assert.equal(o.schedule, arr);
  assert.equal(setChangeStart(o, c.id, at(s, 50)), true); assert.notEqual(o.schedule, arr); assert.equal(o.schedule.find(x => x.id === c.id).start, at(s, 50));
  assert.equal(deleteChange(o, c.id), true); assert.equal(deleteChange(o, c.id), false); assert.equal(o.schedule.length, 1);
  o.schedule = Array.from({ length: MAX_CHANGES }, (_, i) => ({ id: 'n' + i, start: at(s, i), slew: 0, mode: 'offsets' })); assert.equal(addChange(o, o, s.rot.q), null, 'full');
});

test('schedule in scenarios: kept per scenario, never shared, cleaned on import, and through Copy JSON and Import', () => {
  const s = fresh(), a = s.scenarios.active; addScenario(s, scenarioData(s.orbit), 'B'); const b = s.scenarios.active;
  addChange(s.orbit, s.orbit, s.rot.q); selectScenario(s, a); assert.equal(s.orbit.schedule.length, 0, 'B has it, A does not');
  // two parked old saves get their own arrays
  const old = fresh(); addScenario(old, scenarioData(old.orbit), 'P'); addScenario(old, scenarioData(old.orbit), 'Q');
  for (const it of old.scenarios.items) if (it.data) delete it.data.schedule;
  migrate(old); const parked = old.scenarios.items.filter(i => i.data).map(i => i.data.schedule); assert.equal(parked.length, 2); assert.notEqual(parked[0], parked[1]);
  // round trip
  selectScenario(s, b); const json = JSON.parse(JSON.stringify(exportScenario(s))), t = fresh(); importScenario(t, json, scenarioData(defaultState().orbit));
  assert.deepEqual(t.orbit.schedule, s.orbit.schedule);
  // cleaning: dropped, defaulted, made unique, limited
  const c = cleanSchedule([{ id: 'x', start: at(s, 1), mode: 'sun', slew: 9999, roll: 'a' }, { id: 'x', start: at(s, 2), mode: 'inertial', q: { w: 2, x: 0, y: 0, z: 0 } }, { start: 'soon', mode: 'sun' }, { start: at(s, 3), mode: 'warp' }], s.orbit);
  assert.equal(c.length, 2); assert.equal(c[0].slew, 60); assert.equal(c[0].roll, s.orbit.roll); assert.notEqual(c[1].id, 'x'); close(AM.q.norm(c[1].q), 1, 1e-12);
  assert.equal(cleanSchedule(Array.from({ length: 300 }, (_, i) => ({ start: at(s, i), mode: 'sun' })), s.orbit).length, MAX_CHANGES);
});
