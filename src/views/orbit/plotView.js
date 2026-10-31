/**
 * Signal plots above the availability timeline: one strip chart per selected signal
 * (sim/signals.js), sharing the time axis. With the "One orbit" window the time axis is the
 * timeline's, so cursors line up. Hover reads values, click seeks, "CSV" downloads the window at 1 s.
 */
import { S, save, scVersion } from '../../state/store.js';
import { h, syncAll } from '../../ui/dom.js';
import { toast } from '../../ui/overlay.js';
import { fmt } from '../../ui/format.js';
import { epochDate } from '../../sim/scenario.js';
import { timelineKey } from '../../sim/timeline.js';
import { signalCatalog, findSignal, plotWindow, sampleSignals, valueAt, signalsToCSV } from '../../sim/signals.js';

const LEFT = 112, RIGHT = 52;   // same margins as the timeline → same time axis
const ROW_H = 74, N = 300, MAX_SIGS = 4;
const WINDOWS = [['orbit', 'One orbit'], ['last:5', 'Last 5 min'], ['last:15', 'Last 15 min'], ['last:30', 'Last 30 min'], ['last:90', 'Last 90 min']];
const COLORS = { 1: ['#f2a93b'], 3: ['#ff6161', '#46d38a', '#4f8cff'], 4: ['#e8ecf2', '#ff6161', '#46d38a', '#4f8cff'] };
const localeComma = (() => { try { return new Intl.NumberFormat(navigator.language).format(1.5).includes(','); } catch { return false; } })();

