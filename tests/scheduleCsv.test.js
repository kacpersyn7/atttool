import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forAdding, parseCSVRows, scheduleFromCSV, scheduleToCSV } from '../src/sim/scheduleCsv.js';
import { epochDate } from '../src/sim/scenario.js';
import { defaultState, migrate } from '../src/state/store.js';

const fresh = () => { const s = defaultState(); migrate(s); return s; };
const at = (s, t) => new Date(epochDate(s.orbit).getTime() + t * 1000).toISOString().slice(0, 19);

test('schedule CSV: export then import gives the same schedule (names, auto slews, parts by name, an inertial attitude, an event)', () => {
  const s = fresh(), o = s.orbit, cam = s.sc.comps.find(c => c.type === 'payload'), str = s.sc.comps.find(c => c.type === 'str');
  o.schedule = [
    { id: 'a', start: at(s, 600), slew: 60, mode: 'sun', name: 'Charge, then image', sunAxis: 'comp:' + str.id, sunSecAxis: '+X', sunSec: 'nadir', roll: 0, pitch: 0, yaw: 0, tgtLat: 52.23, tgtLon: 21.01, tgtAlt: 0, tgtComp: '', tgtSlew: 60 },
    { id: 'b', start: at(s, 1800), slew: 0, autoSlew: true, mode: 'target', tgtLat: -33.87, tgtLon: 151.21, tgtAlt: 58, tgtComp: cam.id, tgtSlew: 90, roll: 0, pitch: 0, yaw: 0, sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir' },
    { id: 'c', start: at(s, 3000), slew: 30, mode: 'inertial', q: { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 }, roll: 0, pitch: 0, yaw: 0, sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir', tgtLat: 52.23, tgtLon: 21.01, tgtAlt: 0, tgtComp: '', tgtSlew: 60 },
    { id: 'd', start: at(s, 4000), slew: 20, mode: 'offsets', roll: 25.5, pitch: -3, yaw: 0, on: { kind: 'after', from: null, offset: 300, ref: 'c' }, sunAxis: '-Z', sunSecAxis: '+X', sunSec: 'nadir', tgtLat: 52.23, tgtLon: 21.01, tgtAlt: 0, tgtComp: '', tgtSlew: 60 },
  ];
  for (const comma of [false, true]) {
    const csv = scheduleToCSV(o, s.sc.comps, { comma }), back = scheduleFromCSV(csv, o, s.sc.comps);
    assert.deepEqual(back.report, [], `comma ${comma}: ${back.report}`); assert.equal(back.rows, 4);
    const q12 = l => JSON.parse(JSON.stringify(l), (k, v) => typeof v === 'number' ? +v.toPrecision(12) : v); // a quaternion is renormalised on import: the last bit may move
    assert.deepEqual(q12(back.changes), q12(o.schedule), `comma ${comma}: the same schedule`);
  }
  assert.ok(scheduleToCSV(o, s.sc.comps).includes('"Charge, then image"'), 'a name with the separator is quoted');
  assert.ok(scheduleToCSV(o, s.sc.comps).includes('part:' + str.name), 'parts by name');
});

test('schedule CSV: a hand-written file (semicolons, decimal commas, quotes, any column order, Z times); bad rows are reported and skipped', () => {
  const s = fresh(), o = s.orbit, cam = s.sc.comps.find(c => c.type === 'payload');
  const csv = [
    'Mode;UTC;Name;slew_s;target_lat_deg;target_lon_deg;pointing_part;comment',
    `target;${at(s, 900).replace('T', ' ')}Z;"Image ""Warsaw""";45;52,2297;21,0122;${cam.name};first pass`,
    `Sun;${at(s, 2000)};;auto;;;;`,
    `warp;${at(s, 3000)};;;;;;`,
    `nominal;soon;;;;;;`,
    `target;${at(s, 4000)};;;;;Nope;`,
  ].join('\r\n');
  const r = scheduleFromCSV(csv, o, s.sc.comps);
  assert.equal(r.rows, 5); assert.equal(r.changes.length, 3, 'two rows dropped');
  const [a, b, c] = r.changes;
  assert.deepEqual([a.mode, a.name, a.slew, a.tgtLat, a.tgtLon, a.tgtComp], ['target', 'Image "Warsaw"', 45, 52.2297, 21.0122, cam.id]);
  assert.equal(a.start, at(s, 900)); assert.equal(b.mode, 'sun'); assert.equal(b.autoSlew, true); assert.equal(b.tgtLat, o.tgtLat, 'an empty cell: the scenario value');
  assert.equal(c.tgtComp, o.tgtComp, 'an unknown part: the default');
  const rep = r.report.join(' | ');
  for (const want of ['Columns not used: comment', 'unknown guidance mode', 'no readable start time', 'no part named "Nope"']) assert.ok(rep.includes(want), `${want}: ${rep}`);
  assert.throws(() => scheduleFromCSV('mode,name\nsun,x', o, s.sc.comps), /utc/); assert.throws(() => scheduleFromCSV('', o, s.sc.comps), /empty/);
});

test('schedule CSV: rows and separators; adding to a schedule gives clashing ids new ones and keeps "after" pointing right', () => {
  assert.deepEqual(parseCSVRows('a\tb\n1\t"x\ty"\n').rows, [['a', 'b'], ['1', 'x\ty']]);
  assert.deepEqual(parseCSVRows('a,b\n"line\nbreak",2\n\n').rows, [['a', 'b'], ['line\nbreak', '2']]);
  const added = forAdding([{ id: 'a', on: null }, { id: 'n', on: { kind: 'after', ref: 'a', offset: 5 } }], [{ id: 'a' }]);
  assert.notEqual(added[0].id, 'a'); assert.equal(added[1].on.ref, added[0].id); assert.equal(added[1].id, 'n');
});
