/**
 * Tiny DOM toolkit for the control rail.
 *
 * Panels are rebuilt from scratch (renderRail) whenever their structure changes. Two registries
 * keep them in step with the state without a framework:
 *   - syncs: push state -> input values. Run by syncAll() after any programmatic state change.
 *   - live:  read-only text that is recomputed ~10× per second (tickLive) while visible.
 * Every widget takes a `get` and `set` so it never holds its own copy of the value.
 */

export const $ = (s, r = document) => r.querySelector(s);

/** Hyperscript: h('div', {class:'x', onclick:fn}, child, [children], 'text'). */
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

/* ---------- binding registries ---------- */
const syncs = [];
const live = [];
/** Forget all bindings (call before rebuilding the rail). */
export function resetBindings() { syncs.length = 0; live.length = 0; }
/** Register a state -> widget sync function. */
export function onSync(f) { syncs.push(f); }
export function syncAll() { for (const f of syncs) f(); }
export function tickLive() { for (const f of live) f(); }

/* ---------- widgets ---------- */
export function card(title, tag, ...kids) { return h('section', { class: 'card' }, h('h3', null, title, h('span', { class: 'sp' }), tag ? h('span', { class: 'tag' }, tag) : null), ...kids); }
export function tip(html) { return h('p', { class: 'tip', html }); }

/** Range slider + number box. `label` may be a string or a DOM node. */
export function slider({ id, label, min, max, step = 0.1, get, set, dec = 1 }) {
  const r = h('input', { type: 'range', id: id + '-r', min, max, step, 'aria-label': typeof label === 'string' ? label : id });
  const n = h('input', { type: 'number', id: id + '-n', step, 'aria-label': (typeof label === 'string' ? label : id) + ' value' });
  r.addEventListener('input', () => { set(+r.value); n.value = (+r.value).toFixed(dec); });
  n.addEventListener('change', () => { const x = +n.value; if (!isFinite(x)) return; set(x); r.value = x; });
  const lab = h('label', { for: id + '-n' }); if (typeof label === 'string') lab.textContent = label; else lab.append(label);
  syncs.push(() => { const x = get(); if (document.activeElement !== r) r.value = x; if (document.activeElement !== n) n.value = (+x).toFixed(dec); });
  return h('div', { class: 'row' }, lab, r, n);
}

/** Small labelled number input (for grids). */
export function numCell(id, label, get, set, step = 0.01, dec = 3) {
  const n = h('input', { type: 'number', id, step, 'aria-label': label });
  n.addEventListener('change', () => { const x = +n.value; if (isFinite(x)) set(x); });
  syncs.push(() => { if (document.activeElement !== n) n.value = (+get()).toFixed(dec); });
  return h('div', { class: 'cell' }, h('span', null, label), n);
}

/** Labelled <select>. options = [[value, text], ...]. */
export function selectRow({ id, label, options, get, set }) {
  const s = h('select', { id }, options.map(([v, t]) => h('option', { value: v }, t)));
  s.addEventListener('change', () => set(s.value));
  syncs.push(() => { if (s.value !== String(get())) s.value = get(); });
  return h('div', { class: 'row two' }, h('label', { for: id }, label), s);
}

export function check(id, label, get, set) {
  const c = h('input', { type: 'checkbox', id });
  c.addEventListener('change', () => set(c.checked));
  syncs.push(() => { c.checked = !!get(); });
  return h('label', { class: 'chk', for: id }, c, label);
}

/** Segmented button group. options = [[value, text], ...]. */
export function seg(options, get, set) {
  const w = h('div', { class: 'seg', role: 'group' });
  const bs = options.map(([v, t]) => { const b = h('button', { type: 'button', onclick: () => { set(v); syncAll(); } }, t); b._v = v; w.append(b); return b; });
  syncs.push(() => bs.forEach(b => b.classList.toggle('on', b._v === get())));
  return w;
}

/** Span whose innerHTML = fn(), refreshed by tickLive(). */
export function liveText(fn, cls) { const s = h('span', { class: cls }); live.push(() => { const t = fn(); if (s._t !== t) { s._t = t; s.innerHTML = t; } }); return s; }

/** Button that needs two clicks within 2.5 s (for destructive actions). */
export function confirmButton(label, armedLabel, action, cls = 'btn danger') {
  let armed = false;
  const b = h('button', { class: cls, onclick: () => { if (!armed) { armed = true; b.textContent = armedLabel; setTimeout(() => { armed = false; b.textContent = label; }, 2500); return; } action(); } }, label);
  return b;
}
