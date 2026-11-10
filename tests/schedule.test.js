import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import * as ENV from '../src/env/index.js';
import { close, closeArr } from './helpers.js';
import { attitudeAt, autoSlews, bodyRate, blendAttitude, changeTurn, payloadComp, relativeQ, scheduleOrder, tooFast } from '../src/sim/guidance.js';
import { AUTO_END_MARGIN, NAME_MAX, adjacentChange, cleanName, duplicateChange, nudgeChange, renameChange, scheduleHistory, addChange, deleteChange, runProgress, runStep, scenarioSpan, scheduleNotes, setChangeMode, setChangeStart, startRun, takeRotation, DEFAULT_SLEW } from '../src/sim/schedule.js';
import { computeTimeline, timelineKey } from '../src/sim/timeline.js';
import { pointing } from '../src/sim/payload.js';
import { advanceTime, applyPreset, currentDate, epochDate, orbitElements, parseEpoch, restartFromState, setEpoch, targetECEF } from '../src/sim/scenario.js';
import { MAX_CHANGES, addScenario, cleanSchedule, exportScenario, importScenario, scenarioData, selectScenario } from '../src/sim/scenarioLibrary.js';
import { defaultState, migrate } from '../src/state/store.js';
import { signalCatalog } from '../src/sim/signals.js';
import { sanitizeSpacecraft } from '../src/spacecraft/component.js';
import { addSpacecraft, selectSpacecraft, validateAxes } from '../src/spacecraft/library.js';
import { sensorEval } from '../src/sim/sensors.js';

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

