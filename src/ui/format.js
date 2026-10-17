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
export const hhmm = hr => { const h_ = Math.floor(hr), m = Math.round((hr - h_) * 60); return String(h_).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
/** Seconds -> "HH:MM:SS". */
export const hms = s => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
