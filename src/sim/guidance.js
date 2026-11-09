/**
 * Attitude guidance: where the body frame points at time t for the selected mode.
 * Pure function of the app state — used by the 3D view, the HUD and the timeline.
 *
 * Modes (state.orbit.mode):
 *   offsets  — nominal attitude (state.sc.align: SCF vs VVLH / LVLH / VNC, see spacecraft/alignment.js)
 *              with 3-2-1 yaw/pitch/roll offsets on top. Zero offsets = nominal attitude.
 *   sun      — two-vector (TRIAD): chosen body axis on the Sun, secondary toward nadir/normal/...
 *   inertial — fixed in ECI using the Rotation Lab attitude (state.rot.q)
 *   target   — payload boresight tracks a ground point, +X kept toward velocity; below the horizon it holds the
 *              nominal attitude, slewing to the target before it rises and back after it sets (targetAttitude)
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
/** Settings a schedule change keeps, its pointing payload (tgtComp) included. The shown frame stays scenario-wide. */
export const SEGMENT_KEYS = ['mode', 'roll', 'pitch', 'yaw', 'sunAxis', 'sunSec', 'sunSecAxis', 'tgtLat', 'tgtLon', 'tgtAlt', 'tgtComp', 'tgtSlew'];

/** Body axis from a spec: '+X', '-Z', or 'comp:<id>' (that component's +Z; `missing` if the part is not on this spacecraft). */
export function axisSpec(spec, comps, missing = [0, 0, 1]) {
  if (!spec) return [0, 0, 1];
  if (spec.startsWith('comp:')) { const c = comps.find(c => 'comp:' + c.id === spec); return c ? compAxis(c) : missing; }
  const s = spec[0] === '-' ? -1 : 1, k = 'XYZ'.indexOf(spec[1]); const a = [0, 0, 0]; a[k] = s; return a;
}

/**
 * The pointing payload of guidance settings g (state.orbit, or a schedule change; A.g for what flies at A):
 * the part it selects, else the first payload camera.
 */
