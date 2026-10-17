/**
 * Picture-in-picture "body frame" view for the Orbit workspace: the spacecraft stays fixed and
 * the Sun, Earth, B-field and velocity move around it — what the on-board sensors see.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as AM from '../../core/attitude.js';
import * as ENV from '../../env/index.js';
import { S, scVersion } from '../../state/store.js';
import { gfx } from '../../gfx/renderer.js';
import { COL, V3, Arrow, makeTriad, makeLabel, setObjFromCBR, disposeTree } from '../../gfx/primitives.js';
import { earthGeometry, glowSprite } from '../../gfx/earth.js';
import { buildSC } from '../../gfx/spacecraftMesh.js';

export function createBodyInset(insetEl, earthMap) {
  const I = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(42, 1, 0.01, 200) };
  I.scene.background = new THREE.Color(0x070c13);
  I.camera.up.set(0, 0, -1); I.camera.position.set(2.6, -2.2, -1.4);
  I.controls = new OrbitControls(I.camera, insetEl); I.controls.enableDamping = true; I.controls.enablePan = false; I.controls.minDistance = 1.2; I.controls.maxDistance = 6;
  I.scene.add(new THREE.AmbientLight(0x8090a8, 0.45));
  const iSun = new THREE.DirectionalLight(0xfff3dc, 1.1); I.scene.add(iSun); I.scene.add(iSun.target);
  I.scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x101820, .35));
  const iEarth = new THREE.Mesh(earthGeometry(1, 48, 96), new THREE.MeshPhongMaterial({ map: earthMap, shininess: 5 })); I.scene.add(iEarth);
  let iModel = null, iVer = -1;
  const iTriad = makeTriad(1.05, 0.012, ['X_B', 'Y_B', 'Z_B']); I.scene.add(iTriad);
  const iSunA = new Arrow(COL.sun, 1.5, 0.014, { label: 'Sun' }); I.scene.add(iSunA);
  const iSunGlow = glowSprite('#ffd27a', 0.9); I.scene.add(iSunGlow);
  const iB = new Arrow(COL.teal, 1.35, 0.014, { label: 'B' }); I.scene.add(iB);
  const iV = new Arrow(COL.cyan, 1.2, 0.01, { label: 'v' }); I.scene.add(iV);
  const iPlane = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ color: COL.teal, transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false })); I.scene.add(iPlane);
  const iPlaneRim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, k) => new THREE.Vector3(Math.cos(k / 48 * 6.283) * .95, Math.sin(k / 48 * 6.283) * .95, 0))), new THREE.LineBasicMaterial({ color: COL.teal, transparent: true, opacity: .45 })); iPlane.add(iPlaneRim);
  const iPlaneLbl = makeLabel('MTQ torque plane ⊥ B', '#57c7b8', 20, { scale: .75 }); iPlaneLbl.position.set(.95, 0, 0); iPlane.add(iPlaneLbl);

  /** Update for attitude A (attitudeAt result), B-field BI (ECI, nT) and GMST gm (rad). */
  function update(A, BI, gm) {
    if (iVer !== scVersion()) { if (iModel) { I.scene.remove(iModel); disposeTree(iModel); } const b = S.sc.bus; iModel = buildSC(S.sc, { cones: true, excl: true }); iModel.scale.setScalar(0.9 / Math.max(b.x, b.y, b.z)); I.scene.add(iModel); iVer = scVersion(); }
    const sunB = AM.m.mulv(A.CBI, A.sun), nadB = AM.m.mulv(A.CBI, AM.v.unit(AM.v.scale(A.st.r, -1))), vB = AM.m.mulv(A.CBI, A.st.v), BB = AM.m.mulv(A.CBI, BI);
    // Earth drawn at distance Dn with the correct apparent angular radius
    const rho = Math.asin(ENV.RE / AM.v.norm(A.st.r)); const Dn = 5; iEarth.scale.setScalar(Dn * Math.sin(rho)); iEarth.position.set(...AM.v.scale(nadB, Dn));
    setObjFromCBR(iEarth, AM.m.T(AM.m.mul(A.CBI, AM.Ra(3, gm))));
    iSun.position.set(...AM.v.scale(sunB, 10)); iSun.intensity = A.ecl ? 0.05 : 1.1;
    iSunA.setDir(sunB); iSunA.mat.transparent = true; iSunA.mat.opacity = A.ecl ? .3 : 1; iSunGlow.position.set(...AM.v.scale(sunB, 2.1)); iSunGlow.visible = !A.ecl;
    iB.setDir(BB); iPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V3(AM.v.unit(BB))); iV.setDir(vB);
    I.controls.update();
  }

  /** Render into the inset rectangle (call after the main view). H = viewport height. */
  function render(H) {
    if (insetEl.hidden) return;
    const renderer = gfx.renderer;
    const vr = gfx.vp.getBoundingClientRect(), r = insetEl.getBoundingClientRect();
    const x = r.left - vr.left, y = H - (r.top - vr.top) - r.height;
    I.camera.aspect = r.width / r.height; I.camera.updateProjectionMatrix();
    renderer.setViewport(x, y, r.width, r.height); renderer.setScissor(x, y, r.width, r.height); renderer.setScissorTest(true);
    renderer.render(I.scene, I.camera); renderer.setScissorTest(false);
  }

  return { update, render };
}
