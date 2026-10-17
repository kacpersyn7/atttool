/**
 * Attitude representations and conversions.
 *
 * Conventions (also in docs/CONVENTIONS.md and the in-app "Conventions" dialog):
 *  - C_BR : DCM, reference -> body. v_B = C_BR * v_R. Rows = body axes expressed in R.
 *  - Quaternion q = {w, x, y, z}. The same numbers can be read two ways:
 *      * Hamilton, active: R(q) = C_RB  (rotates reference axes onto body axes)
 *      * Shuster/JPL (Markley & Crassidis): A(q) = C_BR
 *  - Euler "i-j-k" (e.g. 3-2-1): C_BR = R_k(t3) R_j(t2) R_i(t1), R_n = frame (passive) rotations,
 *    i.e. rotate the frame by t1 about axis i, then t2 about the NEW axis j, then t3 about the NEWEST axis k.
 *
 * Import as a namespace (`import * as AM from './attitude.js'`): it also re-exports the
 * linear-algebra helpers so `AM.v`, `AM.m`, `AM.D2R` work everywhere.
 */
import { v, m } from './linalg.js';

export { D2R, R2D, v, m, eigSym } from './linalg.js';

/** Passive (frame) elementary rotation about axis n (1, 2, 3) by angle a (rad). */
export function Rp(n, a) {
  const c = Math.cos(a), s = Math.sin(a);
  if (n === 1) return [[1, 0, 0], [0, c, s], [0, -s, c]];
  if (n === 2) return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}
/** Active (vector) elementary rotation = transpose of Rp. */
export const Ra = (n, a) => m.T(Rp(n, a));

/* ---------------- quaternion ---------------- */
export const q = {
  id: () => ({ w: 1, x: 0, y: 0, z: 0 }),
  norm: p => Math.hypot(p.w, p.x, p.y, p.z),
  unit: p => { const n = q.norm(p) || 1; return { w: p.w / n, x: p.x / n, y: p.y / n, z: p.z / n }; },
  neg: p => ({ w: -p.w, x: -p.x, y: -p.y, z: -p.z }),
  conj: p => ({ w: p.w, x: -p.x, y: -p.y, z: -p.z }),
  /** Hamilton product a∘b */
  hmul: (a, b) => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }),
  /** Canonical sign: scalar part >= 0. */
  canon: p => (p.w < 0 ? q.neg(p) : p),
};

/** q -> C_BR (Shuster attitude matrix A(q)). */
export function q2C(p) {
  const { w, x, y, z } = p;
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), w * w - x * x + y * y - z * z, 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), w * w - x * x - y * y + z * z],
  ];
}

/** C_BR -> q (Shepperd's method), canonical sign. */
export function C2q(A) {
  const tr = A[0][0] + A[1][1] + A[2][2];
  let r;
  const cands = [tr, A[0][0], A[1][1], A[2][2]];
  const k = cands.indexOf(Math.max(...cands));
  if (k === 0) { const w = 0.5 * Math.sqrt(1 + tr); r = { w, x: (A[1][2] - A[2][1]) / (4 * w), y: (A[2][0] - A[0][2]) / (4 * w), z: (A[0][1] - A[1][0]) / (4 * w) }; }
  else if (k === 1) { const x = 0.5 * Math.sqrt(1 + A[0][0] - A[1][1] - A[2][2]); r = { x, w: (A[1][2] - A[2][1]) / (4 * x), y: (A[0][1] + A[1][0]) / (4 * x), z: (A[0][2] + A[2][0]) / (4 * x) }; }
  else if (k === 2) { const y = 0.5 * Math.sqrt(1 - A[0][0] + A[1][1] - A[2][2]); r = { y, w: (A[2][0] - A[0][2]) / (4 * y), x: (A[0][1] + A[1][0]) / (4 * y), z: (A[1][2] + A[2][1]) / (4 * y) }; }
  else { const z = 0.5 * Math.sqrt(1 - A[0][0] - A[1][1] + A[2][2]); r = { z, w: (A[0][1] - A[1][0]) / (4 * z), x: (A[0][2] + A[2][0]) / (4 * z), y: (A[1][2] + A[2][1]) / (4 * z) }; }
  return q.canon(q.unit(r));
}

/* ---------------- Euler angles ---------------- */
/** All 12 sequences: 6 Tait-Bryan (asymmetric) + 6 proper Euler (symmetric). */
export const SEQS = ['321', '312', '213', '231', '123', '132', '313', '323', '121', '131', '212', '232'];
export const seqAxes = s => s.split('').map(Number);
export const isSymmetric = s => s[0] === s[2];

