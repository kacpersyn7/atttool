#!/usr/bin/env node
/**
 * Convert Natural Earth GeoJSON layers into the compact module src/data/naturalEarth.js.
 * Run by hand when the map data changes (the generated module is committed; `npm run build` doesn't need this).
 *
 *   node scripts/build-map.mjs <dir with the .geojson files>
 *
 * Source: Natural Earth (public domain), https://www.naturalearthdata.com/, GeoJSON from
 * https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson
 *   ne_50m_land, ne_50m_lakes, ne_50m_rivers_lake_centerlines, ne_50m_admin_0_boundary_lines_land,
 *   ne_50m_admin_1_states_provinces_lines, ne_10m_populated_places_simple
 *
 * Encoding (decoded by src/data/worldMap.js): coordinates quantized to 1/Q degree; a layer is a base64
 * byte string of unsigned LEB128 varints. Polygon layers: nPolys, then per polygon nRings, then per ring
 * nPts and the points (exterior rings counter-clockwise in lon/lat, holes clockwise); line layers: nLines, then per line nPts and the points. Each point is
 * zigzag(Δlon), zigzag(Δlat) from the previous point of the layer (starting at 0, 0). Long edges are
 * split so that no edge spans more than MAXSEG degrees (edges are drawn as straight chords).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const Q = 200;          // quantum: 1/200° ≈ 0.56 km
const MAXSEG = 0.5;     // densify edges longer than this (deg)
const MINPOP = 50000;   // cities kept from the 10m populated places
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build-map.mjs <geojson dir>'); process.exit(1); }
const read = n => JSON.parse(fs.readFileSync(path.join(dir, n + '.geojson'), 'utf8')).features;

/** Rings / lines of a feature as arrays of [lon, lat]. */
function parts(g) {
  if (!g) return [];
  switch (g.type) {
    case 'Polygon': return [g.coordinates];
    case 'MultiPolygon': return g.coordinates;
    case 'LineString': return [[g.coordinates]];
    case 'MultiLineString': return g.coordinates.map(l => [l]);
    default: return [];
  }
}

function densify(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]; out.push(p);
    const q = ring[i + 1]; if (!q) break;
    const n = Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / MAXSEG);
    for (let k = 1; k < n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
  }
  return out;
}

class Enc {
  constructor() { this.b = []; this.lon = 0; this.lat = 0; this.pts = 0; }
  u(n) { do { let x = n & 0x7f; n = Math.floor(n / 128); if (n) x |= 0x80; this.b.push(x); } while (n); }
  z(n) { this.u(n >= 0 ? 2 * n : -2 * n - 1); }
  ring(r) {
    const q = []; // quantize and drop repeats
    for (const [lo, la] of densify(r)) { const a = Math.round(lo * Q), b = Math.round(la * Q), l = q[q.length - 1]; if (!l || l[0] !== a || l[1] !== b) q.push([a, b]); }
    if (q.length > 2 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop(); // closed rings: implicit closure
    this.u(q.length);
    for (const [a, b] of q) { this.z(a - this.lon); this.z(b - this.lat); this.lon = a; this.lat = b; }
    this.pts += q.length;
  }
  out() { return Buffer.from(this.b).toString('base64'); }
}

function polygons(name) {
  const e = new Enc(), polys = read(name).flatMap(f => parts(f.geometry)).filter(p => p[0].length >= 4);
  // orientation as in RFC 7946 (Natural Earth has it the other way round): exterior counter-clockwise
  // in (lon, lat), holes clockwise. Drawing uses even-odd fill and doesn't depend on it; a test checks it.
  const area = r => { let a = 0; for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a; };
  e.u(polys.length); for (const p of polys) { e.u(p.length); p.forEach((r, k) => e.ring((area(r) > 0) === (k === 0) ? r : [...r].reverse())); }
  return { e, n: polys.length };
}
function lines(name, keep = () => true) {
  const e = new Enc(), ls = read(name).filter(keep).flatMap(f => parts(f.geometry)).map(p => p[0]).filter(l => l.length >= 2);
  e.u(ls.length); ls.forEach(l => e.ring(l));
  return { e, n: ls.length };
}

const layers = {
  LAND: polygons('ne_50m_land'),
  LAKES: polygons('ne_50m_lakes'),
  BORDERS: lines('ne_50m_admin_0_boundary_lines_land'),
  PROVINCES: lines('ne_50m_admin_1_states_provinces_lines'),
  RIVERS: lines('ne_50m_rivers_lake_centerlines'),
};

// cities: "name|lat|lon|population (thousands)|kind" rows joined with "\n", largest first.
// kind: 2 = national capital, 1 = other capital (adm1), 0 = other.
const cities = read('ne_10m_populated_places_simple').map(f => f.properties)
  .filter(p => p.pop_max >= MINPOP || p.adm0cap)
  .sort((a, b) => b.pop_max - a.pop_max)
  .map(p => [p.name.replace(/[|\n]/g, ' '), +p.latitude.toFixed(3), +p.longitude.toFixed(3), Math.round(p.pop_max / 1000), p.adm0cap ? 2 : p.featurecla === 'Admin-1 capital' ? 1 : 0].join('|'));

let src = `// Generated by scripts/build-map.mjs from Natural Earth (public domain, naturalearthdata.com), v5.1.2.\n`
  + `// Do not edit by hand. Decoded by ./worldMap.js; see the script for the format.\n\n`
  + `/** Quantization: coordinates are integers in units of 1/MAP_Q degree. */\nexport const MAP_Q = ${Q};\n\n`;
for (const [k, { e, n }] of Object.entries(layers)) {
  src += `/** ${n} ${k === 'LAND' || k === 'LAKES' ? 'polygons' : 'lines'}, ${e.pts} points. */\nexport const NE_${k} = '${e.out()}';\n\n`;
  console.log(k.padEnd(10), String(n).padStart(5), 'parts', String(e.pts).padStart(7), 'pts', String(Math.round(e.out().length / 1024)).padStart(5), 'KB');
}
const cityStr = cities.join('\n');
src += `/** ${cities.length} cities (population ≥ ${MINPOP / 1000}k, plus national capitals): name|lat|lon|population in thousands|kind (2 national capital, 1 province capital, 0 other). */\n`
  + `export const NE_CITIES = ${JSON.stringify(cityStr)};\n`;
console.log('CITIES    ', String(cities.length).padStart(5), '                 ', String(Math.round(cityStr.length / 1024)).padStart(5), 'KB');
const out = path.join(root, 'src/data/naturalEarth.js');
fs.writeFileSync(out, src);
console.log('wrote', path.relative(root, out), Math.round(src.length / 1024), 'KB');