test('schedule: a half turn (Sun on −Z, then on +Z) turns one way all through the slew, at 180°/60 s', () => {
  const s = fresh(); Object.assign(s.orbit, { mode: 'sun', sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir' });
  s.orbit.schedule = [{ id: 'h', start: at(s, 600), slew: 60, mode: 'sun', sunAxis: '+Z', sunSecAxis: '+X', sunSec: 'nadir' }];
  let prev = attitudeAt(s, 600).CBI, worst = 0;
  for (let t = 600.5; t <= 660; t += 0.5) { const C = attitudeAt(s, t).CBI; worst = Math.max(worst, angleBetween(C, prev)); prev = C; }
  assert.ok(worst < 3 * 0.5 + 0.05, `largest step ${worst}° per 0.5 s (3°/s plus the Sun and nadir drift)`);
  const C = attitudeAt(s, 660).CBI; close(AM.v.dot(AM.m.mulv(C, attitudeAt(s, 660).sun), [0, 0, 1]), 1, 1e-9, 'ends with +Z on the Sun');
});

test('schedule: a slew between two moving attitudes (Sun pointing into nominal) is continuous and ends on the nominal one', () => {
  const s = fresh(); Object.assign(s.orbit, { mode: 'sun', sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir' });
  s.orbit.schedule = [{ id: 'n', start: at(s, 900), slew: 120, mode: 'offsets', roll: 0, pitch: 0, yaw: 0 }];
  const full = angleBetween(attitudeAt(s, 900).CBI, attitudeAt({ ...s, orbit: { ...s.orbit, mode: 'offsets', roll: 0, pitch: 0, yaw: 0, schedule: [] } }, 900).CBI);
  let prev = attitudeAt(s, 900).CBI, worst = 0;
  for (let t = 901; t <= 1020; t += 1) { const C = attitudeAt(s, t).CBI; worst = Math.max(worst, angleBetween(C, prev)); prev = C; }
  assert.ok(worst < full / 120 + 0.2, `largest step ${worst}°/s for a ${full.toFixed(1)}° slew`);
  assert.deepEqual(attitudeAt(s, 1020).CBI, attitudeAt(s, 1020).CNI, 'zero offsets: exactly the nominal attitude');
});

test('relativeQ: the short way, unless the reference picks the other side of a half turn', () => {
  const A = AM.q2C(qz(0)), B = AM.q2C(qz(180)), q = relativeQ(A, B), r = relativeQ(A, B, AM.q.neg(q));
  close(Math.abs(q.z), 1, 1e-12); assert.equal(Math.sign(r.z), -Math.sign(q.z), 'the side of the reference');
  close(relativeQ(A, AM.q2C(qz(-170))).w, Math.cos(85 * D2R), 1e-12, '170° the short way, not 190°');
  closeArr(blendAttitude(A, B, 1, q), B, 1e-12);
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

test('schedule: a Sun axis naming a part that is not on this spacecraft falls back like the spacecraft defaults (−Z on the Sun)', () => {
  const s = inertialPair(0); s.orbit.schedule[0] = { id: 'a', start: at(s, 600), slew: 0, mode: 'sun', sunAxis: 'comp:gone', sunSecAxis: '+X', sunSec: 'nadir' };
  const A = attitudeAt(s, 700); assert.ok(A.CBI.flat().every(Number.isFinite)); close(AM.v.dot(AM.m.mulv(A.CBI, A.sun), [0, 0, -1]), 1, 1e-9, '−Z on the Sun, as validateAxes resets the initial settings');
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
  const c = addChange(o, o, s.rot.q); assert.equal(c.start, at(s, 100)); assert.equal(c.autoSlew, true, 'a new change slews automatically'); assert.equal(c.slew, 0, 'until it is worked out'); assert.equal(c.mode, o.mode); assert.notEqual(o.schedule, before);
  closeArr(attitudeAt(s, 500).CBI, attitudeAt({ ...s, orbit: { ...o, schedule: [] } }, 500).CBI, 1e-12, 'nothing moves until it is edited');
  setChangeMode(c, 'inertial', qz(33)); assert.deepEqual(c.q, qz(33)); takeRotation(c, qz(44)); assert.deepEqual(c.q, qz(44));
  const c2 = addChange(o, c, qz(0)); assert.deepEqual(c2.q, qz(44), 'an inertial change keeps its own attitude'); assert.notEqual(c2.q, c.q, 'a copy');
  const arr = o.schedule; assert.equal(setChangeStart(o, c.id, '2300-01-01T00:00'), false); assert.equal(o.schedule, arr);
  assert.equal(setChangeStart(o, c.id, at(s, 50)), true); assert.notEqual(o.schedule, arr); assert.equal(o.schedule.find(x => x.id === c.id).start, at(s, 50));
  assert.equal(deleteChange(o, c.id), true); assert.equal(deleteChange(o, c.id), false); assert.equal(o.schedule.length, 1);
  // during a slew the new change starts when the slew ends, so the turn already under way stays as it was
  const p = inertialPair(); p.orbit.t = 620; const A = attitudeAt(p, 620), want = attitudeAt(p, 640).CBI, wantRate = Math.hypot(...bodyRate(p, 625));
  const late = addChange(p.orbit, A.g, p.rot.q); assert.equal(parseEpoch(late.start).getTime(), parseEpoch(at(p, 660)).getTime(), 'at the end of the slew'); closeArr(attitudeAt(p, 640).CBI, want, 1e-12); close(Math.hypot(...bodyRate(p, 625)), wantRate, 1e-12);
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
  const long = cleanSchedule(['1', '2'].map(k => ({ id: 'a'.repeat(40) + k, start: at(s, 5), mode: 'sun' })), s.orbit); assert.notEqual(long[0].id, long[1].id, 'unique after trimming');
  const qi = cleanSchedule([{ start: at(s, 5), mode: 'inertial', q: 'x' }], s.orbit, qz(30)); assert.deepEqual(qi[0].q, AM.q.unit(qz(30)), 'the scenario inertial attitude');
  assert.deepEqual(cleanSchedule([{ start: at(s, 5), mode: 'inertial' }], s.orbit)[0].q, AM.q.id(), 'else the identity: never Rotation Lab at the moment');
});

test('schedule: the turn a change asks for at its start, and its mean rate (90° in 60 s = 1.5°/s)', () => {
  const s = inertialPair(); const tr = changeTurn(s, 'a'); close(tr.angle, 90, 1e-6); close(tr.rate, 1.5, 1e-8);
  assert.equal(changeTurn(inertialPair(0), 'a').rate, null, 'slew 0: a jump'); assert.equal(changeTurn(s, 'nope'), null);
  // a change during the slew before it turns from that slew: halfway, 45° are left
  s.orbit.schedule.push({ id: 'b', start: at(s, 630), slew: 30, mode: 'inertial', q: qz(90) }); close(changeTurn(s, 'b').angle, 45, 1e-6); close(changeTurn(s, 'b').rate, 1.5, 1e-8);
  // the half turn reads 180°
  const h = fresh(); Object.assign(h.orbit, { mode: 'sun', sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir' });
  h.orbit.schedule = [{ id: 'h', start: at(h, 600), slew: 60, mode: 'sun', sunAxis: '+Z', sunSecAxis: '+X', sunSec: 'nadir' }]; close(changeTurn(h, 'h').angle, 180, 1e-6);
});

test('schedule notes: a change that starts during the slew before it, and changes with the same start', () => {
  const s = inertialPair(); const o = s.orbit;
  assert.deepEqual(scheduleNotes(o), {});
  o.schedule = [...o.schedule, { id: 'b', start: at(s, 630), slew: 60, mode: 'inertial', q: qz(0) }, { id: 'c', start: at(s, 900), slew: 0, mode: 'offsets' }, { id: 'd', start: at(s, 900), slew: 0, mode: 'sun' }];
  assert.deepEqual(scheduleNotes(o), { b: ['overlap'], c: ['overridden'], d: ['tie'] }, 'c never flies: d, later in the list, starts with it');
  o.schedule = [{ id: 'p', start: at(s, 100), slew: 600, mode: 'offsets' }, ...['x', 'y', 'z'].map(id => ({ id, start: at(s, 300), slew: 0, mode: 'sun' }))];
  assert.deepEqual(scheduleNotes(o), { x: ['overridden'], y: ['overridden'], z: ['tie', 'overlap'] }, 'three at once: each note once; the one that flies is checked against what flew before');
  o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'offsets' }, { id: 'b', start: at(s, 660), slew: 0, mode: 'offsets' }];
  assert.deepEqual(scheduleNotes(o), {}, 'starting just as the slew ends is fine');
});

test('schedule edits: moving a start keeps the change object (the controls stay bound to it), replaces the array', () => {
  const s = inertialPair(), o = s.orbit, c = o.schedule[0], arr = o.schedule;
  assert.equal(setChangeStart(o, 'a', at(s, 1200)), true); assert.equal(o.schedule[0], c); assert.notEqual(o.schedule, arr); assert.equal(c.start, at(s, 1200));
});

test('schedule: changes at the same moment: only the last flies, and it slews from what flew before, not from the ones it overrides', () => {
  const s = inertialPair(); // 0°, then 90° at 600 s over 60 s
  s.orbit.schedule = [{ id: 'lose', start: at(s, 600), slew: 0, mode: 'inertial', q: qz(170) }, { id: 'win', start: at(s, 600), slew: 60, mode: 'inertial', q: qz(90) }];
  close(angleBetween(attitudeAt(s, 630).CBI, AM.q2C(qz(45))), 0, 1e-5, 'halfway from 0° to 90°: the 170° one never flew');
  assert.deepEqual(changeTurn(s, 'lose'), { overridden: true }); close(changeTurn(s, 'win').angle, 90, 1e-6);
});

test('changeTurn: from initial inertial settings (Rotation Lab), and into target tracking while the target is below the horizon', () => {
  const s = inertialPair(); s.rot.q = qz(-30); close(changeTurn(s, 'a').angle, 120, 1e-6, 'from Rotation Lab −30° to 90°');
  const t = fresh(); applyPreset(t.orbit, 'sso1030'); Object.assign(t.orbit, { mode: 'offsets', roll: 20, pitch: 0, yaw: 0 });
  t.orbit.schedule = [{ id: 'g', start: at(t, 600), slew: 60, mode: 'target', tgtLat: -80, tgtLon: 0, tgtAlt: 0 }];
  assert.ok(attitudeAt(t, 700).flag.below, 'set up: the target is below the horizon');
  close(changeTurn(t, 'g').angle, 20, 1e-6, 'it holds the nominal attitude: the 20° roll comes off');
});

test('schedule: a chain of overlapping slews stays cheap (each change worked out once per time)', () => {
  const s = inertialPair(); s.orbit.schedule = Array.from({ length: 40 }, (_, k) => ({ id: 'c' + k, start: at(s, 600 + k), slew: 3600, mode: 'inertial', q: qz(k * 7) }));
  const t0 = performance.now(); for (let n = 0; n < 20; n++) attitudeAt(s, 1000 + n); changeTurn(s, 'c39');
  assert.ok(performance.now() - t0 < 500, `${(performance.now() - t0).toFixed(0)} ms for 20 samples of a 40-deep chain`);
});

test('schedule: each change has its own pointing payload; tracking, pointing and the timeline use the one flying', () => {
  const s = fresh(); applyPreset(s.orbit, 'sso1030');
  const cam = s.sc.comps.find(c => c.type === 'payload'), q90 = AM.q.unit({ w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 }); // the second camera looks along body ±Y
  const cam2 = { ...structuredClone(cam), id: 'cam2', name: 'Side cam', q: q90 }; s.sc.comps.push(cam2);
  const sub = ENV.ecef2ll(ENV.eci2ecef(attitudeAt(s, 900).st.r, attitudeAt(s, 900).date));
  Object.assign(s.orbit, { mode: 'target', tgtComp: cam.id, tgtLat: sub.lat * R2D, tgtLon: sub.lon * R2D, tgtAlt: 0 });
  s.orbit.schedule = [{ id: 'side', start: at(s, 850), slew: 0, mode: 'target', tgtComp: 'cam2', tgtLat: sub.lat * R2D, tgtLon: sub.lon * R2D, tgtAlt: 0 }];
  assert.equal(payloadComp(s).id, cam.id, 'the initial settings keep theirs'); assert.equal(payloadComp(s, s.orbit.schedule[0]).id, 'cam2');
  const A = attitudeAt(s, 900), p = pointing(s, A); assert.equal(p.c.id, 'cam2', 'pointing uses the payload flying'); close(p.ang, 0, 1e-6, 'the side camera is on the target');
  const bore = AM.m.mulv(AM.m.T(A.CBI), AM.m.mulv(AM.m.T(AM.q2C(cam2.q)), [0, 0, 1])); close(AM.v.dot(bore, AM.v.unit(AM.v.sub(p.tgt, A.st.r))), 1, 1e-9);
  assert.equal(pointing(s, attitudeAt(s, 800)).c.id, cam.id, 'before the change: the first camera');
  const tl = computeTimeline(s, 0, null, 12); assert.equal(tl.rows.find(r => r.kind === 'pl').name, 'Payload on ground', 'two payloads in the schedule');
  s.orbit.schedule[0].tgtComp = cam.id; assert.equal(computeTimeline(s, 0, null, 12).rows.find(r => r.kind === 'pl').name, cam.name + ' on ground');
  s.orbit.schedule[0].tgtComp = 'gone'; assert.equal(payloadComp(s, s.orbit.schedule[0]).id, cam.id, 'a part that is not there: the first payload camera');
});

/** A scenario whose spacecraft has a second camera looking along body Y, and the ground point under it at t = 900 s. */
function twoCameras() {
  const s = fresh(); applyPreset(s.orbit, 'sso1030');
  const cam = s.sc.comps.find(c => c.type === 'payload'), cam2 = { ...structuredClone(cam), id: 'cam2', name: 'Side cam', q: AM.q.unit({ w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 }) };
  s.sc.comps.push(cam2); const A = attitudeAt(s, 900), ll = ENV.ecef2ll(ENV.eci2ecef(A.st.r, A.date));
  return { s, cam, cam2, lat: ll.lat * R2D, lon: ll.lon * R2D };
}

test('old saves: a change without its own payload keeps flying the one its scenario had', () => {
  const { s } = twoCameras(); s.orbit.tgtComp = 'cam2'; s.orbit.schedule = [{ id: 'old', start: at(s, 600), slew: 0, mode: 'target', tgtLat: 0, tgtLon: 0, tgtAlt: 0 }];
  addScenario(s, { ...scenarioData(s.orbit), schedule: [{ id: 'p', start: at(s, 600), slew: 0, mode: 'sun' }] }, 'Parked'); selectScenario(s, s.scenarios.items[0].id);
  migrate(s);
  assert.equal(s.orbit.schedule[0].tgtComp, 'cam2'); assert.equal(payloadComp(s, s.orbit.schedule[0]).id, 'cam2');
  assert.equal(s.scenarios.items.find(i => i.data).data.schedule[0].tgtComp, 'cam2', 'parked scenarios too'); assert.equal(s.scenarios.items.find(i => i.data).data.schedule[0].sunSec, s.orbit.sunSec);
  assert.equal(cleanSchedule([{ start: at(s, 5), mode: 'target' }], { ...s.orbit, tgtComp: 'cam2' })[0].tgtComp, 'cam2', 'import: from its scenario');
});

test('a payload chosen only on a change still gets its plots and timeline row; the row follows the payload flying', () => {
  const { s, lat, lon } = twoCameras(); s.sc.comps = s.sc.comps.filter(c => c.type !== 'payload'); // no payload camera: only the change picks a part
  const str = s.sc.comps.find(c => c.type === 'str');
  Object.assign(s.orbit, { mode: 'offsets', tgtComp: '' }); assert.equal(payloadComp(s), null);
  s.orbit.schedule = [{ id: 'c', start: at(s, 850), slew: 0, mode: 'target', tgtComp: str.id, tgtLat: lat, tgtLon: lon, tgtAlt: 0 }];
  assert.ok(signalCatalog(s).some(x => x.id === 'plAng'), 'pointing-error signals');
  const tl = computeTimeline(s, 0, null, 120), r = tl.rows.find(x => x.kind === 'pl'); assert.ok(r, 'on-ground row'); assert.equal(r.name, str.name + ' on ground');
  const val = t => r.v[Math.floor((t - tl.W0) / (tl.T / 120))];
  assert.equal(val(600), 0, 'before the change: no payload flies');
  close(pointing(s, attitudeAt(s, 900)).ang, 0, 1e-6, 'the star tracker boresight is on the target'); assert.equal(val(900), sensorEval(str, attitudeAt(s, 900)).onGround ? 1 : 0);
});

test('parts: a change keeps its parts while the spacecraft is switched, and forgets a part that is deleted', () => {
  const { s } = twoCameras(); s.orbit.schedule = [{ id: 'c', start: at(s, 600), slew: 0, mode: 'sun', tgtComp: 'cam2', sunAxis: 'comp:cam2', sunSecAxis: '+X', sunSec: 'nadir' }];
  const a = s.fleet.active; addSpacecraft(s, structuredClone(s.sc), 'Other'); // a copy: its parts get the same ids? check below
  selectSpacecraft(s, a); assert.equal(s.orbit.schedule[0].tgtComp, 'cam2', 'kept across a switch and back');
  s.sc.comps = s.sc.comps.filter(c => c.id !== 'cam2'); validateAxes(s);
  assert.equal(s.orbit.schedule[0].tgtComp, ''); assert.equal(s.orbit.schedule[0].sunAxis, '-Z', 'reset like the initial settings');
});

/** A target tracking pass: the scenario, and the rise and set times (s) of its target, found by bisection on the elevation. */
function pass(slew = 60, preset = 'sso1030', t1 = 900) {
  const s = fresh(); applyPreset(s.orbit, preset);
  const A = attitudeAt(s, t1), ll = ENV.ecef2ll(ENV.eci2ecef(A.st.r, A.date)); // the target is under the spacecraft at t1
  Object.assign(s.orbit, { mode: 'target', tgtLat: ll.lat * R2D, tgtLon: ll.lon * R2D + 3, tgtAlt: 0, tgtSlew: slew });
  const up = t => attitudeAt(s, t).flag.elev > 0, cross = (a, b) => { for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (up(m) === up(b)) b = m; else a = m; } return b; };
  let r = t1; while (up(r)) r -= 10; let e = t1; while (up(e)) e += 10;
  return { s, rise: cross(r, r + 10), set: cross(e - 10, e) };
}

test('target tracking: slews to the target over its slew time before it rises, and is tracking exactly at the rise', () => {
  const { s, rise } = pass(60), C = t => attitudeAt(s, t);
  assert.ok(rise > 100, 'set up: a real pass');
  assert.deepEqual(C(rise - 60.01).CBI, C(rise - 60.01).CNI, 'before the slew: exactly the nominal hold');
  const mid = C(rise - 30).flag.slew; assert.ok(mid.rising); close(mid.w, 0.5, 1e-3); close(mid.dt, 30, 0.01); // rise found to ~1 ms
  close(angleBetween(C(rise - 0.001).CBI, C(rise + 0.001).CBI), 0, 0.01, 'no jump at the rise: tracking already');
  const z = pass(0); assert.deepEqual(attitudeAt(z.s, z.rise - 1).CBI, attitudeAt(z.s, z.rise - 1).CNI, 'slew 0: the old jump');
  assert.ok(angleBetween(attitudeAt(z.s, z.rise - 0.001).CBI, attitudeAt(z.s, z.rise + 0.001).CBI) > 5, 'which is a real jump here');
});

test('target tracking: slews back to the nominal attitude over its slew time after the target sets', () => {
  const { s, set } = pass(60), C = t => attitudeAt(s, t);
  close(angleBetween(C(set - 0.001).CBI, C(set + 0.001).CBI), 0, 0.01, 'no jump at the set');
  const mid = C(set + 30).flag.slew; assert.equal(mid.rising, false); close(mid.w, 0.5, 1e-3);
  assert.deepEqual(C(set + 60.01).CBI, C(set + 60.01).CNI, 'then the nominal hold again');
});

test('target tracking: no steps anywhere around a pass, in 1 s samples', () => {
  const { s, rise, set } = pass(60);
  let prev = attitudeAt(s, rise - 90).CBI, worst = 0, at = 0;
  for (let t = rise - 89; t <= set + 90; t += 1) { const C = attitudeAt(s, t).CBI, d = angleBetween(C, prev); if (d > worst) { worst = d; at = t; } prev = C; }
  // the fastest turn is tracking at closest approach (a few °/s at 550 km); a jump would be tens of degrees
  assert.ok(worst < 6, `largest step ${worst.toFixed(2)}° at t=${at.toFixed(0)}`);
});

test('target tracking: the rise and set slews happen on very different orbits too (the search is never skipped wrongly)', () => {
  for (const [preset, t1, slew] of [['iss', 900, 120], ['polar', 1500, 300], ['molniya', 30000, 600], ['gto', 20000, 600], ['meo', 5000, 600]]) {
    const { s, rise, set } = pass(slew, preset, t1), C = t => attitudeAt(s, t);
    const r = C(rise - slew / 2).flag.slew, f = C(set + slew / 2).flag.slew;
    assert.ok(r && r.rising, `${preset}: slewing before the rise`); close(r.w, 0.5, 2e-3, `${preset} rise`);
    assert.ok(f && !f.rising, `${preset}: slewing after the set`); close(f.w, 0.5, 2e-3, `${preset} set`);
    assert.deepEqual(C(rise - slew - 0.01).CBI, C(rise - slew - 0.01).CNI, `${preset}: holding before`);
  }
});

/** A grazing pass of 1 to 8 s: the target just inside the horizon, cross-track of the point under the spacecraft at 900 s (found by bisection on how far inside). */
function graze(slew) {
  const s = fresh(); applyPreset(s.orbit, 'sso1030'); Object.assign(s.orbit, { mode: 'target', tgtSlew: slew, tgtAlt: 0 });
  const A = attitudeAt(s, 900), r = AM.v.unit(A.st.r), h = AM.v.unit(AM.v.cross(A.st.r, A.st.v)), lam0 = Math.acos(ENV.RE / AM.v.norm(A.st.r));
  const place = inside => { const lam = lam0 - inside, dir = AM.v.add(AM.v.scale(r, Math.cos(lam)), AM.v.scale(h, Math.sin(lam))), ll = ENV.ecef2ll(ENV.eci2ecef(AM.v.scale(dir, ENV.RE), A.date)); Object.assign(s.orbit, { tgtLat: ll.lat * R2D, tgtLon: ll.lon * R2D }); };
  const measure = () => { let up = 0, first = null; for (let t = 780; t <= 1020; t += 0.1) if (attitudeAt(s, t).flag.elev > 0) { up += 0.1; if (first === null) first = t; } return { up, first }; };
  let lo = -0.01, hi = 0.01, m; // inside < 0: never up; large: a long pass
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; place(mid); m = measure(); if (m.up > 8) hi = mid; else if (m.up < 1) lo = mid; else break; }
  return { s, ...m };
}

test('target tracking: a pass shorter than the search step (a few seconds, grazing the horizon) is still found; no jumps', () => {
  const { s, up, first } = graze(60); assert.ok(up > 0.5 && up < 10, `set up: a ${up.toFixed(1)} s pass`);
  const f = attitudeAt(s, first - 30).flag.slew; assert.ok(f && f.rising, 'slewing to it 30 s before'); close(f.w, 0.5, 0.01);
  let prev = attitudeAt(s, first - 90).CBI, worst = 0; for (let t = first - 89.5; t <= first + 100; t += 0.5) { const C = attitudeAt(s, t).CBI; worst = Math.max(worst, angleBetween(C, prev)); prev = C; }
  assert.ok(worst < 3, `largest 0.5 s step ${worst.toFixed(2)}° (was 67° before the fix)`);
});

test('target tracking: only rises and sets while those settings fly count (a change looks no further back than its start)', () => {
  const { s, set } = pass(60); const T0 = set + 20; // a change into target mode 20 s after a set; nominal before it
  Object.assign(s.orbit, { mode: 'offsets', roll: 0, pitch: 0, yaw: 0 }); const tgt = { tgtLat: s.orbit.tgtLat, tgtLon: s.orbit.tgtLon, tgtAlt: 0, tgtSlew: 60 };
  s.orbit.schedule = [{ id: 'c', start: at(s, T0), slew: 0, mode: 'target', ...tgt }];
  const A = attitudeAt(s, T0 + 1); assert.deepEqual(A.CBI, A.CNI, 'no slew back from a set before it started'); assert.equal(A.flag.slew, undefined);
  close(changeTurn(s, 'c').angle, 0, 1e-6, 'nothing to turn');
  // and toward a rise: the initial settings in target mode, then a change back to nominal
  const q = pass(60); q.s.orbit.schedule = [{ id: 'n', start: at(q.s, q.rise + 30), slew: 0, mode: 'offsets', roll: 0, pitch: 0, yaw: 0 }];
  assert.equal(attitudeAt(q.s, q.rise - 30).flag.slew.rising, true, 'a rise before the next change counts');
  const r = pass(60); r.s.orbit.schedule = [{ id: 'n', start: at(r.s, r.rise - 50), slew: 0, mode: 'offsets', roll: 0, pitch: 0, yaw: 0 }];
  assert.equal(attitudeAt(r.s, r.rise - 55).flag.slew, undefined, 'a rise after the next change does not');
});

test('target tracking: the slew time is in the timeline key, defaults for old saves and imports, and bad values fall back', () => {
  const s = fresh(); const k = timelineKey(s, 0, 0); s.orbit.tgtSlew = 600; assert.notEqual(timelineKey(s, 0, 0), k);
  assert.equal(defaultState().orbit.tgtSlew, 60);
  const old = fresh(); delete old.orbit.tgtSlew; old.orbit.schedule = [{ id: 'c', start: at(old, 5), slew: 0, mode: 'target' }];
  const merged = { ...defaultState().orbit, ...old.orbit }; const t = { ...old, orbit: merged }; migrate(t); assert.equal(t.orbit.tgtSlew, 60); assert.equal(t.orbit.schedule[0].tgtSlew, 60, 'old changes too');
  for (const [v, want] of [[90, 90], [-5, 60], [1e9, 60], ['x', 60]]) assert.equal(cleanSchedule([{ start: at(s, 5), mode: 'target', tgtSlew: v }], { ...s.orbit, tgtSlew: 60 })[0].tgtSlew, want, String(v));
});

test('target tracking: the slew time is limited to 900 s (the search grows with it)', () => {
  const s = fresh(); assert.equal(cleanSchedule([{ start: at(s, 5), mode: 'target', tgtSlew: 901 }], { ...s.orbit, tgtSlew: 60 })[0].tgtSlew, 60);
  const p = pass(900), q = pass(5000); close(attitudeAt(q.s, q.rise - 450).flag.slew.w, attitudeAt(p.s, p.rise - 450).flag.slew.w, 1e-9, 'a larger value flies as 900 s');
});

test('scenario span: automatic end after the last slew + 5 min, one orbit without a schedule; a typed end wins if it is after the start', () => {
  const s = fresh(), o = s.orbit, T = 2 * Math.PI * Math.sqrt(orbitElements(o).a ** 3 / 398600.4418);
  let sp = scenarioSpan(o); assert.equal(sp.start, 0); close(sp.end, T, 1e-6, 'one orbit'); assert.equal(sp.auto, true);
  o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun' }, { id: 'b', start: at(s, 1800), slew: 120, mode: 'offsets' }, { id: 'c', start: at(s, 1850), slew: 0, mode: 'sun' }];
  sp = scenarioSpan(o); close(sp.end, 1850 + 0 + AUTO_END_MARGIN, 1e-6, 'the last change: its jump at 1850 cuts the slew of the one before');
  o.end = at(s, 7200); sp = scenarioSpan(o); close(sp.end, 7200, 1e-6); assert.equal(sp.auto, false); close(sp.autoEnd, 2150, 1e-6);
  o.end = at(s, -10); assert.equal(scenarioSpan(o).auto, true, 'before the start: automatic'); o.end = 'soon'; assert.equal(scenarioSpan(o).auto, true);
  o.end = ''; o.schedule = [{ id: 'early', start: at(s, -3000), slew: 0, mode: 'sun' }]; close(scenarioSpan(o).start, -3000, 1e-6, 'starts at a change before the epoch');
});

test('scenario run: starts at the start, stops at the end (or loops) when a playback step reaches it', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun' }]; o.t = 5000; o.playing = false;
  startRun(o); assert.equal(o.t, 0); assert.equal(o.run, true); assert.equal(o.playing, true); assert.equal(runProgress(o), 0);
  o.t = 480; close(runProgress(o), 0.5, 1e-9, 'halfway to 600 + 60 + 300'); assert.equal(runStep(o), false);
  o.t = 961; assert.equal(runStep(o, 950), true); assert.equal(o.t, 960); assert.equal(o.playing, false); assert.equal(o.run, false, 'stopped at the end');
  startRun(o); o.runLoop = true; o.t = 970; assert.equal(runStep(o, 955), true); assert.equal(o.t, 0); assert.equal(o.playing, true, 'looped');
  assert.equal(runProgress({ ...o, run: false }), null);
});

test('scenario end: kept in scenarios and JSON, cleaned on import', () => {
  const s = fresh(); s.orbit.end = at(s, 3600); const j = JSON.parse(JSON.stringify(exportScenario(s))); assert.equal(j.orbit.end, at(s, 3600));
  const t = fresh(); importScenario(t, j, scenarioData(defaultState().orbit)); assert.equal(t.orbit.end, at(s, 3600));
  for (const bad of ['soon', 7, '2300-01-01T00:00', null]) { const u = fresh(); importScenario(u, { kind: 'scenario', orbit: { ...j.orbit, end: bad } }, scenarioData(defaultState().orbit)); assert.equal(u.orbit.end, '', String(bad)); }
});

test('scenario run: a time already past the end (moved there) ends the run without pulling the time back', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun' }]; // end 960
  startRun(o); o.playing = false; o.t = 5000; o.playing = true; // paused, seeked past the end, Play
  assert.equal(runStep(o, 5000), true); assert.equal(o.t, 5000, 'the seek stays'); assert.equal(o.run, false); assert.equal(o.playing, true, 'and it plays on');
  startRun(o); o.runLoop = true; o.t = 3000; assert.equal(runStep(o, 2999), true); assert.equal(o.t, 3000, 'with Loop too: no jump to the start');
  startRun(o); o.t = 900; o.schedule = []; // the end moves to one orbit: still ahead
  assert.equal(runStep(o, 899), false); o.schedule = [{ id: 'a', start: at(s, 100), slew: 0, mode: 'sun' }]; // end 400, behind
  assert.equal(runStep(o, 900), true); assert.equal(o.t, 900, 'an end moved before the time: the time stays');
});

test('scenario run: at the last date (2200) it still stops, or loops; progress is defined when the end is the start', () => {
  const s = fresh(), o = s.orbit; o.epoch = '2199-12-31T23:00'; o.schedule = []; o.speed = 1000; // auto end clamps to the limit, 3600 s
  startRun(o); o.runLoop = true; o.t = 3500; let t0 = o.t; advanceTime(o, 1); assert.equal(o.playing, false, 'set up: the date limit paused it');
  assert.equal(runStep(o, t0), true); assert.equal(o.t, scenarioSpan(o).start); assert.equal(o.playing, true, 'looped');
  o.runLoop = false; o.t = 3500; t0 = o.t; advanceTime(o, 1); runStep(o, t0); assert.equal(o.run, false, 'ended');
  o.epoch = '2200-01-01T00:00'; o.t = 0; o.run = true; const sp = scenarioSpan(o); assert.equal(sp.end, sp.start); assert.equal(runProgress(o), 1);
});

test('scenario span: changes at the same moment: the one that flies sets the automatic end', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 600, mode: 'sun' }, { id: 'b', start: at(s, 600), slew: 0, mode: 'offsets' }];
  close(scenarioSpan(o).end, 600 + 0 + AUTO_END_MARGIN, 1e-6, 'a never flies');
});

