/** 3D model of the spacecraft (bus + components + optional FOV cones, labels, triad). */
import * as THREE from 'three';
import * as AM from '../core/attitude.js';
import { TYPES } from '../spacecraft/componentTypes.js';
import { Arrow, COL, coneGeom, makeLabel, makeTriad } from './primitives.js';

export function std(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.25 }, o)); }

/** Mesh for one component in its own frame (+Z = boresight / spin / dipole / normal). */
export function compMesh(c) {
  const g = new THREE.Group(); const T = TYPES[c.type]; const col = T.color;
  const cyl = (r1, r2, hgt, mat, z = 0, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, hgt, seg), mat); m.rotation.x = Math.PI / 2; m.position.z = z; g.add(m); return m; };
  const box = (x, y, z, mat, pz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat); m.position.z = pz; g.add(m); return m; };
  switch (c.type) {
    case 'payload': cyl(0.13, 0.13, 0.22, std(col, { metalness: .5 }), 0); cyl(0.14, 0.15, 0.06, std('#1b2230'), 0.13); cyl(0.1, 0.1, 0.01, std('#0b2a4a', { metalness: .9, roughness: .1 }), 0.165); break;
    case 'str': box(0.09, 0.09, 0.06, std('#3a4458')); cyl(0.04, 0.065, 0.12, std(col, { metalness: .6 }), 0.09); cyl(0.03, 0.03, 0.005, std('#081626', { metalness: 1, roughness: .05 }), 0.04); break;
    case 'css': box(0.05, 0.05, 0.015, std('#3a4458')); cyl(0.012, 0.012, 0.008, std(col, { emissive: col, emissiveIntensity: .3 }), 0.01); break;
    case 'mtq': cyl(0.022, 0.022, c.len || 0.36, std(col, { metalness: .7, roughness: .35 }), 0); cyl(0.03, 0.03, 0.03, std('#333a46'), (c.len || 0.36) / 2); cyl(0.03, 0.03, 0.03, std('#333a46'), -(c.len || 0.36) / 2); break;
    case 'rw': cyl(0.09, 0.09, 0.07, std(col, { metalness: .6 })); cyl(0.05, 0.05, 0.075, std('#2b3240'), 0); { const a = new Arrow(0xc8d2e0, 0.14, 0.006); a.setDir([0, 0, 1]); a.position.z = 0.035; g.add(a); } break;
    case 'mag': box(0.06, 0.04, 0.03, std(col)); break;
    case 'gyro': box(0.12, 0.12, 0.09, std(col, { metalness: .4 })); break;
    case 'gnss': cyl(0.06, 0.06, 0.02, std(col)); cyl(0.04, 0.04, 0.02, std('#d6b13e'), 0.01); break;
    case 'ant': box(0.12, 0.12, 0.02, std(col)); for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.004), std('#c2953a', { metalness: .9 })); m.position.set((i % 2 - .5) * .05, (Math.floor(i / 2) - .5) * .05, 0.012); g.add(m); } break;
    case 'thr': { const m = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 16, 1, true), std(col, { side: THREE.DoubleSide, metalness: .8 })); m.rotation.x = -Math.PI / 2; m.position.z = 0.035; g.add(m); cyl(0.015, 0.015, 0.05, std('#4a5160'), -0.02); break; }
    case 'sa': {
      const w = c.w || 1, hh = c.h || 0.7;
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 180; const x = cv.getContext('2d');
      x.fillStyle = '#16264a'; x.fillRect(0, 0, 256, 180); x.strokeStyle = '#3b5d9e'; x.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 180); x.stroke(); } for (let j = 0; j <= 6; j++) { x.beginPath(); x.moveTo(0, j * 30); x.lineTo(256, j * 30); x.stroke(); }
      const tex = new THREE.CanvasTexture(cv);
      const front = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.02), [std('#9aa3b2'), std('#9aa3b2'), std('#9aa3b2'), std('#9aa3b2'), std('#ffffff', { map: tex, metalness: .3, roughness: .35 }), std('#c9ccd3', { metalness: .1 })]);
      g.add(front); break;
    }
  }
  g.traverse(o => { if (o.isMesh) o.userData.compId = c.id; });
  return g;
}

/**
 * Build the whole spacecraft. Body frame = group frame (origin at bus centre).
 * @param {object} [opts] cones, excl, labels, dipoles, busOpacity, triad, triadLen, triadR, labelScale
 * @returns THREE.Group with .compGroups[id] and optional .triad
 */
export function buildSC(sc, opts = {}) {
  const root = new THREE.Group();
  const { x, y, z } = sc.bus;
  const busOp = opts.busOpacity ?? 1;
  const busMat = std('#c99a3e', { metalness: .55, roughness: .45, transparent: busOp < 1, opacity: busOp, depthWrite: busOp >= 1 });
  const bus = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), busMat); bus.userData.isBus = true; root.add(bus);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bus.geometry), new THREE.LineBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.55 })); root.add(edges);
  // nadir face panel (darker) to make +Z face recognisable
  const fp = new THREE.Mesh(new THREE.PlaneGeometry(x * 0.96, y * 0.96), std('#2a2f38', { side: THREE.DoubleSide, transparent: busOp < 1, opacity: Math.min(1, busOp + .2) })); fp.position.z = z / 2 + 0.002; root.add(fp);
  root.compGroups = {};
  for (const c of sc.comps) {
    const g = compMesh(c); g.position.set(...c.pos); g.quaternion.set(c.q.x, c.q.y, c.q.z, c.q.w); g.userData.compId = c.id;
    if (opts.cones && c.fov && TYPES[c.type].cone) {
      const L = c.type === 'payload' ? 1.6 : c.type === 'str' ? 0.9 : 0.35;
      const col = new THREE.Color(TYPES[c.type].color);
      const cm = new THREE.Mesh(coneGeom(c.fov / 2, L), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: c.type === 'css' || c.type === 'gnss' ? 0.07 : 0.16, side: THREE.DoubleSide, depthWrite: false }));
      cm.userData.noPick = true; cm.userData.isCone = true; g.add(cm);
      const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, k) => { const a = k / 48 * Math.PI * 2, R = L * Math.tan(Math.min(89, c.fov / 2) * AM.D2R); return new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), L); })), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .5 }));
      rim.userData.isCone = true; g.add(rim);
      if (opts.excl && c.type === 'str') {
        const ex = new THREE.Mesh(coneGeom(c.sunExcl, 0.7, 32), new THREE.MeshBasicMaterial({ color: COL.sun, wireframe: true, transparent: true, opacity: .25 })); ex.userData.noPick = true; ex.userData.isCone = true; g.add(ex);
      }
    }
    if (c.type === 'mtq' && opts.dipoles) { const a = new Arrow(0xff9b5e, (c.len || .36) / 2 + 0.12, 0.007); a.setDir([0, 0, 1]); g.add(a); }
    if (opts.labels) { const l = makeLabel(c.name, '#' + new THREE.Color(TYPES[c.type].color).getHexString(), 22, { scale: opts.labelScale || 0.85, weight: 500 }); l.position.set(0, 0, 0.02); g.add(l); g.userData.label = l; }
    root.add(g); root.compGroups[c.id] = g;
  }
  if (opts.triad) { const t = makeTriad(opts.triadLen || 1, opts.triadR || 0.012, ['X_B', 'Y_B', 'Z_B'], { labelScale: opts.labelScale }); root.add(t); root.triad = t; }
  return root;
}
