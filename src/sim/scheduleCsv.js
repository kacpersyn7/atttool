/**
 * The mode schedule as CSV (#61): one row per change, for pass plans kept in a spreadsheet or made by another tool.
 * Columns, common ones first, then one group per mode (any order on reading; unknown ones are reported and ignored):
 *   utc · name · mode (nominal | target | sun | inertial) · slew_s (seconds, or auto)
 *   · event (eclipseOut | eclipseIn | rise | set | after) · event_from_utc · event_offset_s · event_elev_deg
 *   · event_after (the id of the change it follows)
 *   · the payload, in every mode: target_lat_deg · target_lon_deg · target_height_m · pointing_part (a part name, or
 *     default); the payload ray, the pointing signals and rise or set events follow them whatever the change flies
 *   · target: target_slew_s
 *   · sun: sun_axis · sun_secondary_axis (+X … −Z, or a part name) · sun_secondary_toward (nadir | zenith | velocity
 *     | normal | antinormal)
 *   · nominal: roll_deg · pitch_deg · yaw_deg
 *   · inertial: q_w · q_x · q_y · q_z
 *   · id
 * A row is written with the payload cells and its own mode's group only; the other groups are left empty, so what
 * matters on a row can be seen. An empty cell takes the scenario's own value; a cell of another mode's group is still
 * read, and reported, as editing it changes nothing in flight. The scenario JSON keeps every setting of every change.
 * Parts may be written as Name or part:Name in any part column; part:Name is written for a part named like an axis
 * (in an axis column) or "default" (in pointing_part), and read as that part.
 * Separators: comma, semicolon or tab, found from the header; with a semicolon or tab, decimal commas are read too.
 * Rows go through cleanSchedule, so they are checked exactly like a scenario JSON. An empty mode takes the scenario's;
 * an event without event_from_utc looks from the change's own start. Cells that would start a spreadsheet formula
 * (= + - @, e.g. the axis +X) are written with a leading ' so Excel keeps them as text; it is dropped on reading.
 * The file starts with a UTF-8 byte-order mark (Excel needs it for names like "SA −Y"); one is ignored on reading.
 * Pure functions.
 */
import { newId } from '../spacecraft/component.js';
import { cleanSchedule } from './scenarioLibrary.js';
import { DATE_MAX, DATE_MIN, epochDate, formatEpoch, validDate } from './scenario.js';

/** The payload columns: written on every row, as every mode's payload ray, signals and rise/set events follow them. */
export const PAYLOAD_COLUMNS = ['target_lat_deg', 'target_lon_deg', 'target_height_m', 'pointing_part'];
/** The attitude columns each mode flies on (by mode as stored); the other modes' columns are left empty on its rows. */
export const MODE_COLUMNS = {
  target: ['target_slew_s'],
  sun: ['sun_axis', 'sun_secondary_axis', 'sun_secondary_toward'],
  offsets: ['roll_deg', 'pitch_deg', 'yaw_deg'],
  inertial: ['q_w', 'q_x', 'q_y', 'q_z'],
};
export const CSV_COLUMNS = ['utc', 'name', 'mode', 'slew_s', 'event', 'event_from_utc', 'event_offset_s', 'event_elev_deg', 'event_after',
  ...PAYLOAD_COLUMNS, ...MODE_COLUMNS.target, ...MODE_COLUMNS.sun, ...MODE_COLUMNS.offsets, ...MODE_COLUMNS.inertial, 'id'];
const MODE_SET = new Set(Object.values(MODE_COLUMNS).flat());
/** The setting each mode column is read into. */
const COLUMN_KEY = { target_slew_s: 'tgtSlew', sun_axis: 'sunAxis', sun_secondary_axis: 'sunSecAxis', sun_secondary_toward: 'sunSec', roll_deg: 'roll', pitch_deg: 'pitch', yaw_deg: 'yaw', q_w: 'q', q_x: 'q', q_y: 'q', q_z: 'q' };
const usedColumns = mode => new Set(MODE_COLUMNS[mode] || []);
const MODE_OUT = { offsets: 'nominal', target: 'target', sun: 'sun', inertial: 'inertial' };
const MODE_IN = { nominal: 'offsets', offsets: 'offsets', target: 'target', sun: 'sun', inertial: 'inertial' };
const AXIS = /^[+-][XYZ]$/;

