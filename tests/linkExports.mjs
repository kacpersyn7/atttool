/**
 * For tests/bundle.test.js, run with --experimental-vm-modules: the names each module of src/ really exports, from
 * linking it as an ES module (not evaluating it, so the views need no browser). 'three' and its addons are stubbed.
 * Prints { "src/…": [names] } as JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => path.join(root, 'src', f));
const context = vm.createContext({});
const cache = new Map();
const three = spec => new vm.SyntheticModule(spec === 'three' ? [] : ['OrbitControls', 'TransformControls'], () => {}, { context, identifier: spec });
function moduleOf(file) {
  if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: pathToFileURL(file).href }));
  return cache.get(file);
}
const link = (spec, ref) => spec === 'three' || spec.startsWith('three/') ? three(spec) : moduleOf(path.resolve(path.dirname(fileURLToPath(ref.identifier)), spec));
const out = {};
for (const f of files) { const m = moduleOf(f); if (m.status === 'unlinked') await m.link(link); out[path.relative(root, f)] = Reflect.ownKeys(m.namespace).filter(k => typeof k === 'string').sort(); }
process.stdout.write(JSON.stringify(out));
