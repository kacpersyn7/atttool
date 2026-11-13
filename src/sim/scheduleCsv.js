/**
 * The mode schedule as CSV (#61): one row per change, for pass plans kept in a spreadsheet or made by another tool.
 * Columns (any order; unknown ones are reported and ignored; empty cells take the scenario's own value):
 *   utc · name · mode (nominal | target | sun | inertial) · slew_s (seconds, or auto) · roll_deg · pitch_deg · yaw_deg
 *   · sun_axis · sun_secondary_axis (+X … −Z, or part:<name>) · sun_secondary_toward (nadir | zenith | velocity | normal
 *   | antinormal) · target_lat_deg · target_lon_deg · target_height_m · pointing_part (a part name) · target_slew_s
 *   · q_w · q_x · q_y · q_z (inertial attitude) · event (eclipseOut | eclipseIn | rise | set | after) · event_from_utc
 *   · event_offset_s · event_elev_deg · event_after (the id of the change it follows) · id
 * Separators: comma, semicolon or tab, found from the header; with a semicolon or tab, decimal commas are read too.
 * Rows go through cleanSchedule, so they are checked exactly like a scenario JSON. Pure functions.
 */
import { newId } from '../spacecraft/component.js';
import { cleanSchedule } from './scenarioLibrary.js';

export const CSV_COLUMNS = ['utc', 'name', 'mode', 'slew_s', 'roll_deg', 'pitch_deg', 'yaw_deg', 'sun_axis', 'sun_secondary_axis', 'sun_secondary_toward',
  'target_lat_deg', 'target_lon_deg', 'target_height_m', 'pointing_part', 'target_slew_s', 'q_w', 'q_x', 'q_y', 'q_z',
  'event', 'event_from_utc', 'event_offset_s', 'event_elev_deg', 'event_after', 'id'];
const MODE_OUT = { offsets: 'nominal', target: 'target', sun: 'sun', inertial: 'inertial' };
const MODE_IN = { nominal: 'offsets', offsets: 'offsets', target: 'target', sun: 'sun', inertial: 'inertial' };

