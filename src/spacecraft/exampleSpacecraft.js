/** Example Earth-observation microsatellite used as the default layout. */
import { D2R } from '../core/linalg.js';
import { mkComp } from './component.js';
import { defaultFrame } from './frame.js';

export function defaultSC() {
  const b = 54.7356 * D2R, comps = []; // b: pyramid half-angle for 4 wheels (magic angle)
  comps.push(mkComp('payload', 'PL cam', [0, 0, 0.42], [0, 0, 1], [1, 0, 0]));
  comps.push(mkComp('str', 'STR-1', [0.22, 0.24, -0.56], [0.34, 0.5, -0.8], [1, 0, 0]));
  comps.push(mkComp('str', 'STR-2', [0.22, -0.24, -0.56], [0.34, -0.5, -0.8], [1, 0, 0]));
  comps.push(mkComp('mtq', 'MTQ-X', [0, 0.3, 0.15], [1, 0, 0], [0, 1, 0]));
  comps.push(mkComp('mtq', 'MTQ-Y', [0.3, 0, 0.15], [0, 1, 0], [1, 0, 0]));
  comps.push(mkComp('mtq', 'MTQ-Z', [-0.3, -0.3, 0], [0, 0, 1], [1, 0, 0]));
  [45, 135, 225, 315].forEach((p, i) => {
    const ph = p * D2R;
    comps.push(mkComp('rw', 'RW-' + (i + 1), [0.2 * Math.cos(ph), 0.2 * Math.sin(ph), -0.22],
      [Math.cos(ph) * Math.sin(b), Math.sin(ph) * Math.sin(b), Math.cos(b)], [0, 0, 1]));
  });
  comps.push(mkComp('css', 'CSS-+X', [0.4, 0, -0.2], [1, 0, 0], [0, 1, 0]));
  comps.push(mkComp('css', 'CSS--X', [-0.4, 0, -0.2], [-1, 0, 0], [0, 1, 0]));
  comps.push(mkComp('css', 'CSS-+Y', [0, 0.4, -0.35], [0, 1, 0], [1, 0, 0]));
  comps.push(mkComp('css', 'CSS--Y', [0, -0.4, -0.35], [0, -1, 0], [1, 0, 0]));
  comps.push(mkComp('css', 'CSS--Z', [-0.15, 0, -0.5], [0, 0, -1], [1, 0, 0]));
  comps.push(mkComp('mag', 'MAG', [-0.28, 0.28, -0.5], [0, 0, 1], [1, 0, 0]));
  comps.push(mkComp('gyro', 'IMU', [0, 0, -0.05], [0, 0, 1], [1, 0, 0]));
  comps.push(mkComp('gnss', 'GNSS', [-0.25, -0.25, -0.5], [0, 0, -1], [1, 0, 0]));
  comps.push(mkComp('ant', 'X-band', [0.25, -0.25, 0.5], [0, 0, 1], [1, 0, 0]));
  comps.push(mkComp('thr', 'THR', [-0.4, 0, 0.25], [-1, 0, 0], [0, 0, 1]));
  comps.push(mkComp('sa', 'SA +Y', [0, 0.98, -0.2], [0, 0, -1], [0, 1, 0]));
  comps.push(mkComp('sa', 'SA −Y', [0, -0.98, -0.2], [0, 0, -1], [0, 1, 0]));
  return { bus: { x: 0.8, y: 0.8, z: 1.0, mass: 75 }, frame: defaultFrame(), comps };
}
