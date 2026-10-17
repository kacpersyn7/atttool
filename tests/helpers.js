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
