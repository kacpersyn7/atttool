/**
 * The world map (Natural Earth, data/worldMap.js) in the payload view: culling, clipping and
 * gnomonic projection into the payload image (same image coordinates as sim/payload.js: tangents,
 * +X_C right, +Y_C down). Pure computation; views/orbit/payloadInset.js draws the result.
 *
 * Every map point is a point on the spherical Earth. Each is carried as a 4-vector [x, y, z, h]:
 * payload-frame coordinates relative to the spacecraft, and h = û·r̂_E − R_E/|r|, which is ≥ 0 when the
 * point is above the spacecraft's horizon. Clipping keeps the part with h ≥ 0 inside the view pyramid
 * |x| ≤ Kx·z, |y| ≤ Ky·z. All five tests are linear in the 3-D point, so edges (straight chords between
 * vertices ≤ 0.5° apart) are clipped exactly by interpolation, and a straight 3-D edge stays straight in
 * the gnomonic image. Where a polygon is cut by the horizon, the cut follows the limb circle (clipHorizon).
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { worldMap } from '../data/worldMap.js';

const { v, m } = AM;
const D2R = AM.D2R;
const CHUNK = 48; // points per culling chunk of a line

/** Unit ECEF vectors of a [lon, lat, …] degree array (Float64Array, 3 per point). */
function units(ll) {
  const n = ll.length / 2, u = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const j = i, lo = ll[2 * j] * D2R, la = ll[2 * j + 1] * D2R, c = Math.cos(la);
    u[3 * i] = c * Math.cos(lo); u[3 * i + 1] = c * Math.sin(lo); u[3 * i + 2] = Math.sin(la);
  }
  return u;
}

/** Bounding cap of unit vectors: { c (unit centre), ang (rad) }. */
function cap(list) {
  let s = [0, 0, 0];
  for (const u of list) for (let i = 0; i < u.length; i += 3) s = [s[0] + u[i], s[1] + u[i + 1], s[2] + u[i + 2]];
  const c = v.norm(s) > 1e-9 ? v.unit(s) : [1, 0, 0];
  let cmin = 1; for (const u of list) for (let i = 0; i < u.length; i += 3) cmin = Math.min(cmin, c[0] * u[i] + c[1] * u[i + 1] + c[2] * u[i + 2]);
  return { c, ang: Math.acos(Math.max(-1, cmin)) + 1e-4 }; // margin for the chord sag of ≤ 0.5° edges
}

/** Lines split into short chunks (one shared point between chunks) with their caps. */
function chunks(lines) {
  const out = [];
  for (const ll of lines) {
    const u = units(ll), n = u.length / 3;
    for (let a = 0; a < n - 1; a += CHUNK) { const s = u.subarray(3 * a, 3 * Math.min(n, a + CHUNK + 1)); out.push({ u: s, ...cap([s]) }); }
  }
  return out;
}

/**
 * Coastlines from the land / lake rings, without the artificial edges where Natural Earth cuts
 * polygons along the ±180° meridian and the South Pole (a closed ring → open runs).
 */
export function coastRuns(ring) {
  const n = ring.length / 2, cut = (i, j) => {
    const a = [ring[2 * i], ring[2 * i + 1]], b = [ring[2 * j], ring[2 * j + 1]];
    return (Math.abs(a[0]) >= 179.99 && Math.abs(b[0]) >= 179.99 && Math.sign(a[0]) === Math.sign(b[0])) || (a[1] <= -89.99 && b[1] <= -89.99);
  };
  let s = -1; for (let i = 0; i < n; i++) if (cut(i, (i + 1) % n)) { s = (i + 1) % n; break; }
  if (s < 0) { const c = new Float64Array(2 * n + 2); c.set(ring); c[2 * n] = ring[0]; c[2 * n + 1] = ring[1]; return [c]; }
  const runs = []; let cur = [];
  for (let k = 0; k < n; k++) {
    const i = (s + k) % n, j = (i + 1) % n; cur.push(ring[2 * i], ring[2 * i + 1]);
    if (cut(i, j)) { if (cur.length >= 4) runs.push(Float64Array.from(cur)); cur = []; }
  }
  if (cur.length) { cur.push(ring[2 * s], ring[2 * s + 1]); if (cur.length >= 4) runs.push(Float64Array.from(cur)); }
  return runs;
}

