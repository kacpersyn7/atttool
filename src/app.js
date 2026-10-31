/**
 * App shell: creates the renderer and the three workspaces, wires tabs / keyboard / resize,
 * rebuilds the control rail, and runs the animation loop.
 */
import { S, save } from './state/store.js';
import { $, resetBindings, syncAll, tickLive } from './ui/dom.js';
import { closeModal } from './ui/overlay.js';
import { showConventions } from './ui/conventions.js';
import { VERSION } from './version.js';
import { gfx, initRenderer, sizeOf } from './gfx/renderer.js';
import { createRotationLab } from './views/rotationLab.js';
import { createOrbitView } from './views/orbit/orbitView.js';
import { createLayoutView } from './views/layout.js';

const TAB_KEYS = { '1': 'rot', '2': 'orbit', '3': 'layout' };

export function startApp() {
  initRenderer($('#vp'));
  const ctx = { renderRail: () => renderRail() };
  /** Workspaces by tab id. Each: { V, update, render, panel, hud, init?, enter?, leave?, tick? } */
  const VIEWS = { rot: createRotationLab(ctx), orbit: createOrbitView(ctx), layout: createLayoutView(ctx) };

  /** Rebuild the left rail and the viewport HUD for the current tab. */
  function renderRail() {
    resetBindings();
    const rail = $('#rail'); const st = rail.scrollTop; rail.innerHTML = ''; rail.append(...VIEWS[S.tab].panel());
    $('#hudTL').innerHTML = ''; $('#hudTR').innerHTML = ''; VIEWS[S.tab].hud();
    syncAll(); tickLive(); rail.scrollTop = st;
  }

  function setTab(t) {
    if (!VIEWS[t]) return; const prev = VIEWS[S.tab];
    prev.V.controls.enabled = false; prev.leave && prev.leave();
    S.tab = t; save();
    document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    const v = VIEWS[t]; v.V.controls.enabled = true; v.enter && v.enter();
    $('#caption').hidden = true; $('#rail').scrollTop = 0; renderRail(); resize();
  }

  function resize() {
    const { w, h } = sizeOf(); gfx.renderer.setSize(w, h, false);
    for (const v of Object.values(VIEWS)) { v.V.camera.aspect = w / h; v.V.camera.updateProjectionMatrix(); }
  }

  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  new ResizeObserver(resize).observe(gfx.vp);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal').hidden) { closeModal(); return; } // also while typing in a dialog
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (TAB_KEYS[e.key]) setTab(TAB_KEYS[e.key]);
    else if (e.key === ' ' && S.tab === 'orbit') { S.orbit.playing = !S.orbit.playing; save(); syncAll(); e.preventDefault(); }
    else if (e.key === 'Escape') closeModal();
  });
  $('#btnConv').addEventListener('click', showConventions);
  $('#ver').textContent = 'v' + VERSION;

  // main loop: 3D every frame, rail readouts ~10 Hz
  let last = performance.now(), acc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const v = VIEWS[S.tab];
    try { v.update(dt); v.render(); } catch (e) { console.error(e); }
    acc += dt;
    if (acc > 0.1) { acc = 0; tickLive(); v.tick && v.tick(); }
  }

  // boot
  for (const v of Object.values(VIEWS)) v.init && v.init();
  const fromHash = location.hash.replace('#', ''); if (VIEWS[fromHash]) S.tab = fromHash;
  const start = S.tab; S.tab = 'rot'; VIEWS.rot.V.controls.enabled = false; setTab(start);
  requestAnimationFrame(loop);

  return { VIEWS, setTab, renderRail };
}
