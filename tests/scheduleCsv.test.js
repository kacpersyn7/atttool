import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleScheduleCSV, forAdding, parseCSVRows, scheduleFromCSV, scheduleToCSV } from '../src/sim/scheduleCsv.js';
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
    // what each mode flies on comes back; settings kept for other modes come back as the scenario's
    const flies = { offsets: ['roll', 'pitch', 'yaw'], target: ['tgtLat', 'tgtLon', 'tgtAlt', 'tgtComp', 'tgtSlew'], sun: ['sunAxis', 'sunSecAxis', 'sunSec'], inertial: ['q'] };
    const want = o.schedule.map(c => { const w = { ...c }; for (const k of ['roll', 'pitch', 'yaw', 'sunAxis', 'sunSecAxis', 'sunSec', 'tgtLat', 'tgtLon', 'tgtAlt', 'tgtComp', 'tgtSlew']) if (!flies[c.mode].includes(k)) w[k] = o[k]; return w; });
    assert.deepEqual(q12(back.changes), q12(want), `comma ${comma}: the same schedule`);
  }
  assert.ok(scheduleToCSV(o, s.sc.comps).includes('"Charge, then image"'), 'a name with the separator is quoted');
  const lines = scheduleToCSV(o, s.sc.comps).slice(1).split('\n'), head = lines[0].split(','), row = k => Object.fromEntries(head.map((h, i) => [h, parseCSVRows(lines[k]).rows[0][i] ?? '']));
  assert.equal(row(1).sun_axis, str.name, 'parts by name');
  assert.deepEqual([row(1).target_lat_deg, row(1).roll_deg, row(1).q_w], ['', '', ''], 'a sun row: only the sun columns');
  assert.deepEqual([row(2).target_lat_deg, row(2).pointing_part, row(2).sun_axis], ['-33.87', cam.name, ''], 'a target row: only the target columns');
  assert.deepEqual([row(4).roll_deg, row(4).target_lat_deg], ['25.5', ''], 'a nominal row');
  assert.deepEqual(head.slice(0, 9), ['utc', 'name', 'mode', 'slew_s', 'event', 'event_from_utc', 'event_offset_s', 'event_elev_deg', 'event_after'], 'common columns first');
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
  for (const want of ['Columns not used: comment', 'Line 4: unknown mode "warp"', 'Line 5: the start "soon"', 'Line 6: no part named "Nope"']) assert.ok(rep.includes(want), `${want}: ${rep}`);
  assert.throws(() => scheduleFromCSV('mode,name\nsun,x', o, s.sc.comps), /utc/); assert.throws(() => scheduleFromCSV('', o, s.sc.comps), /empty/);
});

test('schedule CSV: rows and separators; adding to a schedule gives clashing ids new ones and keeps "after" pointing right', () => {
  assert.deepEqual(parseCSVRows('a\tb\n1\t"x\ty"\n').rows, [['a', 'b'], ['1', 'x\ty']]);
  assert.deepEqual(parseCSVRows('a,b\n"line\nbreak",2\n\n').rows, [['a', 'b'], ['line\nbreak', '2']]);
  const added = forAdding([{ id: 'a', on: null }, { id: 'n', on: { kind: 'after', ref: 'a', offset: 5 } }], [{ id: 'a' }]);
  assert.notEqual(added[0].id, 'a'); assert.equal(added[1].on.ref, added[0].id); assert.equal(added[1].id, 'n');
});