test('names: kept trimmed and limited, through Copy JSON and Import; old changes without one still work', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun' }];
  assert.equal(attitudeAt(s, 700).g.name, undefined, 'none yet: flies as before');
  assert.equal(renameChange(o, 'a', '  Image Warsaw  '), true); assert.equal(o.schedule[0].name, 'Image Warsaw');
  renameChange(o, 'a', 'x'.repeat(99)); assert.equal(o.schedule[0].name.length, NAME_MAX); assert.equal(cleanName(7), ''); assert.equal(renameChange(o, 'nope', 'x'), false);
  renameChange(o, 'a', 'Downlink'); const j = JSON.parse(JSON.stringify(exportScenario(s))), t = fresh(); importScenario(t, j, scenarioData(defaultState().orbit));
  assert.equal(t.orbit.schedule[0].name, 'Downlink');
  assert.equal(cleanSchedule([{ start: at(s, 5), mode: 'sun', name: 'y'.repeat(99) }], o)[0].name.length, 40);
  assert.equal('name' in cleanSchedule([{ start: at(s, 5), mode: 'sun', name: '   ' }], o)[0], false, 'blank: no name');
});

test('names: the timeline band knows the name of the change flying at each sample', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 1200), slew: 0, mode: 'sun', name: 'Charge' }];
  const tl = computeTimeline(s, 0, null, 60), r = tl.rows.find(x => x.kind === 'mode'), dt = tl.T / 60;
  assert.equal(r.names[Math.floor(600 / dt)], '', 'initial: no name'); assert.equal(r.names[Math.floor(2000 / dt)], 'Charge');
});

