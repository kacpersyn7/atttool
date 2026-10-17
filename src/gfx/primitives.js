/** three.js building blocks: arrows, triads, labels, cones, DCM <-> Object3D. */
import * as THREE from 'three';
import * as AM from '../core/attitude.js';

/** Palette shared with CSS variables in styles.css. */
export const COL = { x: 0xff6161, y: 0x46d38a, z: 0x4f8cff, sun: 0xf2a93b, eig: 0xc48bff, probe: 0xff7bd5, cyan: 0x4fd6e8, teal: 0x57c7b8, muted: 0x8697ae };

export function V3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }

/** THREE.Matrix4 whose rotation part = CRB (columns = body axes in ref). */
export function matFromC(CRB) {
  const M = new THREE.Matrix4();
  M.set(CRB[0][0], CRB[0][1], CRB[0][2], 0, CRB[1][0], CRB[1][1], CRB[1][2], 0, CRB[2][0], CRB[2][1], CRB[2][2], 0, 0, 0, 0, 1);
  return M;
}
/** Orient an Object3D so its local axes are the body axes of C_BR, drawn in the reference (parent) frame. */
export function setObjFromCBR(obj, CBR) { obj.quaternion.setFromRotationMatrix(matFromC(AM.m.T(CBR))); }

/** Screen-space text sprite (constant pixel size). */
export function makeLabel(text, color = '#d9e2ee', px = 26, opts = {}) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const font = `${opts.weight || 600} ${px}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.font = font; const w = Math.ceil(ctx.measureText(text).width) + 16, hh = px + 12;
  c.width = w; c.height = hh; ctx.font = font; ctx.textBaseline = 'middle';
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, hh, 6) : ctx.rect(0, 0, w, hh); ctx.fill(); }
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(8,12,18,.9)'; ctx.strokeText(text, 8, hh / 2 + 1);
  ctx.fillStyle = color; ctx.fillText(text, 8, hh / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  const k = (opts.scale || 1) * 0.00062; sp.scale.set(w * k, hh * k, 1); sp.renderOrder = 999; sp.center.set(0, 0.5); sp.userData.base = [w * k, hh * k];
  return sp;
}

/** Solid arrow along local +Y, re-pointable with setDir() and resizable with setLength(). */
export class Arrow extends THREE.Group {
  constructor(color, len = 1, r = 0.012, opts = {}) {
    super();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: !!opts.opacity, opacity: opts.opacity ?? 1, depthWrite: !opts.opacity });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), mat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(r * 3, r * 9, 14), mat);
    this.add(this.shaft, this.head); this.r = r; this.mat = mat;
    if (opts.label) { this.label = makeLabel(opts.label, opts.labelColor || '#' + new THREE.Color(color).getHexString(), 26, opts); this.add(this.label); }
    this.setLength(len); this.dir = new THREE.Vector3(0, 1, 0);
  }
  setLength(L) {
    const hl = Math.min(this.r * 9, L * 0.4);
    this.shaft.scale.y = Math.max(1e-4, L - hl); this.shaft.position.y = (L - hl) / 2;
    this.head.scale.setScalar(hl / (this.r * 9)); this.head.position.y = L - hl / 2;
    if (this.label) this.label.position.y = L + this.r * 4;
    this.L = L; return this;
  }
  setDir(d) { const v = (d.isVector3 ? d.clone() : V3(d)).normalize(); this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); return this; }
}

/** RGB = XYZ axis triad. `names` = 3 labels or null. */
export function makeTriad(len, r, names, opts = {}) {
  const g = new THREE.Group(); const cols = [COL.x, COL.y, COL.z]; const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  g.arrows = dirs.map((d, i) => { const a = new Arrow(cols[i], len, r, { label: names ? names[i] : null, opacity: opts.opacity, scale: opts.labelScale }); a.setDir(d); g.add(a); return a; });
  return g;
}

export function dashedLine(points, color, dash = 0.05, gap = 0.04, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(points.map(p => p.isVector3 ? p : V3(p)));
  const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, transparent: opacity < 1, opacity }));
  l.computeLineDistances(); return l;
}

/** Open cone with apex at origin, opening along +Z, given half-angle (deg) and length. */
export function coneGeom(halfAngleDeg, L, seg = 40) {
  const ha = Math.min(89, halfAngleDeg) * AM.D2R; const R = L * Math.tan(ha);
  const g = new THREE.ConeGeometry(R, L, seg, 1, true); g.translate(0, -L / 2, 0); g.rotateX(-Math.PI / 2); return g;
}

const _ws = new THREE.Vector3();
/** Undo parent scaling on label sprites so they keep a constant on-screen size. */
export function fixLabels(root) { root.traverse(o => { if (o.isSprite && o.userData.base && o.parent) { o.parent.getWorldScale(_ws); const s = _ws.x || 1; o.scale.set(o.userData.base[0] / s, o.userData.base[1] / s, 1); } }); }

/** Free GPU resources of a subtree. */
export function disposeTree(o) { o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }
