/**
 * Payload boresight geometry: pointing error against the ground target and a gnomonic
 * "camera" projection for the payload view. Pure computation; drawing lives in
 * views/orbit/payloadInset.js.
 *
 * Image coordinates (the payload view): the payload component frame C, looking along +Z_C,
 * point P → (x, y) = (P_x / P_z, P_y / P_z), i.e. tangents of the angles off the boresight.
 * +X_C is drawn to the right and +Y_C downward (a right-handed camera: x right, y down, z forward).
 *
 * Error axes (see docs/CONVENTIONS.md "Payload pointing error"):
 *   along  = ground-relative velocity v − ω_E × r, projected ⊥ to the boresight (angles) or onto
 *            the local horizontal at the target (ground)
 *   cross  = along × up (right of the ground track, looking forward)
 * Errors are "boresight minus target": along > 0 means the boresight looks ahead of the target,
 * cross > 0 means it looks to the right of it.
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { epochDate, orbitElements } from './scenario.js';
import { payloadComp } from './guidance.js';

const { v, m } = AM;
const D2R = AM.D2R, R2D = AM.R2D;

/** Ground-relative velocity (km/s, ECI) of a point at r moving with velocity vel. */
export function groundRelVel(r, vel) { return v.sub(vel, v.cross([0, 0, ENV.WE], r)); }

/** C_CI of the payload component c for body attitude CBI (rows = payload axes in ECI). */
export function payloadCI(c, CBI) { return m.mul(AM.q2C(c.q), CBI); }

/**
 * Pointing of the payload against the ground target (state.orbit.tgtLat / tgtLon) at attitude A.
 * CBI defaults to A.CBI; pass another attitude (e.g. with knowledge / performance errors) to compare.
 * @returns null without a payload, else {
 *   c, CCI, bore (ECI unit), hit (ECI km | null: boresight misses the Earth), slant (km to hit | null),
 *   tgt (ECI km), tgtUp (target above the spacecraft's horizon), elev (rad),
 *   ang, along, cross (deg; null if the target is below the horizon),
 *   gnd, gAlong, gCross (km on the ground, hit − target; null if no hit or target below horizon) }
 */
export function pointing(state, A, CBI = A.CBI) {
  const c = payloadComp(state); if (!c) return null;
  const o = state.orbit, r = A.st.r;
  const CCI = payloadCI(c, CBI), bore = CCI[2];
  const hit = ENV.rayEarth(r, bore), slant = hit ? v.norm(v.sub(hit, r)) : null;
  const tgt = ENV.ecef2eci(ENV.llh2ecef(o.tgtLat * D2R, o.tgtLon * D2R), A.date);
  const los = v.sub(tgt, r), elev = Math.PI / 2 - v.angle(tgt, v.scale(los, -1)), tgtUp = elev > 0;
  const vr = groundRelVel(r, A.st.v);
  const res = { c, CCI, bore, hit, slant, tgt, tgtUp, elev, ang: null, along: null, cross: null, gnd: null, gAlong: null, gCross: null };
  if (!tgtUp) return res;
  // angular error in the frame z = boresight, x = along-track ⊥ z, y = z × x (right of track)
  const z = bore, x = v.unit(v.sub(vr, v.scale(z, v.dot(vr, z)))), y = v.cross(z, x), u = v.unit(los);
  res.ang = v.angle(bore, u) * R2D;
  res.along = -Math.atan2(v.dot(u, x), v.dot(u, z)) * R2D;
  res.cross = -Math.atan2(v.dot(u, y), v.dot(u, z)) * R2D;
  if (hit) {
    const n = v.unit(tgt), xa = v.unit(v.sub(vr, v.scale(n, v.dot(vr, n)))), ya = v.cross(xa, n), d = v.sub(hit, tgt);
    res.gnd = ENV.RE * v.angle(hit, tgt); res.gAlong = v.dot(d, xa); res.gCross = v.dot(d, ya);
  }
  return res;
}

/**
 * Project an ECI point into the payload image (see header). Returns [x, y] or null when the point is
 * behind the camera, or — for points on the Earth's surface (ground = true) — beyond the horizon.
 */
export function project(CCI, r, P, ground = true) {
  const d = v.sub(P, r), pc = m.mulv(CCI, d);
  if (pc[2] <= 1e-9) return null;
  if (ground && v.dot(P, v.scale(d, -1)) <= 0) return null;
  return [pc[0] / pc[2], pc[1] / pc[2]];
}

const LADDER = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30];
/** Grid step (deg) from a 1-2-5 ladder so that about `n` lines span `spanDeg`. */
export function gridStep(spanDeg, n = 5) { return LADDER.find(s => spanDeg / s <= n) || 30; }

