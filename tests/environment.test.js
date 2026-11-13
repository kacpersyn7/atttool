import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ENV from '../src/env/index.js';
import { v } from '../src/core/linalg.js';
import { close, closeArr } from './helpers.js';

const D2R = Math.PI / 180;
const leo = { a: ENV.RE + 550, e: 0, i: 97.6 * D2R, raan: 0, argp: 0, nu0: 0 };

test('circular LEO: radius, speed and period', () => {
  const s = ENV.propagate(leo, 1000, false);
  close(v.norm(s.r), leo.a, 1e-6, '|r|');
  close(v.norm(s.v), Math.sqrt(ENV.MU / leo.a), 1e-9, '|v|');
  close(s.period / 60, 95.6, 0.1, 'period min');
  close(s.period, ENV.period(leo.a), 1e-9, 'period()');
});

test('propagation returns to start after one period (no J2)', () => {
  const s0 = ENV.propagate(leo, 0, false), s1 = ENV.propagate(leo, s0.period, false);
  close(v.norm(v.sub(s0.r, s1.r)), 0, 1e-6);
});

test('energy is conserved on an eccentric orbit', () => {
  const el = { a: 26600, e: 0.74, i: 63.4 * D2R, raan: 1, argp: 270 * D2R, nu0: 0 };
  const E = s => v.dot(s.v, s.v) / 2 - ENV.MU / v.norm(s.r);
  const e0 = E(ENV.propagate(el, 0, false));
  for (const t of [1000, 5000, 20000, 40000]) close(E(ENV.propagate(el, t, false)), e0, 1e-8, 't=' + t);
});

test('Kepler solver', () => {
  for (const e of [0, 0.1, 0.7, 0.95]) for (const M of [0.1, 1, 3, 6]) {
    const E = ENV.kepler(M, e); close(E - e * Math.sin(E), M, 1e-11);
  }
});

test('sun-synchronous inclination at 550 km is about 97.6°', () => {
  close(ENV.ssoInc(ENV.RE + 550) / D2R, 97.6, 0.05);
});

test('J2 RAAN drift of an SSO is ~0.9856°/day', () => {
  const el = { ...leo, i: ENV.ssoInc(leo.a) };
  const s = ENV.propagate(el, 86400, true);
  close(s.raan / D2R, 0.9856, 0.001);
});

// Orbital frames follow STK: https://help.agi.com/stk/Content/gator/eq-coordsys.htm
const ecc = { a: 9000, e: 0.2, i: 0.9, raan: 0.4, argp: 1.1, nu0: 0 };
const frameCase = () => { const s = ENV.propagate(ecc, 1500, false); return { s, rh: v.unit(s.r), hh: v.unit(v.cross(s.r, s.v)) }; };
const rightHanded = C => { close(v.dot(v.cross(C[0], C[1]), C[2]), 1, 1e-12, 'right-handed'); C.forEach((a, i) => close(v.norm(a), 1, 1e-12, 'unit ' + i)); };

test('VVLH (STK): Z = nadir, Y = −orbit normal, X toward velocity', () => {
  const { s, rh, hh } = frameCase(); const [x, y, z] = ENV.vvlh(s.r, s.v);
  close(v.dot(z, rh), -1, 1e-12); close(v.dot(y, hh), -1, 1e-12);
  close(v.dot(x, rh), 0, 1e-12); assert.ok(v.dot(x, s.v) > 0, 'X toward velocity');
  rightHanded([x, y, z]);
});

test('LVLH (STK): X = radial, Z = orbit normal, Y toward velocity', () => {
  const { s, rh, hh } = frameCase(); const [x, y, z] = ENV.lvlh(s.r, s.v);
  close(v.dot(x, rh), 1, 1e-12); close(v.dot(z, hh), 1, 1e-12);
  assert.ok(v.dot(y, s.v) > 0, 'Y toward velocity');
  rightHanded([x, y, z]);
});

test('VNC (STK): X = velocity, Y = orbit normal', () => {
  const { s, hh } = frameCase(); const [x, y, z] = ENV.vnc(s.r, s.v);
  close(v.dot(x, v.unit(s.v)), 1, 1e-12); close(v.dot(y, hh), 1, 1e-12);
  rightHanded([x, y, z]);
});

test('LVLH and VVLH differ by a fixed rotation', () => {
  // VVLH X = LVLH Y, VVLH Y = −LVLH Z, VVLH Z = −LVLH X
  const { s } = frameCase(); const L = ENV.lvlh(s.r, s.v), V = ENV.vvlh(s.r, s.v);
  for (let k = 0; k < 3; k++) { close(V[0][k], L[1][k], 1e-12); close(V[1][k], -L[2][k], 1e-12); close(V[2][k], -L[0][k], 1e-12); }
  // circular orbit: VVLH X is the velocity direction
  const c = ENV.propagate(leo, 123, false); close(v.dot(ENV.vvlh(c.r, c.v)[0], v.unit(c.v)), 1, 1e-9);
});