let prep = null;
/** Map prepared for projection (unit vectors, chunks and caps); built once. */
export function preparedMap() {
  if (prep) return prep;
  const w = worldMap();
  const polys = P => P.map(rings => { const us = rings.map(r => units(r)); return { rings: us, ll: rings, ...cap(us) }; });
  prep = {
    land: polys(w.land), lakes: polys(w.lakes),
    coast: chunks(w.land.flat().flatMap(coastRuns)), lakeShore: chunks(w.lakes.flat().flatMap(coastRuns)),
    borders: chunks(w.borders), provinces: chunks(w.provinces), rivers: chunks(w.rivers),
    cities: w.cities.map(c => ({ ...c, u: units([c.lon, c.lat]) })),
  };
  return prep;
}

/**
 * Projection context for camera C_CI at position r (ECI km) and time `date`.
 * halfX, halfY: half-extent of the view in tangents (clipped slightly beyond).
 */
export function mapCamera(CCI, r, date, halfX, halfY) {
  const RIE = AM.Ra(3, ENV.gmst(date)), M = m.mul(CCI, RIE); // ECEF → payload frame
  const t = m.mulv(CCI, r), rn = v.norm(r), rE = v.unit(m.mulv(m.T(RIE), r)), hc = ENV.RE / rn;
  const Kx = halfX * 1.02, Ky = halfY * 1.02;
  // sub-satellite point and its antipode, [lon, lat] deg (for clipHorizon's containment tests)
  const nLat = Math.asin(rE[2]) / D2R, nLon = Math.atan2(rE[1], rE[0]) / D2R;
  const nadirLL = [nLon, nLat], antiLL = [nLon > 0 ? nLon - 180 : nLon + 180, -nLat];
  // limb circle (camera coords): centre, radius, and a right-handed basis (limbA, limbB, limbN) with limbN
  // along r̂ (outward), so the azimuth about the nadir axis grows counter-clockwise seen from outside
  const limbC = m.mulv(CCI, v.sub(v.scale(r, ENV.RE * ENV.RE / (rn * rn)), r)), limbN = m.mulv(CCI, v.scale(r, 1 / rn));
  const limbR = ENV.RE * Math.sqrt(Math.max(0, 1 - hc * hc));
  const limbA = v.unit(v.cross(limbN, Math.abs(limbN[0]) < .9 ? [1, 0, 0] : [0, 1, 0])), limbB = v.cross(limbN, limbA);
  /** 4-vector of unit ECEF vector at u[i..i+2]. */
  const P = (u, i = 0) => {
    const x = u[i], y = u[i + 1], z = u[i + 2], R = ENV.RE;
    return [R * (M[0][0] * x + M[0][1] * y + M[0][2] * z) - t[0], R * (M[1][0] * x + M[1][1] * y + M[1][2] * z) - t[1],
      R * (M[2][0] * x + M[2][1] * y + M[2][2] * z) - t[2], rE[0] * x + rE[1] * y + rE[2] * z - hc];
  };
  // clip functions f(p) ≥ 0 inside: horizon, then the four sides of the view pyramid
  const F = [p => p[3], p => Kx * p[2] - p[0], p => Kx * p[2] + p[0], p => Ky * p[2] - p[1], p => Ky * p[2] + p[1]];
  // frustum side-plane unit normals (outward) for sphere culling
  const N = [[1, 0, -Kx], [-1, 0, -Kx], [0, 1, -Ky], [0, -1, -Ky]].map(n => v.unit(n));
  /** Can a cap (unit centre c, angle ang) be visible? */
  const maybe = ({ c, ang }) => {
    if (v.dot(c, rE) < Math.cos(Math.min(Math.PI, ang + Math.acos(hc)))) return false; // beyond the horizon cap
    if (ang > 1) return true;
    const p = P(c), rho = 2 * ENV.RE * Math.sin(ang / 2); // every point of the cap is within this chord of its centre
    return N.every(n => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] <= rho);
  };
  return { P, F, maybe, limbC, limbN, limbR, limbA, limbB, rE, hc, Kx, Ky, nadirLL, antiLL };
}

const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];

