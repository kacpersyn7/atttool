/**
 * Scenario library: named situations, one of them active.
 *
 * state.orbit stays THE active scenario for everything else, and also holds display settings that are not
 * part of a scenario (show, plot, speed, …). state.scenarios holds { active: id, items: [{ id, name, data,
 * scId }] }: the active item's data is null (its values are in state.orbit), the others are parked there,
 * and scId says which spacecraft of the library it flies (refreshed when leaving it). A scenario in inertial
 * mode also keeps the attitude it flies (inertialQ): that mode reads Rotation Lab's quaternion, so it comes
 * back when the scenario is selected, while other scenarios leave Rotation Lab alone. Views keep a reference to state.orbit, so
 * switching writes the fields into it in place. Pure functions on the state object; the caller then calls
 * scChanged().
 *
 * The JSON form (exportScenario / importScenario) holds the scenario only and names its spacecraft; a
 * spacecraft has its own JSON in Spacecraft Layout. Importing finds that name in the library.
 */
import * as ENV from '../env/index.js';
import { newId } from '../spacecraft/component.js';
import { activeItem as activeSC, selectSpacecraft, uniqueName, validateAxes } from '../spacecraft/library.js';
import * as AM from '../core/attitude.js';
import { PRESETS, T_MAX, applyPreset, parseEpoch } from './scenario.js';

/** The fields of state.orbit that make up a scenario. refFrame only picks the frame shown, but it goes with the mode's offsets. */
export const SCENARIO_KEYS = ['preset', 'def', 'r', 'v', 'tle', 'epoch', 'hp', 'ha', 'i', 'raan', 'argp', 'nu0', 'j2', 't',
  'mode', 'refFrame', 'roll', 'pitch', 'yaw', 'sunAxis', 'sunSec', 'sunSecAxis', 'tgtLat', 'tgtLon', 'tgtAlt', 'tgtComp'];
/** Those that name parts of a spacecraft: only valid on the spacecraft they were saved with. */
const PART_KEYS = ['tgtComp', 'sunAxis', 'sunSecAxis'];

const copy = x => JSON.parse(JSON.stringify(x));
/** The scenario fields of an orbit object. */
export const scenarioData = o => Object.fromEntries(SCENARIO_KEYS.map(k => [k, o[k]]));

export const activeScenario = s => s.scenarios.items.find(i => i.id === s.scenarios.active);

/** Create or repair state.scenarios (needs state.fleet): exactly one active item, parked items with data. */
export function ensureScenarios(s) {
  const f = s.scenarios && Array.isArray(s.scenarios.items) ? s.scenarios : (s.scenarios = { active: null, items: [] });
  const ids = new Set();
  f.items = f.items.filter(i => { if (!i || !i.id || ids.has(i.id) || !(i.id === f.active || (i.data && typeof i.data === 'object'))) return false; ids.add(i.id); return true; });
  if (!f.items.some(i => i.id === f.active)) { const it = { id: newId(), name: uniqueName(f, 'Scenario 1'), data: null, scId: s.fleet.active }; f.items.unshift(it); f.active = it.id; }
  for (const i of f.items) if (!i.name) { i.name = ''; i.name = uniqueName(f, 'Scenario'); }
  f.items.find(i => i.id === f.active).data = null;
  return f;
}

/**
 * Make item id the active scenario, with its spacecraft. If that spacecraft was deleted, the active one
 * flies it, with that one's pointing axes. @returns true if the scenario changed.
 */
export function selectScenario(s, id) {
  const f = s.scenarios, to = f.items.find(i => i.id === id); if (!to || id === f.active) return false;
  const from = activeScenario(s); from.data = parked(s); from.scId = s.fleet.active;
  const known = s.fleet.items.some(i => i.id === to.scId);
  if (known) selectSpacecraft(s, to.scId); else to.scId = s.fleet.active;
  for (const k of SCENARIO_KEYS) if (known || !PART_KEYS.includes(k)) s.orbit[k] = to.data[k];
  if (to.data.mode === 'inertial' && to.data.inertialQ && s.rot) setRotation(s, to.data.inertialQ);
  validateAxes(s); // parts may have gone since it was parked
  to.data = null; f.active = id;
  return true;
}

/** Rotation Lab's attitude, with its Euler angles in step. */
function setRotation(s, q) { s.rot.q = AM.q.unit(q); s.rot.euler = AM.C2euler(s.rot.seq, AM.q2C(s.rot.q)).map(x => x * AM.R2D); }
/** What is parked for the active scenario: its fields, and the attitude it flies in inertial mode. */
function parked(s) {
  const d = scenarioData(s.orbit); if (s.orbit.mode === 'inertial' && s.rot) d.inertialQ = copy(s.rot.q);
  return d;
}

/** Orbit fields for a new scenario, from default orbit settings (which this modifies). */
export function newScenarioOrbit(o) { applyPreset(o, o.preset); return scenarioData(o); }

