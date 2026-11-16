/**
 * Workspace 2 — Orbit & Frames.
 * Earth (ECEF texture, rotating by GMST), orbit line coloured by eclipse, ground track,
 * the spacecraft with ECI / orbital (VVLH, LVLH, VNC) / body frames, Sun, Moon & B-field vectors, payload footprint,
 * a body-frame inset, a payload view, signal plots and a one-orbit sensor timeline.
 *
 * Scene unit = 1000 km. Physics lives in sim/ and env/; this file only draws.
 */
import * as THREE from 'three';
import * as AM from '../../core/attitude.js';
import * as ENV from '../../env/index.js';
import { S, save, scVersion } from '../../state/store.js';
import { $, h, liveText, syncAll } from '../../ui/dom.js';
import { deg, fmt } from '../../ui/format.js';
import { mkView, viewPreset, sizeOf, gfx } from '../../gfx/renderer.js';
import { COL, V3, Arrow, makeTriad, makeLabel, setObjFromCBR, fixLabels, disposeTree } from '../../gfx/primitives.js';
import { earthTexture, earthGeometry, atmosphere, starfield, glowSprite } from '../../gfx/earth.js';
import { buildSC } from '../../gfx/spacecraftMesh.js';
import { compAxis } from '../../spacecraft/component.js';
import { advanceTime, epochDate, orbitElements, applyPreset, targetECEF, DATE_MAX, DATE_MIN } from '../../sim/scenario.js';
import { addChange, runStep, setChangeStart } from '../../sim/schedule.js';
import { attitudeAt, autoSlews, bodyRate, payloadComp } from '../../sim/guidance.js';
import { timelineKey } from '../../sim/timeline.js';
import { createBodyInset } from './bodyInset.js';
import { createPayloadInset } from './payloadInset.js';
import { createTimelineView } from './timelineView.js';
import { createPlotView } from './plotView.js';
import { editSchedule, orbitPanel, pickChange } from './orbitPanel.js';
import { toast } from '../../ui/overlay.js';

const U = 1 / 1000; // scene unit = 1000 km
const D2R = AM.D2R;
const NO = 400;     // orbit line samples
const NT = 500;     // ground-track segment vertices

