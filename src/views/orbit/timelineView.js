/** Draws the one-orbit availability timeline (sim/timeline.js) on a canvas; click to seek. */
import { S, save, scVersion } from '../../state/store.js';
import { syncAll } from '../../ui/dom.js';
import { computeTimeline } from '../../sim/timeline.js';

const LEFT = 112, RIGHT = 52; // px reserved for row names / percentages

export function createTimelineView(tlc) {
  let tl = null;

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
        if (r.kind === 'ecl') col = val ? '#33496b' : null;
        else if (r.kind === 'str') col = val === 0 ? '#2f8f5f' : val === 2 ? '#f2a93b' : '#d65050';
        else if (r.kind === 'css') col = val ? '#d8b23e' : null;
        else if (r.kind === 'sa') col = `rgba(79,140,255,${0.15 + 0.85 * val})`;
        else if (r.kind === 'pl') col = val ? '#9fb0c8' : null;
        if (col) { x.fillStyle = col; x.fillRect(L + n / tl.N * w, y + 2, w / tl.N + .6, rowH - 4); }
      }
      x.fillStyle = '#8697ae'; x.textAlign = 'right'; x.fillText(tl.stats[i].toFixed(0) + '%', W, y + rowH / 2); x.textAlign = 'left';
    });
    const cx = L + ((S.orbit.t - tl.W0) / tl.T) * w; x.fillStyle = '#ffffff'; x.fillRect(cx - 1, top - 4, 2, Hh - top + 4);
  }

  tlc.addEventListener('pointerdown', e => {
    if (!tl) return;
    const r = tlc.getBoundingClientRect(), w = r.width - LEFT - RIGHT; const f = (e.clientX - r.left - LEFT) / w; if (f < 0 || f > 1) return;
    S.orbit.t = tl.W0 + f * tl.T; S.orbit.playing = false; save(); syncAll();
  });

  return { draw };
}
