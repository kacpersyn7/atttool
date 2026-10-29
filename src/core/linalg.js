/**
 * Small, allocation-friendly 3-vector and 3x3-matrix helpers.
 *
 * Representation:
 *  - vector  = plain array [x, y, z]
 *  - matrix  = array of ROWS [[a, b, c], [d, e, f], [g, h, i]]
 *
 * Pure functions only — no DOM, no three.js — so this runs in Node for tests.
 */

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

/** 3-vector operations. */
export const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => Math.hypot(a[0], a[1], a[2]),
  unit: a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; },
  /** Angle between two vectors (rad), robust to rounding. */
  angle: (a, b) => Math.acos(Math.max(-1, Math.min(1, v.dot(v.unit(a), v.unit(b))))),
};

/** 3x3 matrix operations (matrices are arrays of rows). */
export const m = {
  I: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  mul: (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])),
  mulv: (A, x) => A.map(r => r[0] * x[0] + r[1] * x[1] + r[2] * x[2]),
  T: A => [0, 1, 2].map(i => [A[0][i], A[1][i], A[2][i]]),
  det: A => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]),
  fromCols: (c0, c1, c2) => [[c0[0], c1[0], c2[0]], [c0[1], c1[1], c2[1]], [c0[2], c1[2], c2[2]]],
  fromRows: (r0, r1, r2) => [r0.slice(), r1.slice(), r2.slice()],
  col: (A, j) => [A[0][j], A[1][j], A[2][j]],
  /** Inverse of a 3x3 matrix (null if singular). */
  inv: A => {
    const d = m.det(A); if (!Number.isFinite(d) || Math.abs(d) < 1e-14) return null;
    const c = (r0, c0, r1, c1) => A[r0][c0] * A[r1][c1] - A[r0][c1] * A[r1][c0];
    return [
      [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
      [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
      [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d],
    ];
  },
};

/**
 * Eigen-decomposition of a symmetric 3x3 matrix (cyclic Jacobi).
 * @returns {{vals:number[], vecs:number[][]}} eigenvalues ascending, eigenvectors as arrays (matching order).
 */
export function eigSym(S) {
  let A = S.map(r => r.slice()); let V = m.I();
  for (let it = 0; it < 50; it++) {
    let p = 0, qq = 1, mx = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > mx) { mx = Math.abs(A[0][2]); p = 0; qq = 2; }
    if (Math.abs(A[1][2]) > mx) { mx = Math.abs(A[1][2]); p = 1; qq = 2; }
    if (mx < 1e-12) break;
    const th = 0.5 * Math.atan2(2 * A[p][qq], A[qq][qq] - A[p][p]);
    const c = Math.cos(th), s = Math.sin(th);
    const J = m.I(); J[p][p] = c; J[qq][qq] = c; J[p][qq] = s; J[qq][p] = -s;
    A = m.mul(m.T(J), m.mul(A, J)); V = m.mul(V, J);
  }
  const vals = [A[0][0], A[1][1], A[2][2]];
  const idx = [0, 1, 2].sort((a, b) => vals[a] - vals[b]);
  return { vals: idx.map(i => vals[i]), vecs: idx.map(i => m.col(V, i)) };
}