test('schedule CSV: Excel details (byte-order mark, formula-like cells, CR line ends, Unicode minus) and exact numbers', () => {
  const s = fresh(), o = s.orbit;
  o.schedule = [{ id: 'a', start: at(s, 600), slew: 1 / 3, mode: 'sun', name: '=SUM(A1)', sunAxis: '+X', sunSecAxis: '-Z', sunSec: 'nadir', roll: 0, pitch: 0, yaw: 0, tgtLat: 52.23, tgtLon: 21.01, tgtAlt: 0, tgtComp: '', tgtSlew: 60 }];
  const csv = scheduleToCSV(o, s.sc.comps);
  assert.ok(csv.startsWith('﻿utc,'), 'a byte-order mark, then the header');
  assert.ok(csv.includes(",'=SUM(A1),") && csv.includes(",'+X,") && csv.includes(",'-Z,"), 'formula-like text gets a leading quote');
  assert.ok(!/,'-?\d/.test(csv), 'numbers do not');
  const back = scheduleFromCSV(csv.replace(/\n/g, '\r'), o, s.sc.comps);
  assert.deepEqual(back.report, []);
  const [c] = back.changes;
  assert.deepEqual([c.name, c.sunAxis, c.sunSecAxis, c.slew, c.tgtComp], ['=SUM(A1)', '+X', '-Z', 1 / 3, ''], 'the quote is dropped; the number is exact; default part');
  assert.deepEqual(parseCSVRows('﻿"utc";x\r1;2\r').rows, [['utc', 'x'], ['1', '2']], 'a quoted header after a BOM; CR-only lines');
});

test('schedule CSV: empty mode, events (any case, Unicode minus, no from), inertial without q, a "default" part over a base part', () => {
  const s = fresh(), o = s.orbit, cam = s.sc.comps.find(c => c.type === 'payload');
  o.mode = 'target'; o.tgtComp = cam.id;
  const q0 = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };
  const csv = [
    'utc,mode,event,event_offset_s,event_elev_deg,pointing_part,roll_deg',
    `${at(s, 600)},,RISE,−60,10,default,`,
    `${at(s, 1200)},inertial,,,,,`,
    `${at(s, 1800)},nominal,eclipseout,ten,,,abc`,
  ].join('\n');
  const r = scheduleFromCSV(csv, o, s.sc.comps, q0), [a, b, c] = r.changes;
  assert.equal(a.mode, 'target', 'an empty mode: the scenario mode');
  assert.deepEqual(a.on, { kind: 'rise', from: at(s, 600), offset: -60, elev: 10 }, 'kind in any case; the Unicode minus; from defaults to the start');
  assert.equal(a.tgtComp, '', '"default" is kept over the scenario part');
  for (const k of ['w', 'x', 'y', 'z']) assert.ok(Math.abs(b.q[k] - q0[k]) < 1e-12, 'inertial without q: the Rotation Lab attitude');
  assert.equal(c.on.kind, 'eclipseOut'); assert.equal(c.on.offset, 0); assert.equal(c.roll, o.roll);
  const rep = r.report.join(' | ');
  for (const want of ["Line 3: no inertial attitude (q_w … q_z), so Rotation Lab's", 'Line 4: event_offset_s "ten" is not a number', 'Line 4: roll_deg "abc" is not a number']) assert.ok(rep.includes(want), `${want}: ${rep}`);
});

test('schedule CSV: unused cells are reported but kept; part:Name or Name in any part column; a rise event keeps its target place; the example file reads cleanly', () => {
  const s = fresh(), o = s.orbit, cam = s.sc.comps.find(c => c.type === 'payload'), str = s.sc.comps.find(c => c.type === 'str');
  const csv = [
    'utc,mode,sun_axis,pointing_part,roll_deg,target_lat_deg,event',
    `${at(s, 600)},target,,part:${cam.name},,10,`,
    `${at(s, 1200)},sun,${str.name},,5,,`,
    `${at(s, 1800)},sun,part:${str.name},default,,40,rise`,
    `${at(s, 2400)},nominal,Banana,,,,`,
  ].join('\n');
  const r = scheduleFromCSV(csv, o, s.sc.comps), [a, b, c, d] = r.changes;
  assert.equal(a.tgtComp, cam.id); assert.equal(b.sunAxis, 'comp:' + str.id); assert.equal(c.sunAxis, 'comp:' + str.id);
  assert.equal(b.roll, 5, 'kept'); assert.equal(c.tgtLat, 40, 'a rise event uses its target place');
  const rep = r.report.join(' | ');
  assert.ok(rep.includes("roll_deg is filled on line 3, where the mode doesn't use it"), rep);
  assert.ok(!rep.includes('target_lat_deg is filled') && !rep.includes('pointing_part is filled'), 'the place of a rise event and "default" are not reported: ' + rep);
  assert.ok(rep.includes('Line 5: "Banana" is neither an axis'), rep); assert.equal(d.sunAxis, o.sunAxis);
  const ex = scheduleFromCSV(exampleScheduleCSV({ ...o, t: 0 }, s.sc.comps), o, s.sc.comps);
  assert.deepEqual(ex.report, []); assert.deepEqual(ex.changes.map(x => x.mode), ['offsets', 'target', 'sun', 'inertial']);
  assert.deepEqual(ex.changes[3].on, { kind: 'after', from: null, offset: 1200, ref: 'ex3' });
  assert.equal(ex.changes[2].on.kind, 'eclipseOut'); assert.equal(ex.changes[0].roll, 20);
});
