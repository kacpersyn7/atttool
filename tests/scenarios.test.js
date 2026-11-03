import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { activeItem, addSpacecraft, deleteSpacecraft, selectSpacecraft } from '../src/spacecraft/library.js';
import { defaultState, migrate } from '../src/state/store.js';
import { orbitElements } from '../src/sim/scenario.js';
import { SCENARIO_KEYS, activeScenario, addScenario, deleteScenario, duplicateScenario, ensureScenarios, exportScenario, importScenario, renameScenario, sanitizeScenario, scenarioData, selectScenario } from '../src/sim/scenarioLibrary.js';

const fresh = () => { const s = defaultState(); migrate(s); return s; };

test('scenarios: the key list matches the orbit settings: everything is either in a scenario or a known display setting', () => {
  const display = new Set(['show', 'plot', 'playing', 'speed', 'scale', 'hideInset', '_init']);
  for (const k of Object.keys(defaultState().orbit)) assert.ok(SCENARIO_KEYS.includes(k) || display.has(k), `orbit.${k} is in neither list`);
  for (const k of SCENARIO_KEYS) assert.ok(!display.has(k), k);
});

test('scenarios: an old save becomes a library of one with its spacecraft; idempotent', () => {
  const s = JSON.parse(JSON.stringify(defaultState())); delete s.scenarios; s.orbit.hp = 777; migrate(s);
  assert.equal(s.scenarios.items.length, 1); assert.equal(activeScenario(s).name, 'Scenario 1'); assert.equal(activeScenario(s).data, null);
  assert.equal(activeScenario(s).scId, s.fleet.active); assert.equal(s.orbit.hp, 777);
  const again = JSON.stringify(s.scenarios); ensureScenarios(s); assert.equal(JSON.stringify(s.scenarios), again);
});

test('scenarios: switching swaps every scenario field in place, and leaves display settings alone', () => {
  const s = fresh(), o = s.orbit, a = s.scenarios.active; Object.assign(o, { hp: 500, mode: 'target', t: 123, tgtLat: 10, roll: 7 });
  o.show.track = false; o.speed = 300;
  const b = addScenario(s, { ...o, hp: 900, mode: 'sun', t: 9, tgtLat: -20, roll: 0 }, 'B');
  assert.equal(s.orbit, o, 'same object: views keep a reference'); assert.equal(s.scenarios.active, b);
  assert.deepEqual([o.hp, o.mode, o.t, o.tgtLat, o.roll], [900, 'sun', 9, -20, 0]);
  assert.equal(o.show.track, false); assert.equal(o.speed, 300);
  assert.equal(selectScenario(s, a), true); assert.deepEqual([o.hp, o.mode, o.t, o.tgtLat, o.roll], [500, 'target', 123, 10, 7]);
  assert.equal(activeScenario(s).data, null); assert.equal(s.scenarios.items.find(i => i.id === b).data.hp, 900);
  assert.equal(selectScenario(s, a), false, 'already active'); assert.equal(selectScenario(s, 'nope'), false);
});

test('scenarios: the orbit really changes (elements follow the switch)', () => {
  const s = fresh(), a = s.scenarios.active, a0 = orbitElements(s.orbit).a; addScenario(s, { ...s.orbit, hp: 1000, ha: 1000 }, 'High');
  assert.ok(orbitElements(s.orbit).a > a0 + 400); selectScenario(s, a); assert.equal(orbitElements(s.orbit).a, a0);
});

test('scenarios: each flies its own spacecraft, with its own part-based axes', () => {
  const s = fresh(), a = s.scenarios.active, scA = s.sc, idA = s.fleet.active; s.orbit.sunAxis = 'comp:partA'; s.orbit.tgtComp = 'plA';
  const b = addScenario(s, s.orbit, 'B'), scB = defaultSC(), idB = addSpacecraft(s, scB, 'Sat B');
  assert.equal(s.fleet.active, idB); s.orbit.sunAxis = '+X';
  selectScenario(s, a); assert.equal(s.sc, scA); assert.equal(s.orbit.sunAxis, 'comp:partA'); assert.equal(s.orbit.tgtComp, 'plA');
  selectScenario(s, b); assert.equal(s.sc, scB); assert.equal(s.fleet.active, idB); assert.equal(s.orbit.sunAxis, '+X');
  // two scenarios on one spacecraft keep different axes
  selectSpacecraft(s, idA); s.orbit.sunAxis = '-Y'; selectScenario(s, a); assert.equal(s.orbit.sunAxis, 'comp:partA'); assert.equal(s.sc, scA);
  selectScenario(s, b); assert.equal(s.orbit.sunAxis, '-Y'); assert.equal(s.sc, scA);
});

test('scenarios: if its spacecraft was deleted, a scenario flies the active one with that one\'s axes', () => {
  const s = fresh(), a = s.scenarios.active; const scA = s.sc; s.orbit.sunAxis = '-Z';
  const b = addScenario(s, s.orbit, 'B'), idB = addSpacecraft(s, defaultSC(), 'Sat B'); s.orbit.sunAxis = 'comp:only-on-B'; s.orbit.hp = 901;
  selectScenario(s, a); deleteSpacecraft(s, idB);
  selectScenario(s, b);
  assert.equal(s.sc, scA); assert.equal(s.orbit.hp, 901); assert.equal(s.orbit.sunAxis, '-Z', 'no axis of a part that is gone');
  assert.equal(activeScenario(s).scId, s.fleet.active);
});

