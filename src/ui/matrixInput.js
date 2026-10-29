/**
 * DCM text input: paste a 3×3 matrix (MATLAB / NumPy / plain rows), choose its direction,
 * validate it as a rotation, optionally orthonormalise, and copy it back as MATLAB.
 */
import { m } from '../core/linalg.js';
import { parseMatrix3, formatMatlab, checkRotation, orthonormalize } from '../core/matrixText.js';
import { h, seg, onSync } from './dom.js';
import { copyText, toast } from './overlay.js';

/**
 * @param {object} o
 * @param {string} o.id
 * @param {() => number[][]} o.get    current matrix in the canonical direction
 * @param {(C: number[][]) => void} o.set
 * @param {[string, string]} o.labels  [canonical direction, transposed direction]
 * @param {() => number} o.dir          0 = canonical, 1 = transposed (as shown / typed)
 * @param {(d: number) => void} o.setDir
 */
export function dcmInput({ id, get, set, labels, dir, setDir }) {
  const ta = h('textarea', { id, rows: 3, spellcheck: 'false', class: 'dcm', 'aria-label': 'Direction cosine matrix' });
  const msg = h('p', { class: 'tip dcm-msg' });
  const shown = () => (dir() ? m.T(get()) : get());
  const show = () => { ta.value = formatMatlab(shown(), 6); ta._dirty = false; msg.textContent = ''; msg.className = 'tip dcm-msg'; fix.hidden = true; };
  const say = (t, cls = 'bad') => { msg.textContent = t; msg.className = 'tip dcm-msg ' + cls; };
  const read = () => { const M = parseMatrix3(ta.value); return dir() ? m.T(M) : M; };
  ta.addEventListener('input', () => { ta._dirty = true; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } });
  function apply() {
    let C; try { C = read(); } catch (e) { say(e.message); return; }
    const r = checkRotation(C);
    if (r.ok) { set(orthonormalize(C)); show(); toast('Matrix applied'); return; }
    if (r.fixable) { say(`Not exactly a rotation: |CᵀC − I| = ${r.err.toExponential(1)}. Orthonormalise applies the nearest rotation.`, 'warn'); fix.hidden = false; return; }
    say(r.det < 0 ? 'det = −1: this is a reflection, not a rotation. Check a sign or the axis order.' : `Not a rotation matrix (orthogonality error ${r.err.toFixed(2)}).`);
  }
  const fix = h('button', { class: 'btn', hidden: true, onclick: () => { try { const C = orthonormalize(read()); if (!C) throw new Error('Matrix is singular.'); set(C); show(); toast('Nearest rotation applied'); } catch (e) { say(e.message); } } }, 'Orthonormalise & apply');
  onSync(() => { if (document.activeElement !== ta && !ta._dirty) show(); });
  return h('div', { class: 'dcm-input' },
    seg([[0, labels[0]], [1, labels[1]]], dir, v => { setDir(v); show(); }),
    ta,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: apply, title: 'Ctrl/⌘ + Enter' }, 'Apply'), fix,
      h('button', { class: 'btn', onclick: () => copyText(formatMatlab(shown(), 9), 'Matrix (MATLAB)') }, 'Copy as MATLAB'),
      h('button', { class: 'btn', onclick: show }, 'Revert')),
    msg);
}
