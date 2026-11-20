/**
 * One-orbit availability timeline (eclipse, star trackers, Sun sensors, array power, payload, SAR imaging and the
 * target crossing its beam).
 * Pure computation; drawing lives in views/orbit/timelineView.js.
 */
import * as ENV from '../env/index.js';
import { orbitElements, pageAt, targetECEF } from './scenario.js';
import { MODES, attitudeAt, payloadComp } from './guidance.js';
import { sensorEval } from './sensors.js';
import { beamCrossing, sarImaging, sarSwath, targetInAntenna } from './sar.js';

export function timelineRows(state) {
  const comps = state.sc.comps;
  const rows = [{ name: 'Eclipse', kind: 'ecl' }];
  if (state.orbit.schedule && state.orbit.schedule.length) rows.unshift({ name: 'Mode', kind: 'mode' });
  comps.filter(c => c.type === 'str').forEach(c => rows.push({ name: c.name, kind: 'str', c }));
  if (comps.some(c => c.type === 'css')) rows.push({ name: 'Sun sensors', kind: 'css' });
  const sa = comps.filter(c => c.type === 'sa'); if (sa.length) rows.push({ name: 'Array power', kind: 'sa', cs: sa });
  // the payload of what flies at each sample; the row is named after it when the whole schedule uses one
  const o = state.orbit, pcs = [o, ...(o.schedule || [])].map(g => payloadComp(state, g)).filter(Boolean), pc = pcs[0];
  if (pc) rows.push({ name: pcs.every(c => c === pc) ? pc.name + ' on ground' : 'Payload on ground', kind: 'pl' });
  // the first SAR antenna (#11): when it can image, and when the target crosses its beam
  const sar = comps.find(c => c.type === 'sar');
  if (sar) rows.push({ name: sar.name + ' imaging', kind: 'sar', c: sar }, { name: 'Target in ' + sar.name, kind: 'sart', c: sar });
  return rows;
}

/** Cache key: everything the timeline depends on. */
export function timelineKey(state, scVersion, W0) {
  const o = state.orbit;
  return JSON.stringify([orbitElements(o), o.mode, o.refFrame, o.roll, o.pitch, o.yaw, o.sunAxis, o.sunSecAxis, o.sunSec, o.tgtLat, o.tgtLon, o.tgtAlt, o.tgtComp, o.tgtSlew, o.schedule || [], o.epoch, o.j2, scVersion, W0, o.mode === 'inertial' || (o.schedule || []).some(c => c.mode === 'inertial' && !c.q) ? state.rot.q : 0]);
}

/**
 * Sample the orbit that contains state.orbit.t at N points.
 * Row values: mode index in MODES (+ 10 while slewing into it) · ecl 0/1 · str 0 ok / 2 Sun-blind / 3 Earth-blind / 4 Moon-blind (first cause that applies) · css 0/1 · sa 0..1 · pl 0/1
 * · sar 0/1 (imaging possible) · sart 0 / 1 the target crossed the beam since the sample before (the first sample from
 * the window's start, the last to its end) while the SAR couldn't image / 2 while it could; its stat counts the 2s.
 * Returns the previous result unchanged if nothing relevant changed.
 */
export function computeTimeline(state, scVersion, prev, N = 360) {
  const E = orbitElements(state.orbit); const T = ENV.propagate(E, 0, false).period; const W0 = pageAt(state.orbit, T); // the page the time slider shows (#100)
  const key = timelineKey(state, scVersion, W0);
  if (prev && key === prev.key) return prev;
  const tl = { key, W0, T, rows: timelineRows(state), N };
  tl.rows.forEach(r => r.v = new Array(N));
  const css = state.sc.comps.filter(c => c.type === 'css');
  // the target crossing the beam between two samples: the target of the settings in force at either end (at a schedule
  // change they can differ), its azimuth changing sign in front of the panel, refined (sim/sar.js beamCrossing)
  const crossed = (c, A0, t0, A1, t1) => {
    const ts = [targetECEF(A1.g)], t0E = targetECEF(A0.g); if (t0E.some((x, i) => x !== ts[0][i])) ts.push(t0E);
    return ts.some(tE => { const a0 = targetInAntenna(c, A0, ENV.ecef2eci(tE, A0.date)), a1 = targetInAntenna(c, A1, ENV.ecef2eci(tE, A1.date));
      return a0.front && a1.front && Math.sign(a0.az) !== Math.sign(a1.az) && beamCrossing(state, c, t0, t1, tE) !== null; });
  };
  const sart = tl.rows.filter(r => r.kind === 'sart');
  let prevT = W0, prevA = sart.length ? attitudeAt(state, W0, E) : null;
  for (let n = 0; n < N; n++) {
    const tn = W0 + (n + .5) / N * T, A = attitudeAt(state, tn, E);
    for (const r of tl.rows) {
      if (r.kind === 'mode') { r.v[n] = MODES.indexOf(A.g.mode) + (A.seg && A.seg.slew !== null ? 10 : 0); (r.names = r.names || [])[n] = A.seg ? A.g.name || '' : ''; }
      else if (r.kind === 'ecl') r.v[n] = A.ecl ? 1 : 0;
      else if (r.kind === 'str') { const s = sensorEval(r.c, A); r.v[n] = s.sunBlind ? 2 : s.earthBlind ? 3 : s.moonBlind ? 4 : 0; }
      else if (r.kind === 'css') r.v[n] = css.some(c => sensorEval(c, A).sees) ? 1 : 0;
      else if (r.kind === 'sa') r.v[n] = r.cs.reduce((s, c) => s + sensorEval(c, A).cosInc * c.w * c.h, 0) / r.cs.reduce((s, c) => s + c.w * c.h, 0);
      else if (r.kind === 'pl') { const c = payloadComp(state, A.g); r.v[n] = c && sensorEval(c, A).onGround ? 1 : 0; }
      else if (r.kind === 'sar') r.v[n] = sarImaging(r.c, sarSwath(r.c, A)) ? 1 : 0;
      else if (r.kind === 'sart') r.v[n] = crossed(r.c, prevA, prevT, A, tn) ? (sarImaging(r.c, sarSwath(r.c, A)) ? 2 : 1) : 0;
    }
    prevT = tn; prevA = A;
  }
  // the last sample also covers the rest of the window
  if (sart.length) { const tEnd = W0 + T, A = attitudeAt(state, tEnd, E); for (const r of sart) if (!r.v[N - 1] && crossed(r.c, prevA, prevT, A, tEnd)) r.v[N - 1] = sarImaging(r.c, sarSwath(r.c, A)) ? 2 : 1; }
  // percentage per row: STR = % tracking, SA = mean power fraction, others = % of samples "on"; the mode band has none
  tl.stats = tl.rows.map(r => r.kind === 'mode' ? null : r.kind === 'sart' ? r.v.filter(x => x === 2).length + '×' : r.kind === 'str' ? (100 * r.v.filter(x => x === 0).length / N) : r.kind === 'sa' ? (100 * r.v.reduce((s, x) => s + x, 0) / N) : (100 * r.v.filter(x => x).length / N));
  return tl;
}
