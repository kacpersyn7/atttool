/**
 * The bundler behind scripts/build.mjs: every module of src/ in one script, in dependency order, each in its own
 * function scope, its exports a frozen object. Zero dependencies: tailored to this codebase's module style.
 *
 * Supported module syntax (keep to it in src/):
 *   import { a, b as c } from './x.js';      import * as X from './x.js';
 *   export function f / export class C / export const|let k = ... (several names in one: export const a = 1, b = 2)
 *   export { a, b };   export { a } from './x.js';   export * from './x.js';
 * Not supported: default exports, dynamic import(), import cycles, side-effect-only imports, destructuring exports.
 * Bare imports of 'three' / 'three/examples/jsm/...' become the global THREE from the UMD build.
 *
 * Imports are bound once (no live bindings): don't reassign exported `let`s. A named import that the bundler does
 * not find exported fails the build, instead of being undefined in the bundle only (the dev server and the tests
 * use real modules, so they would not notice).
 */
import fs from 'node:fs';
import path from 'node:path';

const RE_IMPORT = /^\s*import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const RE_EXPORT_FROM = /^\s*export\s+(?:\*|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const RE_EXPORT_LIST = /^\s*export\s*\{([^}]*)\};?[ \t]*$/gm;
const RE_EXPORT_DECL = /^(\s*)export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

const isThree = s => s === 'three' || s.startsWith('three/');
const parseList = s => s.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [a, b] = x.split(/\s+as\s+/); return { name: a.trim(), as: (b || a).trim() }; });

