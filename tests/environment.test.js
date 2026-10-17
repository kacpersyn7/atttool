import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ENV from '../src/env/index.js';
import { v } from '../src/core/linalg.js';
import { close } from './helpers.js';

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

test('LVLH: z nadir, y = -orbit normal, right-handed', () => {
  const s = ENV.propagate(leo, 123, false); const C = ENV.lvlh(s.r, s.v);
  const [x, y, z] = C;
  close(v.dot(z, v.unit(s.r)), -1, 1e-12);
  close(v.dot(y, v.unit(v.cross(s.r, s.v))), -1, 1e-12);
  close(v.dot(v.cross(x, y), z), 1, 1e-12);
  close(v.dot(x, v.unit(s.v)), 1, 1e-9); // circular: x along velocity
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

test('GMST at J2000 epoch is 280.46°', () => {
  close(ENV.gmst(new Date('2000-01-01T12:00:00Z')) / D2R, 280.46061837, 1e-6);
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
});

test('dipole field: ~30 µT at the equator, twice that at the pole', () => {
  const d = new Date('2026-10-05T10:00:00Z');
  const eq = v.norm(ENV.bfieldECI([ENV.RE, 0, 0], d)), pole = v.norm(ENV.bfieldECI([0, 0, ENV.RE], d));
  assert.ok(eq > 25000 && eq < 40000, 'equator ' + eq);
  assert.ok(pole / eq > 1.6 && pole / eq < 2.1, 'ratio ' + pole / eq);
});
