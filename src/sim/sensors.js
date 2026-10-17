/** Sensor / actuator geometry checks for one component at one instant. */
import * as AM from '../core/attitude.js';
import * as ENV from '../env/index.js';
import { compAxis } from '../spacecraft/component.js';

const deg = x => x * AM.R2D;

/**
 * @param {object} c component
 * @param {object} A result of attitudeAt()
 * @returns {{sunAng, nadAng, limb, ok?, sunBlind?, earthBlind?, sees?, onGround?, cosInc?}} angles in deg
 */
export function sensorEval(c, A) {
  const bore = compAxis(c), sunB = AM.m.mulv(A.CBI, A.sun), nadB = AM.m.mulv(A.CBI, AM.v.unit(AM.v.scale(A.st.r, -1)));
  const rho = Math.asin(ENV.RE / AM.v.norm(A.st.r)); // Earth angular radius
  const sunAng = deg(AM.v.angle(bore, sunB)), nadAng = deg(AM.v.angle(bore, nadB)), limb = nadAng - deg(rho);
  const r = { sunAng, nadAng, limb };
  if (c.type === 'str') { r.sunBlind = !A.ecl && sunAng < c.sunExcl; r.earthBlind = limb < c.earthExcl; r.ok = !r.sunBlind && !r.earthBlind; }
  if (c.type === 'css') { r.sees = !A.ecl && sunAng < c.fov / 2; }
  if (c.type === 'payload' || c.type === 'ant') { r.onGround = limb < 0; }
  if (c.type === 'sa') { r.cosInc = A.ecl ? 0 : Math.max(0, Math.cos(sunAng * AM.D2R)); }
  return r;
}
