/**
 * Application state: one plain JSON-serialisable object `S`, persisted to localStorage.
 *
 *   S.tab     current workspace ('rot' | 'orbit' | 'layout')
 *   S.rot     Rotation Lab settings (quaternion, Euler sequence, display toggles)
 *   S.orbit   orbit, time, guidance mode and display toggles
 *   S.layout  Spacecraft Layout UI settings (selection, gizmo, display)
 *   S.sc      the spacecraft: { bus, comps[] } — shared by all workspaces
 *
 * Mutate S in place, then call save() (UI settings) or scChanged() (spacecraft geometry —
 * bumps scVersion() so 3D models rebuild). Bump STORAGE_KEY if you make an incompatible change.
 */
import * as AM from '../core/attitude.js';
import { defaultSC } from '../spacecraft/exampleSpacecraft.js';
import { EPOCH0 } from '../sim/scenario.js';

export const STORAGE_KEY = 'atttool.v1';
const D2R = AM.D2R;

export function defaultState() {
  return {
    tab: 'rot',
    rot: { seq: '321', euler: [30, 20, 10], q: AM.C2q(AM.euler2C('321', [30 * D2R, 20 * D2R, 10 * D2R])), scalarFirst: true, dcmView: 'BR', probe: [1, 1, 0], showProbe: true, showGhosts: true, showTrails: true, showSC: true, nudge: 15 },
    orbit: {
      preset: 'sso1030', epoch: EPOCH0, hp: 550, ha: 550, i: 97.59, raan: 0, argp: 0, nu0: 0, j2: true, t: 0, playing: true, speed: 60,
      mode: 'lvlh', roll: 0, pitch: 0, yaw: 0, sunAxis: '-Z', sunSec: 'nadir', tgtLat: 52.23, tgtLon: 21.01, tgtComp: '',
      show: { eci: true, lvlh: true, track: true, sunv: true, bv: true, cones: true, follow: false }, scale: 1.0,
    },
    layout: { sel: null, gizmo: 'translate', show: { cones: true, excl: false, labels: true, bus: 0.55, principal: false, com: true } },
    sc: defaultSC(),
  };
}

/** Load from storage and fill any missing keys from defaults (forward-compatible). */
function load() {
  let s;
  try { const raw = localStorage.getItem(STORAGE_KEY); s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
  if (!s || !s.sc || !s.rot || !s.orbit) s = defaultState();
  const d = defaultState();
  for (const k of ['rot', 'orbit', 'layout']) s[k] = Object.assign({}, d[k], s[k]);
  s.orbit.show = Object.assign({}, d.orbit.show, s.orbit.show);
  s.layout.show = Object.assign({}, d.layout.show, s.layout.show);
  return s;
}

/** The single app state object. Never reassigned — mutate its properties. */
export const S = load();

let saveT = 0;
/** Debounced persist to localStorage. */
export function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }, 300); }

let _scVersion = 1;
/** Increments whenever spacecraft geometry changes; views compare it to rebuild their models. */
export const scVersion = () => _scVersion;
export function scChanged() { _scVersion++; save(); }
