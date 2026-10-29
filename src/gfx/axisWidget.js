/**
 * Corner axis widget (like a CAD view cube): a small triad that turns with the camera.
 * Click an axis end to look along it (the + end views from that side).
 */
import * as THREE from 'three';
import { gfx, viewPreset } from './renderer.js';
import { COL, makeTriad } from './primitives.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** @param view a mkView() view, @param labels axis names for X, Y, Z */
export function createAxisWidget(view, labels = ['X', 'Y', 'Z']) {
  const el = document.createElement('div'); el.className = 'axisw'; el.hidden = true;
  el.title = 'Click an axis to look along it'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'View axes');
  const tags = DIRS.map((d, i) => {
    const s = document.createElement('span'); const k = i >> 1, neg = i % 2;
    s.textContent = (neg ? '−' : '') + labels[k]; s.className = 'axisw-tag' + (neg ? ' neg' : ''); s.style.color = `var(--ax-${'xyz'[k]})`;
    el.append(s); return s;
  });
  gfx.vp.append(el);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  scene.add(makeTriad(0.8, 0.05, null));
  DIRS.filter((_, i) => i % 2).forEach((d, k) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...d).multiplyScalar(.6)]);
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: [COL.x, COL.y, COL.z][k], transparent: true, opacity: .45 })));
  });
  const tip = new THREE.Vector3(); let pts = [];

  function render() {
    if (el.hidden) return;
    const r = el.getBoundingClientRect(), vr = gfx.vp.getBoundingClientRect(), R = gfx.renderer;
    if (!r.width) return;
    cam.position.copy(view.camera.position).sub(view.controls.target).normalize().multiplyScalar(4.4);
    cam.up.copy(view.camera.up); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const x = r.left - vr.left, y = vr.height - (r.top - vr.top) - r.height;
    R.setViewport(x, y, r.width, r.height); R.setScissor(x, y, r.width, r.height); R.setScissorTest(true);
    R.autoClear = false; R.clearDepth(); R.render(scene, cam); R.autoClear = true; R.setScissorTest(false);
    // labels as DOM, positioned at the projected axis ends
    pts = DIRS.map((d, i) => {
      tip.set(...d).multiplyScalar(i % 2 ? .78 : 1.08).project(cam);
      const px = (tip.x + 1) / 2 * r.width, py = (1 - tip.y) / 2 * r.height;
      tags[i].style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
      tags[i].style.zIndex = tip.z < 0.99 ? String(Math.round((1 - tip.z) * 1000)) : '0';
      return [px, py];
    });
  }

  el.addEventListener('click', e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 22;
    pts.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    const d = DIRS[best].slice(), up = view.camera.up;
    if (Math.abs(d[0] * up.x + d[1] * up.y + d[2] * up.z) > .99) d[0] += 1e-4; // avoid looking exactly along "up"
    viewPreset(view, d);
  });

  return { render, show(v) { el.hidden = !v; } };
}