test('orbitFrame dispatches by id and falls back to VVLH', () => {
  const { s } = frameCase();
  for (const id of Object.keys(ENV.ORBIT_FRAMES)) assert.deepEqual(ENV.orbitFrame(id, s.r, s.v), ENV.ORBIT_FRAMES[id].fn(s.r, s.v));
  assert.deepEqual(ENV.orbitFrame('nope', s.r, s.v), ENV.vvlh(s.r, s.v));
});

test('Sun direction at the 2026 March equinox is near +X', () => {
  const s = ENV.sunECI(new Date('2026-03-20T14:46:00Z'));
  close(v.norm(s), 1, 1e-12);
  assert.ok(s[0] > 0.9999, 'x ' + s[0]);
});

test('Sun declination at June solstice ≈ +23.44°', () => {
  const s = ENV.sunECI(new Date('2026-06-21T08:24:00Z'));
  close(Math.asin(s[2]) / D2R, 23.44, 0.02);
});

test('Moon position matches Vallado Example 5-3 (1994-04-28 0h UTC)', () => {
  // Vallado, Fundamentals of Astrodynamics, Example 5-3 — same algorithm, so this checks the transcription (to 1 m);
  // the Meeus test below is the independent accuracy check
  closeArr(ENV.moonECI(new Date('1994-04-28T00:00:00Z')), [-134240.626, -311571.590, -126693.785], 1e-3);
});

test('Moon matches Meeus Example 47.a within the low-precision accuracy', () => {
  // Meeus, Astronomical Algorithms, Ex. 47.a: 1992-04-12 0h TD → λ 133.162655°, β −3.229126°, Δ 368409.7 km
  const m = ENV.moonECI(new Date(Date.UTC(1992, 3, 12) - 59e3)), d = v.norm(m), eps = 23.440636 * D2R;
  const y = Math.cos(eps) * m[1] + Math.sin(eps) * m[2], z = -Math.sin(eps) * m[1] + Math.cos(eps) * m[2];
  close(Math.atan2(y, m[0]) / D2R, 133.162655, 0.3);
  close(Math.asin(z / d) / D2R, -3.229126, 0.2);
  close(d, 368409.7, 0.005 * 368409.7);
});

test('GMST at J2000 epoch is 280.46°', () => {
  close(ENV.gmst(new Date('2000-01-01T12:00:00Z')) / D2R, 280.46061837, 1e-6);
});

test('behindEarth: nadir-ish directions are inside the Earth disc, horizontal ones are not', () => {
  const r = [7000, 0, 0]; // Earth angular radius asin(6378.137/7000) = 65.7°
  assert.equal(ENV.behindEarth(r, [-1, 0, 0]), true);
  assert.equal(ENV.behindEarth(r, v.unit([-Math.cos(60 * D2R), Math.sin(60 * D2R), 0])), true);
  assert.equal(ENV.behindEarth(r, v.unit([-Math.cos(70 * D2R), Math.sin(70 * D2R), 0])), false);
  assert.equal(ENV.behindEarth(r, [0, 0, 1]), false);
});

test('eclipse: behind Earth yes, beside Earth no', () => {
  const sun = [1, 0, 0];
  assert.equal(ENV.eclipse([-7000, 0, 0], sun), true);
  assert.equal(ENV.eclipse([-7000, 7000, 0], sun), false);
  assert.equal(ENV.eclipse([7000, 0, 0], sun), false);
});

test('ECEF <-> ECI round trip and lat/lon', () => {
  const d = new Date('2026-10-05T10:00:00Z');
  const p = ENV.llh2ecef(52.23 * D2R, 21.01 * D2R);
  const back = ENV.eci2ecef(ENV.ecef2eci(p, d), d);
  close(v.norm(v.sub(p, back)), 0, 1e-9);
  const ll = ENV.ecef2ll(p); close(ll.lat / D2R, 52.23, 1e-9); close(ll.lon / D2R, 21.01, 1e-9);
});

