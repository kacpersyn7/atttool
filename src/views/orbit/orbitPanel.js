/** Control rail for the Orbit & Frames workspace. */
import * as ENV from '../../env/index.js';
import { S, save, scChanged, defaultState } from '../../state/store.js';
import { h, card, tip, slider, numCell, selectRow, check, seg, liveText, syncAll, onSync, confirmButton } from '../../ui/dom.js';
import { deg, esc, fmt, hhmm, tPlus } from '../../ui/format.js';
import { TYPES } from '../../spacecraft/componentTypes.js';
import { activeItem, selectSpacecraft } from '../../spacecraft/library.js';
import { MAX_CHANGES, activeScenario, addScenario, deleteScenario, duplicateScenario, exportScenario, importScenario, newScenarioOrbit, renameScenario, selectScenario } from '../../sim/scenarioLibrary.js';
import { TGT_ALT_MIN, TGT_ALT_MAX, targetHeight, DATE_MAX, DATE_MIN, PRESETS, SCRUB_SPANS, clampTime, currentDate, epochDate, farFromEpoch, formatEpoch, ltanOf, orbitElements, scrubCancelResume, scrubEnd, scrubHold, scrubKey, scrubPress, scrubSpan, scrubWindowAt, setCurrentDate, setEpoch, switchDefinition, restartFromState, definitionError, tleOf, parseEpoch } from '../../sim/scenario.js';
import { copyText, showModal, closeModal, toast } from '../../ui/overlay.js';
import { TARGET_SLEW, changeTurn, payloadComp, scheduleOrder } from '../../sim/guidance.js';
import { addChange, deleteChange, scheduleNotes, setChangeMode, setChangeStart, takeRotation } from '../../sim/schedule.js';
import { sensorEval } from '../../sim/sensors.js';
import { pointing } from '../../sim/payload.js';

/** Body-axis choices for pointing modes; optionally include component boresights / normals. */
function axisOptions(withComps = true) {
  const base = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'].map(a => [a, 'Body ' + a.replace('-', '−')]);
  if (withComps) S.sc.comps.filter(c => TYPES[c.type].cone || c.type === 'sa').forEach(c => base.push(['comp:' + c.id, c.name + (c.type === 'sa' ? ' normal' : ' boresight')]));
  return base;
}

/**
 * @param {object} ctx cur() = current attitudeAt() result, applyPreset(k), zoomSC(), setInset(bool), setPlView(bool), renderRail()
 */