const NUMBER = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?$/i;
/** A cell as written: a leading ' if a spreadsheet would read it as a formula (not for numbers), quoted if it holds the separator, a quote or a line break. */
const cell = (x, sep) => {
  let s = x === undefined || x === null ? '' : String(x);
  if (/^[=+\-@]/.test(s) && !NUMBER.test(s)) s = "'" + s;
  return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
/** A number from a cell: decimal comma when the file is not comma-separated, the Unicode minus, spaces; '' → undefined, unreadable → NaN. */
export function readNumber(s, decimalComma) {
  const t = String(s ?? '').trim().replace(/\u2212/g, '-').replace(/\s+/g, ''); if (t === '') return undefined;
  const x = Number(decimalComma ? t.replace(',', '.') : t); return Number.isFinite(x) ? x : NaN;
}

/**
 * The schedule of orbit settings o as CSV, each row with the cells its mode uses (MODE_COLUMNS). Parts are written by
 * name (`comps`: the spacecraft's parts), so the file reads well and moves between spacecraft. comma:
 * semicolon-separated with decimal commas (as the signal CSV).
 */
export function scheduleToCSV(o, comps, { comma = false } = {}) {
  const sep = comma ? ';' : ',', name = id => (comps.find(c => c.id === id) || {}).name || '';
  const num = x => { if (!Number.isFinite(x)) return ''; const s = String(x); return comma ? s.replace('.', ',') : s; }; // exact: the shortest text that reads back as the same number
  const axisLike = n => AXIS.test(n.trim().replace(/\u2212/g, '-').toUpperCase());
  const axis = a => { if (!(typeof a === 'string' && a.startsWith('comp:'))) return a || ''; const n = name(a.slice(5)); return n && axisLike(n) ? 'part:' + n : n; }; // a part by its name
  const part = id => { const n = name(id); return n.trim().toLowerCase() === 'default' ? 'part:' + n : n; };
  const rows = [CSV_COLUMNS.join(sep)];
  for (const c of o.schedule || []) {
    const on = c.on || {}, q = c.q || {}, used = usedColumns(c.mode);
    const v = {
      utc: c.start, name: c.name || '', mode: MODE_OUT[c.mode] || c.mode, slew_s: c.autoSlew ? 'auto' : num(c.slew),
      event: on.kind || '', event_from_utc: on.from || '', event_offset_s: c.on ? num(+on.offset || 0) : '', event_elev_deg: on.kind === 'rise' || on.kind === 'set' ? num(on.elev) : '', event_after: on.ref || '',
      target_lat_deg: num(c.tgtLat), target_lon_deg: num(c.tgtLon), target_height_m: num(c.tgtAlt), pointing_part: c.tgtComp ? part(c.tgtComp) : 'default', target_slew_s: num(c.tgtSlew),
      sun_axis: axis(c.sunAxis), sun_secondary_axis: axis(c.sunSecAxis), sun_secondary_toward: c.sunSec || '',
      roll_deg: num(c.roll), pitch_deg: num(c.pitch), yaw_deg: num(c.yaw),
      q_w: num(q.w), q_x: num(q.x), q_y: num(q.y), q_z: num(q.z), id: c.id,
    };
    rows.push(CSV_COLUMNS.map(k => cell(MODE_SET.has(k) && !used.has(k) ? '' : v[k], sep)).join(sep));
  }
  return '\uFEFF' + rows.join('\n') + '\n';
}

/** Rows of a CSV text (quoted fields, "" inside quotes, CRLF or LF); the separator is the most common of , ; tab in the first line. */
export function parseCSVRows(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r\n?|\n/, 1)[0] || '', count = ch => first.split(ch).length - 1;
  const sep = [';', '\t', ','].reduce((best, ch) => count(ch) > count(best) ? ch : best, ',');
  const rows = [], lines = []; let row = [], f = '', q = false, line = 1, at = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else { if (ch === '\n') line++; f += ch; } continue; }
    if (ch === '"' && f === '') q = true;
    else if (ch === sep) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); lines.push(at); row = []; f = ''; line++; at = line; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); lines.push(at); }
  const strip = x => x.startsWith("'") && /^'[=+\-@]/.test(x) ? x.slice(1) : x; // a spreadsheet's text marker, as written
  const keep = rows.map((r, k) => [r.map(strip), lines[k]]).filter(([r]) => r.some(x => x.trim() !== ''));
  return { sep, rows: keep.map(([r]) => r), lines: keep.map(([, l]) => l) };
}

