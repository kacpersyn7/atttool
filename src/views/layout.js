/**
 * Workspace 3 — Spacecraft Layout.
 * Place and orient components on the bus (click to select, drag gizmo to move/rotate),
 * live mass properties and actuator authority, JSON import/export and NumPy export.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as AM from '../core/attitude.js';
import { S, save, scVersion, scChanged } from '../state/store.js';
import { $, h, card, tip, slider, numCell, check, seg, liveText, syncAll, confirmButton } from '../ui/dom.js';
import { toast, showModal, closeModal, copyText } from '../ui/overlay.js';
import { deg, rad, fmt, fmtS, matHTML } from '../ui/format.js';
import { gfx, mkView, addLights, viewPreset, renderFull } from '../gfx/renderer.js';
import { makeTriad, makeLabel, dashedLine, disposeTree } from '../gfx/primitives.js';
import { buildSC } from '../gfx/spacecraftMesh.js';
import { TYPES, axisName } from '../spacecraft/componentTypes.js';
import { newId, mkComp, qFromBoresight, compAxis, envelope, sanitizeSpacecraft } from '../spacecraft/component.js';
import { defaultSC } from '../spacecraft/exampleSpacecraft.js';
import { massProps, maxPrincipalTilt } from '../spacecraft/massProperties.js';
import { exportPython } from '../spacecraft/exportPython.js';

/** 3-2-1 mounting angles (deg) of a component, cached on the component as c.eul. */
const eulOf = c => AM.C2euler('321', AM.q2C(c.q)).map(deg);

