/**
 * Draws the one-orbit availability timeline (sim/timeline.js) on a canvas; click to seek. On the Mode band (#56):
 * click a block to pick that change (band.pick, without seeking), drag a block's left edge to move its start
 * (band.move), double-click to add a change there (band.add). The band does not seek; playback pauses while dragging.
 */
import { S, save, scVersion } from '../../state/store.js';
import { syncAll } from '../../ui/dom.js';
import { clampTime, epochDate, formatEpoch } from '../../sim/scenario.js';
import { changeAtTime, startNear } from '../../sim/schedule.js';
import { computeTimeline } from '../../sim/timeline.js';

const LEFT = 112, RIGHT = 52; // px reserved for row names / percentages
/** Mode band colours and short names, by index in MODES (offsets, target, sun, inertial); slews are drawn faded. */
const MODE_COL = ['#4f8cff', '#46d38a', '#f2a93b', '#a99fe0'], MODE_NAME = ['Nominal', 'Target', 'Sun', 'Inertial'];

export function createTimelineView(tlc, band = {}) {
  let tl = null, drag = null, geom = null; // drag: { id, start, t, x0, W0, moved, pick, pointer }; geom: the band's place on the canvas, from the last draw
  tlc.style.touchAction = 'none'; // a drag on the band is a drag, not a pan

  function draw() {
    tl = computeTimeline(S, scVersion(), tl);
    const dpr = Math.min(2, devicePixelRatio || 1), W = tlc.clientWidth, rowH = 15, top = 16, Hh = top + tl.rows.length * rowH + 4;
    if (tlc.width !== Math.round(W * dpr) || tlc.height !== Math.round(Hh * dpr)) { tlc.width = Math.round(W * dpr); tlc.height = Math.round(Hh * dpr); tlc.style.height = Hh + 'px'; }
    const x = tlc.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, Hh);
    const L = LEFT, w = W - LEFT - RIGHT;
    x.font = '500 11px "JetBrains Mono", monospace'; x.textBaseline = 'middle';
    x.fillStyle = '#8697ae'; x.fillText('One orbit · ' + (tl.T / 60).toFixed(1) + ' min', 0, 7);
    for (let m = 10; m <= tl.T / 60; m += 10) { const px = L + m * 60 / tl.T * w; x.fillStyle = '#26375080'; x.fillRect(px, top - 2, 1, Hh - top); x.fillStyle = '#5d6e86'; x.textAlign = 'center'; x.fillText(m + 'm', px, 7); x.textAlign = 'left'; }
    tl.rows.forEach((r, i) => {
      const y = top + i * rowH; x.fillStyle = '#c8d3e2'; x.fillText(r.name.length > 15 ? r.name.slice(0, 14) + '…' : r.name, 0, y + rowH / 2);
      x.fillStyle = '#162232'; x.fillRect(L, y + 2, w, rowH - 4);
      for (let n = 0; n < tl.N; n++) {
        const val = r.v[n]; let col = null;
        if (r.kind === 'mode') col = MODE_COL[val % 10] ? MODE_COL[val % 10] + (val >= 10 ? '55' : 'b0') : null;
        else if (r.kind === 'ecl') col = val ? '#33496b' : null;
        else if (r.kind === 'str') col = val === 0 ? '#2f8f5f' : val === 2 ? '#f2a93b' : val === 4 ? '#a99fe0' : '#d65050';
        else if (r.kind === 'css') col = val ? '#d8b23e' : null;
        else if (r.kind === 'sa') col = `rgba(79,140,255,${0.15 + 0.85 * val})`;
        else if (r.kind === 'pl') col = val ? '#9fb0c8' : null;
        if (col) { x.fillStyle = col; x.fillRect(L + n / tl.N * w, y + 2, w / tl.N + .6, rowH - 4); }
      }
      if (r.kind === 'mode') { // name each run of one mode where it fits
        x.fillStyle = '#0a1018'; x.font = '600 10px "JetBrains Mono", monospace';
        const key = n => (r.v[n] % 10) + '|' + ((r.names && r.names[n]) || ''); // a run: one change (its name, else its mode)
        for (let n = 0; n < tl.N;) { let m = n; while (m < tl.N && key(m) === key(n)) m++; const px = (m - n) / tl.N * w;
          const nm = [(r.names && r.names[n]) || '', MODE_NAME[r.v[n] % 10] || ''].find(t => t && px > x.measureText(t).width + 8); // the name if it fits, else the mode
          if (nm) x.fillText(nm, L + n / tl.N * w + 4, y + rowH / 2); n = m; }
        x.font = '500 11px "JetBrains Mono", monospace';
      }
      x.fillStyle = '#8697ae'; x.textAlign = 'right'; x.fillText(tl.stats[i] === null ? '' : tl.stats[i].toFixed(0) + '%', W, y + rowH / 2); x.textAlign = 'left';
    });
    const cx = L + ((S.orbit.t - tl.W0) / tl.T) * w; x.fillStyle = '#ffffff'; x.fillRect(cx - 1, top - 4, 2, Hh - top + 4);
    const bi = tl.rows.findIndex(r => r.kind === 'mode'); geom = bi < 0 ? null : { L, w, y0: top + bi * rowH, y1: top + (bi + 1) * rowH };
    if (drag && drag.id && drag.moved && geom) { // the start being dragged, and its time
      const px = L + (drag.t - tl.W0) / tl.T * w; x.fillStyle = '#ffffff'; x.fillRect(px - 1, geom.y0, 2, geom.y1 - geom.y0);
      const lb = utc(drag.t).slice(11), lw = x.measureText(lb).width; x.fillStyle = '#0a1018e0'; x.fillRect(Math.min(W - lw - 6, Math.max(0, px - lw / 2 - 3)), 0, lw + 6, 14);
      x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.fillText(lb, Math.min(W - lw / 2 - 3, Math.max(lw / 2 + 3, px)), 7); x.textAlign = 'left';
    }
  }

  const dateOf = t => new Date(Math.round(epochDate(S.orbit).getTime() / 1000 + t) * 1000); // whole seconds
  const utc = t => dateOf(t).toISOString().slice(0, 19).replace('T', ' ');
  /** Time (s from the epoch) under a client x, within the window. */
  const timeAt = cx => { const r = tlc.getBoundingClientRect(), f = (cx - r.left - geom.L) / geom.w; return tl.W0 + Math.max(0, Math.min(1, f)) * tl.T; };
  const onBand = e => { if (!tl || !geom) return false; const r = tlc.getBoundingClientRect(), y = e.clientY - r.top, xx = e.clientX - r.left; return y >= geom.y0 && y < geom.y1 && xx >= geom.L && xx <= geom.L + geom.w; };
  const px = () => tl.T / geom.w; // seconds per pixel
  const edgeAt = cx => startNear(S.orbit, timeAt(cx), 5 * px(), tl.W0, tl.W0 + tl.T); // the nearest start within 5 px, in this window
  tlc.addEventListener('pointermove', e => {
    if (drag) {
      if (e.pointerId !== drag.pointer) return;
      if (!e.buttons) { cancel(); return; } // the button came up without a pointerup reaching us
      drag.moved = drag.moved || Math.abs(e.clientX - drag.x0) > 3;
      if (drag.id) drag.t = Math.round(Math.max(drag.W0, Math.min(drag.W0 + tl.T, drag.start + (e.clientX - drag.x0) * px()))); // where it was + how far the pointer went
      draw(); return;
    }
    tlc.style.cursor = onBand(e) ? (edgeAt(e.clientX) ? 'ew-resize' : 'pointer') : '';
  });

  tlc.addEventListener('pointerdown', e => {
    if (!tl) return;
    if (onBand(e)) { // the Mode band: pick, or drag a start; it does not seek
      if (e.button !== 0 || drag) return; // another button, or a second pointer during a drag
      e.preventDefault(); tlc.setPointerCapture(e.pointerId);
      const edge = edgeAt(e.clientX), t = timeAt(e.clientX);
      if (edge && S.orbit.playing) { S.orbit.playing = false; save(); syncAll(); } // the window must not page under a drag
      drag = { id: edge ? edge.id : null, start: edge ? edge.t : t, t: edge ? edge.t : t, x0: e.clientX, W0: tl.W0, moved: false, pick: edge ? edge.id : changeAtTime(S.orbit, t), pointer: e.pointerId };
      lastPress = { t, at: performance.now() }; // a double-click adds at the time of its first press
      return;
    }
    const r = tlc.getBoundingClientRect(), w = r.width - LEFT - RIGHT; const f = (e.clientX - r.left - LEFT) / w; if (f < 0 || f > 1) return;
    S.orbit.t = clampTime(S.orbit, tl.W0 + f * tl.T); S.orbit.playing = false; save(); syncAll();
  });

  let lastPress = null;
  const cancel = () => { drag = null; draw(); };
  const end = e => {
    if (!drag || e.pointerId !== drag.pointer) return; const d = drag; drag = null; try { tlc.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    if (d.id && d.moved) { if (band.move) band.move(d.id, formatEpoch(dateOf(d.t))); } // the same format as every other start
    else if (band.pick) band.pick(d.pick); // a press inside a block picks it, moved or not
    draw();
  };
  tlc.addEventListener('pointerup', end); tlc.addEventListener('pointercancel', cancel); tlc.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.pointer) cancel(); });
  tlc.addEventListener('dblclick', e => {
    if (!onBand(e) || !band.add) return;
    const t = lastPress && performance.now() - lastPress.at < 1000 ? lastPress.t : timeAt(e.clientX);
    band.add(Math.round(t));
  });

  return { draw };
}
