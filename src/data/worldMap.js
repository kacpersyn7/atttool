/**
 * Decoder for the Natural Earth map in ./naturalEarth.js (format: scripts/build-map.mjs).
 * Pure data; decoded once on first use and cached.
 */
import { MAP_Q, NE_LAND, NE_LAKES, NE_BORDERS, NE_PROVINCES, NE_RIVERS, NE_CITIES } from './naturalEarth.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;

/** base64 → bytes (no atob: runs in Node too). */
export function b64bytes(s) {
  const n = s.length, pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array(n / 4 * 3 - pad);
  for (let i = 0, j = 0; i < n; i += 4) {
    const v = (B64I[s.charCodeAt(i)] << 18) | (B64I[s.charCodeAt(i + 1)] << 12) | ((B64I[s.charCodeAt(i + 2)] & 63) << 6) | (B64I[s.charCodeAt(i + 3)] & 63);
    if (j < out.length) out[j++] = v >> 16; if (j < out.length) out[j++] = (v >> 8) & 255; if (j < out.length) out[j++] = v & 255;
  }
  return out;
}

/** Reader for the varint stream; ring() returns a Float64Array [lon0, lat0, lon1, lat1, …] in degrees. */
function reader(s) {
  const b = b64bytes(s); let i = 0, lon = 0, lat = 0;
  const u = () => { let n = 0, m = 1, x; do { x = b[i++]; n += (x & 127) * m; m *= 128; } while (x & 128); return n; };
  const z = () => { const n = u(); return n % 2 ? -(n + 1) / 2 : n / 2; };
  const ring = () => { const k = u(), a = new Float64Array(2 * k); for (let j = 0; j < k; j++) { lon += z(); lat += z(); a[2 * j] = lon / MAP_Q; a[2 * j + 1] = lat / MAP_Q; } return a; };
  return { u, ring };
}

/** Polygon layer → [[ring, …], …] (first ring outer, others holes; rings closed implicitly). */
export function decodePolygons(s) { const r = reader(s), n = r.u(), out = []; for (let p = 0; p < n; p++) { const k = r.u(), rings = []; for (let j = 0; j < k; j++) rings.push(r.ring()); out.push(rings); } return out; }
/** Line layer → [line, …]. */
export function decodeLines(s) { const r = reader(s), n = r.u(), out = []; for (let p = 0; p < n; p++) out.push(r.ring()); return out; }
/** Cities → [{ name, lat, lon (deg), pop (people), kind: 2 national capital | 1 province capital | 0 }], largest first. */
export function decodeCities(s) {
  return s.split('\n').map(l => { const [name, lat, lon, pop, kind] = l.split('|'); return { name, lat: +lat, lon: +lon, pop: +pop * 1000, kind: +kind }; });
}

let cache = null;
/**
 * The decoded world map: { land, lakes: polygons; borders, provinces, rivers: lines; cities }.
 * Coordinates in degrees, [lon, lat] pairs; quantized to 1/MAP_Q degree; Natural Earth 1:50m
 * (cities from 1:10m), so lines are good to a few km — a schematic map, not survey data.
 */
export function worldMap() {
  if (!cache) cache = {
    land: decodePolygons(NE_LAND), lakes: decodePolygons(NE_LAKES),
    borders: decodeLines(NE_BORDERS), provinces: decodeLines(NE_PROVINCES), rivers: decodeLines(NE_RIVERS),
    cities: decodeCities(NE_CITIES),
  };
  return cache;
}