export function orbitPanel(ctx) {
  const o = S.orbit, out = [];
  const sl = (id, label, min, max, step, key, dec = 1) => slider({ id, label, min, max, step, dec, get: () => o[key], set: x => { o[key] = x; o.preset = 'custom'; save(); syncAll(); } });

  out.push(scenarioCard(ctx));
  out.push(orbitCard(ctx, o, sl));

  const playBtn = h('button', { class: 'btn primary', style: 'min-width:84px', onclick: () => { scrubCancelResume(hold); o.playing = !o.playing; save(); syncAll(); } });
  onSync(() => playBtn.textContent = o.playing ? '❚❚ Pause' : '▶ Play');
  const nowInput = dateInput('now');
  const showNow = () => nowInput.value = formatEpoch(new Date(Math.floor(currentDate(o).getTime() / 1000) * 1000));
  // typing a time while the clock runs would edit a stale value: pause first
  nowInput.addEventListener('focus', () => { if (o.playing) { o.playing = false; save(); } showNow(); syncAll(); });
  nowInput.addEventListener('change', () => { if (setCurrentDate(o, nowInput.value)) { save(); syncAll(); } else refused(); });
  nowInput.addEventListener('blur', () => syncAll());
  onSync(() => { if (document.activeElement !== nowInput) showNow(); });
  out.push(card('Time', null,
    h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, playBtn,
      seg([[1, '1×'], [60, '60×'], [300, '300×'], [1000, '1000×']], () => o.speed, v => { o.speed = v; save(); })),
    h('div', { class: 'row two' }, h('label', { for: 'now' }, 'Current time (UTC)'), nowInput),
    timeScrubber(o),
    h('div', { class: 'kv' }, h('dt', null, 'From the epoch'), h('dd', null, liveText(() => tPlus(o.t)))),
    liveText(() => { const d = farFromEpoch(o); return d === null ? '' : `<p class="tip" style="color:var(--warn)">${d.toFixed(0)} days from the epoch: the Sun geometry and the plane drift still hold, the position along the orbit does not (no drag).</p>`; }),
    tip('Moving the time keeps the orbit. The slider shows one page at a time, counted from the epoch; release it at either end to turn the page, or type a date.')));

  const sched = o.schedule || [];
  if (selChange && !sched.some(c => c.id === selChange)) selChange = null; // gone: deleted, another scenario
  const g = sched.find(c => c.id === selChange) || o; // the settings the guidance controls edit
  const modeCtl = [];
  const axLbl = (name, color, ax) => h('span', null, name + ' · ', h('span', { class: 'ax', style: 'color:var(--ax-' + color + ')' }, ax));
  if (g.mode === 'offsets') modeCtl.push(
    slider({ id: 'roll', label: axLbl('Roll φ', 'x', 'X″'), min: -60, max: 60, step: .5, get: () => g.roll, set: x => { g.roll = x; save(); } }),
    slider({ id: 'pitch', label: axLbl('Pitch θ', 'y', 'Y′'), min: -60, max: 60, step: .5, get: () => g.pitch, set: x => { g.pitch = x; save(); } }),
    slider({ id: 'yaw', label: axLbl('Yaw ψ', 'z', 'Z'), min: -180, max: 180, step: .5, get: () => g.yaw, set: x => { g.yaw = x; save(); } }),
    h('div', { class: 'kv' }, h('dt', null, 'Nominal attitude'), h('dd', null, liveText(() => { const a = S.sc.align; return a.mode === 'dcm' ? a.ref.toUpperCase() + ' · DCM' : `${a.ref.toUpperCase()} +X ↔ SCF ${a.x.replace('-', '−')} · +Y ↔ SCF ${a.y.replace('-', '−')}`; }))),
    tip('Zero offsets = the nominal attitude set in <b>Spacecraft Layout → Attitude reference</b>. The offsets turn the spacecraft from there by a 3-2-1 sequence about its own axes (yaw Z, pitch Y′, roll X″). With the example layout, <b>roll</b> tilts the payload cross-track (side-looking imaging), <b>pitch</b> along-track (stereo).'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => { g.roll = g.pitch = g.yaw = 0; save(); syncAll(); } }, 'Zero offsets'),
      h('button', { class: 'btn', onclick: () => { g.roll = 25; g.pitch = 0; g.yaw = 0; save(); syncAll(); } }, 'Side-look 25°'),
      h('button', { class: 'btn', onclick: () => { g.roll = 0; g.pitch = 20; save(); syncAll(); } }, 'Forward 20°')));
  if (g.mode === 'sun') modeCtl.push(
    selectRow({ id: 'sunAxis', label: 'Point at Sun', options: axisOptions(), get: () => g.sunAxis, set: v => { g.sunAxis = v; save(); } }),
    selectRow({ id: 'sunSecAxis', label: 'Secondary axis', options: axisOptions(false), get: () => g.sunSecAxis || '+X', set: v => { g.sunSecAxis = v; save(); } }),
    selectRow({ id: 'sunSec', label: '…toward', options: [['nadir', 'Nadir'], ['normal', 'Orbit normal +h'], ['antinormal', 'Orbit normal −h'], ['velocity', 'Velocity'], ['zenith', 'Zenith']], get: () => g.sunSec, set: v => { g.sunSec = v; save(); } }),
    tip('Two-vector (TRIAD) pointing: the primary axis is aligned exactly, the secondary only as close as possible. Typical safe mode: array normal on the Sun.'));
  const altCell = (id, label) => numCell(id, label, () => targetHeight(g) * 1000, x => { g.tgtAlt = Math.max(TGT_ALT_MIN, Math.min(TGT_ALT_MAX, x)); save(); }, 100, 0);
  if (g.mode === 'target') modeCtl.push(
    h('div', { class: 'grid2' }, numCell('tlat', 'Latitude °', () => g.tgtLat, x => { g.tgtLat = x; save(); }, .1, 2), numCell('tlon', 'Longitude °', () => g.tgtLon, x => { g.tgtLon = x; save(); }, .1, 2), altCell('talt', 'Height m')),
    selectRow({ id: 'tgtComp', label: 'Pointing axis', options: S.sc.comps.filter(c => TYPES[c.type].cone).map(c => [c.id, c.name]), get: () => (payloadComp(S, g) || {}).id, set: v => { g.tgtComp = v; save(); ctx.renderRail(); } }),
    h('div', { class: 'status' }, liveText(() => { const cur = ctx.cur(); if (cur && cur.g !== g && sched.length) return `<span class="chip dim">Not flying now: ${g === o ? 'a change is' : 'it starts at ' + esc(showUTC(g.start))}</span>`; return !cur || !cur.flag ? '' : cur.flag.slew ? (cur.flag.slew.rising ? `<span class="chip warn">Slewing to the target · ${(100 * cur.flag.slew.w).toFixed(0)} % · rises in ${cur.flag.slew.dt.toFixed(0)} s</span>` : `<span class="chip warn">Target set ${cur.flag.slew.dt.toFixed(0)} s ago · slewing back · ${(100 * (1 - cur.flag.slew.w)).toFixed(0)} %</span>`) : cur.flag.below ? `<span class="chip dim">Target below horizon · holding nadir</span>` : `<span class="chip ok">Tracking · elevation ${deg(cur.flag.elev).toFixed(1)}°</span>`; })),
    tgtSlewRow(g),
    tip('Boresight → line of sight to the ground point, body +X kept toward velocity. Below the horizon it holds the nominal attitude, and it slews to the target that many seconds before the target rises (so tracking starts at the rise) and back after it sets; 0 jumps. Watch the body rate rise near closest approach.'));
  if (g.mode === 'inertial' && g === o) modeCtl.push(tip('Body frame fixed in ECI using the attitude from <b>Rotation Lab</b> (reference R = ECI). Watch the Sun and Earth sweep around the spacecraft once per orbit.'));
  if (g.mode === 'inertial' && g !== o) modeCtl.push(
    tip('This change keeps the attitude Rotation Lab had when it was made inertial (reference R = ECI). Set another one there, then take it here.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { takeRotation(g, S.rot.q); save(); toast('Rotation Lab attitude taken'); } }, 'Take the Rotation Lab attitude')));
  out.push(scheduleCard(ctx, o));
  out.push(card('Attitude guidance', g === o ? null : liveText(() => 'change at ' + esc(showUTC(g.start))),
    sched.length ? h('p', { class: 'tip', style: 'margin:0' }, g === o ? 'Editing the initial settings, flown before the first change.' : 'Editing the change selected in Mode schedule.') : null,
    selectRow({ id: 'mode', label: 'Mode', options: [['offsets', 'Nominal attitude + offsets'], ['target', 'Ground target tracking'], ['sun', 'Sun pointing'], ['inertial', 'Inertial (from Rotation Lab)']], get: () => g.mode, set: v => { if (g === o) o.mode = v; else setChangeMode(g, v, S.rot.q); save(); ctx.renderRail(); } }),
    selectRow({ id: 'refFrame', label: 'Shown orbital frame', options: Object.entries(ENV.ORBIT_FRAMES).map(([k, f]) => [k, f.label]), get: () => o.refFrame, set: v => { o.refFrame = v; save(); ctx.renderRail(); } }),
    ...modeCtl));

  if (payloadComp(S, g)) out.push(card('Payload pointing', payloadComp(S, g).name + ' vs ground target',
    g.mode === 'target' ? null : h('div', { class: 'grid2' }, numCell('ptlat', 'Target lat °', () => g.tgtLat, x => { g.tgtLat = x; save(); }, .1, 2), numCell('ptlon', 'Target lon °', () => g.tgtLon, x => { g.tgtLon = x; save(); }, .1, 2), altCell('ptalt', 'Target height m')),
    liveText(() => {
      const cur = ctx.cur(); if (!cur) return ''; const p = pointing(S, cur); if (!p) return '';
      const note = sched.length && cur.g !== g ? `<p class="tip" style="margin:0 0 4px">Now flying: ${cur.seg ? 'the change at ' + esc(showUTC(cur.g.start)) : 'the initial settings'}. The numbers are for its payload and target.</p>` : '';
      if (!p.tgtUp) return note + `<span class="chip dim">Target below horizon · elevation ${deg(p.elev).toFixed(1)}°</span>`;
      const kmT = x => x === null ? '—' : Math.abs(x) < 1 ? fmt(x * 1000, 0) + ' m' : fmt(x, 2) + ' km';
      const row = (k, val) => `<div style="display:flex;justify-content:space-between"><span>${k}</span><span style="font-family:var(--f-mono)">${val}</span></div>`;
      return note + `<div style="display:flex;flex-direction:column;gap:4px">${row('Angle error', fmt(p.ang, 3) + '°')}${row('along · cross', fmt(p.along, 3) + '° · ' + fmt(p.cross, 3) + '°')}${row('Ground error', kmT(p.gnd))}${row('along · cross', kmT(p.gAlong) + ' · ' + kmT(p.gCross))}${row('Target elevation', deg(p.elev).toFixed(1) + '°')}${p.h !== 0 && p.relief !== null ? row('Relief displacement', kmT(p.relief)) : ''}</div>`;
    }),
    tip('Boresight minus target. <b>along</b> > 0: looking ahead of the target along the ground track; <b>cross</b> > 0: looking to the right of it. Ground error is measured from the target to where the boresight hits the Earth (at the height of the target). In <b>Ground target tracking</b> mode it is zero by construction (no attitude errors yet). A target with a height is seen shifted from the point under it (hollow marker in the payload view): that shift is the relief displacement.')));

  out.push(card('Sensors now', 'live',
    liveText(() => {
      const cur = ctx.cur(); if (!cur) return ''; const rows = [];
      for (const c of S.sc.comps) {
        if (c.type !== 'str') continue;
        const s = sensorEval(c, cur);
        rows.push(`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span>${esc(c.name)}</span><span class="lbl" style="font-family:var(--f-mono);font-size:11.5px">☉ ${s.sunAng.toFixed(0)}° · ☾ ${s.moonUp ? s.moonAng.toFixed(0) + '°' : '–'} · limb ${s.limb.toFixed(0)}°</span>${s.ok ? '<span class="chip ok">Tracking</span>' : s.sunBlind ? '<span class="chip warn">Sun-blinded</span>' : s.earthBlind ? '<span class="chip bad">Earth in FOV</span>' : '<span class="chip moon">Moon-blinded</span>'}</div>`);
      }
      const css = S.sc.comps.filter(c => c.type === 'css'); if (css.length) { const n = css.filter(c => sensorEval(c, cur).sees).length; rows.push(`<div style="display:flex;justify-content:space-between"><span>Sun sensors seeing Sun</span><span class="chip ${n ? 'ok' : 'dim'}">${n}/${css.length}</span></div>`); }
      const pc = payloadComp(S, cur.g); if (pc) { const s = sensorEval(pc, cur); rows.push(`<div style="display:flex;justify-content:space-between"><span>${esc(pc.name)} off-nadir</span><span style="font-family:var(--f-mono)">${s.nadAng.toFixed(1)}°</span></div>`); }
      return `<div style="display:flex;flex-direction:column;gap:6px">${rows.join('')}</div>`;
    }),
    tip('Star tracker is blinded if the Sun is inside its exclusion angle, the Earth limb is closer than its Earth exclusion, or the Moon (when not behind the Earth) is inside its Moon exclusion. ☾ – = Moon behind the Earth. Edit the angles in <b>Spacecraft Layout</b>.')));

  out.push(card('Display', null,
    h('div', { class: 'checks' },
      check('s-eci', 'ECI frame', () => o.show.eci, v => { o.show.eci = v; save(); }), check('s-orb', 'Orbital frame + v', () => o.show.orbFrame, v => { o.show.orbFrame = v; save(); }),
      check('s-track', 'Ground track', () => o.show.track, v => { o.show.track = v; save(); }), check('s-sun', 'Sun vector', () => o.show.sunv, v => { o.show.sunv = v; save(); }), check('s-moon', 'Moon + vector', () => o.show.moonv, v => { o.show.moonv = v; save(); }),
      check('s-b', 'Magnetic field B', () => o.show.bv, v => { o.show.bv = v; save(); }), check('s-cones', 'Sensor FOV cones', () => o.show.cones, v => { o.show.cones = v; save(); }),
      check('s-follow', 'Camera follows S/C', () => o.show.follow, v => { o.show.follow = v; if (v) ctx.zoomSC(); save(); }),
      check('s-inset', 'Body-frame inset', () => !o.hideInset, v => { o.hideInset = !v; ctx.setInset(v); save(); }), check('s-plview', 'Payload view', () => o.show.plView, v => { o.show.plView = v; ctx.setPlView(v); save(); }),
      check('s-plbord', 'Map borders', () => o.show.plBorders, v => { o.show.plBorders = v; save(); }), check('s-plcity', 'Map cities', () => o.show.plCities, v => { o.show.plCities = v; save(); })),
    slider({ id: 'scscale', label: 'S/C size (×)', min: .1, max: 4, step: .05, dec: 2, get: () => o.scale, set: x => { o.scale = x; save(); } }),
    tip('The spacecraft is drawn hugely oversized (about 130 km per metre at 1×) so you can see it from orbit distance. The map in the payload view and on the Earth is Natural Earth 1:50m (public domain): schematic, good to a few km, so use it for orientation, not to measure pointing errors.')));
  return out;
}

/** The slew to and from a ground target (s), for the settings g being edited. */
function tgtSlewRow(g) {
  const n = h('input', { type: 'number', id: 'tgtSlew', min: 0, max: 3600, step: 1 });
  const val = () => Number.isFinite(+g.tgtSlew) ? +g.tgtSlew : TARGET_SLEW;
  n.addEventListener('change', () => { const x = +n.value; if (n.value !== '' && Number.isFinite(x)) { g.tgtSlew = Math.max(0, Math.min(3600, Math.round(x))); save(); } n.value = val(); syncAll(); });
  onSync(() => { if (document.activeElement !== n) n.value = val(); });
  return h('div', { class: 'row two' }, h('label', { for: 'tgtSlew', title: 'Before the target rises and after it sets, 0 to 3600 s (0: a jump)' }, 'Slew to/from (s)'), n);
}

const dateInput = id => h('input', { type: 'datetime-local', id, step: '1', min: DATE_MIN, max: DATE_MAX });
const refused = () => toast(`Enter a date from ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)}`);

/* ---------------- Mode schedule: changes of guidance mode at set times, with slews ---------------- */
let selChange = null; // id of the change the guidance controls edit; null: the initial settings
const MODE_SHORT = { offsets: 'Nominal', target: 'Target', sun: 'Sun', inertial: 'Inertial' };
/** Warning text for scheduleNotes entries. */
const noteText = ns => (ns || []).map(n => n === 'tie' ? 'Same start as another change: this one flies, as the later in the list' : n === 'overridden' ? 'Never flies: a later change in the list starts at the same moment' : 'Starts during the slew before it, so it blends from that slew').join('. ');
/** A start for display: always with seconds, without fractions. */
const showUTC = str => { const d = parseEpoch(str); return d ? d.toISOString().slice(0, 19).replace('T', ' ') : str; };

function scheduleCard(ctx, o) {
  const sched = o.schedule || [], sel = sched.find(c => c.id === selChange) || null;
  const pick = id => {
    selChange = id || null;
    const c = sched.find(c => c.id === id); if (c) setCurrentDate(o, c.start); // jump to its start
    save(); ctx.renderRail();
  };
  // the live list may be redrawn between press and release (a start applied on blur changes it), and then the
  // browser fires no click: a pointer picks the row the press started on when it is released over the list;
  // click is left for the keyboard (Enter / Space on a row)
  let pressed = null;
  const rowOf = e => { const b = e.target.closest('[data-id]'); return b ? b.dataset.id : null; };
  const list = h('div', {
    onpointerdown: e => { pressed = e.button === 0 ? rowOf(e) : null; },
    onpointerup: e => { const id = pressed; pressed = null; if (id !== null && e.button === 0) pick(id); },
    onclick: e => { if (e.detail === 0) { const id = rowOf(e); if (id !== null) pick(id); } },
  },
    liveText(() => {
      const cur = ctx.cur(), now = cur && cur.seg ? cur.seg.id : '';
      const notes = scheduleNotes(o);
      const row = (id, start, mode, slew, warn = '', info = '') => `<button type="button" class="srow${(selChange || '') === id ? ' on' : ''}" data-id="${esc(id)}" title="${warn ? esc(warn) + '. ' : ''}${info ? esc(info) + '. ' : ''}${id ? 'Edit this change and go to its start' : 'Edit the initial settings'}"><span class="dot${now === id ? ' now' : ''}"></span><span class="st">${start}${warn ? ' <span class="warn">⚠</span>' : ''}</span><span>${MODE_SHORT[mode] || ''}</span><span class="sl">${slew}</span></button>`;
      const first = scheduleOrder(sched)[0], until = first ? showUTC(sched[first.i].start) : '';
      const today = until && cur && cur.date.toISOString().slice(0, 10) === until.slice(0, 10); // the date only when it isn't the current one
      return row('', until ? 'Initial · until ' + (today ? until.slice(11) : until.slice(0, 16)) : 'Initial', o.mode, '', '', until ? 'Flies before the first change, until ' + until : '') + scheduleOrder(sched).map(({ i }) => { const c = sched[i]; return row(c.id, esc(showUTC(c.start)), c.mode, c.slew ? c.slew + ' s' : 'jump', noteText(notes[c.id])); }).join('');
    }, 'sched'));
  const kids = [list,
    h('div', { class: 'status' }, liveText(() => { const cur = ctx.cur(); if (!cur) return ''; const s = cur.seg; const m = MODE_SHORT[cur.g.mode];
      return s && s.slew !== null ? `<span class="chip warn">Slewing into ${m} · ${(100 * s.slew).toFixed(0)} %</span>` : `<span class="chip ok">Now: ${m}${s ? '' : ' (initial)'}</span>`; })),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', title: 'A change at the current time (or when the slew under way ends), starting from the attitude flown now', onclick: () => {
        const cur = ctx.cur(), c = addChange(o, cur ? cur.g : o, S.rot.q);
        if (!c) { toast(`The schedule holds up to ${MAX_CHANGES} changes, within ${DATE_MIN.slice(0, 4)} to ${DATE_MAX.slice(0, 4)}`); return; }
        if (cur && cur.seg && cur.seg.slew !== null) toast('Added when the slew under way ends, at ' + showUTC(c.start));
        selChange = c.id; save(); ctx.renderRail(); } }, '+ Change now'),
      sel ? confirmButton('Delete change', 'Click again to delete', () => { deleteChange(o, sel.id); selChange = null; save(); ctx.renderRail(); }) : null)];
  if (sel) {
    const start = dateInput('chStart'), slew = h('input', { type: 'number', id: 'chSlew', min: 0, max: 3600, step: 1 });
    slew.addEventListener('change', () => { const x = +slew.value; if (slew.value !== '' && Number.isFinite(x)) { sel.slew = Math.max(0, Math.min(3600, Math.round(x))); save(); } slew.value = sel.slew; syncAll(); });
    onSync(() => { if (document.activeElement !== slew) slew.value = sel.slew; });
    // a typed start applies on Enter or on leaving the field, not while the date is half typed (change fires per part)
    const pending = h('span', { class: 'lbl', hidden: true }, 'Enter to apply · Esc to undo');
    const shown = () => { start.value = sel.start; pending.hidden = true; };
    const commit = () => { if (pending.hidden) return; pending.hidden = true; if (setChangeStart(o, sel.id, start.value)) save(); else { refused(); start.value = sel.start; } syncAll(); };
    start.addEventListener('input', () => { pending.hidden = start.value === sel.start; });
    start.addEventListener('change', () => { pending.hidden = start.value === sel.start; });
    start.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); shown(); } });
    start.addEventListener('blur', commit);
    onSync(() => { if (document.activeElement !== start) shown(); });
    kids.push(h('div', { class: 'row two' }, h('label', { for: 'chStart' }, 'Starts (UTC)'), start),
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, pending, h('span', { class: 'lbl', style: 'margin-left:auto' }, liveText(() => { const d = parseEpoch(pending.hidden ? sel.start : start.value); return d ? tPlus((d.getTime() - epochDate(o).getTime()) / 1000) + ' from the epoch' : ''; }))),
      h('div', { class: 'row two' }, h('label', { for: 'chSlew', title: 'From the attitude before it, 0 to 3600 s (0: a jump)' }, 'Slew (s)'), slew),
      h('div', { class: 'status' }, liveText(() => {
        const tr = changeTurn(S, sel.id), n = noteText(scheduleNotes(o)[sel.id]); if (!tr) return '';
        if (tr.overridden) return `<span class="chip warn">${esc(n)}</span>`;
        const turn = tr.rate === null ? `Jumps ${tr.angle.toFixed(1)}°` : `Turns ${tr.angle.toFixed(1)}° in ${sel.slew} s · ${tr.rate.toFixed(2)}°/s on average`;
        return `<span class="chip dim" title="At its start, from the attitude before it. Kinematics only: real wheels may not turn this fast.">${turn}</span>${n ? ` <span class="chip warn">${esc(n)}</span>` : ''}`;
      })));
  }
  kids.push(tip('Each change slews from the attitude before it to its own over the slew time; both are worked out at every moment, so scrubbing works. Kinematics only: no wheels or torque limits. Times are UTC, so they stay put when the epoch moves. Click a row to edit it in <b>Attitude guidance</b>; a typed start applies on Enter.'));
  return card('Mode schedule', sched.length ? sched.length + (sched.length === 1 ? ' change' : ' changes') : 'none', ...kids);
}

