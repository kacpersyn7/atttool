import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import * as ENV from '../src/env/index.js';
import { close } from './helpers.js';
import { b64bytes, worldMap } from '../src/data/worldMap.js';
import { mapView, mapCamera, clipHorizon, clipLine, coastRuns } from '../src/sim/payloadMap.js';

const { v, m } = AM;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const date = new Date('2026-10-05T10:00:00Z');

/** Even-odd point in polygon for a flat [x, y, …] ring. */
function pip(r, x, y) {
  let c = false; const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
  return c;
}
const inPoly = (rings, x, y) => rings.reduce((c, r) => c !== pip(r, x, y), false);
const W = worldMap();
const bbox = W.land.map(p => { const r = p[0]; let a = [180, 90, -180, -90]; for (let i = 0; i < r.length; i += 2) a = [Math.min(a[0], r[i]), Math.min(a[1], r[i + 1]), Math.max(a[2], r[i]), Math.max(a[3], r[i + 1])]; return a; });
/** Reference: is (lon, lat) on land, straight from the decoded lon/lat polygons. */
const onLand = (lo, la) => W.land.some((p, k) => { const b = bbox[k]; return lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3] && inPoly(p, lo, la); });

/** Spacecraft at (lat, lon, h km) with the camera tilted `off` deg off nadir towards north; returns { CCI, r }. */
function camera(lat, lon, h, off = 0) {
  const r = ENV.ecef2eci(ENV.llh2ecef(lat * D2R, lon * D2R, h), date), up = v.unit(r);
  const northE = [-Math.sin(lat * D2R) * Math.cos(lon * D2R), -Math.sin(lat * D2R) * Math.sin(lon * D2R), Math.cos(lat * D2R)], north = ENV.ecef2eci(northE, date);
  const z = v.unit(v.add(v.scale(up, -Math.cos(off * D2R)), v.scale(north, Math.sin(off * D2R)))), x = v.unit(v.cross(north, z)), y = v.cross(z, x);
  return { CCI: [x, y, z], r };
}

/** Classify an N×N grid of image points as sky / sea / land, from the map output and from ray casting. */
function compare({ CCI, r }, half, N = 20, opts = {}) {
  const M = mapView(CCI, r, date, half, half, opts), CIC = m.T(CCI); let bad = 0; const count = { sky: 0, sea: 0, land: 0 };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = half * (2 * (i + .5) / N - 1), y = half * (2 * (j + .5) / N - 1);
    const hit = ENV.rayEarth(r, v.unit(m.mulv(CIC, [x, y, 1])));
    let truth = 'sky'; if (hit) { const ll = ENV.ecef2ll(ENV.eci2ecef(hit, date)); truth = onLand(ll.lon * R2D, ll.lat * R2D) ? 'land' : 'sea'; }
    const got = !(M.earth && pip(M.earth, x, y)) ? 'sky' : M.land.some(p => inPoly(p, x, y)) ? 'land' : 'sea';
    count[truth]++; if (got !== truth) bad++;
  }
  return { M, bad: bad / (N * N), count };
}

/* ---------- data ---------- */

test('map data: base64 decoder matches Node', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 255);
  for (const n of [0, 1, 2, 3, 299, 300]) assert.deepEqual(b64bytes(Buffer.from(bytes.subarray(0, n)).toString('base64')), bytes.subarray(0, n));
});

test('map data: cities at their known coordinates (within 0.1°)', () => {
  const ref = { Warsaw: [52.23, 21.01], Tokyo: [35.69, 139.69], Sydney: [-33.87, 151.21], 'New York': [40.71, -74.01], Nairobi: [-1.29, 36.82] };
  for (const [name, [la, lo]] of Object.entries(ref)) {
    const c = W.cities.find(c => c.name === name); assert.ok(c, name);
    assert.ok(Math.abs(c.lat - la) < 0.1 && Math.abs(c.lon - lo) < 0.1, `${name} at ${c.lat}, ${c.lon}`);
  }
  assert.equal(W.cities.find(c => c.name === 'Warsaw').kind, 2);
});

test('map data: land covers ~29 % of the Earth; exterior rings counter-clockwise, holes clockwise', () => {
  let land = 0, all = 0;
  for (let la = -89; la < 90; la += 2) for (let lo = -179; lo < 180; lo += 2) { const w = Math.cos(la * D2R); all += w; if (onLand(lo, la)) land += w; }
  // Land (incl. Antarctica, lakes counted as land: they are holes only in the lakes layer) is 148.9 of
  // 510.1 million km² = 0.292 of the Earth. The 2° sampling grid itself scatters by ~±0.005.
  close(land / all, 0.292, 0.01, 'land fraction');
  const area = r => { let a = 0; const n = r.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]; } return a; };
  for (const p of [...W.land, ...W.lakes]) p.forEach((r, k) => assert.equal(area(r) > 0, k === 0));
});

test('coastlines drop the artificial ±180° and South Pole edges', () => {
  const ring = Float64Array.from([170, 60, 180, 60, 180, 70, 170, 70]);
  assert.deepEqual(coastRuns(ring).map(r => Array.from(r)), [[180, 70, 170, 70, 170, 60, 180, 60]]);
  assert.equal(coastRuns(Float64Array.from([0, 0, 1, 0, 1, 1])).length, 1);
  assert.equal(coastRuns(Float64Array.from([0, 0, 1, 0, 1, 1]))[0].length, 8); // closed
});

/* ---------- clipping and projection ---------- */

