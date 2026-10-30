/**
 * Workspace 3 — Spacecraft Layout.
 * Build the satellite in its own frame (SCF), like a CAD model: the bus and every component are
 * parts with a position and orientation (yaw-pitch-roll, DCM or quaternion). The "Attitude
 * reference" card says how SCF flies relative to VVLH / LVLH / VNC. Live mass properties,
 * actuator authority, JSON import/export and NumPy export.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as AM from '../core/attitude.js';
import { S, save, scVersion, scChanged } from '../state/store.js';
import { $, h, card, tip, slider, numCell, selectRow, check, seg, liveText, syncAll, onSync, confirmButton } from '../ui/dom.js';
import { orientationEditor } from '../ui/orientationEditor.js';
import { dcmInput } from '../ui/matrixInput.js';
import { toast, showModal, closeModal, copyText } from '../ui/overlay.js';
import { fmt, fmtS, matHTML } from '../ui/format.js';
import { gfx, mkView, addLights, viewPreset, renderFull } from '../gfx/renderer.js';
import { COL, Arrow, makeTriad, makeLabel, dashedLine, disposeTree, setObjFromCBR } from '../gfx/primitives.js';
import { createAxisWidget } from '../gfx/axisWidget.js';
import { buildSC } from '../gfx/spacecraftMesh.js';
import { TYPES, axisName } from '../spacecraft/componentTypes.js';
import { newId, mkComp, qFromBoresight, compAxis, envelope, sanitizeSpacecraft } from '../spacecraft/component.js';
import { defaultSC } from '../spacecraft/exampleSpacecraft.js';
import { massProps, maxPrincipalTilt } from '../spacecraft/massProperties.js';
import { exportPython } from '../spacecraft/exportPython.js';
import { exportMatlab } from '../spacecraft/exportMatlab.js';
import { parseOrientations, planImport, applyImport } from '../spacecraft/orientationImport.js';
import { busPose, busPointToSCF, busDirToSCF } from '../spacecraft/bus.js';
import { AXIS_SPECS, REF_IDS, REF_AXIS_MEANING, validPair, alignMatrix, axesOf, nominalDirections, specOf, defaultAlign } from '../spacecraft/alignment.js';

/** A direction in SCF as text: 'SCF +Z' when axis-aligned, else a unit vector. */
const dirText = d => { const s = specOf(d.map(x => Math.abs(x) > 1 - 1e-9 ? Math.sign(x) : Math.abs(x) < 1e-9 ? 0 : x)); return s ? 'SCF ' + s.replace('-', '−') : '[' + d.map(x => fmt(x, 3)).join(', ') + ']'; };
const BUS_COLOR = '#c99a3e';

