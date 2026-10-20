/** The in-app "Conventions" dialog. Keep in sync with docs/CONVENTIONS.md. */
import { h } from './dom.js';
import { showModal } from './overlay.js';

const HTML = `
<h2>Conventions used in AttTool</h2>
<p>Every number in this tool follows one consistent set of rules. Most bugs in attitude code come from mixing two of them.</p>
<h3>Frames</h3>
<ul>
<li><b>R</b> — generic reference frame in the Rotation Lab. In <i>Inertial</i> guidance it is ECI.</li>
<li><b>ECI</b> — X to the vernal equinox ♈, Z to the celestial north pole (J2000-like; precession ignored).</li>
<li><b>ECEF</b> — Earth-fixed, rotates about Z by GMST. Ground track and targets live here.</li>
<li><b>VVLH</b> — Z = −r̂ (nadir), Y = −ĥ (negative orbit normal), X = Y×Z (toward velocity). Zero offsets in VVLH = nadir pointing.</li>
<li><b>LVLH</b> — X = r̂ (radial out), Z = ĥ (orbit normal), Y = Z×X (toward velocity).</li>
<li><b>VNC</b> — X = v̂, Y = ĥ, Z = X×Y. Orbital frames follow the STK definitions (ĥ = r×v / |r×v|).</li>
<li><b>B = SCF</b> — spacecraft frame, the body frame for attitude; components are defined in it. Origin anywhere (default bus centre), axes = bus axes possibly permuted. <b>G</b> = bus geometry frame (bus centre, box edges); p<sub>S</sub> = C<sub>SG</sub>·(p<sub>G</sub> − origin).</li>
<li><b>C</b> — a component's own frame. +Z<sub>C</sub> is its boresight / spin axis / dipole axis / panel normal.</li>
</ul>
<h3>Direction cosine matrices</h3>
<p><code>C_BR</code> transforms coordinates <i>from R to B</i>: <code>v_B = C_BR · v_R</code>. Its rows are the B axes written in R. <code>C_RB = C_BRᵀ</code>. Chains read right to left: <code>C_CI = C_CB · C_BI</code>.</p>
<h3>Euler angles</h3>
<p>Sequence i-j-k (e.g. 3-2-1) means intrinsic rotations: θ₁ about axis i of R, θ₂ about the <i>new</i> j axis, θ₃ about the <i>newest</i> k axis. <code>C_BR = R_k(θ₃)·R_j(θ₂)·R_i(θ₁)</code> with frame-rotation matrices, e.g. <code>R₃(ψ) = [[c, s, 0], [−s, c, 0], [0, 0, 1]]</code>. 3-2-1 = yaw ψ, pitch θ, roll φ.</p>
<h3>Quaternions</h3>
<p><code>q = [q₀; q₁ q₂ q₃] = [cos(φ/2); ê sin(φ/2)]</code>. The attitude matrix is <code>C_BR = A(q) = (q₀² − |q_v|²)I + 2 q_v q_vᵀ − 2 q₀[q_v×]</code> (Shuster/JPL reading, same numbers as the Hamilton quaternion of the active rotation R→B). Toggle scalar-first / scalar-last in the Rotation Lab. q and −q are the same attitude.</p>
<h3>Environment models (deliberately simple)</h3>
<ul>
<li>Orbit: Keplerian two-body with optional J2 secular drift of Ω and ω. No drag, no SRP.</li>
<li>Sun: low-precision almanac formula (~0.01°). Eclipse: cylindrical shadow (no penumbra).</li>
<li>Magnetic field: tilted dipole, pole at 80.8°N 72.7°W, B₀ = 29 900 nT. Real IGRF differs by up to ~20 %.</li>
<li>Star tracker availability: blinded if the Sun is inside the Sun-exclusion angle (outside eclipse) or the Earth limb is closer than the Earth-exclusion angle. Moon ignored.</li>
</ul>
<h3>Keyboard</h3>
<p><code>1</code> <code>2</code> <code>3</code> switch workspaces · <code>Space</code> play/pause the orbit · drag = orbit camera, scroll = zoom, right-drag = pan.</p>
`;

export function showConventions() { showModal(h('div', { html: HTML })); }