test('payload map: a ring wholly beyond the horizon fills the disc exactly when it contains the sub-satellite point', () => {
  const cam0 = camera(0, 0, 550), cam = mapCamera(cam0.CCI, cam0.r, date, 1, 1);
  // a lon/lat square ring, all of it beyond the horizon (≈ 22.6° from the sub-satellite point at 550 km)
  const ring = (lo0, la0, d, ccw) => { const pts = []; const side = (a, b) => { for (let k = 0; k < 40; k++) pts.push([a[0] + (b[0] - a[0]) * k / 40, a[1] + (b[1] - a[1]) * k / 40]); };
    let c = [[lo0 - d, la0 - d], [lo0 + d, la0 - d], [lo0 + d, la0 + d], [lo0 - d, la0 + d]]; if (!ccw) c = c.reverse(); c.forEach((a, i) => side(a, c[(i + 1) % 4]));
    return { ll: Float64Array.from(pts.flat()), p4: pts.map(([lo, la]) => cam.P(v.unit(ENV.llh2ecef(la * D2R, lo * D2R)))) }; };
  for (const ccw of [true, false]) {
    const around = ring(0, 0, 40, ccw); assert.ok(around.p4.every(p => p[3] < 0));
    const r = clipHorizon(around.p4, cam, around.ll); assert.equal(r.length, 1); assert.ok(r[0].length > 100, 'around the nadir → full disc');
    const away = ring(120, 0, 30, ccw); assert.ok(away.p4.every(p => p[3] < 0));
    assert.equal(clipHorizon(away.p4, cam, away.ll).length, 0, 'not around the nadir → nothing');
  }
});

test('payload map: a line is clipped exactly at the view edge', () => {
  const F = [p => p[3], p => p[2] - p[0], p => p[2] + p[0], p => p[2] - p[1], p => p[2] + p[1]];
  const runs = clipLine([[-2, 0, 1, 1], [2, 0, 1, 1]], F);
  assert.equal(runs.length, 1); close(runs[0][0][0], -1, 1e-12); close(runs[0][1][0], 1, 1e-12);
  assert.equal(clipLine([[0, 0, 1, -1], [0.5, 0, 1, -1]], F).length, 0, 'below the horizon');
});

test('payload map: target mode on Warsaw puts the Warsaw city dot at the image centre', () => {
  const c = W.cities.find(c => c.name === 'Warsaw');
  const tgt = ENV.ecef2eci(ENV.llh2ecef(c.lat * D2R, c.lon * D2R), date), sc = camera(50, 25, 550);
  const z = v.unit(v.sub(tgt, sc.r)), x = v.unit(v.cross([0, 0, 1], z)), CCI = [x, v.cross(z, x), z];
  const M = mapView(CCI, sc.r, date, 0.05, 0.05), w = M.cities.find(k => k.name === 'Warsaw');
  assert.ok(w && Math.hypot(w.x, w.y) < 1e-9, JSON.stringify(w));
  assert.ok(M.land.length > 0, 'Warsaw is on land');
});

test('payload map: land / sea / sky match ray casting (nadir, oblique, limb in view, all-hidden coast, ocean, poles, ±180°, high orbits)', () => {
  const cases = [
    ['Afro-Eurasia contains the antipode, from 1500 km', camera(-65, -10, 1500), 0.1],
    ['GEO full disc', camera(0, -150, 35786), 0.17],
    ['GEO full disc, level of detail for a 250 px image', camera(0, -150, 35786), 0.17, { px: 250 }],
    ['1500 km, level of detail for a 250 px image', camera(-65, -10, 1500), 0.1, { px: 250 }],
    ['South Pole nadir', camera(-89.9, 0, 550), 0.3],
    ['Chukotka across ±180°', camera(66, -179.5, 550), 0.3],
    ['Fiji across ±180°', camera(-17, 179.5, 550), 0.3],
    ['Warsaw nadir', camera(52.2, 21, 550), 0.05],
    ['Strait of Gibraltar, 45° off nadir', camera(30, -5.5, 550, 45), 0.08],
    ['Chad from 200 km: no coast within the horizon', camera(15, 19, 200), 0.3],
    ['Pacific: no land', camera(0, -150, 550), 0.3],
    ['Norway coast with the limb in view', camera(55, 8, 550, 60), 0.5],
  ];
  for (const [name, cam, half, opts] of cases) {
    const { bad, count, M } = compare(cam, half, 20, opts);
    // ≤ 2 of 400 samples: the reference tests lon/lat polygons in the plane, the map clips 3-D chords,
    // so a sample right on a coastline can fall either way
    assert.ok(bad <= 2 / 400, `${name}: ${(100 * bad).toFixed(2)} % of samples differ ${JSON.stringify(count)}`);
    if (name.startsWith('Chad')) assert.equal(count.land, 400, 'all land');
    if (name.startsWith('Pacific')) assert.equal(M.land.length, 0);
    if (name.startsWith('Afro') || name.startsWith('1500')) assert.equal(count.land, 0, 'all sea');
    if (name.startsWith('GEO')) assert.ok(count.sky > 0 && count.land > 0 && count.sea > 0, JSON.stringify(count));
    if (name.startsWith('Norway')) assert.ok(count.sky > 0 && count.land > 0 && count.sea > 0, JSON.stringify(count));
  }
});

test('payload map: a camera looking away from the Earth sees no map', () => {
  const { CCI, r } = camera(30, 30, 550, 150), M = mapView(CCI, r, date, 0.3, 0.3);
  assert.equal(M.earth, null); assert.equal(M.land.length + M.coast.length + M.cities.length, 0);
});