export function createLayoutView({ renderRail }) {
  const renderer = gfx.renderer;
  // CAD convention: +Z up on screen, grid = SCF XY plane through the origin
  const V = mkView({ up: [0, 0, 1], pos: [2.4, -2.6, 1.7], fov: 38, near: 0.01, far: 100 });
  addLights(V.scene, 1.1);
  const grid = new THREE.GridHelper(4, 20, 0x2a3a52, 0x18222f); grid.rotation.x = Math.PI / 2; V.scene.add(grid);
  V.scene.add(makeTriad(1.0, 0.012, ['X_SCF', 'Y_SCF', 'Z_SCF']));
  // faint box-axes triad at the bus centre, shown when the bus is moved or turned
  const busTriad = makeTriad(0.55, 0.006, ['x_bus', 'y_bus', 'z_bus'], { opacity: .45, labelScale: .75 }); V.scene.add(busTriad);
  // where Earth, along-track and the orbit normal are in nominal flight (from the attitude reference)
  const dirArrows = {
    nadir: new Arrow(0x6fb7ff, 1.55, 0.01, { label: '→ Earth (nadir)', opacity: .8 }),
    alongTrack: new Arrow(COL.cyan, 1.45, 0.01, { label: '→ along-track', opacity: .8 }),
    normal: new Arrow(COL.eig, 1.35, 0.01, { label: '→ orbit normal', opacity: .8 }),
  };
  Object.values(dirArrows).forEach(a => V.scene.add(a));
  function updateDirs() { const d = nominalDirections(S.sc.align); for (const [k, a] of Object.entries(dirArrows)) { a.setDir(d[k]); a.visible = !!S.layout.show.orbitDirs; } }
  const axisW = createAxisWidget(V, ['X', 'Y', 'Z']);
  let model = null, ver = -1, dragging = false;
  const selBox = new THREE.BoxHelper(undefined, 0xf2a93b); selBox.visible = false; V.scene.add(selBox);

  // CoM marker (classic quadrant symbol)
  const comTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#111' : '#f2f2f2'; x.beginPath(); x.moveTo(32, 32); x.arc(32, 32, 30, i * Math.PI / 2, (i + 1) * Math.PI / 2); x.fill(); } x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.stroke(); return new THREE.CanvasTexture(c); })();
  const com = new THREE.Group(); V.scene.add(com);
  { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: comTex, depthTest: false, sizeAttenuation: false })); sp.scale.set(.035, .035, 1); sp.renderOrder = 1000; sp.center.set(.5, .5); com.add(sp); com.add(makeLabel('CoM', '#f2f2f2', 22, { scale: .8 })); }
  const principal = new THREE.Group(); V.scene.add(principal);

  /* ---------- gizmo ---------- */
  const tc = new TransformControls(V.camera, renderer.domElement); tc.setSize(0.8); tc.setSpace('world'); V.scene.add(tc); tc.enabled = false;
  tc.addEventListener('dragging-changed', e => { V.controls.enabled = !e.value && S.tab === 'layout'; dragging = e.value; if (!e.value) { scChanged(); ver = scVersion(); refreshMass(); syncAll(); } });
  tc.addEventListener('objectChange', () => {
    const c = sel(); const g = tc.object; if (!c || !g) return;
    c.pos = [g.position.x, g.position.y, g.position.z].map(x => +x.toFixed(4)); c.q = AM.q.unit({ w: g.quaternion.w, x: g.quaternion.x, y: g.quaternion.y, z: g.quaternion.z });
    selBox.update(); refreshMass(); syncAll();
  });

  /** Selected part: a component, the bus ('bus'), or null. */
  function sel() { return S.layout.sel === 'bus' ? S.sc.bus : S.sc.comps.find(c => c.id === S.layout.sel) || null; }
  function rebuild() {
    if (model) { tc.detach(); V.scene.remove(model); disposeTree(model); }
    const sh = S.layout.show;
    model = buildSC(S.sc, { cones: sh.cones, excl: sh.excl, labels: sh.labels, busOpacity: sh.bus, dipoles: true });
    V.scene.add(model); ver = scVersion(); attach(); refreshMass();
    const bp = busPose(S.sc);
    busTriad.position.set(...bp.pos); setObjFromCBR(busTriad, AM.m.T(bp.C));
    busTriad.visible = AM.v.norm(bp.pos) > 1e-9 || Math.abs(bp.C[0][0] + bp.C[1][1] + bp.C[2][2] - 3) > 1e-9;
    updateDirs();
  }
  function attach() {
    const g = model && (S.layout.sel === 'bus' ? model.busGroup : model.compGroups[S.layout.sel]);
    if (g && S.layout.gizmo !== 'off' && S.tab === 'layout') { tc.attach(g); tc.setMode(S.layout.gizmo); tc.enabled = true; } else { tc.detach(); tc.enabled = false; }
    selBox.visible = !!g; if (g) { selBox.setFromObject(g); }
  }

  /* ---------- mass properties ---------- */
  let MP = massProps(S.sc);
  function refreshMass() {
    MP = massProps(S.sc); com.position.set(...MP.com); com.visible = S.layout.show.com;
    principal.clear(); principal.visible = S.layout.show.principal;
    MP.E.vecs.forEach((v_, k) => { const L = 1.2; principal.add(dashedLine([AM.v.scale(v_, -L), AM.v.scale(v_, L)], 0xc48bff, .05, .035, .9)); const lb = makeLabel(`I${k + 1} ${MP.E.vals[k].toFixed(1)}`, '#c48bff', 20, { scale: .75 }); lb.position.set(...AM.v.scale(v_, L)); principal.add(lb); });
    principal.position.set(...MP.com);
  }

  function update() {
    if (ver !== scVersion() && !dragging) rebuild();
    if (selBox.visible && tc.object) selBox.update();
    V.controls.update();
  }
  function render() { renderFull(V); axisW.render(); }

  /* ---------- picking ---------- */
  const raycaster = new THREE.Raycaster(); let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { if (S.tab !== 'layout') return; down = { x: e.clientX, y: e.clientY, onGizmo: tc.axis !== null && tc.enabled }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (S.tab !== 'layout' || !down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; const og = down.onGizmo; down = null; if (moved || og || !model) return;
    const r = renderer.domElement.getBoundingClientRect(); raycaster.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -(e.clientY - r.top) / r.height * 2 + 1 }, V.camera);
    const hits = raycaster.intersectObject(model, true).filter(h_ => h_.object.isMesh && !h_.object.userData.noPick && h_.object.userData.compId);
    select(hits.length ? hits[0].object.userData.compId : null);
  });
  function select(id) { S.layout.sel = id; save(); attach(); renderRail(); }

  /* ---------- component editor ---------- */
  function compEditor(c) {
    const T = TYPES[c.type];
    const setPos = (k, x) => { c.pos[k] = x; scChanged(); };
    const point = d => { c.q = qFromBoresight(d, Math.abs(d[2]) > .9 ? [1, 0, 0] : [0, 0, 1]); scChanged(); syncAll(); };
    const spin = () => { const C = AM.q2C(c.q); c.q = AM.C2q(AM.m.mul(AM.Rp(3, Math.PI / 2), C)); scChanged(); syncAll(); };
    const param = (key, label, step, dec, min = 0) => numCell('p-' + key, label, () => c[key], x => { c[key] = Math.max(min, x); scChanged(); refreshMass(); }, step, dec);
    const params = [param('mass', 'Mass kg', .05, 2)];
    if (c.fov !== undefined) params.push(param('fov', 'FOV full °', .5, 1));
    if (c.type === 'str') params.push(param('sunExcl', 'Sun excl. °', 1, 0), param('earthExcl', 'Earth excl. °', 1, 0));
    if (c.type === 'mtq') params.push(param('dipole', 'Dipole A·m²', 1, 1), param('len', 'Length m', .01, 2));
    if (c.type === 'rw') params.push(param('hmax', 'H max N·m·s', .05, 2));
    if (c.type === 'sa') params.push(param('w', 'Width m', .05, 2), param('h', 'Height m', .05, 2));
    const delBtn = confirmButton('Delete', 'Click again to delete', () => { S.sc.comps = S.sc.comps.filter(x => x.id !== c.id); S.layout.sel = null; scChanged(); renderRail(); });
    const axName = axisName(c.type);
    const nameIn = h('input', { type: 'text', id: 'cname', value: c.name, 'aria-label': 'Component name' }); nameIn.addEventListener('change', () => { c.name = nameIn.value.slice(0, 24) || c.name; scChanged(); renderRail(); });
    return card('Selected · ' + T.label, '+Z_C = ' + axName,
      h('div', { class: 'row two' }, h('label', { for: 'cname' }, 'Name'), nameIn),
      h('div', { class: 'lbl' }, 'Position in SCF (m)'),
      h('div', { class: 'grid3' }, [0, 1, 2].map(k => numCell('pos' + k, 'xyz'[k], () => c.pos[k], x => setPos(k, x), .01, 3))),
      h('div', { class: 'lbl' }, 'Orientation in SCF'),
      oriEditor('c', () => c.q, q => { c.q = q; scChanged(); }, 'C'),
      h('div', { class: 'lbl' }, 'Point ' + axName + ' along'),
      h('div', { class: 'btns' }, [['+X', [1, 0, 0]], ['−X', [-1, 0, 0]], ['+Y', [0, 1, 0]], ['−Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['−Z', [0, 0, -1]]].map(([t, d]) => h('button', { class: 'btn mono', onclick: () => point(d) }, t)), h('button', { class: 'btn', onclick: spin }, '↻ 90° about own Z')),
      h('div', { class: 'grid3' }, params),
      h('div', { class: 'kv' }, h('dt', null, axName + ' in SCF'), h('dd', null, liveText(() => '[' + compAxis(c).map(x => fmt(x, 4)).join(', ') + ']')),
        h('dt', null, 'q_BC [q₀ q₁ q₂ q₃]'), h('dd', null, liveText(() => [c.q.w, c.q.x, c.q.y, c.q.z].map(x => fmt(x, 4)).join(' ')))),
      tip('A sensor measures in its own frame C. To use it, rotate into body: v_B = C_CBᵀ · v_C. A star tracker reports q_CI; the body attitude is C_BI = C_CBᵀ · C_CI.'),
      gizmoRow(),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => { const n = JSON.parse(JSON.stringify(c)); n.id = newId(); n.name = c.name + ' copy'; n.pos = n.pos.map((x, k) => k === 0 ? x + 0.1 : x); S.sc.comps.push(n); S.layout.sel = n.id; scChanged(); renderRail(); } }, 'Duplicate'),
        delBtn,
        h('button', { class: 'btn', onclick: () => select(null) }, 'Deselect'))
    );
  }

  /* ---------- shared editor pieces ---------- */
  function oriEditor(id, get, set, child) {
    const L = S.layout;
    return orientationEditor({ id, get, set, child, tab: () => L.oriTab, setTab: t => { L.oriTab = t; save(); }, dcmDir: () => L.dcmDir, setDcmDir: d => { L.dcmDir = d; save(); } });
  }
  function gizmoRow() {
    return h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'lbl' }, 'Drag handle'), seg([['translate', 'Move'], ['rotate', 'Rotate'], ['off', 'Off']], () => S.layout.gizmo, v => { S.layout.gizmo = v; save(); attach(); }));
  }

  /* ---------- bus editor ---------- */
  function busEditor() {
    const b = S.sc.bus;
    const size = (k, l) => numCell('b' + k, l, () => b[k], x => { b[k] = Math.max(.05, x); scChanged(); refreshMass(); }, .05, 2);
    // "Move the origin to a bus face": shift the whole satellite so that face centre sits at SCF 0
    const toFace = spec => {
      const a = [0, 0, 0], k = 'XYZ'.indexOf(spec[1]); a[k] = (spec[0] === '-' ? -1 : 1) * [b.x, b.y, b.z][k] / 2;
      const d = AM.v.scale(busPointToSCF(S.sc, a), -1);
      b.pos = AM.v.add(b.pos, d).map(x => +x.toFixed(6)); S.sc.comps.forEach(c => { c.pos = AM.v.add(c.pos, d).map(x => +x.toFixed(6)); });
      scChanged(); refreshMass(); syncAll(); toast('Whole satellite shifted: bus ' + spec.replace('-', '−') + ' face centre is now the SCF origin');
    };
    return card('Selected · Bus structure', 'box edges = bus axes',
      h('div', { class: 'grid4' }, size('x', 'X m'), size('y', 'Y m'), size('z', 'Z m'), numCell('bm', 'Mass kg', () => b.mass, x => { b.mass = Math.max(0, x); scChanged(); refreshMass(); }, 1, 1)),
      h('div', { class: 'lbl' }, 'Box centre in SCF (m)'),
      h('div', { class: 'grid3' }, [0, 1, 2].map(k => numCell('bpos' + k, 'xyz'[k], () => b.pos[k], x => { b.pos[k] = x; scChanged(); refreshMass(); }, .01, 3))),
      h('div', { class: 'lbl' }, 'Orientation of the box in SCF'),
      oriEditor('b', () => b.q, q => { b.q = q; scChanged(); refreshMass(); }, 'box'),
      h('div', { class: 'lbl' }, 'Put the SCF origin at a bus face centre (moves everything)'),
      h('div', { class: 'btns' }, AXIS_SPECS.map(sp => h('button', { class: 'btn mono', onclick: () => toFace(sp) }, sp.replace('-', '−')))),
      tip('The bus is a part like the others. The dark face is the box +Z face. Typical CAD habit: put the launcher-interface face at the origin.'),
      gizmoRow(),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => select(null) }, 'Deselect')));
  }

  /* ---------- attitude reference (nominal alignment SCF vs orbital frame) ---------- */
  function alignCard() {
    const al = S.sc.align, L = S.layout;
    const changed = () => { scChanged(); updateDirs(); syncAll(); };
    const setMode = v => {
      if (v === al.mode) return;
      if (v === 'dcm') { al.dcm = alignMatrix(al); al.mode = 'dcm'; }
      else { const ax = axesOf(alignMatrix(al)); if (!ax) { toast('This DCM is not a 90° alignment; it can only be edited as a DCM'); syncAll(); return; } Object.assign(al, ax, { mode: 'axes', dcm: null }); }
      changed(); renderRail();
    };
    const R = al.ref.toUpperCase(), mean = REF_AXIS_MEANING[al.ref];
    const axisRow = (i, key) => {
      const sel_ = h('select', { id: 'al' + key, 'aria-label': `SCF axis along ${R} +${'XY'[i]}` }, AXIS_SPECS.map(a => h('option', { value: a }, 'SCF ' + a.replace('-', '−'))));
      sel_.addEventListener('change', () => {
        const other = key === 'x' ? al.y : al.x;
        if (!validPair(sel_.value, other)) { toast(`SCF ${sel_.value[1]} is already used by ${R} +${key === 'x' ? 'Y' : 'X'}`); sel_.value = al[key]; return; }
        al[key] = sel_.value; changed();
      });
      onSync(() => { sel_.value = al[key]; });
      return [h('span', { class: 'ax', style: `color:var(--ax-${'xyz'[i]})` }, `${R} +${'XY'[i]}`), h('span', { class: 'mean' }, mean[i]), sel_];
    };
    const table = al.mode === 'axes' ? h('div', { class: 'altable' },
      ...axisRow(0, 'x'), ...axisRow(1, 'y'),
      h('span', { class: 'ax', style: 'color:var(--ax-z)' }, `${R} +Z`), h('span', { class: 'mean' }, mean[2]),
      liveText(() => dirText(AM.m.col(alignMatrix(al), 2)) + ' (auto)', 'lbl'))
      : dcmInput({ id: 'alDcm', get: () => alignMatrix(al), set: C => { al.dcm = C; changed(); },
        labels: [`C_SCF←${R} (columns = ${R} axes)`, `C_${R}←SCF (rows = ${R} axes)`], dir: () => L.alignDcmDir, setDir: d => { L.alignDcmDir = d; save(); } });
    const el = card('Attitude reference', 'nominal attitude',
      selectRow({ id: 'alRef', label: 'Reference frame', options: REF_IDS.map(id => [id, id.toUpperCase() + ' · ' + mean_(id)]), get: () => al.ref, set: v => { al.ref = v; changed(); renderRail(); } }),
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'lbl' }, 'Define by'), seg([['axes', 'Axis table'], ['dcm', 'DCM']], () => al.mode, setMode)),
      table,
      h('div', { class: 'lbl' }, 'In nominal flight'),
      h('div', { class: 'kv' },
        h('dt', null, 'Earth (nadir) →'), h('dd', null, liveText(() => dirText(nominalDirections(al).nadir))),
        h('dt', null, 'Along-track →'), h('dd', null, liveText(() => dirText(nominalDirections(al).alongTrack))),
        h('dt', null, 'Orbit normal →'), h('dd', null, liveText(() => dirText(nominalDirections(al).normal)))),
      h('div', { class: 'btns' },
        check('l-dirs', 'Show in 3D', () => S.layout.show.orbitDirs, v => { S.layout.show.orbitDirs = v; save(); updateDirs(); }),
        h('button', { class: 'btn', onclick: () => { S.sc.align = defaultAlign(); changed(); renderRail(); } }, 'Reset: SCF = VVLH')),
      tip('Build the satellite in its own frame, then say how it flies: which SCF axis each reference axis points along. The Orbit tab mode "Nominal attitude + offsets" flies this, with roll/pitch/yaw on top. Directions shown assume a circular orbit.'));
    return el;
  }
  const mean_ = id => ({ vvlh: 'Z nadir, X along-track', lvlh: 'X radial, Z orbit normal', vnc: 'X velocity, Y orbit normal' })[id];

  /* ---------- control rail ---------- */
  function panel() {
    const out = [], b = S.sc.bus, sh = S.layout.show;
    if (S.layout.sel === 'bus') out.push(busEditor()); else { const c = sel(); if (c) out.push(compEditor(c)); }
    const typeSel = h('select', { id: 'addType', 'aria-label': 'Component type' }, Object.entries(TYPES).map(([k, t]) => h('option', { value: k }, t.label)));
    const busItem = h('button', { class: 'comp' + (S.layout.sel === 'bus' ? ' sel' : ''), onclick: () => select('bus') }, h('i', { style: 'background:' + BUS_COLOR }), h('span', null, 'Bus'), h('small', null, [b.x, b.y, b.z].map(x => x.toFixed(2)).join(' × ') + ' m'));
    const list = h('div', { class: 'complist' }, busItem, S.sc.comps.map(cc => h('button', { class: 'comp' + (cc.id === S.layout.sel ? ' sel' : ''), onclick: () => select(cc.id) }, h('i', { style: 'background:' + TYPES[cc.type].color }), h('span', null, cc.name), h('small', null, compAxis(cc).map(x => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)).join(' ')))));
    const addComp = () => { const t = typeSel.value; const n = S.sc.comps.filter(x => x.type === t).length + 1; const cc = mkComp(t, t.toUpperCase() + '-' + n, busPointToSCF(S.sc, [0, 0, -b.z / 2 - 0.05]), busDirToSCF(S.sc, [0, 0, -1]), busDirToSCF(S.sc, [1, 0, 0])); S.sc.comps.push(cc); S.layout.sel = cc.id; scChanged(); renderRail(); };
    out.push(card('Components', S.sc.comps.length + ' items',
      h('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:6px' }, typeSel, h('button', { class: 'btn primary', onclick: addComp }, '+ Add')),
      list, tip('Everything is placed in the spacecraft frame (SCF), like a CAD model. Click a part (or the bus) in the 3D view or the list; drag the handles to move or rotate it. Right column: unit vector of its +Z axis in SCF.')));
    out.push(alignCard());
    out.push(card('Mass properties', 'about CoM, SCF axes',
      h('div', { class: 'kv' }, h('dt', null, 'Total mass'), h('dd', null, liveText(() => MP.M.toFixed(2) + ' kg')), h('dt', null, 'CoM in SCF (m)'), h('dd', null, liveText(() => '[' + MP.com.map(x => fmt(x, 4)).join(', ') + ']'))),
      h('div', { class: 'lbl' }, 'Inertia tensor J (kg·m²)'), h('div', { class: 'mat' }, liveText(() => matHTML(MP.I, 3), 'contents')),
      h('div', { class: 'kv' }, h('dt', null, 'Principal moments'), h('dd', null, liveText(() => MP.E.vals.map(x => x.toFixed(2)).join(' · '))),
        h('dt', null, 'Max principal-axis tilt'), h('dd', null, liveText(() => maxPrincipalTilt(MP.E).toFixed(2) + '°'))),
      h('div', { class: 'checks' }, check('l-com', 'Show CoM', () => sh.com, v => { sh.com = v; save(); refreshMass(); }), check('l-pr', 'Principal axes', () => sh.principal, v => { sh.principal = v; save(); refreshMass(); })),
      tip('Bus = uniform box, parts = point masses (arrays as thin plates). Off-diagonal terms couple the axes in Euler\'s equation J·ω̇ + ω×(J·ω) = τ.')));
    out.push(card('Actuator authority', 'per body axis',
      h('div', { class: 'kv' },
        h('dt', null, 'RW momentum envelope (N·m·s)'), h('dd', null, liveText(() => { const e = envelope(S.sc.comps, 'rw', 'hmax'); return e ? 'X ' + e[0].toFixed(2) + ' · Y ' + e[1].toFixed(2) + ' · Z ' + e[2].toFixed(2) : '—'; })),
        h('dt', null, 'MTQ dipole (A·m²)'), h('dd', null, liveText(() => { const e = envelope(S.sc.comps, 'mtq', 'dipole'); return e ? 'X ' + e[0].toFixed(1) + ' · Y ' + e[1].toFixed(1) + ' · Z ' + e[2].toFixed(1) : '—'; }))),
      h('div', { class: 'lbl' }, 'RW spin-axis matrix A (columns = wheels), h_B = A · h_w'),
      liveText(() => { const ws = S.sc.comps.filter(x => x.type === 'rw'); if (!ws.length) return '<p class="tip">No reaction wheels.</p>'; const ax = ws.map(compAxis); return `<div class="mat" style="grid-template-columns:repeat(${ws.length},1fr)">${[0, 1, 2].map(r => ax.map(a => `<div>${fmtS(a[r], 3)}</div>`).join('')).join('')}</div>`; }, 'contents'),
      tip('Envelope = Σ hmax·|sᵢ·e| along each body axis (every wheel saturated with the right sign). Four wheels in a pyramid keep 3-axis control if one fails.')));
    out.push(card('Display', null, h('div', { class: 'checks' },
      check('l-cones', 'FOV cones', () => sh.cones, v => { sh.cones = v; scChanged(); }), check('l-excl', 'STR Sun-exclusion', () => sh.excl, v => { sh.excl = v; scChanged(); }),
      check('l-lbl', 'Labels', () => sh.labels, v => { sh.labels = v; scChanged(); })),
      slider({ id: 'busop', label: 'Bus opacity', min: .1, max: 1, step: .05, dec: 2, get: () => sh.bus, set: x => { sh.bus = x; scChanged(); } })));
    out.push(card('Save & share', null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => copyText(JSON.stringify({ atttool: 1, sc: S.sc }, null, 1), 'Configuration JSON') }, 'Copy config JSON'),
        h('button', { class: 'btn', onclick: importDlg }, 'Import JSON…'),
        h('button', { class: 'btn', onclick: () => copyText(exportPython(S.sc, MP), 'Mounting matrices') }, 'Copy mounting matrices (Python)'),
        h('button', { class: 'btn', onclick: () => copyText(exportMatlab(S.sc, MP), 'Mounting matrices') }, 'Copy as MATLAB'),
        h('button', { class: 'btn', onclick: importOrientationsDlg }, 'Import orientations…')),
      h('div', { class: 'btns' }, confirmButton('Reset to example spacecraft', 'Click again to reset', () => { S.sc = defaultSC(); S.layout.sel = null; scChanged(); renderRail(); })),
      tip('Your layout is kept in this browser automatically. Copy the JSON to keep a file or move it to another computer.')));
    return out;
  }

  function importDlg() {
    const ta = h('textarea', { style: 'width:100%;min-height:220px', placeholder: 'Paste a configuration JSON copied from AttTool' });
    const err = h('p', { class: 'tip', style: 'color:var(--bad)' });
    const doImport = () => {
      try { S.sc = sanitizeSpacecraft(JSON.parse(ta.value)); S.layout.sel = null; scChanged(); closeModal(); renderRail(); toast('Configuration imported'); }
      catch (e) { err.textContent = 'Could not import: ' + e.message; }
    };
    showModal(h('div', null, h('h2', null, 'Import configuration'), ta, err, h('div', { class: 'btns', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: doImport }, 'Import'))));
  }

  /* ---------- import orientations by name ---------- */
  function importOrientationsDlg() {
    const L = S.layout; const o = L.imp || (L.imp = { dir: 'CS', order: 'first', fix: true });
    const ta = h('textarea', { style: 'width:100%;min-height:170px', spellcheck: 'false', placeholder: 'STR_1_C_CB = [0.34 0.5 -0.8; …];\nSTR-2 = [w x y z]\n{"MAG": [[1,0,0],[0,1,0],[0,0,1]]}' });
    const file = h('input', { type: 'file', accept: '.json,.txt,.m,.py,.csv,text/plain,application/json', 'aria-label': 'Load file' });
    const result = h('div', { class: 'imp-result' }), applyBtn = h('button', { class: 'btn primary', disabled: true }, 'Apply');
    let rows = [];
    const toggle = (opts, key) => { const w = h('div', { class: 'seg', role: 'group' }); const bs = opts.map(([v, t]) => { const b = h('button', { type: 'button', onclick: () => { o[key] = v; save(); bs.forEach(x => x.classList.toggle('on', x._v === v)); preview(); } }, t); b._v = v; b.classList.toggle('on', o[key] === v); w.append(b); return b; }); return w; };
    const fixBox = h('input', { type: 'checkbox', id: 'impfix' }); fixBox.checked = o.fix; fixBox.addEventListener('change', () => { o.fix = fixBox.checked; save(); preview(); });
    const STATUS = { ok: ['ok', 'update'], fixed: ['warn', 'update · fixed'], same: ['dim', 'no change'], unmatched: ['dim', 'no match'], ambiguous: ['bad', 'ambiguous'], error: ['bad', 'error'] };
    function preview() {
      result.innerHTML = ''; rows = [];
      if (!ta.value.trim()) { applyBtn.disabled = true; applyBtn.textContent = 'Apply'; return; }
      try { rows = planImport(S.sc, parseOrientations(ta.value), o); } catch (e) { result.append(h('p', { class: 'tip', style: 'color:var(--bad)' }, 'Could not read: ' + e.message)); }
      if (!rows.length) result.append(h('p', { class: 'tip' }, 'Nothing recognised yet. Use name = [9 numbers] for a DCM, [4] for a quaternion, [3] for a position, or JSON.'));
      else result.append(h('table', { class: 'imp' },
        h('thead', null, h('tr', null, ['In file', 'Part', 'Change', 'Status'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(r => { const [cls, txt] = STATUS[r.status];
          const chg = [r.q && r.status !== 'unmatched' ? r.angle.toFixed(r.angle < 1 ? 3 : 1) + '°' : '', r.pos ? (r.dPos * 1000).toFixed(1) + ' mm' : ''].filter(Boolean).join(' · ');
          return h('tr', null, h('td', { class: 'mono' }, r.name), h('td', null, r.label || '—'), h('td', { class: 'mono' }, chg || '—'),
            h('td', null, h('span', { class: 'chip ' + cls, title: r.msg }, txt), r.msg ? h('small', null, ' ' + r.msg) : null)); }))));
      const n = rows.filter(r => r.status === 'ok' || r.status === 'fixed').length;
      applyBtn.disabled = !n; applyBtn.textContent = n ? `Apply ${n} change${n > 1 ? 's' : ''}` : 'Nothing to apply';
    }
    let tmr = 0; ta.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(preview, 250); });
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; f.text().then(t => { ta.value = t; preview(); }); });
    applyBtn.addEventListener('click', () => { const n = applyImport(S.sc, rows); scChanged(); closeModal(); renderRail(); toast(`Updated ${n} part${n === 1 ? '' : 's'}`); });
    showModal(h('div', null, h('h2', null, 'Import orientations'),
      h('p', { class: 'tip' }, 'Paste or load a DCM, quaternion or position per part, matched by name: MATLAB (STR_1 = [a b c; d e f; g h i];), NumPy, JSON, or AttTool\'s own MATLAB / Python export. Nothing changes until you press Apply.'),
      h('div', { class: 'btns', style: 'align-items:center' }, file),
      ta,
      h('div', { class: 'imp-opts' },
        h('span', { class: 'lbl' }, 'Matrices / quaternions map'), toggle([['CS', 'SCF → part (C_C←SCF)'], ['SC', 'part → SCF (C_SCF←C)']], 'dir'),
        h('span', { class: 'lbl' }, 'Quaternion arrays'), toggle([['first', 'scalar first'], ['last', 'scalar last']], 'order'),
        h('label', { class: 'chk', for: 'impfix' }, fixBox, 'Orthonormalise near-rotations')),
      h('p', { class: 'tip' }, 'Name suffixes fix the meaning and override these options: _C_CB, _C_BC, _q_BC (scalar first), _q, _pos_B. "CSS-+X" is written CSS_pX, "SA −Y" SA_mY.'),
      result,
      h('div', { class: 'btns', style: 'margin-top:8px' }, applyBtn)));
    ta.focus();
  }

  /* ---------- viewport overlays ---------- */
  function hud() {
    $('#hudTL').append(h('div', { class: 'hud' }, h('h4', null, 'Spacecraft frame SCF = body frame B'),
      liveText(() => { const d = nominalDirections(S.sc.align);
        return `<p class="tip">Build in SCF like a CAD model.<br>Nominal flight (${S.sc.align.ref.toUpperCase()}): Earth → <b>${dirText(d.nadir)}</b> · along-track → <b>${dirText(d.alongTrack)}</b></p>`; }),
      liveText(() => { const c = sel(); return c ? `<p class="tip" style="margin-top:6px">Selected <b>${S.layout.sel === 'bus' ? 'Bus' : c.name}</b> at [${c.pos.map(x => fmt(x, 2)).join(', ')}] m</p>` : '<p class="tip" style="margin-top:6px">Click a part to select it.</p>'; })));
    const vb = (t, d) => h('button', { class: 'vbtn', onclick: () => viewPreset(V, d, 3.6) }, t);
    $('#hudTR').append(vb('Iso', [1, -1.1, .75]), vb('+X', [1, 0, 0.0001]), vb('−X', [-1, 0, 0.0001]), vb('+Y', [0, 1, 0.0001]), vb('−Y', [0, -1, 0.0001]), vb('+Z', [0, -0.0001, 1]), vb('−Z', [0, -0.0001, -1]));
  }

  function enter() { if (ver !== scVersion()) rebuild(); attach(); axisW.show(true); }
  function leave() { tc.detach(); tc.enabled = false; axisW.show(false); }
  return { V, update, render, panel, hud, enter, leave };
}
