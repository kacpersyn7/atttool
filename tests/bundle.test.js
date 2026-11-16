/**
 * The single-file build (scripts/bundle.mjs) must export exactly what the real modules do. The dev server and the
 * other tests use real ES modules, so a name the bundler misses is undefined only in dist/AttTool.html (as DATE_MAX
 * was, which broke every scenario import there: #79).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle, codeOnly, declaredExports, moreDeclarators } from '../scripts/bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => path.join(root, 'src', f));
const names = src => declaredExports(src).map(x => x.as);
/** Run a bundle and return the exports of its entry (the module bundled last). */
const run = b => new Function(b.code.replace(/^\(\(\) => \{/, '').replace(/\}\)\(\);$/, '') + `\nreturn ${b.order[b.order.length - 1].id};`)();
/** Bundle files { name: source } written to a fresh directory, from `entry`. */
function bundleOf(sources, entry) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'bundle-'));
  try { for (const [f, s] of Object.entries(sources)) fs.writeFileSync(path.join(dir, f), s); return bundle(path.join(dir, entry)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('bundler: every name of a declaration with several, past literals, comments and brackets', () => {
  const src = [
    "export const A = 'x, y', B = [1, 2], C = f(3, { d: 4, e: 5 }), D = /,[,/]x/g, E = `${1, 2},`, F = 6; // , G = 7",
    'export let H = 1,',
    '  I = 2;',
    'export const J = x => (x, 1), K = a / b, L = 3',
    'const notExported = 1, M = 2;',
    'export const N = { o: 1,',
    '  p: 2 }, Q = 0;',
    'export const R = 1 /* , S = 2 */, T = 3;',
    'export function U(a, b) {}',
    'export { V, W as X };',
  ].join('\n');
  assert.deepEqual(names(src).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'N', 'Q', 'R', 'T', 'U', 'V', 'X'].sort());
  assert.deepEqual(moreDeclarators('export const a = 1, b = 2;', 'export const a'.length), ['b']);
  assert.deepEqual(moreDeclarators("export const re = /[;']/, s = ';';\nconst z = 1, y = 2;", 'export const re'.length), ['s'], 'stops at the end of the statement');
});

test('bundler: declarations that once fooled the scanner (verifier probes)', () => {
  const at = (src, first) => moreDeclarators(src, src.indexOf(first) + first.length);
  assert.deepEqual(at('export const A = 1, /* note */ B = 2;\nfunction f() {\n  x = 3;\n}', 'const A'), ['B'], 'a comment before a name; nothing from later lines');
  assert.deepEqual(at('export const A = 1, // note\n  B = 2;', 'const A'), ['B']);
  assert.deepEqual(at('export let a\nlet b = 1, c = 2;', 'let a'), [], 'no value, no semicolon: the statement ends with the line');
  assert.deepEqual(at('export const f = () => { return /[}]/.test(s) }, G = 1;', 'const f'), ['G'], 'a regex after return');
  assert.deepEqual(at('export const t = typeof /x/, G = 1;', 'const t'), ['G']);
  assert.deepEqual(at('export const A = foo\n  .bar(), B = 2;', 'const A'), ['B'], 'a line starting with . goes on');
  assert.deepEqual(at('export const A = c\n  ? 1\n  : 2, B = 3;', 'const A'), ['B']);
  assert.deepEqual(at('export const A = f(1)\n  , B = 2;', 'const A'), ['B']);
  assert.deepEqual(at('export const B = x\n  / 2, C = 3;', 'const B'), ['C']);
  assert.deepEqual(at('export const A = 1\n++i;', 'const A'), [], '++ on the next line starts a statement');
  assert.deepEqual(at('export const A = `x${`y${1, 2}`}`, B = "http://x, y", C = 1;', 'const A'), ['B', 'C'], 'nested templates, // in a string');
});

test('bundler: code only, without comments, strings, regex and template text', () => {
  const src = "ENV.a(); // ENV.b\n/* ENV.c */ 'ENV.d' + `ENV.e ${ENV.f} x` + /ENV.g/.test(s); return /ENV.h/", c = codeOnly(src);
  assert.deepEqual([...c.matchAll(/ENV\.(\w)/g)].map(m => m[1]), ['a', 'f']);
  assert.equal(c.length, src.length); assert.equal(c.split('\n').length, 2, 'lengths and lines kept');
});

test('bundler: export lists with "as", several names, and the imports of a bundle run as they would as modules', () => {
  const b = bundleOf({
    'a.js': 'const w = 1, k = 2;\nexport { w as W, k };\nexport const ONE = 1, /* c */ TWO = 2;\nexport let late\nlet hidden = 1, also = 2;\n',
    'm.js': "import * as A from './a.js';\nexport const viaNs = A.W + A.TWO;\n",
    'e.js': "import { W, k, ONE, TWO } from './a.js';\nimport { viaNs } from './m.js';\nexport { W as again };\nexport const sum = W + k + ONE + TWO, ns = viaNs;\n",
  }, 'e.js');
  const ex = run(b);
  assert.deepEqual({ ...ex }, { again: 1, sum: 6, ns: 3 });
  assert.deepEqual([...b.order[0].names].sort(), ['ONE', 'TWO', 'W', 'k', 'late'], 'not hidden or also');
});

test('bundler: a named or namespace import of a missing export fails the build', () => {
  const a = { 'a.js': 'export const ONE = 1, TWO = 2;\n// A.FOUR in a comment is not code\n' };
  assert.throws(() => bundleOf({ ...a, 'bad.js': "import { ONE, THREE } from './a.js';\nexport const x = ONE + THREE;\n" }, 'bad.js'), /bad\.js imports "THREE" from \.\/a\.js/);
  assert.throws(() => bundleOf({ ...a, 'ns.js': "import * as A from './a.js';\nexport const x = A.ONE + A.THREE;\n" }, 'ns.js'), /ns\.js uses A\.THREE from \.\/a\.js/);
  const ok = bundleOf({ ...a, 'ok.js': "import * as A from './a.js';\n// A.FOUR\nexport const x = A.ONE + A . TWO, s = 'A.FIVE';\n" }, 'ok.js');
  assert.equal(run(ok).x, 3, 'comments and strings are not checked');
});

test('bundler: all 61 modules (views too) export in the bundle exactly the names they export as modules', () => {
  // linked as real ES modules in a child process (vm modules need a flag), without running them: no browser needed
  const real = JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(root, 'tests/linkExports.mjs')], { encoding: 'utf8' }));
  const { order } = bundle(path.join(root, 'src/main.js'), root), seen = new Map(order.map(m => [path.relative(root, m.file), m]));
  assert.equal(Object.keys(real).length, files.length);
  for (const [rel, want] of Object.entries(real)) {
    const mod = seen.get(rel) || bundle(path.join(root, rel), root).order.at(-1);
    assert.deepEqual([...mod.names].sort(), want, rel);
  }
});

test('bundler: in the bundle, each module that loads in Node has the same export values as the real module', async () => {
  let checked = 0;
  for (const f of files) {
    let real; try { real = await import(pathToFileURL(f).href); } catch (e) { assert.match(String(e), /three/, path.relative(root, f) + ' should load in Node, or need only three'); continue; }
    const ex = run(bundle(f, root)), rel = path.relative(root, f);
    for (const k of Object.keys(real)) {
      assert.equal(typeof ex[k], typeof real[k], `${rel}: ${k}`);
      if (typeof real[k] !== 'function' && typeof real[k] !== 'object') assert.equal(ex[k], real[k], `${rel}: ${k}`);
      else if (typeof real[k] === 'object' && real[k] !== null) assert.deepEqual(Object.keys(ex[k]).sort(), Object.keys(real[k]).sort(), `${rel}: ${k}`); // the shape: state made at load has random ids
    }
    checked++;
  }
  assert.ok(checked >= 50, `${checked} modules checked`);
});
