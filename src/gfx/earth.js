/** Earth, stars and Sun-glow graphics (procedural, no image assets). */
import * as THREE from 'three';
import { LAND, WATER } from '../data/coastlines.js';

/** Equirectangular Earth texture drawn from coarse coastline polygons, with graticule. */
export function earthTexture() {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d3f63'); g.addColorStop(.5, '#16507a'); g.addColorStop(1, '#1d3f63');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const P = ([lo, la]) => [(lo + 180) / 360 * W, (90 - la) / 180 * H];
  const poly = (pts, fill) => { x.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.fillStyle = fill; x.fill(); };
  LAND.forEach(p => poly(p, '#5f7f4e'));
  // subtle relief tint by latitude
  x.globalCompositeOperation = 'source-atop';
  const lg = x.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, 'rgba(235,240,245,.85)'); lg.addColorStop(.12, 'rgba(235,240,245,0)'); lg.addColorStop(.35, 'rgba(160,140,90,.25)'); lg.addColorStop(.5, 'rgba(60,110,50,.25)'); lg.addColorStop(.65, 'rgba(160,140,90,.25)'); lg.addColorStop(.86, 'rgba(235,240,245,0)'); lg.addColorStop(.92, 'rgba(235,240,245,.9)');
  x.fillStyle = lg; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
  WATER.forEach((p, i) => { if (i !== 1) poly(p, '#17507a'); });
  // graticule
  x.strokeStyle = 'rgba(200,225,255,.16)'; x.lineWidth = 1.2;
  for (let lo = -180; lo <= 180; lo += 30) { const [a] = P([lo, 0]); x.beginPath(); x.moveTo(a, 0); x.lineTo(a, H); x.stroke(); }
  for (let la = -60; la <= 60; la += 30) { const [, b] = P([0, la]); x.beginPath(); x.moveTo(0, b); x.lineTo(W, b); x.stroke(); }
  x.strokeStyle = 'rgba(242,169,59,.55)'; x.lineWidth = 2; { const [, b] = P([0, 0]); x.beginPath(); x.moveTo(0, b); x.lineTo(W, b); x.stroke(); }
  x.strokeStyle = 'rgba(255,97,97,.5)'; { const [a] = P([0, 0]); x.beginPath(); x.moveTo(a, 0); x.lineTo(a, H); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

/** UV sphere with Z = Earth axis and u = 0 at lon −180° (matches earthTexture and ECEF). */
export function earthGeometry(R, nLat = 64, nLon = 128) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let i = 0; i <= nLat; i++) {
    const la = -Math.PI / 2 + Math.PI * i / nLat;
    for (let j = 0; j <= nLon; j++) {
      const lo = -Math.PI + 2 * Math.PI * j / nLon;
      const p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      pos.push(p[0] * R, p[1] * R, p[2] * R); nor.push(...p); uv.push(j / nLon, i / nLat);
    }
  }
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) { const a = i * (nLon + 1) + j, b = a + nLon + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

/** Fresnel-style atmosphere glow shell. */
export function atmosphere(R) {
  return new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 p = modelViewMatrix*vec4(position,1.); vP = p.xyz; gl_Position = projectionMatrix*p; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vP; void main(){ float f = pow(1.0 - abs(dot(normalize(-vP), vN)), 3.0); gl_FragColor = vec4(0.35,0.62,1.0, f*0.9); }',
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

export function starfield(n = 2500, R = 900) {
  const p = []; for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u); p.push(R * s * Math.cos(t), R * s * Math.sin(t), R * u); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb2cc, size: 1.4, sizeAttenuation: false, transparent: true, opacity: .7 }));
}

export function glowSprite(color = '#ffd27a', size = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, '#fffbe8'); g.addColorStop(.18, color); g.addColorStop(.45, 'rgba(242,169,59,.25)'); g.addColorStop(1, 'rgba(242,169,59,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); return s;
}
