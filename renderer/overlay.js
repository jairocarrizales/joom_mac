'use strict';

const cam = document.getElementById('cam');
const bubble = document.querySelector('.bubble');
const handle = document.getElementById('resize');
const cc = document.getElementById('cc');
const ccx = cc.getContext('2d');

let currentCameraId = null;
let stream = null;

// --- Vista previa de "esquina" en canvas (mismo render que la grabación) ------
let cornerOn = false, curCorner = 'corner-bl', curZoom = 1, cornerRaf = null;

function sizeCornerCanvas() {
  const r = window.devicePixelRatio || 1;
  cc.width = Math.max(2, Math.round(window.innerWidth * r));
  cc.height = Math.max(2, Math.round(window.innerHeight * r));
}

function quarterPath(W, H, corner) {
  const isLeft = corner === 'corner-bl' || corner === 'corner-tl';
  const isTop = corner === 'corner-tl' || corner === 'corner-tr';
  const cx = isLeft ? 0 : W, cy = isTop ? 0 : H;
  let a0, a1;
  if (isLeft && !isTop) { a0 = -Math.PI / 2; a1 = 0; }
  else if (!isLeft && !isTop) { a0 = Math.PI; a1 = 1.5 * Math.PI; }
  else if (isLeft && isTop) { a0 = 0; a1 = Math.PI / 2; }
  else { a0 = Math.PI / 2; a1 = Math.PI; }
  ccx.beginPath(); ccx.moveTo(cx, cy); ccx.ellipse(cx, cy, W, H, 0, a0, a1, false); ccx.closePath();
}

function drawCorner() {
  if (!cornerOn) { cornerRaf = null; return; }
  const W = cc.width, H = cc.height, vw = cam.videoWidth, vh = cam.videoHeight;
  ccx.clearRect(0, 0, W, H);
  if (vw && vh) {
    ccx.save();
    quarterPath(W, H, curCorner);
    ccx.clip();
    const isLeft = curCorner === 'corner-bl' || curCorner === 'corner-tl';
    const isTop = curCorner === 'corner-tl' || curCorner === 'corner-tr';
    const cs = Math.max(W / vw, H / vh) * (curZoom || 1) * 1.3; // factor de relleno
    const cdw = vw * cs, cdh = vh * cs;
    const ox = isLeft ? 0.42 * W : 0.58 * W;
    const oy = isTop ? 0.42 * H : 0.58 * H;
    ccx.translate(ox, oy); ccx.scale(-1, 1);
    ccx.drawImage(cam, -cdw / 2, -cdh / 2, cdw, cdh);
    ccx.restore();
  }
  cornerRaf = requestAnimationFrame(drawCorner);
}

function startCorner(corner) {
  curCorner = corner; cornerOn = true; sizeCornerCanvas();
  if (!cornerRaf) cornerRaf = requestAnimationFrame(drawCorner);
}
function stopCorner() {
  cornerOn = false;
  if (cornerRaf) { cancelAnimationFrame(cornerRaf); cornerRaf = null; }
}
window.addEventListener('resize', () => { if (cornerOn) sizeCornerCanvas(); });

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

// Configuración (forma + borde + cámara) desde el proceso principal.
window.loom.onOverlayConfig(({ cameraId, shape, border, zoom }) => {
  const vert = shape === 'vertical';
  const wide = shape === 'wide';
  const card = shape === 'card';
  const pebble = shape === 'pebble';
  const feather = shape === 'feather';
  const shield = shape === 'shield';
  const shield2 = shape === 'shield2';
  const corner = shape.indexOf('corner-') === 0;
  bubble.classList.toggle('vertical', vert);
  bubble.classList.toggle('wide', wide);
  bubble.classList.toggle('card', card);
  bubble.classList.toggle('pebble', pebble);
  bubble.classList.toggle('feather', feather);
  bubble.classList.toggle('shield', shield);
  bubble.classList.toggle('shield2', shield2);
  bubble.classList.toggle('cornermode', corner);
  bubble.classList.toggle('circle', !vert && !wide && !card && !pebble && !feather && !shield && !shield2 && !corner);
  bubble.classList.toggle('noborder', border === false);
  // Zoom de cámara: escala uniforme (espejo + zoom) recortada por la burbuja.
  cam.style.transform = `scaleX(-1) scale(${zoom || 1})`;
  curZoom = zoom || 1;
  if (corner) startCorner(shape); else stopCorner();
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
