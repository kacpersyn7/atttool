/**
 * SAR antenna (#11): the swath against the exact relations of a spherical Earth, the look side, imaging, the roll
 * helper, a target crossing the beam, the plate inertia and the checks on import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import * as ENV from '../src/env/index.js';
import { mkComp, sanitizeSpacecraft } from '../src/spacecraft/component.js';
import { massProps } from '../src/spacecraft/massProperties.js';
import { TYPES, paramText } from '../src/spacecraft/componentTypes.js';
import { beamCrossing, incidenceForLook, lookForIncidence, rollForLook, sarBeams, sarImaging, sarSwath, targetInAntenna } from '../src/sim/sar.js';
import { attitudeAt } from '../src/sim/guidance.js';
import { targetECEF } from '../src/sim/scenario.js';
import { defaultState, migrate } from '../src/state/store.js';
import { close } from './helpers.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, RE = ENV.RE;
const H = 550, r0 = RE + H;
/** A geometry like attitudeAt's: the spacecraft over (r0, 0, 0) moving along +Y (ĥ = +Z, so right = −Z), body = ECI. */
const geom = { st: { r: [r0, 0, 0], v: [0, 7.6, 0] }, CBI: AM.m.eye ? AM.m.eye() : [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
/** A SAR looking `look` (deg) from nadir, to the right (−Z) or left (+Z), its long side (X_C) along the velocity (+Y). */
const sarAt = (look, side = 'right', extra = {}) => { const s = side === 'right' ? -1 : 1, d = [-Math.cos(look * D2R), 0, s * Math.sin(look * D2R)]; return mkComp('sar', 'SAR', [0, 0, 0], d, [0, 1, 0], extra); };

test('SAR: the beam is λ/D wide; incidence and look angle follow sin θᵢ = (r/Rₑ) sin θ', () => {
  const c = sarAt(30), b = sarBeams(c);
  close(b.az, 0.031 / 3.2, 1e-15); close(b.el, 0.031 / 0.4, 1e-15);
  close(incidenceForLook(30 * D2R, r0), Math.asin(r0 / RE * 0.5), 1e-15);
  close(lookForIncidence(incidenceForLook(30 * D2R, r0), r0), 30 * D2R, 1e-12);
  assert.equal(incidenceForLook(80 * D2R, r0), null, 'past the horizon');
  // 550 km: the horizon is 67.0° from nadir (sin = Rₑ / r)
  close(Math.asin(RE / r0) * R2D, 67.0, 0.05);
});

test('SAR: the swath edges, their incidence and the ground width are the spherical-Earth values', () => {
  const look = 30, c = sarAt(look), sw = sarSwath(c, geom), el = sarBeams(c).el;
  assert.equal(sw.ok, true); assert.equal(sw.side, 'right'); close(sw.look, look * D2R, 1e-12);
  const lookN = look * D2R - el / 2, lookF = look * D2R + el / 2, iN = incidenceForLook(lookN, r0), iF = incidenceForLook(lookF, r0);
  close(sw.incNear, iN, 1e-9, 'near incidence'); close(sw.incFar, iF, 1e-9, 'far incidence');
  close(sw.width, RE * ((iF - lookF) - (iN - lookN)), 1e-6, 'ground width = Rₑ × the difference of the central angles');
  assert.ok(sw.width > 40 && sw.width < 80, `about ${sw.width.toFixed(1)} km for this beam at 30°`);
  assert.ok(sw.corners.every(Boolean), 'all four corners on the ground');
  // the same antenna turned 180° about its boresight: the edges swap, the sorted result doesn't
  const flipped = { ...c, q: AM.C2q(AM.m.mul(AM.Rp(3, Math.PI), AM.q2C(c.q))) }, s2 = sarSwath(flipped, geom);
  close(s2.incNear, iN, 1e-9); close(s2.incFar, iF, 1e-9);
});

test('SAR: the look side is the side of the velocity (right = −ĥ), also on a retrograde orbit; past the horizon there is no swath', () => {
  assert.equal(sarSwath(sarAt(25, 'left'), geom).side, 'left');
  const retro = { ...geom, st: { r: geom.st.r, v: [0, -7.6, 0] } }; // moving −Y: ĥ = −Z, so −Z is now the left
  assert.equal(sarSwath(sarAt(25, 'right'), retro).side, 'left');
  const far = sarSwath(sarAt(66), geom); assert.equal(far.ok, false, 'the far edge goes past the 67° horizon'); assert.equal(far.incFar, null); assert.ok(far.bore, 'the boresight itself still meets the ground');
  const c = sarAt(30, 'right', { incMin: 20, incMax: 45 }); assert.equal(sarImaging(c, sarSwath(c, geom)), true);
  const steep = sarAt(12, 'right', { incMin: 20, incMax: 45 }); assert.equal(sarImaging(steep, sarSwath(steep, geom)), false, 'below the imaging range');
});

test('SAR: the roll helper puts the boresight at the look angle asked, on the side asked, nearest the current roll', () => {
  const s = defaultState(); migrate(s); const o = s.orbit; o.mode = 'offsets'; o.roll = 0;
  // a SAR looking straight down from the bus's nadir face, its long side along +X (the nominal frame's velocity axis)
  const c = mkComp('sar', 'SAR', [0, 0, 0.5], [0, 0, 1], [1, 0, 0]); s.sc.comps.push(c);
  for (const [look, side] of [[30, 'right'], [30, 'left'], [42.5, 'right']]) {
    const roll = rollForLook(s, o, c, look, side); assert.ok(roll !== null, `${look} ${side}`);
    o.roll = roll; const sw = sarSwath(c, attitudeAt(s, o.t));
    close(sw.look * R2D, look, 1e-6, `${look}° ${side}`); assert.equal(sw.side, side);
    close(Math.abs(roll), look, 0.6, 'a nadir-looking panel rolls by about the look angle'); o.roll = 0;
  }
  // an antenna along the roll axis can't be rolled to any look angle
  const along = mkComp('sar', 'SAR2', [0, 0, 0], [1, 0, 0], [0, 1, 0]); assert.equal(rollForLook(s, o, along, 30, 'right'), null);
});

test('SAR: a target crosses the beam for an instant, inside the swath; one outside it is never in it', () => {
  const s = defaultState(); migrate(s); const o = s.orbit; o.mode = 'offsets';
  const c = mkComp('sar', 'SAR', [0, 0, 0.5], [0, 0, 1], [1, 0, 0]); s.sc.comps.push(c);
  o.roll = rollForLook(s, o, c, 30, 'right');
  // put a target in the middle of the swath at t = 600 s: the ground point of the boresight then
  const A = attitudeAt(s, 600), sw = sarSwath(c, A), mid = ENV.eci2ecef(sw.bore, A.date);
  const hit = beamCrossing(s, c, 580, 620, mid); assert.ok(hit !== null && Math.abs(hit - 600) < 0.5, `crosses at ${hit}`);
  const ti = targetInAntenna(c, attitudeAt(s, hit), ENV.ecef2eci(mid, attitudeAt(s, hit).date)); assert.ok(Math.abs(ti.el) < sarBeams(c).el / 2);
  // a target 200 km further out: it crosses the azimuth plane, but outside the elevation beam
  const out = ENV.eci2ecef(AM.v.add(sw.bore, AM.v.scale(AM.v.unit(AM.v.sub(sw.far, sw.near)), 200)), A.date);
  assert.equal(beamCrossing(s, c, 580, 620, out), null);
  // the target of the scenario (Warsaw) is far from this orbit's first minutes
  assert.equal(beamCrossing(s, c, 0, 60, targetECEF(o)), null);
});

test('SAR: a thin plate in the inertia; parameters checked on import', () => {
  const sc = { bus: { x: 1, y: 1, z: 1, mass: 0, pos: [0, 0, 0], q: { w: 1, x: 0, y: 0, z: 0 } }, comps: [mkComp('sar', 'SAR', [0, 0, 0], [0, 0, 1], [1, 0, 0])] };
  const I = massProps(sc).I, mm = 30, w = 3.2, h = 0.4;
  close(I[0][0], mm * h * h / 12, 1e-12); close(I[1][1], mm * w * w / 12, 1e-12); close(I[2][2], mm * (w * w + h * h) / 12, 1e-12);
  assert.match(paramText(sc.comps[0]), /3\.2 × 0\.4 m · λ 3\.1 cm · beam 0\.56° × 4\.44° · imaging 20–45° · looks right/);
  assert.equal(TYPES.sar.plate, true);
  const bad = (k, x) => { const j = JSON.parse(JSON.stringify(sc)); j.comps[0][k] = x; return () => sanitizeSpacecraft(j); };
  assert.throws(bad('lambda', 0), /lambda/); assert.throws(bad('incMin', 50), /imaging range/); assert.throws(bad('side', 'up'), /side/);
  const old = JSON.parse(JSON.stringify(sc)); delete old.comps[0].incMin; delete old.comps[0].side; const ok = sanitizeSpacecraft(old);
  assert.equal(ok.comps[0].incMin, 20); assert.equal(ok.comps[0].side, 'right', 'missing parameters take the type defaults');
});