/**
 * Schedule changes from a CSV text, checked as a scenario JSON is (cleanSchedule against `base`, the scenario's own
 * settings). Parts are found by name among `comps`. @returns { changes, report (sentences), rows (data rows read) }.
 * Throws if there is no header with a utc column.
 */
export function scheduleFromCSV(text, base, comps, q0 = null) {
  const { sep, rows, lines } = parseCSVRows(String(text || ''));
  if (!rows.length) throw new Error('The CSV is empty.');
  const head = rows[0].map(h => h.trim().toLowerCase()), col = k => head.indexOf(k);
  if (col('utc') < 0) throw new Error('The CSV needs a header row with at least a "utc" column (and usually "mode").');
  const report = [], unknown = head.filter(h => h && !CSV_COLUMNS.includes(h));
  if (unknown.length) report.push(`Columns not used: ${unknown.join(', ')}.`);
  const decimalComma = sep !== ',', kinds = new Map([['eclipseout', 'eclipseOut'], ['eclipsein', 'eclipseIn'], ['rise', 'rise'], ['set', 'set'], ['after', 'after']]);
  const raws = [];
  rows.slice(1).forEach((r, k) => {
    const line = lines[k + 1], g = key => col(key) < 0 ? undefined : r[col(key)], say = m => report.push(`Line ${line}: ${m}.`);
    const num = (key) => { const x = readNumber(g(key), decimalComma); if (Number.isNaN(x)) { say(`${key} "${g(key).trim()}" is not a number, so the scenario's value is used`); return undefined; } return x; };
    const partId = (n0, named = false) => { // named: written part:Name, so "default" is a part's name
      const n = (n0 || '').trim(); if (!n) return undefined; if (!named && n.toLowerCase() === 'default') return '';
      const ps = comps.filter(c => c.name === n);
      if (!ps.length) { say(`no part named "${n}" on this spacecraft, so the scenario's is used`); return undefined; }
      if (ps.length > 1) say(`${ps.length} parts are named "${n}": the first is used`);
      return ps[0].id;
    };
    const bare = t => t.replace(/^part:/i, '').trim(); // part:Name or Name
    const axis = s0 => {
      const t = (s0 || '').trim(); if (!t) return undefined;
      if (/^part:/i.test(t)) { const id = partId(bare(t), true); return id ? 'comp:' + id : undefined; }
      const ax = t.replace(/\u2212/g, '-').toUpperCase();
      if (AXIS.test(ax)) { if (comps.some(c => c.name === t)) say(`"${t}" is read as the axis ${ax}; a part with that name is written part:${t}`); return ax; }
      if (comps.some(c => c.name === t)) { const id = partId(t); return id ? 'comp:' + id : undefined; }
      say(`"${t}" is neither an axis (+X … −Z) nor a part on this spacecraft, so the scenario's is used`); return undefined;
    };
    const utc = s0 => { const t = (s0 || '').trim().replace(' ', 'T').replace(/Z$/i, ''); return t || undefined; };
    const start = utc(g('utc'));
    if (!start || !validDate(start)) { say(`the start "${(g('utc') || '').trim()}" is not a UTC date and time from ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)} (YYYY-MM-DD HH:MM:SS), so the row is left out`); return; }
    const mode0 = (g('mode') || '').trim(), mode = mode0 ? MODE_IN[mode0.toLowerCase()] : base.mode;
    if (!mode) { say(`unknown mode "${mode0}" (nominal, target, sun or inertial), so the row is left out`); return; }
    const c = { id: (g('id') || '').trim() || undefined, start, name: g('name'), mode };
    const slew = (g('slew_s') || '').trim().toLowerCase(); if (slew === 'auto') { c.autoSlew = true; c.slew = 0; } else c.slew = num('slew_s');
    for (const [k2, key] of [['roll', 'roll_deg'], ['pitch', 'pitch_deg'], ['yaw', 'yaw_deg'], ['tgtLat', 'target_lat_deg'], ['tgtLon', 'target_lon_deg'], ['tgtAlt', 'target_height_m'], ['tgtSlew', 'target_slew_s']]) c[k2] = num(key);
    c.sunAxis = axis(g('sun_axis')); c.sunSecAxis = axis(g('sun_secondary_axis')); c.sunSec = (g('sun_secondary_toward') || '').trim().toLowerCase() || undefined;
    { const p = (g('pointing_part') || '').trim(); c.tgtComp = partId(bare(p), /^part:/i.test(p)); }
    const qs = ['q_w', 'q_x', 'q_y', 'q_z'].map(num); if (qs.every(Number.isFinite)) c.q = { w: qs[0], x: qs[1], y: qs[2], z: qs[3] };
    else if (mode === 'inertial') say(`no inertial attitude (q_w … q_z), so ${q0 ? "Rotation Lab's" : 'the identity'} is used`);
    const ev0 = (g('event') || '').trim();
    if (ev0) {
      const kind = kinds.get(ev0.toLowerCase());
      if (!kind) say(`unknown event "${ev0}" (eclipseOut, eclipseIn, rise, set, after), so it keeps a fixed start`);
      else c.on = { kind, from: utc(g('event_from_utc')) || (kind === 'after' ? null : start), offset: num('event_offset_s') ?? 0, elev: num('event_elev_deg'), ref: (g('event_after') || '').trim() || undefined };
    }
    for (const k2 of Object.keys(c)) if (c[k2] === undefined) delete c[k2]; // empty cells: the scenario's own value
    const used = usedColumns(mode), unused = [...MODE_SET].filter(key => !used.has(key) && (g(key) || '').trim() && COLUMN_KEY[key] in c);
    if (unused.length) say(`${unused.join(', ')} ${unused.length > 1 ? 'are' : 'is'} not used in ${MODE_OUT[mode]} mode: kept, but ${unused.length > 1 ? 'they change' : 'it changes'} nothing in flight`);
    raws.push(c);
  });
  return { changes: cleanSchedule(raws, base, q0, report), report, rows: rows.length - 1 };
}

