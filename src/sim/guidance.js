/**
 * Attitude guidance: where the body frame points at time t for the selected mode.
 * Pure function of the app state — used by the 3D view, the HUD and the timeline.
 *
 * Modes (state.orbit.mode):
 *   offsets  — nominal attitude (state.sc.align: SCF vs VVLH / LVLH / VNC, see spacecraft/alignment.js)
 *              with 3-2-1 yaw/pitch/roll offsets on top. Zero offsets = nominal attitude.
 *   sun      — two-vector (TRIAD): chosen body axis on the Sun, secondary toward nadir/normal/...
 *   inertial — fixed in ECI using the Rotation Lab attitude (state.rot.q)
 *   target   — payload boresight tracks a ground point, +X kept toward velocity
 *
 * Mode schedule (state.orbit.schedule): a list of changes { id, start (UTC, epoch format), slew (s), mode,
 * and that mode's settings (SEGMENT_KEYS; an inertial change keeps its own attitude q) }. The settings in
 * state.orbit fly before the first change. A change slews from the attitude before it to its own over `slew`
 * seconds: both attitudes are evaluated at t and blended by slerp, linear in time. Kinematics only.
 *
 * To add a mode: add a branch in `modeAttitude`, an option + controls in views/orbit/orbitPanel.js.
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { compAxis } from '../spacecraft/component.js';
import { alignMatrix, defaultAlign } from '../spacecraft/alignment.js';
import { epochDate, orbitElements, parseEpoch, targetECEF } from './scenario.js';

const D2R = AM.D2R;

/** Guidance modes, in the order the UI lists them. */
export const MODES = ['offsets', 'target', 'sun', 'inertial'];
/** Settings a schedule change keeps. The payload part (tgtComp) and the shown frame stay scenario-wide. */
export const SEGMENT_KEYS = ['mode', 'roll', 'pitch', 'yaw', 'sunAxis', 'sunSec', 'sunSecAxis', 'tgtLat', 'tgtLon', 'tgtAlt'];

/** Body axis from a spec: '+X', '-Z', or 'comp:<id>' (that component's +Z; `missing` if the part is not on this spacecraft). */
export function axisSpec(spec, comps, missing = [0, 0, 1]) {
  if (!spec) return [0, 0, 1];
  if (spec.startsWith('comp:')) { const c = comps.find(c => 'comp:' + c.id === spec); return c ? compAxis(c) : missing; }
  const s = spec[0] === '-' ? -1 : 1, k = 'XYZ'.indexOf(spec[1]); const a = [0, 0, 0]; a[k] = s; return a;
}

/** The pointing payload: the selected target component, else the first payload camera. */
export function payloadComp(state) {
  return state.sc.comps.find(c => c.id === state.orbit.tgtComp) || state.sc.comps.find(c => c.type === 'payload') || null;
}

/**
 * The schedule's changes in time order: [{ i (index in the list), ms (UTC) }]. Changes with an unreadable
 * start are left out. Equal starts: the later in the list comes later, so it wins.
 */
export function scheduleOrder(sched) {
  if (!Array.isArray(sched)) return [];
  const out = []; sched.forEach((s, i) => { const d = s && parseEpoch(s.start); if (d) out.push({ i, ms: d.getTime() }); });
  return out.sort((a, b) => a.ms - b.ms || a.i - b.i);
}

