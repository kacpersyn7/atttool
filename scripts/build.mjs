#!/usr/bin/env node
/**
 * Build dist/AttTool.html — ONE self-contained file you can double-click, e-mail or host anywhere.
 * Zero dependencies: the bundler is scripts/bundle.mjs (the module syntax it supports is listed there).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';

const THREE_VERSION = '0.128.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { order, code } = bundle(path.join(root, 'src/main.js'), root);
const bundled = code.replace(/<\/script/gi, '<\\/script');

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
  .replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `${three}\n${guard}\n<script>\nif (window.THREE) ${bundled}\n</script>`);

// Build label next to the version: set BUILD_LABEL (CI / Pages do, e.g. "main 0f7fc8c"); empty for releases.
const label = (process.env.BUILD_LABEL || '').replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/, '$1').replace(/[<>"&]/g, '').trim();
html = html.replace(/\s*<!-- Build label[^>]*-->\s*<meta name="atttool-build" content="[^"]*">/, label ? `\n  <meta name="atttool-build" content="${label}">` : '');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
html = html.replace('<head>', `<head>\n  <!-- Built ${stamp} UTC by scripts/build.mjs from src/ — do not edit; edit src/ and rebuild. -->`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/AttTool.html');
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} — ${order.length} modules, ${(html.length / 1024).toFixed(0)} kB`);
