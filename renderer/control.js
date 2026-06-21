'use strict';

const $ = (id) => document.getElementById(id);

const sourceSel = $('sourceSel');
const cameraSel = $('cameraSel');
const shapeSel = $('shapeSel');
const borderChk = $('borderChk');
const micSel = $('micSel');
const sysAudioChk = $('sysAudioChk');
const qualitySel = $('qualitySel');
const modeSel = $('modeSel');
const normalOpts = $('normalOpts');
const reelOpts = $('reelOpts');
const bandPosSel = $('bandPosSel');
const zoomRange = $('zoomRange');
const zoomLbl = $('zoomLbl');
const startBtn = $('startBtn');
const statusEl = $('status');
const setupEl = $('setup');
const exportingEl = $('exporting');
const countdownEl = $('countdown');

let sources = [];

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

const SETUP_HEIGHT = 720;
// Mantener SIEMPRE el mismo alto (la ventana tiene scroll interno): así no
// "salta" encogiéndose al exportar y agrandándose al volver al panel.
function fitWindow() {
  requestAnimationFrame(() => window.loom.resizeControl(SETUP_HEIGHT));
}

// --- Inicialización ----------------------------------------------------------

async function init() {
  await window.loom.checkPermissions();
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    setStatus('Concede permisos de cámara/micrófono para continuar.', 'rec');
  }

  const savedMode = localStorage.getItem('modeSel') || 'normal';
  if (modeSel.querySelector(`option[value="${savedMode}"]`)) modeSel.value = savedMode;
  await window.loom.setMode(modeSel.value);
  applyModeVisibility(modeSel.value);
  syncReelTabVisibility(modeSel.value);
  if (modeSel.value === 'reel') pushReel();

  await loadDevices();
  applyCamera();

  await loadSources();
  setupEl.classList.remove('hidden');
  fitWindow();
}

async function loadSources() {
  try { sources = await window.loom.getSources(); }
  catch (e) { sources = []; return false; }
  sourceSel.innerHTML = '';
  sources.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.name;
    sourceSel.appendChild(opt);
  });
  sourceSel.parentElement.classList.toggle('hidden', sources.length <= 1);
  return sources.length > 0;
}

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput');
  cameraSel.innerHTML = '';
  cams.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId; opt.textContent = d.label || `Cámara ${i + 1}`;
    cameraSel.appendChild(opt);
  });
  micSel.innerHTML = '';
  mics.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId; opt.textContent = d.label || `Micrófono ${i + 1}`;
    micSel.appendChild(opt);
  });
}

// --- Cámara / forma / zoom ---------------------------------------------------

function applyCamera() {
  const shape = shapeSel.value;
  cameraSel.disabled = shape === 'none';
  borderChk.disabled = shape === 'none';
  window.loom.updateCamera({ cameraId: cameraSel.value, shape, border: borderChk.checked });
}
shapeSel.addEventListener('change', applyCamera);
cameraSel.addEventListener('change', applyCamera);
borderChk.addEventListener('change', applyCamera);

zoomRange.addEventListener('input', () => {
  zoomLbl.textContent = zoomRange.value + '%';
  window.loom.setZoom(Number(zoomRange.value) / 100);
});

// --- Teleprompter ------------------------------------------------------------
const tpBtn = $('tpBtn');
let tpOpen = false;
function setTpBtn(open) {
  tpOpen = open;
  tpBtn.classList.toggle('btn-rec', open);
  tpBtn.classList.toggle('btn-ghost', !open);
  tpBtn.title = open ? 'Cerrar teleprompter' : 'Teleprompter';
}
tpBtn.addEventListener('click', () => window.loom.teleprompterToggle(!tpOpen));
window.loom.onTpState(setTpBtn);

// --- Reel: diseño (100% cámara / Video arriba / Video abajo) -----------------

function applyModeVisibility(mode) {
  normalOpts.classList.toggle('hidden', mode !== 'normal'); // forma de cámara: solo en normal
  reelOpts.classList.toggle('hidden', mode !== 'reel');
}

function pushReel() {
  const v = bandPosSel.value; // 'full' | 'youtube-top' | 'youtube-pie'
  const isYt = v === 'youtube-top' || v === 'youtube-pie';
  $('ytField').style.display = isYt ? '' : 'none';
  window.loom.setReel({ bandPos: v }); // el contenido (video/PDF) lo gestiona main
}

bandPosSel.value = localStorage.getItem('reelBandPos') || 'full';
bandPosSel.addEventListener('change', () => {
  localStorage.setItem('reelBandPos', bandPosSel.value);
  pushReel();
  fitWindow();
});

// --- Contenido del reel: YouTube / video PC / PDF-PowerPoint / Google Slides --
// main es la fuente de verdad del contenido y refresca la vista previa solo.

const ytStatusEl = $('ytStatus');
window.loom.onYtProgress((m) => { ytStatusEl.textContent = m; });