test('rayEarth hits nadir point and misses when looking away', () => {
  const hit = ENV.rayEarth([7000, 0, 0], [-1, 0, 0]); close(hit[0], ENV.RE, 1e-9);
  assert.equal(ENV.rayEarth([7000, 0, 0], [1, 0, 0]), null);
  close(ENV.rayEarth([7000, 0, 0], [-1, 0, 0], ENV.RE + 5)[0], ENV.RE + 5, 1e-9, 'other radius');
  // a ray passing 3 km above the Earth misses it and hits a sphere 5 km above it
  const o = [7000, ENV.RE + 3, 0];
  assert.equal(ENV.rayEarth(o, [-1, 0, 0]), null);
  close(ENV.rayEarth(o, [-1, 0, 0], ENV.RE + 5)[0], Math.sqrt((ENV.RE + 5) ** 2 - (ENV.RE + 3) ** 2), 1e-6, 'x at the hit');
});

test('dipole field: ~30 µT at the equator, twice that at the pole', () => {
  const d = new Date('2026-10-05T10:00:00Z');
  const eq = v.norm(ENV.bfieldECI([ENV.RE, 0, 0], d)), pole = v.norm(ENV.bfieldECI([0, 0, ENV.RE], d));
  assert.ok(eq > 25000 && eq < 40000, 'equator ' + eq);
  assert.ok(pole / eq > 1.6 && pole / eq < 2.1, 'ratio ' + pole / eq);
});

/* ---------------- state vectors and TLEs ---------------- */
import { rng } from './helpers.js';

test('rv2coe: Vallado example 2-5', () => {
  const c = ENV.rv2coe([6524.834, 6862.875, 6448.296], [4.901327, 5.533756, -1.976341]);
  close(c.a, 36127.343, 0.02); close(c.e, 0.832853, 1e-6);
  close(c.i / D2R, 87.870, 1e-3); close(c.raan / D2R, 227.898, 1e-3); close(c.argp / D2R, 53.38, 0.01); close(c.nu0 / D2R, 92.335, 1e-3);
});

test('rv2coe inverts propagate(el, 0), including circular / equatorial / retrograde orbits', () => {
  const rand = rng(7);
  const cases = [];
  for (let k = 0; k < 60; k++) cases.push({ a: 6700 + rand() * 30000, e: rand() * 0.8, i: rand() * Math.PI, raan: rand() * 6.28, argp: rand() * 6.28, nu0: rand() * 6.28 });
  cases.push({ a: 7000, e: 0, i: 1.7, raan: 1, argp: 0, nu0: 2 });        // circular
  cases.push({ a: 7000, e: 0.1, i: 0, raan: 0, argp: 1.2, nu0: 0.4 });    // equatorial
  cases.push({ a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu0: 4 });         // GEO: circular + equatorial
  cases.push({ a: 7000, e: 0.05, i: Math.PI, raan: 0, argp: 1, nu0: 2 }); // retrograde equatorial
  for (const el of cases) {
    const s = ENV.propagate(el, 0, false), c = ENV.rv2coe(s.r, s.v);
    assert.equal(c.error, undefined);
    const s2 = ENV.propagate(c, 0, false);
    close(v.norm(v.sub(s.r, s2.r)), 0, 1e-6, 'r'); close(v.norm(v.sub(s.v, s2.v)), 0, 1e-9, 'v');
    close(c.a, el.a, 1e-6 * el.a); close(c.e, el.e, 1e-9);
  }
});

test('rv2coe rejects open and degenerate trajectories', () => {
  assert.match(ENV.rv2coe([7000, 0, 0], [0, 11, 0]).error, /escape/);
  assert.match(ENV.rv2coe([7000, 0, 0], [3, 0, 0]).error, /radial/);
  assert.match(ENV.rv2coe([0, 0, 0], [7, 0, 0]).error, /non-zero/);
});

const ISS = 'ISS (ZARYA)\n1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';

test('TLE: ISS example (epoch, elements, checksum)', () => {
  const t = ENV.parseTLE(ISS);
  assert.equal(t.name, 'ISS (ZARYA)'); assert.equal(t.satnum, '25544');
  assert.equal(t.epoch.toISOString(), '2008-09-20T12:25:40.104Z');
  close(t.i, 51.6416, 0); close(t.raan, 247.4627, 0); close(t.e, 0.0006703, 0); close(t.argp, 130.536, 0); close(t.M, 325.0288, 0);
  close(t.n, 15.72125391, 0); close(t.bstar, -0.11606e-4, 1e-12);
  close(t.a - ENV.RE, 352.8, 0.5); // ~350 km in 2008
  assert.deepEqual(t.warnings, []);
});

test('TLE: bad checksum is a warning, garbage is an error', () => {
  const bad = ISS.replace('563537', '563530');
  assert.match(ENV.parseTLE(bad).warnings[0], /checksum/);
  assert.throws(() => ENV.parseTLE('hello'), /two lines/);
  assert.throws(() => ENV.parseTLE('1 25544U\n2 25544'), /69/);
});

