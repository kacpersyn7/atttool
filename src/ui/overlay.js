/** Toast, modal dialog and clipboard helpers. */
import { $, h } from './dom.js';

export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 1600); }

export function showModal(content) {
  const m = $('#modal'); m.innerHTML = '';
  const box = h('div', { class: 'box', role: 'dialog', 'aria-modal': 'true' }, h('div', { style: 'display:flex;justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => m.hidden = true }, 'Close')), content);
  m.append(box); m.hidden = false; m.onclick = e => { if (e.target === m) m.hidden = true; };
}
export function closeModal() { $('#modal').hidden = true; }

/** Copy to clipboard; falls back to a modal with a selectable textarea. */
export function copyText(text, what) {
  const done = () => toast(what + ' copied');
  try { navigator.clipboard.writeText(text).then(done, () => fallback()); } catch (e) { fallback(); }
  function fallback() {
    showModal(h('div', null, h('h2', null, 'Copy ' + what), h('p', null, 'Clipboard access is blocked here. Select the text and copy it manually.'), h('textarea', { style: 'width:100%;min-height:260px', readonly: true }, text)));
    const ta = $('#modal textarea'); ta.focus(); ta.select();
  }
}
