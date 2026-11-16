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
import { DATE_MAX, DATE_MIN, PRESETS, T_MAX, applyPreset, parseEpoch, validDate } from './scenario.js';
import { SEGMENT_KEYS } from './guidance.js';
import { cleanOn } from './events.js';

/** The fields of state.orbit that make up a scenario. refFrame only picks the frame shown, but it goes with the mode's offsets. */
export const SCENARIO_KEYS = ['preset', 'def', 'r', 'v', 'tle', 'epoch', 'hp', 'ha', 'i', 'raan', 'argp', 'nu0', 'j2', 't',
  'mode', 'refFrame', 'roll', 'pitch', 'yaw', 'sunAxis', 'sunSec', 'sunSecAxis', 'tgtLat', 'tgtLon', 'tgtAlt', 'tgtComp', 'tgtSlew', 'schedule', 'end',
  'rgtR', 'rgtD', 'rgtLtan', 'rgtLon'];
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

/**
 * Scenario JSON format: 1, or FORMAT_SCHEDULE with a mode schedule. AttTool 0.8 and older read format 1 and refuse
 * anything newer, so JSON copied from this version on never loses its schedule there without a word, and a scenario
 * without one stays readable by them. (The withdrawn first build of 0.9.0 wrote format 1 with a schedule; it is still read here.)
 */
export const FORMAT_SCHEDULE = 2;
/** The newest format this version reads. */
export const SCENARIO_FORMAT = FORMAT_SCHEDULE;

/** The active scenario as plain JSON. The spacecraft is only named. */
export function exportScenario(s) {
  const orbit = parked(s), format = orbit.schedule && orbit.schedule.length ? FORMAT_SCHEDULE : 1;
  return copy({ atttool: format, kind: 'scenario', name: activeScenario(s).name, orbit, spacecraft: activeSC(s).name });
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
  preset: x => x === 'custom' || (isStr(x) && Object.hasOwn(PRESETS, x)), def: oneOf('elements', 'rv', 'tle', 'ssrgt'), r: x => x === null || vec3(x), v: x => x === null || vec3(x), tle: isStr,
  epoch: x => isStr(x) && !!parseEpoch(x), hp: inRange(100, 500000), ha: inRange(100, 500000), i: angle, raan: angle, argp: angle, nu0: angle, j2: x => typeof x === 'boolean', t: inRange(-T_MAX, T_MAX),
  mode: oneOf('offsets', 'target', 'sun', 'inertial'), refFrame: x => isStr(x) && Object.hasOwn(ENV.ORBIT_FRAMES, x), roll: angle, pitch: angle, yaw: angle,
  sunAxis: axis, sunSec: oneOf('nadir', 'zenith', 'velocity', 'normal', 'antinormal'), sunSecAxis: axis,
  tgtLat: inRange(-90, 90), tgtLon: angle, tgtAlt: isNum, tgtComp: isStr, tgtSlew: inRange(0, 900),
  schedule: Array.isArray, // and then cleaned change by change (cleanSchedule)
  end: x => x === '' || (isStr(x) && validDate(x)), // '' = automatic
  rgtR: x => Number.isInteger(x) && x >= 1 && x <= 1000, rgtD: x => Number.isInteger(x) && x >= 1 && x <= 1000, rgtLtan: inRange(0, 24), rgtLon: inRange(-180, 180),
};
/** Names of the scenario fields for the import report. */
const FIELD_NAME = {
  preset: 'orbit preset', def: 'orbit definition', r: 'state vector r', v: 'state vector v', tle: 'TLE', epoch: 'epoch', hp: 'perigee altitude', ha: 'apogee altitude',
  i: 'inclination', raan: 'RAAN', argp: 'argument of perigee', nu0: 'true anomaly', j2: 'J2', t: 'current time', mode: 'guidance mode', refFrame: 'shown frame',
  roll: 'roll', pitch: 'pitch', yaw: 'yaw', sunAxis: 'Sun axis', sunSec: 'secondary direction', sunSecAxis: 'secondary axis', tgtLat: 'target latitude',
  tgtLon: 'target longitude', tgtAlt: 'target height', tgtComp: 'pointing axis', tgtSlew: 'slew to/from target', schedule: 'mode schedule', end: 'scenario end',
  rgtR: 'repeat orbits', rgtD: 'repeat days', rgtLtan: 'repeat-track LTAN', rgtLon: 'reference track longitude',
};

/**
 * Orbit fields from untrusted JSON: only the known ones, each valid or the default. With a `report` array, what
 * was not taken as it was is added to it as sentences: values reset to the default, changes dropped or changed.
 * Fields the JSON lacks (a file from an older version) are not a problem: they are counted in `info`.
 */
