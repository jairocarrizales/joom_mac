'use strict';

const cam = document.getElementById('cam');
const bubble = document.querySelector('.bubble');
const handle = document.getElementById('resize');

let currentCameraId = null;
let stream = null;

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
  bubble.classList.toggle('vertical', vert);
  bubble.classList.toggle('wide', wide);
  bubble.classList.toggle('card', card);
  bubble.classList.toggle('pebble', pebble);
  bubble.classList.toggle('feather', feather);
  bubble.classList.toggle('shield', shield);
  bubble.classList.toggle('circle', !vert && !wide && !card && !pebble && !feather && !shield);
  bubble.classList.toggle('noborder', border === false);
  // Zoom de cámara: escala uniforme (espejo + zoom) recortada por la burbuja.
  cam.style.transform = `scaleX(-1) scale(${zoom || 1})`;
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
