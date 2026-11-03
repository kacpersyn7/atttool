/**
 * Scenario library: named situations, one of them active.
 *
 * state.orbit stays THE active scenario for everything else, and also holds display settings that are not
 * part of a scenario (show, plot, speed, …). state.scenarios holds { active: id, items: [{ id, name, data,
 * scId }] }: the active item's data is null (its values are in state.orbit), the others are parked there,
 * and scId says which spacecraft of the library it flies. Views keep a reference to state.orbit, so
 * switching writes the fields into it in place. Pure functions on the state object; the caller then calls
 * scChanged().
 *
 * The JSON form (exportScenario / importScenario) carries a copy of the spacecraft, so it opens anywhere.
 */
import * as ENV from '../env/index.js';
import { newId, sanitizeSpacecraft } from '../spacecraft/component.js';
import { activeItem as activeSC, parkSpacecraft, selectSpacecraft, uniqueName } from '../spacecraft/library.js';
import { parseEpoch } from './scenario.js';

/** The fields of state.orbit that make up a scenario. */
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
  const from = activeScenario(s); from.data = scenarioData(s.orbit); from.scId = s.fleet.active;
  const known = s.fleet.items.some(i => i.id === to.scId);
  if (known) selectSpacecraft(s, to.scId); else to.scId = s.fleet.active;
  for (const k of SCENARIO_KEYS) if (known || !PART_KEYS.includes(k)) s.orbit[k] = to.data[k];
  to.data = null; f.active = id;
  return true;
}

/** Add a scenario from orbit fields (copied), flying spacecraft scId (default the active one), and make it active. @returns its id. */
export function addScenario(s, orbit, name, scId = s.fleet.active) {
  const f = s.scenarios, it = { id: newId(), name: uniqueName(f, String(name || '').trim() || 'Scenario'), data: copy(scenarioData(orbit)), scId };
  f.items.push(it); selectScenario(s, it.id); return it.id;
}

/** Add a copy of the active scenario and make it active. @returns its id. */
export const duplicateScenario = s => addScenario(s, s.orbit, activeScenario(s).name + ' copy');

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

/** The active scenario as plain JSON, with a copy of its spacecraft. */
export function exportScenario(s) {
  return copy({ atttool: 1, kind: 'scenario', name: activeScenario(s).name, orbit: scenarioData(s.orbit), spacecraft: { name: activeSC(s).name, sc: s.sc } });
}

const AXIS = /^([+-][XYZ]|comp:.+)$/;
const isNum = Number.isFinite;
const vec3 = a => Array.isArray(a) && a.length === 3 && a.every(isNum);
/** Checks per field: a value that fails takes the default. */
const VALID = {
  preset: x => typeof x === 'string', def: x => ['elements', 'rv', 'tle'].includes(x), r: x => x === null || vec3(x), v: x => x === null || vec3(x), tle: x => typeof x === 'string',
  epoch: x => !!parseEpoch(x), hp: x => isNum(x) && x >= 100, ha: x => isNum(x) && x >= 100, i: isNum, raan: isNum, argp: isNum, nu0: isNum, j2: x => typeof x === 'boolean', t: x => isNum(x) && x >= 0,
  mode: x => ['offsets', 'target', 'sun', 'inertial'].includes(x), refFrame: x => !!ENV.ORBIT_FRAMES[x], roll: isNum, pitch: isNum, yaw: isNum,
  sunAxis: x => AXIS.test(x), sunSec: x => typeof x === 'string', sunSecAxis: x => x === undefined || AXIS.test(x),
  tgtLat: x => isNum(x) && Math.abs(x) <= 90, tgtLon: isNum, tgtAlt: isNum, tgtComp: x => typeof x === 'string',
};
/** Orbit fields from untrusted JSON: only the known ones, each valid or the default. */
export function sanitizeScenario(orbit, defaults) {
  const src = orbit && typeof orbit === 'object' ? orbit : {};
  return Object.fromEntries(SCENARIO_KEYS.map(k => [k, VALID[k](src[k]) ? src[k] : defaults[k]]));
}

/**
 * Add a scenario from exportScenario() JSON and make it active. Its spacecraft is added to the library
 * unless an identical one is already there. @param defaults orbit values for missing or invalid fields.
 * @throws Error with a readable message; nothing has changed then. @returns the scenario id.
 */
export function importScenario(s, json, defaults) {
  if (!json || json.kind !== 'scenario' || !json.orbit) throw new Error('Expected a scenario copied from AttTool ("kind": "scenario").');
  const orbit = sanitizeScenario(json.orbit, defaults);
  let scId = s.fleet.active;
  if (json.spacecraft) {
    const sc = sanitizeSpacecraft(copy(json.spacecraft)), text = JSON.stringify(sc);
    const same = s.fleet.items.find(i => JSON.stringify(i.id === s.fleet.active ? s.sc : i.sc) === text);
    scId = same ? same.id : parkSpacecraft(s, sc, json.spacecraft.name || 'Imported spacecraft');
  }
  return addScenario(s, orbit, json.name || 'Imported scenario', scId);
}
