import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { activeItem, addSpacecraft, deleteSpacecraft, replaceActive, selectSpacecraft } from '../src/spacecraft/library.js';
import * as AM from '../src/core/attitude.js';
import { attitudeAt } from '../src/sim/guidance.js';
import { computeTimeline } from '../src/sim/timeline.js';
import { signalCatalog } from '../src/sim/signals.js';
import { defaultState, migrate } from '../src/state/store.js';
import { orbitElements } from '../src/sim/scenario.js';
import { SCENARIO_KEYS, activeScenario, addScenario, deleteScenario, duplicateScenario, ensureScenarios, exportScenario, importScenario, newScenarioOrbit, renameScenario, sanitizeScenario, scenarioData, selectScenario, SCENARIO_FORMAT, previewScenario } from '../src/sim/scenarioLibrary.js';

const fresh = () => { const s = defaultState(); migrate(s); return s; };

test('scenarios: the key list matches the orbit settings: everything is either in a scenario or a known display setting', () => {
  const display = new Set(['show', 'plot', 'playing', 'speed', 'scrub', 'scale', 'hideInset', '_init', 'run', 'runLoop']);
  for (const k of Object.keys(defaultState().orbit)) assert.ok(SCENARIO_KEYS.includes(k) || display.has(k), `orbit.${k} is in neither list`);
  for (const k of SCENARIO_KEYS) { assert.ok(!display.has(k), k); assert.ok(k in defaultState().orbit, `no default for ${k}`); }
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
  const s = fresh(), a = s.scenarios.active, scA = s.sc, idA = s.fleet.active; const partA = s.sc.comps[0].id; s.orbit.sunAxis = 'comp:' + partA; s.orbit.tgtComp = partA;
  const b = addScenario(s, s.orbit, 'B'), scB = defaultSC(), idB = addSpacecraft(s, scB, 'Sat B');
  assert.equal(s.fleet.active, idB); s.orbit.sunAxis = '+X';
  selectScenario(s, a); assert.equal(s.sc, scA); assert.equal(s.orbit.sunAxis, 'comp:' + partA); assert.equal(s.orbit.tgtComp, partA);
  selectScenario(s, b); assert.equal(s.sc, scB); assert.equal(s.fleet.active, idB); assert.equal(s.orbit.sunAxis, '+X');
  // two scenarios on one spacecraft keep different axes
  selectSpacecraft(s, idA); s.orbit.sunAxis = '-Y'; selectScenario(s, a); assert.equal(s.orbit.sunAxis, 'comp:' + partA); assert.equal(s.sc, scA);
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

test('scenarios: the JSON holds the scenario and names the spacecraft, without its data', () => {
  const s = fresh(); s.orbit.hp = 612; activeItem(s).name = 'My sat'; activeScenario(s).name = 'Pass';
  const json = JSON.parse(JSON.stringify(exportScenario(s)));
  assert.equal(json.spacecraft, 'My sat'); assert.equal(json.name, 'Pass'); assert.equal(json.orbit.hp, 612);
  assert.deepEqual(Object.keys(json).sort(), ['atttool', 'kind', 'name', 'orbit', 'spacecraft']);
  assert.ok(!JSON.stringify(json).includes('"comps"'), 'no spacecraft data');
});

test('scenarios: import flies the spacecraft of that name; the library doesn\'t change', () => {
  const s = fresh(), first = s.fleet.active, scA = s.sc; activeItem(s).name = 'Sat A';
  const part = s.sc.comps[0].id; Object.assign(s.orbit, { mode: 'target', tgtComp: part, hp: 612 });
  const json = JSON.parse(JSON.stringify(exportScenario(s)));
  addSpacecraft(s, defaultSC(), 'Sat B'); const n = s.fleet.items.length;
  const res = importScenario(s, json, D());
  assert.equal(res.missing, null); assert.equal(s.fleet.active, first); assert.equal(s.sc, scA); assert.equal(s.fleet.items.length, n);
  assert.equal(s.orbit.hp, 612); assert.equal(s.orbit.tgtComp, part); assert.equal(activeScenario(s).id, res.id);
});

test('scenarios: import without that spacecraft flies the active one, reports the name, and drops axes of its parts', () => {
  const s = fresh(); activeItem(s).name = 'Theirs'; s.orbit.sunAxis = 'comp:' + s.sc.comps[0].id; s.orbit.hp = 612;
  const json = JSON.parse(JSON.stringify(exportScenario(s)));
  const t = fresh(), active = t.fleet.active, sc = t.sc, n = t.fleet.items.length;
  const res = importScenario(t, json, D());
  assert.equal(res.missing, 'Theirs'); assert.equal(t.fleet.active, active); assert.equal(t.sc, sc); assert.equal(t.fleet.items.length, n);
  assert.equal(t.orbit.hp, 612); assert.equal(t.orbit.sunAxis, '-Z', 'not a part of the other spacecraft');
  assert.equal(importScenario(t, { kind: 'scenario', orbit: {} }, D()).missing, null, 'none named');
  assert.equal(importScenario(t, { kind: 'scenario', orbit: {}, spacecraft: { sc: {} } }, D()).missing, null, 'an old or odd value is ignored');
});

test('scenarios: importing twice keeps the names unique', () => {
  const s = fresh(), json = JSON.parse(JSON.stringify(exportScenario(s)));
  importScenario(s, json, D()); importScenario(s, json, D()); assert.equal(activeScenario(s).name, 'Scenario 1 3');
});

test('scenarios: import rejects other JSON, changing nothing; bad fields take the default', () => {
  const s = fresh(), d = scenarioData(defaultState().orbit), snap = JSON.stringify(s);
  assert.throws(() => importScenario(s, { atttool: 1, sc: defaultSC() }, d), /Expected a scenario/);
  assert.throws(() => importScenario(s, null, d), /Expected a scenario/);
  assert.equal(JSON.stringify(s), snap);
  const o = sanitizeScenario({ hp: 'high', ha: -5, mode: 'warp', def: 'x', r: [1, 2], epoch: 'soon', t: 1e15, tgtLat: 200, j2: 1, sunAxis: 'Z', refFrame: 'nope', extra: 1, tgtAlt: 100 }, d);
  for (const k of ['hp', 'ha', 'mode', 'def', 'r', 'epoch', 't', 'tgtLat', 'j2', 'sunAxis', 'refFrame']) assert.deepEqual(o[k], d[k], k);
  assert.equal(o.tgtAlt, 100); assert.ok(!('extra' in o));
  assert.equal(sanitizeScenario(null, d).hp, d.hp);
});

test('scenarios: a damaged library is repaired', () => {
  const s = fresh(); s.scenarios.items.push({ id: 'x', name: 'No data' }, { id: 'y', data: {}, scId: 'q' }, { id: 'y', name: 'dup', data: {} }); ensureScenarios(s);
  assert.equal(s.scenarios.items.length, 2); assert.ok(s.scenarios.items.every(i => i.name));
  s.scenarios.active = 'gone'; ensureScenarios(s); assert.equal(activeScenario(s).data, null); s.scenarios = 'junk'; ensureScenarios(s); assert.equal(s.scenarios.items.length, 1);
});

/* ---------- import: nothing a pasted file holds may stop the app ---------- */
const D = () => scenarioData(defaultState().orbit);

test('import: hostile fields never reach the sim; the result runs through guidance, signals and the timeline', () => {
  const bad = [
    { def: 'rv' }, { def: 'rv', r: [7000, 0, 0] }, { refFrame: ['vvlh'] }, { refFrame: 'constructor' }, { refFrame: '__proto__' }, { mode: 'sun', sunAxis: ['+X'] }, { mode: 'sun', sunSecAxis: ['+X'] },
    { schedule: 'soon' }, { schedule: [null, 7, { start: 'x', mode: 'sun' }, { start: '2026-10-05T10:10', mode: 'warp' }, { start: '2300-01-01T00:00', mode: 'sun' }] },
    { schedule: [{ start: '2026-10-05T10:00:30', mode: 'sun', slew: 1e9, sunAxis: ['+X'], roll: 'a', tgtLat: 500, id: { x: 1 } }, { start: '2026-10-05T10:01', mode: 'inertial', slew: -5, q: { w: 0, x: 0, y: 0, z: 0 } }, { start: '2026-10-05T10:02', mode: 'target', tgtLat: NaN }] },
    { t: 1e15 }, { preset: 'nope' }, { preset: 'constructor' }, { hp: 1e308, ha: 1e308 }, { epoch: ['2026-10-05T10:00'] }, { sunSec: 'junk' }, { tle: 7 }, { i: 'x', raan: {}, argp: null, nu0: [] }, { roll: Infinity, pitch: NaN, yaw: '1' }, { tgtLat: 91, tgtLon: 1e9 }, { mode: 'constructor' }, { mode: 'inertial', inertialQ: { w: 0, x: 0, y: 0, z: 0 } }, { mode: 'inertial', inertialQ: 'x' },
  ];
  for (const orbit of bad) {
    const s = fresh(), { id } = importScenario(s, { kind: 'scenario', orbit }, D()), label = JSON.stringify(orbit);
    assert.equal(s.scenarios.active, id, label);
    const A = attitudeAt(s, s.orbit.t); assert.ok(A.st.r.every(Number.isFinite), label); assert.ok(A.CBI.flat().every(Number.isFinite), label);
    assert.ok(signalCatalog(s).length > 0, label); assert.ok(computeTimeline(s, 1, null, 12), label);
    if (orbit.def === 'rv') assert.equal(s.orbit.def, 'elements', label);
  }
  // valid values of those fields are kept, so the checks aren't simply rejecting everything
  const o = sanitizeScenario({ preset: 'iss', def: 'rv', r: [7000, 0, 0], v: [0, 7.5, 0], t: 100, i: 51, raan: 10, argp: 1, nu0: 2, roll: 1, pitch: 2, yaw: 3, sunSec: 'velocity', sunAxis: 'comp:a', sunSecAxis: '-Y', tle: 'x', tgtComp: 'c', refFrame: 'lvlh' }, D());
  assert.deepEqual([o.preset, o.def, o.t, o.i, o.raan, o.argp, o.nu0, o.roll, o.pitch, o.yaw, o.sunSec, o.sunAxis, o.sunSecAxis, o.tle, o.tgtComp, o.refFrame], ['iss', 'rv', 100, 51, 10, 1, 2, 1, 2, 3, 'velocity', 'comp:a', '-Y', 'x', 'c', 'lvlh']);
});

test('import: refused files change nothing; odd names are replaced', () => {
  const s = fresh(), snap = () => JSON.stringify([s.fleet, s.scenarios, s.orbit]), before = snap();
  for (const j of [{ kind: 'scenario', orbit: 7 }, { kind: 'scenario', atttool: SCENARIO_FORMAT + 1, orbit: {} }]) { assert.throws(() => importScenario(s, j, D())); assert.equal(snap(), before); }
  importScenario(s, { kind: 'scenario', name: { toString: 1 }, orbit: {} }, D()); assert.equal(activeScenario(s).name, 'Imported scenario');
  importScenario(s, { kind: 'scenario', name: 'x'.repeat(99), orbit: {} }, D()); assert.equal(activeScenario(s).name.length, 32);
});

test('scenarios: inertial mode keeps its attitude per scenario and in the export; other modes leave Rotation Lab alone', () => {
  const s = fresh(), a = s.scenarios.active, qA = AM.q.unit({ w: 1, x: 2, y: 3, z: 4 }), qB = AM.q.unit({ w: 4, x: 3, y: 2, z: 1 }), qOff = AM.q.unit({ w: 1, x: 1, y: 0, z: 0 });
  s.orbit.mode = 'inertial'; s.rot.q = qA;
  const b = duplicateScenario(s); s.rot.q = qB; const off = addScenario(s, { ...s.orbit, mode: 'offsets' }, 'Off');
  assert.deepEqual(s.rot.q, qB, 'a non-inertial scenario leaves it');
  s.rot.q = qOff; selectScenario(s, a); assert.ok(AM.v.norm(AM.v.sub(Object.values(s.rot.q), Object.values(qA))) < 1e-12);
  // Euler angles stay in step
  const fromE = AM.C2q(AM.euler2C(s.rot.seq, s.rot.euler.map(x => x * AM.D2R))); assert.ok(1 - Math.abs(fromE.w * s.rot.q.w + fromE.x * s.rot.q.x + fromE.y * s.rot.q.y + fromE.z * s.rot.q.z) < 1e-9);
  selectScenario(s, b); assert.ok(AM.v.norm(AM.v.sub(Object.values(s.rot.q), Object.values(qB))) < 1e-12);
  selectScenario(s, off); assert.ok(AM.v.norm(AM.v.sub(Object.values(s.rot.q), Object.values(qB))) < 1e-12);
  selectScenario(s, b);
  const json = JSON.parse(JSON.stringify(exportScenario(s))), t = fresh(); importScenario(t, json, D());
  assert.ok(AM.v.norm(AM.v.sub(Object.values(json.orbit.inertialQ), Object.values(qB))) < 1e-12); selectScenario(t, t.scenarios.items[0].id); selectScenario(t, t.scenarios.items[1].id);
  assert.ok(AM.v.norm(AM.v.sub(Object.values(t.rot.q), Object.values(qB))) < 1e-9, 'opens with that attitude elsewhere');
});

test('scenarios: parts deleted, reset or replaced while parked fall back to the defaults', () => {
  const s = fresh(), a = s.scenarios.active, part = 'comp:' + s.sc.comps[0].id;
  Object.assign(s.orbit, { sunAxis: part, sunSecAxis: part, tgtComp: s.sc.comps[0].id });
  addScenario(s, s.orbit, 'B');
  replaceActive(s, defaultSC()); selectScenario(s, a);
  assert.deepEqual([s.orbit.sunAxis, s.orbit.sunSecAxis, s.orbit.tgtComp], ['-Z', '+X', ''], 'not a part that is gone');
  const kept = 'comp:' + s.sc.comps[1].id; s.orbit.sunAxis = kept; const b = s.scenarios.items[1].id; selectScenario(s, b); selectScenario(s, a); assert.equal(s.orbit.sunAxis, kept, 'a part still there stays');
});

test('scenarios: a new one starts from the default orbit with the preset applied', () => {
  const d = defaultState().orbit, o = newScenarioOrbit(d);
  assert.deepEqual(Object.keys(o), SCENARIO_KEYS); assert.equal(o.t, 0); assert.ok(o.i > 97 && o.i < 98, 'SSO inclination'); assert.notEqual(o.raan, 0, 'RAAN set for the LTAN');
});

test('scenario JSON format: 1 without a schedule (older AttTool reads it), 2 with one (older AttTool refuses it rather than dropping it)', () => {
  const s = fresh(); assert.equal(exportScenario(s).atttool, 1);
  s.orbit.schedule = [{ id: 'c', start: '2026-10-05T10:10', slew: 60, mode: 'sun', sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir' }];
  const j = JSON.parse(JSON.stringify(exportScenario(s))); assert.equal(j.atttool, 2);
  const refusedBy08 = json => json.atttool > 1; // AttTool 0.8.0 importScenario, verbatim (git show v0.8.0:src/sim/scenarioLibrary.js)
  assert.equal(refusedBy08(j), true, 'with a schedule: 0.8 says it comes from a newer version'); assert.equal(refusedBy08(exportScenario(fresh())), false, 'without: 0.8 reads it');
  const t = fresh(); importScenario(t, j, D()); assert.equal(t.orbit.schedule.length, 1, 'read here');
  importScenario(t, { ...j, atttool: 1 }, D()); assert.equal(t.orbit.schedule.length, 1, 'format 1 with a schedule (as the withdrawn first 0.9.0 build wrote it) is still read');
});

test('import report: what was reset or dropped is told, in plain sentences; a clean file has nothing to report', () => {
  const s = fresh(), clean = JSON.parse(JSON.stringify(exportScenario(s)));
  assert.deepEqual(previewScenario(s, clean, D()).report, [], 'its own export: nothing');
  const orbit = { ...clean.orbit, hp: -5, mode: 'warp', roll: 'x', schedule: [
    { start: 'soon', mode: 'sun' }, { start: '2300-01-01T00:00', mode: 'sun' }, { start: '2026-10-05T10:10', mode: 'warp' }, 7,
    { start: '2026-10-05T10:20', mode: 'sun', slew: 1e9, sunAxis: ['x'] }] };
  delete orbit.tgtSlew; delete orbit.end;
  const r = previewScenario(s, { ...clean, orbit }, D()).report.join(' | ');
  for (const want of ['perigee altitude', 'guidance mode', 'roll', '2 settings were not in the file', 'no readable start time', 'outside 1900 to 2200', 'unknown guidance mode', 'not a change at all', 'slew', 'Sun axis']) assert.ok(r.includes(want), `report mentions "${want}": ${r}`);
  assert.equal(previewScenario(s, { ...clean, orbit: { ...clean.orbit, def: 'rv', r: [1, 2] } }, D()).report.some(x => x.includes('state vector')), true);
});

test('import preview: changes nothing, and says which spacecraft it would fly and whether a scenario has the same name', () => {
  const s = fresh(), j = JSON.parse(JSON.stringify(exportScenario(s))), before = JSON.stringify(s);
  const p = previewScenario(s, j, D()); assert.equal(JSON.stringify(s), before, 'nothing changed');
  assert.equal(p.name, activeScenario(s).name); assert.equal(p.sameName, s.scenarios.active); assert.equal(p.spacecraft.found, s.fleet.active);
  const q = previewScenario(s, { ...j, name: 'Other', spacecraft: 'Not here' }, D()); assert.equal(q.sameName, null); assert.deepEqual(q.spacecraft, { name: 'Not here', found: null });
  assert.throws(() => previewScenario(s, { kind: 'x' }, D()), /Expected a scenario/);
});

test('import replace: the new scenario takes the old one\'s name and place in the library; the old one is gone', () => {
  const s = fresh(); addScenario(s, { ...scenarioData(s.orbit), hp: 700 }, 'Pass A'); addScenario(s, scenarioData(s.orbit), 'Pass B');
  const old = s.scenarios.items.find(i => i.name === 'Pass A').id, n = s.scenarios.items.length;
  const j = { kind: 'scenario', atttool: 1, name: 'Pass A', orbit: { ...scenarioData(s.orbit), hp: 900 } };
  const res = importScenario(s, j, D(), { replace: old });
  assert.equal(s.scenarios.items.length, n, 'one in, one out'); assert.ok(!s.scenarios.items.some(i => i.id === old));
  assert.equal(activeScenario(s).name, 'Pass A'); assert.equal(s.scenarios.active, res.id); assert.equal(s.orbit.hp, 900);
  const added = importScenario(s, j, D()); assert.notEqual(s.scenarios.items.find(i => i.id === added.id).name, 'Pass A', 'added as new: a different name');
});