export function sanitizeScenario(orbit, defaults, report = null, info = null) {
  const src = orbit && typeof orbit === 'object' ? orbit : {}, note = m => { if (report) report.push(m); };
  const bad = SCENARIO_KEYS.filter(k => Object.hasOwn(src, k) && !VALID[k](src[k])), missing = SCENARIO_KEYS.filter(k => !Object.hasOwn(src, k));
  const o = Object.fromEntries(SCENARIO_KEYS.map(k => [k, VALID[k](src[k]) ? src[k] : defaults[k]]));
  if (bad.length) note(`Reset to the default (not a valid value): ${bad.map(k => FIELD_NAME[k] || k).join(', ')}.`);
  if (missing.length && info) info.push(`${missing.length} setting${missing.length === 1 ? ' was' : 's were'} not in the file (made by an older version) and took the default.`);
  if (o.def === 'rv' && !(vec3(o.r) && vec3(o.v))) { o.def = 'elements'; note('The orbit was defined by a state vector without all six numbers, so the elements are used.'); } // the state vector fields need all six numbers
  const q = src.inertialQ;
  if (q && [q.w, q.x, q.y, q.z].every(isNum) && AM.q.norm(q) > 1e-9) o.inertialQ = AM.q.unit({ w: q.w, x: q.x, y: q.y, z: q.z });
  else if (q !== undefined) note('The inertial attitude was not a valid quaternion: Rotation Lab keeps its own.');
  o.schedule = cleanSchedule(o.schedule, o, o.inertialQ, report);
  return o;
}

/**
 * Give each schedule change of orbit settings `o` the change settings it lacks (saves from before a setting was
 * per change), from o itself: what such a change flew then.
 */
export function fillChanges(o) {
  if (o && Array.isArray(o.schedule)) for (const c of o.schedule) if (c && typeof c === 'object') for (const k of SEGMENT_KEYS) if (!(k in c)) c[k] = o[k];
  return o;
}

/** Longest name of a schedule change. */
export const NAME_MAX = 40;
/** A change name as kept: at most NAME_MAX characters (whole characters, no half emoji), trimmed; '' = none. */
export const cleanChangeName = x => typeof x === 'string' ? Array.from(x.trim()).slice(0, NAME_MAX).join('').trim() : '';

/** Most changes a schedule keeps. */
export const MAX_CHANGES = 100;
const quat = q => q && typeof q === 'object' && [q.w, q.x, q.y, q.z].every(isNum) && AM.q.norm(q) > 1e-9;
/**
 * Schedule changes from untrusted JSON: a change needs a valid start and mode, or it is dropped; other
 * settings that fail take the scenario's own (`base`); slew 0..3600 s, else 60. Ids are made unique. An inertial
 * change without a valid attitude gets `q0` (the scenario's inertial attitude), else the identity. With a `report`
 * array, dropped changes and reset settings are added to it as sentences.
 */
export function cleanSchedule(x, base, q0 = null, report = null) {
  if (!Array.isArray(x)) return [];
  const ids = new Set(), out = [], pairs = [], dropped = { start: 0, dates: 0, many: 0, mode: 0, other: 0 }, reset = new Set();
  if (x.length > MAX_CHANGES) dropped.many = x.length - MAX_CHANGES;
  for (const c of x.slice(0, MAX_CHANGES)) {
    if (!c || typeof c !== 'object') { dropped.other++; continue; }
    if (!isStr(c.start) || !parseEpoch(c.start)) { dropped.start++; continue; }
    if (!validDate(c.start)) { dropped.dates++; continue; }
    if (!VALID.mode(c.mode)) { dropped.mode++; continue; }
    const id = isStr(c.id) ? c.id.slice(0, 40) : '';
    const seg = { id: id && !ids.has(id) ? id : newId(), start: c.start, slew: inRange(0, 3600)(c.slew) ? c.slew : 60 };
    if (Object.hasOwn(c, 'slew') && !inRange(0, 3600)(c.slew)) reset.add('slew time');
    const nm = cleanChangeName(c.name); if (nm) seg.name = nm; // optional (#55)
    if (c.autoSlew === true) seg.autoSlew = true; // slew worked out from the turn (#57)
    for (const k of SEGMENT_KEYS) { seg[k] = VALID[k](c[k]) ? c[k] : base[k]; if (Object.hasOwn(c, k) && !VALID[k](c[k])) reset.add(FIELD_NAME[k] || k); }
    if (seg.mode === 'inertial') { if (!quat(c.q)) reset.add('inertial attitude'); const q = quat(c.q) ? c.q : q0 || AM.q.id(); seg.q = AM.q.unit({ w: q.w, x: q.x, y: q.y, z: q.z }); }
    ids.add(seg.id); out.push(seg); pairs.push([seg, c]);
  }
  // event starts (#58): after the ids are settled, since 'after' names another change
  const kept = new Set(out.map(c => c.id)); let lostEvents = 0;
  for (const [seg, c] of pairs) { if (!c.on) continue; const on = cleanOn(c.on, kept); if (on) seg.on = on; else lostEvents++; } // paired as kept, whatever its id became
  if (report) {
    if (lostEvents) report.push(`${lostEvents} schedule change${lostEvents === 1 ? ' keeps' : 's keep'} a fixed start: ${lostEvents === 1 ? 'its' : 'their'} event was not valid.`);
    const n = (k, what) => dropped[k] ? report.push(`${dropped[k]} schedule change${dropped[k] === 1 ? '' : 's'} dropped: ${what}.`) : 0;
    n('start', 'no readable start time'); n('dates', `a start outside ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)}`); n('many', `more than ${MAX_CHANGES} changes`); n('mode', 'an unknown guidance mode'); n('other', 'not a change at all');
    if (reset.size) report.push(`In schedule changes, reset to the scenario's own value: ${[...reset].join(', ')}.`);
  }
  return out;
}

