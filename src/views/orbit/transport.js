/**
 * The transport strip (#86): ◀ / ▶ (backwards, #101, or forwards) and Pause, ⏮ / ⏭, the speed, ▶ Scenario and the current time, at the top of the
 * bottom dock, so they are on screen whatever the rail shows (the Time card is below the fold on most screens).
 * orbitView's hud() builds it on every rail rebuild, so its bindings are registered with the rail's.
 */
import { S, save } from '../../state/store.js';
import { h, liveText, onSync, seg, syncAll } from '../../ui/dom.js';
import { toast } from '../../ui/overlay.js';
import { tPlus } from '../../ui/format.js';
import { currentDate, scrubCancelResume, scrubHold } from '../../sim/scenario.js';
import { adjacentChange, runProgress, startRun } from '../../sim/schedule.js';

/** The time slider's hold (scrubHold), shared with the strip: Play and ▶ Scenario cancel a resume pending on release. */
export const hold = scrubHold();

/** Playback speeds (× real time). */
export const SPEEDS = [[1, '1×'], [10, '10×'], [30, '30×'], [60, '60×'], [300, '300×'], [1000, '1000×']];

/** The strip's content for orbit settings S.orbit. */
export function transportStrip() {
  const o = S.orbit;
  // ◀ and ▶ (#101): each pauses when it is the one playing, else plays its way; Space pauses and resumes the last way
  const going = dir => o.playing && (o.dir < 0 ? -1 : 1) === dir;
  const press = dir => { scrubCancelResume(hold); if (going(dir)) o.playing = false; else { o.dir = dir; o.playing = true; } save(); syncAll(); };
  const back = h('button', { class: 'btn', style: 'min-width:40px', 'aria-label': 'Play backwards', onclick: () => press(-1) });
  const play = h('button', { class: 'btn primary', style: 'min-width:84px', onclick: () => press(1) });
  onSync(() => {
    play.textContent = going(1) ? '❚❚ Pause' : '▶ Play'; play.title = going(1) ? 'Pause (Space)' : 'Play forwards (Space plays and pauses)';
    back.textContent = going(-1) ? '❚❚' : '◀'; back.title = going(-1) ? 'Pause (Space)' : 'Play backwards, at the same speed (Space then pauses and resumes backwards)';
    back.classList.toggle('on', going(-1));
  });
  const jump = dir => h('button', {
    class: 'btn', title: dir < 0 ? 'Go to the start of the previous change' : 'Go to the start of the next change', 'aria-label': dir < 0 ? 'Previous change' : 'Next change',
    onclick: () => { const t = adjacentChange(o, dir); if (t === null) { toast(dir < 0 ? 'No earlier change' : 'No later change'); return; } o.t = t; save(); syncAll(); },
  }, dir < 0 ? '⏮' : '⏭');
  const run = h('button', { class: 'btn', title: 'Play the scenario from its start to its end at the chosen speed, then pause (Loop and the end: Time card)', onclick: () => { scrubCancelResume(hold); startRun(o); save(); syncAll(); } }, '▶ Scenario');
  const progress = liveText(() => { const p = runProgress(o); return p === null ? '' : `<span class="runbar mini" title="Scenario · ${(100 * p).toFixed(0)} %"><span style="width:${(100 * p).toFixed(1)}%"></span></span>`; });
  const clock = liveText(() => `<span class="mono">${currentDate(o).toISOString().slice(0, 19).replace('T', ' ')} UTC</span> <span class="lbl">${tPlus(o.t)}</span>`, 'clock');
  return h('div', { class: 'transport', role: 'toolbar', 'aria-label': 'Playback' },
    back, play, ...((o.schedule || []).length ? [jump(-1), jump(1)] : []), seg(SPEEDS, () => o.speed, v => { o.speed = v; save(); }), run, progress,
    h('span', { class: 'sp' }), clock);
}
