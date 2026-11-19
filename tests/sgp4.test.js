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
