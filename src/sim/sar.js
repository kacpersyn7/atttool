/**
 * SAR antenna (#11): a planar array that looks to one side. Its frame C: +Z_C = boresight (the panel normal),
 * +X_C = azimuth (the panel's long side, meant along the track), +Y_C = elevation (across the swath).
 *
 * Beam: full widths ≈ λ/D in each direction (λ/w in azimuth, λ/h in elevation; the 3 dB width of a uniform aperture
 * is 0.886 λ/D). Swath: where the elevation beam meets a spherical Earth: its near and far edges (the edge rays
 * ±el/2 about the boresight, sorted by incidence), their incidence angles, the ground width between them and the
 * side of the ground track it lies on (right = −ĥ, the right of the velocity seen from above). The incidence at the
 * ground for a look (off-nadir) angle θ from radius r: sin θᵢ = (r / Rₑ) sin θ; the ground central angle from the
 * nadir is θᵢ − θ. Imaging is possible when the swath lies within the antenna's imaging range (incMin…incMax).
 * Pure functions.
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { compCBC } from '../spacecraft/component.js';
import { attitudeAt } from './guidance.js';
import { epochDate } from './scenario.js';

const { v, m } = AM;

/** Full beam widths (rad): { az (along the panel's long side), el (across) }. */
export function sarBeams(c) { return { az: c.lambda / c.w, el: c.lambda / c.h }; }

/** Incidence (rad) at the ground of a ray at look angle `look` (rad from nadir) from radius r (km); null past the horizon. */
export function incidenceForLook(look, r) { const s = r / ENV.RE * Math.sin(look); return s >= 1 ? null : Math.asin(s); }
/** The look angle (rad from nadir) that meets the ground at incidence `inc` (rad), from radius r (km). */
export function lookForIncidence(inc, r) { return Math.asin(ENV.RE / r * Math.sin(inc)); }

/** The antenna axes in ECI at geometry A (attitudeAt): [X_C, Y_C, Z_C]. */
function axesI(c, A) { const CBC = compCBC(c), CIB = m.T(A.CBI); return [0, 1, 2].map(k => m.mulv(CIB, m.col(CBC, k))); }
/** Incidence (rad) at ground point p seen from r: between the local vertical and the line back to the spacecraft. */
const incidenceAt = (p, r) => v.angle(v.unit(p), v.sub(r, p));

/**
 * The swath of SAR component c at geometry A (attitudeAt).
 * @returns {{ok, side, look, bore, incNear, incFar, near, far, width, corners}} look (rad, the boresight from nadir);
 *   side 'right' | 'left' | 'nadir' (the boresight's side of the ground track); near, far (ECI km: where the edge rays
 *   meet the ground, sorted by incidence; null if one misses); incNear, incFar (rad); width (km, on the ground
 *   between them); corners (ECI km or null: the four corners of the beam on the ground); ok: both edges on the ground.
 */
export function sarSwath(c, A) {
  const r = A.st.r, [X, Y, Z] = axesI(c, A), { az, el } = sarBeams(c);
  const nadir = v.unit(v.scale(r, -1)), hHat = v.unit(v.cross(r, A.st.v));
  const look = v.angle(Z, nadir), toward = -v.dot(Z, hHat);
  const side = Math.abs(toward) < 1e-9 ? 'nadir' : toward > 0 ? 'right' : 'left';
  const ray = (a, e) => v.unit(v.add(Z, v.add(v.scale(X, Math.tan(a)), v.scale(Y, Math.tan(e)))));
  const edges = [-1, 1].map(s => ENV.rayEarth(r, ray(0, s * el / 2)));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, se]) => ENV.rayEarth(r, ray(sa * az / 2, se * el / 2)));
  const out = { ok: false, side, look, bore: ENV.rayEarth(r, Z), incNear: null, incFar: null, near: null, far: null, width: null, corners };
  if (!edges[0] || !edges[1]) return out;
  const inc = edges.map(p => incidenceAt(p, r)), k = inc[0] <= inc[1] ? 0 : 1;
  Object.assign(out, { ok: true, near: edges[k], far: edges[1 - k], incNear: inc[k], incFar: inc[1 - k] });
  out.width = ENV.RE * v.angle(out.near, out.far);
  return out;
}

