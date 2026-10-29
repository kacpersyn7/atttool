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
 * To add a mode: add a branch in `attitudeAt`, an option + controls in views/orbit/orbitPanel.js.
 */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { compAxis } from '../spacecraft/component.js';
import { alignMatrix, defaultAlign } from '../spacecraft/alignment.js';
import { epochDate, orbitElements } from './scenario.js';

const D2R = AM.D2R;

/** Body axis from a spec: '+X', '-Z', or 'comp:<id>' (that component's +Z). */
export function axisSpec(spec, comps) {
  if (!spec) return [0, 0, 1];
  if (spec.startsWith('comp:')) { const c = comps.find(c => 'comp:' + c.id === spec); return c ? compAxis(c) : [0, 0, 1]; }
  const s = spec[0] === '-' ? -1 : 1, k = 'XYZ'.indexOf(spec[1]); const a = [0, 0, 0]; a[k] = s; return a;
}

/** The pointing payload: the selected target component, else the first payload camera. */
export function payloadComp(state) {
  return state.sc.comps.find(c => c.id === state.orbit.tgtComp) || state.sc.comps.find(c => c.type === 'payload') || null;
}

/**
 * Full geometric state at t seconds after epoch.
 * @returns {{t, date, st, sun, CRI, CVI, CNI, CBI, ecl, flag}} st = propagated orbit state (ECI km, km/s),
 *   CRI = C_ref←ECI for the displayed orbital frame (o.refFrame), CVI = C_VVLH←ECI,
 *   CNI = nominal attitude C_SCF←ECI, CBI = C_Body←ECI, ecl = in eclipse, flag = mode-specific info (target elevation).
 */
export function attitudeAt(state, t, E = orbitElements(state.orbit)) {
  const o = state.orbit;
  const date = new Date(epochDate(o).getTime() + t * 1000);
  const st = ENV.propagate(E, t, o.j2);
  const sun = ENV.sunECI(date);
  const CVI = ENV.vvlh(st.r, st.v);
  const CRI = ENV.orbitFrame(o.refFrame, st.r, st.v);
  const al = state.sc.align || defaultAlign();
  const CNI = AM.m.mul(alignMatrix(al), ENV.orbitFrame(al.ref, st.r, st.v));
  let CBI, flag = null;
  const nadirI = AM.v.unit(AM.v.scale(st.r, -1)), hI = AM.v.unit(AM.v.cross(st.r, st.v));
  const refVec = k => k === 'nadir' ? nadirI : k === 'normal' ? hI : k === 'antinormal' ? AM.v.scale(hI, -1) : k === 'velocity' ? AM.v.unit(st.v) : k === 'zenith' ? AM.v.scale(nadirI, -1) : nadirI;
  if (o.mode === 'offsets') CBI = AM.m.mul(AM.euler2C('321', [o.yaw * D2R, o.pitch * D2R, o.roll * D2R]), CNI);
  else if (o.mode === 'sun') {
    const b1 = axisSpec(o.sunAxis, state.sc.comps); let b2 = axisSpec(o.sunSecAxis || '+X', state.sc.comps);
    if (AM.v.norm(AM.v.cross(b1, b2)) < 1e-3) b2 = Math.abs(b1[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
    CBI = AM.triad(b1, b2, sun, refVec(o.sunSec));
  }
  else if (o.mode === 'inertial') CBI = AM.q2C(AM.q.unit(state.rot.q));
  else if (o.mode === 'target') {
    const tE = ENV.llh2ecef(o.tgtLat * D2R, o.tgtLon * D2R); const tI = ENV.ecef2eci(tE, date); const los = AM.v.sub(tI, st.r);
    const elev = Math.PI / 2 - AM.v.angle(tI, AM.v.scale(los, -1));
    const pc = payloadComp(state); const b1 = pc ? compAxis(pc) : [0, 0, 1];
    if (elev > 0) { let b2 = [1, 0, 0]; if (AM.v.norm(AM.v.cross(b1, b2)) < 1e-3) b2 = [0, 1, 0]; CBI = AM.triad(b1, b2, los, st.v); flag = { elev }; }
    else { CBI = CNI; flag = { elev, below: true }; } // hold the nominal attitude
  }
  const ecl = ENV.eclipse(st.r, sun);
  return { t, date, st, sun, CRI, CVI, CNI, CBI, ecl, flag };
}

/** Body angular rate (rad/s, body axes) by finite difference over 1 s. */
export function bodyRate(state, t) {
  const a = attitudeAt(state, t).CBI, b = attitudeAt(state, t + 1).CBI; const d = AM.m.mul(b, AM.m.T(a));
  return [(d[1][2] - d[2][1]) / 2, (d[2][0] - d[0][2]) / 2, (d[0][1] - d[1][0]) / 2];
}
