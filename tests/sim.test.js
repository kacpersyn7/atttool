import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import { defaultSC } from '../src/spacecraft/exampleSpacecraft.js';
import { compAxis, mkComp, fillParams, sanitizeSpacecraft } from '../src/spacecraft/component.js';
import { sensorEval } from '../src/sim/sensors.js';
import * as ENV from '../src/env/index.js';
import { applyPreset, orbitElements, ltanOf, PRESETS, targetHeight } from '../src/sim/scenario.js';
import { defaultState } from '../src/state/store.js';
import { hhmm } from '../src/ui/format.js';
import { attitudeAt, payloadComp, bodyRate } from '../src/sim/guidance.js';
import { computeTimeline, timelineKey } from '../src/sim/timeline.js';
import { close, closeArr } from './helpers.js';
import { pointing, project, payloadView, gridStep, groundRelVel } from '../src/sim/payload.js';

function state(mode = 'offsets', preset = 'sso1030') {
  const s = {
    rot: { q: AM.q.id() },
    orbit: { epoch: '2026-10-05T10:00', hp: 550, ha: 550, i: 97.6, raan: 0, argp: 0, nu0: 0, j2: true, t: 0, mode, refFrame: 'vvlh', roll: 0, pitch: 0, yaw: 0, sunAxis: '-Z', sunSec: 'nadir', tgtLat: 52.23, tgtLon: 21.01, tgtComp: '' },
    sc: defaultSC(),
  };
  applyPreset(s.orbit, preset);
  return s;
}

test('presets apply and SSO LTAN matches the preset', () => {
  for (const k of Object.keys(PRESETS)) { const s = state('offsets', k); assert.equal(s.orbit.preset, k); }
  close(ltanOf(state('offsets', 'sso1030').orbit), 10.5, 0.02);
  close(ltanOf(state('offsets', 'ssodd').orbit), 6, 0.02);
  for (const [k, h] of [['sso1100', 11], ['sso1200', 12], ['sso1330', 13.5], ['sso2230', 22.5], ['ssodn', 18]]) close(ltanOf(state('offsets', k).orbit), h, 0.02, k);
});

test('orbitElements: altitudes -> a, e', () => {
  const E = orbitElements({ hp: 600, ha: 39800, i: 63.4, raan: 0, argp: 0, nu0: 0 });
  assert.ok(E.e > 0.7 && E.e < 0.75);
});

test('offsets mode, VVLH, zero offsets: payload (+Z) points at the Earth centre', () => {
  const s = state('offsets'); const A = attitudeAt(s, 500);
  const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]);
  close(AM.v.dot(zI, AM.v.unit(A.st.r)), -1, 1e-12);
});

test('roll offset tilts the boresight by that angle', () => {
  const s = state('offsets'); s.orbit.roll = 25; const A = attitudeAt(s, 500);
  const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]);
  close(Math.acos(-AM.v.dot(zI, AM.v.unit(A.st.r))) * AM.R2D, 25, 1e-9);
});

test('alignment = LVLH identity: zero offsets put body X radial out and Z on the orbit normal', () => {
  const s = state('offsets'); s.sc.align = { ref: 'lvlh', mode: 'axes', x: '+X', y: '+Y' }; s.orbit.refFrame = 'lvlh'; const A = attitudeAt(s, 700);
  closeArr(A.CBI, A.CRI, 1e-15);
  const xI = AM.m.mulv(AM.m.T(A.CBI), [1, 0, 0]); close(AM.v.dot(xI, AM.v.unit(A.st.r)), 1, 1e-12);
});

test('target mode below the horizon holds the nominal attitude', () => {
  const s = state('target'); s.orbit.refFrame = 'lvlh'; s.orbit.tgtLat = -60; s.orbit.tgtLon = 150;
  const A = attitudeAt(s, 0); assert.ok(A.flag.below); closeArr(A.CBI, A.CNI, 1e-15); closeArr(A.CBI, A.CVI, 1e-15); // default = VVLH
});