/**
 * An example file to start from: one change in each mode, from the next whole 10 minutes after the scenario's time
 * o.t, with the scenario's target and Sun axes; the Sun change starts on an eclipse exit and the inertial one 20 min
 * after it, so the event columns are shown too.
 */
export function exampleScheduleCSV(o, comps, opts) {
  const t0 = Math.ceil((epochDate(o).getTime() + (+o.t || 0) * 1000) / 600e3) * 600e3, at = min => formatEpoch(new Date(t0 + min * 60e3));
  const sun = { sunAxis: o.sunAxis || '-Z', sunSecAxis: o.sunSecAxis || '+X', sunSec: o.sunSec || 'nadir' };
  const schedule = [
    { id: 'ex1', start: at(0), slew: 60, mode: 'offsets', name: 'Example: roll 20°', roll: 20, pitch: 0, yaw: 0 },
    { id: 'ex2', start: at(20), slew: 0, autoSlew: true, mode: 'target', name: 'Example: image the target', tgtLat: o.tgtLat, tgtLon: o.tgtLon, tgtAlt: o.tgtAlt, tgtComp: '', tgtSlew: 60 },
    { id: 'ex3', start: at(40), slew: 0, autoSlew: true, mode: 'sun', name: 'Example: Sun after the eclipse', ...sun, on: { kind: 'eclipseOut', from: at(40), offset: 0 } },
    { id: 'ex4', start: at(60), slew: 0, autoSlew: true, mode: 'inertial', name: 'Example: hold inertial', q: { w: 1, x: 0, y: 0, z: 0 }, on: { kind: 'after', from: null, offset: 1200, ref: 'ex3' } },
  ];
  return scheduleToCSV({ schedule }, comps, opts);
}

/**
 * Changes to add to a schedule that already holds `existing`: ids that clash are given new ones, and 'after'
 * references among the added changes follow them.
 */
export function forAdding(changes, existing) {
  const taken = new Set(existing.map(c => c.id)), map = new Map();
  const out = changes.map(c => { if (!taken.has(c.id)) { taken.add(c.id); return { ...c }; } const id = newId(); map.set(c.id, id); taken.add(id); return { ...c, id }; });
  for (const c of out) if (c.on && c.on.kind === 'after' && map.has(c.on.ref)) c.on = { ...c.on, ref: map.get(c.on.ref) };
  return out;
}