export function createPlotView(host) {
  const P = () => S.orbit.plot;
  const bar = h('div', { class: 'plotbar' });
  const cv = h('canvas', { class: 'plots' });
  host.prepend(bar, cv);
  let data = null, hoverX = null, barKey = '';

  const win = () => { const [kind, min] = P().win.split(':'); return { kind, min: +min || 30 }; };
  const sigs = () => P().sigs.map(id => findSignal(S, id)).filter(Boolean);
  const set = f => { f(P()); save(); data = null; renderBar(); draw(); };

  function renderBar() {
    barKey = scVersion() + '|' + S.orbit.refFrame + '|' + P().sigs.join() + '|' + P().win;
    const cat = signalCatalog(S), active = sigs();
    const add = h('select', { title: 'Add a signal to plot (up to ' + MAX_SIGS + ')', 'aria-label': 'Add signal' },
      h('option', { value: '' }, active.length ? '+ Add signal…' : '+ Plot a signal (quaternion, rates, angles…)'),
      ...['Attitude', 'Environment', 'Parts'].map(g => h('optgroup', { label: g }, cat.filter(s => s.group === g && !P().sigs.includes(s.id)).map(s => h('option', { value: s.id }, s.label + (s.unit ? ` [${s.unit}]` : ''))))));
    add.disabled = active.length >= MAX_SIGS;
    add.addEventListener('change', () => { if (add.value) set(p => p.sigs = [...p.sigs.filter(id => findSignal(S, id)), add.value]); });
    const winSel = h('select', { title: 'Time window', 'aria-label': 'Time window' }, WINDOWS.map(([v, l]) => h('option', { value: v }, l)));
    winSel.value = P().win; winSel.addEventListener('change', () => set(p => p.win = winSel.value));
    const comma = h('input', { type: 'checkbox' }); comma.checked = P().comma ?? localeComma;
    comma.addEventListener('change', () => { P().comma = comma.checked; save(); });
    bar.replaceChildren(
      h('span', { class: 'lbl' }, 'Plots'),
      ...active.map(s => h('span', { class: 'pchip', title: s.label }, s.label,
        h('button', { title: 'Remove', 'aria-label': 'Remove ' + s.label, onclick: () => set(p => p.sigs = p.sigs.filter(id => id !== s.id)) }, '×'))),
      add,
      active.length ? h('span', { class: 'sp' }) : null,
      active.length ? winSel : null,
      active.length ? h('label', { class: 'chk', title: 'Decimal commas and ; separators (Polish / German Excel)' }, comma, 'dec ,') : null,
      active.length ? h('button', { class: 'vbtn', title: 'Download the plotted signals over this window at a 1 s step (UTC time stamps)', onclick: exportCSV }, 'CSV') : null);
    cv.hidden = !active.length;
  }

  function exportCSV() {
    const ids = sigs().map(s => s.id); if (!ids.length) return;
    const w = plotWindow(S, win()), step = Math.max(1, Math.ceil((w.t1 - w.t0) / 20000)), t0 = Math.ceil(w.t0);
    const smp = sampleSignals(S, ids, t0, w.t1, { step });
    const csv = signalsToCSV(smp, epochDate(S.orbit).getTime(), { comma: P().comma ?? localeComma });
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'atttool-signals.csv' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`CSV: ${smp.t.length} rows, ${step} s step`);
  }

  function compute() {
    const w = plotWindow(S, win()), ids = sigs().map(s => s.id);
    // quantise the sliding window to the sample spacing so playback doesn't resample every tick
    const dt = (w.t1 - w.t0) / (N - 1); if (w.t0 > 0 && win().kind === 'last') { w.t0 = Math.ceil(w.t0 / dt) * dt; w.t1 = w.t0 + (N - 1) * dt; }
    const key = timelineKey(S, scVersion(), w.t0) + ids.join() + w.t1;
    if (data && data.key === key) return data;
    return data = { key, w, ...sampleSignals(S, ids, w.t0, w.t1, { N }) };
  }

  function yRange(s) {
    if (s.sig.range) return s.sig.range;
    let lo = Infinity, hi = -Infinity; for (const v of s.v) for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (!Number.isFinite(lo)) return [-1, 1];
    const pad = Math.max((hi - lo) * 0.08, Math.abs(hi) * 1e-3, 1e-6); return [lo - pad, hi + pad];
  }

  function draw() {
    if (barKey !== scVersion() + '|' + S.orbit.refFrame + '|' + P().sigs.join() + '|' + P().win) renderBar();
    if (cv.hidden) return;
    const d = compute(), { t0, t1 } = d.w;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, Hh = d.series.length * ROW_H;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.height = Hh + 'px'; }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, Hh);
    const L = LEFT, w = W - LEFT - RIGHT, X = t => L + (t - t0) / (t1 - t0) * w;
    const tNow = S.orbit.t, hoverT = hoverX === null ? null : t0 + (hoverX - L) / w * (t1 - t0);
    const tRead = hoverT ?? tNow;
    x.font = '500 11px "JetBrains Mono", monospace'; x.textBaseline = 'middle';
    d.series.forEach((s, i) => {
      const top = i * ROW_H + 4, ph = ROW_H - 12, [lo, hi] = yRange(s), Y = v => top + ph - (v - lo) / (hi - lo) * ph;
      x.fillStyle = '#162232'; x.fillRect(L, top, w, ph);
      // eclipse shading, zero line, minute grid
      x.fillStyle = '#33496b55';
      for (let n = 0; n < d.t.length - 1; n++) if (d.ecl[n]) { let m = n; while (m < d.t.length - 1 && d.ecl[m]) m++; x.fillRect(X(d.t[n]), top, X(d.t[m]) - X(d.t[n]), ph); n = m; }
      if (lo < 0 && hi > 0) { x.fillStyle = '#3a4d6a'; x.fillRect(L, Math.round(Y(0)), w, 1); }
      for (let m = Math.ceil(t0 / 600) * 600; m <= t1; m += 600) { x.fillStyle = '#26375080'; x.fillRect(X(m), top, 1, ph); }
      // curves
      const cols = COLORS[s.sig.comps.length] || COLORS[3];
      s.sig.comps.forEach((_, k) => {
        x.strokeStyle = cols[k]; x.lineWidth = 1.4; x.beginPath(); let pen = false;
        for (let n = 0; n < d.t.length; n++) {
          const v = s.v[n][k]; if (!Number.isFinite(v)) { pen = false; continue; }
          if (pen && s.sig.kind === 'angle' && Math.abs(v - s.v[n - 1][k]) > 180) pen = false; // wrap: break the line
          const px = X(d.t[n]), py = Math.max(top, Math.min(top + ph, Y(v)));
          if (pen) x.lineTo(px, py); else x.moveTo(px, py); pen = true;
        }
        x.stroke();
      });
      // title + y labels
      const title = s.sig.label + (s.sig.unit ? ` [${s.sig.unit}]` : '');
      x.fillStyle = '#0a1018b0'; x.fillRect(L + 2, top + 1, x.measureText(title).width + 8, 14);
      x.fillStyle = '#c8d3e2'; x.textAlign = 'left'; x.fillText(title, L + 6, top + 8);
      if (i === 0 && hoverT === null && win().kind === 'last') { const lb = d.w.label + ' · grid 10 min', lw = x.measureText(lb).width; x.fillStyle = '#0a1018b0'; x.fillRect(L + w - lw - 10, top + 1, lw + 8, 14); x.fillStyle = '#8697ae'; x.textAlign = 'right'; x.fillText(lb, L + w - 6, top + 8); x.textAlign = 'left'; }
      x.fillStyle = '#5d6e86'; x.textAlign = 'right'; x.fillText(axisNum(hi), W, top + 5); x.fillText(axisNum(lo), W, top + ph - 4); x.textAlign = 'left';
      // values at the cursor (or under the mouse)
      const nearN = Math.max(0, Math.min(d.t.length - 1, Math.round((tRead - t0) / (t1 - t0) * (d.t.length - 1))));
      const val = valueAt(S, s.sig, tRead, s.v[nearN]);
      s.sig.comps.forEach((c, k) => {
        const yy = top + 7 + k * 14 + (4 - s.sig.comps.length) * 3;
        x.fillStyle = cols[k]; x.fillRect(0, yy - 1, 8, 3);
        x.fillStyle = '#c8d3e2'; x.fillText((c.split(' ')[0] + '    ').slice(0, 5) + fmtVal(val[k], s.sig), 12, yy);
      });
    });
    // now cursor (white) and hover cursor (dashed)
    if (tNow >= t0 && tNow <= t1) { x.fillStyle = '#ffffff'; x.fillRect(X(tNow) - 1, 0, 2, Hh); }
    if (hoverT !== null && hoverT >= t0 && hoverT <= t1) {
      x.strokeStyle = '#9fb0c8'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(hoverX + .5, 0); x.lineTo(hoverX + .5, Hh); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#9fb0c8'; x.textAlign = 'right'; x.fillText(`t ${hoverT - tNow >= 0 ? '+' : '−'}${(Math.abs(hoverT - tNow) / 60).toFixed(1)} min`, L + w - 4, 12); x.textAlign = 'left';
    }
  }

  const axisNum = v => { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a === 0 ? '0' : a >= 0.01 ? fmt(v, 3) : v.toExponential(1); };
  const fmtVal = (v, sig) => !Number.isFinite(v) ? '—' : sig.unit === 'nT' || sig.unit === 'km' ? v.toFixed(sig.unit === 'km' ? 1 : 0) : sig.kind === 'quat' || sig.range?.[1] === 1 ? fmt(v, 4) : sig.unit === '°/s' ? fmt(v, 4) : fmt(v, 2);

  cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(), px = e.clientX - r.left; hoverX = px >= LEFT && px <= r.width - RIGHT ? px : null; draw(); });
  cv.addEventListener('pointerleave', () => { hoverX = null; draw(); });
  cv.addEventListener('pointerdown', e => {
    if (!data) return; const r = cv.getBoundingClientRect(), f = (e.clientX - r.left - LEFT) / (r.width - LEFT - RIGHT); if (f < 0 || f > 1) return;
    S.orbit.t = Math.max(0, data.w.t0 + f * (data.w.t1 - data.w.t0)); S.orbit.playing = false; save(); syncAll();
  });

  renderBar();
  return { draw };
}