/**
 * Everything the payload view draws, at attitude A.
 * viewTan: half-width of the view as a tangent (default: 3× the payload half-FOV, at least tan 1.5°).
 * @returns null without a payload, else { p (pointing()), fovTan, viewTan, kmPerTan, center:'hit'|'none',
 *   grid: [{ kind: 'lat'|'lon', deg, pts }], step, track: pts, target: [x,y]|null, nadir: [x,y]|null,
 *   alongDir, rightDir: unit 2-vectors in the image (null if the boresight misses the Earth) }
 *   pts are arrays of [x, y] or null (a break in the polyline).
 */
export function payloadView(state, A, opts = {}) {
  const p = pointing(state, A, opts.CBI); if (!p) return null;
  const r = A.st.r, fovTan = Math.tan((p.c.fov || 2) / 2 * D2R);
  const viewTan = opts.viewTan || Math.max(3 * fovTan, Math.tan(1.5 * D2R));
  const out = { p, fovTan, viewTan, kmPerTan: p.slant, grid: [], step: null, track: [], target: null, nadir: null, alongDir: null, rightDir: null };
  const proj = P => project(p.CCI, r, P);
  out.target = p.tgtUp ? proj(p.tgt) : null;
  out.nadir = proj(v.scale(v.unit(r), ENV.RE));
  if (!p.hit) return out;
  // along-track / right directions drawn at the image centre
  const n = v.unit(p.hit), vr = groundRelVel(r, A.st.v), xa = v.unit(v.sub(vr, v.scale(n, v.dot(vr, n)))), ya = v.cross(xa, n);
  const k = 0.01 * p.slant, c0 = proj(p.hit), ca = proj(v.add(p.hit, v.scale(xa, k))), cr = proj(v.add(p.hit, v.scale(ya, k)));
  if (c0 && ca && cr) { const u2 = (a) => { const d = [a[0] - c0[0], a[1] - c0[1]], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; }; out.alongDir = u2(ca); out.rightDir = u2(cr); }
  // lat/lon grid around the boresight hit, sized from the ground width of the view
  const hitE = ENV.eci2ecef(p.hit, A.date), ll = ENV.ecef2ll(hitE), lat0 = ll.lat * R2D, lon0 = ll.lon * R2D;
  const halfKm = Math.min(3000, p.slant * viewTan * 2.5); // generous: oblique views stretch the ground
  const visKm = 2 * p.slant * viewTan; // width of the view on the ground at the boresight
  const latStep = gridStep(visKm / 111.2, 8), lonStep = gridStep(visKm / (111.2 * Math.max(0.05, Math.cos(ll.lat))), 8);
  out.step = latStep;
  const spanLat = halfKm / 111.2, spanLon = Math.min(180, halfKm / (111.2 * Math.max(0.05, Math.cos(ll.lat))));
  const toI = (la, lo) => ENV.ecef2eci(ENV.llh2ecef(la * D2R, lo * D2R), A.date), NS = 48;
  for (let la = Math.ceil((lat0 - spanLat) / latStep) * latStep; la <= lat0 + spanLat; la += latStep) {
    if (Math.abs(la) > 90) continue;
    const pts = []; for (let s = 0; s <= NS; s++) pts.push(proj(toI(la, lon0 - spanLon + 2 * spanLon * s / NS)));
    out.grid.push({ kind: 'lat', deg: +la.toFixed(6), pts });
  }
  for (let lo = Math.ceil((lon0 - spanLon) / lonStep) * lonStep; lo <= lon0 + spanLon; lo += lonStep) {
    const pts = []; for (let s = 0; s <= NS; s++) { const la = lat0 - spanLat + 2 * spanLat * s / NS; pts.push(Math.abs(la) <= 90 ? proj(toI(la, lo)) : null); }
    out.grid.push({ kind: 'lon', deg: +(((lo + 540) % 360) - 180).toFixed(6), pts });
  }
  // ground track (sub-satellite points, Earth-fixed, drawn at the current Earth orientation)
  const E = orbitElements(state.orbit), e0 = epochDate(state.orbit).getTime(), span = Math.max(60, 3 * halfKm / 6.5), NT = 120;
  for (let s = 0; s <= NT; s++) {
    const tt = A.t - span + 2 * span * s / NT, st = ENV.propagate(E, tt, state.orbit.j2);
    const gE = ENV.eci2ecef(v.scale(v.unit(st.r), ENV.RE), new Date(e0 + tt * 1000));
    out.track.push(proj(ENV.ecef2eci(gE, A.date)));
  }
  return out;
}
