/**
 * Two-line element sets (TLE). Parsing, checksum, epoch, and conversion of the mean elements
 * to the classical elements used by the Keplerian + J2 propagator.
 *
 * Note: a TLE is meant for the SGP4 model. Using its mean elements with Keplerian + J2 secular
 * drift is an approximation: good at the epoch, drifting by kilometres per day (no drag, no
 * Brouwer/Kozai mean-motion correction, TEME treated as ECI). Fine for visualising geometry.
 */
import { MU } from './constants.js';

/** TLE checksum: sum of digits, '-' counts 1, modulo 10, over the first 68 characters. */
export function tleChecksum(line) {
  let s = 0; for (const ch of line.slice(0, 68)) { if (ch >= '0' && ch <= '9') s += +ch; else if (ch === '-') s += 1; }
  return s % 10;
}

/** TLE epoch "YYDDD.DDDDDDDD" → Date (UTC). 57–99 → 19xx, 00–56 → 20xx. */
export function tleEpoch(field) {
  const yy = +field.slice(0, 2), doy = parseFloat(field.slice(2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
}

/**
 * Parse a TLE (2 lines, optionally preceded by a name line). Returns
 * { name, satnum, epoch: Date, i, raan, e, argp, M (deg), n (rev/day), bstar, a (km), warnings }
 * or throws Error with a readable message.
 */
export function parseTLE(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const i1 = lines.findIndex(l => /^1 /.test(l)), l1 = lines[i1], l2 = lines[i1 + 1];
  if (i1 < 0 || !l2 || !/^2 /.test(l2)) throw new Error('Expected two lines starting with "1 " and "2 " (an optional name line before them).');
  const name = i1 > 0 ? lines[i1 - 1].trim().replace(/^0 /, '') : '';
  const warnings = [];
  for (const [n, l] of [[1, l1], [2, l2]]) {
    if (l.length < 69) throw new Error(`Line ${n} is ${l.length} characters long; a TLE line has 69.`);
    const want = tleChecksum(l), got = +l[68];
    if (want !== got) warnings.push(`Line ${n} checksum is ${got}, expected ${want}: the line may be mistyped.`);
  }
  if (l1.slice(2, 7) !== l2.slice(2, 7)) warnings.push('Satellite numbers on lines 1 and 2 differ.');
  const f = (l, a, b) => parseFloat(l.slice(a, b));
  const expField = s => { // " 12345-3" → 0.12345e-3
    const t = s.trim(); if (!t) return 0; const m = t.match(/^([+-]?)(\d+)([+-]\d)$/); return m ? +(m[1] + '0.' + m[2]) * 10 ** +m[3] : NaN;
  };
  const out = {
    name, satnum: l1.slice(2, 7).trim(), epoch: tleEpoch(l1.slice(18, 32)),
    i: f(l2, 8, 16), raan: f(l2, 17, 25), e: parseFloat('0.' + l2.slice(26, 33).trim()), argp: f(l2, 34, 42), M: f(l2, 43, 51), n: f(l2, 52, 63),
    bstar: expField(l1.slice(53, 61)), warnings,
  };
  for (const k of ['i', 'raan', 'e', 'argp', 'M', 'n']) if (!Number.isFinite(out[k])) throw new Error(`Could not read ${k} from line 2.`);
  if (isNaN(out.epoch.getTime())) throw new Error('Could not read the epoch from line 1.');
  if (!(out.n > 0)) throw new Error('Mean motion must be positive.');
  const nRad = out.n * 2 * Math.PI / 86400;
  out.a = Math.cbrt(MU / (nRad * nRad));
  return out;
}

/** True anomaly (rad) from mean anomaly M (rad) and eccentricity. */
export function meanToTrue(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 50; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-13) break; }
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}
