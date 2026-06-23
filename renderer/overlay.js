'use strict';

const cam = document.getElementById('cam');
const bubble = document.querySelector('.bubble');
const handle = document.getElementById('resize');
const cc = document.getElementById('cc');
const ccx = cc.getContext('2d');

let currentCameraId = null;
let stream = null;

// Estado de forma/borde para el render en canvas (previa que iguala a la grabación).
let curShape = 'circle';
let curZoom = 1;
let curBorder = true;
let curBorderColor = '#ffffff';
let curBorderWidth = 2;
let drawRaf = null;

// Formas cuyo borde NO se puede dibujar con CSS (clip-path): se renderizan en un
// canvas con el MISMO trazo que la grabación, para que el borde de color se vea
// igual en la previa. Las demás (círculo/vertical/wide) usan borde CSS.
const CANVAS_SHAPES = new Set(['card', 'pebble', 'shield', 'shield2', 'arch', 'corner-bl', 'corner-br', 'corner-tl', 'corner-tr']);

function sizeCC() {
  const r = window.devicePixelRatio || 1;
  cc.width = Math.max(2, Math.round(window.innerWidth * r));
  cc.height = Math.max(2, Math.round(window.innerHeight * r));
}

// Trazo de la silueta por forma (misma geometría que el grabador), en px de canvas.
function traceShape(ctx, shape, x, y, w, h) {
  if (shape === 'vertical' || shape === 'wide') {
    const r = Math.min(w, h) * (shape === 'vertical' ? 0.12 : 0.10);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else if (shape === 'card') {
    const cx = x + w / 2, cy = y + h / 2, a = w / 2, b = h / 2, n = 4, N = 120, p = 2 / n;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
      const px = cx + a * Math.sign(ct) * Math.pow(Math.abs(ct), p);
      const py = cy + b * Math.sign(st) * Math.pow(Math.abs(st), p);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'pebble') {
    const P = [[0.97, 0.5], [0.7466, 0.8522], [0.3202, 0.945], [0.1196, 0.6236], [0.1016, 0.27], [0.4457, 0.1138], [0.8011, 0.1656]];
    const n = P.length;
    ctx.beginPath();
    ctx.moveTo(x + P[0][0] * w, y + P[0][1] * h);
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const c1x = x + (p1[0] + (p2[0] - p0[0]) / 6) * w, c1y = y + (p1[1] + (p2[1] - p0[1]) / 6) * h;
      const c2x = x + (p2[0] - (p3[0] - p1[0]) / 6) * w, c2y = y + (p2[1] - (p3[1] - p1[1]) / 6) * h;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x + p2[0] * w, y + p2[1] * h);
    }
    ctx.closePath();
  } else if (shape === 'shield') {
    const X = (u) => x + u * w, Y = (v) => y + v * h;
    ctx.beginPath();
    ctx.moveTo(X(0.10), Y(0.12));
    ctx.bezierCurveTo(X(0.30), Y(0.07), X(0.70), Y(0.07), X(0.90), Y(0.12));
    ctx.bezierCurveTo(X(0.95), Y(0.42), X(0.82), Y(0.80), X(0.50), Y(0.96));
    ctx.bezierCurveTo(X(0.18), Y(0.80), X(0.05), Y(0.42), X(0.10), Y(0.12));
    ctx.closePath();
  } else if (shape === 'shield2') {
    const X = (u) => x + u * w, Y = (v) => y + v * h;
    ctx.beginPath();
    ctx.moveTo(X(0.06), Y(0.16));
    ctx.bezierCurveTo(X(0.06), Y(0.07), X(0.11), Y(0.03), X(0.20), Y(0.03));
    ctx.lineTo(X(0.80), Y(0.03));
    ctx.bezierCurveTo(X(0.89), Y(0.03), X(0.94), Y(0.07), X(0.94), Y(0.16));
    ctx.lineTo(X(0.94), Y(0.46));
    ctx.bezierCurveTo(X(0.94), Y(0.74), X(0.76), Y(0.93), X(0.50), Y(0.985));
    ctx.bezierCurveTo(X(0.24), Y(0.93), X(0.06), Y(0.74), X(0.06), Y(0.46));
    ctx.closePath();
  } else if (shape === 'arch') {
    const X = (u) => x + u * w, Y = (v) => y + v * h, archY = 0.435;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    ctx.lineTo(X(0), Y(archY));
    ctx.ellipse(X(0.5), Y(archY), 0.5 * w, archY * h, 0, Math.PI, 2 * Math.PI, false);
    ctx.lineTo(X(1), Y(1));
    ctx.closePath();
  } else if (shape.indexOf('corner-') === 0) {
    const isLeft = shape === 'corner-bl' || shape === 'corner-tl';
    const isTop = shape === 'corner-tl' || shape === 'corner-tr';
    const ex = isLeft ? x : x + w, ey = isTop ? y : y + h;
    let a0, a1;
    if (isLeft && !isTop) { a0 = -Math.PI / 2; a1 = 0; }
    else if (!isLeft && !isTop) { a0 = Math.PI; a1 = 1.5 * Math.PI; }
    else if (isLeft && isTop) { a0 = 0; a1 = Math.PI / 2; }
    else { a0 = Math.PI / 2; a1 = Math.PI; }
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.ellipse(ex, ey, w, h, 0, a0, a1, false);
    ctx.closePath();
  } else { // circle
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
    ctx.closePath();
  }
}

