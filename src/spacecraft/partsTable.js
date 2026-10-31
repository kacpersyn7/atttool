/**
 * Data for the Layout "Table" view: one row per part (bus first) with position, axis,
 * yaw-pitch-roll, mass, type parameters and angles to Earth / along-track / orbit normal in
 * nominal flight; plus layout warnings and a tab-separated export. Pure (no DOM).
 */
import * as AM from '../core/attitude.js';
import { formatMatlab } from '../core/matrixText.js';
import { TYPES, axisName } from './componentTypes.js';
import { compAxis } from './component.js';
import { busPose } from './bus.js';
import { nominalDirections } from './alignment.js';
import { codeName } from './orientationImport.js';

const angleDeg = (a, b) => AM.v.angle(a, b) * AM.R2D;

/** Type-specific parameters as short text, e.g. "FOV 20° · Sun excl. 30° · Earth excl. 20°". */
export function paramText(c) {
  const p = [];
  if (c.fov !== undefined) p.push(`FOV ${+c.fov.toFixed(1)}°`);
  if (c.type === 'str') p.push(`Sun excl. ${c.sunExcl}°`, `Earth excl. ${c.earthExcl}°`);
  if (c.type === 'mtq') p.push(`${c.dipole} A·m²`, `L ${c.len} m`);
  if (c.type === 'rw') p.push(`H ${c.hmax} N·m·s`);
  if (c.type === 'sa') p.push(`${c.w} × ${c.h} m`);
  return p.join(' · ');
}

/** Rows for the table. Angles are between the part's +Z axis and each nominal-flight direction. */
export function partRows(sc) {
  const d = nominalDirections(sc.align);
  const row = (id, name, type, typeLabel, axisLabel, pos, q, axis, mass, params) => {
    const C = AM.q2C(q);
    return {
      id, name, type, typeLabel, axisLabel, pos: pos.slice(), q: { ...q }, C, axis, mass, params,
      ypr: AM.C2euler('321', C).map(x => x * AM.R2D),
      toEarth: angleDeg(axis, d.nadir), toAlong: angleDeg(axis, d.alongTrack), toNormal: angleDeg(axis, d.normal),
    };
  };
  const b = sc.bus, bp = busPose(sc);
  const rows = [row('bus', 'Bus', 'bus', 'Bus structure', 'box +Z', bp.pos, b.q || AM.q.id(), AM.m.col(bp.C, 2), b.mass,
    `${b.x} × ${b.y} × ${b.z} m`)];
  for (const c of sc.comps) rows.push(row(c.id, c.name, c.type, TYPES[c.type].label, axisName(c.type), c.pos, c.q, compAxis(c), c.mass || 0, paramText(c)));
  return rows;
}

/** Things worth a second look: { level: 'warn' | 'info', text, ids }. */
export function layoutWarnings(sc) {
  const out = [], comps = sc.comps;
  const groups = (keyFn) => { const m_ = new Map(); comps.forEach(c => { const k = keyFn(c); m_.set(k, [...(m_.get(k) || []), c]); }); return [...m_.values()].filter(g => g.length > 1); };
  groups(c => c.name.trim().toLowerCase()).forEach(g => out.push({ level: 'warn', text: `Duplicate name "${g[0].name}" (${g.length} parts): imports by name can't tell them apart.`, ids: g.map(c => c.id) }));
  groups(c => codeName(c.name).toLowerCase()).filter(g => new Set(g.map(c => c.name.trim().toLowerCase())).size > 1)
    .forEach(g => out.push({ level: 'warn', text: `${g.map(c => `"${c.name}"`).join(' and ')} get the same export name ${codeName(g[0].name)}.`, ids: g.map(c => c.id) }));
  groups(c => c.pos.map(x => Math.round(x * 1000)).join()).forEach(g => out.push({ level: 'info', text: `${g.map(c => c.name).join(', ')} sit at the same position.`, ids: g.map(c => c.id) }));
  comps.filter(c => !(c.mass > 0)).forEach(c => out.push({ level: 'info', text: `${c.name} has no mass.`, ids: [c.id] }));
  return out;
}

/** Tab-separated table (paste into a spreadsheet). */
export function rowsToTSV(rows) {
  const f = (x, n) => (+x).toFixed(n);
  const head = ['Part', 'Type', 'x [m]', 'y [m]', 'z [m]', 'Axis', 'Axis x', 'Axis y', 'Axis z', 'Yaw [deg]', 'Pitch [deg]', 'Roll [deg]', 'Mass [kg]', 'Parameters',
    'Angle to Earth [deg]', 'Angle to along-track [deg]', 'Angle to orbit normal [deg]', 'q0', 'q1', 'q2', 'q3', 'C_CB (MATLAB)'];
  const lines = rows.map(r => [r.name, r.typeLabel, ...r.pos.map(x => f(x, 4)), r.axisLabel, ...r.axis.map(x => f(x, 4)), ...r.ypr.map(x => f(x, 2)), f(r.mass, 3), r.params,
    f(r.toEarth, 1), f(r.toAlong, 1), f(r.toNormal, 1), f(r.q.w, 6), f(r.q.x, 6), f(r.q.y, 6), f(r.q.z, 6), formatMatlab(r.C, 6)].join('\t'));
  return [head.join('\t'), ...lines].join('\n');
}
