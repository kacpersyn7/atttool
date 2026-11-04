/** Number / unit formatting helpers for the UI. */
import { D2R, R2D } from '../core/linalg.js';

export const deg = x => x * R2D;
export const rad = x => x * D2R;
/** Fixed decimals, with tiny values snapped to 0 (avoids "-0.000"). */
export const fmt = (x, n = 3) => (Math.abs(x) < 0.5 * Math.pow(10, -n) ? 0 : x).toFixed(n);
/** Fixed decimals with explicit sign (+ / −). */
export const fmtS = (x, n = 3) => { const r = +fmt(x, n); return (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(n); };
/** 3x3 matrix as 9 grid cells (for a `.mat` container). */
export const matHTML = (M, n = 4) => M.flat().map(x => `<div>${fmtS(x, n)}</div>`).join('');
/** Hours -> "HH:MM". */
export const hhmm = hr => { const t = (Math.round(hr * 60) % 1440 + 1440) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
/** Seconds from the epoch -> "T+HH:MM:SS", "T−HH:MM:SS", with days once past one: "T+14 d 03:12:05". */
export const tPlus = s => {
  const a = Math.floor(Math.abs(s)), d = Math.floor(a / 86400), p = n => String(n).padStart(2, '0');
  return `T${s < 0 && a > 0 ? '−' : '+'}${d ? d + ' d ' : ''}${p(Math.floor(a % 86400 / 3600))}:${p(Math.floor(a % 3600 / 60))}:${p(a % 60)}`;
};

/** Text made safe for innerHTML: part and spacecraft names can come from imported files. */
export const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
