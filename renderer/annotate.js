'use strict';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let tool = 'none';        // 'none' | 'rect' | 'arrow' | 'laser' | 'number'
let color = '#ff3b30';
let width = 4;            // grosor de línea (flecha/rectángulo)
let numBg = '#0a84ff';   // fondo del círculo de número
let numFont = '#ffffff'; // color del texto del número
let counter = 0;         // contador incremental de números

let shapes = [];          // { type:'rect'|'arrow'|'number', ... } persistentes
let current = null;       // figura en curso (arrastrando)
let dragging = false;
let startX = 0, startY = 0;

let laserPts = [];        // { x, y, t } estela del láser
const LASER_LIFE = 460;   // ms de vida de la estela
const LASER_MAXW = 11;    // ancho máximo del cometa (en la cabeza)

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- Dibujo de figuras -------------------------------------------------------

function drawRect(r) {
  ctx.save();
  ctx.strokeStyle = r.color;
  ctx.lineWidth = r.width;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

function drawArrow(a) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const head = Math.max(14, a.width * 3.4);
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  // Asta (termina un poco antes de la punta para que la cabeza quede limpia)
  ctx.beginPath();
  ctx.moveTo(a.x1, a.y1);
  ctx.lineTo(a.x2 - Math.cos(ang) * head * 0.55, a.y2 - Math.sin(ang) * head * 0.55);
  ctx.stroke();
  // Cabeza de la flecha
  ctx.beginPath();
  ctx.moveTo(a.x2, a.y2);
  ctx.lineTo(a.x2 - head * Math.cos(ang - Math.PI / 7), a.y2 - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(a.x2 - head * Math.cos(ang + Math.PI / 7), a.y2 - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Texto legible según el fondo: claro -> negro, oscuro -> blanco.
function textColorFor(bg) {
  const h = String(bg).replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.substr(0, 2), 16) / 255;
  const g = parseInt(h.substr(2, 2), 16) / 255;
  const b = parseInt(h.substr(4, 2), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#111' : '#fff';
}

function drawNumber(b) {
  const r = 17;
  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fillStyle = b.bg;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = textColorFor(b.bg);
  ctx.font = 'bold 19px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(b.n), b.x, b.y + 1);
  ctx.restore();
}

function drawShape(s) {
  if (s.type === 'rect') drawRect(s);
  else if (s.type === 'arrow') drawArrow(s);
  else if (s.type === 'number') drawNumber(s);
}

// --- Láser estilo cometa (un solo trazo relleno que se afina en la cola) ------

function drawLaser(now) {
  laserPts = laserPts.filter((p) => now - p.t < LASER_LIFE);
  const pts = laserPts;

  if (pts.length >= 3) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;       // normal unitaria
      const ny = dx / len;
      const hw = (LASER_MAXW / 2) * (i / (n - 1)); // 0 en la cola, máx en la cabeza
      left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
      right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.restore();
  }

  // Punto brillante en la cabeza
  if (pts.length) {
    const p = pts[pts.length - 1];
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 15);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- Confeti de celebración --------------------------------------------------

let confetti = [];
const CONFETTI_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ff2d95', '#9b59b6', '#ff9500', '#ffffff'];

function spawnConfetti() {
  const W = window.innerWidth, H = window.innerHeight;
  const cx = W / 2, cy = H * 0.55;          // estalla desde el centro
  const N = 180;
  for (let i = 0; i < N; i++) {
    // Abanico hacia arriba (±70° de la vertical) -> sube y cae por gravedad.
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.78);
    const sp = 10 + Math.random() * 16;
    confetti.push({
      x: cx + (Math.random() - 0.5) * 40,
      y: cy + (Math.random() - 0.5) * 20,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,               // negativo = hacia arriba
      g: 0.24 + Math.random() * 0.12,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.5,
      size: 7 + Math.random() * 8,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 0,
      max: 150 + Math.random() * 80,
    });
  }
}

function drawConfetti() {
  if (!confetti.length) return;
  const H = window.innerHeight;
  for (const p of confetti) {
    p.life += 1;
    p.vy += p.g;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    const a = Math.max(0, 1 - p.life / p.max);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
    ctx.restore();
  }
  confetti = confetti.filter((p) => p.life < p.max && p.y < H + 60);
}

function frame(now) {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (const s of shapes) drawShape(s);
  if (current) drawShape(current);
  if (tool === 'laser') drawLaser(now);
  drawConfetti();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.loom.onConfetti(() => spawnConfetti());

// --- Entrada del ratón -------------------------------------------------------

window.addEventListener('mousedown', (e) => {
  if (tool === 'number') {
    counter += 1;
    shapes.push({ type: 'number', x: e.clientX, y: e.clientY, n: counter, bg: numBg, font: numFont });
    return;
  }
  if (tool !== 'rect' && tool !== 'arrow') return;
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  current = tool === 'rect'
    ? { type: 'rect', x: startX, y: startY, w: 0, h: 0, color, width }
    : { type: 'arrow', x1: startX, y1: startY, x2: startX, y2: startY, color, width };
});

window.addEventListener('mousemove', (e) => {
  if (tool === 'laser') {
    pushLaser(e.clientX, e.clientY);
  } else if (dragging && current) {
    if (current.type === 'rect') {
      current.w = e.clientX - startX;
      current.h = e.clientY - startY;
    } else {
      current.x2 = e.clientX;
      current.y2 = e.clientY;
    }
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging || !current) { dragging = false; return; }
  if (current.type === 'rect') {
    let { x, y, w, h } = current;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (w > 4 && h > 4) shapes.push({ ...current, x, y, w, h });
  } else {
    const d = Math.hypot(current.x2 - current.x1, current.y2 - current.y1);
    if (d > 8) shapes.push(current);
  }
  current = null;
  dragging = false;
});

// Interpolar puntos para una estela densa y uniforme aunque muevas rápido.
function pushLaser(x, y) {
  const now = performance.now();
  const last = laserPts[laserPts.length - 1];
  const step = 6;
  if (last) {
    const d = Math.hypot(x - last.x, y - last.y);
    if (d > step) {
      const steps = Math.min(10, Math.ceil(d / step));
      for (let i = 1; i <= steps; i++) {
        laserPts.push({ x: last.x + (x - last.x) * (i / steps), y: last.y + (y - last.y) * (i / steps), t: now });
      }
    } else {
      laserPts.push({ x, y, t: now });
    }
  } else {
    laserPts.push({ x, y, t: now });
  }
  if (laserPts.length > 140) laserPts.splice(0, laserPts.length - 140);
}

// --- Configuración desde el proceso principal --------------------------------

window.loom.onAnnotConfig(({ tool: t, color: c, width: w, numBg: nb, numFont: nf }) => {
  tool = t;
  color = c;
  if (typeof w === 'number') width = w;
  if (nb) numBg = nb;
  if (nf) numFont = nf;
  document.body.classList.toggle('rect', t === 'rect' || t === 'arrow' || t === 'number');
  if (t !== 'laser') laserPts = [];
});

window.loom.onAnnotClear(() => {
  shapes = [];
  current = null;
  counter = 0;
});