test('hhmm rounds across the hour and the day', () => {
  for (const [h, t] of [[10.5, '10:30'], [10.9999, '11:00'], [5.9999, '06:00'], [11, '11:00'], [10.99, '10:59'], [23.9999, '00:00'], [0, '00:00'], [13.5, '13:30']]) assert.equal(hhmm(h), t, String(h));
});

test('orbit presets match published values', () => {
  const E = k => orbitElements(state('offsets', k).orbit), period = e => 2 * Math.PI * Math.sqrt(e.a ** 3 / ENV.MU);
  close(state('offsets', 'sso2230').orbit.i, 98.6, 0.1, 'Sentinel-2 inclination 98.62°');
  close(period(E('meo')) / 60, 717.98, 0.5, 'half a sidereal day (GPS): 11 h 58 min');
  close(period(E('gto')) / 3600, 10.5, 0.2, 'GTO period about 10.5 h');
  close(E('gto').e, 0.73, 0.01, 'GTO eccentricity');
  close(period(E('geo')) / 60, 1436.07, 0.5, 'GEO: one sidereal day');
});

test('nominal attitude from the alignment table flies the payload at nadir', () => {
  const s = state('offsets'); s.sc.align = { ref: 'lvlh', mode: 'axes', x: '-Z', y: '+X' }; // = VVLH with the bus as built
  for (const t of [0, 1500, 4000]) {
    const A = attitudeAt(s, t); closeArr(A.CBI, A.CVI, 1e-12);
    const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]); close(AM.v.dot(zI, AM.v.unit(A.st.r)), -1, 1e-12);
  }
});

test('nominalDirections agree with the flown nominal attitude for every reference frame', async () => {
  const { nominalDirections } = await import('../src/spacecraft/alignment.js');
  const s = state('offsets');
  for (const ref of ['vvlh', 'lvlh', 'vnc']) {
    s.sc.align = { ref, mode: 'dcm', dcm: AM.q2C(AM.axisAngle2q([1, -2, 0.5], 0.9)) };
    const A = attitudeAt(s, 800), d = nominalDirections(s.sc.align);
    closeArr(AM.m.mulv(A.CBI, AM.v.unit(AM.v.scale(A.st.r, -1))), d.nadir, 2e-3, ref + ' nadir');
    closeArr(AM.m.mulv(A.CBI, AM.v.unit(AM.v.cross(A.st.r, A.st.v))), d.normal, 1e-9, ref + ' normal');
  }
});

test('offsets are applied on top of the nominal attitude', () => {
  const s = state('offsets'); s.sc.align = { ref: 'lvlh', mode: 'axes', x: '-Z', y: '+X' }; s.orbit.roll = 25;
  const A = attitudeAt(s, 500); const zI = AM.m.mulv(AM.m.T(A.CBI), [0, 0, 1]);
  close(Math.acos(-AM.v.dot(zI, AM.v.unit(A.st.r))) * AM.R2D, 25, 1e-9);
});

test('sun mode: chosen axis points exactly at the Sun', () => {
  const s = state('sun'); s.orbit.sunAxis = '-Z';
  const A = attitudeAt(s, 1000);
  closeArr(AM.m.mulv(A.CBI, A.sun), [0, 0, -1], 1e-12);
});

test('inertial mode uses the Rotation Lab quaternion', () => {
  const s = state('inertial'); s.rot.q = AM.axisAngle2q([0, 1, 0], 0.7);
  closeArr(attitudeAt(s, 0).CBI, AM.q2C(s.rot.q), 1e-15);
  closeArr(bodyRate(s, 10), [0, 0, 0], 1e-12);
});