test('meanToTrue: Kepler', () => {
  for (const e of [0, 0.1, 0.7]) for (const M of [0.3, 2, 5]) {
    const nu = ENV.meanToTrue(M, e), E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    close(((E - e * Math.sin(E)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), M, 1e-10);
  }
});

/* ---------- J2 secular drift of the mean anomaly (#72) ---------- */
import { orbitElements } from '../src/sim/scenario.js';
import { j2Rates, smaForMeanMotion } from '../src/env/orbit.js';

test('J2: the mean anomaly drifts at the first-order secular rate (Vallado eq. 9-41); J2 off is two-body', () => {
  const D2 = Math.PI / 180, el = { a: 7000, e: 0.01, i: 51.6 * D2, raan: 0.3, argp: 0.2, nu0: 0 }, t = 86400;
  const M = s => { const e = el.e, E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(s.nu / 2)); return E - e * Math.sin(E); };
  const r = j2Rates(el.a, el.e, el.i), n = Math.sqrt(ENV.MU / el.a ** 3);
  // by hand: 1.5 n J2 (R/p)² √(1−e²) (1 − 1.5 sin² i)
  const byHand = 1.5 * n * 1.08262668e-3 * (6378.137 / (el.a * (1 - el.e ** 2))) ** 2 * Math.sqrt(1 - el.e ** 2) * (1 - 1.5 * Math.sin(el.i) ** 2);
  assert.ok(Math.abs(r.M - byHand) < 1e-18); // Ṁ ~ 1e-7 rad/s: 1e-11 relative, rounding only assert.ok(r.M > 0, 'at 51.6° (sin² i < 2/3) it speeds the anomaly up');
  assert.ok(j2Rates(7000, 0, 98 * D2).M < 0, 'at 98° (sin² i > 2/3) it slows it down');
  const wrap = x => ((x % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  assert.ok(Math.abs(wrap(M(ENV.propagate(el, t, true)) - (n + r.M) * t)) < 1e-9, 'with J2');
  assert.ok(Math.abs(wrap(M(ENV.propagate(el, t, false)) - n * t)) < 1e-9, 'without J2: two-body');
});

test('J2: a TLE flies at its stated mean motion (ISS, 15.72125391 rev/day): one day later it has made exactly that many revolutions', () => {
  const s = { orbit: { def: 'tle', j2: true, tle: 'ISS (ZARYA)\n1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537' } };
  const E = orbitElements(s.orbit), nRev = 15.72125391, e = E.e; // columns 53-63 of line 2 (what follows is the revolution number and checksum)
  const M = st => { const Ea = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(st.nu / 2)); return Ea - e * Math.sin(Ea); };
  const wrap = x => ((x % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  assert.ok(Math.abs(wrap(M(ENV.propagate(E, 86400, true)) - M(ENV.propagate(E, 0, true)) - nRev * 2 * Math.PI)) < 1e-8);
  // SGP4 recovers the same a from a TLE (Spacetrack Report #3, initl: a0'' = 6731.4690 km for this one): first-order Kozai→Brouwer
  close(E.a, 6731.4690, 1e-3, 'within 1 m of SGP4');
  const aK = Math.cbrt(ENV.MU / (nRev * 2 * Math.PI / 86400) ** 2); assert.ok(E.a - aK > 0.4 && E.a - aK < 0.6, `+0.5 km at 51.6° (${(E.a - aK).toFixed(3)})`);
  const n98 = 14.57 * 2 * Math.PI / 86400, d98 = smaForMeanMotion(n98, 0.001, 98 * Math.PI / 180) - Math.cbrt(ENV.MU / n98 ** 2);
  assert.ok(d98 > -3.0 && d98 < -2.8, `−2.9 km at 98° (${d98.toFixed(3)})`);
  s.orbit.j2 = false; assert.ok(Math.abs(orbitElements(s.orbit).a - Math.cbrt(ENV.MU / (nRev * 2 * Math.PI / 86400) ** 2)) < 1e-9, 'J2 off: two-body');
});

test('repeat orbit solver: R orbits node to node while the Earth turns D times under the plane; no LEO root gives null', () => {
  const s = ENV.solveRepeatSSO(143, 10), r = j2Rates(s.a, 0, s.i);
  assert.ok(Math.abs(143 * 2 * Math.PI / (r.n + r.M + r.argp) - 10 * 2 * Math.PI / (ENV.WE - ENV.SUN_RATE)) < 1e-6, 'the two periods of the cycle agree (s)');
  assert.ok(Math.abs(r.raan - ENV.SUN_RATE) < 1e-15, 'sun-synchronous'); assert.equal(ENV.solveRepeatSSO(1, 1), null); assert.equal(ENV.solveRepeatSSO(0, 10), null);
});