test('duplicate and nudge: a copy at the current time (a minute later if that is the same moment); nudges move by whole minutes within the limits', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun', name: 'Charge', sunAxis: '+X' }]; o.t = 1000;
  const c = duplicateChange(o, 'a'); assert.notEqual(c.id, 'a'); assert.equal(parseEpoch(c.start).getTime(), parseEpoch(at(s, 1000)).getTime()); assert.equal(c.name, 'Charge'); assert.equal(c.sunAxis, '+X');
  o.t = 600; const d = duplicateChange(o, 'a'); assert.equal(parseEpoch(d.start).getTime(), parseEpoch(at(s, 660)).getTime(), 'same moment: a minute later');
  assert.equal(nudgeChange(o, 'a', 60), true); assert.equal(parseEpoch(o.schedule[0].start).getTime(), parseEpoch(at(s, 660)).getTime());
  assert.equal(nudgeChange(o, 'a', -120), true); assert.equal(parseEpoch(o.schedule[0].start).getTime(), parseEpoch(at(s, 540)).getTime());
  o.schedule[0].start = '2199-12-31T23:59:30'; assert.equal(nudgeChange(o, 'a', 60), false, 'past the last date: refused'); assert.equal(o.schedule[0].start, '2199-12-31T23:59:30');
  assert.equal(duplicateChange(o, 'nope'), null);
});