test('scenarios: duplicate is independent; new names unique; rename and delete rules', () => {
  const s = fresh(), a = s.scenarios.active; s.orbit.r = [1, 2, 3];
  const b = duplicateScenario(s); assert.equal(activeScenario(s).name, 'Scenario 1 copy');
  assert.deepEqual(s.orbit.r, [1, 2, 3]); s.orbit.r[0] = 99; selectScenario(s, a); assert.equal(s.orbit.r[0], 1);
  assert.equal(renameScenario(s, b, ' Scenario 1 '), false); assert.equal(renameScenario(s, b, ' '), false); assert.equal(renameScenario(s, b, ' Pass '), true);
  assert.equal(s.scenarios.items.find(i => i.id === b).name, 'Pass');
  assert.equal(deleteScenario(s, a), true); assert.equal(s.scenarios.active, b, 'neighbour active'); assert.equal(deleteScenario(s, b), false, 'last stays'); assert.equal(deleteScenario(s, 'x'), false);
  assert.equal(s.scenarios.items.length, 1);
});

test('scenarios: deleting a scenario keeps its spacecraft', () => {
  const s = fresh(), a = s.scenarios.active, b = addScenario(s, s.orbit, 'B'); addSpacecraft(s, defaultSC(), 'Sat B');
  const n = s.fleet.items.length; selectScenario(s, a); deleteScenario(s, b); assert.equal(s.fleet.items.length, n);
});

test('scenarios: save round trip, with fields added later filled into parked scenarios', () => {
  const s = fresh(), a = s.scenarios.active, b = addScenario(s, { ...s.orbit, hp: 901 }, 'B'); selectScenario(s, a);
  delete s.scenarios.items.find(i => i.id === b).data.tgtAlt;
  const back = JSON.parse(JSON.stringify(s)); migrate(back);
  assert.equal(back.scenarios.active, a); assert.equal(back.scenarios.items.find(i => i.id === b).data.hp, 901); assert.equal(back.scenarios.items.find(i => i.id === b).data.tgtAlt, 0);
  selectScenario(back, b); assert.equal(back.orbit.hp, 901);
});

test('scenarios: export then import on another machine brings the spacecraft along', () => {
  const s = fresh(); s.orbit.hp = 612; s.orbit.mode = 'target'; s.orbit.tgtComp = s.sc.comps[0].id; s.sc.bus.mass = 77; activeItem(s).name = 'My sat'; activeScenario(s).name = 'Pass over Warsaw';
  const json = JSON.parse(JSON.stringify(exportScenario(s)));
  const t = fresh(), before = t.sc, n = t.fleet.items.length;
  importScenario(t, json, scenarioData(defaultState().orbit));
  assert.equal(activeScenario(t).name, 'Pass over Warsaw'); assert.equal(t.orbit.hp, 612); assert.equal(t.orbit.mode, 'target'); assert.equal(t.orbit.tgtComp, s.sc.comps[0].id);
  assert.equal(t.fleet.items.length, n + 1); assert.equal(activeItem(t).name, 'My sat'); assert.equal(t.sc.bus.mass, 77); assert.notEqual(t.sc, before);
});

test('scenarios: importing twice reuses the identical spacecraft; names stay unique', () => {
  const s = fresh(), json = JSON.parse(JSON.stringify(exportScenario(s))), n = s.fleet.items.length, d = scenarioData(defaultState().orbit);
  importScenario(s, json, d); assert.equal(s.fleet.items.length, n, 'same as the active one');
  importScenario(s, json, d); assert.equal(s.fleet.items.length, n); assert.equal(activeScenario(s).name, 'Scenario 1 3');
});

test('scenarios: import rejects other JSON and bad spacecraft, changing nothing; bad fields take the default', () => {
  const s = fresh(), d = scenarioData(defaultState().orbit), snap = JSON.stringify(s);
  assert.throws(() => importScenario(s, { atttool: 1, sc: defaultSC() }, d), /Expected a scenario/);
  assert.throws(() => importScenario(s, null, d), /Expected a scenario/);
  assert.throws(() => importScenario(s, { kind: 'scenario', orbit: {}, spacecraft: { sc: { bus: { x: 1, y: 1, z: 1, mass: 1 }, comps: [{ type: 'str', name: 'S' }] } } }, d), /needs "pos"/);
  assert.equal(JSON.stringify(s), snap);
  const o = sanitizeScenario({ hp: 'high', ha: -5, mode: 'warp', def: 'x', r: [1, 2], epoch: 'soon', t: -1, tgtLat: 200, j2: 1, sunAxis: 'Z', refFrame: 'nope', extra: 1, tgtAlt: 100 }, d);
  for (const k of ['hp', 'ha', 'mode', 'def', 'r', 'epoch', 't', 'tgtLat', 'j2', 'sunAxis', 'refFrame']) assert.deepEqual(o[k], d[k], k);
  assert.equal(o.tgtAlt, 100); assert.ok(!('extra' in o));
  assert.equal(sanitizeScenario(null, d).hp, d.hp);
});

test('scenarios: a damaged library is repaired', () => {
  const s = fresh(); s.scenarios.items.push({ id: 'x', name: 'No data' }, { id: 'y', data: {}, scId: 'q' }, { id: 'y', name: 'dup', data: {} }); ensureScenarios(s);
  assert.equal(s.scenarios.items.length, 2); assert.ok(s.scenarios.items.every(i => i.name));
  s.scenarios.active = 'gone'; ensureScenarios(s); assert.equal(activeScenario(s).data, null); s.scenarios = 'junk'; ensureScenarios(s); assert.equal(s.scenarios.items.length, 1);
});
