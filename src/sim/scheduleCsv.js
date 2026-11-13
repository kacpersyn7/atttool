/**
 * The mode schedule as CSV (#61): one row per change, for pass plans kept in a spreadsheet or made by another tool.
 * Columns (any order; unknown ones are reported and ignored; empty cells take the scenario's own value):
 *   utc · name · mode (nominal | target | sun | inertial) · slew_s (seconds, or auto) · roll_deg · pitch_deg · yaw_deg
 *   · sun_axis · sun_secondary_axis (+X … −Z, or part:<name>) · sun_secondary_toward (nadir | zenith | velocity | normal
 *   | antinormal) · target_lat_deg · target_lon_deg · target_height_m · pointing_part (a part name, or default) · target_slew_s
 *   · q_w · q_x · q_y · q_z (inertial attitude) · event (eclipseOut | eclipseIn | rise | set | after) · event_from_utc
 *   · event_offset_s · event_elev_deg · event_after (the id of the change it follows) · id
 * Separators: comma, semicolon or tab, found from the header; with a semicolon or tab, decimal commas are read too.
 * Rows go through cleanSchedule, so they are checked exactly like a scenario JSON. An empty mode takes the scenario's;
 * an event without event_from_utc looks from the change's own start. Cells that would start a spreadsheet formula
 * (= + - @, e.g. the axis +X) are written with a leading ' so Excel keeps them as text; it is dropped on reading.
 * The file starts with a UTF-8 byte-order mark (Excel needs it for names like "SA −Y"); one is ignored on reading.
 * Pure functions.
 */
import { newId } from '../spacecraft/component.js';
import { cleanSchedule } from './scenarioLibrary.js';
import { DATE_MAX, DATE_MIN, validDate } from './scenario.js';

export const CSV_COLUMNS = ['utc', 'name', 'mode', 'slew_s', 'roll_deg', 'pitch_deg', 'yaw_deg', 'sun_axis', 'sun_secondary_axis', 'sun_secondary_toward',
  'target_lat_deg', 'target_lon_deg', 'target_height_m', 'pointing_part', 'target_slew_s', 'q_w', 'q_x', 'q_y', 'q_z',
  'event', 'event_from_utc', 'event_offset_s', 'event_elev_deg', 'event_after', 'id'];
