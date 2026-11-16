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

test('orbit tabs: a TLE has its own date; leaving it for a tab used before keeps that tab\'s epoch and the time from it', () => {
  const o = orbitOf(); o.t = 500; const ep = o.epoch;
  o.tle = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  switchDefinition(o, 'tle'); assert.equal(o.t, 0); assert.equal(epochDate(o).getUTCFullYear(), 2008);
  o.t = 60; switchDefinition(o, 'elements'); assert.equal(o.epoch, ep); assert.equal(o.t, 60, 'not minus 18 years');
  // the TLE kept its text; its orbit can be brought over (at its epoch, so it is the same orbit)
  const p = previousOrbit(o); assert.equal(p.def, 'tle'); assert.equal(p.epoch, '2008-09-20T12:25:40.104');
  usePreviousOrbit(o); assert.equal(epochDate(o).getUTCFullYear(), 2008); close6(orbitElements(o).i * 180 / Math.PI, 51.6416);
});
const close6 = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('orbit tabs: an r, v never filled in starts from the current orbit; restart from here keeps the other tabs and forgets the one before', () => {
  const o = orbitOf(); switchDefinition(o, 'rv'); o.r = null; o.v = null; switchDefinition(o, 'elements');
  const el = pos(o); switchDefinition(o, 'rv'); assert.ok(o.r && o.v); assert.ok(dist(pos(o), el) < 1e-3);
  const s = fresh(), x = s.orbit; Object.assign(x, { preset: 'custom', hp: 600 });
  restartFromState(x, 1000); assert.equal(x.def, 'rv'); assert.equal(x.defs.elements.hp, 600, 'the elements tab keeps what it had');
  assert.equal(x.defFrom, ''); assert.equal(previousOrbit(x), null, 'restart re-dated the orbit: no "use the orbit from Elements"');
});

test('orbit tabs: what the tabs keep goes with the scenario (export, import, parked); invalid kept inputs are dropped with a note', () => {
  const s = fresh(), o = s.orbit; o.j2 = true; switchDefinition(o, 'rv'); o.r = [...MY_R]; o.v = [...MY_V]; switchDefinition(o, 'ssrgt');
  const json = JSON.parse(JSON.stringify(exportScenario(s)));
  assert.deepEqual(json.orbit.defs.rv, { r: MY_R, v: MY_V }); assert.equal(json.orbit.defFrom, 'rv');
  const s2 = fresh(); importScenario(s2, json, newScenarioOrbit(defaultState().orbit));
  switchDefinition(s2.orbit, 'rv'); assert.deepEqual([s2.orbit.r, s2.orbit.v], [MY_R, MY_V], 'imported with its tabs');
  const first = s.scenarios.active; addScenario(s, newScenarioOrbit(defaultState().orbit), 'Other'); assert.deepEqual(s.orbit.defs, {}, 'another scenario: its own tabs');
  selectScenario(s, first); assert.deepEqual(s.orbit.defs.rv, { r: MY_R, v: MY_V }, 'parked and back');
  const bad = { ...json.orbit, defs: { rv: { r: [1, 2], v: MY_V }, elements: { preset: 'custom', hp: 500, ha: 500, i: 10, raan: 0, argp: 0, nu0: 0 }, ssrgt: { rgtR: 1 }, nope: {} } };
  const report = [], c = sanitizeScenario(bad, newScenarioOrbit(defaultState().orbit), report);
  assert.deepEqual(Object.keys(c.defs), ['elements'], 'a valid tab is kept; the one in use, an invalid one and an unknown one are not');
  assert.equal(c.defFrom, '', 'the tab before was dropped');
  assert.ok(report.some(r => r.includes('r, v (J2000) tab')), report.join(' | '));
  const pv = previewScenario(fresh(), { kind: 'scenario', atttool: 1, orbit: { epoch: '2026-01-01T00:00' } }, newScenarioOrbit(defaultState().orbit));
  assert.deepEqual(pv.orbit.defs, {}, 'an older file: no tabs kept');
  assert.ok(currentDate(pv.orbit));
});