async function loadSource(btn, fn, busyMsg) {
  if (btn) btn.disabled = true;
  ytStatusEl.textContent = busyMsg;
  let r;
  try { r = await fn(); } catch (e) { r = { ok: false, error: String(e) }; }
  if (btn) btn.disabled = false;
  if (r && r.ok) ytStatusEl.textContent = '✓ Listo para el reel';
  else if (r && r.error) ytStatusEl.textContent = '✗ ' + r.error;
  else ytStatusEl.textContent = '';
  fitWindow();
}

$('ytDownloadBtn').addEventListener('click', () => {
  const url = $('ytUrl').value.trim();
  if (!url) { ytStatusEl.textContent = 'Pega la URL de un video de YouTube.'; return; }
  loadSource($('ytDownloadBtn'), () => window.loom.ytDownload(url), 'Descargando de YouTube…');
});
$('ytUploadBtn').addEventListener('click', () => {
  loadSource($('ytUploadBtn'), () => window.loom.pickVideo(), 'Eligiendo video…');
});
$('ytPresBtn').addEventListener('click', () => {
  loadSource($('ytPresBtn'), () => window.loom.pickPresentation(), 'Eligiendo presentación…');
});
$('slidesBtn').addEventListener('click', () => {
  const url = $('slidesUrl').value.trim();
  if (!url) { ytStatusEl.textContent = 'Pega la URL de Google Slides.'; return; }
  loadSource($('slidesBtn'), () => window.loom.slidesDownload(url), 'Cargando Google Slides…');
});

// --- Modo ---------------------------------------------------------------------

modeSel.addEventListener('change', async () => {
  const mode = modeSel.value;
  localStorage.setItem('modeSel', mode);
  applyModeVisibility(mode);
  syncReelTabVisibility(mode);
  if (mode === 'reel') setActiveTab('reel');
  await window.loom.setMode(mode);
  if (mode === 'reel') pushReel();
  fitWindow();
});

// --- Cuenta regresiva --------------------------------------------------------

function countdown(n) {
  return new Promise((resolve) => {
    countdownEl.classList.remove('hidden');
    countdownEl.textContent = n;
    const tick = () => {
      n -= 1;
      if (n <= 0) { countdownEl.classList.add('hidden'); resolve(); }
      else { countdownEl.textContent = n; setTimeout(tick, 1000); }
    };
    setTimeout(tick, 1000);
  });
}

// --- Acciones ----------------------------------------------------------------

window.loom.onShortcut((action) => {
  if (action === 'record' && !setupEl.classList.contains('hidden')) startBtn.click();
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const sourceId = sourceSel.value;
  const cameraId = cameraSel.value;
  const micId = micSel.value;

  await window.loom.selectSource(sourceId);
  await countdown(3);

  const QUALITY = {
    '720': { maxW: 1280, fps: 30, vbps: 3_000_000 },
    '1080': { maxW: 1920, fps: 30, vbps: 5_000_000 },
    '1080-60': { maxW: 1920, fps: 60, vbps: 8_000_000 },
    '1440': { maxW: 2560, fps: 30, vbps: 10_000_000 },
  };
  const q = QUALITY[qualitySel.value] || QUALITY['1080'];

  await window.loom.startRecording({
    sourceId, cameraId, micId,
    systemAudio: sysAudioChk.checked,
    maxW: q.maxW, fps: q.fps, vbps: q.vbps,
  });
});

window.loom.onExportBusy(() => {
  setupEl.classList.add('hidden');
  exportingEl.classList.remove('hidden');
  setStatus('Procesando…');
  $('exportStatus').textContent = 'Convirtiendo a MP4 con ffmpeg…';
  fitWindow();
});
window.loom.onExportProgress((secs) => {
  $('exportStatus').textContent = `Convirtiendo a MP4… ${secs.toFixed(1)}s procesados`;
});
window.loom.onExportDone((result) => {
  exportingEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  startBtn.disabled = false;
  if (result.ok) { setStatus('✓ Guardado correctamente', 'ok'); window.loom.revealFile(result.filePath); }
  else { setStatus('✗ ' + result.error, 'rec'); }
  fitWindow();
});

// --- Pestañas ----------------------------------------------------------------
const tabButtons = document.querySelectorAll('.side-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
function setActiveTab(name) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  tabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  localStorage.setItem('activeTab', name);
  fitWindow();
}
function syncReelTabVisibility(mode) {
  const reelBtn = $('reelTabBtn');
  const isReel = mode === 'reel';
  reelBtn.classList.toggle('hidden', !isReel);
  if (!isReel && reelBtn.classList.contains('active')) setActiveTab('capture');
}
tabButtons.forEach((b) => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));
{
  const saved = localStorage.getItem('activeTab') || 'capture';
  const safe = (saved === 'reel' && modeSel.value !== 'reel') ? 'capture' : saved;
  setActiveTab(safe);
}
syncReelTabVisibility(modeSel.value);

init();
