/**
 * Spacecraft library: several spacecraft in one state, one of them active.
 *
 * state.sc stays THE active spacecraft, so everything else reads it as before. state.fleet holds
 * { active: id, items: [{ id, name, sc, tgtComp }] }: the active item's sc is null (its data is in
 * state.sc), the others are parked there with their own pointing axis (orbit.tgtComp refers to a part ID).
 * Pure functions on the state object; the caller calls scChanged() after a change of state.sc.
 */
import { newId } from './component.js';

const copy = x => JSON.parse(JSON.stringify(x));

/** A name not yet used in the library: base, or "base 2", "base 3", … */
export function uniqueName(fleet, base) {
  const used = new Set(fleet.items.map(i => i.name)); if (!used.has(base)) return base;
  let n = 2; while (used.has(`${base} ${n}`)) n++; return `${base} ${n}`;
}

/** Create or repair state.fleet: exactly one active item holding state.sc, parked items with data. */
export function ensureFleet(s) {
  const f = s.fleet && Array.isArray(s.fleet.items) ? s.fleet : (s.fleet = { active: null, items: [] });
  f.items = f.items.filter(i => i && i.id && (i.id === f.active || (i.sc && i.sc.bus && Array.isArray(i.sc.comps))));
  if (!f.items.some(i => i.id === f.active)) { const it = { id: newId(), name: uniqueName(f, 'Spacecraft 1'), sc: null, tgtComp: '' }; f.items.unshift(it); f.active = it.id; }
  f.items.find(i => i.id === f.active).sc = null;
  return f;
}

export const activeItem = s => s.fleet.items.find(i => i.id === s.fleet.active);

/** Make item id the active spacecraft. @returns true if it changed. */
export function selectSpacecraft(s, id) {
  const f = s.fleet, to = f.items.find(i => i.id === id); if (!to || id === f.active) return false;
  const from = activeItem(s); from.sc = s.sc; from.tgtComp = s.orbit.tgtComp || '';
  s.sc = to.sc; s.orbit.tgtComp = to.tgtComp || ''; to.sc = null; f.active = id;
  return true;
}

/** Add a spacecraft (taken over, not copied) and make it active. @returns its id. */
export function addSpacecraft(s, sc, name) {
  const f = s.fleet, it = { id: newId(), name: uniqueName(f, String(name || '').trim() || 'Spacecraft'), sc, tgtComp: '' };
  f.items.push(it); selectSpacecraft(s, it.id); return it.id;
}

/** Add a copy of the active spacecraft, with the same pointing axis, and make it active. @returns its id. */
export function duplicateSpacecraft(s) {
  const tc = s.orbit.tgtComp, id = addSpacecraft(s, copy(s.sc), activeItem(s).name + ' copy');
  s.orbit.tgtComp = tc || ''; return id;
}

/** Rename an item; a blank or already used name is ignored. @returns true if it changed. */
export function renameSpacecraft(s, id, name) {
  const it = s.fleet.items.find(i => i.id === id), n = String(name || '').trim();
  if (!it || !n || s.fleet.items.some(i => i !== it && i.name === n)) return false;
  it.name = n; return true;
}

/** Delete an item; the last one stays. Deleting the active one activates its neighbour. @returns true if deleted. */
export function deleteSpacecraft(s, id) {
  const f = s.fleet, k = f.items.findIndex(i => i.id === id); if (k < 0 || f.items.length < 2) return false;
  if (id === f.active) selectSpacecraft(s, f.items[k + 1 < f.items.length ? k + 1 : k - 1].id);
  f.items.splice(f.items.findIndex(i => i.id === id), 1); return true;
}
