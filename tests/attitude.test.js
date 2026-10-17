import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AM from '../src/core/attitude.js';
import { close, closeArr, rng } from './helpers.js';

const rand = rng(42);
const randQ = () => AM.q.unit({ w: rand() - .5, x: rand() - .5, y: rand() - .5, z: rand() - .5 });

test('q2C gives a proper rotation matrix', () => {
  for (let k = 0; k < 50; k++) {
    const C = AM.q2C(randQ());
    close(AM.m.det(C), 1, 1e-12, 'det');
    closeArr(AM.m.mul(C, AM.m.T(C)), AM.m.I(), 1e-12, 'orthonormal');
  }
});

test('C2q inverts q2C (up to sign)', () => {
  for (let k = 0; k < 200; k++) {
    const q = AM.q.canon(randQ()); const q2 = AM.C2q(AM.q2C(q));
    closeArr([q2.w, q2.x, q2.y, q2.z], [q.w, q.x, q.y, q.z], 1e-12);
  }
});

test('q and -q give the same DCM', () => {
  const q = randQ(); closeArr(AM.q2C(q), AM.q2C(AM.q.neg(q)), 1e-15);
});

test('Rp is a frame rotation: R3(90°) maps inertial X onto body -Y', () => {
  // frame rotated +90° about Z: old X axis appears at -Y in the new frame
  closeArr(AM.m.mulv(AM.Rp(3, Math.PI / 2), [1, 0, 0]), [0, -1, 0], 1e-15);
});

test('Euler round trip for all 12 sequences', () => {
  for (const seq of AM.SEQS) {
    const sym = AM.isSymmetric(seq);
    for (let k = 0; k < 40; k++) {
      const t = [(rand() * 2 - 1) * Math.PI * .95, sym ? (0.05 + rand() * 0.9) * Math.PI : (rand() * 2 - 1) * Math.PI * .45, (rand() * 2 - 1) * Math.PI * .95];
      const C = AM.euler2C(seq, t);
      closeArr(AM.C2euler(seq, C), t, 1e-9, seq);
    }
  }
});

test('Euler at gimbal lock still reproduces the DCM', () => {
  for (const seq of ['321', '123', '313']) {
    const t2 = AM.isSymmetric(seq) ? 0 : Math.PI / 2;
    const C = AM.euler2C(seq, [0.4, t2, -0.7]);
    const e = AM.C2euler(seq, C);
    close(e[0], 0, 1e-12, 't1 := 0');
    closeArr(AM.euler2C(seq, e), C, 1e-9, seq);
  }
});

test('3-2-1 matches the textbook yaw/pitch/roll matrix', () => {
  const [psi, th, ph] = [0.3, -0.2, 0.5];
  const C = AM.euler2C('321', [psi, th, ph]);
  closeArr(C, AM.m.mul(AM.Rp(1, ph), AM.m.mul(AM.Rp(2, th), AM.Rp(3, psi))), 1e-15);
});

test('axis-angle round trip and trace identity', () => {
  for (let k = 0; k < 50; k++) {
    const q = randQ(); const { axis, angle } = AM.q2axisAngle(q);
    const C = AM.q2C(q);
    close(C[0][0] + C[1][1] + C[2][2], 1 + 2 * Math.cos(angle), 1e-12, 'trace');
    closeArr(AM.q2C(AM.axisAngle2q(axis, angle)), C, 1e-12);
    // the eigenaxis has the same components in both frames
    closeArr(AM.m.mulv(C, axis), axis, 1e-12, 'eigenaxis');
  }
});

test('TRIAD aligns primary exactly', () => {
  const b1 = [0, 0, 1], b2 = [1, 0, 0], r1 = AM.v.unit([1, 2, 3]), r2 = [0, 1, 0];
  const C = AM.triad(b1, b2, r1, r2);
  closeArr(AM.m.mulv(C, r1), b1, 1e-12);
  close(AM.m.det(C), 1, 1e-12);
});

test('gimbalMargin is 0 at the singularity', () => {
  close(AM.gimbalMargin('321', [0, Math.PI / 2, 0]), 0, 1e-7);
  close(AM.gimbalMargin('313', [0, 0, 0]), 0, 1e-12);
  assert.ok(AM.gimbalMargin('321', [0, 0, 0]) > 1.5);
});

test('eigSym recovers a known spectrum', () => {
  const R = AM.q2C(randQ()); const D = [[1, 0, 0], [0, 2, 0], [0, 0, 5]];
  const S = AM.m.mul(AM.m.T(R), AM.m.mul(D, R));
  closeArr(AM.eigSym(S).vals, [1, 2, 5], 1e-9);
});
