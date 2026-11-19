import assert from 'node:assert/strict';

export function close(a, b, tol = 1e-9, msg = '') {
  assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a} (tol ${tol})`);
}
export function closeArr(a, b, tol = 1e-9, msg = '') {
  const fa = a.flat(), fb = b.flat();
  assert.equal(fa.length, fb.length, msg + ' length');
  fa.forEach((x, i) => close(x, fb[i], tol, `${msg}[${i}]`));
}
/** Deterministic pseudo-random numbers for repeatable tests. */
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/**
 * Reference J2-only motion for tests: RK4 on two-body + J2 gravity (constants of src/env), step h s, from state
 * y0 = [r (km), v (km/s)] for T s. Calls visit(t, y) at every step. Energy and h_z stay constant to ~1e-11 (tested).
 */
export function j2Motion(y0, T, h, visit, { MU, RE, J2 }) {
  const norm = a => Math.hypot(a[0], a[1], a[2]), add = (a, b, k) => a.map((x, i) => x + k * b[i]);
  const f = y => { const r = y.slice(0, 3), rn = norm(r), z2 = (r[2] / rn) ** 2, k = -1.5 * J2 * MU * RE * RE / rn ** 5, g = -MU / rn ** 3;
    return [y[3], y[4], y[5], r[0] * (g + k * (1 - 5 * z2)), r[1] * (g + k * (1 - 5 * z2)), r[2] * (g + k * (3 - 5 * z2))]; };
  let y = [...y0]; visit(0, y);
  for (let k = 1; k * h <= T + 1e-9; k++) { const k1 = f(y), k2 = f(add(y, k1, h / 2)), k3 = f(add(y, k2, h / 2)), k4 = f(add(y, k3, h)); y = y.map((x, i) => x + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); visit(k * h, y); }
}