test('previous / next change: jumps between distinct starts; pressing again goes further', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 0, mode: 'sun' }, { id: 'b', start: at(s, 1800), slew: 0, mode: 'offsets' }, { id: 'c', start: at(s, 1800), slew: 0, mode: 'sun' }];
  o.t = 0; assert.equal(adjacentChange(o, 1), 600); o.t = 600; assert.equal(adjacentChange(o, 1), 1800, 'from a start: the next one'); o.t = 1800; assert.equal(adjacentChange(o, 1), null);
  assert.equal(adjacentChange(o, -1), 600, 'at a start: the one before'); o.t = 1200; assert.equal(adjacentChange(o, -1), 600); o.t = 600.5; assert.equal(adjacentChange(o, -1), null, 'just after the first: none before it');
});

test('undo: schedule edits come back in reverse order; the history is limited', () => {
  const s = fresh(), o = s.orbit, h = scheduleHistory(3);
  h.push(o); addChange(o, o, s.rot.q); h.push(o); renameChange(o, o.schedule[0].id, 'X'); h.push(o); o.schedule = [];
  assert.equal(h.size, 3); h.undo(o); assert.equal(o.schedule[0].name, 'X'); h.undo(o); assert.equal(o.schedule[0].name, undefined); h.undo(o); assert.deepEqual(o.schedule, []); assert.equal(h.undo(o), false);
  for (let k = 0; k < 5; k++) h.push(o); assert.equal(h.size, 3, 'limited'); h.clear(); assert.equal(h.size, 0);
});