/** Whether SAR c can image with swath sw (sarSwath): both edges on the ground, within its imaging range. */
export function sarImaging(c, sw) {
  const D2R = Math.PI / 180;
  return !!sw && sw.ok && sw.incNear >= c.incMin * D2R - 1e-12 && sw.incFar <= c.incMax * D2R + 1e-12;
}

/** A target (ECI km) seen in the antenna frame of c at geometry A: { az, el } (rad from the boresight), front (in front of the panel), up (above its horizon). */
export function targetInAntenna(c, A, tgtI) {
  const r = A.st.r, [X, Y, Z] = axesI(c, A), d = v.sub(tgtI, r), z = v.dot(d, Z);
  return { az: Math.atan2(v.dot(d, X), z), el: Math.atan2(v.dot(d, Y), z), front: z > 0, up: v.dot(v.unit(tgtI), v.scale(d, -1)) > 0 };
}

/**
 * When the target (ECEF km) crosses the beam of SAR c between t0 and t1 (s from the epoch), i.e. its azimuth angle goes
 * through zero (the beam is ~half a degree wide in azimuth, so it is seen for seconds), and is within the elevation
 * beam, in front of the panel and above its horizon then: the time (s), or null. Refined to 0.05 s.
 */
export function beamCrossing(state, c, t0, t1, tgtE) {
  const e0 = epochDate(state.orbit).getTime();
  const at = t => { const A = attitudeAt(state, t); return targetInAntenna(c, A, ENV.ecef2eci(tgtE, new Date(e0 + t * 1000))); };
  let a = t0, b = t1, fa = at(a), fb = at(b);
  if (!(fa.front && fb.front) || Math.sign(fa.az) === Math.sign(fb.az)) return null;
  for (let k = 0; k < 60 && b - a > 0.05; k++) { const mid = (a + b) / 2, fm = at(mid); if (Math.sign(fm.az) === Math.sign(fa.az)) { a = mid; fa = fm; } else { b = mid; fb = fm; } }
  const tc = (a + b) / 2, x = at(tc), { el } = sarBeams(c);
  return x.front && x.up && Math.abs(x.el) <= el / 2 ? tc : null;
}

/**
 * The roll offset (deg) that puts SAR c's boresight at look angle `lookDeg` from nadir on `side` ('right' | 'left'),
 * keeping the yaw and pitch of guidance settings g (nominal attitude + offsets, 3-2-1), at time t (s): the root nearest
 * g's roll, or null if no roll gets there (e.g. a boresight along the roll axis).
 */
export function rollForLook(state, g, c, lookDeg, side, t = state.orbit.t) {
  const D2R = Math.PI / 180, A = attitudeAt(state, t), r = A.st.r, nadir = v.unit(v.scale(r, -1)), hHat = v.unit(v.cross(r, A.st.v));
  const boreB = m.col(compCBC(c), 2), look = lookDeg * D2R, want = side === 'left' ? -1 : 1;
  const at = phi => { const CBI = m.mul(AM.euler2C('321', [(g.yaw || 0) * D2R, (g.pitch || 0) * D2R, phi * D2R]), A.CNI), b = m.mulv(m.T(CBI), boreB); return { f: v.angle(b, nadir) - look, s: -v.dot(b, hHat) * want }; };
  const roots = [];
  for (let p = -180; p < 180; p += 0.5) {
    let lo = p, hi = p + 0.5, flo = at(lo), fhi = at(hi);
    if (Math.sign(flo.f) === Math.sign(fhi.f) && flo.f !== 0) continue;
    for (let k = 0; k < 50 && hi - lo > 1e-9; k++) { const mid = (lo + hi) / 2, fm = at(mid); if (Math.sign(fm.f) === Math.sign(flo.f)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; } }
    const root = (lo + hi) / 2; if (at(root).s > 0 && Math.abs(at(root).f) < 1e-6) roots.push(root);
  }
  if (!roots.length) return null;
  const cur = g.roll || 0, d = x => Math.abs(((x - cur + 540) % 360) - 180);
  return roots.reduce((b, x) => d(x) < d(b) ? x : b);
}
