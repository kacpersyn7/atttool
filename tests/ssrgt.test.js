import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ENV from '../src/env/index.js';
import { close } from './helpers.js';
import { definitionError, epochDate, ltanOf, orbitElements, setEpoch, ssrgtClosure, ssrgtSolution, switchDefinition } from '../src/sim/scenario.js';
import { sanitizeScenario, scenarioData } from '../src/sim/scenarioLibrary.js';
import { defaultState } from '../src/state/store.js';

const R2D = 180 / Math.PI;
const rgt = (R, D, ltan = 22.5, lon = 0) => ({ ...defaultState().orbit, def: 'ssrgt', j2: true, rgtR: R, rgtD: D, rgtLtan: ltan, rgtLon: lon, t: 0 });

test('SSRGT: published missions, solved from the repeat cycle alone (Sentinel-2 143/10 at 786 km, Sentinel-1 175/12 at 693 km)', () => {
  // ESA: Sentinel-2 mean altitude 786 km, 14 + 3/10 orbits a day; Sentinel-1 693 km, 175 orbits in 12 days
  for (const [R, D, km] of [[143, 10, 786], [175, 12, 693]]) {
    const s = ssrgtSolution(rgt(R, D)); assert.ok(s, `${R}/${D}`);
    close(s.a - ENV.RE, km, 1, `${R}/${D} altitude`); assert.ok(s.i * R2D > 98 && s.i * R2D < 98.7, 'sun-synchronous, retrograde');
    close(-Math.cos(s.i) * 1.5 * Math.sqrt(ENV.MU / s.a ** 3) * ENV.J2 * (ENV.RE / s.a) ** 2, ENV.SUN_RATE, 1e-15, 'node follows the mean Sun');
  }
});

test('SSRGT: the ground track closes after D days in the model, and orbit 1 crosses the equator northbound at the reference longitude', () => {
  for (const [R, D, lon] of [[143, 10, 0], [175, 12, 21.01], [233, 16, -120]]) {
    const o = rgt(R, D, 22.5, lon); assert.ok(ssrgtClosure(o) < 1e-4, `${R}/${D} closes to ${(ssrgtClosure(o) * 1000).toFixed(3)} m`); // under 10 cm: exact in the model
    const s = ssrgtSolution(o), st = ENV.propagate(s.E, s.t1, true), ll = ENV.ecef2ll(ENV.eci2ecef(st.r, new Date(epochDate(o).getTime() + s.t1 * 1000)));
    close(ll.lat * R2D, 0, 1e-6, 'on the equator'); close(((ll.lon * R2D - lon + 540) % 360) - 180, 0, 1e-5, 'at the reference longitude'); assert.ok(st.v[2] > 0, 'northbound');
    assert.ok(s.t1 >= 0 && s.t1 < 86400 * 1.01, 'within the first day');
  }
});

test('SSRGT: the LTAN is the one asked for; moving the epoch keeps it and the reference track, and keeps the UTC', () => {
  const o = rgt(143, 10, 22.5, 10); close(ltanOf(o), 22.5, 1 / 60); const before = ssrgtSolution(o), utc = epochDate(o).getTime() + o.t * 1000;
  assert.equal(setEpoch(o, '2027-03-01T00:00'), true); close(ltanOf(o), 22.5, 1 / 60); assert.equal(epochDate(o).getTime() + o.t * 1000, utc);
  const s = ssrgtSolution(o); close(s.a, before.a, 1e-6, 'the same orbit size (to 1 mm: the GMST rate it repeats against drifts slightly with the date)'); assert.ok(ssrgtClosure(o) < 1e-4);
});

test('SSRGT: switching to elements keeps the orbit; bad cycles, J2 off and import are handled', () => {
  const o = rgt(143, 10); const E = orbitElements(o); switchDefinition(o, 'elements'); const F = orbitElements(o);
  close(F.a, E.a, 1e-3); close(F.i, E.i, 1e-6); close(F.raan, E.raan, 1e-6); assert.equal(o.def, 'elements');
  assert.match(definitionError(rgt(1, 1)), /No sun-synchronous orbit/); assert.match(definitionError({ ...rgt(143, 10), j2: false }), /needs J2/);
  assert.match(definitionError({ ...rgt(143, 10), rgtR: 14.5 }), /whole numbers/); assert.equal(definitionError(rgt(143, 10)), null);
  const d = scenarioData(defaultState().orbit), c = sanitizeScenario({ ...rgt(233, 16, 22, -120) }, d); assert.deepEqual([c.def, c.rgtR, c.rgtD, c.rgtLtan, c.rgtLon], ['ssrgt', 233, 16, 22, -120]);
  const b = sanitizeScenario({ ...rgt(143, 10), rgtR: 0.5, rgtLtan: 30 }, d); assert.equal(b.rgtR, d.rgtR); assert.equal(b.rgtLtan, d.rgtLtan);
});
