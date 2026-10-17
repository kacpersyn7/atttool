/**
 * Entry point. Waits (max 2.5 s) for the web fonts — 3D labels are drawn to canvases, so the
 * fonts must be ready first — then starts the app.
 */
import { startApp } from './app.js';

const fontsReady = (document.fonts && document.fonts.load)
  ? Promise.race([
    Promise.all([document.fonts.load('600 26px "JetBrains Mono"'), document.fonts.load('500 22px "JetBrains Mono"'), document.fonts.load('500 14px "Barlow Semi Condensed"')]),
    new Promise(r => setTimeout(r, 2500)),
  ])
  : Promise.resolve();

fontsReady.catch(() => { }).then(() => {
  try { window.atttool = startApp(); } // exposed for debugging in the console
  catch (e) {
    console.error(e);
    document.getElementById('rail').innerHTML = '<p class="tip" style="padding:12px">AttTool failed to start: ' + String(e.message || e) + '</p>';
  }
});
