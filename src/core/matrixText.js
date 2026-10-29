/**
 * 3x3 matrices as text, and repairing "almost rotation" matrices.
 * Used for pasting DCMs from MATLAB / NumPy / spreadsheets.
 */
import { m } from './linalg.js';

/**
 * Parse a 3x3 matrix from text. Accepts MATLAB `[a b c; d e f; g h i]`, NumPy
 * `[[a, b, c], [d, e, f], [g, h, i]]`, or three lines of numbers (spaces, commas or tabs).
 * Rows are separated by `;`, `],[` or newlines. Throws Error with a readable message.
 */
export function parseMatrix3(text) {
  const t = String(text).trim().replace(/^[A-Za-z_]\w*\s*=\s*/, '').replace(/np\.array\(|\);?$|\)$/g, '');
  const rows = t.replace(/\]\s*,?\s*\[/g, ';').replace(/[[\]]/g, ' ').split(/[;\n]+/).map(r => r.trim()).filter(Boolean)
    .map(r => r.split(/[\s,]+/).filter(Boolean).map(Number));
  const nums = rows.flat();
  if (nums.some(x => !Number.isFinite(x))) throw new Error('Could not read all entries as numbers.');
  if (nums.length !== 9) throw new Error(`Expected 9 numbers (3×3), found ${nums.length}.`);
  if (rows.length === 3 && rows.some(r => r.length !== 3)) throw new Error('Each row must have 3 numbers.');
  return [nums.slice(0, 3), nums.slice(3, 6), nums.slice(6, 9)];
}

/** MATLAB literal, e.g. `[1 0 0; 0 1 0; 0 0 1]`. */
export function formatMatlab(C, digits = 6) {
  return '[' + C.map(r => r.map(x => (Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x).toFixed(digits).replace(/\.?0+$/, '') || '0').join(' ')).join('; ') + ']';
}

/** Largest entry of |CᵀC − I| (0 for an exact rotation or reflection). */
export function orthoError(C) {
  const P = m.mul(m.T(C), C); let e = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e = Math.max(e, Math.abs(P[i][j] - (i === j ? 1 : 0)));
  return e;
}

/** Nearest rotation matrix (polar decomposition by Newton iteration X ← (X + X⁻ᵀ)/2). Null if singular. */
export function orthonormalize(C) {
  let X = C.map(r => r.slice());
  for (let k = 0; k < 30; k++) {
    const Xi = m.inv(X); if (!Xi) return null;
    const N = X.map((r, i) => r.map((x, j) => 0.5 * (x + Xi[j][i])));
    const d = Math.max(...N.flat().map((x, i) => Math.abs(x - X.flat()[i]))); X = N;
    if (d < 1e-15) break;
  }
  return X;
}

/**
 * Classify a matrix as a DCM: { ok, err, det, fixable }. ok: proper rotation within `tol`;
 * fixable: close enough (orthogonality error < 0.2, det > 0) to orthonormalise.
 */
export function checkRotation(C, tol = 1e-6) {
  const err = orthoError(C), det = m.det(C);
  return { ok: err < tol && det > 0, err, det, fixable: err < 0.2 && det > 0 };
}
