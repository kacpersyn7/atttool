/**
 * Import component orientations (and optionally positions) by name, e.g. from an ICD,
 * a MATLAB script or AttTool's own Python / MATLAB export.
 *
 * Accepted input:
 *   JSON    { "STR-1": [[…],[…],[…]], "STR-2": { "q": [w,x,y,z], "pos": [x,y,z] } }
 *           [ { "name": "STR-1", "dcm": [[…]] }, … ]
 *           a full AttTool configuration ({ sc: { bus, comps } })
 *   text    NAME = [a b c; d e f; g h i];     (MATLAB, 9 numbers → DCM)
 *           NAME = [w x y z]                  (4 numbers → quaternion)
 *           NAME_pos = [x y z]                (3 numbers → position, m)
 *           NAME_C_CB = np.array([[…], …])    (NumPy, multi-line is fine)
 *           NAME_mass = 0.4                   (kg)
 *   table   the Layout table copied to Excel and back (tab-separated, header row "Part …"):
 *           position, mass and orientation. The table carries yaw-pitch-roll, quaternion and DCM;
 *           whichever of them was edited is used (if two were edited differently, that's an error).
 *           Decimal commas (e.g. Polish Excel) are accepted.
 * Name suffixes fix the meaning and override the dialog options: _C_CB / _dcm (C_C←SCF),
 * _C_BC / _C_SG (C_SCF←C), _q_BC (scalar-first, A(q) = C_C←SCF), _q, _pos_B / _pos, _mass.
 *
 * Names are matched like the exports write them (see codeName): case-insensitive, with
 * '+X' → '_pX', '−X' → '_mX' and other punctuation → '_', so "CSS-+X" matches CSS_pX.
 * Pure module: parse → plan (preview, nothing changed) → apply.
 */
import * as AM from '../core/attitude.js';
import { checkRotation, orthonormalize, parseMatrix3 } from '../core/matrixText.js';
import { TYPES, paramText } from './componentTypes.js';
import { compAxis } from './component.js';
import { busPose } from './bus.js';
import { nominalDirections } from './alignment.js';

const { m } = AM;

/** Identifier-safe version of a component name, as used by the Python / MATLAB exports. */
export function codeName(name) {
  return String(name)
    .replace(/[-−](?=[XYZxyz](?![A-Za-z0-9]))/g, '_m').replace(/\+(?=[XYZxyz](?![A-Za-z0-9]))/g, '_p')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}
const key = name => codeName(name).toLowerCase();

const SUFFIXES = [ // [suffix, field, direction, quaternion order]
  ['_c_cb', 'dcm', 'CS'], ['_c_bc', 'dcm', 'SC'], ['_c_sg', 'dcm', 'SC'], ['_dcm', 'dcm', null],
  ['_q_bc', 'q', 'CS', 'first'], ['_quat', 'q', null], ['_q', 'q', null],
  ['_pos_b', 'pos', null], ['_pos', 'pos', null], ['_mass', 'mass', null],
];
/** Names AttTool's own exports write that are not parts. */
const IGNORE = new Set(['c_sr_nominal', 'a_rw', 'j', 'com_b']);

/* ---------------- parsing ---------------- */