const TAU = 2 * Math.PI, wrap = d => d - TAU * Math.round(d / TAU);
/** Azimuth of a camera-frame point about the nadir axis. */
const azim = (cam, p) => { const d = [p[0] - cam.limbC[0], p[1] - cam.limbC[1], p[2] - cam.limbC[2]]; return Math.atan2(v.dot(d, cam.limbB), v.dot(d, cam.limbA)); };
/** Points on the limb circle from azimuth f0 turning by dphi (endpoints excluded; ~2° steps), h = 0. */
function limbArc(cam, f0, dphi) {
  const n = Math.ceil(Math.abs(dphi) / (2 * D2R)), out = [];
  for (let k = 1; k < n; k++) {
    const f = f0 + dphi * k / n, c = cam.limbR * Math.cos(f), s = cam.limbR * Math.sin(f);
    out.push([cam.limbC[0] + c * cam.limbA[0] + s * cam.limbB[0], cam.limbC[1] + c * cam.limbA[1] + s * cam.limbB[1], cam.limbC[2] + c * cam.limbA[2] + s * cam.limbB[2], 0]);
  }
  return out;
}

/** Even-odd point-in-ring test in lon/lat (rings never cross ±180°: Natural Earth splits them there). */
export function inRingLL(ll, [x, y]) {
  let c = false; const n = ll.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = ll[2 * i], yi = ll[2 * i + 1], xj = ll[2 * j], yj = ll[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
  return c;
}

/**
 * Clip a closed ring of 4-vectors to the visible side of the horizon (h ≥ 0); returns a list of rings
 * for even-odd filling. While the ring is hidden, the cut follows the limb by the ring's signed turn
 * about the nadir axis, so a polygon that continues beyond the horizon fills the view up to the limb.
 * That clipped ring winds around a visible point p as often as the original ring winds around p minus
 * around the antipode A of the sub-satellite point, so when the ring contains A (seen from high orbits,
 * e.g. Afro-Eurasia from 1500 km) one full Earth disc is added to restore the parity. A ring hidden
 * everywhere fills the whole disc exactly when it contains the sub-satellite point.
 * ll: the same ring in lon/lat degrees, for the containment tests.
 */
export function clipHorizon(ring, cam, ll) {
  const n = ring.length; if (!n) return [];
  const disc = () => limbArc(cam, 0, TAU + 4 * D2R).slice(0, 180);
  const s = ring.findIndex(p => p[3] >= 0);
  if (s < 0) return inRingLL(ll, cam.nadirLL) ? [disc()] : [];
  const res = []; let acc = 0, prev = 0, f0 = 0;
  for (let k = 1; k <= n; k++) {
    const S = ring[(s + k - 1) % n], E = ring[(s + k) % n], fs = S[3], fe = E[3];
    if (fe >= 0) {
      if (fs < 0) { const I = lerp(S, E, fs / (fs - fe)); acc += wrap(azim(cam, I) - prev); res.push(...limbArc(cam, f0, acc), I); }
      res.push(E);
    } else {
      if (fs >= 0) { const X = lerp(S, E, fs / (fs - fe)); res.push(X); f0 = prev = azim(cam, X); acc = 0; }
      const a = azim(cam, E); acc += wrap(a - prev); prev = a;
    }
  }
  return inRingLL(ll, cam.antiLL) ? [res, disc()] : [res];
}

/** Sutherland–Hodgman: clip a closed ring of 4-vectors against f ≥ 0 (a plane through the camera). */
export function clipRing(ring, f) {
  const n = ring.length, out = []; if (!n) return out;
  for (let i = 0; i < n; i++) {
    const S = ring[(i + n - 1) % n], E = ring[i], fs = f(S), fe = f(E);
    if (fe >= 0) { if (fs < 0) out.push(lerp(S, E, fs / (fs - fe))); out.push(E); }
    else if (fs >= 0) out.push(lerp(S, E, fs / (fs - fe)));
  }
  return out;
}

/** Clip a polyline of 4-vectors against all clip functions; returns visible runs. */
export function clipLine(pts, F) {
  const runs = []; let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i], B = pts[i + 1]; let t0 = 0, t1 = 1;
    for (const f of F) {
      const fa = f(A), fb = f(B);
      if (fa < 0 && fb < 0) { t0 = 1; t1 = 0; break; }
      if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
    }
    if (t0 >= t1) { cur = null; continue; }
    const a = t0 > 0 ? lerp(A, B, t0) : A, b = t1 < 1 ? lerp(A, B, t1) : B;
    if (!cur || t0 > 0) { cur = [a]; runs.push(cur); }
    cur.push(b); if (t1 < 1) cur = null;
  }
  return runs;
}

