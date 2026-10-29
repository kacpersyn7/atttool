/** Control rail for the Orbit & Frames workspace. */
import * as ENV from '../../env/index.js';
import { S, save } from '../../state/store.js';
import { h, card, tip, slider, numCell, selectRow, check, seg, liveText, syncAll, onSync } from '../../ui/dom.js';
import { deg, hhmm, hms } from '../../ui/format.js';
import { TYPES } from '../../spacecraft/componentTypes.js';
import { PRESETS, orbitElements, ltanOf } from '../../sim/scenario.js';
import { payloadComp } from '../../sim/guidance.js';
import { sensorEval } from '../../sim/sensors.js';

/** Body-axis choices for pointing modes; optionally include component boresights / normals. */
function axisOptions(withComps = true) {
  const base = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'].map(a => [a, 'Body ' + a.replace('-', '−')]);
  if (withComps) S.sc.comps.filter(c => TYPES[c.type].cone || c.type === 'sa').forEach(c => base.push(['comp:' + c.id, c.name + (c.type === 'sa' ? ' normal' : ' boresight')]));
  return base;
}

/**
 * @param {object} ctx cur() = current attitudeAt() result, applyPreset(k), zoomSC(), setInset(bool), renderRail()
 */
export function orbitPanel(ctx) {
  const o = S.orbit, out = [];
  const sl = (id, label, min, max, step, key, dec = 1) => slider({ id, label, min, max, step, dec, get: () => o[key], set: x => { o[key] = x; o.preset = 'custom'; save(); syncAll(); } });

  out.push(card('Orbit', 'Keplerian + J2',
    selectRow({ id: 'preset', label: 'Preset', options: [...Object.entries(PRESETS).map(([k, p]) => [k, p.label]), ['custom', 'Custom']], get: () => o.preset, set: v => { if (v !== 'custom') ctx.applyPreset(v); else o.preset = 'custom'; } }),
    sl('hp', 'Perigee alt km', 200, 40000, 1, 'hp', 0), sl('ha', 'Apogee alt km', 200, 40000, 1, 'ha', 0),
    sl('inc', 'Inclination i°', 0, 180, .01, 'i', 2), sl('raan', 'RAAN Ω°', 0, 360, .1, 'raan', 1), sl('argp', 'Arg. perigee ω°', 0, 360, .5, 'argp', 1), sl('nu0', 'True anomaly ν₀°', 0, 360, .5, 'nu0', 1),
    h('div', { class: 'kv' },
      h('dt', null, 'a · e'), h('dd', null, liveText(() => { const E = orbitElements(o); return E.a.toFixed(1) + ' km · ' + E.e.toFixed(4); })),
      h('dt', null, 'Period'), h('dd', null, liveText(() => (ENV.propagate(orbitElements(o), 0, false).period / 60).toFixed(2) + ' min')),
      h('dt', null, 'LTAN (at epoch)'), h('dd', null, liveText(() => hhmm(ltanOf(o)))),
      h('dt', null, 'SSO inclination for this a'), h('dd', null, liveText(() => { const E = orbitElements(o); return deg(ENV.ssoInc(E.a, E.e)).toFixed(2) + '°'; }))),
    check('j2', 'J2 secular drift of Ω and ω (makes SSO work)', () => o.j2, v => { o.j2 = v; save(); })
  ));

  const epochInput = h('input', { type: 'datetime-local', id: 'epoch' });
  epochInput.addEventListener('change', () => { if (epochInput.value) { o.epoch = epochInput.value.slice(0, 16); if (o.preset !== 'custom' && PRESETS[o.preset].ltan !== undefined) ctx.applyPreset(o.preset); save(); } });
  onSync(() => { if (document.activeElement !== epochInput) epochInput.value = o.epoch; });
  const playBtn = h('button', { class: 'btn primary', style: 'min-width:84px', onclick: () => { o.playing = !o.playing; save(); syncAll(); } });
  onSync(() => playBtn.textContent = o.playing ? '❚❚ Pause' : '▶ Play');
  out.push(card('Time', null,
    h('div', { class: 'row two' }, h('label', { for: 'epoch' }, 'Epoch (UTC)'), epochInput),
    h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, playBtn,
      seg([[1, '1×'], [60, '60×'], [300, '300×'], [1000, '1000×']], () => o.speed, v => { o.speed = v; save(); })),
    slider({ id: 'time', label: 'Time since epoch', min: 0, max: 86400 * 3, step: 1, dec: 0, get: () => o.t, set: x => { o.t = x; save(); } }),
    h('div', { class: 'kv' }, h('dt', null, 'T+'), h('dd', null, liveText(() => hms(o.t))), h('dt', null, 'UTC'), h('dd', null, liveText(() => ctx.cur() ? ctx.cur().date.toISOString().slice(0, 19).replace('T', ' ') : '')))
  ));

  const modeCtl = [];
  const axLbl = (name, color, ax) => h('span', null, name + ' · ', h('span', { class: 'ax', style: 'color:var(--ax-' + color + ')' }, ax));
  if (o.mode === 'offsets') modeCtl.push(
    slider({ id: 'roll', label: axLbl('Roll φ', 'x', 'X″'), min: -60, max: 60, step: .5, get: () => o.roll, set: x => { o.roll = x; save(); } }),
    slider({ id: 'pitch', label: axLbl('Pitch θ', 'y', 'Y′'), min: -60, max: 60, step: .5, get: () => o.pitch, set: x => { o.pitch = x; save(); } }),
    slider({ id: 'yaw', label: axLbl('Yaw ψ', 'z', 'Z'), min: -180, max: 180, step: .5, get: () => o.yaw, set: x => { o.yaw = x; save(); } }),
    h('div', { class: 'kv' }, h('dt', null, 'Nominal attitude'), h('dd', null, liveText(() => { const a = S.sc.align; return a.mode === 'dcm' ? a.ref.toUpperCase() + ' · DCM' : `${a.ref.toUpperCase()} +X ↔ SCF ${a.x.replace('-', '−')} · +Y ↔ SCF ${a.y.replace('-', '−')}`; }))),
    tip('Zero offsets = the nominal attitude set in <b>Spacecraft Layout → Attitude reference</b>. The offsets turn the spacecraft from there by a 3-2-1 sequence about its own axes (yaw Z, pitch Y′, roll X″). With the example layout, <b>roll</b> tilts the payload cross-track (side-looking imaging), <b>pitch</b> along-track (stereo).'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => { o.roll = o.pitch = o.yaw = 0; save(); syncAll(); } }, 'Zero offsets'),
      h('button', { class: 'btn', onclick: () => { o.roll = 25; o.pitch = 0; o.yaw = 0; save(); syncAll(); } }, 'Side-look 25°'),
      h('button', { class: 'btn', onclick: () => { o.roll = 0; o.pitch = 20; save(); syncAll(); } }, 'Forward 20°')));
  if (o.mode === 'sun') modeCtl.push(
    selectRow({ id: 'sunAxis', label: 'Point at Sun', options: axisOptions(), get: () => o.sunAxis, set: v => { o.sunAxis = v; save(); } }),
    selectRow({ id: 'sunSecAxis', label: 'Secondary axis', options: axisOptions(false), get: () => o.sunSecAxis || '+X', set: v => { o.sunSecAxis = v; save(); } }),
    selectRow({ id: 'sunSec', label: '…toward', options: [['nadir', 'Nadir'], ['normal', 'Orbit normal +h'], ['antinormal', 'Orbit normal −h'], ['velocity', 'Velocity'], ['zenith', 'Zenith']], get: () => o.sunSec, set: v => { o.sunSec = v; save(); } }),
    tip('Two-vector (TRIAD) pointing: the primary axis is aligned exactly, the secondary only as close as possible. Typical safe mode: array normal on the Sun.'));
  if (o.mode === 'target') modeCtl.push(
    h('div', { class: 'grid2' }, numCell('tlat', 'Latitude °', () => o.tgtLat, x => { o.tgtLat = x; save(); }, .1, 2), numCell('tlon', 'Longitude °', () => o.tgtLon, x => { o.tgtLon = x; save(); }, .1, 2)),
    selectRow({ id: 'tgtComp', label: 'Pointing axis', options: S.sc.comps.filter(c => TYPES[c.type].cone).map(c => [c.id, c.name]), get: () => (payloadComp(S) || {}).id, set: v => { o.tgtComp = v; save(); } }),
    h('div', { class: 'status' }, liveText(() => { const cur = ctx.cur(); return !cur || !cur.flag ? '' : cur.flag.below ? `<span class="chip dim">Target below horizon · holding nadir</span>` : `<span class="chip ok">Tracking · elevation ${deg(cur.flag.elev).toFixed(1)}°</span>`; })),
    tip('Boresight → line of sight to the ground point, body +X kept toward velocity. Watch the body rate rise near closest approach.'));
  if (o.mode === 'inertial') modeCtl.push(tip('Body frame fixed in ECI using the attitude from <b>Rotation Lab</b> (reference R = ECI). Watch the Sun and Earth sweep around the spacecraft once per orbit.'));
  out.push(card('Attitude guidance', null,
    selectRow({ id: 'mode', label: 'Mode', options: [['offsets', 'Nominal attitude + offsets'], ['target', 'Ground target tracking'], ['sun', 'Sun pointing'], ['inertial', 'Inertial (from Rotation Lab)']], get: () => o.mode, set: v => { o.mode = v; save(); ctx.renderRail(); } }),
    selectRow({ id: 'refFrame', label: 'Shown orbital frame', options: Object.entries(ENV.ORBIT_FRAMES).map(([k, f]) => [k, f.label]), get: () => o.refFrame, set: v => { o.refFrame = v; save(); ctx.renderRail(); } }),
    ...modeCtl));

  out.push(card('Sensors now', 'live',
    liveText(() => {
      const cur = ctx.cur(); if (!cur) return ''; const rows = [];
      for (const c of S.sc.comps) {
        if (c.type !== 'str') continue;
        const s = sensorEval(c, cur);
        rows.push(`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span>${c.name}</span><span class="lbl" style="font-family:var(--f-mono);font-size:11.5px">☉ ${s.sunAng.toFixed(0)}° · limb ${s.limb.toFixed(0)}°</span>${s.ok ? '<span class="chip ok">Tracking</span>' : s.sunBlind ? '<span class="chip warn">Sun-blinded</span>' : '<span class="chip bad">Earth in FOV</span>'}</div>`);
      }
      const css = S.sc.comps.filter(c => c.type === 'css'); if (css.length) { const n = css.filter(c => sensorEval(c, cur).sees).length; rows.push(`<div style="display:flex;justify-content:space-between"><span>Sun sensors seeing Sun</span><span class="chip ${n ? 'ok' : 'dim'}">${n}/${css.length}</span></div>`); }
      const pc = payloadComp(S); if (pc) { const s = sensorEval(pc, cur); rows.push(`<div style="display:flex;justify-content:space-between"><span>${pc.name} off-nadir</span><span style="font-family:var(--f-mono)">${s.nadAng.toFixed(1)}°</span></div>`); }
      return `<div style="display:flex;flex-direction:column;gap:6px">${rows.join('')}</div>`;
    }),
    tip('Star tracker is blinded if the Sun is inside its exclusion angle, or the Earth limb is closer than its Earth exclusion. Edit the angles in <b>Spacecraft Layout</b>.')));

  out.push(card('Display', null,
    h('div', { class: 'checks' },
      check('s-eci', 'ECI frame', () => o.show.eci, v => { o.show.eci = v; save(); }), check('s-orb', 'Orbital frame + v', () => o.show.orbFrame, v => { o.show.orbFrame = v; save(); }),
      check('s-track', 'Ground track', () => o.show.track, v => { o.show.track = v; save(); }), check('s-sun', 'Sun vector', () => o.show.sunv, v => { o.show.sunv = v; save(); }),
      check('s-b', 'Magnetic field B', () => o.show.bv, v => { o.show.bv = v; save(); }), check('s-cones', 'Sensor FOV cones', () => o.show.cones, v => { o.show.cones = v; save(); }),
      check('s-follow', 'Camera follows S/C', () => o.show.follow, v => { o.show.follow = v; if (v) ctx.zoomSC(); save(); }),
      check('s-inset', 'Body-frame inset', () => !o.hideInset, v => { o.hideInset = !v; ctx.setInset(v); save(); })),
    slider({ id: 'scscale', label: 'S/C size (×)', min: .1, max: 4, step: .05, dec: 2, get: () => o.scale, set: x => { o.scale = x; save(); } }),
    tip('The spacecraft is drawn hugely oversized (about 130 km per metre at 1×) so you can see it from orbit distance.')));
  return out;
}
