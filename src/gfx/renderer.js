/**
 * The single WebGL renderer shared by all workspaces, plus the "view" factory
 * (scene + camera + orbit controls). Each workspace owns one view; only the active one renders.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { V3 } from './primitives.js';

/** Shared graphics context, filled by initRenderer(). */
export const gfx = { renderer: null, vp: null };
export const BG = new THREE.Color(0x0a1018);

/** Create the renderer and attach its canvas to the viewport element. */
export function initRenderer(vp) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = 'main'; renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D view. Drag to orbit, scroll to zoom, right-drag to pan.');
  vp.prepend(renderer.domElement);
  gfx.renderer = renderer; gfx.vp = vp;
  return renderer;
}

/** Viewport size in CSS px. */
export function sizeOf() { const r = gfx.vp.getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; }

/** Scene + perspective camera + damped OrbitControls (disabled until the view is active). */
export function mkView({ up = [0, 0, 1], pos, target = [0, 0, 0], fov = 40, near = 0.01, far = 200 }) {
  const scene = new THREE.Scene(); scene.background = BG;
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far); camera.up.set(...up); camera.position.set(...pos);
  const controls = new OrbitControls(camera, gfx.renderer.domElement);
  controls.target.set(...target); controls.enableDamping = true; controls.dampingFactor = 0.12; controls.enabled = false; controls.update();
  return { scene, camera, controls };
}

/** Render a view full-viewport. */
export function renderFull(view) {
  const { w, h } = sizeOf(); const r = gfx.renderer;
  r.setScissorTest(false); r.setViewport(0, 0, w, h); r.render(view.scene, view.camera);
}

/** Hemisphere + key + fill light rig for "studio" scenes. */
export function addLights(scene, k = 1) {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2230, 0.75 * k));
  const d = new THREE.DirectionalLight(0xffffff, 0.9 * k); d.position.set(3, -2, 4); scene.add(d);
  const d2 = new THREE.DirectionalLight(0x9fb4ff, 0.35 * k); d2.position.set(-3, 3, -2); scene.add(d2);
}

/** Move the camera to look at the target from direction `dir` at distance `dist`. */
export function viewPreset(view, dir, dist) {
  const t = view.controls.target; const d = V3(dir).normalize().multiplyScalar(dist || view.camera.position.distanceTo(t));
  view.camera.position.copy(t).add(d); view.controls.update();
}