test('target mode: boresight on the target when visible', () => {
  const s = state('target'); let seen = 0;
  for (let t = 0; t < 86400; t += 30) {
    const A = attitudeAt(s, t);
    if (A.flag && !A.flag.below) { seen++; const pc = payloadComp(s); const bI = AM.m.mulv(AM.m.T(A.CBI), compAxis(pc)); assert.ok(AM.v.norm(bI) > 0.99); }
  }
  assert.ok(seen > 0, 'target visible at least once per day');
});

test('timeline: SSO 10:30 has ~35 % eclipse and caches', () => {
  const s = state('offsets'); const tl = computeTimeline(s, 1, null, 180);
  const ecl = tl.stats[tl.rows.findIndex(r => r.kind === 'ecl')];
  assert.ok(ecl > 30 && ecl < 40, 'eclipse % ' + ecl);
  assert.equal(computeTimeline(s, 1, tl, 180), tl, 'cached');
  assert.notEqual(computeTimeline(s, 2, tl, 180), tl, 'invalidated by scVersion');
});

/* ---------------- orbit definitions ---------------- */
import { switchDefinition, restartFromState, epochDate, parseEpoch, formatEpoch, definitionError } from '../src/sim/scenario.js';
import * as ENV2 from '../src/env/index.js';

const posAt = (o, t) => ENV2.propagate(orbitElements(o), t, o.j2).r;

test('switching elements → r,v → elements keeps the orbit', () => {
  const s = state('offsets'); s.orbit.hp = 500; s.orbit.ha = 900; s.orbit.argp = 40; s.orbit.nu0 = 75;
  const before = [0, 3000, 50000].map(t => posAt(s.orbit, t));
  switchDefinition(s.orbit, 'rv'); assert.equal(s.orbit.def, 'rv');
  [0, 3000, 50000].forEach((t, k) => close(AM.v.norm(AM.v.sub(posAt(s.orbit, t), before[k])), 0, 1e-3, 'rv t=' + t));
  switchDefinition(s.orbit, 'elements');
  [0, 3000, 50000].forEach((t, k) => close(AM.v.norm(AM.v.sub(posAt(s.orbit, t), before[k])), 0, 0.05, 'elements t=' + t));
});

test('restart from the current state continues the same trajectory (with J2)', () => {
  const s = state('offsets'); s.orbit.j2 = true;
  const t0 = 4321.5, ahead = 2000, want = posAt(s.orbit, t0 + ahead), d0 = epochDate(s.orbit).getTime();
  restartFromState(s.orbit, t0);
  assert.equal(s.orbit.def, 'rv'); assert.equal(s.orbit.t, 0);
  close(epochDate(s.orbit).getTime() - d0, t0 * 1000, 1);
  close(AM.v.norm(AM.v.sub(posAt(s.orbit, ahead), want)), 0, 1e-3);
});

test('TLE definition: epoch and elements come from the TLE', () => {
  const s = state('offsets'); s.orbit.def = 'tle';
  s.orbit.tle = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  assert.equal(definitionError(s.orbit), null);
  assert.equal(epochDate(s.orbit).toISOString(), '2008-09-20T12:25:40.104Z');
  close(orbitElements(s.orbit).i * AM.R2D, 51.6416, 1e-9);
  switchDefinition(s.orbit, 'elements'); // keeps the TLE epoch as the scenario epoch
  assert.equal(s.orbit.epoch, '2008-09-20T12:25:40.104'); close(s.orbit.i, 51.6416, 1e-9);
});

test('epochs with seconds; definition errors', () => {
  assert.equal(parseEpoch('2026-10-05T10:00').toISOString(), '2026-10-05T10:00:00.000Z');
  assert.equal(parseEpoch('2026-10-05T10:00:07.25').toISOString(), '2026-10-05T10:00:07.250Z');
  assert.equal(parseEpoch('nonsense'), null);
  assert.equal(formatEpoch(new Date('2026-10-05T10:00:00Z')), '2026-10-05T10:00');
  const o = { def: 'rv', r: [7000, 0, 0], v: [0, 12, 0] }; assert.match(definitionError(o), /escape/);
  o.v = [0, 5, 0]; assert.match(definitionError(o), /below the surface/);
});

