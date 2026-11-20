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
import { computeTimeline } from '../src/sim/timeline.js';
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
  // the boresight's ground point against values worked out by hand (Rₑ 6378.137 km, 550 km up, 30° from nadir): incidence
  // asin(6928.137 / 6378.137 · sin 30°) = 32.896°; slant range by the law of cosines r cos θ − √(Rₑ² − r² sin² θ) = 644.49 km;
  // 2.896° of arc from the nadir point = 322.38 km
  const bore = sw.bore, gr = geom.st.r;
  close(AM.v.angle(AM.v.unit(bore), AM.v.sub(gr, bore)) * R2D, 32.896, 1e-3, 'incidence at the boresight');
  close(AM.v.norm(AM.v.sub(bore, gr)), 644.49, 0.01, 'slant range'); close(RE * AM.v.angle(bore, gr), 322.38, 0.01, 'ground distance from the nadir point');
  // the corners: each at ±half the beam in azimuth and elevation, on the ground; the edges in antenna order (−Y_C, +Y_C)
  const b = sarBeams(c);
  sw.corners.forEach((p, k) => { const t = targetInAntenna(c, geom, p), [sa, se] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k];
    close(t.az, sa * b.az / 2, 1e-9, `corner ${k} azimuth`); close(t.el, se * b.el / 2, 1e-9, `corner ${k} elevation`); close(AM.v.norm(p), RE, 1e-6); });
  assert.ok(targetInAntenna(c, geom, sw.edges[0]).el < 0 && targetInAntenna(c, geom, sw.edges[1]).el > 0, 'edges[0] on −Y_C');
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
  const shallow = sarAt(40, 'right', { incMin: 20, incMax: 45 }), sh = sarSwath(shallow, geom);
  assert.ok(sh.incNear > 20 * D2R && sh.incFar > 45 * D2R); assert.equal(sarImaging(shallow, sh), false, 'its far edge past the imaging range');
  // straight down the beam lies across the ground track: no imaging, whatever the range; near and far are then a tie
  const down = sarAt(0, 'right', { incMin: 0, incMax: 45 }), dn = sarSwath(down, geom);
  assert.equal(dn.straddles, true); assert.equal(dn.side, 'nadir'); assert.equal(sarImaging(down, dn), false);
  assert.equal(sarSwath(c, geom).straddles, false); close(sarSwath(c, geom).skew, 0, 1e-9, 'long side along the track');
  const yawed = { ...c, q: AM.C2q(AM.m.mul(AM.Rp(3, Math.PI / 2), AM.q2C(c.q))) }; close(sarSwath(yawed, geom).skew, Math.PI / 2, 1e-9, 'turned across the track');
});

test('SAR: the roll helper puts the boresight at the look angle asked, on the side asked, nearest the current roll', () => {
  const s = defaultState(); migrate(s); const o = s.orbit; o.mode = 'offsets'; o.roll = 0;
  // a SAR looking straight down from the bus's nadir face, its long side along +X (the nominal frame's velocity axis)
  const c = mkComp('sar', 'SAR', [0, 0, 0.5], [0, 0, 1], [1, 0, 0]); s.sc.comps.push(c);
  for (const [look, side, yaw, pitch] of [[30, 'right', 0, 0], [30, 'left', 0, 0], [42.5, 'right', 0, 0], [35, 'left', 30, 10], [30, 'right', 0, 20]]) {
    o.yaw = yaw; o.pitch = pitch;
    const roll = rollForLook(s, o, c, look, side); assert.ok(roll !== null, `${look} ${side}`);
    o.roll = roll; const sw = sarSwath(c, attitudeAt(s, o.t));
    close(sw.look * R2D, look, 1e-6, `${look}° ${side}, yaw ${yaw} pitch ${pitch}`); assert.equal(sw.side, side);
    // the default nominal frame is nadir-pointing, so with no yaw or pitch a nadir-looking panel rolls by the look angle exactly
    if (!yaw && !pitch) close(Math.abs(roll), look, 1e-6);
    o.roll = 0;
  }
  o.yaw = o.pitch = 0;
  // no roll gets there: an antenna along the roll axis; a yaw of 90° (the roll axis across the track: rolling only tilts
  // the beam forward and back, in the orbit plane); a look angle past the 67° horizon
  const along = mkComp('sar', 'SAR2', [0, 0, 0], [1, 0, 0], [0, 1, 0]); assert.equal(rollForLook(s, o, along, 30, 'right'), null);
  o.yaw = 90; assert.equal(rollForLook(s, o, c, 30, 'right'), null, 'yaw 90°'); o.yaw = 0;
  assert.equal(rollForLook(s, o, c, 75, 'right'), null, 'past the horizon');
  // two rolls give the same look on the same side (yawed 60°, a panel tilted forward): the one nearest the current roll
  const tilted = mkComp('sar', 'SAR3', [0, 0, 0.5], [0.5, 0, 0.866], [0, 1, 0]); o.yaw = 60;
  o.roll = -20; close(rollForLook(s, o, tilted, 45, 'right'), -35.27, 0.05, 'from −20°');
  o.roll = 20; close(rollForLook(s, o, tilted, 45, 'right'), 35.25, 0.05, 'from +20°');
  o.yaw = 0; o.roll = 0;
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
  // the boresight goes on through the Earth and out at its far side: a target there is in line with the beam, in front
  // of the panel, but below its horizon
  const d = AM.v.unit(AM.v.sub(sw.bore, A.st.r)), rd = AM.v.dot(A.st.r, d), sFar = -rd + Math.sqrt(rd * rd - (AM.v.dot(A.st.r, A.st.r) - RE * RE));
  const behind = ENV.eci2ecef(AM.v.add(A.st.r, AM.v.scale(d, sFar)), A.date), tb = targetInAntenna(c, A, ENV.ecef2eci(behind, A.date));
  assert.ok(tb.front && !tb.up && Math.abs(tb.el) < 1e-6); assert.equal(beamCrossing(s, c, 580, 620, behind), null);
});

