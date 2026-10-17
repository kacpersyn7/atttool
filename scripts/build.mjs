#!/usr/bin/env node
/**
 * Build dist/AttTool.html — ONE self-contained file you can double-click, e-mail or host anywhere.
 * Zero dependencies: a tiny bundler tailored to this codebase's module style.
 *
 * Supported module syntax (keep to it in src/):
 *   import { a, b as c } from './x.js';      import * as X from './x.js';
 *   export function f / export class C / export const|let k = ...
 *   export { a, b };   export { a } from './x.js';   export * from './x.js';
 * Not supported: default exports, dynamic import(), import cycles, side-effect-only imports.
 * Bare imports of 'three' / 'three/examples/jsm/...' become the global THREE from the UMD build.
 *
 * Note: imports are bound once (no live bindings) — don't reassign exported `let`s.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THREE_VERSION = '0.128.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src/main.js');

const modules = new Map(); // abs path -> { id, deps, code }
const order = [];
let nextId = 0;

const RE_IMPORT = /^\s*import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const RE_EXPORT_FROM = /^\s*export\s+(?:\*|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const RE_EXPORT_LIST = /^\s*export\s*\{([^}]*)\};?[ \t]*$/gm;
const RE_EXPORT_DECL = /^(\s*)export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

const isThree = s => s === 'three' || s.startsWith('three/');
const parseList = s => s.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [a, b] = x.split(/\s+as\s+/); return { name: a.trim(), as: (b || a).trim() }; });

function load(file, stack = []) {
  if (stack.includes(file)) throw new Error('Import cycle: ' + [...stack, file].map(f => path.relative(root, f)).join(' -> '));
  if (modules.has(file)) return modules.get(file);
  let src = fs.readFileSync(file, 'utf8');
  if (/^\s*export\s+default\b/m.test(src)) throw new Error('export default is not supported: ' + file);
  const mod = { id: '__m' + (nextId++), file };
  const head = [], exports = [];
  const resolve = spec => path.resolve(path.dirname(file), spec);
  const dep = spec => load(resolve(spec), [...stack, file]).id;

  src = src.replace(RE_IMPORT, (_, ns, list, spec) => {
    const from = isThree(spec) ? 'window.THREE' : dep(spec);
    if (ns) head.push(`const ${ns} = ${from};`);
    else head.push(`const { ${parseList(list).map(x => x.name === x.as ? x.name : `${x.name}: ${x.as}`).join(', ')} } = ${from};`);
    return '';
  });
  src = src.replace(RE_EXPORT_FROM, (_, list, spec) => {
    const from = dep(spec);
    if (list === undefined) exports.push(`...${from}`);
    else parseList(list).forEach(x => exports.push(`${x.as}: ${from}.${x.name}`));
    return '';
  });
  src = src.replace(RE_EXPORT_LIST, (_, list) => { parseList(list).forEach(x => exports.push(`${x.as}: ${x.name}`)); return ''; });
  src = src.replace(RE_EXPORT_DECL, (_, ws, kind, name) => { exports.push(name); return `${ws}${kind} ${name}`; });
  if (/^\s*(import|export)\s/m.test(src)) throw new Error('Unsupported import/export form left in ' + path.relative(root, file));

  mod.code = `// ---- ${path.relative(root, file)} ----\nconst ${mod.id} = (() => {\n${head.join('\n')}\n${src}\nreturn Object.freeze({ ${exports.join(', ')} });\n})();\n`;
  modules.set(file, mod); order.push(mod); // post-order: dependencies first
  return mod;
}

load(entry);
const bundle = `(() => {\n'use strict';\n${order.map(m => m.code).join('\n')}\n})();`.replace(/<\/script/gi, '<\\/script');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const three = [
  `https://cdnjs.cloudflare.com/ajax/libs/three.js/r${THREE_VERSION.split('.')[1]}/three.min.js`,
  `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/js/controls/OrbitControls.js`,
  `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/js/controls/TransformControls.js`,
].map(u => `<script src="${u}"></script>`).join('\n');
const guard = `<script>if(!window.THREE)document.addEventListener('DOMContentLoaded',()=>{document.getElementById('rail').innerHTML='<p class="tip" style="padding:12px">The 3D library could not load. Check your internet connection and reload.</p>'});</script>`;

html = html
  .replace(/<!-- three\.js[^>]*-->\s*/, '')
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace(/<link rel="stylesheet" href="src\/styles\.css">/, () => `<style>\n${css}</style>`)
  .replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `${three}\n${guard}\n<script>\nif (window.THREE) ${bundle}\n</script>`);

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
html = html.replace('<head>', `<head>\n  <!-- Built ${stamp} UTC by scripts/build.mjs from src/ — do not edit; edit src/ and rebuild. -->`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/AttTool.html');
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} — ${order.length} modules, ${(html.length / 1024).toFixed(0)} kB`);
