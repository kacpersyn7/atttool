/**
 * The single-file build (scripts/bundle.mjs) must export exactly what the real modules do. The dev server and the
 * other tests use real ES modules, so a name the bundler misses is undefined only in dist/AttTool.html (as DATE_MAX
 * was, which broke every scenario import there).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle, declaredExports, moreDeclarators } from '../scripts/bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => path.join(root, 'src', f));

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
  assert.deepEqual(declaredExports(src).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'N', 'Q', 'R', 'T', 'U', 'V', 'X'].sort());
  assert.deepEqual(moreDeclarators('export const a = 1, b = 2;', 'export const a'.length), ['b']);
  assert.deepEqual(moreDeclarators("export const re = /[;']/, s = ';';\nconst z = 1, y = 2;", 'export const re'.length), ['s'], 'stops at the end of the statement');
});

test('bundler: each module that loads in Node exports in the bundle exactly what it exports as a module', async () => {
  let checked = 0;
  for (const f of files) {
    let real; try { real = await import(pathToFileURL(f).href); } catch (e) { continue; } // views need a browser
    const { order } = bundle(f, root), mod = order[order.length - 1];
    assert.equal(mod.file, f);
    assert.deepEqual([...mod.names].sort(), Object.keys(real).sort(), path.relative(root, f));
    checked++;
  }
  assert.ok(checked > 30, `${checked} modules checked`);
});

test('bundler: the app bundles, and a named import of a missing export fails the build', () => {
  const { order, code } = bundle(path.join(root, 'src/main.js'), root);
  assert.ok(order.length > 50 && code.length > 100e3);
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'bundle-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'export const ONE = 1, TWO = 2;\n');
    fs.writeFileSync(path.join(dir, 'ok.js'), "import { ONE, TWO } from './a.js';\nexport const sum = ONE + TWO;\n");
    fs.writeFileSync(path.join(dir, 'bad.js'), "import { ONE, THREE } from './a.js';\nexport const x = ONE + THREE;\n");
    const ok = bundle(path.join(dir, 'ok.js'));
    assert.equal(new Function(ok.code.replace(/^\(\(\) => \{/, '').replace(/\}\)\(\);$/, '') + `\nreturn ${ok.order[ok.order.length - 1].id}.sum;`)(), 3, 'the second name is bound');
    assert.throws(() => bundle(path.join(dir, 'bad.js')), /bad\.js imports "THREE" from \.\/a\.js/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