test('Moon direction is seen from the spacecraft (parallax up to ~1° in LEO)', () => {
  const A = attitudeAt(state(), 1234);
  close(AM.v.norm(A.moon), 1, 1e-12);
  const geo = AM.v.unit(ENV.moonECI(A.date)), par = AM.v.angle(A.moon, geo) * AM.R2D;
  assert.ok(par > 0 && par < 1.2, 'parallax ' + par); // max asin(r / d_Moon) ≈ 1.1° at 550 km
});

/** Hand-made geometry: body = ECI, spacecraft on +X at 7000 km, Sun along +Y. */
const geom = moon => ({ CBI: AM.m.I(), st: { r: [7000, 0, 0] }, sun: [0, 1, 0], moon: AM.v.unit(moon), moonUp: !ENV.behindEarth([7000, 0, 0], AM.v.unit(moon)), ecl: false });

test('star tracker: Moon inside the exclusion blinds it, unless the Moon is behind the Earth', () => {
  const up = [0, 0, 1], str = mkComp('str', 'S', [0, 0, 0], up);
  const a = sensorEval(str, geom(up));
  assert.equal(a.moonBlind, true); assert.equal(a.sunBlind, false); assert.equal(a.earthBlind, false); assert.equal(a.ok, false);
  const b = sensorEval(str, geom([0.3, 0, 1])); // 16.7° off the boresight, exclusion 15°
  assert.equal(b.moonBlind, false); assert.equal(b.ok, true);
  // Moon 16.7° from nadir, inside the Earth disc (ρ = 65.7°): occulted, so not blinding
  const hid = [-1, 0, 0.3], str2 = mkComp('str', 'S2', [0, 0, 0], hid); str2.earthExcl = -90; // ignore the Earth rule here
  const c = sensorEval(str2, geom(hid));
  assert.equal(c.moonUp, false); assert.equal(c.moonBlind, false);
});

test('parts saved before moonExcl existed get the default', () => {
  const c = mkComp('str', 'S', [0, 0, 0], [0, 0, 1]); delete c.moonExcl;
  assert.equal(fillParams(c).moonExcl, 15);
  const sc = defaultSC(); sc.comps.forEach(c => delete c.moonExcl);
  assert.ok(sanitizeSpacecraft(JSON.parse(JSON.stringify(sc))).comps.filter(c => c.type === 'str').every(c => c.moonExcl === 15));
  const custom = mkComp('str', 'S', [0, 0, 0], [0, 0, 1]); custom.moonExcl = 7; assert.equal(fillParams(custom).moonExcl, 7);
});

test('timeline: a star tracker staring at the Moon is Moon-blind (4) while the Moon is up', () => {
  const s = state('inertial'); const A0 = attitudeAt(s, 0);
  s.sc.comps = [mkComp('str', 'STR-M', [0, 0, 0], AM.m.mulv(A0.CBI, A0.moon))];
  s.sc.comps[0].sunExcl = 0; s.sc.comps[0].earthExcl = -90; // isolate the Moon rule
  const tl = computeTimeline(s, 1, null, 120), row = tl.rows.find(r => r.kind === 'str');
  assert.ok(row.v.includes(4), 'some Moon-blind samples');
  for (let n = 0; n < tl.N; n++) {
    const A = attitudeAt(s, tl.W0 + (n + .5) / tl.N * tl.T), e = sensorEval(s.sc.comps[0], A);
    assert.equal(row.v[n] === 4, e.moonUp && e.moonAng < 15);
  }
});

/* ---------- payload pointing error & view (#10) ---------- */

/** Put the ground target at the sub-satellite point at time t. */
function targetUnder(s, t) {
  const A = attitudeAt(s, t), ll = ENV.ecef2ll(ENV.eci2ecef(A.st.r, A.date));
  s.orbit.tgtLat = ll.lat * AM.R2D; s.orbit.tgtLon = ll.lon * AM.R2D;
}

