/**
 * Mass properties about the centre of mass, in spacecraft-frame (SCF) axes; CoM given in SCF.
 * Model: bus = uniform box, components = point masses, solar arrays = thin plates.
 */
import * as AM from '../core/attitude.js';
import { compCBC } from './component.js';
import { busPose } from './bus.js';

/** @returns {{M:number, com:number[], I:number[][], E:{vals:number[], vecs:number[][]}}} */
export function massProps(sc) {
  const { x, y, z, mass: Mb } = sc.bus;
  const IbG = [[Mb / 12 * (y * y + z * z), 0, 0], [0, Mb / 12 * (x * x + z * z), 0], [0, 0, Mb / 12 * (x * x + y * y)]];
  const bp = busPose(sc); // bus box: centre and axes in SCF
  const parts = [{ m: Mb, p: bp.pos, I: AM.m.mul(bp.C, AM.m.mul(IbG, AM.m.T(bp.C))) }];
  for (const c of sc.comps) {
    let Ic = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    if (c.type === 'sa') { const w = c.w || 1, hh = c.h || .7, m = c.mass; const Il = [[m * hh * hh / 12, 0, 0], [0, m * w * w / 12, 0], [0, 0, m * (w * w + hh * hh) / 12]]; const C = compCBC(c); Ic = AM.m.mul(C, AM.m.mul(Il, AM.m.T(C))); }
    parts.push({ m: c.mass || 0, p: c.pos, I: Ic });
  }
  const M = parts.reduce((s, p) => s + p.m, 0);
  const com = [0, 1, 2].map(k => parts.reduce((s, p) => s + p.m * p.p[k], 0) / M);
  const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of parts) {
    const d = AM.v.sub(p.p, com), dd = AM.v.dot(d, d);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += p.I[i][j] + p.m * ((i === j ? dd : 0) - d[i] * d[j]);
  }
  const E = AM.eigSym(I);
  return { M, com, I, E };
}

/** Largest angle (deg) between a principal axis and its nearest body axis. */
export function maxPrincipalTilt(E) {
  let mx = 0;
  E.vecs.forEach(a => { const k = a.map(Math.abs).indexOf(Math.max(...a.map(Math.abs))); mx = Math.max(mx, AM.R2D * Math.acos(Math.min(1, Math.abs(a[k])))); });
  return mx;
}