/* ---------------- Time slider: a window that follows the current time ---------------- */
let scrubW0 = NaN, scrubSpanW = NaN; // the window and the span it was made for, kept here so that a rail rebuild doesn't move it
const hold = scrubHold(); // shared with the Play button, which cancels a pending resume

function timeScrubber(o) {
  const keys = 'Arrow keys: 1 min (with Shift: 1 s). Page Up / Down: a tenth of the span.';
  // step any: the ends of a page are exact (an orbit is not whole seconds)
  const r = h('input', { type: 'range', id: 'time-r', step: 'any', 'aria-label': 'Time, within the span shown', title: keys });
  const n = h('input', { type: 'number', id: 'time-n', step: 1, 'aria-label': 'Seconds from the epoch', title: 'Seconds from the epoch', style: 'width:120px;flex:none' });
  let span = scrubSpan(o); // while held, the window stays still under the pointer
  const release = () => { scrubW0 = scrubEnd(hold, o, scrubW0, span); save(); syncAll(); };
  r.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || hold.held) return; // right-click, another finger, a press during a hold
    scrubPress(hold, o); syncAll();
    const up = () => { release(); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up); // on the window: the pointer may end anywhere
  });
  r.addEventListener('input', () => { hold.moved = true; o.t = clampTime(o, +r.value); save(); syncAll(); });
  r.addEventListener('change', release);
  r.addEventListener('keydown', e => {
    const d = scrubKey(e.key, e.shiftKey, span); if (d === null) return;
    e.preventDefault(); if (hold.held) return; // the thumb follows the pointer while held
    o.t = clampTime(o, o.t + d); save(); syncAll(); // past an end the window follows (sync)
  });
  n.addEventListener('change', () => { const x = +n.value; if (n.value !== '' && Number.isFinite(x)) { o.t = clampTime(o, x); save(); } n.value = String(Math.trunc(o.t) || 0); syncAll(); });
  onSync(() => {
    if (!hold.held) {
      span = scrubSpan(o); if (span !== scrubSpanW) { scrubSpanW = span; scrubW0 = NaN; } // a new span (or orbit period): back on its pages
      scrubW0 = scrubWindowAt(o, scrubW0, span); r.min = scrubW0; r.max = scrubW0 + span; r.value = o.t;
    }
    if (document.activeElement !== n) n.value = String(Math.trunc(o.t) || 0);
  });
  const spanSeg = seg(SCRUB_SPANS, () => o.scrub || 'orbit', v => { o.scrub = v; save(); }); // the sync puts the window on the page of t
  spanSeg.title = 'How much time the slider shows';
  return h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, r,
    h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, spanSeg, h('span', { style: 'flex:1' }), n, h('span', { class: 'lbl' }, 's')));
}