test('payload: target mode with the target visible has zero pointing error; the target is at the image centre', () => {
  const s = state('target'); s.orbit.tgtLat = 10; s.orbit.tgtLon = 20;
  // find a time when the target is up
  let t = 0; for (; t < 86400; t += 30) { if (!attitudeAt(s, t).flag.below) break; }
  const A = attitudeAt(s, t), p = pointing(s, A);
  assert.equal(p.tgtUp, true);
  assert.ok(p.ang < 1e-5 && Math.abs(p.along) < 1e-9 && Math.abs(p.cross) < 1e-9, 'angle ' + p.ang); // ang via acos: ~1e-6° noise
  assert.ok(p.gnd < 1e-3, 'ground km ' + p.gnd);
  const V = payloadView(s, A); closeArr(V.target, [0, 0], 1e-9);
});

test('payload: roll offset η gives the spherical-Earth ground error R_E·λ, λ = asin(sin η (R_E+h)/R_E) − η (SMAD), cross-track', () => {
  for (const eta of [5, 20, 35]) {
    const s = state('offsets'), t = 900; targetUnder(s, t); s.orbit.roll = eta;
    const A = attitudeAt(s, t), p = pointing(s, A), h = AM.v.norm(A.st.r) - ENV.RE, e = eta * AM.D2R;
    const lam = Math.asin(Math.sin(e) * (ENV.RE + h) / ENV.RE) - e;
    close(p.gnd, ENV.RE * lam, 1e-6 * ENV.RE * lam + 1e-6, 'ground error at η=' + eta);
    close(p.ang, eta, 1e-9, 'angle error = η');
    // not purely cross-track: the along axis follows the ground-relative velocity, a few degrees off the inertial one
    assert.ok(Math.abs(p.gCross) > 5 * Math.abs(p.gAlong), `mostly cross-track at η=${eta}: ${p.gAlong} / ${p.gCross}`);
    close(Math.hypot(p.gAlong, p.gCross), p.gnd, 1e-9, 'components add up to the great-circle distance');
    assert.ok(Math.abs(p.cross) > 5 * Math.abs(p.along), 'angular error mostly cross-track');
    // "right of track" = −orbit normal for a nadir-looking spacecraft: check the sign independently
    const hN = AM.v.unit(AM.v.cross(A.st.r, A.st.v)), side = AM.v.dot(AM.v.sub(p.hit, p.tgt), AM.v.scale(hN, -1));
    assert.equal(Math.sign(p.gCross), Math.sign(side)); assert.equal(Math.sign(p.cross), Math.sign(side));
  }
});

/* ---------- target height (#34) ---------- */

/** Put the target `phi` deg (central angle) from the sub-satellite point at time t, along the meridian towards the equator. */
function targetAway(s, t, phi) {
  targetUnder(s, t); s.orbit.tgtLat += s.orbit.tgtLat > 0 ? -phi : phi;
  const A = attitudeAt(s, t), Rs = AM.v.norm(A.st.r), tI = ENV.ecef2eci(ENV.llh2ecef(s.orbit.tgtLat * AM.D2R, s.orbit.tgtLon * AM.D2R), A.date);
  return { A, Rs, phi: AM.v.angle(A.st.r, tI) };
}
/** Nadir angle at the spacecraft (radius Rs) of a point at radius R and central angle phi. */
const nadirAngle = (Rs, R, phi) => Math.atan2(R * Math.sin(phi), Rs - R * Math.cos(phi));