/** A cell as written: quoted if it holds the separator, a quote or a line break. */
const cell = (x, sep) => { const s = x === undefined || x === null ? '' : String(x); return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/**
 * The schedule of orbit settings o as CSV. Parts are written by name (`comps`: the spacecraft's parts), so the file
 * reads well and moves between spacecraft. comma: semicolon-separated with decimal commas (as the signal CSV).
 */
export function scheduleToCSV(o, comps, { comma = false } = {}) {
  const sep = comma ? ';' : ',', name = id => (comps.find(c => c.id === id) || {}).name || '';
  const num = (x, full) => { if (!Number.isFinite(x)) return ''; const s = full ? String(x) : String(+x.toFixed(9)); return comma ? s.replace('.', ',') : s; };
  const axis = a => typeof a === 'string' && a.startsWith('comp:') ? 'part:' + name(a.slice(5)) : a || '';
  const rows = [CSV_COLUMNS.join(sep)];
  for (const c of o.schedule || []) {
    const on = c.on || {}, q = c.q || {};
    const v = {
      utc: c.start, name: c.name || '', mode: MODE_OUT[c.mode] || c.mode, slew_s: c.autoSlew ? 'auto' : num(c.slew),
      roll_deg: num(c.roll), pitch_deg: num(c.pitch), yaw_deg: num(c.yaw), sun_axis: axis(c.sunAxis), sun_secondary_axis: axis(c.sunSecAxis), sun_secondary_toward: c.sunSec || '',
      target_lat_deg: num(c.tgtLat), target_lon_deg: num(c.tgtLon), target_height_m: num(c.tgtAlt), pointing_part: c.tgtComp ? name(c.tgtComp) : '', target_slew_s: num(c.tgtSlew),
      q_w: c.mode === 'inertial' ? num(q.w, true) : '', q_x: c.mode === 'inertial' ? num(q.x, true) : '', q_y: c.mode === 'inertial' ? num(q.y, true) : '', q_z: c.mode === 'inertial' ? num(q.z, true) : '', // full precision: an attitude
      event: on.kind || '', event_from_utc: on.from || '', event_offset_s: c.on ? num(+on.offset || 0) : '', event_elev_deg: on.kind === 'rise' || on.kind === 'set' ? num(on.elev) : '', event_after: on.ref || '', id: c.id,
    };
    rows.push(CSV_COLUMNS.map(k => cell(v[k], sep)).join(sep));
  }
  return rows.join('\n') + '\n';
}

/** Rows of a CSV text (quoted fields, "" inside quotes, CRLF or LF); the separator is the most common of , ; tab in the first line. */
export function parseCSVRows(text) {
  const first = text.split(/\r?\n/, 1)[0] || '', count = ch => first.split(ch).length - 1;
  const sep = [';', '\t', ','].reduce((best, ch) => count(ch) > count(best) ? ch : best, ',');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"' && f === '') q = true;
    else if (ch === sep) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return { sep, rows: rows.filter(r => r.some(x => x.trim() !== '')) };
}

/**
 * Schedule changes from a CSV text, checked as a scenario JSON is (cleanSchedule against `base`, the scenario's own
 * settings). Parts are found by name among `comps`. @returns { changes, report (sentences), rows (data rows read) }.
 * Throws if there is no header with a utc column.
 */
export function scheduleFromCSV(text, base, comps) {
  const { sep, rows } = parseCSVRows(String(text || ''));
  if (!rows.length) throw new Error('The CSV is empty.');
  const head = rows[0].map(h => h.trim().toLowerCase()), col = k => head.indexOf(k);
  if (col('utc') < 0) throw new Error('The CSV needs a header row with at least a "utc" column (and usually "mode").');
  const report = [], unknown = head.filter(h => h && !CSV_COLUMNS.includes(h));
  if (unknown.length) report.push(`Columns not used: ${unknown.join(', ')}.`);
  const decimalComma = sep !== ',';
  const num = s => { const t = (s || '').trim(); if (t === '') return undefined; const x = Number(decimalComma ? t.replace(',', '.') : t); return Number.isFinite(x) ? x : NaN; };
  const partId = (nameStr, row) => { const n = (nameStr || '').trim(); if (!n) return undefined; const p = comps.find(c => c.name === n); if (!p) report.push(`Row ${row}: no part named "${n}" on this spacecraft, so the default is used.`); return p ? p.id : undefined; };
  const axis = (s, row) => { const t = (s || '').trim(); if (!t) return undefined; if (/^part:/i.test(t)) { const id = partId(t.slice(5), row); return id ? 'comp:' + id : undefined; } return t.replace('−', '-').toUpperCase(); };
  const utc = s => { const t = (s || '').trim().replace(' ', 'T').replace(/Z$/i, ''); return t || undefined; };
  const raws = rows.slice(1).map((r, k) => {
    const g = key => col(key) < 0 ? undefined : r[col(key)], line = k + 2;
    const c = { id: (g('id') || '').trim() || undefined, start: utc(g('utc')), name: g('name'), mode: MODE_IN[(g('mode') || '').trim().toLowerCase()] || (g('mode') || '').trim() || undefined };
    const slew = (g('slew_s') || '').trim().toLowerCase(); if (slew === 'auto') { c.autoSlew = true; c.slew = 0; } else c.slew = num(slew);
    for (const [k, key] of [['roll', 'roll_deg'], ['pitch', 'pitch_deg'], ['yaw', 'yaw_deg'], ['tgtLat', 'target_lat_deg'], ['tgtLon', 'target_lon_deg'], ['tgtAlt', 'target_height_m'], ['tgtSlew', 'target_slew_s']]) c[k] = num(g(key));
    c.sunAxis = axis(g('sun_axis'), line); c.sunSecAxis = axis(g('sun_secondary_axis'), line); c.sunSec = (g('sun_secondary_toward') || '').trim().toLowerCase() || undefined;
    c.tgtComp = partId(g('pointing_part'), line);
    const qs = ['q_w', 'q_x', 'q_y', 'q_z'].map(k => num(g(k))); if (qs.every(Number.isFinite)) c.q = { w: qs[0], x: qs[1], y: qs[2], z: qs[3] };
    const ev = (g('event') || '').trim(); if (ev) c.on = { kind: ev, from: utc(g('event_from_utc')), offset: num(g('event_offset_s')) ?? 0, elev: num(g('event_elev_deg')), ref: (g('event_after') || '').trim() || undefined };
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k]; // empty cells: the scenario's own value
    return c;
  });
  return { changes: cleanSchedule(raws, base, null, report), report, rows: raws.length };
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
