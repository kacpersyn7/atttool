/**
 * The "Defined by" tabs keep what was entered in each (#81): switching never overwrites another tab's inputs, a
 * tab not used yet starts from the current orbit, and the orbit of the tab before is brought over only on request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ENV from '../src/env/index.js';
import { currentDate, definitionError, epochDate, ltanOf, orbitElements, previousOrbit, restartFromState, switchDefinition, usePreviousOrbit } from '../src/sim/scenario.js';
import { addScenario, exportScenario, importScenario, newScenarioOrbit, previewScenario, sanitizeScenario, selectScenario } from '../src/sim/scenarioLibrary.js';
import { defaultState, migrate } from '../src/state/store.js';

const fresh = () => { const s = defaultState(); migrate(s); return s; };
const orbitOf = () => { const o = fresh().orbit; o.j2 = true; return o; };
const pos = (o, t = 1234) => ENV.propagate(orbitElements(o), t, o.j2).r;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MY_R = [6900, 100, -50], MY_V = [0.05, 1.1, 7.5];

test('orbit tabs: r, v → Repeat track → r, v gives back the r, v that was entered, and its orbit', () => {
  const o = orbitOf(); switchDefinition(o, 'rv'); o.r = [...MY_R]; o.v = [...MY_V];
  const mine = pos(o), t = o.t;
  switchDefinition(o, 'ssrgt'); assert.equal(o.def, 'ssrgt'); assert.equal(definitionError(o), null);
  assert.ok(dist(pos(o), mine) > 100, 'a repeat track is another orbit');
  switchDefinition(o, 'rv');
  assert.deepEqual([o.r, o.v], [MY_R, MY_V]); assert.ok(dist(pos(o), mine) < 1e-9); assert.equal(o.t, t, 'the time stays');
});

test('orbit tabs: a tab not used yet starts from the current orbit; every tab keeps its own', () => {
  const o = orbitOf(); o.preset = 'custom'; Object.assign(o, { hp: 500, ha: 900, i: 63, raan: 40, argp: 30, nu0: 75 });
  const el = pos(o);
  switchDefinition(o, 'rv'); assert.ok(dist(pos(o), el) < 1e-3, 'first visit: nothing moves');
  assert.equal(previousOrbit(o), null, 'the same orbit: nothing to bring over');
  o.r = [...MY_R]; o.v = [...MY_V]; const rv = pos(o);
  switchDefinition(o, 'elements');
  assert.deepEqual([o.hp, o.ha, o.i, o.raan, o.argp, o.nu0, o.preset], [500, 900, 63, 40, 30, 75, 'custom'], 'the elements typed before');
  assert.ok(dist(pos(o), el) < 1e-9);
  switchDefinition(o, 'rv'); assert.deepEqual([o.r, o.v], [MY_R, MY_V], 'and the r, v typed since');
  assert.ok(dist(pos(o), rv) < 1e-9);
});

test('orbit tabs: "use the orbit from" brings the orbit of the tab before over, on request', () => {
  const o = orbitOf(); switchDefinition(o, 'rv'); o.r = [...MY_R]; o.v = [...MY_V]; const rv = pos(o);
  switchDefinition(o, 'elements'); assert.ok(dist(pos(o), rv) > 100);
  const p = previousOrbit(o); assert.equal(p.def, 'rv'); assert.equal(p.name, 'r, v (J2000)');
  const t = o.t; assert.equal(usePreviousOrbit(o), true);
  assert.ok(dist(pos(o), rv) < 1e-3, 'now the elements of that r, v'); assert.equal(o.preset, 'custom'); assert.equal(o.t, t);
  assert.equal(previousOrbit(o), null, 'done: nothing left to bring over'); assert.equal(usePreviousOrbit(o), false);
  // a repeat track can take the LTAN only (it solves the rest)
  switchDefinition(o, 'ssrgt'); switchDefinition(o, 'rv'); switchDefinition(o, 'ssrgt');
  const q = previousOrbit(o), want = ltanOf({ ...o, def: 'rv' }); assert.ok(q === null || Math.abs(q.inputs.rgtLtan - Math.round(want * 60) / 60) < 1e-9);
  // nothing can be made into a TLE
  o.tle = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  switchDefinition(o, 'tle'); assert.equal(previousOrbit(o), null);
});

test('orbit tabs: a TLE has its own date; leaving it for a tab used before goes back to that tab\'s epoch and the time it was left at', () => {
  const o = orbitOf(); o.t = 500; const ep = o.epoch;
  o.tle = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  switchDefinition(o, 'tle'); assert.equal(o.t, 0); assert.equal(epochDate(o).getUTCFullYear(), 2008);
  o.t = 60; switchDefinition(o, 'elements'); assert.equal(o.epoch, ep); assert.equal(o.t, 500, 'back where it was left, not 18 years away');
  // the TLE kept its text; its orbit can be brought over (at its epoch, so it is the same orbit); the current UTC stays
  const p = previousOrbit(o), u = currentDate(o).getTime(); assert.equal(p.def, 'tle'); assert.equal(p.inputs.epoch, '2008-09-20T12:25:40.104');
  usePreviousOrbit(o); assert.equal(epochDate(o).getUTCFullYear(), 2008); close6(orbitElements(o).i * 180 / Math.PI, 51.6416); assert.equal(currentDate(o).getTime(), u);
});
const close6 = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('orbit tabs: an r, v never filled in starts from the current orbit; restart from here keeps the other tabs and forgets the one before', () => {
  const o = orbitOf(); switchDefinition(o, 'rv'); o.r = null; o.v = null; switchDefinition(o, 'elements');
  const el = pos(o); switchDefinition(o, 'rv'); assert.ok(o.r && o.v); assert.ok(dist(pos(o), el) < 1e-3);
  const s = fresh(), x = s.orbit; Object.assign(x, { preset: 'custom', hp: 600 });
  restartFromState(x, 1000); assert.equal(x.def, 'rv'); assert.equal(x.defs.elements.hp, 600, 'the elements tab keeps what it had');
  assert.equal(x.defFrom, ''); assert.equal(previousOrbit(x), null, 'restart re-dated the orbit: no "use the orbit from Elements"');
});

test('orbit tabs: what the tabs keep stays with the scenario in the library (parked, duplicated) but is not exported', () => {
  const s = fresh(), o = s.orbit; o.j2 = true; switchDefinition(o, 'rv'); o.r = [...MY_R]; o.v = [...MY_V]; switchDefinition(o, 'ssrgt');
  const json = JSON.parse(JSON.stringify(exportScenario(s)));
  assert.ok(!('defs' in json.orbit) && !('defFrom' in json.orbit), 'a shared file holds no hidden TLE or r, v');
  const pv = previewScenario(fresh(), json, newScenarioOrbit(defaultState().orbit));
  assert.deepEqual(pv.info, [], 'and that is not reported as settings missing from an older version');
  const first = s.scenarios.active; addScenario(s, newScenarioOrbit(defaultState().orbit), 'Other'); assert.deepEqual(s.orbit.defs, {}, 'another scenario: its own tabs');
  selectScenario(s, first); assert.deepEqual([s.orbit.defs.rv.r, s.orbit.defs.rv.v], [MY_R, MY_V], 'parked and back');
  // a file that does carry kept tabs (hand-made): valid ones are kept, with their time; others dropped with a note
  const ep = '2026-10-05T10:00', bad = { ...json.orbit, def: 'ssrgt', defs: { rv: { r: [1, 2], v: MY_V, epoch: ep }, elements: { preset: 'custom', hp: 500, ha: 500, i: 10, raan: 0, argp: 0, nu0: 0, epoch: ep, at: 5 }, ssrgt: { rgtR: 1 }, nope: {} }, defFrom: 'rv' };
  const report = [], c = sanitizeScenario(bad, newScenarioOrbit(defaultState().orbit), report);
  assert.deepEqual(Object.keys(c.defs), ['elements']); assert.equal(c.defs.elements.at, 5);
  assert.equal(c.defFrom, '', 'the tab before was dropped');
  assert.ok(report.some(r => r.includes('r, v (J2000) tab')), report.join(' | '));
});

test('orbit tabs: the schedule stays at its UTC across a TLE and back; the time stays within the date limits', () => {
  const s = fresh(), o = s.orbit; o.t = 600; const u = currentDate(o).getTime();
  o.schedule = [{ id: 'a', start: new Date(u + 60e3).toISOString().slice(0, 19), slew: 30, mode: 'sun' }];
  o.tle = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  switchDefinition(o, 'tle'); switchDefinition(o, 'elements');
  assert.equal(currentDate(o).getTime(), u, 'back at the time it was left: the change is a minute ahead, not years');
  const x = fresh().orbit; x.epoch = '2199-12-01T00:00'; x.t = 30 * 86400; // the last day of the limits
  switchDefinition(x, 'rv'); x.epoch = '1990-01-01T00:00'; switchDefinition(x, 'elements'); switchDefinition(x, 'rv');
  assert.ok(currentDate(x).getTime() <= Date.UTC(2200, 0, 1), 'within 2200');
});

test('orbit tabs: each tab keeps its epoch, so coming back gives exactly its orbit', () => {
  const o = orbitOf(); o.preset = 'custom'; const el = pos(o, 0), ep = o.epoch;
  switchDefinition(o, 'rv'); o.epoch = '2027-03-01T00:00'; o.r = [...MY_R]; o.v = [...MY_V];
  switchDefinition(o, 'elements'); assert.equal(o.epoch, ep); assert.ok(dist(pos(o, 0), el) < 1e-9, 'the elements at their own epoch');
  switchDefinition(o, 'rv'); assert.equal(o.epoch, '2027-03-01T00:00');
  // restart from here re-dates only the r, v: the elements keep their epoch
  switchDefinition(o, 'elements'); restartFromState(o, 1000); switchDefinition(o, 'elements'); assert.equal(o.epoch, ep); assert.ok(dist(pos(o, 0), el) < 1e-9);
});

test('orbit tabs: a repeat track can take the LTAN of the tab before; J2 decides whether it can', () => {
  const o = orbitOf(); o.preset = 'custom'; o.raan = 200; const want = Math.round(ltanOf(o) * 60) / 60;
  switchDefinition(o, 'ssrgt'); o.rgtLtan = 6; switchDefinition(o, 'elements'); switchDefinition(o, 'ssrgt');
  assert.equal(o.rgtLtan, 6, 'its own LTAN back'); const p = previousOrbit(o); assert.ok(p, 'the LTAN differs');
  assert.equal(p.inputs.rgtLtan, want); usePreviousOrbit(o); assert.equal(o.rgtLtan, want); assert.equal(previousOrbit(o), null);
  const q = orbitOf(); q.j2 = false; q.def = 'ssrgt'; switchDefinition(q, 'rv'); q.r = [...MY_R]; q.v = [...MY_V]; // a typed r, v
  assert.equal(previousOrbit(q), null, 'a repeat track without J2 is not valid: nothing to bring over');
  q.j2 = true; const r = previousOrbit(q); assert.ok(r && r.def === 'ssrgt', 'with J2 it is: its orbit can be brought over');
});