const MODE_OUT = { offsets: 'nominal', target: 'target', sun: 'sun', inertial: 'inertial' };
const MODE_IN = { nominal: 'offsets', offsets: 'offsets', target: 'target', sun: 'sun', inertial: 'inertial' };

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
 * The schedule of orbit settings o as CSV. Parts are written by name (`comps`: the spacecraft's parts), so the file
 * reads well and moves between spacecraft. comma: semicolon-separated with decimal commas (as the signal CSV).
 */
export function scheduleToCSV(o, comps, { comma = false } = {}) {
  const sep = comma ? ';' : ',', name = id => (comps.find(c => c.id === id) || {}).name || '';
  const num = x => { if (!Number.isFinite(x)) return ''; const s = String(x); return comma ? s.replace('.', ',') : s; }; // exact: the shortest text that reads back as the same number
  const axis = a => typeof a === 'string' && a.startsWith('comp:') ? 'part:' + name(a.slice(5)) : a || '';
  const rows = [CSV_COLUMNS.join(sep)];
  for (const c of o.schedule || []) {
    const on = c.on || {}, q = c.q || {};
    const v = {
      utc: c.start, name: c.name || '', mode: MODE_OUT[c.mode] || c.mode, slew_s: c.autoSlew ? 'auto' : num(c.slew),
      roll_deg: num(c.roll), pitch_deg: num(c.pitch), yaw_deg: num(c.yaw), sun_axis: axis(c.sunAxis), sun_secondary_axis: axis(c.sunSecAxis), sun_secondary_toward: c.sunSec || '',
      target_lat_deg: num(c.tgtLat), target_lon_deg: num(c.tgtLon), target_height_m: num(c.tgtAlt), pointing_part: c.tgtComp ? name(c.tgtComp) : 'default', target_slew_s: num(c.tgtSlew),
      q_w: c.mode === 'inertial' ? num(q.w) : '', q_x: c.mode === 'inertial' ? num(q.x) : '', q_y: c.mode === 'inertial' ? num(q.y) : '', q_z: c.mode === 'inertial' ? num(q.z) : '',
      event: on.kind || '', event_from_utc: on.from || '', event_offset_s: c.on ? num(+on.offset || 0) : '', event_elev_deg: on.kind === 'rise' || on.kind === 'set' ? num(on.elev) : '', event_after: on.ref || '', id: c.id,
    };
    rows.push(CSV_COLUMNS.map(k => cell(v[k], sep)).join(sep));
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
    const partId = n0 => {
      const n = (n0 || '').trim(); if (!n) return undefined; if (n.toLowerCase() === 'default') return '';
      const ps = comps.filter(c => c.name === n);
      if (!ps.length) { say(`no part named "${n}" on this spacecraft, so the scenario's is used`); return undefined; }
      if (ps.length > 1) say(`${ps.length} parts are named "${n}": the first is used`);
      return ps[0].id;
    };
    const axis = s0 => { const t = (s0 || '').trim(); if (!t) return undefined; if (/^part:/i.test(t)) { const id = partId(t.slice(5)); return id ? 'comp:' + id : undefined; } return t.replace(/\u2212/g, '-').toUpperCase(); };
    const utc = s0 => { const t = (s0 || '').trim().replace(' ', 'T').replace(/Z$/i, ''); return t || undefined; };
    const start = utc(g('utc'));
    if (!start || !validDate(start)) { say(`the start "${(g('utc') || '').trim()}" is not a UTC date and time from ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)} (YYYY-MM-DD HH:MM:SS), so the row is left out`); return; }
    const mode0 = (g('mode') || '').trim(), mode = mode0 ? MODE_IN[mode0.toLowerCase()] : base.mode;
    if (!mode) { say(`unknown mode "${mode0}" (nominal, target, sun or inertial), so the row is left out`); return; }
    const c = { id: (g('id') || '').trim() || undefined, start, name: g('name'), mode };
    const slew = (g('slew_s') || '').trim().toLowerCase(); if (slew === 'auto') { c.autoSlew = true; c.slew = 0; } else c.slew = num('slew_s');
    for (const [k2, key] of [['roll', 'roll_deg'], ['pitch', 'pitch_deg'], ['yaw', 'yaw_deg'], ['tgtLat', 'target_lat_deg'], ['tgtLon', 'target_lon_deg'], ['tgtAlt', 'target_height_m'], ['tgtSlew', 'target_slew_s']]) c[k2] = num(key);
    c.sunAxis = axis(g('sun_axis')); c.sunSecAxis = axis(g('sun_secondary_axis')); c.sunSec = (g('sun_secondary_toward') || '').trim().toLowerCase() || undefined;
    c.tgtComp = partId(g('pointing_part'));
    const qs = ['q_w', 'q_x', 'q_y', 'q_z'].map(num); if (qs.every(Number.isFinite)) c.q = { w: qs[0], x: qs[1], y: qs[2], z: qs[3] };
    else if (mode === 'inertial') say(`no inertial attitude (q_w … q_z), so ${q0 ? "Rotation Lab's" : 'the identity'} is used`);
    const ev0 = (g('event') || '').trim();
    if (ev0) {
      const kind = kinds.get(ev0.toLowerCase());
      if (!kind) say(`unknown event "${ev0}" (eclipseOut, eclipseIn, rise, set, after), so it keeps a fixed start`);
      else c.on = { kind, from: utc(g('event_from_utc')) || (kind === 'after' ? null : start), offset: num('event_offset_s') ?? 0, elev: num('event_elev_deg'), ref: (g('event_after') || '').trim() || undefined };
    }
    for (const k2 of Object.keys(c)) if (c[k2] === undefined) delete c[k2]; // empty cells: the scenario's own value
    raws.push(c);
  });
  return { changes: cleanSchedule(raws, base, q0, report), report, rows: rows.length - 1 };
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