/* Skipping literals: each takes the index of the opening character and returns that of the closing one. */
function skipString(s, i, quote) {
  for (i++; i < s.length; i++) { if (s[i] === '\\') i++; else if (s[i] === quote || s[i] === '\n') return i; }
  return i;
}
function skipRegex(s, i) {
  let cls = false;
  for (i++; i < s.length; i++) {
    const ch = s[i]; if (ch === '\\') { i++; continue; } if (ch === '\n') return i;
    if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') { while (/[a-z]/i.test(s[i + 1] || '')) i++; return i; }
  }
  return i;
}
function skipTemplate(s, i) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; } if (s[i] === '`') return i;
    if (s[i] === '$' && s[i + 1] === '{') i = scanCode(s, i + 2, { inTemplate: true }).end;
  }
  return i;
}
/** Characters after which a / starts a regex literal rather than a division. */
const BEFORE_REGEX = /[(,=:[!&|?{};+\-*%<>~^]/;
/** Characters that, ending a line, continue the expression on the next one (no automatic semicolon there). */
const CONTINUES = /[,=+\-*/%&|?:([{<>!~^.]/;

/**
 * Scan code from i: through literals, comments and brackets. Stops at the `}` closing a template's ${ (inTemplate),
 * else at the end of the statement (a `;`, a closing bracket of an outer level, or a line end where the statement
 * can't go on). @returns { end, commas } with the indices of the commas at the top level.
 */
function scanCode(s, i, { inTemplate = false } = {}) {
  let depth = 0, prev = '=';
  const commas = [];
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '/' && s[i + 1] === '/') { const n = s.indexOf('\n', i); if (n < 0) { i = s.length; break; } i = n - 1; continue; }
    if (ch === '/' && s[i + 1] === '*') { const n = s.indexOf('*/', i + 2); i = n < 0 ? s.length : n + 1; continue; }
    if (ch === "'" || ch === '"') { i = skipString(s, i, ch); prev = 'a'; continue; }
    if (ch === '`') { i = skipTemplate(s, i); prev = 'a'; continue; }
    if (ch === '/' && BEFORE_REGEX.test(prev)) { i = skipRegex(s, i); prev = 'a'; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && !inTemplate) {
      if (ch === ';') break;
      if (ch === '\n' && !CONTINUES.test(prev)) break;
      if (ch === ',') commas.push(i);
    }
    if (!/\s/.test(ch)) prev = ch;
  }
  return { end: i, commas };
}

/**
 * The names a `const|let|var` declaration declares after its first one: `export const a = 1, b = [2, 3], c = f(4, 5);`
 * → ['b', 'c']. `from` is the index just after the first name.
 */
export function moreDeclarators(src, from) {
  const { commas } = scanCode(src, from), out = [];
  for (const c of commas) { const m = /^\s*([A-Za-z_$][\w$]*)\s*(?==|,|;|$)/m.exec(src.slice(c + 1)); if (m) out.push(m[1]); }
  return out;
}

/** The names a module's source exports by declaration or list (not those from `export … from`, which need the other file). */
export function declaredExports(src) {
  const out = [];
  for (const m of src.matchAll(RE_EXPORT_DECL)) { out.push(m[3]); if (/^(const|let|var)$/.test(m[2])) out.push(...moreDeclarators(src, m.index + m[0].length)); }
  for (const m of src.matchAll(RE_EXPORT_LIST)) for (const x of parseList(m[1])) out.push(x.as);
  return out;
}

/**
 * Bundle the module graph from `entry` (an absolute path). @returns { order (modules, dependencies first, each
 * { id, file, names (what it exports), code }), code (the whole bundle, one function) }. Throws on unsupported
 * syntax, a cycle, or a named import that isn't exported.
 */
export function bundle(entry, root = path.dirname(entry)) {
  const modules = new Map(), order = [];
  let nextId = 0;
  const rel = f => path.relative(root, f);
  function load(file, stack = []) {
    if (stack.includes(file)) throw new Error('Import cycle: ' + [...stack, file].map(rel).join(' -> '));
    if (modules.has(file)) return modules.get(file);
    let src = fs.readFileSync(file, 'utf8');
    if (/^\s*export\s+default\b/m.test(src)) throw new Error('export default is not supported: ' + rel(file));
    const mod = { id: '__m' + (nextId++), file, names: new Set() };
    const head = [], exports = [];
    const dep = spec => load(path.resolve(path.dirname(file), spec), [...stack, file]);

    src = src.replace(RE_IMPORT, (_, ns, list, spec) => {
      if (isThree(spec)) { head.push(ns ? `const ${ns} = window.THREE;` : `const { ${parseList(list).map(x => x.name === x.as ? x.name : `${x.name}: ${x.as}`).join(', ')} } = window.THREE;`); return ''; }
      const d = dep(spec);
      if (ns) { head.push(`const ${ns} = ${d.id};`); return ''; }
      const names = parseList(list);
      for (const x of names) if (!d.names.has(x.name)) throw new Error(`${rel(file)} imports "${x.name}" from ${spec}, but the bundler finds no such export in ${rel(d.file)}`);
      head.push(`const { ${names.map(x => x.name === x.as ? x.name : `${x.name}: ${x.as}`).join(', ')} } = ${d.id};`);
      return '';
    });
    src = src.replace(RE_EXPORT_FROM, (_, list, spec) => {
      const d = dep(spec);
      if (list === undefined) { exports.push(`...${d.id}`); for (const n of d.names) mod.names.add(n); }
      else parseList(list).forEach(x => { if (!d.names.has(x.name)) throw new Error(`${rel(file)} re-exports "${x.name}" from ${spec}, which has no such export`); exports.push(`${x.as}: ${d.id}.${x.name}`); mod.names.add(x.as); });
      return '';
    });
    for (const n of declaredExports(src)) { exports.push(n); mod.names.add(n); }
    src = src.replace(RE_EXPORT_LIST, '');
    src = src.replace(RE_EXPORT_DECL, (_, ws, kind, name) => `${ws}${kind} ${name}`);
    if (/^\s*(import|export)\s/m.test(src)) throw new Error('Unsupported import/export form left in ' + rel(file));

    mod.code = `// ---- ${rel(file)} ----\nconst ${mod.id} = (() => {\n${head.join('\n')}\n${src}\nreturn Object.freeze({ ${exports.join(', ')} });\n})();\n`;
    modules.set(file, mod); order.push(mod); // post-order: dependencies first
    return mod;
  }
  load(entry);
  return { order, code: `(() => {\n'use strict';\n${order.map(m => m.code).join('\n')}\n})();` };
}