test('target height: 0 and a missing tgtAlt (older saves) give identical results', () => {
  const a = state('offsets'), b = state('offsets'); a.orbit.tgtAlt = 0; targetAway(a, 900, 10); targetAway(b, 900, 10); a.orbit.roll = b.orbit.roll = 7;
  const pa = pointing(a, attitudeAt(a, 900)), pb = pointing(b, attitudeAt(b, 900));
  for (const k of ['ang', 'along', 'cross', 'gnd', 'gAlong', 'gCross', 'elev', 'relief', 'h']) assert.equal(pa[k], pb[k], k);
  assert.equal(pa.relief, 0); assert.equal(payloadView(a, attitudeAt(a, 900)).foot, null);
});

test('target height: target mode still has zero pointing and ground error', () => {
  for (const alt of [8849, -430]) {
    const s = state('target'); s.orbit.tgtLat = 10; s.orbit.tgtLon = 20; s.orbit.tgtAlt = alt;
    let t = 0; for (; t < 86400; t += 30) { if (!attitudeAt(s, t).flag.below) break; }
    const A = attitudeAt(s, t + 60), p = pointing(s, A);
    // ang via acos: ~1e-6° noise. Tracked 60 s after rise here, at a low elevation, so that noise is ~2 m on the ground.
    assert.equal(p.tgtUp, true); assert.ok(p.ang < 1e-5, 'angle ' + p.ang); assert.ok(p.gnd < 2e-3, 'ground km ' + p.gnd);
    close(AM.v.norm(p.tgt), ENV.RE + alt / 1000, 1e-9, 'target radius'); close(AM.v.norm(p.foot), ENV.RE, 1e-9, 'foot radius');
  }
});

test('target height: relief displacement matches the closed-form triangle and tends to h·tan(incidence)', () => {
  for (const phi0 of [1, 5, 10, 15]) for (const alt of [100, 2000, 8849]) {
    const s = state('offsets'), t = 900, { Rs, phi } = targetAway(s, t, phi0); s.orbit.tgtAlt = alt;
    const h = alt / 1000, p = pointing(s, attitudeAt(s, t)), eta = nadirAngle(Rs, ENV.RE + h, phi);
    const inc = Math.asin(Rs * Math.sin(eta) / ENV.RE); // incidence where the line of sight meets the sphere (law of sines)
    close(p.relief, ENV.RE * (inc - eta - phi), 1e-6, `relief φ=${phi0} h=${alt}`);
    const incT = Math.PI / 2 - p.elev;
    // small-height limit, worst case here about 2.5 % (φ = 15°, 8849 m)
    close(p.relief, h * Math.tan(incT), 0.05 * h * Math.tan(incT) + 1e-3, `≈ h·tan(i) at φ=${phi0} h=${alt}`);
  }
  // the example of #34: a 2 km mountain about 30° off nadir from 550 km moves by about 1.3 km (incidence ≈ 33°)
  const s = state('offsets'), t = 900; const { phi, Rs } = targetAway(s, t, 2.9); s.orbit.tgtAlt = 2000;
  close(nadirAngle(Rs, ENV.RE, phi) * AM.R2D, 30, 2, 'about 30° off nadir');
  close(pointing(s, attitudeAt(s, t)).relief, 1.3, 0.1, 'km'); // excludes h·tan(off-nadir) = 1.155 km
});

test('target height: a target below the sphere displaces the other way, straight below it almost nothing', () => {
  const s = state('offsets'), t = 900; targetAway(s, t, 10); s.orbit.tgtAlt = -430;
  assert.ok(pointing(s, attitudeAt(s, t)).relief < 0);
  const n = state('offsets'); targetUnder(n, t); n.orbit.tgtAlt = 5000;
  assert.ok(Math.abs(pointing(n, attitudeAt(n, t)).relief) < 1e-3);
});

