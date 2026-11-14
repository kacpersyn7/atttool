/** Files: download text as a file, and read a chosen or dropped one (scenario and spacecraft JSON). */
import { h } from './dom.js';
import { toast } from './overlay.js';

/** Largest file read (bytes): a scenario or spacecraft is a few kB. */
const MAX_BYTES = 5e6;

/** Save `text` as a file called `filename` (the browser's download). */
export function downloadText(filename, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A file name from a name and a kind: "Image pass" + "scenario" → "Image_pass.scenario.json" (or another extension). */
export function fileName(name, kind, ext = 'json') {
  const base = String(name || '').trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[_.]+|[_.]+$/g, ''); // letters of any language
  return (base || kind) + '.' + kind + '.' + ext;
}

async function readFile(f, onText, exts = ['json']) {
  const ok = exts.some(x => f.name.toLowerCase().endsWith('.' + x) || f.type.includes(x));
  if (!ok) { toast(`${f.name} is not a ${exts.map(x => '.' + x).join(' or ')} file`); return; }
  if (f.size > MAX_BYTES) { toast(`${f.name} is too large for AttTool (over 5 MB)`); return; }
  try { onText(await f.text(), f.name); } catch (e) { toast('Could not read ' + f.name); }
}

/** An "Open file…" button (with its hidden file input) that passes the text of the chosen file to onText. */
export function openFileButton(label, onText, exts = ['json']) {
  const input = h('input', { type: 'file', accept: [...exts.map(x => '.' + x), ...(exts.includes('json') ? ['application/json'] : [])].join(','), hidden: true });
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) readFile(f, onText, exts); });
  return h('span', null, h('button', { class: 'btn', type: 'button', onclick: () => input.click() }, label), input);
}

/** Make `el` take a dropped file: its text goes to onText. It is outlined while a file is dragged over it. */
export function onFileDrop(el, onText, exts = ['json']) {
  const hasFile = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  el.addEventListener('dragover', e => { if (!hasFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('dropping'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('dropping'); });
  el.addEventListener('drop', e => {
    if (!hasFile(e)) return; e.preventDefault(); e.stopPropagation(); el.classList.remove('dropping');
    const fs = e.dataTransfer.files; if (fs.length > 1) toast('One file at a time: the first one is read'); if (fs[0]) readFile(fs[0], onText, exts);
  });
  return el;
}

/**
 * Stop a file dropped anywhere else from opening in the tab (which would leave the app). Call once at start-up;
 * drop targets (onFileDrop) take theirs first.
 */
export function guardFileDrops() {
  const files = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  // a drop target has already called preventDefault (and set its own dropEffect): leave those alone
  addEventListener('dragover', e => { if (files(e) && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  addEventListener('drop', e => { if (files(e)) e.preventDefault(); });
}
