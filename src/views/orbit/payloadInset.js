/**
 * Picture-in-picture "payload view": what the payload boresight looks at, as a gnomonic camera
 * image (sim/payload.js and sim/payloadMap.js compute it; this file only draws). A 2D canvas rather
 * than a 3D render: at payload scale (tens of km) the Earth texture carries no detail, while the
 * vector map (Natural Earth 1:50m), lat/lon grid, ground track and target stay sharp at any field of view.
 */
import { S } from '../../state/store.js';
import { payloadView } from '../../sim/payload.js';
import { mapView } from '../../sim/payloadMap.js';
import { fmt, fmtS } from '../../ui/format.js';

const C = { bg: '#070c13', grid: 'rgba(200,225,255,.2)', gridTxt: '#9fb2cc', halo: 'rgba(7,12,19,.82)',
  sea: '#123c5e', land: '#46613d', coast: 'rgba(196,220,170,.75)', river: 'rgba(110,170,230,.8)', border: 'rgba(240,226,180,.9)', prov: 'rgba(240,226,180,.4)', city: '#f2f2f2', panel: 'rgba(7,12,19,.62)', track: '#f2a93b', fov: '#e8ecf2', tgt: '#ff7bd5', err: '#ff7bd5', along: '#4fd6e8', txt: '#c8d3e2', muted: '#8697ae' };
const FONT = '500 10.5px "JetBrains Mono", monospace';
const MAP_NOTE = 'Map: Natural Earth 1:50m (public domain). Schematic, good to a few km: for orientation, not for measuring pointing errors.';
/** Text with a dark halo so it reads over the map. */
function T(x, s, a, b, col) { x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = C.halo; x.strokeText(s, a, b); x.fillStyle = col; x.fillText(s, a, b); }

/** Format a ground distance (km) with a sensible unit. */
const skm = x => (x < 0 ? '−' : '+') + km(Math.abs(x));
const km = x => Math.abs(x) < 1 ? fmt(x * 1000, 0) + ' m' : Math.abs(x) < 100 ? fmt(x, 2) + ' km' : fmt(x, 0) + ' km';

