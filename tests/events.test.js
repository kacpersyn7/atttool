import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import * as ENV from '../src/env/index.js';
import { close } from './helpers.js';
import { firstRise, resolveEventStarts, shadowMargin, cleanOn } from '../src/sim/events.js';
import { applyPreset, epochDate, orbitElements, parseEpoch, targetECEF } from '../src/sim/scenario.js';
import { scheduleHistory, scheduleNotes, setChangeStart, nudgeChange } from '../src/sim/schedule.js';
import { cleanSchedule } from '../src/sim/scenarioLibrary.js';
import { defaultState, migrate } from '../src/state/store.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const fresh = (preset = 'sso1030') => { const s = defaultState(); migrate(s); applyPreset(s.orbit, preset); s.orbit.t = 0; return s; };
const at = (s, t) => new Date(epochDate(s.orbit).getTime() + t * 1000).toISOString().slice(0, 19);
const tOf = (s, str) => (parseEpoch(str).getTime() - epochDate(s.orbit).getTime()) / 1000;
const ch = (s, id, on, extra = {}) => ({ id, start: at(s, 0), slew: 0, mode: 'sun', tgtLat: s.orbit.tgtLat, tgtLon: s.orbit.tgtLon, tgtAlt: 0, on, ...extra });
const ecl = (s, t) => { const E = orbitElements(s.orbit), d = new Date(epochDate(s.orbit).getTime() + t * 1000); return ENV.eclipse(ENV.propagate(E, t, true).r, ENV.sunECI(d)); };

test('shadow margin: negative exactly in the cylindrical shadow, and continuous at the terminator', () => {
  const sun = [1, 0, 0], R = ENV.RE;
  for (const r of [[-7000, 0, 0], [-7000, 6000, 0], [-7000, 6400, 0], [7000, 0, 0], [0, 7000, 0], [-1, 7000, 0]]) assert.equal(shadowMargin(r, sun) < 0, ENV.eclipse(r, sun), JSON.stringify(r));
  close(shadowMargin([1e-9, 7000, 0], sun), shadowMargin([-1e-9, 7000, 0], sun), 1e-6); close(shadowMargin([0, 7000, 0], sun), 7000 - R, 1e-9);
});

test('first rise: found to the tolerance, also when it lasts less than the search step', () => {
  close(firstRise(t => t - 1234.5, 0, 5000, 20), 1234.5, 0.05);
  close(firstRise(t => 0.5 - Math.abs(t - 1003.3), 0, 5000, 20), 1002.8, 0.06, 'a one-second rise between 20 s samples');
  assert.equal(firstRise(t => -1, 0, 5000, 20), null);
  close(firstRise(t => Math.sin(t / 100 + 0.5), 0, 2000, 20), 100 * (2 * Math.PI - 0.5), 0.05, 'already up at the start: the next rise');
});

test('eclipse entry and exit: the shadow begins and ends there, and the eclipse lasts 2·acos(√(r²−Rₑ²)/(r cos β))/u̇ (circular, cylindrical shadow)', () => {
  const s = fresh('sso1200'), o = s.orbit; // noon–midnight: β small, the longest eclipses
  o.schedule = [ch(s, 'in', { kind: 'eclipseIn', from: at(s, 0), offset: 0 }), ch(s, 'out', { kind: 'eclipseOut', from: at(s, 0), offset: 0 })];
  resolveEventStarts(s);
  const tin = tOf(s, o.schedule[0].start), tout0 = tOf(s, o.schedule[1].start);
  assert.ok(!ecl(s, tin - 1) && ecl(s, tin + 1), 'enters the shadow there'); assert.ok(ecl(s, tout0 - 1) && !ecl(s, tout0 + 1), 'leaves it there');
  o.schedule[1].on.from = o.schedule[0].start; resolveEventStarts(s); const tout = tOf(s, o.schedule[1].start); // the exit after that entry
  const E = orbitElements(o), r = ENV.j2Rates(E.a, 0, E.i), d = new Date(epochDate(o).getTime() + tin * 1000), st = ENV.propagate(E, tin, true);
  const beta = ENV.betaAngle(st.r, st.v, ENV.sunECI(d)), rr = AM.v.norm(st.r);
  const want = 2 * Math.acos(Math.sqrt(rr * rr - ENV.RE ** 2) / (rr * Math.cos(beta))) / (r.n + r.M + r.argp);
  close(tout - tin, want, 5, `eclipse ${(tout - tin).toFixed(0)} s, formula ${want.toFixed(0)} s (whole-second starts, the Sun moving)`);
});

test('target rise and set: the change starts as the target crosses the elevation; an offset moves it', () => {
  const s = fresh(), o = s.orbit, E = orbitElements(o);
  const elev = t => { const d = new Date(epochDate(o).getTime() + t * 1000), tI = ENV.ecef2eci(targetECEF(o), d), los = AM.v.sub(tI, ENV.propagate(E, t, true).r); return 90 - AM.v.angle(tI, AM.v.scale(los, -1)) * R2D; };
  o.schedule = [ch(s, 'r', { kind: 'rise', from: at(s, 0), offset: 0, elev: 10 }), ch(s, 's', { kind: 'set', from: at(s, 0), offset: 0, elev: 10 }), ch(s, 'p', { kind: 'rise', from: at(s, 0), offset: -60, elev: 10 })];
  resolveEventStarts(s); const tr = tOf(s, o.schedule[0].start), ts = tOf(s, o.schedule[1].start);
  assert.ok(elev(tr - 1) < 10 && elev(tr) >= 10 - 1e-3, `rises through 10° (${elev(tr - 1).toFixed(3)} → ${elev(tr).toFixed(3)})`);
  assert.ok(elev(ts - 1) > 10 && elev(ts) <= 10 + 1e-3, 'sets through 10°'); assert.ok(ts > tr);
  assert.equal(tOf(s, o.schedule[2].start), tr - 60, '60 s before the rise');
});

