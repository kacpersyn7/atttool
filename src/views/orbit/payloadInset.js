/**
 * Picture-in-picture "payload view": what the payload boresight looks at, as a gnomonic camera
 * image (sim/payload.js computes it; this file only draws). A 2D canvas rather than a 3D render:
 * at payload scale (tens of km) the Earth texture and coastlines carry no detail, while the
 * projected lat/lon grid, ground track and target stay sharp at any field of view.
 */
import { S } from '../../state/store.js';
import { payloadView } from '../../sim/payload.js';

const C = { bg: '#070c13', grid: '#2a3a52', gridTxt: '#5d6e86', track: '#f2a93b', fov: '#e8ecf2', tgt: '#ff7bd5', err: '#ff7bd5', along: '#4fd6e8', txt: '#c8d3e2', muted: '#8697ae' };
const FONT = '500 10.5px "JetBrains Mono", monospace';

/** Format a ground distance (km) with a sensible unit. */
const km = x => Math.abs(x) < 1 ? (x * 1000).toFixed(0) + ' m' : Math.abs(x) < 100 ? x.toFixed(2) + ' km' : x.toFixed(0) + ' km';
const sgn = (x, d = 3) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

export function createPayloadInset(el) {
  const cv = el.querySelector('canvas');

  /** Redraw for attitude A (attitudeAt result). */
  function draw(A) {
    if (el.hidden || !A) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H); x.font = FONT; x.textBaseline = 'middle';
    const V = payloadView(S, A);
    if (!V) return msg(x, W, H, 'No payload camera');
    const cx = W / 2, cy = H / 2, sc = (Math.min(W, H) / 2 - 4) / V.viewTan, P = q => [cx + q[0] * sc, cy + q[1] * sc];
    const line = (pts, col, w = 1) => {
      x.strokeStyle = col; x.lineWidth = w; x.beginPath(); let pen = false;
      for (const q of pts) { if (!q || Math.abs(q[0]) > 4 * V.viewTan || Math.abs(q[1]) > 4 * V.viewTan) { pen = false; continue; } const [a, b] = P(q); if (pen) x.lineTo(a, b); else x.moveTo(a, b); pen = true; }
      x.stroke();
    };
    x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
    if (!V.p.hit) msg(x, W, H, 'Boresight not on the Earth');
    // grid with labels where a line crosses the left / top edge
    for (const g of V.grid) {
      line(g.pts, C.grid);
      const q = g.pts.find(q => q && (g.kind === 'lat' ? P(q)[0] >= 2 : P(q)[1] >= 2) && Math.abs(P(q)[0] - cx) < W / 2 && Math.abs(P(q)[1] - cy) < H / 2);
      if (q) { const [a, b] = P(q); x.fillStyle = C.gridTxt; x.textAlign = 'left'; x.fillText(fmtDeg(g.deg, g.kind), g.kind === 'lat' ? 3 : a + 3, g.kind === 'lat' ? b - 6 : 26); }
    }
    line(V.track, C.track, 1.5);
    // payload FOV circle and boresight cross
    x.strokeStyle = C.fov; x.lineWidth = 1.2; x.setLineDash([4, 3]); x.beginPath(); x.arc(cx, cy, V.fovTan * sc, 0, 2 * Math.PI); x.stroke(); x.setLineDash([]);
    x.beginPath(); x.moveTo(cx - 7, cy); x.lineTo(cx + 7, cy); x.moveTo(cx, cy - 7); x.lineTo(cx, cy + 7); x.stroke();
    // along-track / right-of-track arrows
    if (V.alongDir) { arrow(x, cx, cy, V.alongDir, 26, C.along, 'along'); arrow(x, cx, cy, V.rightDir, 18, C.muted, 'right'); }
    // target and error vector (boresight − target)
    if (V.target) {
      const [a, b] = P(V.target);
      if (Math.hypot(a - cx, b - cy) > 2) { x.strokeStyle = C.err; x.lineWidth = 1; x.beginPath(); x.moveTo(a, b); x.lineTo(cx, cy); x.stroke(); }
      x.fillStyle = C.tgt; x.beginPath(); x.arc(a, b, 3.5, 0, 2 * Math.PI); x.fill();
      x.strokeStyle = C.tgt; x.beginPath(); x.arc(a, b, 7, 0, 2 * Math.PI); x.stroke();
    }
    x.restore();
    // scale bar (ground km at the boresight hit, ignoring obliquity)
    if (V.kmPerTan) {
      const want = V.kmPerTan * V.viewTan * 0.5, nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].reverse().find(s => s <= want) || 0.1;
      const L = nice / V.kmPerTan * sc; x.strokeStyle = C.txt; x.lineWidth = 1.5; x.beginPath(); x.moveTo(8, H - 10); x.lineTo(8 + L, H - 10); x.moveTo(8, H - 13); x.lineTo(8, H - 7); x.moveTo(8 + L, H - 13); x.lineTo(8 + L, H - 7); x.stroke();
      x.fillStyle = C.txt; x.textAlign = 'left'; x.fillText(km(nice), 12 + L, H - 10);
    }
    // readouts
    const p = V.p, rows = [];
    if (!p.tgtUp) rows.push(['Target below horizon', '']);
    else {
      rows.push(['err', p.ang.toFixed(3) + '°']);
      rows.push(['al/cr', sgn(p.along) + '° ' + sgn(p.cross) + '°']);
      if (p.gnd !== null) { rows.push(['gnd', km(p.gnd)]); rows.push(['al/cr', km(p.gAlong) + ' ' + km(p.gCross)]); }
    }
    x.textAlign = 'right'; rows.forEach(([k, val], i) => { x.fillStyle = C.muted; x.fillText(k, W - 6 - x.measureText(val).width - 6, 12 + i * 13); x.fillStyle = i === 0 && !p.tgtUp ? C.muted : C.txt; x.fillText(val, W - 6, 12 + i * 13); });
    x.textAlign = 'left'; x.fillStyle = C.muted; x.fillText(`${p.c.name} · view ${(2 * Math.atan(V.viewTan) * 180 / Math.PI).toFixed(1)}°`, 8, H - 26);
  }

  return { draw };
}

function msg(x, W, H, text) { x.fillStyle = C.muted; x.textAlign = 'center'; x.fillText(text, W / 2, H / 2 + 22); x.textAlign = 'left'; }
function fmtDeg(d, kind) { const a = Math.abs(d), s = +a.toFixed(3) + '°'; return kind === 'lat' ? s + (d >= 0 ? 'N' : 'S') : s + (d >= 0 ? 'E' : 'W'); }
function arrow(x, cx, cy, d, L, col, label) {
  const ex = cx + d[0] * L, ey = cy + d[1] * L; x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(cx + d[0] * 9, cy + d[1] * 9); x.lineTo(ex, ey); x.stroke();
  const a = Math.atan2(d[1], d[0]); x.beginPath(); x.moveTo(ex, ey); x.lineTo(ex - 5 * Math.cos(a - .4), ey - 5 * Math.sin(a - .4)); x.lineTo(ex - 5 * Math.cos(a + .4), ey - 5 * Math.sin(a + .4)); x.fill();
  x.textAlign = 'center'; x.fillText(label, ex + d[0] * 10, ey + d[1] * 10); x.textAlign = 'left';
}
