/**
 * SGP4 / SDP4 (#91) against the reference's own verification: its 33 TLEs (near-Earth and deep space, resonant,
 * decaying and deliberately broken ones) and its published results (the Fortran run, columns t, r, v).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tleSatrec, sgp4At } from '../src/env/sgp4.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/sgp4');
const lines = fs.readFileSync(path.join(dir, 'SGP4-VER.TLE'), 'utf8').split(/\r?\n/), tles = [];
for (let k = 0; k < lines.length; k++) if (lines[k].startsWith('1 ') && (lines[k + 1] || '').startsWith('2 ')) { tles.push({ l1: lines[k], l2: lines[k + 1].slice(0, 69), num: lines[k].slice(2, 7).trim(), step: +lines[k + 1].slice(69).trim().split(/\s+/)[2] }); k++; }
const blocks = []; let cur = null;
for (const line of fs.readFileSync(path.join(dir, 'tforverf-rv.out'), 'utf8').split(/\r?\n/)) {
  if (line.startsWith('#')) continue;
  const m = line.match(/^(\d+)\s+xx$/); if (m) { cur = []; blocks.push({ num: m[1], rows: cur }); continue; }
  const f = line.trim().split(/\s+/).map(Number); if (cur && f.length === 7) cur.push(f);
}

test('SGP4: the reference verification set, to within a centimetre of its published results', () => {
  assert.equal(tles.length, 33); assert.equal(blocks.length, 33);
  let states = 0, worstR = 0, worstV = 0;
  tles.forEach((t, k) => {
    const b = blocks[k]; assert.equal(+b.num, +t.num, 'the results in the same order');
    const s = tleSatrec(t.l1, t.l2);
    if (t.num === '33334') {
      // n = 0.00001 rev/day: the lunar–solar terms make the eccentricity leave 0..1 at once. The 2021 C++ code this is
      // ported from calls dpper with 'n' in sgp4(), so the first call at t = 0 fails with error 3; the published row is the
      // state of the older code's initialisation call (init 'y', without those terms).
      assert.equal(sgp4At(s, 0), null); assert.equal(s.error, 3); return;
    }
    for (const [tm, x, y, z, vx, vy, vz] of b.rows) {
      const p = sgp4At(s, tm); assert.ok(p, `${t.num} at ${tm} min: error ${s.error}`);
      const dr = Math.max(Math.abs(p.r[0] - x), Math.abs(p.r[1] - y), Math.abs(p.r[2] - z)), dv = Math.max(Math.abs(p.v[0] - vx), Math.abs(p.v[1] - vy), Math.abs(p.v[2] - vz));
      assert.ok(dr < 1e-5 && dv < 1e-8, `${t.num} at ${tm} min: |Δr| ${dr.toExponential(2)} km, |Δv| ${dv.toExponential(2)} km/s`);
      worstR = Math.max(worstR, dr); worstV = Math.max(worstV, dv); states++;
    }
  });
  assert.ok(states > 650, `${states} states`); // measured: 666 states, worst 4.1e-6 km and 1.8e-9 km/s
});

test('SGP4: a TLE stops where the reference stops (decayed, or the elements leave their range)', () => {
  // the cases whose published results end before the requested span (decay, or e or the semi-latus rectum out of range)
  for (const num of ['22312', '28350', '28872', '29141', '33333', '20413']) {
    const k = tles.findLastIndex(t => t.num === num), last = blocks[k].rows.at(-1)[0]; // 20413 is in the set twice: the second runs 3.5 years on
    const s = tleSatrec(tles[k].l1, tles[k].l2); assert.ok(sgp4At(s, last), `${num} at ${last}`);
    // the reference printed no next step: it stopped before it
    let stopped = null; for (let tm = last; tm <= last + tles[k].step && !stopped; tm += tles[k].step / 50) if (!sgp4At(s, tm)) stopped = s.error;
    assert.ok(stopped, `${num} stops between ${last} and ${last + tles[k].step} min (error ${stopped})`);
  }
});

/* ---- in the app: a TLE scenario flies SGP4 ---- */
import * as ENV from '../src/env/index.js';
import { orbitElements, sgp4Problem, switchDefinition, epochDate } from '../src/sim/scenario.js';
import { attitudeAt } from '../src/sim/guidance.js';
import { defaultState, migrate } from '../src/state/store.js';
const ISS = 'ISS (ZARYA)\n1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
const tleState = text => { const s = defaultState(); migrate(s); s.orbit.def = 'tle'; s.orbit.tle = text; s.orbit.t = 0; return s; };

test('SGP4 in the app: a TLE scenario\'s spacecraft is where SGP4 puts it, J2 option or not', () => {
  const s = tleState(ISS), E = orbitElements(s.orbit); assert.ok(E.sgp4, 'the elements carry the SGP4 record');
  const ref = ENV.tleSatrec(...ISS.split('\n').slice(1));
  for (const t of [0, 3600, 86400]) {
    const r = attitudeAt(s, t).st.r, p = ENV.sgp4At(ref, t / 60 + E.sgp4.offMin).r;
    assert.ok(Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]) < 1e-9, `t = ${t} s`);
  }
  assert.ok(Math.abs(E.sgp4.offMin) < 1e-5, 'the epoch it counts from is the TLE\'s, to the millisecond');
  s.orbit.j2 = false; const r0 = attitudeAt(s, 3600).st.r; s.orbit.j2 = true; const r1 = attitudeAt(s, 3600).st.r;
  assert.deepEqual(r0, r1, 'SGP4 has its own perturbations');
  assert.equal(JSON.stringify(E).includes('"sgp4":"sgp4"'), true, 'keys made of the elements stay short');
});

test('SGP4 in the app: r, v filled from a TLE is SGP4\'s state at the epoch; a decayed TLE says why and falls back', () => {
  const s = tleState(ISS), st = ENV.propagate(orbitElements(s.orbit), 0, true);
  switchDefinition(s.orbit, 'rv'); assert.equal(s.orbit.rvOsc, true);
  assert.ok(Math.hypot(...s.orbit.r.map((x, i) => x - st.r[i])) < 1e-5, 'the TEME state, as osculating');
  assert.equal(epochDate(s.orbit).toISOString().slice(0, 19), '2008-09-20T12:25:40');
  // 28872 of the verification set decays within an hour
  const k = tles.findIndex(t => t.num === '28872'), d = tleState(tles[k].l1 + '\n' + tles[k].l2);
  assert.equal(sgp4Problem(d.orbit, 0), null);
  let tStop = null; for (let m = 50; m <= 60 && tStop === null; m += 0.1) if (sgp4Problem(d.orbit, m * 60)) tStop = m * 60; // the reference stops between 50 and 60 min
  assert.ok(tStop !== null); assert.match(sgp4Problem(d.orbit, tStop), /decayed|range|rectum|eccentricity/);
  assert.ok(attitudeAt(d, tStop).st.r.every(Number.isFinite), 'the mean-element model then');
});