/* ---------------- Scenario card: library, and which spacecraft flies ---------------- */
function scenarioCard(ctx) {
  const items = S.scenarios.items, switched = () => { S.layout.sel = null; scChanged(); ctx.renderRail(); syncAll(); };
  /** Default orbit fields for a new scenario, or for what an imported one lacks. */
  const defaults = () => newScenarioOrbit(defaultState().orbit);
  const pick = selectRow({ id: 'scenPick', label: 'Scenario', options: items.map(i => [i.id, i.name]), get: () => S.scenarios.active, set: id => { if (selectScenario(S, id)) switched(); } });
  const nameIn = h('input', { type: 'text', id: 'scenName', value: activeScenario(S).name, maxlength: 32, 'aria-label': 'Scenario name' });
  // no rail rebuild here: a click on New or Duplicate that ended the typing must still land
  nameIn.addEventListener('change', () => {
    if (renameScenario(S, S.scenarios.active, nameIn.value)) { save(); pick.querySelector(`option[value="${S.scenarios.active}"]`).textContent = activeScenario(S).name; }
    else { nameIn.value = activeScenario(S).name; toast('Enter a name, different from the other scenarios'); }
  });
  const del = confirmButton('Delete', 'Click again to delete', () => { if (deleteScenario(S, S.scenarios.active)) switched(); });
  del.disabled = items.length < 2; if (del.disabled) del.title = 'The last scenario cannot be deleted';
  const importDlg = () => {
    const ta = h('textarea', { style: 'width:100%;min-height:220px', placeholder: 'Paste a scenario JSON copied from AttTool' }), err = h('p', { class: 'tip', style: 'color:var(--bad)' });
    const doImport = () => {
      let res; try { res = importScenario(S, JSON.parse(ta.value), defaults()); } catch (e) { err.textContent = 'Could not import: ' + e.message; return; }
      closeModal(); switched(); toast(res.missing ? `Scenario added. No spacecraft named "${res.missing}" here, so it flies ${activeItem(S).name}` : 'Scenario added');
    };
    showModal(h('div', null, h('h2', null, 'Import scenario'), ta, err, h('div', { class: 'btns', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: doImport }, 'Add scenario'))));
  };
  return card('Scenario', items.length + ' in the library', pick,
    h('div', { class: 'row two' }, h('label', { for: 'scenName' }, 'Name'), nameIn),
    selectRow({ id: 'orbScPick', label: 'Flying', options: S.fleet.items.map(i => [i.id, i.name]), get: () => S.fleet.active, set: id => { if (selectSpacecraft(S, id)) switched(); } }),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => { addScenario(S, defaults(), 'New scenario'); switched(); } }, 'New'),
      h('button', { class: 'btn', onclick: () => { duplicateScenario(S); switched(); } }, 'Duplicate'), del,
      h('button', { class: 'btn', onclick: () => copyText(JSON.stringify(exportScenario(S), null, 1), 'Scenario JSON') }, 'Copy JSON'),
      h('button', { class: 'btn', onclick: importDlg }, 'Import…')),
    tip('A scenario keeps the orbit, its epoch, the current time, guidance and target, and which spacecraft flies it. Display options are shared. <b>Copy JSON</b> holds the scenario and the name of its spacecraft; copy the spacecraft itself in <b>Spacecraft Layout</b>.'));
}

