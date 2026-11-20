/**
 * The live readouts of the view's top-left box (#89): State, Pointing and Sensors, each a section whose title folds
 * it to a one-line summary (remembered with the rail cards, S.ui.folded 'hud:…'; Pointing and Sensors start folded,
 * so the box is about its old size). The rail keeps the settings.
 * Built by orbitView's hud() on every rail rebuild; `cur` is a getter of the geometry now (attitudeAt).
 */
import { S, save } from '../../state/store.js';
import { h, liveText } from '../../ui/dom.js';
import { deg, esc, fmt } from '../../ui/format.js';
import { payloadComp } from '../../sim/guidance.js';
import { pointing } from '../../sim/payload.js';
import { sensorEval } from '../../sim/sensors.js';
import { parseEpoch } from '../../sim/scenario.js';

/** A section of the box: its title button (with `summary()` shown while folded) and its body; folded at first if `folded0`. */
export function hudSection(key, title, summary, folded0, ...body) {
  const k = 'hud:' + key, sec = h('section', { class: 'hsec' });
  const head = h('button', { type: 'button', class: 'hhead', title: 'Fold or unfold' }, h('span', { class: 't' }, title), liveText(() => sec.classList.contains('folded') ? summary() : '', 'sum'));
  const set = on => { sec.classList.toggle('folded', on); head.setAttribute('aria-expanded', String(!on)); };
  set(S.ui.folded[k] ?? folded0);
  head.addEventListener('click', () => { const on = !sec.classList.contains('folded'); set(on); S.ui.folded[k] = on; save(); }); // kept either way: a default may be folded
  sec.append(head, ...body);
  return sec;
}

const kmT = x => x === null ? '—' : Math.abs(x) < 1 ? fmt(x * 1000, 0) + ' m' : fmt(x, 2) + ' km';
const row = (k, val) => `<dt>${k}</dt><dd>${val}</dd>`;

/** The payload's pointing error against the target of the settings flying now (sim/payload.js pointing); null without a payload. */
const anyPayload = () => [S.orbit, ...(S.orbit.schedule || [])].some(g => payloadComp(S, g));
/** What flies now, for a readout: the initial settings or the change at hh:mm:ss (only with a schedule). */
const flying = c => !(S.orbit.schedule || []).length ? '' : c.seg ? 'the change at ' + (parseEpoch(c.g.start) || new Date(0)).toISOString().slice(11, 19) + (c.g.name ? ' (' + esc(c.g.name) + ')' : '') : 'the initial settings';

export function pointingSection(cur) {
  if (!anyPayload()) return null;
  const p = () => { const c = cur(); return c ? pointing(S, c) : null; };
  return hudSection('pointing', 'Pointing', () => { const x = p(); return !x ? '' : !x.tgtUp ? 'target below horizon' : `${fmt(x.ang, 3)}° · ${kmT(x.gnd)}`; }, true,
    liveText(() => {
      const x = p(); if (!x) return '';
      const name = esc(x.c.name), c = cur(), g = c.g, by = flying(c);
      const head = `<dl class="kv">${row('Target', `${fmt(g.tgtLat, 2)}°, ${fmt(g.tgtLon, 2)}°${by ? ' · ' + by : ''}`)}</dl>`; // what the numbers are for (#89): the payload and target of what flies
      if (!x.tgtUp) return head + `<dl class="kv">${row(name + ' · target', `below the horizon · ${deg(x.elev).toFixed(1)}°`)}</dl>`;
      return head + `<dl class="kv">${row(name + ' angle error', fmt(x.ang, 3) + '°')}${row('along · cross', fmt(x.along, 3) + '° · ' + fmt(x.cross, 3) + '°')}${row('Ground error', kmT(x.gnd))}${row('along · cross', kmT(x.gAlong) + ' · ' + kmT(x.gCross))}${row('Target elevation', deg(x.elev).toFixed(1) + '°')}${x.h !== 0 && x.relief !== null ? row('Relief displacement', kmT(x.relief)) : ''}</dl>`;
    }));
}

/** Star trackers (Sun, Moon, limb and their state), Sun sensors seeing the Sun, and the payload's off-nadir angle. */
export function sensorsSection(cur) {
  const strs = () => S.sc.comps.filter(c => c.type === 'str'), css = () => S.sc.comps.filter(c => c.type === 'css');
  if (!strs().length && !css().length && !anyPayload()) return null;
  const state = s => s.ok ? '<span class="chip ok">Tracking</span>' : s.sunBlind ? '<span class="chip warn">Sun-blinded</span>' : s.earthBlind ? '<span class="chip bad">Earth in FOV</span>' : '<span class="chip moon">Moon-blinded</span>';
  return hudSection('sensors', 'Sensors', () => {
    const c = cur(); if (!c) return ''; const st = strs(), n = st.filter(x => sensorEval(x, c).ok).length, cs = css(), m = cs.filter(x => sensorEval(x, c).sees).length;
    return [st.length ? `STR ${n}/${st.length} tracking` : '', cs.length ? `Sun sensors ${m}/${cs.length}` : ''].filter(Boolean).join(' · ');
  }, true, liveText(() => {
    const c = cur(); if (!c) return ''; const rows = [];
    for (const x of strs()) { const s = sensorEval(x, c); rows.push(`<div class="srd"><span>${esc(x.name)}</span><span class="lbl">☉ ${s.sunAng.toFixed(0)}° · ☾ ${s.moonUp ? s.moonAng.toFixed(0) + '°' : '–'} · limb ${s.limb.toFixed(0)}°</span>${state(s)}</div>`); }
    const cs = css(); if (cs.length) { const n = cs.filter(x => sensorEval(x, c).sees).length; rows.push(`<div class="srd"><span>Sun sensors seeing Sun</span><span class="chip ${n ? 'ok' : 'dim'}">${n}/${cs.length}</span></div>`); }
    const pc = payloadComp(S, c.g); if (pc) rows.push(`<div class="srd"><span>${esc(pc.name)} off-nadir</span><span class="lbl">${sensorEval(pc, c).nadAng.toFixed(1)}°</span></div>`);
    return rows.join('');
  }), h('p', { class: 'tip' }, 'Exclusion angles: Spacecraft Layout. ☾ – : the Moon is behind the Earth.'));
}