export function createOrbitView({ renderRail }) {
  const V = mkView({ up: [0, 0, 1], pos: [17, -15, 9], fov: 40, near: 0.002, far: 4000 });
  V.controls.minDistance = 0.05;
  V.scene.add(starfield());
  V.scene.add(new THREE.AmbientLight(0x6d7f99, 0.28));
  const sunLight = new THREE.DirectionalLight(0xfff3dc, 1.25); V.scene.add(sunLight); V.scene.add(sunLight.target);
  const sunGlow = glowSprite('#ffd27a', 60); V.scene.add(sunGlow);
  // Moon at its true distance and size; lit by sunLight, so it shows the right phase
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(ENV.RMOON * U, 48, 24), new THREE.MeshPhongMaterial({ color: 0xc9c6c0, shininess: 2 })); V.scene.add(moonMesh);

  /* ---------- Earth & frames ---------- */
  const RE = ENV.RE * U;
  const earth = new THREE.Group(); V.scene.add(earth); // Earth-fixed (ECEF) group, rotated by GMST
  const earthMesh = new THREE.Mesh(earthGeometry(RE), new THREE.MeshPhongMaterial({ map: earthTexture(), shininess: 10, specular: 0x1d2b3a }));
  earth.add(earthMesh);
  V.scene.add(atmosphere(RE * 1.03));
  const eciTriad = makeTriad(RE * 1.9, 0.035, ['X_ECI ♈', 'Y_ECI', 'Z_ECI'], { opacity: .55 }); V.scene.add(eciTriad);
  { // equatorial plane ring
    const pts = Array.from({ length: 129 }, (_, k) => { const a = k / 128 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * RE * 1.9, Math.sin(a) * RE * 1.9, 0); });
    V.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2a3a52, transparent: true, opacity: .6 })));
  }

  /* ---------- orbit line (vertex colours = sunlit / eclipse) & ground track ---------- */
  const orbitGeo = new THREE.BufferGeometry(); orbitGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NO + 1) * 3), 3)); orbitGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((NO + 1) * 3), 3));
  V.scene.add(new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({ vertexColors: true })));
  const trackGeo = new THREE.BufferGeometry(); trackGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 3), 3));
  const track = new THREE.LineSegments(trackGeo, new THREE.LineBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: .8 })); earth.add(track);

  /* ---------- spacecraft & vectors ---------- */
  const scNode = new THREE.Group(); V.scene.add(scNode);
  let scModel = null, scVer = -1;
  let orbTriad = null, orbTriadFrame = null; // rebuilt when the selected orbital frame changes (labels differ)
  const sunArrow = new Arrow(COL.sun, 1, 0.008, { label: 'Sun' }); V.scene.add(sunArrow);
  const moonArrow = new Arrow(COL.moon, 1, 0.006, { label: 'Moon' }); V.scene.add(moonArrow);
  const bArrow = new Arrow(COL.teal, 1, 0.008, { label: 'B' }); V.scene.add(bArrow);
  const vArrow = new Arrow(COL.cyan, 1, 0.008, { label: 'v' }); V.scene.add(vArrow);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xe8ecf2, transparent: true, opacity: .8 })); V.scene.add(ray);
  const foot = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: .9, depthTest: false })); foot.renderOrder = 5; V.scene.add(foot);
  const footLbl = makeLabel('PL footprint', '#e8ecf2', 22, { scale: .8 }); V.scene.add(footLbl);
  const tgt = new THREE.Group();
  { const m = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 12), new THREE.MeshBasicMaterial({ color: 0xff7bd5 })); m.rotation.x = -Math.PI / 2; m.position.z = 0.06; tgt.add(m); const l = makeLabel('Target', '#ff7bd5', 22, { scale: .8 }); l.position.z = .14; tgt.add(l); }
  earth.add(tgt);

  /* ---------- sub-views ---------- */
  const insetEl = $('#inset');
  const inset = createBodyInset(insetEl, earthMesh.material.map);
  const plEl = $('#plInset'), plInset = createPayloadInset(plEl);
  // the Mode band edits the schedule through the panel's selection and undo
  const timeline = createTimelineView($('#tlc'), {
    pick: id => pickChange(id, panelCtx, false),
    move: (id, start) => { const c = (S.orbit.schedule || []).find(c => c.id === id); if (!c || c.start === start) return; // the same second: nothing to undo
      if (editSchedule(() => setChangeStart(S.orbit, id, start), panelCtx) === false) toast(`A start must be from ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)}`); },
    add: t => { const g = attitudeAt(S, t).g, c = editSchedule(() => addChange(S.orbit, g, S.rot.q, t), panelCtx);
      if (c) pickChange(c.id, panelCtx, false); else toast(`The schedule holds up to ${MAX_CHANGES} changes, from ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)}`); },
  });
  const plots = createPlotView($('#timeline'));

  /* ---------- geometry refresh (cached) ---------- */
  let lastOrbitKey = '', lastOrbitT = 0, lastTrackT = -1e9, lastTrackKey = '';
  function refreshOrbit(t, E) {
    const key = JSON.stringify(E) + S.orbit.j2 + S.orbit.epoch;
    if (key === lastOrbitKey && Math.abs(t - lastOrbitT) < 300) return; lastOrbitKey = key; lastOrbitT = t;
    const T = ENV.propagate(E, 0, false).period; const p = orbitGeo.attributes.position, c = orbitGeo.attributes.color; const e0 = epochDate(S.orbit).getTime();
    for (let k = 0; k <= NO; k++) {
      const tt = t + k / NO * T; const s = ENV.propagate(E, tt, S.orbit.j2); p.setXYZ(k, s.r[0] * U, s.r[1] * U, s.r[2] * U);
      const ecl = ENV.eclipse(s.r, ENV.sunECI(new Date(e0 + tt * 1000)));
      if (ecl) c.setXYZ(k, .22, .3, .45); else c.setXYZ(k, .95, .68, .25);
    }
    p.needsUpdate = c.needsUpdate = true; orbitGeo.computeBoundingSphere();
  }
  function refreshTrack(t, E) {
    const key = lastOrbitKey;
    if (key === lastTrackKey && Math.abs(t - lastTrackT) < 20) return; lastTrackKey = key; lastTrackT = t;
    const T = ENV.propagate(E, 0, false).period; const p = trackGeo.attributes.position; const e0 = epochDate(S.orbit).getTime();
    let prev = null, n = 0; const N = NT / 2;
    for (let k = 0; k <= N; k++) { // ±1 orbit around now
      const tt = t - T + 2 * T * k / N; const s = ENV.propagate(E, tt, S.orbit.j2); const pe = ENV.eci2ecef(s.r, new Date(e0 + tt * 1000));
      const u = AM.v.scale(AM.v.unit(pe), RE * 1.003);
      if (prev && n < NT - 1) { p.setXYZ(n++, prev[0], prev[1], prev[2]); p.setXYZ(n++, u[0], u[1], u[2]); }
      prev = u;
    }
    trackGeo.setDrawRange(0, n); p.needsUpdate = true; trackGeo.computeBoundingSphere();
  }

  /* ---------- per frame ---------- */
  let cur = null, prevScPos = null, autoKey = '';
  const scDispScale = () => 0.13 * S.orbit.scale;
  function update(dt) {
    const o = S.orbit;
    if (o.playing) { const t0 = o.t; advanceTime(o, dt); if (runStep(o, t0) || !o.playing) syncAll(); } // a scenario run stops or loops at its end
    const E = orbitElements(o);
    // automatic slew times follow the turns: work them out again when anything they depend on changed
    const ak = JSON.stringify([timelineKey(S, scVersion(), 0), S.sc.maxRate]); if (ak !== autoKey) { if (autoSlews(S, E)) { save(); syncAll(); } autoKey = JSON.stringify([timelineKey(S, scVersion(), 0), S.sc.maxRate]); }
    const A = attitudeAt(S, o.t, E); cur = A;
    const gm = ENV.gmst(A.date); earth.rotation.z = gm;
    sunLight.position.set(...AM.v.scale(A.sun, 100)); sunGlow.position.set(...AM.v.scale(A.sun, 700));
    refreshOrbit(o.t, E); refreshTrack(o.t, E); track.visible = o.show.track; eciTriad.visible = o.show.eci;
    // spacecraft
    if (scVer !== scVersion()) { if (scModel) { scNode.remove(scModel); disposeTree(scModel); } scModel = buildSC(S.sc, { cones: true, triad: true, triadLen: 1.35, triadR: .02 }); scNode.add(scModel); scVer = scVersion(); }
    const k = scDispScale(); scModel.scale.setScalar(k);
    scModel.traverse(x => { if (x.userData.isCone) x.visible = o.show.cones; });
    const pos = V3(AM.v.scale(A.st.r, U)); scNode.position.copy(pos); setObjFromCBR(scNode, A.CBI);
    if (orbTriadFrame !== o.refFrame) {
      if (orbTriad) { V.scene.remove(orbTriad); disposeTree(orbTriad); }
      const f = ENV.ORBIT_FRAMES[o.refFrame] || ENV.ORBIT_FRAMES.vvlh;
      orbTriad = makeTriad(1, 0.006, f.axes, { opacity: .5, labelScale: .8 }); V.scene.add(orbTriad); orbTriadFrame = o.refFrame;
    }
    orbTriad.visible = o.show.orbFrame; orbTriad.position.copy(pos); setObjFromCBR(orbTriad, A.CRI); orbTriad.scale.setScalar(k * 2.2);
    // vectors at the spacecraft (thickness scales with S/C size, length kept in scene units)
    const L = k * 2.6, vs = Math.max(.4, k * 6);
    sunArrow.visible = o.show.sunv; sunArrow.position.copy(pos); sunArrow.setDir(A.sun); sunArrow.mat.opacity = A.ecl ? .35 : 1; sunArrow.mat.transparent = true; sunArrow.scale.setScalar(vs); sunArrow.setLength(L / vs);
    moonMesh.visible = o.show.moonv; moonMesh.position.set(...AM.v.scale(ENV.moonECI(A.date), U));
    moonArrow.visible = o.show.moonv; moonArrow.position.copy(pos); moonArrow.setDir(A.moon); moonArrow.mat.transparent = true; moonArrow.mat.opacity = A.moonUp ? 1 : .3; moonArrow.scale.setScalar(vs); moonArrow.setLength(L * .75 / vs);
    const BI = ENV.bfieldECI(A.st.r, A.date);
    bArrow.visible = o.show.bv; bArrow.position.copy(pos); bArrow.setDir(BI); bArrow.scale.setScalar(vs); bArrow.setLength(L * .8 / vs);
    vArrow.visible = o.show.orbFrame; vArrow.position.copy(pos); vArrow.setDir(A.st.v); vArrow.scale.setScalar(vs); vArrow.setLength(L * .9 / vs);
    // payload ray & footprint
    const pc = payloadComp(S, A.g); // the payload of what flies now
    if (pc) {
      const bI = AM.m.mulv(AM.m.T(A.CBI), compAxis(pc)); const hit = ENV.rayEarth(A.st.r, bI);
      ray.visible = foot.visible = footLbl.visible = !!hit;
      if (hit) {
        const pa = ray.geometry.attributes.position; pa.setXYZ(0, pos.x, pos.y, pos.z); pa.setXYZ(1, hit[0] * U, hit[1] * U, hit[2] * U); pa.needsUpdate = true; ray.geometry.computeBoundingSphere();
        const slant = AM.v.norm(AM.v.sub(hit, A.st.r)); const footR = Math.max(slant * Math.tan(pc.fov / 2 * D2R), 0) * U;
        const n = V3(AM.v.unit(hit)); foot.position.set(hit[0] * U, hit[1] * U, hit[2] * U).addScaledVector(n, 0.004); foot.lookAt(foot.position.clone().add(n));
        foot.scale.setScalar(Math.max(footR, 0.025)); footLbl.position.copy(foot.position).addScaledVector(n, 0.02);
      }
    } else ray.visible = foot.visible = footLbl.visible = false;
    tgt.visible = A.g.mode === 'target' || (!!o.show.plView && !!pc); // the payload view measures the error against it in every mode
    plEl.hidden = !(o.show.plView && pc);
    // the target in force: a schedule change may have its own
    if (tgt.visible) { const p = AM.v.scale(targetECEF(A.g), U); tgt.position.set(...p); tgt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V3(AM.v.unit(p))); }
    V.scene.updateMatrixWorld(); [scModel, orbTriad, sunArrow, moonArrow, bArrow, vArrow].forEach(fixLabels);
    // follow camera
    if (o.show.follow) { if (prevScPos) { const d = pos.clone().sub(prevScPos); V.camera.position.add(d); } V.controls.target.copy(pos); }
    prevScPos = pos.clone();
    V.controls.update();
    inset.update(A, BI, gm); plInset.draw(A);
  }
  function render() {
    const { w, h: H } = sizeOf(); const r = gfx.renderer;
    r.setScissorTest(false); r.setViewport(0, 0, w, H); r.render(V.scene, V.camera);
    inset.render(H);
  }

  /* ---------- camera helpers ---------- */
  function zoomSC() {
    if (!cur) return; const p = V3(AM.v.scale(cur.st.r, U)); V.controls.target.copy(p);
    const off = p.clone().normalize().multiplyScalar(0.9).add(new THREE.Vector3(0.4, -0.5, 0.35));
    V.camera.position.copy(p).add(off); prevScPos = p.clone(); V.controls.update();
  }
  /** Camera next to the Moon (Earth side, slightly off-axis): the Moon fills ~8° and its phase is visible. */
  function moonView() {
    if (!cur) return; S.orbit.show.follow = false; S.orbit.show.moonv = true;
    const m = AM.v.scale(ENV.moonECI(cur.date), U), toEarth = AM.v.unit(AM.v.scale(m, -1));
    let side = AM.v.cross(toEarth, [0, 0, 1]); side = AM.v.norm(side) < 1e-6 ? [1, 0, 0] : AM.v.unit(side);
    V.controls.target.set(...m); V.camera.position.set(...AM.v.add(m, AM.v.add(AM.v.scale(toEarth, 11), AM.v.scale(side, 4))));
    prevScPos = null; V.controls.update(); save(); syncAll();
  }
  function doPreset(k) { if (applyPreset(S.orbit, k)) { save(); syncAll(); } }

  /* ---------- rail & HUD ---------- */
  const panelCtx = { cur: () => cur, applyPreset: doPreset, zoomSC, setInset: v => { insetEl.hidden = !v; }, setPlView: v => { plEl.hidden = !v; }, renderRail };
  function panel() { return orbitPanel(panelCtx); }

  function hud() {
    $('#hudTL').append(h('div', { class: 'hud' }, h('h4', null, 'State'),
      h('dl', { class: 'kv' },
        h('dt', null, 'Altitude · speed'), h('dd', null, liveText(() => cur ? (AM.v.norm(cur.st.r) - ENV.RE).toFixed(1) + ' km · ' + AM.v.norm(cur.st.v).toFixed(3) + ' km/s' : '')),
        h('dt', null, 'Lat · lon'), h('dd', null, liveText(() => { if (!cur) return ''; const ll = ENV.ecef2ll(ENV.eci2ecef(cur.st.r, cur.date)); return deg(ll.lat).toFixed(2) + '° · ' + deg(ll.lon).toFixed(2) + '°'; })),
        h('dt', null, 'β angle · light'), h('dd', null, liveText(() => cur ? deg(ENV.betaAngle(cur.st.r, cur.st.v, cur.sun)).toFixed(1) + '° · ' + (cur.ecl ? '<span style="color:#7d93b5">ECLIPSE</span>' : '<span style="color:var(--sun)">SUNLIT</span>') : '')),
        h('dt', null, 'q_BI [q₀ q₁ q₂ q₃]'), h('dd', null, liveText(() => { if (!cur) return ''; const q = AM.C2q(cur.CBI); return [q.w, q.x, q.y, q.z].map(x => fmt(x, 3)).join(' '); })),
        h('dt', null, 'B vs nominal (φ θ ψ)'), h('dd', null, liveText(() => { if (!cur) return ''; const e = AM.C2euler('321', AM.m.mul(cur.CBI, AM.m.T(cur.CNI))).map(deg); return [e[2], e[1], e[0]].map(x => x.toFixed(1) + '°').join(' '); })),
        h('dt', null, 'B vs ' + S.orbit.refFrame.toUpperCase() + ' (φ θ ψ)'), h('dd', null, liveText(() => { if (!cur) return ''; const e = AM.C2euler('321', AM.m.mul(cur.CBI, AM.m.T(cur.CRI))).map(deg); return [e[2], e[1], e[0]].map(x => x.toFixed(1) + '°').join(' '); })),
        h('dt', null, 'Body rate |ω|'), h('dd', null, liveText(() => cur ? (deg(AM.v.norm(bodyRate(S, cur.t)))).toFixed(3) + ' °/s' : '')),
        h('dt', null, 'Sun in body'), h('dd', null, liveText(() => cur ? '[' + AM.m.mulv(cur.CBI, cur.sun).map(x => fmt(x, 2)).join(' ') + ']' : '')),
        h('dt', null, 'Moon in body'), h('dd', null, liveText(() => cur ? '[' + AM.m.mulv(cur.CBI, cur.moon).map(x => fmt(x, 2)).join(' ') + ']' : '')),
        h('dt', null, 'B in body (nT)'), h('dd', null, liveText(() => cur ? '[' + AM.m.mulv(cur.CBI, ENV.bfieldECI(cur.st.r, cur.date)).map(x => x.toFixed(0)).join(' ') + ']' : ''))),
      h('div', { class: 'legend', style: 'margin-top:6px' }, h('span', null, h('i', { style: 'background:var(--sun)' }), 'Sun'), h('span', null, h('i', { style: 'background:var(--moon)' }), 'Moon'), h('span', null, h('i', { style: 'background:#57c7b8' }), 'B (dipole)'), h('span', null, h('i', { style: 'background:var(--cyan)' }), 'v'), h('span', null, h('i', { style: 'background:#38506f' }), 'orbit in eclipse'))));
    $('#hudTR').append(
      h('button', { class: 'vbtn', onclick: () => { S.orbit.show.follow = false; V.controls.target.set(0, 0, 0); viewPreset(V, [1, -.9, .5], 28); syncAll(); } }, 'Earth view'),
      h('button', { class: 'vbtn', onclick: () => { S.orbit.show.follow = true; zoomSC(); syncAll(); } }, 'Zoom to S/C'),
      h('button', { class: 'vbtn', onclick: () => { if (!cur) return; S.orbit.show.follow = false; V.controls.target.set(0, 0, 0); const hI = AM.v.unit(AM.v.cross(cur.st.r, cur.st.v)); viewPreset(V, hI, AM.v.norm(cur.st.r) * U * 3.2); syncAll(); } }, 'Orbit-normal view'),
      h('button', { class: 'vbtn', onclick: moonView }, 'Moon view'));
  }

  /* ---------- lifecycle ---------- */
  function init() { if (!S.orbit._init) { doPreset(S.orbit.preset); S.orbit._init = true; } }
  function enter() { insetEl.hidden = !!S.orbit.hideInset; plEl.hidden = !(S.orbit.show.plView && [S.orbit, ...(S.orbit.schedule || [])].some(g => payloadComp(S, g))); $('#timeline').hidden = false; }
  function leave() { insetEl.hidden = true; plEl.hidden = true; $('#timeline').hidden = true; }
  /** Called ~10×/s: timeline redraw and inset placement above it. */
  function tick() {
    plots.draw(); if (!plots.collapsed()) timeline.draw();
    // body-frame inset: just above the dock, and small enough to fit the 3D area
    const dockH = $('#timeline').offsetHeight, vp = gfx.vp.getBoundingClientRect();
    // payload view stacked above it (right column: the top-left HUD can reach down to the dock)
    const both = !insetEl.hidden && !plEl.hidden, avail = vp.height - dockH - 70;
    const side = Math.max(110, Math.min(290, vp.width * 0.42, both ? (avail - 12) / 2 : avail));
    insetEl.style.bottom = (dockH + 12) + 'px'; insetEl.style.width = side + 'px';
    plEl.style.bottom = (dockH + 12 + (insetEl.hidden ? 0 : side + 12)) + 'px'; plEl.style.width = side + 'px'; plEl.style.height = side + 'px';
    if (S.orbit.playing) syncAll();
  }

  return { V, init, update, render, panel, hud, enter, leave, tick };
}
