/**
 * Every module must parse and every named import must exist. The other tests don't load the views (they
 * need a browser) and the bundler doesn't parse, so without this a typo in a view passes CI and the app
 * shows an empty page: an error while loading modules happens before anything can report it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => path.join(root, 'src', f));
const src = f => fs.readFileSync(f, 'utf8');

test('modules: every file in src/ parses', () => {
  assert.ok(files.length > 40);
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', '--input-type=module'], { input: src(f), stdio: 'pipe' }); }
    catch (e) { assert.fail(path.relative(root, f) + ':\n' + String(e.stderr).split('\n').slice(0, 5).join('\n').slice(0, 600)); }
  }
});

/** Names a module exports, following `export *` and `export { } from`. */
function exportsOf(f, seen = new Set()) {
  const out = new Set(), s = src(f); if (seen.has(f)) return out; seen.add(f);
  for (const m of s.matchAll(/^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)((?:\s*=[^;\n]*?,\s*[\w$]+)*)/gm)) { out.add(m[1]); for (const k of m[2].matchAll(/,\s*([\w$]+)$/gm)) out.add(k[1]); }
  for (const m of s.matchAll(/^\s*export\s+const\s+[^\n]*$/gm)) for (const k of m[0].matchAll(/(?:^\s*export\s+const\s+|,\s*)([\w$]+)\s*=/g)) out.add(k[1]);
  for (const m of s.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) for (const n of m[1].split(',').map(x => x.trim()).filter(Boolean)) out.add(n.split(/\s+as\s+/).pop());
  for (const m of s.matchAll(/^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) for (const n of exportsOf(path.resolve(path.dirname(f), m[1]), seen)) out.add(n);
  return out;
}

test('modules: every named import exists in the module it comes from', () => {
  for (const f of files) for (const m of src(f).matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/gm)) {
    const target = path.resolve(path.dirname(f), m[2]), rel = path.relative(root, f);
    assert.ok(fs.existsSync(target), `${rel}: no file ${m[2]}`);
    const have = exportsOf(target);
    for (const n of m[1].split(',').map(x => x.trim()).filter(Boolean)) { const name = n.split(/\s+as\s+/)[0]; assert.ok(have.has(name), `${rel}: "${name}" is not exported by ${m[2]}`); }
  }
});