/** Attitude C_Body←ECI and mode info for guidance settings g (state.orbit or a schedule change) in geometry ctx. */
function modeAttitude(state, g, x) {
  const o = state.orbit;
  if (g.mode === 'sun') {
    // a part that is gone falls back as the spacecraft's defaults do (spacecraft/library.js AXES): −Z on the Sun, +X secondary
    const b1 = axisSpec(g.sunAxis, state.sc.comps, [0, 0, -1]); let b2 = axisSpec(g.sunSecAxis || '+X', state.sc.comps, [1, 0, 0]);
    if (AM.v.norm(AM.v.cross(b1, b2)) < 1e-3) b2 = Math.abs(b1[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
    return { CBI: AM.triad(b1, b2, x.sun, x.refVec(g.sunSec)), flag: null };
  }
  if (g.mode === 'inertial') return { CBI: AM.q2C(AM.q.unit(g !== o && g.q ? g.q : state.rot.q)), flag: null };
  if (g.mode === 'target') {
    const tI = ENV.ecef2eci(targetECEF(g), x.date); const los = AM.v.sub(tI, x.st.r);
    const elev = Math.PI / 2 - AM.v.angle(tI, AM.v.scale(los, -1));
    const pc = payloadComp(state); const b1 = pc ? compAxis(pc) : [0, 0, 1];
    if (elev > 0) { let b2 = [1, 0, 0]; if (AM.v.norm(AM.v.cross(b1, b2)) < 1e-3) b2 = [0, 1, 0]; return { CBI: AM.triad(b1, b2, los, x.st.v), flag: { elev } }; }
    return { CBI: x.CNI, flag: { elev, below: true } }; // hold the nominal attitude
  }
  return { CBI: AM.m.mul(AM.euler2C('321', [(g.yaw || 0) * D2R, (g.pitch || 0) * D2R, (g.roll || 0) * D2R]), x.CNI), flag: null }; // offsets
}

/** Quaternion of a rotation matrix with a fixed sign: w > 0, or for a half turn (w ≈ 0) its largest vector component > 0. */
function signedQ(R) {
  const q = AM.C2q(R), w = Math.abs(q.w) > 1e-9 ? q.w : [q.x, q.y, q.z].reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0);
  return w < 0 ? AM.q.neg(q) : q;
}
/** The rotation from attitude Ca to Cb (C_b←a = Cb·Caᵀ) as a quaternion, on the side of `ref` (default: the short way). */
export function relativeQ(Ca, Cb, ref = null) {
  const q = signedQ(AM.m.mul(Cb, AM.m.T(Ca)));
  if (!ref) return q;
  return q.w * ref.w + q.x * ref.x + q.y * ref.y + q.z * ref.z < 0 ? AM.q.neg(q) : q;
}
/**
 * Attitude blended from Ca (f = 0) to Cb (f = 1), turning about one axis at a constant rate in f. `ref` (from
 * relativeQ at the start of the slew) fixes which way it turns, so a half turn doesn't flip side from one moment to the next.
 */
export function blendAttitude(Ca, Cb, f, ref = null) {
  const q = relativeQ(Ca, Cb, ref);
  return AM.m.mul(AM.q2C(AM.q.slerp(AM.q.id(), q, f)), Ca);
}

/**
 * Full geometric state at t seconds after epoch.
 * @returns {{t, date, st, sun, moon, moonUp, CRI, CVI, CNI, CBI, ecl, flag, g, seg}} st = propagated orbit state (ECI km, km/s),
 *   sun = unit Sun vector (ECI), moon = unit vector from the spacecraft to the Moon (ECI, includes parallax),
 *   moonUp = the Moon is not hidden behind the Earth,
 *   CRI = C_ref←ECI for the displayed orbital frame (o.refFrame), CVI = C_VVLH←ECI,
 *   CNI = nominal attitude C_SCF←ECI, CBI = C_Body←ECI, ecl = in eclipse, flag = mode-specific info (target elevation),
 *   g = the guidance settings in force (state.orbit, or the schedule change), seg = null before the first change,
 *   else { i (index in the schedule), id, slew (0..1 while slewing into it, else null) }.
 */
export function attitudeAt(state, t, E = orbitElements(state.orbit)) {
  const o = state.orbit, e0 = epochDate(o).getTime(), now = e0 + t * 1000;
  const x = geometry(state, E, now);
  const sched = o.schedule, order = scheduleOrder(sched);
  let p = -1; for (let j = 0; j < order.length; j++) if (order[j].ms <= now) p = j;
  const geo = new Map([[now, x]]), at = ms => { if (!geo.has(ms)) geo.set(ms, geometry(state, E, ms)); return geo.get(ms); };
  // attitude of change j (-1: the initial settings) at UTC ms; a change still slewing blends from the one before
  const att = (j, ms) => {
    const g = j < 0 ? o : sched[order[j].i], a = modeAttitude(state, g, at(ms));
    if (j < 0) return a;
    const t0 = order[j].ms, dur = Math.max(0, +g.slew || 0) * 1000, f = dur ? (ms - t0) / dur : 1;
    if (f >= 1) return a; // ends exactly on the new attitude
    const from = att(j - 1, ms).CBI;
    if (ms === t0) return { CBI: from, flag: a.flag, slew: 0 };
    const ref = relativeQ(att(j - 1, t0).CBI, modeAttitude(state, g, at(t0)).CBI); // which way it turns: fixed at the start
    return { CBI: blendAttitude(from, a.CBI, f, ref), flag: a.flag, slew: f };
  };
  const r = att(p, now), g = p < 0 ? o : sched[order[p].i];
  const seg = p < 0 ? null : { i: order[p].i, id: g.id, slew: r.slew ?? null };
  const { date, st, sun, CNI } = x;
  const CVI = ENV.vvlh(st.r, st.v), CRI = ENV.orbitFrame(o.refFrame, st.r, st.v);
  const ecl = ENV.eclipse(st.r, sun);
  const moon = AM.v.unit(AM.v.sub(ENV.moonECI(date), st.r)), moonUp = !ENV.behindEarth(st.r, moon);
  return { t, date, st, sun, moon, moonUp, CRI, CVI, CNI, CBI: r.CBI, ecl, flag: r.flag, g, seg };
}

/** What the guidance modes need at UTC ms: date, orbit state, Sun, nominal attitude, reference directions. */
function geometry(state, E, ms) {
  const o = state.orbit, date = new Date(ms), st = ENV.propagate(E, (ms - epochDate(o).getTime()) / 1000, o.j2);
  const sun = ENV.sunECI(date), al = state.sc.align || defaultAlign();
  const CNI = AM.m.mul(alignMatrix(al), ENV.orbitFrame(al.ref, st.r, st.v));
  const nadirI = AM.v.unit(AM.v.scale(st.r, -1)), hI = AM.v.unit(AM.v.cross(st.r, st.v));
  const refVec = k => k === 'nadir' ? nadirI : k === 'normal' ? hI : k === 'antinormal' ? AM.v.scale(hI, -1) : k === 'velocity' ? AM.v.unit(st.v) : k === 'zenith' ? AM.v.scale(nadirI, -1) : nadirI;
  return { date, st, sun, CNI, refVec };
}

/** Body angular rate (rad/s, body axes) by finite difference over 1 s. */
export function bodyRate(state, t) {
  const a = attitudeAt(state, t).CBI, b = attitudeAt(state, t + 1).CBI; const d = AM.m.mul(b, AM.m.T(a));
  return [(d[1][2] - d[2][1]) / 2, (d[2][0] - d[0][2]) / 2, (d[0][1] - d[1][0]) / 2];
}
