'use strict';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let W = window.innerWidth;
let H = window.innerHeight;
let aspect = 0.84;          // ancho/alto de la zona (lo fija main según la banda)
let locked = true;          // ¿proporción fija? (false en modo área)
let rect = null;            // { x, y, w, h } en px de ventana
let drag = null;            // { mode:'move'|'nw'|'ne'|'sw'|'se', ... }
const HANDLE = 26;
let marker = false;         // modo "grabando": solo rectángulo parpadeante, sin máscara ni asas
let blinkOn = true;         // estado del parpadeo
setInterval(() => { if (marker) { blinkOn = !blinkOn; draw(); } }, 500);

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { resize(); clampRect(); draw(); });
resize();

function defaultRect() {
  if (!locked) {
    const w = W * 0.6, h = H * 0.6;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  // Rectángulo centrado lo más grande posible con el aspecto dado.
  let w = W * 0.7;
  let h = w / aspect;
  if (h > H * 0.85) { h = H * 0.85; w = h * aspect; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function clampRect() {
  if (!rect) return;
  if (locked) {
    rect.w = Math.min(rect.w, W);
    rect.h = rect.w / aspect;
    if (rect.h > H) { rect.h = H; rect.w = rect.h * aspect; }
  } else {
    rect.w = Math.max(60, Math.min(rect.w, W));
    rect.h = Math.max(60, Math.min(rect.h, H));
  }
  rect.x = Math.max(0, Math.min(rect.x, W - rect.w));
  rect.y = Math.max(0, Math.min(rect.y, H - rect.h));
}

function corners() {
  return {
    nw: { x: rect.x, y: rect.y },
    ne: { x: rect.x + rect.w, y: rect.y },
    sw: { x: rect.x, y: rect.y + rect.h },
    se: { x: rect.x + rect.w, y: rect.y + rect.h },
  };
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // Modo "grabando": sin máscara ni asas; solo un rectángulo punteado que
  // parpadea marcando la zona capturada. La ventana es click-through y
  // content-protected, así que es una guía que NO sale en el video.
  if (marker) {
    if (!rect || !blinkOn) return;
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 10]);
    ctx.strokeRect(rect.x + 2, rect.y + 2, Math.max(0, rect.w - 4), Math.max(0, rect.h - 4));
    ctx.setLineDash([]);
    return;
  }

  // Mascara oscura fuera del rectángulo
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  if (!rect) return;
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);

  // Borde
  ctx.strokeStyle = '#6c5ce7';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

  // Handles en las esquinas
  ctx.fillStyle = '#fff';
  const c = corners();
  for (const k of Object.keys(c)) {
    ctx.beginPath();
    ctx.arc(c[k].x, c[k].y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Etiqueta de ayuda centrada dentro del recuadro
  if (rect.w > 180 && rect.h > 90) {
    const txt = '✋ Arrastra para mover · esquinas para el tamaño';
    ctx.font = '600 14px -apple-system, sans-serif';
    const tw = ctx.measureText(txt).width;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.fillStyle = 'rgba(28,31,39,0.85)';
    roundRectPath(cx - tw / 2 - 12, cy - 16, tw + 24, 32, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, cy + 1);
    ctx.textAlign = 'start';
  }
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hitHandle(mx, my) {
  const c = corners();
  for (const k of Object.keys(c)) {
    if (Math.hypot(mx - c[k].x, my - c[k].y) <= HANDLE) return k;
  }
  return null;
}

function inside(mx, my) {
  return mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
}

let sendPending = null;
function report() {
  if (sendPending) return;
  sendPending = requestAnimationFrame(() => {
    sendPending = null;
    window.loom.zoneRect({ fx: rect.x / W, fy: rect.y / H, fw: rect.w / W, fh: rect.h / H });
  });
}

window.addEventListener('mousedown', (e) => {
  if (marker) return; // en modo grabando no se interactúa
  const mx = e.clientX, my = e.clientY;
  if (rect) {
    const h = hitHandle(mx, my);
    if (h) {
      const c = corners();
      const opp = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[h];
      drag = { mode: h, ax: c[opp].x, ay: c[opp].y };
      return;
    }
    if (inside(mx, my)) {
      drag = { mode: 'move', ox: mx - rect.x, oy: my - rect.y };
      return;
    }
  }
  // Dibujar uno nuevo desde aquí (esquina superior izquierda = ancla)
  rect = { x: mx, y: my, w: 1, h: locked ? 1 / aspect : 1 };
  drag = { mode: 'se', ax: mx, ay: my };
});

window.addEventListener('mousemove', (e) => {
  if (marker) return;
  // Cursor según la zona cuando no se está arrastrando
  if (!drag) {
    if (rect) {
      const h = hitHandle(e.clientX, e.clientY);
      document.body.style.cursor = h ? 'nwse-resize' : inside(e.clientX, e.clientY) ? 'move' : 'crosshair';
    }
    return;
  }
  if (!rect) return;
  const mx = e.clientX, my = e.clientY;
  if (drag.mode === 'move') {
    rect.x = mx - drag.ox;
    rect.y = my - drag.oy;
    clampRect();
  } else if (locked) {
    // Redimensionar con aspecto bloqueado desde la esquina opuesta (ancla)
    const dirx = Math.sign(mx - drag.ax) || 1;
    const diry = Math.sign(my - drag.ay) || 1;
    let w = Math.abs(mx - drag.ax);
    let h = w / aspect;
    // Limitar para no salir de la pantalla
    const maxW = dirx > 0 ? W - drag.ax : drag.ax;
    const maxH = diry > 0 ? H - drag.ay : drag.ay;
    if (w > maxW) { w = maxW; h = w / aspect; }
    if (h > maxH) { h = maxH; w = h * aspect; }
    w = Math.max(60, w); h = w / aspect;
    rect.x = dirx > 0 ? drag.ax : drag.ax - w;
    rect.y = diry > 0 ? drag.ay : drag.ay - h;
    rect.w = w; rect.h = h;
  } else {
    // Proporción libre (modo área): la esquina sigue al cursor.
    rect.x = Math.min(mx, drag.ax);
    rect.y = Math.min(my, drag.ay);
    rect.w = Math.max(60, Math.abs(mx - drag.ax));
    rect.h = Math.max(60, Math.abs(my - drag.ay));
    clampRect();
  }
  draw();
  report();
});

window.addEventListener('mouseup', () => { if (drag) { drag = null; report(); } });

// Config desde main: aspecto de la zona y/o rectángulo. aspect 0 = libre (área).
window.loom.onZoneConfig(({ aspect: a, rect: r }) => {
  if (typeof a === 'number') { locked = a > 0; if (a > 0) aspect = a; }
  if (r) {
    // Viene de la vista previa: reflejar sin reenviar (evita bucle).
    rect = { x: r.fx * W, y: r.fy * H, w: r.fw * W, h: r.fh * H };
    clampRect();
    draw();
    return;
  }
  // Cambió el aspecto (alto de banda): re-encuadrar e informar.
  if (!rect) rect = defaultRect();
  clampRect();
  draw();
  report();
});

// Entrar/salir del modo "grabando" (rectángulo parpadeante, sin interacción).
window.loom.onZoneMark(({ on, rect: r, aspect: a }) => {
  marker = !!on;
  if (typeof a === 'number' && a > 0) { locked = true; aspect = a; }
  if (r) { rect = { x: r.fx * W, y: r.fy * H, w: r.fw * W, h: r.fh * H }; }
  blinkOn = true;
  draw();
});
