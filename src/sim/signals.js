/**
 * Time-series signals for the plot strip: what can be plotted, sampling over a time window,
 * quaternion sign continuity and CSV export. Pure computation; drawing lives in
 * views/orbit/plotView.js.
 *
 * A signal: { id, label, unit, comps: [component names], kind: 'quat' | 'angle' | 'value', range? }
 *   - quat  : 4 components [q0 q1 q2 q3] (scalar first, Shuster reading, same as the HUD),
 *             kept sign-continuous along the series (q and −q are the same attitude)
 *   - angle : degrees wrapped to (−180°, 180°]; the plot breaks the line at a wrap
 *   - value : anything else
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { compAxis } from '../spacecraft/component.js';
import { orbitElements } from './scenario.js';
import { attitudeAt } from './guidance.js';
import { sensorEval } from './sensors.js';

const R2D = AM.R2D;
const qArr = C => { const q = AM.C2q(C); return [q.w, q.x, q.y, q.z]; };
const eul = C => { const e = AM.C2euler('321', C).map(x => x * R2D); return [e[2], e[1], e[0]]; }; // φ θ ψ
const refName = state => (state.orbit.refFrame || 'vvlh').toUpperCase();

/** Body rate (deg/s, body axes) from two attitudes dt seconds apart. */
export function rateFrom(C0, C1, dt) {
  const d = AM.m.mul(C1, AM.m.T(C0));
  return [(d[1][2] - d[2][1]) / 2, (d[2][0] - d[0][2]) / 2, (d[0][1] - d[1][0]) / 2].map(x => x / dt * R2D);
}

/** Component types whose boresight angles to the Sun / Earth limb are offered as signals. */
const POINTED = ['str', 'css', 'payload', 'ant', 'sa'];
/** …and of those, the ones where the angle above the Earth limb matters. */
const LIMB = ['str', 'payload', 'ant'];

/** Every signal available for this state (part signals depend on the layout). */
export function signalCatalog(state) {
  const R = refName(state), Q = ['q₀', 'q₁', 'q₂', 'q₃'], QC = ['q0', 'q1', 'q2', 'q3'], EC = ['roll', 'pitch', 'yaw'], XYZ = ['x', 'y', 'z'], E = ['φ roll', 'θ pitch', 'ψ yaw'];
  const list = [
    { id: 'qBI', group: 'Attitude', label: 'q_BI (body vs ECI)', unit: '', comps: Q, cols: QC, kind: 'quat', range: [-1, 1], f: A => qArr(A.CBI) },
    { id: 'qBR', group: 'Attitude', label: `q (body vs ${R})`, unit: '', comps: Q, cols: QC, kind: 'quat', range: [-1, 1], f: A => qArr(AM.m.mul(A.CBI, AM.m.T(A.CRI))) },
    { id: 'qBN', group: 'Attitude', label: 'q (body vs nominal)', unit: '', comps: Q, cols: QC, kind: 'quat', range: [-1, 1], f: A => qArr(AM.m.mul(A.CBI, AM.m.T(A.CNI))) },
    { id: 'eulR', group: 'Attitude', label: `Euler 3-2-1 vs ${R}`, unit: '°', comps: E, cols: EC, kind: 'angle', range: [-180, 180], f: A => eul(AM.m.mul(A.CBI, AM.m.T(A.CRI))) },
    { id: 'eulN', group: 'Attitude', label: 'Euler 3-2-1 vs nominal', unit: '°', comps: E, cols: EC, kind: 'angle', range: [-180, 180], f: A => eul(AM.m.mul(A.CBI, AM.m.T(A.CNI))) },
    { id: 'rate', group: 'Attitude', label: 'Body rate ω_B', unit: '°/s', comps: XYZ, kind: 'value', needsNext: true, f: (A, A1) => rateFrom(A.CBI, A1.CBI, A1.t - A.t) },
    { id: 'sunB', group: 'Environment', label: 'Sun direction in body', unit: '', comps: XYZ, kind: 'value', range: [-1, 1], f: A => AM.m.mulv(A.CBI, A.sun) },
    { id: 'nadB', group: 'Environment', label: 'Nadir direction in body', unit: '', comps: XYZ, kind: 'value', range: [-1, 1], f: A => AM.m.mulv(A.CBI, AM.v.unit(AM.v.scale(A.st.r, -1))) },
    { id: 'bB', group: 'Environment', label: 'B-field in body', unit: 'nT', comps: XYZ, kind: 'value', f: A => AM.m.mulv(A.CBI, ENV.bfieldECI(A.st.r, A.date)) },
    { id: 'beta', group: 'Environment', label: 'β angle', unit: '°', comps: ['β'], cols: [''], kind: 'value', f: A => [ENV.betaAngle(A.st.r, A.st.v, A.sun) * R2D] },
    { id: 'alt', group: 'Environment', label: 'Altitude', unit: 'km', comps: ['h'], cols: [''], kind: 'value', f: A => [AM.v.norm(A.st.r) - ENV.RE] },
  ];
  for (const c of state.sc.comps.filter(c => POINTED.includes(c.type))) {
    list.push({ id: 'sun:' + c.id, group: 'Parts', label: `${c.name} · Sun angle`, unit: '°', comps: ['∠Sun'], cols: [''], csv: 'sunAngle_' + codeOf(c), kind: 'value', range: [0, 180], f: A => [sensorEval(c, A).sunAng] });
    if (LIMB.includes(c.type)) list.push({ id: 'limb:' + c.id, group: 'Parts', label: `${c.name} · above Earth limb`, unit: '°', comps: ['∠limb'], cols: [''], csv: 'limbAngle_' + codeOf(c), kind: 'value', f: A => [sensorEval(c, A).limb] });
  }
  return list;
}