/* ---------------- Orbit card: elements / r,v / TLE ---------------- */
const ISS_TLE = 'ISS (ZARYA)\n1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
const NUMS = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function orbitCard(ctx, o, sl) {
  const changed = () => { save(); syncAll(); };
  const status = () => h('div', { class: 'status' }, liveText(() => { const e = definitionError(o); return e ? `<span class="chip bad">${e.replace(/</g, '&lt;')}</span>` : ''; }));
  const derived = () => h('div', { class: 'kv' },
    h('dt', null, 'Perigee · apogee alt'), h('dd', null, liveText(() => { const E = orbitElements(o); return (E.a * (1 - E.e) - ENV.RE).toFixed(1) + ' · ' + (E.a * (1 + E.e) - ENV.RE).toFixed(1) + ' km'; })),
    h('dt', null, 'i · Ω · ω · ν₀'), h('dd', null, liveText(() => { const E = orbitElements(o); return [E.i, E.raan, E.argp, E.nu0].map(x => deg(x).toFixed(3) + '°').join(' · '); })));
  const common = [
    h('div', { class: 'kv' },
      h('dt', null, 'a · e'), h('dd', null, liveText(() => { const E = orbitElements(o); return E.a.toFixed(1) + ' km · ' + E.e.toFixed(5); })),
      h('dt', null, 'Period'), h('dd', null, liveText(() => (ENV.propagate(orbitElements(o), 0, false).period / 60).toFixed(2) + ' min')),
      h('dt', null, 'LTAN (at epoch)'), h('dd', null, liveText(() => hhmm(ltanOf(o)))),
      h('dt', null, 'SSO inclination for this a'), h('dd', null, liveText(() => { const E = orbitElements(o); return deg(ENV.ssoInc(E.a, E.e)).toFixed(2) + '°'; }))),
    check('j2', 'J2 secular drift of Ω and ω (makes SSO work)', () => o.j2, v => { o.j2 = v; save(); }),
  ];
  const defSeg = seg([['elements', 'Elements'], ['rv', 'r, v (J2000)'], ['tle', 'TLE']], () => o.def, v => { switchDefinition(o, v); save(); ctx.renderRail(); });
  let body = [];
  if (o.def === 'elements') body = [
    selectRow({ id: 'preset', label: 'Preset', options: [...Object.entries(PRESETS).map(([k, p]) => [k, p.label]), ['custom', 'Custom']], get: () => o.preset, set: v => { if (v !== 'custom') ctx.applyPreset(v); else o.preset = 'custom'; } }),
    sl('hp', 'Perigee alt km', 200, 40000, 1, 'hp', 0), sl('ha', 'Apogee alt km', 200, 40000, 1, 'ha', 0),
    sl('inc', 'Inclination i°', 0, 180, .01, 'i', 2), sl('raan', 'RAAN Ω°', 0, 360, .1, 'raan', 1), sl('argp', 'Arg. perigee ω°', 0, 360, .5, 'argp', 1), sl('nu0', 'True anomaly ν₀°', 0, 360, .5, 'nu0', 1)];
  if (o.def === 'rv') {
    const cell = (key, k, lab, step, dec) => numCell(`${key}${k}`, lab, () => o[key][k], x => { o[key][k] = x; changed(); }, step, dec);
    const paste = h('input', { type: 'text', placeholder: 'Paste 6 numbers: r0 = [x y z]; v0 = [vx vy vz]', 'aria-label': 'Paste r and v' });
    const applyPaste = () => { const n = (paste.value.replace(/r0|v0|r|v/gi, ' ').match(NUMS) || []).map(Number); if (n.length !== 6) { paste.setCustomValidity('Need exactly 6 numbers'); paste.reportValidity(); return; } paste.setCustomValidity(''); o.r = n.slice(0, 3); o.v = n.slice(3); paste.value = ''; changed(); };
    paste.addEventListener('keydown', e => { if (e.key === 'Enter') applyPaste(); });
    body = [
      h('div', { class: 'lbl' }, 'Position r at the epoch, J2000 / GCRF (km)'),
      h('div', { class: 'grid3' }, [0, 1, 2].map(k => cell('r', k, 'r' + 'xyz'[k], 1, 3))),
      h('div', { class: 'lbl' }, 'Velocity v at the epoch (km/s)'),
      h('div', { class: 'grid3' }, [0, 1, 2].map(k => cell('v', k, 'v' + 'xyz'[k], .001, 6))),
      h('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:6px' }, paste, h('button', { class: 'btn', onclick: applyPaste }, 'Use')),
      status(), derived(),
      tip('Converted exactly to osculating elements at the epoch. With J2 on, these feed a mean-element secular model, so long runs drift slightly from a full propagator. The tool\'s ECI ignores precession (≈ J2000).')];
  }
  if (o.def === 'tle') {
    const ta = h('textarea', { id: 'tle', rows: 3, spellcheck: 'false', class: 'dcm', placeholder: 'NAME (optional)\n1 25544U 98067A   …\n2 25544  51.6416 …' });
    ta.value = o.tle || '';
    let tm = 0; ta.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { if (!ta.isConnected) return; o.tle = ta.value.trim(); o.t = 0; changed(); }, 300); }); // gone: the scenario was switched
    body = [ta,
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { ta.value = ISS_TLE; o.tle = ISS_TLE; o.t = 0; changed(); } }, 'Example: ISS (2008)')),
      status(),
      liveText(() => { const t = tleOf(o); if (!t) return ''; return `<div class="kv"><dt>Satellite</dt><dd>${(t.name || '—').replace(/</g, '&lt;')} · ${t.satnum}</dd><dt>Epoch</dt><dd>${t.epoch.toISOString().replace('T', ' ').slice(0, 23)}</dd><dt>Mean motion</dt><dd>${t.n.toFixed(8)} rev/day</dd></div>`
        + t.warnings.map(w => `<p class="tip" style="color:var(--warn)">${w}</p>`).join(''); }),
      derived(),
      tip('<b>Approximation:</b> the TLE\'s mean elements are flown with Keplerian + J2 secular drift, not SGP4. Good near the TLE epoch; drifts by kilometres per day (no drag). The epoch comes from the TLE.')];
  }
  const epochInput = dateInput('epoch'); epochInput.disabled = o.def === 'tle';
  epochInput.title = o.def === 'tle' ? 'Set by the TLE' : 'The date this orbit definition holds at. Moving it re-dates the orbit, keeping the current time.';
  epochInput.addEventListener('change', () => { if (setEpoch(o, epochInput.value)) { save(); syncAll(); } else refused(); });
  epochInput.addEventListener('blur', () => syncAll());
  onSync(() => { if (document.activeElement !== epochInput) epochInput.value = o.def === 'tle' ? formatEpoch(epochDate(o)) : o.epoch; });
  const nowState = () => { const c = ctx.cur(); return c ? { r: c.st.r, v: c.st.v, d: c.date } : null; };
  return card('Orbit', 'Keplerian + J2',
    h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'lbl' }, 'Defined by'), defSeg),
    h('div', { class: 'row two' }, h('label', { for: 'epoch' }, 'Epoch (UTC)'), epochInput),
    ...body, ...common,
    h('div', { class: 'lbl' }, 'State now (ECI ≈ J2000)'),
    h('div', { class: 'kv' },
      h('dt', null, 'r (km)'), h('dd', null, liveText(() => { const n = nowState(); return n ? '[' + n.r.map(x => fmt(x, 3)).join(', ') + ']' : ''; })),
      h('dt', null, 'v (km/s)'), h('dd', null, liveText(() => { const n = nowState(); return n ? '[' + n.v.map(x => fmt(x, 6)).join(', ') + ']' : ''; }))),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', title: 'Moves the epoch to the current time and defines the orbit by this r, v', onclick: () => { restartFromState(o, o.t); save(); syncAll(); ctx.renderRail(); } }, 'Make this the initial state'),
      h('button', { class: 'btn', onclick: () => { const n = nowState(); if (n) copyText(`% J2000/GCRF state at ${n.d.toISOString()}\nr0 = [${n.r.map(x => +x.toFixed(6)).join(' ')}];  % km\nv0 = [${n.v.map(x => +x.toFixed(9)).join(' ')}];  % km/s`, 'State vector'); } }, 'Copy r, v (MATLAB)')));
}