test('after another change: follows it (chains too); a cycle or a missing change falls back and is marked', () => {
  const s = fresh(), o = s.orbit;
  o.schedule = [ch(s, 'a', undefined, { start: at(s, 1000) }), ch(s, 'b', { kind: 'after', ref: 'a', offset: 300, from: at(s, 0) }), ch(s, 'c', { kind: 'after', ref: 'b', offset: -100, from: at(s, 0) })];
  resolveEventStarts(s); assert.deepEqual(o.schedule.map(c => tOf(s, c.start)), [1000, 1300, 1200]);
  o.schedule[0].start = at(s, 2000); resolveEventStarts(s); assert.deepEqual(o.schedule.map(c => tOf(s, c.start)), [2000, 2300, 2200], 'follows when it moves');
  o.schedule = [ch(s, 'x', { kind: 'after', ref: 'y', offset: 10, from: at(s, 50) }), ch(s, 'y', { kind: 'after', ref: 'x', offset: 10, from: at(s, 70) }), ch(s, 'z', { kind: 'after', ref: 'gone', offset: 10, from: at(s, 90) })];
  resolveEventStarts(s); assert.ok(o.schedule.some(c => c.on.miss), 'the cycle is marked'); assert.equal(o.schedule[2].on.miss, true); assert.equal(tOf(s, o.schedule[2].start), 90);
  assert.deepEqual(scheduleNotes(o).z, ['miss']);
});

test('not found: starts at its search time, marked; an orbit edit moves an event start', () => {
  const s = fresh('ssodd'), o = s.orbit; o.schedule = [ch(s, 'e', { kind: 'eclipseIn', from: at(s, 0), offset: 0 })];
  let any = false; for (let t = 0; t < 2 * 86400 && !any; t += 20) any = ecl(s, t);
  resolveEventStarts(s);
  if (!any) { assert.equal(o.schedule[0].on.miss, true); assert.equal(tOf(s, o.schedule[0].start), 0); } else assert.ok(!o.schedule[0].on.miss);
  const u = fresh('sso1200'); u.orbit.schedule = [ch(u, 'e', { kind: 'eclipseOut', from: at(u, 0), offset: 0 })]; resolveEventStarts(u); const t1 = u.orbit.schedule[0].start;
  u.orbit.hp = u.orbit.ha = 800; u.orbit.preset = 'custom'; resolveEventStarts(u); assert.notEqual(u.orbit.schedule[0].start, t1, 'a higher orbit leaves the shadow at another time');
});

test('editing an event start moves where it looks from (or the offset of "after"), and undo brings it back; import keeps valid events', () => {
  const s = fresh('sso1200'), o = s.orbit, h = scheduleHistory();
  o.schedule = [ch(s, 'a', undefined, { start: at(s, 1000) }), ch(s, 'e', { kind: 'eclipseOut', from: at(s, 0), offset: 0 }), ch(s, 'b', { kind: 'after', ref: 'a', offset: 300, from: at(s, 0) })];
  resolveEventStarts(s); const first = o.schedule[1].start;
  h.record(o, () => setChangeStart(o, 'e', at(s, tOf(s, first) + 60))); assert.equal(tOf(s, o.schedule[1].on.from), tOf(s, first) + 60); resolveEventStarts(s);
  assert.ok(tOf(s, o.schedule[1].start) > tOf(s, first) + 60, 'the next exit after the new search time');
  h.undo(o); resolveEventStarts(s); assert.equal(o.schedule[1].start, first, 'undo: the first exit again');
  setChangeStart(o, 'b', at(s, 1500)); assert.equal(o.schedule[2].on.offset, 500); nudgeChange(o, 'b', 60); assert.equal(o.schedule[2].on.offset, 560);
  const ex = o.schedule[1].start, from = o.schedule[1].on.from; nudgeChange(o, 'e', 60); resolveEventStarts(s);
  assert.equal(o.schedule[1].on.offset, 60, '+1 min on an event change: its offset'); assert.equal(o.schedule[1].on.from, from); assert.equal(tOf(s, o.schedule[1].start), tOf(s, ex) + 60, 'the same exit, a minute later');
  const ids = new Set(['a', 'b']);
  assert.deepEqual(cleanOn({ kind: 'rise', from: at(s, 5), offset: 1e9, elev: 120 }, ids), { kind: 'rise', from: at(s, 5), offset: 21600, elev: 89 });
  assert.equal(cleanOn({ kind: 'after', ref: 'nope', offset: 1 }, ids), null); assert.equal(cleanOn({ kind: 'warp' }, ids), null); assert.equal(cleanOn({ kind: 'eclipseIn', from: 'soon' }, ids), null);
  const rep = []; const c = cleanSchedule([{ id: 'a', start: at(s, 10), mode: 'sun' }, { id: 'b', start: at(s, 20), mode: 'sun', on: { kind: 'after', ref: 'a', offset: 5 } }, { id: 'c', start: at(s, 30), mode: 'sun', on: { kind: 'warp' } }], o, null, rep);
  assert.deepEqual(c[1].on, { kind: 'after', from: null, offset: 5, ref: 'a' }); assert.equal('on' in c[2], false); assert.ok(rep.join().includes('event was not valid'), rep.join());
});