/** Signal by id, or null if it no longer exists (e.g. its part was deleted). */
export function findSignal(state, id) { return signalCatalog(state).find(s => s.id === id) || null; }

/**
 * Plot window [t0, t1] (s after epoch).
 *   win.kind 'orbit' — the orbit containing t (same window as the availability timeline)
 *   win.kind 'last'  — the last win.min minutes up to t (starts at 0 if earlier)
 */
export function plotWindow(state, win = { kind: 'orbit' }) {
  const t = state.orbit.t;
  if (win.kind === 'last') { const span = Math.max(1, win.min || 30) * 60; const t0 = Math.max(0, t - span); return { t0, t1: t0 + span, label: `Last ${win.min || 30} min` }; }
  const T = ENV.propagate(orbitElements(state.orbit), 0, false).period, t0 = Math.floor(t / T) * T;
  return { t0, t1: t0 + T, label: `One orbit · ${(T / 60).toFixed(1)} min` };
}

/** Flip quaternion samples so consecutive ones have a non-negative dot product (first one: q0 ≥ 0). */
export function quatContinuity(qs) {
  let prev = null;
  return qs.map(q => {
    let s = 1;
    if (prev) { if (q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) s = -1; }
    else if (q[0] < 0) s = -1;
    const r = q.map(x => x * s); prev = r; return r;
  });
}

/**
 * Sample signals `ids` at N points from t0 to t1 inclusive (or with a fixed step: opts.step seconds).
 * Unknown ids are skipped. Returns { t: [s], series: [{ sig, v: [[comp values] per sample] }], ecl: [in eclipse per sample] }.
 */
export function sampleSignals(state, ids, t0, t1, opts = {}) {
  const sigs = ids.map(id => findSignal(state, id)).filter(Boolean);
  const E = orbitElements(state.orbit);
  const N = opts.step ? Math.floor((t1 - t0) / opts.step + 1e-9) + 1 : (opts.N || 300);
  const t = Array.from({ length: N }, (_, n) => opts.step ? t0 + n * opts.step : t0 + (N > 1 ? n / (N - 1) : 0) * (t1 - t0));
  const next = sigs.some(s => s.needsNext);
  const series = sigs.map(sig => ({ sig, v: new Array(N) })), ecl = new Array(N);
  for (let n = 0; n < N; n++) {
    const A = attitudeAt(state, t[n], E), A1 = next ? attitudeAt(state, t[n] + 0.5, E) : null;
    ecl[n] = A.ecl;
    for (const s of series) s.v[n] = s.sig.f(A, A1);
  }
  for (const s of series) if (s.sig.kind === 'quat') s.v = quatContinuity(s.v);
  return { t, series, ecl };
}

/** Values of signal `sig` at time t; quaternions take the sign closest to `near` (a sample). */
export function valueAt(state, sig, t, near) {
  const E = orbitElements(state.orbit);
  const A = attitudeAt(state, t, E), v = sig.f(A, sig.needsNext ? attitudeAt(state, t + 0.5, E) : null);
  if (sig.kind === 'quat' && near && v.reduce((s, x, k) => s + x * near[k], 0) < 0) return v.map(x => -x);
  return v;
}

const codeOf = c => c.name.replace(/\W+/g, '_');
const UNIT_ASCII = { '°': 'deg', '°/s': 'deg/s' };
/** CSV column name, e.g. "qBI_q1", "eulR_roll [deg]", "sunAngle_STR_1 [deg]". */
export function columnName(sig, k) {
  const c = (sig.cols || sig.comps)[k];
  return (sig.csv || sig.id) + (c ? '_' + c : '') + (sig.unit ? ` [${UNIT_ASCII[sig.unit] || sig.unit}]` : '');
}

/**
 * CSV text: t_s, UTC, then one column per component. comma=true writes decimal commas and
 * ';' separators (what Excel expects in e.g. Polish or German locales).
 */
export function signalsToCSV(samples, epochMs, { comma = false, dec = 6 } = {}) {
  const sep = comma ? ';' : ',', num = x => { const s = Number.isFinite(x) ? x.toFixed(dec).replace(/\.?0+$/, '') : ''; return comma ? s.replace('.', ',') : s; };
  const head = ['t [s]', 'UTC'];
  for (const s of samples.series) s.sig.comps.forEach((_, k) => head.push(columnName(s.sig, k)));
  const lines = [head.join(sep)];
  samples.t.forEach((t, n) => {
    const row = [num(t), new Date(epochMs + t * 1000).toISOString()];
    for (const s of samples.series) for (const x of s.v[n]) row.push(num(x));
    lines.push(row.join(sep));
  });
  return lines.join('\n') + '\n';
}