export function createPayloadInset(el) {
  const cv = el.querySelector('canvas'); el.title = MAP_NOTE;

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
    // map: Earth disc (sea), land, lakes, then lines; all clipped and projected by sim/payloadMap.js
    const sh = S.orbit.show, Mp = mapView(V.p.CCI, A.st.r, A.date, W / 2 / sc, H / 2 / sc, { borders: sh.plBorders !== false, provinces: sh.plBorders !== false, cities: sh.plCities !== false });
    const ring = f => { for (let i = 0; i < f.length; i += 2) { const a = cx + f[i] * sc, b = cy + f[i + 1] * sc; i ? x.lineTo(a, b) : x.moveTo(a, b); } x.closePath(); };
    const runs = (list, col, w, dash = []) => { if (!list.length) return; x.strokeStyle = col; x.lineWidth = w; x.setLineDash(dash); x.beginPath(); for (const f of list) for (let i = 0; i < f.length; i += 2) { const a = cx + f[i] * sc, b = cy + f[i + 1] * sc; i ? x.lineTo(a, b) : x.moveTo(a, b); } x.stroke(); x.setLineDash([]); };
    if (Mp.earth) { x.fillStyle = C.sea; x.beginPath(); ring(Mp.earth); x.fill(); }
    x.fillStyle = C.land; for (const poly of Mp.land) { x.beginPath(); poly.forEach(ring); x.fill('evenodd'); }
    x.fillStyle = C.sea; for (const poly of Mp.lakes) { x.beginPath(); poly.forEach(ring); x.fill('evenodd'); }
    runs(Mp.rivers, C.river, 0.9); runs(Mp.provinces, C.prov, 0.8, [3, 2]); runs(Mp.coast, C.coast, 0.9); runs(Mp.shore, C.coast, 0.7); runs(Mp.borders, C.border, 1.1, [5, 2]);
    if (!V.p.hit) msg(x, W, H, 'Boresight not on the Earth');
    // grid; each line labelled where it enters the view, skipping labels that would collide with
    // another label or with the readouts (top right) and the caption / scale bar (bottom left)
    const p = V.p, rows = [];
    if (!p.tgtUp) rows.push(['Target below horizon', '']);
    else {
      rows.push(['err', p.ang.toFixed(3) + '°']);
      rows.push(['al/cr', fmtS(p.along) + '° ' + fmtS(p.cross) + '°']);
      if (p.gnd !== null) { rows.push(['gnd', km(p.gnd)]); rows.push(['al/cr', skm(p.gAlong) + ' ' + skm(p.gCross)]); }
    }
    const caption = `${p.c.name} · view ${(2 * Math.atan(V.viewTan) * 180 / Math.PI).toFixed(1)}°`;
    const rw = Math.max(...rows.map(([k, val]) => x.measureText(k).width + x.measureText(val).width + 6)) + 12;
    const boxR = [W - rw - 4, 0, rw + 4, rows.length * 13 + 6], boxL = [0, H - 36, Math.max(x.measureText(caption).width, W * 0.25 + 50) + 14, 36];
    // reserved: readouts (top right), caption + scale bar (bottom left), the along / right arrow labels
    const placed = [boxR, boxL], M = 4;
    const arrows = V.alongDir ? [[V.alongDir, 26, C.along, 'along'], [V.rightDir, 18, C.muted, 'right']].map(([d, L, col, label]) => ({ d, L, col, label, at: arrowLabel(x, cx, cy, d, L, label) })) : [];
    for (const a of arrows) placed.push([a.at[0] - a.at[2] / 2 - 2, a.at[1] - 7, a.at[2] + 4, 14]);
    const free = rc => !placed.some(o => rc[0] < o[0] + o[2] && o[0] < rc[0] + rc[2] && rc[1] < o[1] + o[3] && o[1] < rc[1] + rc[3]);
    x.textAlign = 'left';
    for (const g of V.grid) line(g.pts, C.grid);
    // cities: dots for all in view, names for the largest that fit (they win over grid labels)
    let nLab = 0; const maxLab = Math.max(3, Math.round(W * H / 6000));
    for (const c of Mp.cities) {
      const [a, b] = P([c.x, c.y]), cap = c.kind === 2; x.fillStyle = C.city;
      if (cap) x.fillRect(a - 2.5, b - 2.5, 5, 5); else { x.beginPath(); x.arc(a, b, 2, 0, 2 * Math.PI); x.fill(); }
      if (nLab >= maxLab) continue;
      const tw = x.measureText(c.name).width, lx = a + 5 + tw + M < W ? a + 5 : a - 5 - tw, rc = [lx - 2, b - 7, tw + 4, 14];
      if (lx < M || b < 9 || b > H - 9 || !free(rc)) continue;
      placed.push(rc); T(x, c.name, lx, b, cap ? C.city : C.txt); nLab++;
    }
    for (const g of V.grid) {
      const inView = q => { if (!q) return false; const [a, b] = P(q); return a > M && a < W - M && b > M && b < H - M; };
      const q = g.pts.find(inView) || null; if (!q) continue;
      const t = fmtDeg(g.deg, g.kind), tw = x.measureText(t).width;
      let [a, b] = P(q); a = Math.min(Math.max(a + 3, M), W - tw - M); b = Math.min(Math.max(b, 10), H - 10);
      const rc = [a - 2, b - 7, tw + 4, 14]; if (!free(rc)) continue;
      placed.push(rc); T(x, t, a, b, C.gridTxt);
    }
    line(V.track, C.track, 1.5);
    // payload FOV circle and boresight cross
    x.strokeStyle = C.fov; x.lineWidth = 1.2; x.setLineDash([4, 3]); x.beginPath(); x.arc(cx, cy, V.fovTan * sc, 0, 2 * Math.PI); x.stroke(); x.setLineDash([]);
    x.beginPath(); x.moveTo(cx - 7, cy); x.lineTo(cx + 7, cy); x.moveTo(cx, cy - 7); x.lineTo(cx, cy + 7); x.stroke();
    // along-track / right-of-track arrows
    for (const a of arrows) arrow(x, cx, cy, a.d, a.L, a.col, a.label, a.at);
    // target and error vector (boresight − target)
    if (V.target) {
      const [a, b] = P(V.target);
      if (Math.hypot(a - cx, b - cy) > 2) { x.strokeStyle = C.err; x.lineWidth = 1; x.beginPath(); x.moveTo(a, b); x.lineTo(cx, cy); x.stroke(); }
      x.fillStyle = C.tgt; x.beginPath(); x.arc(a, b, 3.5, 0, 2 * Math.PI); x.fill();
      x.strokeStyle = C.tgt; x.beginPath(); x.arc(a, b, 7, 0, 2 * Math.PI); x.stroke();
      if (a < 0 || a > W || b < 0 || b > H) { // off-screen: arrowhead at the edge toward the target
        const d = [a - cx, b - cy], s = Math.min((W / 2 - 12) / Math.abs(d[0] || 1e-9), (H / 2 - 12) / Math.abs(d[1] || 1e-9)), ex = cx + d[0] * s, ey = cy + d[1] * s, ang = Math.atan2(d[1], d[0]);
        x.fillStyle = C.tgt; x.beginPath(); x.moveTo(ex + 7 * Math.cos(ang), ey + 7 * Math.sin(ang)); x.lineTo(ex + 7 * Math.cos(ang + 2.4), ey + 7 * Math.sin(ang + 2.4)); x.lineTo(ex + 7 * Math.cos(ang - 2.4), ey + 7 * Math.sin(ang - 2.4)); x.fill();
        x.textAlign = 'center'; T(x, 'target', Math.min(Math.max(ex - 18 * Math.cos(ang), 22), W - 22), Math.min(Math.max(ey - 14 * Math.sin(ang), 10), H - 10), C.tgt); x.textAlign = 'left';
      }
    }
    x.restore();
    // readouts and caption sit on a translucent backdrop so the map under them doesn't clutter the text
    x.fillStyle = C.panel; x.fillRect(...boxR); x.fillRect(...boxL);
    // scale bar (ground km at the boresight hit, ignoring obliquity)
    if (V.kmPerTan) {
      const want = V.kmPerTan * V.viewTan * 0.5, nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].reverse().find(s => s <= want) || 0.1;
      const L = nice / V.kmPerTan * sc; x.strokeStyle = C.txt; x.lineWidth = 1.5; x.beginPath(); x.moveTo(8, H - 10); x.lineTo(8 + L, H - 10); x.moveTo(8, H - 13); x.lineTo(8, H - 7); x.moveTo(8 + L, H - 13); x.lineTo(8 + L, H - 7); x.stroke();
      x.textAlign = 'left'; T(x, km(nice), 12 + L, H - 10, C.txt);
    }
    // readouts
    x.textAlign = 'right'; rows.forEach(([k, val], i) => { T(x, k, W - 6 - x.measureText(val).width - 6, 12 + i * 13, C.muted); T(x, val, W - 6, 12 + i * 13, i === 0 && !p.tgtUp ? C.muted : C.txt); });
    x.textAlign = 'left'; T(x, caption, 8, H - 26, C.muted);
  }

  return { draw };
}