/** 4-vector points → flat image tangents [x0, y0, x1, y1, …]. */
const flat = pts => { const o = new Float64Array(2 * pts.length); pts.forEach((p, i) => { o[2 * i] = p[0] / p[2]; o[2 * i + 1] = p[1] / p[2]; }); return o; };
/** 4-vectors of a chunk / ring, every cam.step-th vertex (level of detail; lines keep their last point). */
const pts4 = (cam, u, line = false) => {
  const o = [], n = u.length / 3, k = cam.step;
  for (let i = 0; i < n; i += k) o.push(cam.P(u, 3 * i));
  if (line && (n - 1) % k) o.push(cam.P(u, 3 * (n - 1)));
  return o;
};

function clipPoly(cam, poly) {
  const out = [];
  for (let j = 0; j < poly.rings.length; j++) for (let r of clipHorizon(pts4(cam, poly.rings[j]), cam, poly.ll[j])) {
    for (let k = 1; k < 5 && r.length; k++) r = clipRing(r, cam.F[k]);
    if (r.length >= 3) out.push(flat(r));
  }
  return out;
}

/**
 * The map as seen by the payload camera.
 * @param CCI payload C_CI, r spacecraft ECI (km), date, halfX/halfY view half-extent (tangents)
 * @param opts { borders, provinces, rivers, cities } (default all true); px: image width in pixels, enables
 *   the level of detail (fewer vertices when a pixel spans many km, e.g. a full Earth disc from GEO)
 * @returns { earth: ring | null (Earth disc ∩ view; null if no Earth in view), land, lakes: [[ring, …], …]
 *   (draw each polygon with even-odd fill), coast, shore, borders, provinces, rivers: [run, …],
 *   cities: [{ name, pop, kind, x, y }] largest first }. Rings and runs are flat [x, y, …] tangent arrays.
 */
export function mapView(CCI, r, date, halfX, halfY, opts = {}) {
  const cam = mapCamera(CCI, r, date, halfX, halfY), pm = preparedMap();
  // level of detail: with opts.px (image width in pixels), skip vertices closer than about a pixel. The
  // nearest ground is at the altitude, so this underestimates km per pixel; vertices are ~3 km apart.
  cam.step = opts.px ? Math.max(1, Math.min(32, Math.floor((v.norm(r) - ENV.RE) * 2 * halfX / opts.px / 3))) : 1;
  // Earth disc: the limb circle (h = 0) clipped by the pyramid
  let d = limbArc(cam, 0, TAU + 4 * D2R).slice(0, 180); for (let k = 1; k < 5 && d.length; k++) d = clipRing(d, cam.F[k]);
  const out = { earth: d.length >= 3 ? flat(d) : null, land: [], lakes: [], coast: [], shore: [], borders: [], provinces: [], rivers: [], cities: [] };
  if (!out.earth) return out;
  const lines = (list, dst) => { for (const ch of list) if (cam.maybe(ch)) for (const run of clipLine(pts4(cam, ch.u, true), cam.F)) if (run.length > 1) dst.push(flat(run)); };
  for (const p of pm.land) if (cam.maybe(p)) { const c = clipPoly(cam, p); if (c.length) out.land.push(c); }
  for (const p of pm.lakes) if (cam.maybe(p)) { const c = clipPoly(cam, p); if (c.length) out.lakes.push(c); }
  lines(pm.coast, out.coast); lines(pm.lakeShore, out.shore);
  if (opts.borders !== false) lines(pm.borders, out.borders);
  if (opts.provinces !== false) lines(pm.provinces, out.provinces);
  if (opts.rivers !== false) lines(pm.rivers, out.rivers);
  if (opts.cities !== false) for (const c of pm.cities) {
    const p = cam.P(c.u); if (cam.F.every(f => f(p) >= 0)) out.cities.push({ name: c.name, pop: c.pop, kind: c.kind, x: p[0] / p[2], y: p[1] / p[2] });
  }
  return out;
}