const cleanName = (x, fallback) => (isStr(x) && x.trim() ? x.trim().slice(0, 32) : fallback);

/**
 * What importing `json` would do, without changing anything: { name, orbit (cleaned), report (sentences: what was
 * not taken as it was), spacecraft: { name (asked for, or null), found (its library id, or null) }, sameName (the id
 * of a scenario with the same name, or null) }. Throws for something that isn't a scenario, or a newer format.
 */
export function previewScenario(s, json, defaults) {
  if (!json || json.kind !== 'scenario' || !json.orbit || typeof json.orbit !== 'object') throw new Error('Expected a scenario copied from AttTool ("kind": "scenario").');
  if (json.atttool > SCENARIO_FORMAT) throw new Error('This scenario comes from a newer version of AttTool.');
  const report = [], info = [], orbit = sanitizeScenario(json.orbit, defaults, report, info), want = isStr(json.spacecraft) ? json.spacecraft : null;
  const found = want === null ? null : s.fleet.items.find(i => i.name === want) || null, name = cleanName(json.name, 'Imported scenario');
  const asked = isStr(json.name) ? json.name.trim() : '', same = s.scenarios.items.find(i => i.name === asked || i.name === name) || null; // library names can be longer than an imported one
  // parts named by the settings that the spacecraft it would fly doesn't have: reset when it is selected (validateAxes)
  const flyId = found ? found.id : s.fleet.active, fly = s.fleet.items.find(i => i.id === flyId), comps = (fly && fly.sc ? fly.sc : s.sc).comps;
  const has = id => comps.some(c => c.id === id), gone = new Set();
  for (const g of [orbit, ...orbit.schedule]) {
    if (g.tgtComp && !has(g.tgtComp)) gone.add('pointing axis');
    for (const k of ['sunAxis', 'sunSecAxis']) if (isStr(g[k]) && g[k].startsWith('comp:') && !has(g[k].slice(5))) gone.add(FIELD_NAME[k]);
  }
  if (gone.size) report.push(`Parts that ${fly ? fly.name : 'the spacecraft'} does not have, so the default is used: ${[...gone].join(', ')}.`);
  return { name, orbit, report, info, spacecraft: { name: want, found: found ? found.id : null }, sameName: same ? same.id : null };
}

/**
 * Import a scenario: added as new, or with opts.replace = the id of a scenario that it replaces (it takes that
 * one's name). It flies the spacecraft it names if the library has one of that name, else the active one.
 * @returns { id, missing (the spacecraft name not found, or null), report (as previewScenario) }
 */
export function importScenario(s, json, defaults, opts = {}) {
  const p = previewScenario(s, json, defaults), f = s.scenarios, old = opts.replace ? f.items.find(i => i.id === opts.replace) || null : null;
  // a replacement flies the spacecraft named in the file, else the one the replaced scenario flew (if still here), else the active one
  const keep = old && (old.id === f.active ? s.fleet.active : old.scId), scId = p.spacecraft.found || (keep && s.fleet.items.some(i => i.id === keep) ? keep : s.fleet.active);
  const at = old ? f.items.indexOf(old) : -1, id = addScenario(s, p.orbit, p.name, scId);
  if (old) { const name = old.name; deleteScenario(s, old.id); renameScenario(s, id, name); const k = f.items.findIndex(i => i.id === id); f.items.splice(at, 0, ...f.items.splice(k, 1)); } // its place in the library
  return { id, replaced: !!old, missing: p.spacecraft.name !== null && !p.spacecraft.found ? p.spacecraft.name : null, report: p.report };
}
