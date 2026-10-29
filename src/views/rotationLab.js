/**
 * Workspace 1 — Rotation Lab.
 * One body frame B relative to a reference R, editable as Euler angles, quaternion,
 * axis-angle or DCM; animations of the Euler sequence and of the equivalent eigenaxis rotation.
 *
 * View interface (shared by all workspaces): { V, update(dt), render(), panel(), hud(), enter?(), leave?() }
 */
import * as THREE from 'three';
import * as AM from '../core/attitude.js';
import { S, save, scVersion } from '../state/store.js';
import { $, h, card, tip, slider, numCell, selectRow, check, seg, liveText, syncAll } from '../ui/dom.js';
import { toast } from '../ui/overlay.js';
import { deg, rad, fmt, matHTML } from '../ui/format.js';
import { mkView, addLights, viewPreset, renderFull } from '../gfx/renderer.js';
import { COL, V3, Arrow, makeTriad, makeLabel, dashedLine, setObjFromCBR, disposeTree } from '../gfx/primitives.js';
import { buildSC } from '../gfx/spacecraftMesh.js';
import { createAxisWidget } from '../gfx/axisWidget.js';

const easeIO = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const seqNames = { 1: 'X', 2: 'Y', 3: 'Z' };
const greek = s => s === '321' ? ['ψ yaw', 'θ pitch', 'φ roll'] : ['θ₁', 'θ₂', 'θ₃'];
function seqLabel(s) { const a = s.split('').map(n => seqNames[n]).join('-'); const extra = { '321': ' · yaw–pitch–roll', '313': ' · classical (orbit RAAN-i-ω)', '123': ' · roll–pitch–yaw (X first)' }[s] || ''; return `${s[0]}-${s[1]}-${s[2]}  (${a})${extra}`; }