/** Split a raw name into { base, field, dir, order } using the suffix table. */
function splitName(raw) {
  const k = key(raw);
  const name = String(raw).trim();
  for (const [suf, field, dir, order] of SUFFIXES) if (k.endsWith(suf) && k.length > suf.length) return { base: k.slice(0, -suf.length), field, dir, order, display: name.slice(0, -suf.length) };
  return { base: k, field: null, dir: null, order: null, display: name };
}

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Text form: `name = [ … ]` / `name: [ … ]` / `name = np.array([…])`, any number of them. */
function parseText(text) {
  const out = [], head = /([A-Za-z_][\w.\-+−' ]*?)\s*[:=]\s*(?:np\.array\s*\(\s*)?\[/g;
  let mt;
  while ((mt = head.exec(text))) {
    let i = mt.index + mt[0].length - 1, depth = 0;
    for (; i < text.length; i++) { if (text[i] === '[') depth++; else if (text[i] === ']' && --depth === 0) break; }
    const body = text.slice(mt.index + mt[0].length - 1, i + 1);
    head.lastIndex = i + 1;
    const nums = (body.replace(/\.\.\./g, ' ').match(NUM) || []).map(Number);
    out.push({ raw: mt[1].trim().replace(/^['"]|['"]$/g, ''), nums });
  }
  // scalar masses: NAME_mass = 0.4
  const sc_ = /([A-Za-z_][\w.\-+−' ]*?_mass)\s*[:=]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?![\d.])/gi;
  while ((mt = sc_.exec(text))) out.push({ raw: mt[1].trim(), nums: [Number(mt[2])] });
  return out;
}

const isNumArr = (a, n) => Array.isArray(a) && a.flat().length === n && a.flat().every(Number.isFinite);
const to3x3 = a => { const f = a.flat(); return [f.slice(0, 3), f.slice(3, 6), f.slice(6, 9)]; };
const qArr = q => (Array.isArray(q) ? q.map(Number) : q && typeof q === 'object' ? { w: +q.w, x: +q.x, y: +q.y, z: +q.z } : null);

/** One JSON value (matrix / quaternion / position / object with fields) → partial entry. */
function fromValue(v) {
  if (typeof v === 'number') return { mass: v };
  if (isNumArr(v, 9)) return { dcm: to3x3(v) };
  if (isNumArr(v, 4)) return { q: v.flat().map(Number) };
  if (isNumArr(v, 3)) return { pos: v.flat().map(Number) };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const e = {};
    const D = v.dcm ?? v.C ?? v.C_CB ?? v.matrix; if (isNumArr(D, 9)) e.dcm = to3x3(D);
    if (isNumArr(v.C_BC, 9)) { e.dcm = to3x3(v.C_BC); e.dir = 'SC'; }
    const Q = v.q ?? v.quat ?? v.quaternion; if (Q) e.q = qArr(Q);
    if (isNumArr(v.pos, 3)) e.pos = v.pos.flat().map(Number);
    if (v.mass !== undefined) e.mass = Number(v.mass);
    return e;
  }
  return null;
}

/* ---------------- the Layout table, round-tripped through a spreadsheet ---------------- */

/** Number from a spreadsheet cell; accepts decimal commas and a Unicode minus. */
const cellNum = c => { const t = String(c ?? '').trim().replace(/\s/g, '').replace('−', '-'); return t === '' ? NaN : Number(/^-?\d*,\d+(e[-+]?\d+)?$/i.test(t) ? t.replace(',', '.') : t); };

/** Is this the tab-separated Layout table (header row starting with "Part")? */
export const isPartsTable = t => /^\uFEFF?"?part"?\t/i.test(String(t).trim());

function parseTable(t) {
  const lines = t.split(/\r?\n/).filter(l => l.trim());
  const head = lines[0].split('\t').map(h => h.replace(/^\uFEFF/, '').replace(/"/g, '').replace(/\s*\[.*?\]\s*$/, '').trim().toLowerCase());
  const col = name => head.indexOf(name);
  const ix = { part: col('part'), x: col('x'), y: col('y'), z: col('z'), mass: col('mass'), yaw: col('yaw'), pitch: col('pitch'), roll: col('roll'),
    q: ['q0', 'q1', 'q2', 'q3'].map(col), dcm: head.findIndex(h => h.startsWith('c_cb')),
    type: col('type'), axis: ['axis x', 'axis y', 'axis z'].map(col), params: col('parameters'),
    ang: ['angle to earth', 'angle to along-track', 'angle to orbit normal'].map(col) };
  const NUMCOLS = [['x', ix.x], ['y', ix.y], ['z', ix.z], ['Mass', ix.mass], ['Yaw', ix.yaw], ['Pitch', ix.pitch], ['Roll', ix.roll], ...ix.q.map((i, k) => ['q' + k, i])];
  const entries = [];
  for (const line of lines.slice(1)) {
    const c = line.split('\t'); const name = (c[ix.part] || '').replace(/^"|"$/g, '').trim(); if (!name) continue;
    const num = i => (i >= 0 ? cellNum(c[i]) : NaN);
    const e = { name, base: key(name), table: true, alts: {} };
    // cells that should be numbers but aren't (e.g. Excel turned "1.10" into a date)
    const bad = NUMCOLS.filter(([, i]) => i >= 0 && String(c[i] ?? '').trim() !== '' && !Number.isFinite(num(i))).map(([n]) => n);
    if (bad.length) { e.error = `${name}: can't read ${bad.join(', ')} as numbers (${bad.map(n => '"' + c[NUMCOLS.find(x => x[0] === n)[1]] + '"').slice(0, 2).join(', ')}). Excel may have turned them into dates or text; copy the table again with the "Decimal comma" option matching your Excel.`; entries.push(e); continue; }
    // display-only columns, to warn if they were edited
    e.ro = { type: ix.type >= 0 ? c[ix.type] : null, axis: ix.axis.map(num), params: ix.params >= 0 ? c[ix.params] : null, ang: ix.ang.map(num) };
    const pos = [ix.x, ix.y, ix.z].map(num); if (pos.every(Number.isFinite)) e.pos = pos;
    if (Number.isFinite(num(ix.mass))) e.mass = num(ix.mass);
    const ypr = [ix.yaw, ix.pitch, ix.roll].map(num); if (ypr.every(Number.isFinite)) e.alts.ypr = ypr;
    const q = ix.q.map(num); if (q.every(Number.isFinite)) e.alts.q = q;
    if (ix.dcm >= 0 && c[ix.dcm]) {
      let d = c[ix.dcm].replace(/^"|"$/g, ''); if (!d.includes('.') && /\d,\d/.test(d)) d = d.replace(/(\d),(\d)/g, '$1.$2');
      try { e.alts.dcm = parseMatrix3(d); } catch { /* ignore an unreadable DCM cell; the other columns still work */ }
    }
    if (!e.pos && e.mass === undefined && !Object.keys(e.alts).length) e.error = `${name}: no numbers found in this row`;
    entries.push(e);
  }
  return entries;
}

/**
 * Orientation from a table row: use whichever of yaw-pitch-roll / quaternion / DCM was edited.
 * Returns { C } (C_C←SCF, or null when nothing changed) or { error }.
 */
function tableOrientation(alts, oldC) {
  const ang = (A, B) => { const d = AM.C2q(m.mul(A, m.T(B))); return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w)) * AM.R2D; };
  const cands = [];
  if (alts.dcm) { const r = checkRotation(alts.dcm, 1e-5); if (!r.ok) return { error: r.det < 0 ? 'DCM column is a reflection (det −1)' : 'DCM column is not a rotation' }; cands.push({ k: 'DCM', C: orthonormalize(alts.dcm), tol: 1e-3 }); }
  if (alts.q) { const n = AM.q.norm({ w: alts.q[0], x: alts.q[1], y: alts.q[2], z: alts.q[3] }); if (!(n > 1e-9)) return { error: 'quaternion columns are zero' };
    cands.push({ k: 'quaternion', C: AM.q2C(AM.q.unit({ w: alts.q[0], x: alts.q[1], y: alts.q[2], z: alts.q[3] })), tol: 1e-3 }); }
  if (alts.ypr) cands.push({ k: 'yaw-pitch-roll', C: AM.euler2C('321', alts.ypr.map(x => x * AM.D2R)), tol: 0.02 }); // 2 decimals in the table
  const edited = cands.filter(c => ang(c.C, oldC) > c.tol);
  if (!edited.length) return { C: null };
  for (const a of edited) for (const b of edited) if (a !== b && ang(a.C, b.C) > Math.max(a.tol, b.tol)) return { error: `${edited.map(c => c.k).join(' and ')} columns were edited differently. Edit only one of them.` };
  return { C: edited[0].C, used: edited[0].k }; // DCM > quaternion > yaw-pitch-roll (most precise first)
}

/**
 * Parse pasted text / file contents into entries { name, base, dcm?, q?, pos?, dir?, order?, error? },
 * merged per part name. Quaternion objects {w,x,y,z} are unambiguous; arrays depend on `order`.
 */
export function parseOrientations(text) {
  const t = String(text).trim(); if (!t) return [];
  if (isPartsTable(t)) return parseTable(t);
  if (t.includes('\t') && !/[=:]\s*(?:np\.array\s*\(\s*)?\[/.test(t) && !/^[[{]/.test(t))
    return [{ name: '(table rows)', base: '', error: 'This looks like table rows without the header row. Copy the table including its first row (Part, Type, x …).' }];
  const raw = []; // { raw, field?, value, dir?, order? }
  let json = null;
  if (/^[[{]/.test(t)) { try { json = JSON.parse(t); } catch { json = null; } }
  if (json) {
    const sc = json.sc || (json.comps && json.bus ? json : null);
    if (sc) { // a full AttTool configuration: take its parts' orientations and positions
      if (sc.bus) raw.push({ raw: 'bus', value: { q: sc.bus.q, pos: sc.bus.pos }, dir: 'CS' });
      (sc.comps || []).forEach(c => raw.push({ raw: c.name, value: { q: c.q, pos: c.pos }, dir: 'CS' }));
    } else if (Array.isArray(json)) json.forEach(o => raw.push({ raw: o && (o.name ?? o.id), value: o }));
    else Object.entries(json).forEach(([n, v]) => raw.push({ raw: n, value: v }));
  } else {
    for (const { raw: n, nums } of parseText(t)) raw.push({ raw: n, nums });
  }
  const byBase = new Map();
  for (const r of raw) {
    if (r.raw == null || r.raw === '') continue;
    const s = splitName(r.raw);
    if (IGNORE.has(key(r.raw))) continue;
    const e = byBase.get(s.base) || { name: s.display, base: s.base }; byBase.set(s.base, e);
    if (s.field === null) e.name = s.display; // prefer the bare name for display
    let part;
    if (r.nums) {
      const n = r.nums.length;
      part = s.field === 'mass' ? (n === 1 ? { mass: r.nums[0] } : null)
        : s.field === 'pos' || (!s.field && n === 3) ? (n === 3 ? { pos: r.nums } : null)
        : s.field === 'q' || (!s.field && n === 4) ? (n === 4 ? { q: r.nums } : null)
          : n === 9 ? { dcm: to3x3(r.nums) } : null;
      if (!part) { e.error = s.field === 'mass' ? `${r.raw}: expected one number (kg)` : `${r.raw}: expected 9 (DCM), 4 (quaternion) or 3 (position) numbers, found ${n}`; continue; }
    } else {
      part = fromValue(r.value);
      if (part && s.field && part[s.field] === undefined) { // e.g. "STR_1_q": [ … ] given as a bare array
        const only = Object.values(part)[0]; part = { [s.field]: only };
      }
      if (part && s.field === 'mass' && typeof r.value === 'number') part = { mass: r.value };
      if (!part || !Object.keys(part).some(k => ['dcm', 'q', 'pos', 'mass'].includes(k))) { e.error = `${r.raw}: no DCM, quaternion, position or mass found`; continue; }
    }
    if (part.dcm) { e.dcm = part.dcm; e.dcmDir = part.dir || s.dir || r.dir || null; }
    if (part.q) { e.q = part.q; e.qDir = s.dir || r.dir || null; e.qOrder = s.order || null; }
    if (part.pos) e.pos = part.pos;
    if (part.mass !== undefined) e.mass = part.mass;
  }
  return [...byBase.values()];
}

/* ---------------- plan (preview) & apply ---------------- */

/**
 * Work out what an import would do, without changing anything.
 * @param sc spacecraft; @param entries from parseOrientations
 * @param opts { dir: 'CS' | 'SC' (matrices/quaternions given as C_C←SCF or C_SCF←C),
 *               order: 'first' | 'last' (array quaternions), fix: orthonormalise near-rotations }
 * Table rows (from the Layout table) always use C_C←SCF and scalar-first; the options don't apply.
 * @returns rows { name, target ('bus' | component id | null), label, q?, pos?, mass?, angle (deg), dPos (m), dMass (kg),
 *                 status: 'ok' | 'fixed' | 'same' | 'unmatched' | 'ambiguous' | 'error', msg }
 */
export function planImport(sc, entries, opts = {}) {
  const dir = opts.dir || 'CS', order = opts.order || 'first', fix = opts.fix !== false;
  const parts = [{ id: 'bus', name: 'Bus', obj: sc.bus, k: 'bus' }, ...sc.comps.map(c => ({ id: c.id, name: c.name, obj: c, k: key(c.name) }))];
  return entries.map(e => {
    const row = { name: e.name, target: null, label: '', angle: 0, dPos: 0, dMass: 0, status: 'ok', msg: '' };
    if (e.error) return { ...row, status: 'error', msg: e.error };
    const hits = parts.filter(p => p.k === e.base);
    const exact = hits.filter(p => p.name.toLowerCase() === String(e.name).toLowerCase());
    const hit = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
    if (!hit) return { ...row, status: hits.length ? 'ambiguous' : 'unmatched', msg: hits.length ? 'matches ' + hits.map(p => p.name).join(', ') : 'no part with this name' };
    row.target = hit.id; row.label = hit.name;
    const oldC = AM.q2C(hit.obj.q || AM.q.id());
    let C = null;
    if (e.alts) {
      const r = tableOrientation(e.alts, oldC);
      if (r.error) return { ...row, status: 'error', msg: r.error };
      C = r.C; if (r.used) row.msg = 'from the ' + r.used + ' column' + (r.used === 'yaw-pitch-roll' ? 's' : '');
    } else if (e.dcm) {
      let D = (e.dcmDir || dir) === 'SC' ? m.T(e.dcm) : e.dcm;
      const r = checkRotation(D, 1e-5); // files often carry 6 decimals
      if (r.ok) D = orthonormalize(D);
      else {
        if (r.fixable && fix) { D = orthonormalize(D); row.status = 'fixed'; row.msg = `orthonormalised (error ${r.err.toExponential(1)})`; }
        else return { ...row, status: 'error', msg: r.det < 0 ? 'matrix is a reflection (det −1)' : `not a rotation (error ${r.err.toExponential(1)})` };
      }
      C = D;
    } else if (e.q) {
      let q = Array.isArray(e.q) ? ((e.qOrder || order) === 'last' ? { x: e.q[0], y: e.q[1], z: e.q[2], w: e.q[3] } : { w: e.q[0], x: e.q[1], y: e.q[2], z: e.q[3] }) : e.q;
      const n = AM.q.norm(q);
      if (!Number.isFinite(n) || n < 1e-9) return { ...row, status: 'error', msg: 'quaternion has zero length' };
      if (Math.abs(n - 1) > 1e-6) { row.status = 'fixed'; row.msg = `renormalised (|q| = ${n.toFixed(4)})`; }
      q = AM.q.unit(q); if ((e.qDir || dir) === 'SC') q = AM.q.conj(q);
      C = AM.q2C(q);
    }
    if (C) {
      row.q = AM.C2q(C);
      const dq = AM.C2q(m.mul(C, m.T(oldC))); // rotation from old to new (robust for small angles)
      row.angle = 2 * Math.atan2(Math.hypot(dq.x, dq.y, dq.z), Math.abs(dq.w)) * AM.R2D;
    }
    if (e.pos) { row.pos = e.pos.slice(); row.dPos = AM.v.norm(AM.v.sub(e.pos, hit.obj.pos || [0, 0, 0])); }
    if (e.mass !== undefined) {
      if (!Number.isFinite(e.mass) || e.mass < 0) return { ...row, status: 'error', msg: 'mass must be a number ≥ 0 (kg)' };
      row.mass = e.mass; row.dMass = e.mass - (hit.obj.mass || 0);
    }
    if (e.ro) { // display-only columns of the Layout table: report edits, they are not imported
      const cur = currentDisplay(sc, hit), ign = [];
      const near = (a, b, tol) => a.every((x, i) => !Number.isFinite(x) || Math.abs(x - b[i]) <= tol);
      const norm = t => String(t ?? '').replace(/^"|"$/g, '').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim().toLowerCase();
      if (e.ro.type != null && norm(e.ro.type) !== norm(cur.type)) ign.push('Type');
      if (!near(e.ro.axis, cur.axis, 1e-3)) ign.push('Axis');
      if (e.ro.params != null && norm(e.ro.params) !== norm(cur.params)) ign.push('Parameters');
      if (!near(e.ro.ang, cur.ang, 0.06)) ign.push('Angle');
      if (ign.length) row.ignored = ign;
    }
    if (e.table) { // a spreadsheet round trip: write back only what was actually edited
      if (row.pos && row.dPos < 1e-6) { delete row.pos; row.dPos = 0; }
      if (row.mass !== undefined && Math.abs(row.dMass) < 1e-9) { delete row.mass; row.dMass = 0; }
    }
    if (row.ignored) {
      const note = `${row.ignored.join(', ')} column${row.ignored.length > 1 ? 's are' : ' is'} display-only; change ${row.ignored.length > 1 ? 'them' : 'it'} in the part editor`;
      row.msg = row.msg ? row.msg + '; ' + note : note;
    }
    if (!row.q && !row.pos && row.mass === undefined) return { ...row, status: e.table ? (row.ignored ? 'ignored' : 'same') : 'error', msg: e.table ? row.msg : 'nothing to import' };
    if (row.status === 'ok' && row.angle < 1e-4 && row.dPos < 1e-6 && Math.abs(row.dMass) < 1e-9) row.status = row.ignored ? 'ignored' : 'same'; // below file precision
    return row;
  });
}

/** What the Layout table shows in its display-only columns for a part (to detect edits to them). */
function currentDisplay(sc, hit) {
  const d = nominalDirections(sc.align);
  const axis = hit.id === 'bus' ? AM.m.col(busPose(sc).C, 2) : compAxis(hit.obj);
  const ang = [d.nadir, d.alongTrack, d.normal].map(u => AM.v.angle(axis, u) * AM.R2D);
  if (hit.id === 'bus') { const b = sc.bus; return { type: 'Bus structure', axis, params: `${b.x} × ${b.y} × ${b.z} m`, ang }; }
  return { type: TYPES[hit.obj.type].label, axis, params: paramText(hit.obj), ang };
}

/** Apply the rows of a plan that have something to change. Mutates sc; returns how many parts changed. */
export function applyImport(sc, rows) {
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'ok' && r.status !== 'fixed') continue;
    const obj = r.target === 'bus' ? sc.bus : sc.comps.find(c => c.id === r.target); if (!obj) continue;
    if (r.q) obj.q = r.q;
    if (r.pos) obj.pos = r.pos.slice();
    if (r.mass !== undefined) obj.mass = r.mass;
    delete obj.eul; n++;
  }
  return n;
}