export function createLayoutView({ renderRail }) {
  const renderer = gfx.renderer;
  const V = mkView({ up: [0, 0, -1], pos: [2.3, -2.5, -1.5], fov: 38, near: 0.01, far: 100 });
  addLights(V.scene, 1.1);
  const grid = new THREE.GridHelper(4, 20, 0x2a3a52, 0x18222f); grid.rotation.x = Math.PI / 2; V.scene.add(grid);
  V.scene.add(makeTriad(1.0, 0.012, ['X_B', 'Y_B', 'Z_B ⊕ nadir']));
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
    c.eul = eulOf(c); selBox.update(); refreshMass(); syncAll();
  });

  function sel() { return S.sc.comps.find(c => c.id === S.layout.sel) || null; }
  function rebuild() {
    if (model) { tc.detach(); V.scene.remove(model); disposeTree(model); }
    const sh = S.layout.show;
    model = buildSC(S.sc, { cones: sh.cones, excl: sh.excl, labels: sh.labels, busOpacity: sh.bus, dipoles: true });
    V.scene.add(model); ver = scVersion(); attach(); refreshMass();
    grid.position.z = S.sc.bus.z / 2 + 0.35;
  }
  function attach() {
    const c = sel(); const g = c && model && model.compGroups[c.id];
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
  function render() { renderFull(V); }

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
    if (!c.eul) c.eul = eulOf(c);
    const setPos = (k, x) => { c.pos[k] = x; scChanged(); };
    const setEul = (k, x) => { c.eul[k] = x; c.q = AM.C2q(AM.euler2C('321', c.eul.map(rad))); scChanged(); };
    const point = d => { c.q = qFromBoresight(d, Math.abs(d[2]) > .9 ? [1, 0, 0] : [0, 0, 1]); c.eul = eulOf(c); scChanged(); syncAll(); };
    const spin = () => { const C = AM.q2C(c.q); c.q = AM.C2q(AM.m.mul(AM.Rp(3, Math.PI / 2), C)); c.eul = eulOf(c); scChanged(); syncAll(); };
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
    const axLbl = (name, color, ax) => h('span', null, name + ' · ', h('span', { class: 'ax', style: 'color:var(--ax-' + color + ')' }, ax));
    return card('Selected · ' + T.label, '+Z_C = ' + axName,
      h('div', { class: 'row two' }, h('label', { for: 'cname' }, 'Name'), nameIn),
      h('div', { class: 'lbl' }, 'Position in body frame (m)'),
      h('div', { class: 'grid3' }, [0, 1, 2].map(k => numCell('pos' + k, 'xyz'[k], () => c.pos[k], x => setPos(k, x), .01, 3))),
      h('div', { class: 'lbl' }, 'Mounting · 3-2-1 from body axes'),
      slider({ id: 'my', label: axLbl('Yaw', 'z', 'Z_B'), min: -180, max: 180, step: .5, get: () => c.eul[0], set: x => setEul(0, x) }),
      slider({ id: 'mp', label: axLbl('Pitch', 'y', 'Y′'), min: -90, max: 90, step: .5, get: () => c.eul[1], set: x => setEul(1, x) }),
      slider({ id: 'mr', label: axLbl('Roll', 'x', 'X″'), min: -180, max: 180, step: .5, get: () => c.eul[2], set: x => setEul(2, x) }),
      h('div', { class: 'lbl' }, 'Point ' + axName + ' along'),
      h('div', { class: 'btns' }, [['+X', [1, 0, 0]], ['−X', [-1, 0, 0]], ['+Y', [0, 1, 0]], ['−Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['−Z', [0, 0, -1]]].map(([t, d]) => h('button', { class: 'btn mono', onclick: () => point(d) }, t)), h('button', { class: 'btn', onclick: spin }, '↻ 90° about own Z')),
      h('div', { class: 'grid3' }, params),
      h('div', { class: 'kv' }, h('dt', null, axName + ' in body'), h('dd', null, liveText(() => '[' + compAxis(c).map(x => fmt(x, 4)).join(', ') + ']')),
        h('dt', null, 'q_BC [q₀ q₁ q₂ q₃]'), h('dd', null, liveText(() => [c.q.w, c.q.x, c.q.y, c.q.z].map(x => fmt(x, 4)).join(' ')))),
      h('div', { class: 'lbl' }, 'C_CB (body → component), rows = component axes in body'),
      h('div', { class: 'mat' }, liveText(() => matHTML(AM.q2C(c.q), 4), 'contents')),
      tip('A sensor measures in its own frame C. To use it, rotate into body: v_B = C_CBᵀ · v_C. A star tracker reports q_CI; the body attitude is C_BI = C_CBᵀ · C_CI.'),
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'lbl' }, 'Drag handle'), seg([['translate', 'Move'], ['rotate', 'Rotate'], ['off', 'Off']], () => S.layout.gizmo, v => { S.layout.gizmo = v; save(); attach(); })),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => { const n = JSON.parse(JSON.stringify(c)); n.id = newId(); n.name = c.name + ' copy'; n.pos = n.pos.map((x, k) => k === 0 ? x + 0.1 : x); S.sc.comps.push(n); S.layout.sel = n.id; scChanged(); renderRail(); } }, 'Duplicate'),
        delBtn,
        h('button', { class: 'btn', onclick: () => select(null) }, 'Deselect'))
    );
  }

  /* ---------- control rail ---------- */
  function panel() {
    const out = [], b = S.sc.bus, sh = S.layout.show;
    const c = sel(); if (c) out.push(compEditor(c));
    const typeSel = h('select', { id: 'addType', 'aria-label': 'Component type' }, Object.entries(TYPES).map(([k, t]) => h('option', { value: k }, t.label)));
    const list = h('div', { class: 'complist' }, S.sc.comps.map(cc => h('button', { class: 'comp' + (cc.id === S.layout.sel ? ' sel' : ''), onclick: () => select(cc.id) }, h('i', { style: 'background:' + TYPES[cc.type].color }), h('span', null, cc.name), h('small', null, compAxis(cc).map(x => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)).join(' ')))));
    const addComp = () => { const t = typeSel.value; const n = S.sc.comps.filter(x => x.type === t).length + 1; const cc = mkComp(t, t.toUpperCase() + '-' + n, [0, 0, -b.z / 2 - 0.05], [0, 0, -1], [1, 0, 0]); S.sc.comps.push(cc); S.layout.sel = cc.id; scChanged(); renderRail(); };
    out.push(card('Components', S.sc.comps.length + ' items',
      h('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:6px' }, typeSel, h('button', { class: 'btn primary', onclick: addComp }, '+ Add')),
      list, tip('Click a part in the 3D view or the list. Drag the handles to move or rotate it. Right column: unit vector of its +Z axis in body.')));
    out.push(card('Bus structure', 'body frame origin = bus centre',
      h('div', { class: 'grid4' }, numCell('bx', 'X m', () => b.x, x => { b.x = Math.max(.05, x); scChanged(); }, .05, 2), numCell('by', 'Y m', () => b.y, x => { b.y = Math.max(.05, x); scChanged(); }, .05, 2), numCell('bz', 'Z m', () => b.z, x => { b.z = Math.max(.05, x); scChanged(); }, .05, 2), numCell('bm', 'Mass kg', () => b.mass, x => { b.mass = Math.max(0, x); scChanged(); }, 1, 1)),
      slider({ id: 'busop', label: 'Bus opacity', min: .1, max: 1, step: .05, dec: 2, get: () => sh.bus, set: x => { sh.bus = x; scChanged(); } })));
    out.push(card('Mass properties', 'about CoM, body axes',
      h('div', { class: 'kv' }, h('dt', null, 'Total mass'), h('dd', null, liveText(() => MP.M.toFixed(2) + ' kg')), h('dt', null, 'CoM (m)'), h('dd', null, liveText(() => '[' + MP.com.map(x => fmt(x, 4)).join(', ') + ']'))),
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
      check('l-lbl', 'Labels', () => sh.labels, v => { sh.labels = v; scChanged(); }))));
    out.push(card('Save & share', null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => copyText(JSON.stringify({ atttool: 1, sc: S.sc }, null, 1), 'Configuration JSON') }, 'Copy config JSON'),
        h('button', { class: 'btn', onclick: importDlg }, 'Import JSON…'),
        h('button', { class: 'btn', onclick: () => copyText(exportPython(S.sc, MP), 'Mounting matrices') }, 'Copy mounting matrices (Python)')),
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

  /* ---------- viewport overlays ---------- */
  function hud() {
    $('#hudTL').append(h('div', { class: 'hud' }, h('h4', null, 'Body frame B (example EO convention)'),
      h('p', { class: 'tip', html: '<b style="color:var(--ax-z)">+Z</b> nadir (payload face, dark) · −Z zenith (up on screen)<br><b style="color:var(--ax-x)">+X</b> flight direction in nadir pointing · <b style="color:var(--ax-y)">+Y</b> completes the right-handed set' }),
      liveText(() => { const c = sel(); return c ? `<p class="tip" style="margin-top:6px">Selected <b>${c.name}</b> at [${c.pos.map(x => fmt(x, 2)).join(', ')}] m</p>` : '<p class="tip" style="margin-top:6px">Click a component to select it.</p>'; })));
    const vb = (t, d) => h('button', { class: 'vbtn', onclick: () => viewPreset(V, d, 3.6) }, t);
    $('#hudTR').append(vb('Iso', [1, -1.1, -.7]), vb('+X', [1, 0, -0.0001]), vb('−X', [-1, 0, -0.0001]), vb('+Y', [0, 1, -0.0001]), vb('−Y', [0, -1, -0.0001]), vb('+Z nadir', [0.0001, 0, 1]), vb('−Z zenith', [0.0001, 0, -1]));
  }

  function enter() { if (ver !== scVersion()) rebuild(); attach(); }
  function leave() { tc.detach(); tc.enabled = false; }
  return { V, update, render, panel, hud, enter, leave };
}