export function payloadComp(state, g = state.orbit) {
  return state.sc.comps.find(c => c.id === g.tgtComp) || state.sc.comps.find(c => c.type === 'payload') || null;
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
function modeAttitude(state, g, x, win = null) {
  const o = state.orbit;
  if (g.mode === 'sun') {
    // a part that is gone falls back as the spacecraft's defaults do (spacecraft/library.js AXES): −Z on the Sun, +X secondary
    const b1 = axisSpec(g.sunAxis, state.sc.comps, [0, 0, -1]); let b2 = axisSpec(g.sunSecAxis || '+X', state.sc.comps, [1, 0, 0]);
    if (AM.v.norm(AM.v.cross(b1, b2)) < 1e-3) b2 = Math.abs(b1[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
    return { CBI: AM.triad(b1, b2, x.sun, x.refVec(g.sunSec)), flag: null };
  }
  if (g.mode === 'inertial') return { CBI: AM.q2C(AM.q.unit(g !== o && g.q ? g.q : state.rot.q)), flag: null };
  if (g.mode === 'target') return targetAttitude(state, g, x, win);
  return { CBI: AM.m.mul(AM.euler2C('321', [(g.yaw || 0) * D2R, (g.pitch || 0) * D2R, (g.roll || 0) * D2R]), x.CNI), flag: null }; // offsets
}

/** Default of the slew to and from a ground target (s), for settings saved without one. */
export const TARGET_SLEW = 60;
/** Longest slew to and from a ground target (s): the rise/set search grows with it, and a quarter of an hour is plenty in LEO. */
export const TARGET_SLEW_MAX = 900;

/**
 * Target tracking for settings g at geometry x. The boresight tracks the target while it is above the horizon;
 * below it the spacecraft holds the nominal attitude. Instead of jumping at the rise, it slews to the target over
 * g.tgtSlew seconds before the rise (so tracking starts as it rises), and back to the nominal attitude over the same
 * time after the set. Both attitudes are evaluated at t, as for schedule slews; which way it turns is fixed at the
 * rise or set. Needs x.at (geometry at other times) to find them; without it, it jumps.
 */
function targetAttitude(state, g, x, win = null) {
  const pc = payloadComp(state, g), b1 = pc ? compAxis(pc) : [0, 0, 1];
  let b2 = [1, 0, 0]; if (AM.v.norm(AM.v.cross(b1, b2)) < 1e-3) b2 = [0, 1, 0];
  const tECEF = targetECEF(g);
  const see = y => { const tI = ENV.ecef2eci(tECEF, y.date), los = AM.v.sub(tI, y.st.r); return { los, elev: Math.PI / 2 - AM.v.angle(tI, AM.v.scale(los, -1)) }; };
  const track = (y, s = see(y)) => AM.triad(b1, b2, s.los, y.st.v); // works below the horizon too (looks through the Earth)
  const now = see(x);
  if (now.elev > 0) return { CBI: track(x, now), flag: { elev: now.elev } };
  const D = Math.min(TARGET_SLEW_MAX, Math.max(0, Number.isFinite(+g.tgtSlew) ? +g.tgtSlew : TARGET_SLEW)) * 1000, ms = x.date.getTime();
  const hold = { CBI: x.CNI, flag: { elev: now.elev, below: true } }; // hold the nominal attitude
  if (!D || !x.at || !mayRiseWithin(x, tECEF, D / 1000)) return hold;
  // only rises and sets while these settings fly count: win = [start, end) of the change (or of the initial settings)
  const reach = dir => Math.max(0, Math.min(D, win ? (dir > 0 ? win[1] - ms : ms - win[0]) : D));
  const el = s => see(x.at(ms + s)).elev; // elevation at offset s (ms, signed)
  /** Somewhere in (a, b) (offsets on one side) where the target is up, by golden-section search for the highest elevation; null if it stays below. */
  const peak = (a, b) => {
    const r = (Math.sqrt(5) - 1) / 2; let c = b - r * (b - a), d = a + r * (b - a), ec = el(c), ed = el(d);
    for (let k = 0; k < 40 && Math.abs(b - a) > 1; k++) {
      if (ec > 0) return c; if (ed > 0) return d;
      if (ec > ed) { b = d; d = c; ed = ec; c = b - r * (b - a); ec = el(c); } else { a = c; c = d; ec = ed; d = a + r * (b - a); ed = el(d); }
    }
    return ec > 0 ? c : ed > 0 ? d : null;
  };
  /** The nearest rise (dir +1) or set (dir -1) within reach: the boundary, to 1 ms, between a sample with the target down and the first time it is up. */
  const edge = dir => {
    const end = reach(dir); if (!end) return null;
    const step = Math.min(10e3, D / 4), off = s => dir * s;
    // a pass may be shorter than the step: sample, and refine any peak of elevation between samples
    let s0 = 0, e0 = now.elev, s1 = Math.min(step, end), e1 = el(off(s1)), upAt = null, below = 0;
    if (e1 > 0) { upAt = s1; below = 0; }
    else if (e1 <= e0) { const p = peak(off(0), off(s1)); if (p !== null) { upAt = Math.abs(p); below = 0; } }
    while (upAt === null && s1 < end) {
      const s2 = Math.min(end, s1 + step), e2 = el(off(s2));
      if (e2 > 0) { upAt = s2; below = s1; break; }
      if (e1 > e0 && e1 >= e2) { const p = peak(off(s0), off(s2)); if (p !== null) { upAt = Math.abs(p); below = s0; break; } }
      s0 = s1; e0 = e1; s1 = s2; e1 = e2;
    }
    if (upAt === null && e1 > e0) { const p = peak(off(s0), off(s1)); if (p !== null) { upAt = Math.abs(p); below = s0; } } // rising into the end
    if (upAt === null) return null;
    let lo = below, hi = upAt; for (let k = 0; k < 40 && hi - lo > 1; k++) { const m = (lo + hi) / 2; if (el(off(m)) > 0) hi = m; else lo = m; }
    return ms + dir * hi;
  };
  const rise = edge(1), set = edge(-1);
  const wRise = rise === null ? 0 : 1 - (rise - ms) / D, wSet = set === null ? 0 : 1 - (ms - set) / D;
  const w = Math.min(1, Math.max(wRise, wSet)); if (w <= 0) return hold;
  const te = wRise >= wSet ? rise : set, ye = x.at(te), ref = relativeQ(ye.CNI, track(ye));
  return { CBI: blendAttitude(x.CNI, track(x, now), w, ref), flag: { elev: now.elev, below: true, slew: { w, rising: wRise >= wSet, dt: Math.abs(te - ms) / 1000 } } };
}

/**
 * False when the target at tECEF cannot come above the horizon within dt seconds (before or after x): its angle
 * from the spacecraft, seen from the Earth's centre, is more than the widest horizon of this orbit (at apogee)
 * plus the most the ground point can move in dt (fastest at perigee, plus the Earth's rotation). Saves the search.
 */
function mayRiseWithin(x, tECEF, dt) {
  const r = x.st.r, v = x.st.v, rn = AM.v.norm(r), h = AM.v.norm(AM.v.cross(r, v));
  const a = 1 / (2 / rn - AM.v.dot(v, v) / ENV.MU), e = Math.sqrt(Math.max(0, 1 - h * h / (ENV.MU * a)));
  if (!(a > 0) || e >= 1) return true; // not a closed orbit: always search
  const rp = a * (1 - e), ra = a * (1 + e), tn = AM.v.norm(tECEF);
  const theta = AM.v.angle(ENV.ecef2eci(tECEF, x.date), r), horizon = Math.acos(Math.min(1, tn / ra)) + Math.acos(Math.min(1, ENV.RE / tn));
  return theta - horizon <= (h / (rp * rp) + ENV.WE) * dt * 1.05 + 1e-3; // a margin for J2 drift of the osculating orbit
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
  const o = state.orbit, now = epochDate(o).getTime() + t * 1000, sc = scheduler(state, E), x = sc.at(now);
  let p = -1; for (let j = 0; j < sc.order.length; j++) if (sc.order[j].ms <= now) p = j;
  const r = sc.att(p, now), g = p < 0 ? o : o.schedule[sc.order[p].i];
  const seg = p < 0 ? null : { i: sc.order[p].i, id: g.id, slew: r.slew ?? null };
  const { date, st, sun, CNI } = x;
  const CVI = ENV.vvlh(st.r, st.v), CRI = ENV.orbitFrame(o.refFrame, st.r, st.v);
  const ecl = ENV.eclipse(st.r, sun);
  const moon = AM.v.unit(AM.v.sub(ENV.moonECI(date), st.r)), moonUp = !ENV.behindEarth(st.r, moon);
  return { t, date, st, sun, moon, moonUp, CRI, CVI, CNI, CBI: r.CBI, ecl, flag: r.flag, g, seg };
}

/**
 * The position in scheduleOrder of what flies before change j: the last change with an earlier start (changes
 * at the same moment as j never fly before it), or -1, the initial settings.
 */
export function flownBefore(order, j) { let k = j - 1; while (k >= 0 && order[k].ms === order[j].ms) k--; return k; }

/**
 * The schedule worked out for one call: order (scheduleOrder), at(ms) the geometry at UTC ms, and att(j, ms) the
 * attitude of change j (-1: the initial settings) at ms; a change still slewing blends from what flew before it.
 * Both are cached, so a chain of overlapping slews costs one evaluation per change and time.
 */
function scheduler(state, E) {
  const o = state.orbit, sched = o.schedule, order = scheduleOrder(sched);
  const geo = new Map(), at = ms => { if (!geo.has(ms)) { const y = geometry(state, E, ms); y.at = at; geo.set(ms, y); } return geo.get(ms); }; // .at: target tracking looks around in time
  // when change j (-1: the initial settings) flies, before slews: from its start to the next later start
  const window = j => { const t0 = j < 0 ? -Infinity : order[j].ms; let k = j + 1; while (k < order.length && order[k].ms <= t0) k++; return [t0, k < order.length ? order[k].ms : Infinity]; };
  const own = (j, ms) => modeAttitude(state, j < 0 ? o : sched[order[j].i], at(ms), window(j));
  const memo = new Map();
  const att = (j, ms) => {
    const key = j + '|' + ms; if (memo.has(key)) return memo.get(key);
    const r = attOf(j, ms); memo.set(key, r); return r;
  };
  const attOf = (j, ms) => {
    const a = own(j, ms); if (j < 0) return a;
    const g = sched[order[j].i], t0 = order[j].ms, dur = Math.max(0, +g.slew || 0) * 1000, f = dur ? (ms - t0) / dur : 1;
    if (f >= 1) return a; // ends exactly on the new attitude
    const k = flownBefore(order, j), from = att(k, ms).CBI;
    if (ms === t0) return { CBI: from, flag: a.flag, slew: 0 };
    const ref = relativeQ(att(k, t0).CBI, own(j, t0).CBI); // which way it turns: fixed at the start
    return { CBI: blendAttitude(from, a.CBI, f, ref), flag: a.flag, slew: f };
  };
  return { order, at, own, att };
}

/**
 * The turn change `id` asks for at its start: angle (deg) from the attitude flown before it to its own, and the
 * mean rate over its slew (deg/s; null for a jump). Both ends may move during the slew, so this is the turn at
 * the start, not a limit. { overridden: true } for a change that never flies (a later one in the list starts at
 * the same moment); null for an unknown change.
 */
export function changeTurn(state, id, E = orbitElements(state.orbit)) {
  const o = state.orbit, sc = scheduler(state, E), j = sc.order.findIndex(x => o.schedule[x.i].id === id);
  if (j < 0) return null;
  if (j + 1 < sc.order.length && sc.order[j + 1].ms === sc.order[j].ms) return { overridden: true };
  const t0 = sc.order[j].ms, q = relativeQ(sc.att(flownBefore(sc.order, j), t0).CBI, sc.own(j, t0).CBI);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w))) / D2R, slew = Math.max(0, +o.schedule[sc.order[j].i].slew || 0);
  return { angle, rate: slew ? angle / slew : null };
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