/** Add a scenario from orbit fields (copied), flying spacecraft scId (default the active one), and make it active. @returns its id. */
export function addScenario(s, orbit, name, scId = s.fleet.active) {
  const f = s.scenarios, it = { id: newId(), name: uniqueName(f, String(name || '').trim() || 'Scenario'), data: copy({ ...scenarioData(orbit), ...(orbit.inertialQ ? { inertialQ: orbit.inertialQ } : {}) }), scId };
  f.items.push(it); selectScenario(s, it.id); return it.id;
}

/** Add a copy of the active scenario and make it active. @returns its id. */
export const duplicateScenario = s => addScenario(s, parked(s), activeScenario(s).name + ' copy');

/** Rename an item; a blank or already used name is ignored. @returns true if it changed. */
export function renameScenario(s, id, name) {
  const it = s.scenarios.items.find(i => i.id === id), n = String(name || '').trim();
  if (!it || !n || s.scenarios.items.some(i => i !== it && i.name === n)) return false;
  it.name = n; return true;
}

/** Delete an item; the last one stays. Deleting the active one activates its neighbour. Spacecraft stay in the library. @returns true if deleted. */
export function deleteScenario(s, id) {
  const f = s.scenarios, k = f.items.findIndex(i => i.id === id); if (k < 0 || f.items.length < 2) return false;
  if (id === f.active) selectScenario(s, f.items[k + 1 < f.items.length ? k + 1 : k - 1].id);
  f.items.splice(f.items.findIndex(i => i.id === id), 1); return true;
}

/** The active scenario as plain JSON. The spacecraft is only named. */
export function exportScenario(s) {
  return copy({ atttool: 1, kind: 'scenario', name: activeScenario(s).name, orbit: parked(s), spacecraft: activeSC(s).name });
}

const isStr = x => typeof x === 'string', isNum = Number.isFinite;
const AXIS = /^([+-][XYZ]|comp:.+)$/;
const axis = x => isStr(x) && AXIS.test(x);
const inRange = (lo, hi) => x => isNum(x) && x >= lo && x <= hi;
const oneOf = (...l) => x => l.includes(x);
const vec3 = a => Array.isArray(a) && a.length === 3 && a.every(isNum);
const angle = inRange(-3600, 3600);
/** Checks per field, within what the UI allows: a value that fails takes the default. */
const VALID = {
  preset: x => x === 'custom' || (isStr(x) && Object.hasOwn(PRESETS, x)), def: oneOf('elements', 'rv', 'tle'), r: x => x === null || vec3(x), v: x => x === null || vec3(x), tle: isStr,
  epoch: x => isStr(x) && !!parseEpoch(x), hp: inRange(100, 500000), ha: inRange(100, 500000), i: angle, raan: angle, argp: angle, nu0: angle, j2: x => typeof x === 'boolean', t: inRange(-T_MAX, T_MAX),
  mode: oneOf('offsets', 'target', 'sun', 'inertial'), refFrame: x => isStr(x) && Object.hasOwn(ENV.ORBIT_FRAMES, x), roll: angle, pitch: angle, yaw: angle,
  sunAxis: axis, sunSec: oneOf('nadir', 'zenith', 'velocity', 'normal', 'antinormal'), sunSecAxis: axis,
  tgtLat: inRange(-90, 90), tgtLon: angle, tgtAlt: isNum, tgtComp: isStr,
};
/** Orbit fields from untrusted JSON: only the known ones, each valid or the default. */
export function sanitizeScenario(orbit, defaults) {
  const src = orbit && typeof orbit === 'object' ? orbit : {};
  const o = Object.fromEntries(SCENARIO_KEYS.map(k => [k, VALID[k](src[k]) ? src[k] : defaults[k]]));
  if (o.def === 'rv' && !(vec3(o.r) && vec3(o.v))) o.def = 'elements'; // the state vector fields need all six numbers
  const q = src.inertialQ;
  if (q && [q.w, q.x, q.y, q.z].every(isNum) && AM.q.norm(q) > 1e-9) o.inertialQ = AM.q.unit({ w: q.w, x: q.x, y: q.y, z: q.z });
  return o;
}

const cleanName = (x, fallback) => (isStr(x) && x.trim() ? x.trim().slice(0, 32) : fallback);

/**
 * Add a scenario from exportScenario() JSON and make it active. It flies the spacecraft of that name in
 * the library, or else the active one. The library itself doesn't change.
 * @param defaults orbit values for missing or invalid fields.
 * @throws Error with a readable message; nothing has changed then.
 * @returns { id, missing }: missing is the name of a spacecraft not in the library, else null.
 */
export function importScenario(s, json, defaults) {
  if (!json || json.kind !== 'scenario' || !json.orbit || typeof json.orbit !== 'object') throw new Error('Expected a scenario copied from AttTool ("kind": "scenario").');
  if (json.atttool > 1) throw new Error('This scenario comes from a newer version of AttTool.');
  const orbit = sanitizeScenario(json.orbit, defaults), want = isStr(json.spacecraft) ? json.spacecraft : null;
  const found = want === null ? null : s.fleet.items.find(i => i.name === want);
  const id = addScenario(s, orbit, cleanName(json.name, 'Imported scenario'), found ? found.id : s.fleet.active);
  return { id, missing: want !== null && !found ? want : null };
}