test('undo: restores which changes exist and their start, slew, name and mode, not the other settings edited since', () => {
  const s = fresh(), o = s.orbit, h = scheduleHistory(); o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun', sunAxis: '+X' }];
  h.record(o, () => nudgeChange(o, 'a', 60)); o.schedule[0].sunAxis = '-Z'; // an axis set in Attitude guidance after the nudge
  h.undo(o); assert.equal(parseEpoch(o.schedule[0].start).getTime(), parseEpoch(at(s, 600)).getTime(), 'the nudge is undone'); assert.equal(o.schedule[0].sunAxis, '-Z', 'the axis edit stays');
  h.record(o, () => renameChange(o, 'a', 'X')); h.undo(o); assert.equal('name' in o.schedule[0], false, 'a name that was not there goes again');
  h.record(o, () => deleteChange(o, 'a')); h.undo(o); assert.equal(o.schedule[0].sunAxis, '-Z', 'a deleted change comes back as it was');
  assert.equal(h.record(o, () => nudgeChange(o, 'nope', 60)), false); assert.equal(h.size, 0, 'a failed edit leaves nothing to undo');
});

test('previous change while playing: a change jumped to counts as current for one second of real time, so pressing again goes further back', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 0, mode: 'sun' }, { id: 'b', start: at(s, 1800), slew: 0, mode: 'offsets' }];
  Object.assign(o, { playing: true, speed: 60 }); o.t = 1900; assert.equal(adjacentChange(o, -1), 1800); o.t = 1800 + 16; // a quarter second later at 60×
  assert.equal(adjacentChange(o, -1), 600, 'further back'); Object.assign(o, { playing: false }); o.t = 1816; assert.equal(adjacentChange(o, -1), 1800, 'paused: 16 s after it is the one before');
});

