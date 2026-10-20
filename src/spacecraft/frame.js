/**
 * Spacecraft frame (SCF) — the frame all component positions and orientations are given in.
 *
 * Two frames are involved:
 *   G   bus geometry frame: origin at the bus centre, axes along the box edges. Only the bus box
 *       itself is defined in G (sc.bus = {x, y, z, mass}).
 *   SCF the spacecraft frame = the attitude body frame B. Its origin is a point given in G
 *       (e.g. the centre of the launcher-interface face) and its axes are bus axes, possibly
 *       permuted / flipped: sc.frame = { origin: [x, y, z] (m, in G), xAxis: '+X', zAxis: '+Z' }.
 *
 *   v_S = C_SG · v_G            (C_SG rows = SCF axes written in G)
 *   p_S = C_SG · (p_G − origin)
 *
 * Because attitude, guidance and sensors all work in B = SCF, the SCF axes also decide how the
 * bus flies: e.g. offsets mode with zero offsets aligns SCF with the chosen orbital frame.
 */
import * as AM from '../core/attitude.js';

const { v, m } = AM;

export const AXIS_SPECS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

/** Unit vector of a bus axis spec such as '-Z'. */
export function axisVec(spec) {
  const k = 'XYZ'.indexOf(spec[1]); const a = [0, 0, 0]; a[k] = spec[0] === '-' ? -1 : 1; return a;
}

export function defaultFrame() { return { origin: [0, 0, 0], xAxis: '+X', zAxis: '+Z' }; }

/** Validate a frame from untrusted input (JSON import); returns a clean copy or throws. */
export function checkFrame(f) {
  if (!f) return defaultFrame();
  const ok = Array.isArray(f.origin) && f.origin.length === 3 && f.origin.every(Number.isFinite)
    && AXIS_SPECS.includes(f.xAxis) && AXIS_SPECS.includes(f.zAxis) && validAxes(f.xAxis, f.zAxis);
  if (!ok) throw new Error('Invalid "frame": expected { origin: [x, y, z], xAxis: "+X", zAxis: "+Z" } with perpendicular axes.');
  return { origin: f.origin.slice(), xAxis: f.xAxis, zAxis: f.zAxis };
}

/** True if the frame's X and Z axes are perpendicular (a valid right-handed set can be built). */
export function validAxes(xAxis, zAxis) { return xAxis[1] !== zAxis[1]; }

/** C_SG for a frame: rows = SCF axes in bus axes. Y completes the right-handed set (Y = Z × X). */
export function frameMatrix(frame) {
  const x = axisVec(frame.xAxis), z = axisVec(frame.zAxis);
  return m.fromRows(x, v.cross(z, x), z);
}

/** Which bus axis (spec) a given SCF axis row points along, e.g. Y_SCF -> '-Y'. */
export function specOf(vec) { const k = vec.findIndex(a => Math.abs(a) > .5); return (vec[k] < 0 ? '-' : '+') + 'XYZ'[k]; }

/** Where the bus box sits in SCF: centre position and rotation C_SG. */
export function busPose(sc) {
  const f = sc.frame || defaultFrame(); const C = frameMatrix(f);
  return { pos: m.mulv(C, v.scale(f.origin, -1)), C };
}

/** Convert a point / direction given in bus geometry G into SCF. */
export function pointG2S(frame, p) { return m.mulv(frameMatrix(frame), v.sub(p, frame.origin)); }
export function dirG2S(frame, d) { return m.mulv(frameMatrix(frame), d); }

/**
 * Change the spacecraft frame while keeping every component physically where it is:
 * positions and orientations are re-expressed in the new SCF. Mutates and returns `sc`.
 */
export function setFrame(sc, next) {
  const prev = sc.frame || defaultFrame();
  const C1 = frameMatrix(prev), C2 = frameMatrix(next);
  const R = m.mul(C2, m.T(C1)); // C_S2,S1
  for (const c of sc.comps) {
    const pG = v.add(m.mulv(m.T(C1), c.pos), prev.origin);
    c.pos = m.mulv(C2, v.sub(pG, next.origin)).map(x => +x.toFixed(6));
    // q2C(c.q) = C_C,S  ->  C_C,S2 = C_C,S1 · C_S1,S2
    c.q = AM.C2q(m.mul(AM.q2C(c.q), m.T(R)));
    delete c.eul;
  }
  sc.frame = { origin: next.origin.slice(), xAxis: next.xAxis, zAxis: next.zAxis };
  return sc;
}

/** Candidate SCF origins (in G): bus centre and the centre of each face. */
export function originPresets(bus) {
  const h = [bus.x / 2, bus.y / 2, bus.z / 2];
  const out = [['centre', 'Bus centre', [0, 0, 0]]];
  AXIS_SPECS.forEach(s => { const a = axisVec(s); out.push(['face' + s, s.replace('-', '−') + ' face centre', a.map((x, k) => x * h[k])]); });
  return out;
}

/**
 * SCF axis choices that make SCF coincide with an orbital frame in nominal flight, assuming the
 * example convention: bus +Z (payload face) to nadir and bus +X along velocity (i.e. bus axes = VVLH).
 */
export const NOMINAL_AXES = {
  vvlh: { xAxis: '+X', zAxis: '+Z' },   // X velocity, Z nadir
  lvlh: { xAxis: '-Z', zAxis: '-Y' },   // X radial out (zenith), Z orbit normal (= −Y_VVLH)
  vnc: { xAxis: '+X', zAxis: '-Z' },    // X velocity, Y orbit normal, Z = X × Y
};