function msg(x, W, H, text) { x.textAlign = 'center'; T(x, text, W / 2, H / 2 + 22, C.muted); x.textAlign = 'left'; }
function fmtDeg(d, kind) { const a = Math.abs(d), s = +a.toFixed(3) + '°'; return kind === 'lat' ? s + (d >= 0 ? 'N' : 'S') : s + (d >= 0 ? 'E' : 'W'); }
/** Centre and width of an arrow's label, clear of the arrow head in any direction. */
function arrowLabel(x, cx, cy, d, L, label) {
  const tw = x.measureText(label).width, off = tw / 2 * Math.abs(d[0]) + 7 * Math.abs(d[1]) + 5;
  return [cx + d[0] * (L + off), cy + d[1] * (L + off), tw];
}
function arrow(x, cx, cy, d, L, col, label, at) {
  const ex = cx + d[0] * L, ey = cy + d[1] * L; x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(cx + d[0] * 9, cy + d[1] * 9); x.lineTo(ex, ey); x.stroke();
  const a = Math.atan2(d[1], d[0]); x.beginPath(); x.moveTo(ex, ey); x.lineTo(ex - 5 * Math.cos(a - .4), ey - 5 * Math.sin(a - .4)); x.lineTo(ex - 5 * Math.cos(a + .4), ey - 5 * Math.sin(a + .4)); x.fill();
  x.textAlign = 'center'; T(x, label, at[0], at[1], col); x.textAlign = 'left';
}
