/** Control rail for the Orbit & Frames workspace. */
import * as ENV from '../../env/index.js';
import { S, save } from '../../state/store.js';
import { h, card, tip, slider, numCell, selectRow, check, seg, liveText, syncAll, onSync } from '../../ui/dom.js';
import { deg, fmt, hhmm, hms } from '../../ui/format.js';
import { TYPES } from '../../spacecraft/componentTypes.js';
import { PRESETS, orbitElements, ltanOf, epochDate, parseEpoch, formatEpoch, switchDefinition, restartFromState, definitionError, tleOf } from '../../sim/scenario.js';
import { copyText } from '../../ui/overlay.js';
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

  out.push(orbitCard(ctx, o, sl));

  const epochInput = h('input', { type: 'datetime-local', id: 'epoch', step: '1', disabled: o.def === 'tle', title: o.def === 'tle' ? 'Set by the TLE' : null });
  epochInput.addEventListener('change', () => { if (parseEpoch(epochInput.value)) { o.epoch = epochInput.value; if (o.def === 'elements' && o.preset !== 'custom' && PRESETS[o.preset].ltan !== undefined) ctx.applyPreset(o.preset); save(); } });
  onSync(() => { if (document.activeElement !== epochInput) epochInput.value = o.def === 'tle' ? formatEpoch(epochDate(o)) : o.epoch; });
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
    let tm = 0; ta.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { o.tle = ta.value.trim(); o.t = 0; changed(); }, 300); });
    body = [ta,
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { ta.value = ISS_TLE; o.tle = ISS_TLE; o.t = 0; changed(); } }, 'Example: ISS (2008)')),
      status(),
      liveText(() => { const t = tleOf(o); if (!t) return ''; return `<div class="kv"><dt>Satellite</dt><dd>${(t.name || '—').replace(/</g, '&lt;')} · ${t.satnum}</dd><dt>Epoch</dt><dd>${t.epoch.toISOString().replace('T', ' ').slice(0, 23)}</dd><dt>Mean motion</dt><dd>${t.n.toFixed(8)} rev/day</dd></div>`
        + t.warnings.map(w => `<p class="tip" style="color:var(--warn)">${w}</p>`).join(''); }),
      derived(),
      tip('<b>Approximation:</b> the TLE\'s mean elements are flown with Keplerian + J2 secular drift, not SGP4. Good near the TLE epoch; drifts by kilometres per day (no drag). The epoch comes from the TLE.')];
  }
  const nowState = () => { const c = ctx.cur(); return c ? { r: c.st.r, v: c.st.v, d: c.date } : null; };
  return card('Orbit', 'Keplerian + J2',
    h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'lbl' }, 'Defined by'), defSeg),
    ...body, ...common,
    h('div', { class: 'lbl' }, 'State now (ECI ≈ J2000)'),
    h('div', { class: 'kv' },
      h('dt', null, 'r (km)'), h('dd', null, liveText(() => { const n = nowState(); return n ? '[' + n.r.map(x => fmt(x, 3)).join(', ') + ']' : ''; })),
      h('dt', null, 'v (km/s)'), h('dd', null, liveText(() => { const n = nowState(); return n ? '[' + n.v.map(x => fmt(x, 6)).join(', ') + ']' : ''; }))),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', title: 'Moves the epoch to the current time and defines the orbit by this r, v', onclick: () => { restartFromState(o, o.t); save(); syncAll(); ctx.renderRail(); } }, 'Make this the initial state'),
      h('button', { class: 'btn', onclick: () => { const n = nowState(); if (n) copyText(`% J2000/GCRF state at ${n.d.toISOString()}\nr0 = [${n.r.map(x => +x.toFixed(6)).join(' ')}];  % km\nv0 = [${n.v.map(x => +x.toFixed(9)).join(' ')}];  % km/s`, 'State vector'); } }, 'Copy r, v (MATLAB)')));
}