test('target height: aiming at the foot of a mountain misses its top by the triangle angle; ground error ≈ relief', () => {
  const s0 = state('target'), t = 900, { Rs, phi } = targetAway(s0, t, 10), A = attitudeAt(s0, t); // tracks the foot, h = 0
  const s = structuredClone(s0); s.orbit.tgtAlt = 5000;
  const p = pointing(s, A);
  close(p.ang * AM.D2R, Math.abs(nadirAngle(Rs, ENV.RE + 5, phi) - nadirAngle(Rs, ENV.RE, phi)), 1e-6, 'angle');
  // the boresight meets the sphere R_t at the incidence it, the sphere R_E (the foot) at iF: both are on the same ray
  const etaF = nadirAngle(Rs, ENV.RE, phi), iF = Math.asin(Rs * Math.sin(etaF) / ENV.RE), it = Math.asin(Rs * Math.sin(etaF) / (ENV.RE + 5));
  close(p.gnd, (ENV.RE + 5) * (iF - it), 1e-6, 'ground km');
  assert.ok(Math.abs(Math.hypot(p.gAlong, p.gCross) - p.gnd) < 1e-9);
});

test('target height: the camera image and the on-Earth check do not depend on it; bad values count as 0; limits apply', () => {
  const at = alt => { const s = state('offsets'), t = 900; targetAway(s, t, 3); s.orbit.tgtAlt = alt; return s; };
  for (const roll of [0, 40]) {
    const a = at(0), b = at(9000); a.orbit.roll = b.orbit.roll = roll;
    const Va = payloadView(a, attitudeAt(a, 900)), Vb = payloadView(b, attitudeAt(b, 900));
    assert.equal(Vb.kmPerTan, Va.kmPerTan); assert.equal(Vb.grid.length, Va.grid.length); assert.deepEqual(Vb.p.hit, Va.p.hit);
  }
  const lim = at(9000); lim.orbit.roll = 67.1; // just past the limb of the sphere (67.0°) but on the sphere 9 km up
  assert.equal(pointing(lim, attitudeAt(lim, 900)).hit, null);
  for (const bad of ['abc', Infinity, null, undefined]) { assert.equal(targetHeight({ tgtAlt: bad }), 0); }
  assert.equal(targetHeight({ tgtAlt: 1e6 }), 9); assert.equal(targetHeight({ tgtAlt: -1e7 }), -0.5); assert.equal(targetHeight({ tgtAlt: 2000 }), 2);
  assert.equal(defaultState().orbit.tgtAlt, 0);
});

test('target height: changes the timeline cache key', () => {
  const s = state('target'), k0 = timelineKey(s, 1, []); s.orbit.tgtAlt = 2000;
  assert.notEqual(timelineKey(s, 1, []), k0);
});

test('target height: in the image the top of a mountain leans away from the nadir', () => {
  const s = state('offsets'), t = 900; targetAway(s, t, 3); s.orbit.tgtAlt = 8000; s.orbit.roll = 0;
  const V = payloadView(s, attitudeAt(s, t), { viewTan: 2 });
  assert.ok(V.foot && V.target && V.nadir);
  const d = q => Math.hypot(q[0] - V.nadir[0], q[1] - V.nadir[1]);
  assert.ok(d(V.target) > d(V.foot), `${d(V.target)} > ${d(V.foot)}`);
});

test('payload: pitch offset gives mostly along-track error, positive when the boresight looks ahead', () => {
  const s = state('offsets'), t = 900; targetUnder(s, t); s.orbit.pitch = 10;
  const A = attitudeAt(s, t), p = pointing(s, A);
  assert.ok(Math.abs(p.gAlong) > 5 * Math.abs(p.gCross));
  const ahead = AM.v.dot(AM.v.sub(p.hit, p.tgt), AM.v.unit(groundRelVel(A.st.r, A.st.v))) > 0;
  assert.equal(p.gAlong > 0, ahead); assert.equal(p.along > 0, ahead);
});