export function createRotationLab({ renderRail }) {
  const V = mkView({ up: [0, 0, 1], pos: [3.2, 2.4, 2.1], fov: 38 });
  addLights(V.scene);

  /* ---------- scene ---------- */
  // unit sphere guide + grid
  const sph = new THREE.Group(); V.scene.add(sph);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x2a3a52, transparent: true, opacity: .55 });
  const ring = (rot) => { const pts = Array.from({ length: 97 }, (_, k) => { const a = k / 96 * Math.PI * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); }); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat); rot(l); sph.add(l); };
  ring(() => { }); ring(l => l.rotation.x = Math.PI / 2); ring(l => l.rotation.y = Math.PI / 2);
  const grid = new THREE.GridHelper(4, 16, 0x223047, 0x182234); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = .5; V.scene.add(grid);
  const refTriad = makeTriad(1.65, 0.008, ['X_R', 'Y_R', 'Z_R'], { opacity: 0.42 }); V.scene.add(refTriad);
  const body = new THREE.Group(); V.scene.add(body);
  const bodyTriad = makeTriad(1.3, 0.017, ['X_B', 'Y_B', 'Z_B']); body.add(bodyTriad);
  let scModel = null, scVer = -1;
  const ghosts = [0, 1].map(k => { const g = makeTriad(1.05, 0.007, k ? ['X″', 'Y″', 'Z″'] : ['X′', 'Y′', 'Z′'], { opacity: .55, labelScale: .8 }); V.scene.add(g); return g; });
  const eigArrow = new Arrow(COL.eig, 1.9, 0.011, { label: 'ê' }); V.scene.add(eigArrow);
  const eigBack = dashedLine([[0, 0, 0], [0, -1.5, 0]], COL.eig, .06, .05, .7); eigArrow.add(eigBack);
  let arc = null;
  const probe = new Arrow(COL.probe, 1, 0.012, { label: 'v' }); V.scene.add(probe);
  const stepAxis = new Arrow(0xffffff, 2.0, 0.02, { opacity: .35 }); stepAxis.visible = false; V.scene.add(stepAxis);

  // axis-tip trails
  const TR = 600;
  const trails = [COL.x, COL.y, COL.z].map(c => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR * 3), 3)); g.setDrawRange(0, 0); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: .85 })); l.n = 0; V.scene.add(l); return l; });
  function clearTrails() { trails.forEach(t => { t.n = 0; t.geometry.setDrawRange(0, 0); }); }
  function pushTrail(CRB) { const L = 1.3; trails.forEach((t, i) => { if (t.n >= TR) return; const a = t.geometry.attributes.position; a.setXYZ(t.n, CRB[0][i] * L, CRB[1][i] * L, CRB[2][i] * L); t.n++; a.needsUpdate = true; t.geometry.setDrawRange(0, t.n); }); }

  /* ---------- attitude state ---------- */
  let anim = null; // {kind: 'slerp'|'euler'|'eig', t, ...}
  function eulerRad() { return S.rot.euler.map(rad); }
  function CBR() { return AM.q2C(AM.q.unit(S.rot.q)); }
  /** Set the attitude from a quaternion; keeps Euler angles / axis consistent unless told not to. */
  function setQ(qn, opts = {}) {
    S.rot.q = AM.q.unit(qn);
    if (!opts.keepEuler) S.rot.euler = AM.C2euler(S.rot.seq, AM.q2C(S.rot.q)).map(deg);
    const aa = AM.q2axisAngle(S.rot.q); if (aa.angle > 1e-6 && !opts.keepAxis) S.rot.aaAxis = aa.axis;
    save(); if (!opts.noSync) syncAll();
  }
  function setEuler(i, x) { S.rot.euler[i] = x; setQ(AM.C2q(AM.euler2C(S.rot.seq, eulerRad())), { keepEuler: true }); }
  function animateTo(qTarget, dur = 0.45) {
    // three.js quaternion represents C_RB (active, Hamilton) -> same components as ours
    const a = new THREE.Quaternion(S.rot.q.x, S.rot.q.y, S.rot.q.z, S.rot.q.w);
    const b = new THREE.Quaternion(qTarget.x, qTarget.y, qTarget.z, qTarget.w);
    anim = { kind: 'slerp', t: 0, dur, a, b }; setQ(qTarget);
  }
  function playEuler() { clearTrails(); anim = { kind: 'euler', t: 0, step: 1.25, pause: 0.35 }; }
  function playEig() { clearTrails(); anim = { kind: 'eig', t: 0, dur: 2.2 }; }
  /** C_BR to display this frame (differs from the state while an animation runs). */
  function displayC() {
    if (!anim) return CBR();
    if (anim.kind === 'slerp') { const q = anim.a.clone().slerp(anim.b, easeIO(Math.min(1, anim.t / anim.dur))); return AM.q2C({ w: q.w, x: q.x, y: q.y, z: q.z }); }
    if (anim.kind === 'eig') { const aa = AM.q2axisAngle(S.rot.q); const s = easeIO(Math.min(1, anim.t / anim.dur)); return AM.q2C(AM.axisAngle2q(aa.axis, aa.angle * s)); }
    if (anim.kind === 'euler') { const t = eulerRad(); const st = anim.step + anim.pause; const f = [0, 1, 2].map(k => easeIO(Math.max(0, Math.min(1, (anim.t - k * st) / anim.step)))); return AM.euler2C(S.rot.seq, t.map((x, k) => x * f[k])); }
    return CBR();
  }

  /* ---------- per frame ---------- */
  function update(dt) {
    if (scVer !== scVersion()) { if (scModel) { body.remove(scModel); disposeTree(scModel); } const b = S.sc.bus; const sc = 0.95 / Math.max(b.x, b.y, b.z); scModel = buildSC(S.sc, { busOpacity: 1 }); scModel.scale.setScalar(sc); body.add(scModel); scVer = scVersion(); }
    scModel.visible = S.rot.showSC;
    let cap = null;
    if (anim) {
      anim.t += dt;
      if (anim.kind === 'euler') {
        const st = anim.step + anim.pause, k = Math.min(2, Math.floor(anim.t / st)); const ax = AM.seqAxes(S.rot.seq)[k];
        const t = eulerRad(); const partial = [0, 1, 2].map(n => n < k ? t[n] : 0);
        const Cpre = AM.euler2C(S.rot.seq, partial); const axisW = AM.m.T(Cpre).map(r => r[ax - 1]); // column ax of C_RB
        stepAxis.visible = true; stepAxis.setDir(axisW); stepAxis.mat.color.setHex([COL.x, COL.y, COL.z][ax - 1]);
        const prime = ['_R', '′', '″'][k];
        cap = `<b>Step ${k + 1}/3</b> · rotate <b>${greek(S.rot.seq)[k]} = ${S.rot.euler[k].toFixed(1)}°</b> about <b style="color:${['var(--ax-x)', 'var(--ax-y)', 'var(--ax-z)'][ax - 1]}">${seqNames[ax]}${prime}</b>${k ? ' (axis of the frame produced by the previous step)' : ' (reference axis)'}`;
        if (anim.t > 3 * st) { anim = null; stepAxis.visible = false; }
      } else if (anim.kind === 'eig') {
        const aa = AM.q2axisAngle(S.rot.q);
        cap = `<b>Eigenaxis rotation</b> · one rotation of <b>${deg(aa.angle).toFixed(1)}°</b> about ê = [${aa.axis.map(x => fmt(x, 3)).join(', ')}] reaches the same attitude`;
        if (anim.t > anim.dur + .4) anim = null;
      } else if (anim.t > anim.dur) anim = null;
    }
    const C = displayC();
    setObjFromCBR(body, C);
    if (anim && S.rot.showTrails) pushTrail(AM.m.T(C));
    trails.forEach(t => t.visible = S.rot.showTrails);
    // ghosts (intermediate frames of the Euler sequence)
    const t = eulerRad();
    const showG = S.rot.showGhosts;
    ghosts[0].visible = ghosts[1].visible = showG;
    if (showG) { setObjFromCBR(ghosts[0], AM.euler2C(S.rot.seq, [t[0], 0, 0])); setObjFromCBR(ghosts[1], AM.euler2C(S.rot.seq, [t[0], t[1], 0])); }
    // eigenaxis + angle arc
    const aa = AM.q2axisAngle(S.rot.q);
    eigArrow.visible = aa.angle > 1e-4; eigArrow.setDir(aa.axis);
    const arcKey = aa.angle.toFixed(5) + aa.axis.map(x => x.toFixed(4)).join();
    if (!arc || arc._key !== arcKey) {
      if (arc) { V.scene.remove(arc); disposeTree(arc); }
      let u = AM.v.sub([1, 0, 0], AM.v.scale(aa.axis, aa.axis[0])); if (AM.v.norm(u) < .2) u = AM.v.sub([0, 1, 0], AM.v.scale(aa.axis, aa.axis[1])); u = AM.v.unit(u);
      const w = AM.v.cross(aa.axis, u), R = 0.62, n = 64, pts = [];
      for (let k = 0; k <= n; k++) { const s = aa.angle * k / n; pts.push(V3(AM.v.add(AM.v.scale(u, R * Math.cos(s)), AM.v.scale(w, R * Math.sin(s))))); }
      arc = new THREE.Group(); arc._key = arcKey;
      arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COL.eig })));
      arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), pts[0]]), new THREE.LineBasicMaterial({ color: COL.eig, transparent: true, opacity: .4 })));
      arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), pts[n]]), new THREE.LineBasicMaterial({ color: COL.eig, transparent: true, opacity: .4 })));
      const lb = makeLabel('φ ' + deg(aa.angle).toFixed(1) + '°', '#c48bff', 24, { scale: .85 }); lb.position.copy(pts[n >> 1]).multiplyScalar(1.12); arc.add(lb);
      arc.visible = aa.angle > 1e-4; V.scene.add(arc);
    }
    // probe vector
    probe.visible = S.rot.showProbe; const pv = S.rot.probe;
    if (AM.v.norm(pv) > 1e-9) { probe.setDir(pv); probe.setLength(1.45); }
    const ce = $('#caption'); if (cap) { ce.hidden = false; $('#captionText').innerHTML = cap; } else if (!ce.hidden && S.tab === 'rot') ce.hidden = true;
    V.controls.update();
  }
  const axisW = createAxisWidget(V, ['X_R', 'Y_R', 'Z_R']);
  function render() { renderFull(V); axisW.render(); }

  /* ---------- control rail ---------- */
  function panel() {
    const out = [];
    const [i, j, k] = AM.seqAxes(S.rot.seq); const sym = AM.isSymmetric(S.rot.seq);
    const names = greek(S.rot.seq);
    const axLabel = (name, ax, mark) => h('span', null, name, ' · ', h('span', { class: 'ax', style: `color:var(--ax-${'xyz'[ax - 1]})` }, seqNames[ax] + mark));
    out.push(card('Euler angles', 'intrinsic',
      selectRow({ id: 'seq', label: 'Sequence', options: AM.SEQS.map(s => [s, seqLabel(s)]), get: () => S.rot.seq, set: v => { S.rot.seq = v; setQ(S.rot.q, { noSync: true }); renderRail(); toast('Same attitude, new angles'); } }),
      slider({ id: 'e1', label: axLabel(names[0], i, '_R'), min: -180, max: 180, step: .5, get: () => S.rot.euler[0], set: x => setEuler(0, x) }),
      slider({ id: 'e2', label: axLabel(names[1], j, '′'), min: sym ? 0 : -90, max: sym ? 180 : 90, step: .5, get: () => S.rot.euler[1], set: x => setEuler(1, x) }),
      slider({ id: 'e3', label: axLabel(names[2], k, '″'), min: -180, max: 180, step: .5, get: () => S.rot.euler[2], set: x => setEuler(2, x) }),
      h('div', { class: 'status' }, liveText(() => {
        const marg = deg(AM.gimbalMargin(S.rot.seq, eulerRad()));
        return marg < 0.05 ? `<span class="chip bad">Gimbal lock: θ₁ and θ₃ rotate about the same axis</span>` : marg < 10 ? `<span class="chip warn">Near gimbal lock · ${marg.toFixed(1)}° margin</span>` : `<span class="chip ok">Well defined · ${marg.toFixed(0)}° from singularity</span>`;
      })),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: playEuler }, '▶ Play step by step'), h('button', { class: 'btn', onclick: () => { animateTo(AM.q.id()); } }, 'Reset to identity')),
      h('div', { class: 'formula' }, `C_BR = R${k}(θ₃) · R${j}(θ₂) · R${i}(θ₁)`),
      tip(`Each rotation is about an axis of the frame you <b>just produced</b> (′, ″). Singular when θ₂ = ${sym ? '0° or 180°' : '±90°'}: then the first and last axes line up and only θ₁${sym ? '+' : '±'}θ₃ is defined.`)
    ));

    const qOrder = () => S.rot.scalarFirst ? [['w', 'q₀'], ['x', 'q₁'], ['y', 'q₂'], ['z', 'q₃']] : [['x', 'q₁'], ['y', 'q₂'], ['z', 'q₃'], ['w', 'q₄']];
    const qset = (key, x) => { const q = Object.assign({}, S.rot.q); q[key] = x; if (AM.q.norm(q) < 1e-9) return; setQ(q); };
    out.push(card('Quaternion', null,
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, seg([[true, 'Scalar first'], [false, 'Scalar last']], () => S.rot.scalarFirst, v => { S.rot.scalarFirst = v; save(); renderRail(); }), liveText(() => `<span class="lbl">‖q‖ = ${AM.q.norm(S.rot.q).toFixed(6)}</span>`)),
      h('div', { class: 'grid4' }, qOrder().map(([kk, lab]) => numCell('q' + kk, lab + (kk === 'w' ? ' (scalar)' : ''), () => S.rot.q[kk], x => qset(kk, x), 0.01, 5))),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { S.rot.q = AM.q.neg(S.rot.q); save(); syncAll(); toast('−q: same attitude'); } }, 'Negate  (−q)'), h('button', { class: 'btn', onclick: () => { S.rot.q = AM.q.canon(S.rot.q); save(); syncAll(); } }, 'Make scalar ≥ 0')),
      tip('q = [cos(φ/2), ê·sin(φ/2)]. <b>q and −q are the same attitude</b> (double cover). Edit any component; the quaternion is re-normalised.'),
      h('details', { class: 'more' }, h('summary', null, 'Hamilton vs. JPL/Shuster — what these numbers mean'),
        tip('The same four numbers are read two ways. <b>Hamilton</b> (Three.js, Eigen, ROS): R(q) rotates reference axes onto body axes, R(q) = C_RB. <b>JPL/Shuster</b> (Markley & Crassidis, many AOCS codes): A(q) = C_BR. A(q) = R(q)ᵀ, so the components match; what differs is the composition order: Hamilton q_CA = q_BA ∘ q_CB, Shuster q_CA = q_CB ⊗ q_BA. Check which one your flight code uses.'))
    ));

    out.push(card('Euler axis & angle', 'eigenaxis',
      h('div', { class: 'grid3' }, [0, 1, 2].map(n => numCell('ea' + n, 'ê' + 'xyz'[n], () => (S.rot.aaAxis || [1, 0, 0])[n], x => { const ax = (S.rot.aaAxis || [1, 0, 0]).slice(); ax[n] = x; if (AM.v.norm(ax) < 1e-9) return; S.rot.aaAxis = AM.v.unit(ax); const ang = AM.q2axisAngle(S.rot.q).angle; setQ(AM.axisAngle2q(S.rot.aaAxis, ang), { keepAxis: true }); }, 0.05, 4))),
      slider({ id: 'eang', label: 'Angle φ', min: 0, max: 360, step: .5, get: () => deg(AM.q2axisAngle(S.rot.q).angle), set: x => setQ(AM.axisAngle2q(S.rot.aaAxis || AM.q2axisAngle(S.rot.q).axis, rad(x)), { keepAxis: true }) }),
      h('div', { class: 'kv' }, h('dt', null, 'Rotation vector φ·ê'), h('dd', null, liveText(() => { const a = AM.q2axisAngle(S.rot.q); return '[' + a.axis.map(x => fmt(x * deg(a.angle), 2)).join(', ') + ']°'; }))),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: playEig }, '▶ Play eigenaxis rotation')),
      tip('Euler\'s theorem: any attitude is <b>one</b> rotation about a fixed axis ê. ê has the same components in R and B. Compare the trails from this and the step-by-step Euler play.')
    ));

    out.push(card('Direction cosine matrix', null,
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, seg([['BR', 'C_BR  (R → B)'], ['RB', 'C_RB  (B → R)']], () => S.rot.dcmView, v => { S.rot.dcmView = v; save(); })),
      h('div', { class: 'mat' }, liveText(() => { const C = CBR(); return matHTML(S.rot.dcmView === 'BR' ? C : AM.m.T(C), 4); }, 'contents')),
      h('div', { class: 'kv' }, h('dt', null, 'det C'), h('dd', null, liveText(() => fmt(AM.m.det(CBR()), 6))), h('dt', null, 'trace C = 1 + 2cos φ'), h('dd', null, liveText(() => { const C = CBR(); return fmt(C[0][0] + C[1][1] + C[2][2], 4); }))),
      liveText(() => S.rot.dcmView === 'BR' ? '<p class="tip"><b>Rows</b> of C_BR are the body axes X_B, Y_B, Z_B written in R. v_B = C_BR · v_R.</p>' : '<p class="tip"><b>Columns</b> of C_RB are the body axes written in R. C_RB = C_BRᵀ = C_BR⁻¹.</p>')
    ));

    const nud = (axis, sign) => { const a = rad(S.rot.nudge * sign); const C = CBR(); const Cn = S.rot.nudgeFrame === 'ref' ? AM.m.mul(C, AM.Rp(axis, a)) : AM.m.mul(AM.Rp(axis, a), C); animateTo(AM.C2q(Cn)); };
    out.push(card('Rotate step by step', 'compose',
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, seg([['body', 'About body axes'], ['ref', 'About reference axes']], () => S.rot.nudgeFrame || 'body', v => { S.rot.nudgeFrame = v; save(); }),
        selectRow({ id: 'nudge', label: 'Step', options: [[5, '5°'], [15, '15°'], [45, '45°'], [90, '90°']], get: () => S.rot.nudge, set: v => { S.rot.nudge = +v; save(); } })),
      h('div', { class: 'grid3' }, [1, 2, 3].map(n => h('div', { class: 'btns', style: 'flex-wrap:nowrap' }, h('button', { class: 'btn mono', style: `flex:1;color:var(--ax-${'xyz'[n - 1]})`, onclick: () => nud(n, -1) }, '−' + 'XYZ'[n - 1]), h('button', { class: 'btn mono', style: `flex:1;color:var(--ax-${'xyz'[n - 1]})`, onclick: () => nud(n, +1) }, '+' + 'XYZ'[n - 1])))),
      liveText(() => `<div class="formula">${(S.rot.nudgeFrame || 'body') === 'body' ? 'C_BR ← R_n(Δ) · C_BR   (pre-multiply)' : 'C_BR ← C_BR · R_n(Δ)   (post-multiply)'}</div>`),
      tip('Try +90° X then +90° Y, then undo in the opposite order: rotations do not commute. Body-axis steps are what a reaction wheel slew about a body axis does.')
    ));

    out.push(card('Vector transform', 'v_B = C_BR · v_R',
      h('div', { class: 'grid3' }, [0, 1, 2].map(n => numCell('pv' + n, 'v_R ' + 'xyz'[n], () => S.rot.probe[n], x => { S.rot.probe[n] = x; save(); }, 0.1, 3))),
      h('div', { class: 'kv' }, h('dt', null, 'v_B (body)'), h('dd', null, liveText(() => '[' + AM.m.mulv(CBR(), S.rot.probe).map(x => fmt(x, 3)).join(', ') + ']'))),
      check('showProbe', 'Show v (pink)', () => S.rot.showProbe, v => { S.rot.showProbe = v; save(); }),
      tip('One physical arrow, two sets of coordinates. Example: Sun vector from the ephemeris (inertial) → what the sun sensor should measure (body).')
    ));

    out.push(card('Display', null,
      h('div', { class: 'checks' },
        check('showSC', 'Spacecraft model', () => S.rot.showSC, v => { S.rot.showSC = v; save(); }),
        check('showGhosts', 'Intermediate frames ′ ″', () => S.rot.showGhosts, v => { S.rot.showGhosts = v; save(); }),
        check('showTrails', 'Axis-tip trails', () => S.rot.showTrails, v => { S.rot.showTrails = v; save(); })),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: clearTrails }, 'Clear trails'))
    ));
    return out;
  }

  /* ---------- viewport overlays ---------- */
  function hud() {
    $('#hudTL').append(h('div', { class: 'hud' }, h('h4', null, 'Body B relative to reference R'),
      h('dl', { class: 'kv' },
        h('dt', null, 'q ' + (S.rot.scalarFirst ? '[q₀ q₁ q₂ q₃]' : '[q₁ q₂ q₃ q₄]')), h('dd', null, liveText(() => { const q = S.rot.q; const a = S.rot.scalarFirst ? [q.w, q.x, q.y, q.z] : [q.x, q.y, q.z, q.w]; return a.map(x => fmt(x, 4)).join(' '); })),
        h('dt', null, 'Euler ' + S.rot.seq), h('dd', null, liveText(() => S.rot.euler.map(x => x.toFixed(1) + '°').join('  '))),
        h('dt', null, 'φ about ê'), h('dd', null, liveText(() => { const a = AM.q2axisAngle(S.rot.q); return deg(a.angle).toFixed(1) + '° · [' + a.axis.map(x => fmt(x, 2)).join(' ') + ']'; }))),
      h('div', { class: 'legend', style: 'margin-top:6px' }, h('span', null, h('i', { style: 'background:var(--muted);opacity:.6' }), 'R (faint)'), h('span', null, h('i', { style: 'background:var(--text)' }), 'B (bold)'), h('span', null, h('i', { style: 'background:var(--eig)' }), 'Euler axis'), h('span', null, h('i', { style: 'background:var(--probe)' }), 'v'))));
    const vb = (t, d) => h('button', { class: 'vbtn', onclick: () => viewPreset(V, d, 4.6) }, t);
    $('#hudTR').append(vb('Iso', [1.4, 1, .9]), vb('+X', [1, 0, 0.0001]), vb('+Y', [0, 1, 0.0001]), vb('+Z', [0.0001, 0, 1]));
  }

  /** Called once at boot. */
  function init() { if (!S.rot.aaAxis) S.rot.aaAxis = AM.q2axisAngle(S.rot.q).axis; }

  const enter = () => axisW.show(true), leave = () => axisW.show(false);
  return { V, init, update, render, panel, hud, enter, leave, setQ, animateTo, CBR };
}