// Render de la previa en canvas (mismo aspecto y borde que la grabación).
function drawShapeCanvas() {
  if (!CANVAS_SHAPES.has(curShape)) { drawRaf = null; return; }
  const W = cc.width, H = cc.height, vw = cam.videoWidth, vh = cam.videoHeight;
  ccx.clearRect(0, 0, W, H);
  if (vw && vh) {
    const isCorner = curShape.indexOf('corner-') === 0;
    ccx.save();
    traceShape(ccx, curShape, 0, 0, W, H);
    ccx.clip();
    if (isCorner) {
      const isLeft = curShape === 'corner-bl' || curShape === 'corner-tl';
      const isTop = curShape === 'corner-tl' || curShape === 'corner-tr';
      const k = 0.42;
      const ox = isLeft ? k * W : (1 - k) * W;
      const oy = isTop ? k * H : (1 - k) * H;
      const cs = Math.max(W / vw, H / vh) * (curZoom || 1) * 1.3;
      const cdw = vw * cs, cdh = vh * cs;
      ccx.translate(ox, oy); ccx.scale(-1, 1);
      ccx.drawImage(cam, -cdw / 2, -cdh / 2, cdw, cdh);
    } else {
      const cs = Math.max(W / vw, H / vh) * (curZoom || 1);
      const cdw = vw * cs, cdh = vh * cs;
      ccx.translate(W / 2, H / 2); ccx.scale(-1, 1);
      ccx.drawImage(cam, -cdw / 2, -cdh / 2, cdw, cdh);
    }
    ccx.restore();
    // Borde de color (mismo cálculo de grosor que la grabación).
    if (curBorder) {
      const lw = Math.max(1, Math.min(W, H) * 0.01 * curBorderWidth);
      ccx.save();
      if (isCorner) traceShape(ccx, curShape, 0, 0, W, H);
      else traceShape(ccx, curShape, lw / 2, lw / 2, W - lw, H - lw);
      ccx.lineWidth = lw;
      ccx.strokeStyle = curBorderColor;
      ccx.stroke();
      ccx.restore();
    }
  }
  drawRaf = requestAnimationFrame(drawShapeCanvas);
}

function startCanvasDraw() { sizeCC(); if (!drawRaf) drawRaf = requestAnimationFrame(drawShapeCanvas); }
function stopCanvasDraw() { if (drawRaf) { cancelAnimationFrame(drawRaf); drawRaf = null; } }
window.addEventListener('resize', () => { if (CANVAS_SHAPES.has(curShape)) sizeCC(); });

// Abrir/cambiar la webcam.
async function startCamera(id) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const res = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const constraints = {
    audio: false,
    video: id ? { deviceId: { exact: id }, ...res } : res,
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    cam.srcObject = stream;
    currentCameraId = id;
  } catch (e) {
    bubble.innerHTML =
      '<div style="color:#fff;padding:20px;text-align:center;font:13px -apple-system">No se pudo abrir la cámara</div>';
  }
}

// Configuración (forma + borde + color + grosor + cámara) desde el proceso principal.
window.loom.onOverlayConfig(({ cameraId, shape, border, borderColor, borderWidth, zoom }) => {
  curShape = shape || 'circle';
  curZoom = zoom || 1;
  curBorder = border !== false;
  if (borderColor) curBorderColor = borderColor;
  if (typeof borderWidth === 'number') curBorderWidth = borderWidth;

  const useCanvas = CANVAS_SHAPES.has(curShape);
  // Clases CSS solo para las formas con borde CSS (las de canvas no llevan su clase
  // de clip-path: el dibujo lo hace el canvas).
  bubble.classList.toggle('vertical', curShape === 'vertical');
  bubble.classList.toggle('wide', curShape === 'wide');
  bubble.classList.toggle('feather', curShape === 'feather');
  bubble.classList.toggle('circle', curShape === 'circle');
  bubble.classList.toggle('canvasmode', useCanvas);
  bubble.classList.toggle('noborder', curBorder === false);

  // Color y grosor del borde CSS (círculo/vertical/wide).
  if (curBorderColor) bubble.style.borderColor = curBorderColor;
  bubble.style.borderWidth = Math.max(1, Math.round(curBorderWidth * 1.5)) + 'px';

  // Zoom de la cámara para las formas CSS (las de canvas aplican zoom al dibujar).
  cam.style.transform = `scaleX(-1) scale(${curZoom})`;

  if (useCanvas) startCanvasDraw(); else stopCanvasDraw();
  if (cameraId !== currentCameraId) startCamera(cameraId);
});

// --- Redimensionado con el asa ----------------------------------------------

let resizing = false;
let startScreenX = 0;
let startSize = 0;
let pending = null;

handle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true;
  startScreenX = e.screenX;
  startSize = window.innerWidth;
});

window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const newSize = startSize + (e.screenX - startScreenX);
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = null;
    window.loom.resizeOverlay(newSize);
  });
});

window.addEventListener('mouseup', () => {
  resizing = false;
});
