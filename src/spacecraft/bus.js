/**
 * The bus (structure box) as a part of the spacecraft model.
 *
 * Everything is built in the spacecraft frame SCF (= body frame B), like a CAD model. The bus is
 * placed in it like any component: sc.bus = { x, y, z, mass, pos, q }, where pos is the box
 * centre in SCF (m) and q is its orientation with q2C(q) = C_G←SCF (G = box-edge axes).
 */
import * as AM from '../core/attitude.js';

const { v, m } = AM;

/** Bus pose: centre in SCF and C_SG (v_SCF = C_SG · v_G, columns = box axes in SCF). */
export function busPose(sc) {
  const b = sc.bus;
  return { pos: (b.pos || [0, 0, 0]).slice(), C: m.T(AM.q2C(b.q || AM.q.id())) };
}

/** Fill in / validate bus pose fields (old saves have none). Mutates and returns the bus. */
export function normalizeBus(b) {
  if (!Array.isArray(b.pos) || b.pos.length !== 3 || !b.pos.every(Number.isFinite)) b.pos = [0, 0, 0];
  const q = b.q;
  b.q = q && [q.w, q.x, q.y, q.z].every(Number.isFinite) && AM.q.norm(q) > 1e-9 ? AM.q.unit(q) : AM.q.id();
  return b;
}

/** A point / direction given on the bus box (G, relative to its centre) expressed in SCF. */
export function busPointToSCF(sc, pG) { const p = busPose(sc); return v.add(p.pos, m.mulv(p.C, pG)); }
export function busDirToSCF(sc, dG) { return m.mulv(busPose(sc).C, dG); }

/**
 * Convert a layout saved by the v0.4 preview (sc.frame = { origin, xAxis, zAxis }, components
 * already in SCF) into a bus pose. Removes sc.frame. No-op without it.
 */
export function convertLegacyFrame(sc) {
  const f = sc.frame; if (!f) return sc;
  const ax = s => { const a = [0, 0, 0]; a['XYZ'.indexOf(s[1])] = s[0] === '-' ? -1 : 1; return a; };
  const x = ax(f.xAxis || '+X'), z = ax(f.zAxis || '+Z');
  const C_SG = m.fromRows(x, v.cross(z, x), z);
  sc.bus.pos = m.mulv(C_SG, v.scale(f.origin || [0, 0, 0], -1));
  sc.bus.q = AM.C2q(m.T(C_SG));
  delete sc.frame;
  return sc;
}