test('SAR timeline: its imaging row, and the target crossing its beam in the sample it happens in (a 2 s scan agrees)', () => {
  const s = defaultState(); migrate(s); const o = s.orbit; o.mode = 'offsets'; o.t = 0;
  const c = mkComp('sar', 'SAR', [0, 0, 0.5], [0, 0, 1], [1, 0, 0]); s.sc.comps.push(c);
  o.roll = rollForLook(s, o, c, 30, 'right');
  // the target under the middle of the swath at t = 1500 s (the target model is a sphere, as the swath's)
  const A = attitudeAt(s, 1500), ll = ENV.ecef2ll(ENV.eci2ecef(sarSwath(c, A).bore, A.date));
  o.tgtLat = ll.lat * R2D; o.tgtLon = ll.lon * R2D; o.tgtAlt = 0;
  const tl = computeTimeline(s, 0, null, 360), row = k => tl.rows.findIndex(r => r.kind === k), sar = tl.rows[row('sar')], sart = tl.rows[row('sart')];
  assert.equal(sar.name, 'SAR imaging'); assert.equal(sart.name, 'Target in SAR');
  for (const n of [0, 90, 180, 359]) assert.equal(sar.v[n], sarImaging(c, sarSwath(c, attitudeAt(s, tl.W0 + (n + .5) / tl.N * tl.T))) ? 1 : 0, `imaging at sample ${n}`);
  // every crossing in the window by a 2 s scan, in the sample whose interval holds it (the last sample runs to the end)
  const tE = targetECEF(o), tn = n => tl.W0 + (n + .5) / tl.N * tl.T, want = new Set();
  for (let t = tl.W0; t < tl.W0 + tl.T; t += 2) { const x = beamCrossing(s, c, t, Math.min(t + 2, tl.W0 + tl.T), tE); if (x !== null) { let n = 0; while (n < tl.N - 1 && tn(n) < x) n++; want.add(n); } }
  assert.ok(want.size >= 1, 'the target is crossed');
  assert.deepEqual(sart.v.flatMap((x, n) => x ? [n] : []), [...want].sort((a, b) => a - b));
  assert.ok(sart.v.every(x => x === 0 || x === 2), 'it could image at each crossing (30°, within 20–45°)');
  assert.equal(tl.stats[row('sart')], want.size + '×');
});

test('SAR: a thin plate in the inertia; parameters checked on import', () => {
  const sc = { bus: { x: 1, y: 1, z: 1, mass: 0, pos: [0, 0, 0], q: { w: 1, x: 0, y: 0, z: 0 } }, comps: [mkComp('sar', 'SAR', [0, 0, 0], [0, 0, 1], [1, 0, 0])] };
  const I = massProps(sc).I, mm = 30, w = 3.2, h = 0.4;
  close(I[0][0], mm * h * h / 12, 1e-12); close(I[1][1], mm * w * w / 12, 1e-12); close(I[2][2], mm * (w * w + h * h) / 12, 1e-12);
  assert.match(paramText(sc.comps[0]), /3\.2 × 0\.4 m · λ 3\.1 cm · beam 0\.56° × 4\.44° · imaging 20–45° · looks right/);
  assert.equal(TYPES.sar.plate, true);
  const bad = (k, x) => { const j = JSON.parse(JSON.stringify(sc)); j.comps[0][k] = x; return () => sanitizeSpacecraft(j); };
  assert.throws(bad('lambda', 0), /lambda/); assert.throws(bad('incMin', 50), /imaging range/); assert.throws(bad('side', 'up'), /side/);
  assert.throws(bad('lambda', 0.5), /1 rad/, 'a beam over 1 rad wide (λ > h)');
  const old = JSON.parse(JSON.stringify(sc)); delete old.comps[0].incMin; delete old.comps[0].side; const ok = sanitizeSpacecraft(old);
  assert.equal(ok.comps[0].incMin, 20); assert.equal(ok.comps[0].side, 'right', 'missing parameters take the type defaults');
});