test('payload: errors are null when the target is below the horizon or the boresight misses the Earth', () => {
  const s = state('offsets'), t = 900; targetUnder(s, t); s.orbit.tgtLon += 180; s.orbit.tgtLat = -s.orbit.tgtLat;
  const p = pointing(s, attitudeAt(s, t)); assert.equal(p.tgtUp, false); assert.equal(p.ang, null); assert.equal(p.gnd, null);
  const s2 = state('offsets'); targetUnder(s2, t); s2.orbit.roll = 80; // boresight above the limb (ρ ≈ 67°)
  const p2 = pointing(s2, attitudeAt(s2, t)); assert.equal(p2.hit, null); assert.equal(p2.gnd, null); assert.ok(p2.ang > 79);
  assert.equal(pointing({ ...s, sc: { ...s.sc, comps: [] } }, attitudeAt(s, t)), null);
});

test('payload view: a direction α off the boresight projects to radius tan α; far side and behind are culled', () => {
  const r = [7000, 0, 0], CCI = [[0, 1, 0], [0, 0, 1], [-1, 0, 0]]; // looking at −X (nadir), image x = +Y_I, y = +Z_I
  const a = 3 * AM.D2R, P = AM.v.add(r, AM.v.scale([-Math.cos(a), Math.sin(a), 0], 100));
  closeArr(project(CCI, r, P, false), [Math.tan(a), 0], 1e-12);
  assert.equal(project(CCI, r, [8000, 0, 0], false), null, 'behind the camera');
  assert.equal(project(CCI, r, [-ENV.RE, 0, 0]), null, 'far side of the Earth');
  assert.ok(project(CCI, r, [ENV.RE, 0, 0]), 'sub-satellite point visible');
  assert.equal(gridStep(1.2), 0.5); assert.equal(gridStep(0.09), 0.02); assert.equal(gridStep(400), 30);
});

test('payload view: grid, track and target land inside a sensible image; the track passes the image centre at nadir', () => {
  const s = state('offsets'), t = 900; targetUnder(s, t);
  const V = payloadView(s, attitudeAt(s, t));
  closeArr(V.target, [0, 0], 1e-6);
  assert.ok(V.grid.length >= 4, 'grid lines ' + V.grid.length);
  const tr = V.track.filter(Boolean), dmin = Math.min(...tr.map(q => Math.hypot(q[0], q[1])));
  assert.ok(dmin < 0.05 * V.viewTan, 'track passes near the centre: ' + dmin);
  closeArr(V.nadir, [0, 0], 1e-9);
  // along-track arrow ⟂ right arrow in the image (nadir view)
  close(V.alongDir[0] * V.rightDir[0] + V.alongDir[1] * V.rightDir[1], 0, 1e-3);
  // handedness: image y is down, so "right of track" is clockwise from "along" (along × right > 0)
  assert.ok(V.alongDir[0] * V.rightDir[1] - V.alongDir[1] * V.rightDir[0] > 0.99);
  // map-like, not mirrored: north × east > 0 in the y-down image (east is clockwise from north, as on a map)
  const A = attitudeAt(s, t), hitE = ENV.eci2ecef(V.p.hit, A.date), ll = ENV.ecef2ll(hitE), d = 1e-4;
  const at = (la, lo) => project(V.p.CCI, A.st.r, ENV.ecef2eci(ENV.llh2ecef(la, lo), A.date));
  const c0 = at(ll.lat, ll.lon), n = at(ll.lat + d, ll.lon), e = at(ll.lat, ll.lon + d);
  const N = [n[0] - c0[0], n[1] - c0[1]], Ev = [e[0] - c0[0], e[1] - c0[1]];
  assert.ok(N[0] * Ev[1] - N[1] * Ev[0] > 0, 'image is not mirrored');
});

test('ground-relative velocity: equatorial prograde circular orbit loses ω_E·r', () => {
  const r = [7000, 0, 0], vc = Math.sqrt(ENV.MU / 7000), vr = groundRelVel(r, [0, vc, 0]);
  closeArr(vr, [0, vc - ENV.WE * 7000, 0], 1e-12);
  close(ENV.WE * 86164.0905, 2 * Math.PI, 1e-6, 'ω_E = 2π per sidereal day');
});