test('duplicate: never on another change, never inside a slew under way, whole seconds, and refused past the last date', () => {
  const s = fresh(), o = s.orbit; o.schedule = [{ id: 'a', start: at(s, 600), slew: 60, mode: 'sun' }, { id: 'b', start: at(s, 660), slew: 0, mode: 'offsets' }];
  o.t = 600; const c = duplicateChange(o, 'a'); assert.equal(parseEpoch(c.start).getTime(), parseEpoch(at(s, 720)).getTime(), 'the slew under way ends at 660, where b starts: a minute later');
  o.t = 1000.6; assert.equal(parseEpoch(duplicateChange(o, 'a').start).getTime(), parseEpoch(at(s, 1000)).getTime(), 'whole seconds');
  const z = fresh(); z.orbit.epoch = '2199-12-31T23:00'; z.orbit.schedule = [{ id: 'a', start: '2200-01-01T00:00', slew: 0, mode: 'sun' }]; z.orbit.t = 3600;
  assert.equal(duplicateChange(z.orbit, 'a'), null, 'the only free second is past the last date');
});

test('names: cut to 40 whole characters and trimmed after cutting', () => {
  assert.equal(cleanName('a'.repeat(39) + ' b'), 'a'.repeat(39)); assert.equal(Array.from(cleanName('a'.repeat(39) + '🛰️x')).length, 40);
  assert.ok(!/[\\uD800-\\uDBFF]$/.test(cleanName('a'.repeat(39) + '🛰')), 'no half emoji'); assert.equal(cleanName('  Downlink  '), 'Downlink');
});