/** Euler angles (rad) -> C_BR for intrinsic sequence `seq`. */
export function euler2C(seq, t) {
  const [i, j, k] = seqAxes(seq);
  return m.mul(Rp(k, t[2]), m.mul(Rp(j, t[1]), Rp(i, t[0])));
}

/** Active rotation matrix M about axis n (0-based) -> angle. */
function rotAngleAbout(M, n) {
  const p = (n + 1) % 3, r = (n + 2) % 3;
  return Math.atan2(M[r][p], M[p][p]);
}

/**
 * C_BR -> Euler angles (rad) for intrinsic sequence `seq`.
 * Uses Bernardes & Viollet (2022) on the Hamilton active quaternion of C_RB.
 * At gimbal lock: t1 := 0 and t3 is solved from the residual.
 */
export function C2euler(seq, C) {
  const qq = C2q(C);
  const Q = [qq.w, qq.x, qq.y, qq.z];
  const [I, J, K] = seqAxes(seq);
  // intrinsic (I,J,K) == extrinsic (K,J,I)
  let i = K, j = J, k = I;
  const proper = i === k;
  if (proper) k = 6 - i - j;
  const eps = (i - j) * (j - k) * (k - i) / 2;
  let a, b, c, d;
  if (proper) { a = Q[0]; b = Q[i]; c = Q[j]; d = Q[k] * eps; }
  else { a = Q[0] - Q[j]; b = Q[i] + Q[k] * eps; c = Q[j] + Q[0]; d = Q[k] * eps - Q[i]; }
  let th2 = 2 * Math.atan2(Math.hypot(c, d), Math.hypot(a, b));
  const tp = Math.atan2(b, a), tm = Math.atan2(d, c);
  let e1 = tp - tm, e3 = tp + tm; // extrinsic first / third
  const sing = Math.abs(th2) < 1e-7 || Math.abs(th2 - Math.PI) < 1e-7;
  if (!proper) { e3 *= eps; th2 -= Math.PI / 2; }
  // back to intrinsic order
  const t1 = e3, t2 = th2, t3 = e1;
  // the formulas above can come out as (e1,e3) swapped depending on paper conventions -> verify & fix
  const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
  let cand = [[wrap(t1), t2, wrap(t3)], [wrap(t3), t2, wrap(t1)]];
  if (sing) {
    // gimbal lock: t1 = 0, solve t3 from residual
    const [, Jj, Kk] = seqAxes(seq);
    const CRB = m.T(C);
    const Mres = m.mul(m.T(Ra(Jj, t2)), CRB); // Ra(I,0)=I
    const t3s = rotAngleAbout(Mres, Kk - 1);
    cand = [[0, t2, t3s]];
  }
  let best = cand[0], bestErr = 1e9;
  for (const c3 of cand) {
    const E = euler2C(seq, c3);
    let err = 0; for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) err += Math.abs(E[r][s] - C[r][s]);
    if (err < bestErr) { bestErr = err; best = c3; }
  }
  return best;
}

/** Approximate angular margin (rad) of the middle Euler angle from its singularity. */
export function gimbalMargin(seq, t) {
  const d = isSymmetric(seq) ? Math.abs(Math.sin(t[1])) : Math.abs(Math.cos(t[1]));
  return Math.asin(Math.min(1, d));
}

/* ---------------- axis-angle ---------------- */
export function q2axisAngle(p) {
  p = q.canon(q.unit(p));
  const ang = 2 * Math.acos(Math.min(1, p.w));
  const s = Math.sqrt(Math.max(0, 1 - p.w * p.w));
  const axis = s < 1e-9 ? [1, 0, 0] : [p.x / s, p.y / s, p.z / s];
  return { axis, angle: ang };
}
export function axisAngle2q(axis, ang) {
  const u = v.unit(axis), s = Math.sin(ang / 2);
  return { w: Math.cos(ang / 2), x: u[0] * s, y: u[1] * s, z: u[2] * s };
}
export function C2axisAngle(C) { return q2axisAngle(C2q(C)); }

/**
 * TRIAD / two-vector alignment. Body vectors b1 (primary, exact) and b2 (secondary, best effort)
 * are aligned with reference vectors r1, r2. Returns C_BR.
 */
export function triad(b1, b2, r1, r2) {
  const tb1 = v.unit(b1), tb2 = v.unit(v.cross(b1, b2)), tb3 = v.cross(tb1, tb2);
  const tr1 = v.unit(r1), tr2 = v.unit(v.cross(r1, r2)), tr3 = v.cross(tr1, tr2);
  const Mb = m.fromCols(tb1, tb2, tb3), Mr = m.fromCols(tr1, tr2, tr3);
  return m.mul(Mb, m.T(Mr));
}
