/**
 * Ambient background field.
 *
 * A 2D canvas, deliberately: it draws a slow volumetric particle lattice with
 * depth-of-field and parallax at a fraction of the GPU cost of a WebGL scene,
 * needs no library, and degrades to a static gradient on weak devices.
 *
 * It exists to give the interface depth — never to compete with the composer.
 * Intensity is stateful and always low: idle 0.35, typing 0.55, generating 0.9.
 */

const REDUCED = () => document.documentElement.dataset.motion === 'reduced';

let canvas, ctx, dpr = 1, raf = null;
let particles = [];
let pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
let intensity = 0.35, targetIntensity = 0.35;
let pulse = 0;
let running = false;
let visible = true;

export function initField() {
  canvas = document.getElementById('field');
  if (!canvas || REDUCED()) return;
  ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  resize();
  seed();
  window.addEventListener('resize', () => { resize(); seed(); });
  window.addEventListener('pointermove', (e) => {
    pointer.tx = e.clientX / window.innerWidth;
    pointer.ty = e.clientY / window.innerHeight;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible && running) loop();
  });

  start();
}

export function setFieldEnabled(on) {
  if (!canvas) return;
  if (on) { start(); canvas.classList.add('on'); }
  else { stop(); canvas.classList.remove('on'); }
}

export function setFieldState(next) {
  if (next === 'idle') targetIntensity = 0.35;
  else if (next === 'typing') targetIntensity = 0.55;
  else if (next === 'generating') targetIntensity = 0.9;
  else if (next === 'success') { targetIntensity = 0.6; pulse = 1; }
  else if (next === 'error') targetIntensity = 0.25;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}

/** Particle budget scales with viewport area — small screens get a lighter field. */
function seed() {
  const area = window.innerWidth * window.innerHeight;
  const count = Math.round(Math.min(150, Math.max(40, area / 16000)));
  particles = Array.from({ length: count }, () => ({
    x: Math.random(), y: Math.random(),
    z: 0.25 + Math.random() * 0.75,          // depth: drives blur, size and parallax
    vx: (Math.random() - 0.5) * 0.00016,
    vy: (Math.random() - 0.5) * 0.00016,
    r: 0.4 + Math.random() * 1.5,
  }));
}

function start() {
  if (!canvas || REDUCED()) return;
  canvas.classList.add('on');
  if (!running) { running = true; loop(); }
}

function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

function loop() {
  if (!running) return;
  if (!visible) { raf = requestAnimationFrame(loop); return; }
  draw();
  raf = requestAnimationFrame(loop);
}

function draw() {
  const w = canvas.width, h = canvas.height;
  const t = performance.now() / 1000;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f7fff';
  const { r, g, b } = hexToRgb(accent);

  intensity += (targetIntensity - intensity) * 0.045;
  pointer.x += (pointer.tx - pointer.x) * 0.035;
  pointer.y += (pointer.ty - pointer.y) * 0.035;
  pulse *= 0.972;

  ctx.clearRect(0, 0, w, h);

  // volumetric core — a single soft light source, off-centre, behind everything
  const cx = w * (0.5 + (pointer.x - 0.5) * 0.08);
  const cy = h * (0.42 + (pointer.y - 0.5) * 0.06);
  const radius = Math.max(w, h) * (0.42 + intensity * 0.1 + pulse * 0.06);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  const alpha = 0.05 + intensity * 0.07 + pulse * 0.05;
  glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  glow.addColorStop(0.45, `rgba(${r},${g},${b},${alpha * 0.28})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // particle lattice with depth-of-field and parallax
  const drift = 0.35 + intensity * 1.5;
  for (const p of particles) {
    p.x += p.vx * drift;
    p.y += p.vy * drift;
    if (p.x < -0.05) p.x = 1.05; else if (p.x > 1.05) p.x = -0.05;
    if (p.y < -0.05) p.y = 1.05; else if (p.y > 1.05) p.y = -0.05;

    const par = (p.z - 0.5) * 26;
    const px = p.x * w + (pointer.x - 0.5) * par * dpr;
    const py = p.y * h + (pointer.y - 0.5) * par * dpr;

    const breathe = 0.5 + 0.5 * Math.sin(t * 0.35 * p.z + p.x * 5);
    const a = (0.05 + p.z * 0.16) * (0.55 + intensity * 0.6) * (0.6 + breathe * 0.4);
    const size = p.r * p.z * dpr * (1 + intensity * 0.25);

    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.fill();
  }

  // faint connection lines only at high intensity (generating) — never at rest
  if (intensity > 0.62) {
    const reach = 118 * dpr;
    const strength = (intensity - 0.62) / 0.38;
    ctx.lineWidth = 1 * dpr;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], c = particles[j];
        const dx = (a.x - c.x) * w, dy = (a.y - c.y) * h;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const d = Math.sqrt(d2);
        const alphaLine = (1 - d / reach) * 0.1 * strength * Math.min(a.z, c.z);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alphaLine})`;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(c.x * w, c.y * h);
        ctx.stroke();
      }
    }
  }
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