test('automatic slew time: the turn at the start ÷ the max slew rate (90° at 1.5°/s → 60 s), rounded up; in time order', () => {
  const s = inertialPair(5); s.sc.maxRate = 1.5; const c = s.orbit.schedule[0]; c.autoSlew = true;
  assert.equal(autoSlews(s), true); assert.equal(c.slew, 60); assert.equal(autoSlews(s), false, 'nothing changes the second time');
  s.sc.maxRate = 0.7; autoSlews(s); assert.equal(c.slew, Math.ceil(90 / 0.7), 'rounded up to whole seconds');
  close(Math.hypot(...bodyRate(s, 650)) * R2D, Math.sin(90 / c.slew * D2R) * R2D, 1e-6, 'and it flies at about the max rate');
  // a second automatic change starts from where the first one ends
  s.sc.maxRate = 1.5; s.orbit.schedule.push({ id: 'b', start: at(s, 2000), slew: 0, autoSlew: true, mode: 'inertial', q: qz(150) }); autoSlews(s);
  assert.equal(s.orbit.schedule[0].slew, 60); assert.equal(s.orbit.schedule[1].slew, 40, '60° more at 1.5°/s');
  assert.equal(tooFast(s).b, undefined, 'automatic ones are never too fast');
});

test('automatic slew time into a moving target uses the turn at its start (as changeTurn)', () => {
  const s = fresh(); applyPreset(s.orbit, 'sso1030'); Object.assign(s.orbit, { mode: 'offsets', roll: 0, pitch: 0, yaw: 0 }); s.sc.maxRate = 2;
  const A = attitudeAt(s, 900), ll = ENV.ecef2ll(ENV.eci2ecef(A.st.r, A.date));
  s.orbit.schedule = [{ id: 't', start: at(s, 800), slew: 0, autoSlew: true, mode: 'target', tgtLat: ll.lat * R2D + 3, tgtLon: ll.lon * R2D, tgtAlt: 0, tgtSlew: 0 }];
  autoSlews(s); const tr = changeTurn(s, 't'); assert.ok(tr.angle > 5, `set up: a real turn (${tr.angle.toFixed(1)}°)`); assert.equal(s.orbit.schedule[0].slew, Math.ceil(tr.angle / 2));
});

test('too fast: a fixed slew that needs more than the max rate is listed with its mean rate', () => {
  const s = inertialPair(30); s.sc.maxRate = 1.5; close(tooFast(s).a, 3, 1e-6, '90° in 30 s = 3°/s');
  s.orbit.schedule[0].slew = 60; assert.deepEqual(tooFast(s), {}, 'exactly the max rate is fine');
  s.orbit.schedule[0].slew = 0; assert.equal(tooFast(s).a, Infinity, 'a jump');
});

test('max slew rate: a spacecraft setting, 1°/s by default and for older spacecraft, kept within limits', () => {
  assert.equal(defaultState().sc.maxRate, 1);
  const old = fresh(); delete old.sc.maxRate; migrate(old); assert.equal(old.sc.maxRate, 1);
  for (const [v, want] of [[2.5, 2.5], [0, 1], [-1, 1], [100, 1], ['x', 1]]) assert.equal(sanitizeSpacecraft({ sc: { ...structuredClone(defaultState().sc), maxRate: v } }).maxRate, want, String(v));
  const s = fresh(); s.orbit.schedule = [{ id: 'a', start: at(s, 5), slew: 7, autoSlew: true, mode: 'sun' }];
  assert.equal(cleanSchedule(s.orbit.schedule, s.orbit)[0].autoSlew, true, 'kept on import'); assert.equal('autoSlew' in cleanSchedule([{ start: at(s, 5), mode: 'sun', autoSlew: 'yes' }], s.orbit)[0], false);
});
