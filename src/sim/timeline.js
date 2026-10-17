/**
 * One-orbit availability timeline (eclipse, star trackers, Sun sensors, array power, payload).
 * Pure computation; drawing lives in views/orbit/timelineView.js.
 */
import * as ENV from '../env/index.js';
import { orbitElements } from './scenario.js';
import { attitudeAt, payloadComp } from './guidance.js';
import { sensorEval } from './sensors.js';

export function timelineRows(state) {
  const comps = state.sc.comps;
  const rows = [{ name: 'Eclipse', kind: 'ecl' }];
  comps.filter(c => c.type === 'str').forEach(c => rows.push({ name: c.name, kind: 'str', c }));
  if (comps.some(c => c.type === 'css')) rows.push({ name: 'Sun sensors', kind: 'css' });
  const sa = comps.filter(c => c.type === 'sa'); if (sa.length) rows.push({ name: 'Array power', kind: 'sa', cs: sa });
  const pc = payloadComp(state); if (pc) rows.push({ name: pc.name + ' on ground', kind: 'pl', c: pc });
  return rows;
}

/** Cache key: everything the timeline depends on. */
export function timelineKey(state, scVersion, W0) {
  const o = state.orbit;
  return JSON.stringify([orbitElements(o), o.mode, o.roll, o.pitch, o.yaw, o.sunAxis, o.sunSecAxis, o.sunSec, o.tgtLat, o.tgtLon, o.tgtComp, o.epoch, o.j2, scVersion, W0, o.mode === 'inertial' ? state.rot.q : 0]);
}

/**
 * Sample the orbit that contains state.orbit.t at N points.
 * Row values: ecl 0/1 · str 0 ok / 2 Sun-blind / 3 Earth-blind · css 0/1 · sa 0..1 · pl 0/1.
 * Returns the previous result unchanged if nothing relevant changed.
 */
export function computeTimeline(state, scVersion, prev, N = 360) {
  const E = orbitElements(state.orbit); const T = ENV.propagate(E, 0, false).period; const W0 = Math.floor(state.orbit.t / T) * T;
  const key = timelineKey(state, scVersion, W0);
  if (prev && key === prev.key) return prev;
  const tl = { key, W0, T, rows: timelineRows(state), N };
  tl.rows.forEach(r => r.v = new Array(N));
  const css = state.sc.comps.filter(c => c.type === 'css');
  for (let n = 0; n < N; n++) {
    const A = attitudeAt(state, W0 + (n + .5) / N * T, E);
    for (const r of tl.rows) {
      if (r.kind === 'ecl') r.v[n] = A.ecl ? 1 : 0;
      else if (r.kind === 'str') { const s = sensorEval(r.c, A); r.v[n] = s.sunBlind ? 2 : s.earthBlind ? 3 : 0; }
      else if (r.kind === 'css') r.v[n] = css.some(c => sensorEval(c, A).sees) ? 1 : 0;
      else if (r.kind === 'sa') r.v[n] = r.cs.reduce((s, c) => s + sensorEval(c, A).cosInc * c.w * c.h, 0) / r.cs.reduce((s, c) => s + c.w * c.h, 0);
      else if (r.kind === 'pl') r.v[n] = sensorEval(r.c, A).onGround ? 1 : 0;
    }
  }
  // percentage per row: STR = % tracking, SA = mean power fraction, others = % of samples "on"
  tl.stats = tl.rows.map(r => r.kind === 'str' ? (100 * r.v.filter(x => x === 0).length / N) : r.kind === 'sa' ? (100 * r.v.reduce((s, x) => s + x, 0) / N) : (100 * r.v.filter(x => x).length / N));
  return tl;
}
