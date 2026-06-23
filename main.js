'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  screen,
  systemPreferences,
  dialog,
  shell,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { buildAss } = require('./subs-ass'); // generador de subtítulos .ass (20+ estilos)

// ffmpeg empaquetado (ffmpeg-static trae el binario por plataforma); si no, el del PATH.
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
} catch (_) {
  ffmpegPath = null;
}
// En la app empaquetada, ffmpeg-static queda fuera del asar (asarUnpack).
if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
if (!ffmpegPath || !fs.existsSync(ffmpegPath)) ffmpegPath = 'ffmpeg';

// yt-dlp: binario empaquetado en bin/ si existe; si no, el del PATH (lo instala el
// usuario con `brew install yt-dlp`). Se usa para el modo reel + YouTube.
//
// En macOS las apps GUI NO heredan el PATH del shell (no traen /opt/homebrew/bin
// ni /usr/local/bin), así que resolvemos la ruta absoluta a mano.
let ytDlpPath = 'yt-dlp';
{
  const isWin = process.platform === 'win32';
  const bundled = path
    .join(__dirname, 'bin', isWin ? 'yt-dlp.exe' : 'yt-dlp')
    .replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(bundled)) {
    ytDlpPath = bundled;
  } else if (isWin) {
    // Node en Windows no aplica PATHEXT al hacer spawn de un comando sin extensión,
    // así que resolvemos la ruta absoluta de yt-dlp.exe del PATH.
    try {
      const out = require('child_process').execSync('where yt-dlp', { encoding: 'utf8' });
      const exe = out.split(/\r?\n/).map((l) => l.trim()).find((l) => /\.exe$/i.test(l));
      if (exe) ytDlpPath = exe;
    } catch (_) { /* no instalado; la descarga avisará */ }
  } else {
    // macOS / Linux: probamos las rutas típicas de Homebrew / pipx / sistema.
    const home = os.homedir();
    const candidates = [
      '/opt/homebrew/bin/yt-dlp',                  // Homebrew Apple Silicon
      '/usr/local/bin/yt-dlp',                     // Homebrew Intel
      '/usr/bin/yt-dlp',
      path.join(home, '.local', 'bin', 'yt-dlp'),  // pipx / pip --user
      path.join(home, 'bin', 'yt-dlp'),
    ];
    const found = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
    if (found) {
      ytDlpPath = found;
    } else {
      // Último intento: `command -v` con un PATH ampliado por si la app lo heredó.
      try {
        const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` };
        const out = require('child_process').execSync('command -v yt-dlp', { encoding: 'utf8', env, shell: '/bin/sh' });
        const p = out.trim().split(/\r?\n/)[0];
        if (p) ytDlpPath = p;
      } catch (_) { /* no instalado; la descarga avisará */ }
    }
  }
}

// --- Estado global -----------------------------------------------------------

let controlWindow = null;   // Panel de control (UI principal)
let overlayWindow = null;   // Burbuja flotante de la webcam
let recorderWindow = null;  // Ventana oculta que compone y graba
let annotateWindow = null;  // Capa de anotaciones a pantalla completa
let recbarWindow = null;    // Barra unificada de grabación (controles + anotaciones)
let teleprompterWindow = null; // Teleprompter (guion desplazable, flotante)

let annotTool = 'none';     // 'none' | 'rect' | 'arrow' | 'laser' | 'number'
let annotColor = '#ff3b30';
let annotWidth = 4;         // grosor de línea (flecha/rectángulo)
let annotNumBg = '#0a84ff'; // fondo de los números (círculo)
const annotNumFont = '#ffffff'; // texto de los números (siempre blanco)
let annotationsOpen = false;
let isRecording = false;

let selectedSource = null;  // Fuente de pantalla elegida por el usuario (desktopCapturer)
let tempFilePath = null;    // Archivo temporal mientras se graba
let writeStream = null;     // Stream de escritura del temporal
let recIsMp4 = false;       // ¿El grabador ya produjo MP4 (H.264)?
let lastSavedPath = null;   // último MP4 guardado (para subtítulos rápidos)

let cameraId = '';          // Cámara seleccionada
let cameraShape = 'circle'; // 'circle' | 'vertical' | 'wide' | 'none'
let cameraBorder = true;    // ¿borde blanco alrededor de la cámara?
let webcamZoom = 1;         // zoom de la webcam (recorte central uniforme)
let systemAudio = false;    // ¿capturar también el audio del sistema?

// Modo reel vertical (9:16)
let recMode = 'normal';     // 'normal' | 'reel' | 'podcast'
let bandPos = 'full';       // 'full' (100% cámara) | 'youtube-top' | 'youtube-pie'
let bandHeightFrac = 0.30;  // alto de la banda (máx 30% para que la zona quede siempre vertical)
let cropRect = { fx: 0.15, fy: 0.1, fw: 0.7, fh: 0.8 }; // zona de pantalla (reel)
let reelHeadline = { text: '', text2: '', fg: '#ffffff', bg: '#000000', animate: false }; // banner central del reel
let reelHeadlineOffset = 0; // 0..0.60 distancia del banner a la cámara (overlay sobre la zona de pantalla)
let reelHeadlinePos = 'camera'; // 'camera' | 'top' | 'bottom' (título/pie del video completo)
let bubbleSizeFrac = 0;     // 0 = auto (tamaño on-screen), >0 = ancho como % del canvas (reel+bubble)
let bubbleLocked = false;   // si true: la burbuja queda fija en el canvas y no se mueve aunque el usuario arrastre la zona/pantalla
let bubbleLockedRect = null; // {fx, fy, fw, fh} en fracciones del canvas, capturadas al bloquear
let regionWindow = null;    // selector de zona
let reelYtPath = '';        // ruta local del contenido del reel (video o PDF)
let reelMediaKind = 'video'; // 'video' | 'pdf' (presentación/diapositivas)
let ytPlaying = false;      // ¿el video está reproduciéndose (durante la grabación)?

// Aspecto (ancho/alto) de la zona/área de pantalla en modo reel.
function zoneAspect() {
  const z = 1920 * (1 - bandHeightFrac);
  return z > 1 ? 1080 / z : 1;
}
const isFullCam = () => bandHeightFrac >= 0.98; // cámara ocupa todo (sin pantalla)

// Relación alto/ancho de la burbuja según la forma.
function aspectFor(shape) {
  // h/w → vertical 9:16 (1.778), círculo 1:1, wide 16:9 (0.5625)
  if (shape === 'vertical') return 16 / 9;
  if (shape === 'wide') return 9 / 16;
  return 1;
}

function defaultWidthFor(shape) {
  if (shape === 'vertical') return 200;
  if (shape === 'wide') return 320;
  return 220;
}

// --- Creación de ventanas ----------------------------------------------------

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 780,
    height: 720,
    // Alto fijo: el contenido de las pestañas grandes scrollea dentro de .main
    // en vez de hacer saltar la ventana al cambiar entre pestañas. resize-control
    // solo se invoca para estados compactos (grabando, exportando).
    useContentSize: true,
    resizable: false,
    fullscreenable: false,
    title: 'Joom',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'control.html'));
  // Nuestra propia UI nunca debe aparecer en la grabación.
  controlWindow.setContentProtection(true);

  controlWindow.on('closed', () => {
    controlWindow = null;
    // Cerrar TODAS las ventanas auxiliares al cerrar el panel.
    if (overlayWindow) overlayWindow.close();
    if (recorderWindow) recorderWindow.close();
    if (annotateWindow) annotateWindow.close();
    if (recbarWindow) recbarWindow.close();
    if (teleprompterWindow) teleprompterWindow.close();
    if (regionWindow) regionWindow.close();
    app.quit();
  });
}

function createOverlayWindow(initRect = null) {
  if (overlayWindow) return;
  const display = screen.getPrimaryDisplay();
  const width = (initRect && initRect.width) || defaultWidthFor(cameraShape);
  const height = (initRect && initRect.height) || Math.round(width * aspectFor(cameraShape));
  const initX = (initRect && initRect.x !== undefined) ? initRect.x : (display.workArea.x + 40);
  const initY = (initRect && initRect.y !== undefined) ? initRect.y : (display.workArea.y + display.workArea.height - height - 40);
  overlayWindow = new BrowserWindow({
    width,
    height,
    x: initX,
    y: initY,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    minWidth: 80,
    minHeight: 80,
    maxWidth: 600,
    maxHeight: 700,
    fullscreenable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // CLAVE: excluye la burbuja de la captura para no grabarla dos veces
  // (la flotante nativa + la compuesta en el canvas).
  overlayWindow.setContentProtection(true);

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  // Enviar la configuración (cámara + forma + borde) cuando la ventana esté lista.
  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow.webContents.send('overlay-config', { cameraId, shape: cameraShape, border: cameraBorder, zoom: webcamZoom });
    sendWebcamRect();
  });

  // Avisar de la posición al mover/redimensionar (la forma se mantiene en overlay-resize).
  overlayWindow.on('move', sendWebcamRect);
  overlayWindow.on('resize', sendWebcamRect);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createRecorderWindow() {
  recorderWindow = new BrowserWindow({
    width: 300,
    height: 534,            // 9:16 para la vista previa del reel
    show: false,            // oculta en modo normal; visible como preview en reel
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    backgroundColor: '#000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false, // no ralentizar el RAF cuando está oculta
    },
  });
  recorderWindow.setContentProtection(true); // la preview no debe salir en el video
  recorderWindow.loadFile(path.join(__dirname, 'renderer', 'recorder.html'));
  recorderWindow.on('closed', () => {
    recorderWindow = null;
  });
}

// --- Selector de zona (modo reel) --------------------------------------------

let regionOpen = false;

function createRegionWindow() {
  if (regionWindow) return;
  const b = screen.getPrimaryDisplay().bounds;
  regionWindow = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, enableLargerThanScreen: true, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  regionWindow.setAlwaysOnTop(true, 'floating');
  regionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  regionWindow.setContentProtection(true); // es UI: no debe salir en la grabación
  regionWindow.loadFile(path.join(__dirname, 'renderer', 'region.html'));
  regionWindow.webContents.once('did-finish-load', () => {
    regionWindow.webContents.send('zone-config', { aspect: zoneAspect(), rect: cropRect });
  });
  regionWindow.on('closed', () => { regionWindow = null; });
}

function openRegion(on) {
  regionOpen = !!on;
  if (on) {
    createRegionWindow();
    regionWindow.setIgnoreMouseEvents(false); // selector interactivo en setup
    const off = () => regionWindow && regionWindow.webContents.send('zone-mark', { on: false });
    if (regionWindow.webContents.isLoading()) regionWindow.webContents.once('did-finish-load', off);
    else off();
    regionWindow.show();
  } else if (regionWindow) regionWindow.hide();
  updateControlZ();
}

// Durante la grabación de reel: convertir el selector en un marcador parpadeante
// click-through (no bloquea la pantalla) y content-protected (no sale en el video).
function markZoneRecording() {
  if (recMode !== 'reel' || isFullCam()) { openRegion(false); return; } // 'solo cámara' no tiene zona
  createRegionWindow();
  regionWindow.setIgnoreMouseEvents(true, { forward: true });
  regionWindow.setContentProtection(true);
  regionWindow.show();
  regionOpen = true;
  const send = () => regionWindow && regionWindow.webContents.send('zone-mark', { on: true, rect: cropRect, aspect: zoneAspect() });
  if (regionWindow.webContents.isLoading()) regionWindow.webContents.once('did-finish-load', send);
  else send();
  updateControlZ();
}

// --- Vista previa en vivo del reel (ventana vertical) ------------------------

function reelPreviewSettings() {
  return {
    mode: 'reel', cameraId, bandPos, bandHeightFrac, cropRect, zoom: webcamZoom,
    shape: cameraShape, border: cameraBorder,
    reelHeadline, reelHeadlineOffset, reelHeadlinePos, bubbleSizeFrac,
    bubbleLocked, bubbleLockedRect, ytUrl: currentYtUrl(), mediaKind: reelMediaKind,
    systemAudio: false,
  };
}

function showReelPreview() {
  if (!recorderWindow) createRecorderWindow();
  const d = screen.getPrimaryDisplay();
  const w = 300, h = 534;
  recorderWindow.setBounds({
    x: d.workArea.x + d.workArea.width - w - 20,
    y: d.workArea.y + 20,
    width: w, height: h,
  });
  recorderWindow.setAlwaysOnTop(true, 'floating');
  recorderWindow.showInactive();
  // Reafirmar AL MOSTRAR: la ventana se crea oculta y la protección de captura
  // solo "agarra" cuando la ventana es visible. Sin esto, la previa se colaba
  // dentro del video grabado (efecto "doble").
  recorderWindow.setContentProtection(true);
  const send = () => recorderWindow.webContents.send('start-preview', reelPreviewSettings());
  if (recorderWindow.webContents.isLoading()) recorderWindow.webContents.once('did-finish-load', send);
  else send();
}

function hideReelPreview() {
  if (recorderWindow) {
    recorderWindow.webContents.send('stop-preview');
    recorderWindow.hide();
  }
}

// Vista previa del modo podcast (lienzo 16:9 con pantalla + cámara vertical),
// para encuadrar ANTES de grabar.
function podcastPreviewSettings() {
  return {
    mode: 'podcast', cameraId, zoom: webcamZoom,
    shape: 'vertical', border: cameraBorder, systemAudio: false,
  };
}

function showPodcastPreview() {
  if (!recorderWindow) createRecorderWindow();
  const d = screen.getPrimaryDisplay();
  const w = 360, h = 203; // 16:9
  recorderWindow.setBounds({
    x: d.workArea.x + d.workArea.width - w - 20,
    y: d.workArea.y + 20,
    width: w, height: h,
  });
  recorderWindow.setAlwaysOnTop(true, 'floating');
  recorderWindow.showInactive();
  // Reafirmar la protección de captura al mostrar (ver nota en showReelPreview).
  recorderWindow.setContentProtection(true);
  const send = () => recorderWindow.webContents.send('start-preview', podcastPreviewSettings());
  if (recorderWindow.webContents.isLoading()) recorderWindow.webContents.once('did-finish-load', send);
  else send();
}

function sendReelParams() {
  if (recMode === 'reel' && recorderWindow) {
    recorderWindow.webContents.send('reel-params', { bandPos, bandHeightFrac, cropRect, zoom: webcamZoom, reelHeadline, reelHeadlineOffset, reelHeadlinePos, bubbleSizeFrac, shape: cameraShape, border: cameraBorder, bubbleLocked, bubbleLockedRect, ytUrl: currentYtUrl(), mediaKind: reelMediaKind });
  }
}

// --- Ventanas de anotación ---------------------------------------------------

function createAnnotateWindow() {
  if (annotateWindow) return;
  const b = screen.getPrimaryDisplay().bounds;
  annotateWindow = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, enableLargerThanScreen: true, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  annotateWindow.setAlwaysOnTop(true, 'floating');
  annotateWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  annotateWindow.setIgnoreMouseEvents(true, { forward: true });
  // SIN content protection: queremos que las anotaciones salgan en la grabación.
  annotateWindow.loadFile(path.join(__dirname, 'renderer', 'annotate.html'));
  annotateWindow.webContents.once('did-finish-load', () => {
    annotateWindow.webContents.send('annot-config', annotConfig());
  });
  annotateWindow.on('closed', () => { annotateWindow = null; });
}

// Barra unificada de grabación (controles + anotaciones), aparece al grabar.
function createRecbarWindow() {
  if (recbarWindow) return;
  const d = screen.getPrimaryDisplay();
  const w = 280, h = 56;
  recbarWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.round(d.workArea.x + (d.workArea.width - w) / 2),
    y: d.workArea.y + 16,
    frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: true, skipTaskbar: true, alwaysOnTop: true,
    fullscreenable: false, maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  recbarWindow.setAlwaysOnTop(true, 'screen-saver');
  recbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  recbarWindow.setContentProtection(true); // la barra no debe salir en el video
  recbarWindow.loadFile(path.join(__dirname, 'renderer', 'recbar.html'));
  recbarWindow.on('closed', () => { recbarWindow = null; });
}

// --- Teleprompter ------------------------------------------------------------
// Ventana flotante con el guion. always-on-top + content-protected: se ve por
// encima de todo (en cualquier modo: normal, reel vertical, podcast) pero NO
// aparece en la grabación. Movible y redimensionable para adaptarla a la pantalla.
function createTeleprompterWindow() {
  if (teleprompterWindow) { teleprompterWindow.show(); return; }
  const d = screen.getPrimaryDisplay();
  const w = 560, h = 300;
  teleprompterWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.round(d.workArea.x + (d.workArea.width - w) / 2),
    y: d.workArea.y + 40,
    frame: false, transparent: true, hasShadow: false,
    resizable: true, movable: true, skipTaskbar: true, alwaysOnTop: true,
    fullscreenable: false, maximizable: false,
    minWidth: 280, minHeight: 140, maxWidth: 1400, maxHeight: 1100,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  teleprompterWindow.setAlwaysOnTop(true, 'screen-saver');
  teleprompterWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  teleprompterWindow.setContentProtection(true); // el guion no debe salir en el video
  teleprompterWindow.loadFile(path.join(__dirname, 'renderer', 'teleprompter.html'));
  // Reafirmar la protección al mostrar (en Windows agarra con la ventana visible).
  teleprompterWindow.once('show', () => teleprompterWindow.setContentProtection(true));
  teleprompterWindow.on('closed', () => { teleprompterWindow = null; });
}

ipcMain.handle('teleprompter-toggle', (_e, on) => {
  if (on) createTeleprompterWindow();
  else if (teleprompterWindow) teleprompterWindow.close();
  if (controlWindow) controlWindow.webContents.send('tp-state', !!on);
  return !!on;
});

// Traer la burbuja de la cámara al frente (si quedó tapada/fuera de pantalla).
ipcMain.on('raise-camera', () => raiseOverlay());

// La recbar pide ajustar su ancho al contenido (compacta/expandida), centrada.
ipcMain.on('recbar-resize', (_e, width) => {
  if (!recbarWindow) return;
  const d = screen.getPrimaryDisplay();
  const w = Math.max(200, Math.min(1100, Math.round(width)));
  const b = recbarWindow.getBounds();
  recbarWindow.setBounds({ x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: b.y, width: w, height: b.height });
});

// Click-through según la herramienta: el láser deja pasar clics (sigue el
// cursor con forward), el rectángulo captura el ratón para dibujar.
function annotConfig() {
  return { tool: annotTool, color: annotColor, width: annotWidth, numBg: annotNumBg, numFont: annotNumFont };
}

function applyAnnotMouse() {
  if (!annotateWindow) return;
  // Herramientas de dibujo capturan el ratón; el láser deja pasar clics
  // (sigue el cursor); "Mover" es totalmente transparente al ratón.
  if (annotTool === 'rect' || annotTool === 'arrow' || annotTool === 'number') {
    annotateWindow.setIgnoreMouseEvents(false);
  } else if (annotTool === 'laser') {
    annotateWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    annotateWindow.setIgnoreMouseEvents(true, { forward: false });
  }
}

// El panel y la barra deben quedar por encima de la capa de anotaciones/zona.
function updateControlZ() {
  if (controlWindow) controlWindow.setAlwaysOnTop(isRecording || annotationsOpen || regionOpen, 'screen-saver');
}

// Cerrar la UI de grabación (barra unificada + capa de anotaciones + preview).
function endRecordingUi() {
  if (recbarWindow) recbarWindow.close();
  annotationsOpen = false;
  annotTool = 'none';
  if (annotateWindow) annotateWindow.close();
  // En modo normal ocultamos el compositor; en reel/podcast lo DEJAMOS visible
  // como vista previa para poder grabar otra vez sin reiniciar el modo.
  if (recorderWindow && recMode === 'normal') recorderWindow.hide();
  if (regionWindow) { regionWindow.close(); regionOpen = false; }
}

// Atajo de láser (durante la grabación): alterna la herramienta vía la recbar.
function toggleLaser() {
  if (!isRecording || !recbarWindow) return;
  const next = annotTool === 'laser' ? 'none' : 'laser';
  recbarWindow.webContents.send('set-active-tool', next);
}

// Atajo de confeti: crea la capa de dibujo si hace falta y dispara la ráfaga.
function doConfetti() {
  if (!isRecording) return;
  if (!annotateWindow) { annotationsOpen = true; createAnnotateWindow(); applyAnnotMouse(); }
  const send = () => annotateWindow && annotateWindow.webContents.send('confetti');
  if (annotateWindow.webContents.isLoading()) annotateWindow.webContents.once('did-finish-load', send);
  else send();
}

// Atajos de teclado globales (funcionan aunque la app no tenga el foco).
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (isRecording) { if (recbarWindow) recbarWindow.webContents.send('rb', 'stop'); }
    else if (controlWindow) controlWindow.webContents.send('shortcut', 'record');
  });
  globalShortcut.register('CommandOrControl+Shift+P', () => { if (recbarWindow) recbarWindow.webContents.send('rb', 'pause'); });
  globalShortcut.register('CommandOrControl+Shift+A', () => { if (recbarWindow) recbarWindow.webContents.send('rb', 'annot'); });
  globalShortcut.register('CommandOrControl+Shift+L', () => toggleLaser());
  globalShortcut.register('CommandOrControl+Shift+C', () => doConfetti());
}

// --- Posición de la webcam (mapeo burbuja -> canvas) -------------------------

// Devuelve la posición de la burbuja como fracciones (0..1) del display,
// para que el compositor las multiplique por el tamaño real del canvas.
function getWebcamRectFractions() {
  if (!overlayWindow) return null;
  const b = overlayWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  const d = display.bounds;
  return {
    fx: (b.x - d.x) / d.width,
    fy: (b.y - d.y) / d.height,
    fw: b.width / d.width,
    fh: b.height / d.height,
  };
}

function sendWebcamRect() {
  const rect = getWebcamRectFractions();
  if (rect && recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.webContents.send('webcam-rect', rect);
  }
}

// Reafirmar prioridad al frente sin mover ni mostrar la burbuja.
function pinOverlay() {
  if (!overlayWindow || !overlayWindow.isVisible()) return;
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
}

// Traer la burbuja a la pantalla donde está el cursor y al frente.
function raiseOverlay() {
  // En modo reel, podcast, o "sin cámara": la webcam no es una burbuja flotante.
  if (recMode === 'reel' || recMode === 'podcast' || cameraShape === 'none') return;
  const cursor = screen.getCursorScreenPoint();
  const target = screen.getDisplayNearestPoint(cursor);
  const wa = target.workArea;
  const margin = 24;
  let bw = defaultWidthFor(cameraShape);
  let bh = Math.round(bw * aspectFor(cameraShape));
  if (overlayWindow) {
    const b = overlayWindow.getBounds();
    bw = b.width; bh = b.height;
  }
  const x = wa.x + wa.width - bw - margin;
  const y = wa.y + wa.height - bh - margin;
  if (!overlayWindow) {
    createOverlayWindow({ x, y, width: bw, height: bh });
    return;
  }
  overlayWindow.setBounds({ x, y, width: bw, height: bh });
  overlayWindow.show();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.moveTop();
}

// --- Permisos (solo macOS; en Windows se conceden por el sistema) ------------

async function ensurePermissions() {
  if (process.platform !== 'darwin') return { camera: true, mic: true, screen: true };
  try {
    await systemPreferences.askForMediaAccess('camera');
    await systemPreferences.askForMediaAccess('microphone');
  } catch (_) {}
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    mic: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
}

// --- IPC ---------------------------------------------------------------------

// Lista de pantallas disponibles (con miniatura)
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('check-permissions', async () => ensurePermissions());

// El panel pide ajustar su alto al contenido (compacto al grabar).
ipcMain.on('resize-control', (_e, h) => {
  if (!controlWindow) return;
  const w = controlWindow.getContentSize()[0];
  const height = Math.max(120, Math.min(900, Math.round(h)));
  controlWindow.setContentSize(w, height);
});

// Estado del permiso de grabación de pantalla (en Windows siempre 'granted').
ipcMain.handle('get-screen-status', async () => {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
});

// El usuario eligió una pantalla; la guardamos para getDisplayMedia.
ipcMain.handle('select-source', async (_e, sourceId) => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  selectedSource = sources.find((s) => s.id === sourceId) || sources[0];
  return !!selectedSource;
});

// Empezar a grabar: abre burbuja + recorder y dispara el flujo.
ipcMain.handle('start-recording', async (_e, settings) => {
  systemAudio = settings.systemAudio === true; // lo lee el handler de getDisplayMedia
  const full = {
    ...settings,
    cameraId, shape: cameraShape, border: cameraBorder, zoom: webcamZoom,
    mode: recMode, bandPos, bandHeightFrac, cropRect, ytUrl: currentYtUrl(), mediaKind: reelMediaKind,
  };

  if (recMode === 'reel') {
    // Reel (100% cámara / YouTube): la cámara se compone en el canvas, sin burbuja
    // ni zona de escritorio. La previa vertical sigue visible (content-protected).
    if (overlayWindow) overlayWindow.hide();
    openRegion(false);
  } else if (recMode === 'podcast') {
    // Podcast: la cámara va integrada en el canvas (panel derecho), no es burbuja.
    if (overlayWindow) overlayWindow.hide();
    openRegion(false);
  } else {
    // Normal: la burbuja flotante es el autovistazo (excluida de la captura;
    // además coincide pixel a pixel con la del canvas, así que no se duplica).
    if (cameraShape !== 'none') {
      if (!overlayWindow) createOverlayWindow();
      else overlayWindow.show();
    }
  }
  if (!recorderWindow) createRecorderWindow();

  // Ocultar el panel y mostrar la barra unificada de grabación.
  isRecording = true;
  if (controlWindow) controlWindow.hide();
  createRecbarWindow();
  // Reafirmar que la burbuja queda siempre al frente al grabar (sin moverla)
  setTimeout(pinOverlay, 80);
  // Reel + YouTube: arranca reproduciendo y muestra el botón de pausa/play.
  const isYt = recMode === 'reel' && (bandPos === 'youtube-top' || bandPos === 'youtube-pie') && !!reelYtPath;
  const isScreen = recMode === 'reel' && (bandPos === 'screen-top' || bandPos === 'screen-pie');
  ytPlaying = isYt && reelMediaKind === 'video';
  const barKind = isScreen ? 'screen' : reelMediaKind;
  if ((isYt || isScreen) && recbarWindow) {
    const showBtn = () => recbarWindow.webContents.send('yt-button', { on: true, kind: barKind });
    if (recbarWindow.webContents.isLoading()) recbarWindow.webContents.once('did-finish-load', showBtn);
    else showBtn();
  }
  // En reel/podcast mantenemos la vista previa del compositor visible durante la
  // grabación (para ver cámara + zona). Reafirmamos la protección de contenido
  // para que la captura de pantalla la EXCLUYA y NO aparezca dentro del video.
  // (En modo normal no hay previa: la burbuja es el autovistazo.)
  if (recorderWindow) recorderWindow.setContentProtection(true);
  updateControlZ();

  // Esperar a que el recorder esté listo, luego enviar la orden.
  const begin = () => {
    sendWebcamRect();
    recorderWindow.webContents.send('begin-recording', full);
  };
  if (recorderWindow.webContents.isLoading()) {
    recorderWindow.webContents.once('did-finish-load', begin);
  } else {
    begin();
  }
  return true;
});

// Redimensionar la burbuja desde el asa, anclando la esquina superior izquierda
// y manteniendo la proporción de la forma actual.
ipcMain.on('overlay-resize', (_e, width) => {
  if (!overlayWindow) return;
  const b = overlayWindow.getBounds();
  const w = Math.max(80, Math.min(600, Math.round(width)));
  const h = Math.round(w * aspectFor(cameraShape));
  overlayWindow.setBounds({ x: b.x, y: b.y, width: w, height: h });
});

// --- Anotaciones (IPC) --- solo la capa de dibujo; la barra es la recbar.
ipcMain.handle('annot-toggle', (_e, on) => {
  annotationsOpen = !!on;
  if (on) {
    createAnnotateWindow();
    applyAnnotMouse();
  } else {
    annotTool = 'none';
    if (annotateWindow) annotateWindow.close();
  }
  return on;
});

ipcMain.on('annot-cmd', (_e, cmd) => {
  if (!annotateWindow) return;
  if (cmd.type === 'tool') annotTool = cmd.value;
  else if (cmd.type === 'color') annotColor = cmd.value;
  else if (cmd.type === 'width') annotWidth = cmd.value;
  else if (cmd.type === 'numbg') annotNumBg = cmd.value;
  else if (cmd.type === 'clear') { annotateWindow.webContents.send('annot-clear'); return; }
  else if (cmd.type === 'confetti') { annotateWindow.webContents.send('confetti'); return; }
  applyAnnotMouse();
  annotateWindow.webContents.send('annot-config', annotConfig());
});

// El panel cambia cámara/forma/borde (incluido el modo "sin cámara").
ipcMain.handle('update-camera', (_e, opts) => {
  cameraId = opts.cameraId || '';
  cameraShape = opts.shape || 'circle';
  cameraBorder = opts.border !== false;

  // En reel con banda, en podcast (cámara integrada en el canvas), o "sin cámara":
  // ocultar la burbuja flotante porque no debe aparecer encima de la pantalla.
  const isReelBubble = recMode === 'reel' && bandPos === 'bubble';
  if ((recMode === 'reel' && !isReelBubble) || recMode === 'podcast' || cameraShape === 'none') {
    if (overlayWindow) overlayWindow.hide();
    sendReelParams(); // por si la forma cambió y hay preview de reel escuchando
    return true;
  }

  if (!overlayWindow) {
    createOverlayWindow();
  } else {
    // Ajustar la proporción de la ventana a la nueva forma y reenviar config.
    const b = overlayWindow.getBounds();
    let w = b.width;
    if (cameraShape === 'vertical') w = Math.min(b.width, 240);
    else if (cameraShape === 'wide') w = Math.max(b.width, 280); // mínimo razonable para 16:9
    overlayWindow.setBounds({ x: b.x, y: b.y, width: w, height: Math.round(w * aspectFor(cameraShape)) });
    overlayWindow.webContents.send('overlay-config', { cameraId, shape: cameraShape, border: cameraBorder, zoom: webcamZoom });
    overlayWindow.show();
  }
  sendReelParams();
  return true;
});

// --- Modo de grabación (IPC) ---
ipcMain.handle('set-mode', (_e, mode) => {
  recMode = (mode === 'reel' || mode === 'podcast') ? mode : 'normal';
  const showBubble = () => {
    if (cameraShape !== 'none') {
      if (!overlayWindow) createOverlayWindow();
      else overlayWindow.show();
    }
  };
  if (recMode === 'reel') {
    if (overlayWindow) overlayWindow.hide();   // en reel la cámara va en el canvas, no burbuja
    openRegion(false);                          // el nuevo reel no usa zona de escritorio
    showReelPreview();
  } else if (recMode === 'podcast') {
    // La webcam va integrada dentro del canvas (panel derecho vertical),
    // así que no hay burbuja flotante ni selector de zona. Mostramos la vista
    // previa para que el usuario vea pantalla + cámara antes de grabar.
    if (overlayWindow) overlayWindow.hide();
    openRegion(false);
    showPodcastPreview();
  } else {
    openRegion(false);
    hideReelPreview();
    showBubble();
  }
  return recMode;
});

ipcMain.on('set-reel', (_e, opts) => {
  // Nuevo reel: 'full' (100% cámara) | 'youtube-top' | 'youtube-pie'. Sin burbuja
  // ni zona de escritorio. El título va siempre centrado (lo dibuja el recorder).
  if (typeof opts.ytPath === 'string') reelYtPath = opts.ytPath;
  if (opts.bandPos) bandPos = opts.bandPos;
  if (opts.reelHeadline && typeof opts.reelHeadline === 'object') reelHeadline = opts.reelHeadline;
  if (recMode === 'reel' && overlayWindow) overlayWindow.hide();
  sendReelParams();
});

ipcMain.on('set-zoom', (_e, z) => {
  webcamZoom = z || 1;
  if (overlayWindow) {
    overlayWindow.webContents.send('overlay-config', { cameraId, shape: cameraShape, border: cameraBorder, zoom: webcamZoom });
  }
  // Reflejar el zoom en vivo en la vista previa del compositor (reel Y podcast).
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.webContents.send('reel-params', { zoom: webcamZoom });
  }
  sendReelParams();
});

ipcMain.on('zone-toggle', (_e, on) => openRegion(on));

// Desde el selector de zona (recuadro) -> el recorder/preview lo sigue.
ipcMain.on('zone-rect', (_e, r) => { cropRect = r; sendReelParams(); });

// Desde la vista previa (arrastrar/zoom) -> el recuadro lo sigue.
ipcMain.on('crop-update', (_e, r) => {
  cropRect = r;
  if (regionWindow) regionWindow.webContents.send('zone-config', { rect: cropRect });
});

ipcMain.on('pause-recording', () => {
  if (recorderWindow) recorderWindow.webContents.send('pause-recording');
});
ipcMain.on('resume-recording', () => {
  if (recorderWindow) recorderWindow.webContents.send('resume-recording');
});
ipcMain.on('stop-recording', () => {
  if (recorderWindow) recorderWindow.webContents.send('stop-recording');
});

// --- Recepción de chunks de video desde el recorder --------------------------

ipcMain.handle('rec-start', async (_e, mime) => {
  recIsMp4 = /mp4/i.test(mime || '');
  const ext = recIsMp4 ? 'mp4' : 'webm';
  tempFilePath = path.join(os.tmpdir(), `joom-${Date.now()}.${ext}`);
  writeStream = fs.createWriteStream(tempFilePath);
  return true;
});

ipcMain.on('rec-chunk', (_e, chunk) => {
  if (writeStream && !writeStream.writableEnded) writeStream.write(Buffer.from(chunk));
});

// El compositor reporta un fallo (p. ej. permiso de grabación de pantalla).
ipcMain.on('rec-error', (_e, msg) => {
  if (writeStream) { writeStream.end(); writeStream = null; }
  isRecording = false;
  endRecordingUi();
  updateControlZ();
  if (controlWindow) {
    controlWindow.show();
    controlWindow.webContents.send('export-done', { ok: false, error: msg });
  }
});

// Cuando el recorder termina: cerrar stream, transcodificar a MP4 y guardar.
ipcMain.handle('rec-stop', async () => {
  isRecording = false;
  endRecordingUi();
  updateControlZ();
  if (controlWindow) {
    controlWindow.show();
    controlWindow.webContents.send('export-busy'); // mostrar "Exportando…"
  }

  await new Promise((resolve) => {
    if (writeStream) writeStream.end(resolve);
    else resolve();
  });
  // Importante: a partir de aquí ya no aceptamos chunks tardíos.
  writeStream = null;

  if (!tempFilePath || !fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size === 0) {
    const r = { ok: false, error: 'No se grabó ningún dato.' };
    if (controlWindow) controlWindow.webContents.send('export-done', r);
    return r;
  }

  // ¿Dónde guardar?
  const def = path.join(
    app.getPath('videos') || app.getPath('desktop'),
    `Grabacion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`
  );
  const { canceled, filePath } = await dialog.showSaveDialog(controlWindow, {
    title: 'Guardar grabación',
    defaultPath: def,
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }],
  });
  if (canceled || !filePath) {
    fs.unlink(tempFilePath, () => {});
    const r = { ok: false, error: 'Guardado cancelado.' };
    if (controlWindow) controlWindow.webContents.send('export-done', r);
    return r;
  }

  try {
    const onProg = (pct) => {
      if (controlWindow) controlWindow.webContents.send('export-progress', pct);
    };
    if (recIsMp4) {
      // Ya es H.264: solo reempaquetar para web (moov al inicio), sin recodificar.
      await remuxToMp4(tempFilePath, filePath, onProg);
    } else {
      await transcodeToMp4(tempFilePath, filePath, onProg);
    }
    fs.unlink(tempFilePath, () => {});
    lastSavedPath = filePath; // para "Generar subtítulos" rápido
    const result = { ok: true, filePath };
    if (controlWindow) controlWindow.webContents.send('export-done', result);
    return result;
  } catch (err) {
    const result = { ok: false, error: String(err) };
    if (controlWindow) controlWindow.webContents.send('export-done', result);
    return result;
  }
});

// Solo aceptamos rutas a archivos reales bajo directorios donde la app guarda
// salidas (Videos, Desktop, Downloads, tmp). Sin esto, un IPC malicioso podría
// pedirnos que reveláramos en el explorador cualquier archivo del sistema.
ipcMain.handle('reveal-file', async (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return;
  let resolved;
  try { resolved = path.resolve(filePath); } catch (_) { return; }
  const allowed = [
    app.getPath('videos'),
    app.getPath('desktop'),
    app.getPath('downloads'),
    os.tmpdir(),
  ].map((p) => path.resolve(p));
  if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) return;
  if (!fs.existsSync(resolved)) return;
  shell.showItemInFolder(resolved);
});

// --- YouTube en reel (descarga con yt-dlp) -----------------------------------

// Servidor local (solo 127.0.0.1) que sirve el video descargado con CORS y
// soporte de rangos. Así el <video> del recorder se carga "crossorigin" y NO
// tiñe el canvas (file:// sí lo teñiría y rompería canvas.captureStream).
let ytServer = null;
let ytServerPort = 0;
function ensureYtServer() {
  if (ytServer) return;
  ytServer = http.createServer((req, res) => {
    if (!reelYtPath || !fs.existsSync(reelYtPath)) { res.writeHead(404); res.end(); return; }
    let stat;
    try { stat = fs.statSync(reelYtPath); } catch (_) { res.writeHead(404); res.end(); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', /\.pdf$/i.test(reelYtPath) ? 'application/pdf' : 'video/mp4');
    const range = req.headers.range;
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(reelYtPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size });
      fs.createReadStream(reelYtPath).pipe(res);
    }
  });
  ytServer.listen(0, '127.0.0.1', () => { ytServerPort = ytServer.address().port; });
}

// URL (con cache-bust por nombre de archivo) para que el recorder cargue el video.
function currentYtUrl() {
  if (!reelYtPath || !ytServerPort) return '';
  return `http://127.0.0.1:${ytServerPort}/yt.mp4?v=${encodeURIComponent(path.basename(reelYtPath))}`;
}


ipcMain.handle('yt-download', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    return { ok: false, error: 'Pega una URL válida de YouTube (http/https).' };
  }
  const send = (m) => controlWindow && controlWindow.webContents.send('yt-progress', m);
  const out = path.join(os.tmpdir(), `joom-yt-${Date.now()}.mp4`);
  const args = [
    '-f', 'bv*[height<=720]+ba/b[height<=720]/b',
    '--merge-output-format', 'mp4',
    '--no-playlist', '--no-part', '--force-overwrites',
    '-o', out,
  ];
  if (ffmpegPath && fs.existsSync(ffmpegPath)) { args.push('--ffmpeg-location', ffmpegPath); }
  args.push(url.trim());
  send('Iniciando descarga…');
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn(ytDlpPath, args); }
    catch (e) { resolve({ ok: false, error: 'No se pudo ejecutar yt-dlp: ' + e.message }); return; }
    let err = '';
    const onData = (d) => {
      const s = d.toString();
      const m = /\[download\]\s+([\d.]+)%/.exec(s);
      if (m) send(`Descargando… ${m[1]}%`);
      else if (/Merging/i.test(s)) send('Uniendo audio y video…');
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => { err += d.toString(); onData(d); });
    proc.on('error', (e) => resolve({ ok: false, error: 'No se pudo ejecutar yt-dlp (¿instalado?). ' + e.message }));
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(out)) {
        reelYtPath = out;
        reelMediaKind = 'video';
        ensureYtServer();
        sendReelParams();
        send('Video listo ✓');
        resolve({ ok: true, path: out });
      } else {
        resolve({ ok: false, error: 'yt-dlp falló. ' + err.slice(-300) });
      }
    });
  });
});

// Subir un video desde la PC (se usa igual que el de YouTube en el reel).
ipcMain.handle('pick-video', async () => {
  const r = await dialog.showOpenDialog(controlWindow, {
    title: 'Elige un video de tu PC',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  reelYtPath = r.filePaths[0];
  reelMediaKind = 'video';
  ensureYtServer();
  sendReelParams();
  return { ok: true, path: reelYtPath };
});

// --- Presentaciones en el reel (PDF / PowerPoint / Google Slides) ------------

// Descarga simple por HTTPS siguiendo redirecciones (para Google Slides export/pdf).
function downloadFile(url, out, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Demasiadas redirecciones'));
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(downloadFile(next, out, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(out);
      res.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve()));
      ws.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Convierte PowerPoint a PDF. En Windows usa el PowerPoint instalado (COM);
// en macOS usa LibreOffice (soffice headless) y, si no está, Keynote (AppleScript).
function convertPptToPdf(input, output) {
  if (process.platform === 'win32') return convertPptToPdfWindows(input, output);
  return convertPptToPdfMac(input, output);
}

function convertPptToPdfWindows(input, output) {
  return new Promise((resolve) => {
    const ps = `
$ErrorActionPreference='Stop'
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  $pres = $ppt.Presentations.Open(${JSON.stringify(input)}, $true, $false, $false)
  $pres.SaveAs(${JSON.stringify(output)}, 32)
  $pres.Close()
  $ppt.Quit()
  exit 0
} catch { Write-Error $_; exit 1 }`;
    const tmpPs = path.join(os.tmpdir(), `joom-ppt-${Date.now()}.ps1`);
    try { fs.writeFileSync(tmpPs, ps, 'utf8'); } catch (_) { return resolve(false); }
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs]);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => { fs.unlink(tmpPs, () => {}); resolve(code === 0); });
  });
}

// Localiza el ejecutable de LibreOffice en macOS (app o Homebrew).
function findSoffice() {
  const cands = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/libreoffice',
    '/usr/local/bin/libreoffice',
    '/usr/bin/soffice',
  ];
  return cands.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

function convertPptToPdfMac(input, output) {
  const soffice = findSoffice();
  if (soffice) {
    return new Promise((resolve) => {
      const outDir = path.dirname(output);
      const proc = spawn(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, input]);
      const fallback = () => convertPptToPdfKeynote(input, output).then(resolve);
      proc.on('error', fallback);
      proc.on('close', () => {
        // soffice nombra el PDF como <basename>.pdf dentro de --outdir.
        const produced = path.join(outDir, path.basename(input).replace(/\.[^.]+$/, '') + '.pdf');
        if (fs.existsSync(produced)) {
          try { if (path.resolve(produced) !== path.resolve(output)) fs.renameSync(produced, output); } catch (_) {}
          return resolve(fs.existsSync(output) || fs.existsSync(produced));
        }
        fallback();
      });
    });
  }
  // Sin LibreOffice: intentamos con Keynote.
  return convertPptToPdfKeynote(input, output);
}

// Respaldo en macOS: abrir el .pptx en Keynote y exportarlo a PDF (AppleScript).
function convertPptToPdfKeynote(input, output) {
  return new Promise((resolve) => {
    const script = `
on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  try
    tell application "Keynote"
      set theDoc to open (POSIX file inPath)
      export theDoc to (POSIX file outPath) as PDF
      close theDoc saving no
    end tell
    return "ok"
  on error errMsg
    return "err:" & errMsg
  end try
end run`;
    const proc = spawn('/usr/bin/osascript', ['-e', script, input, output]);
    proc.on('error', () => resolve(false));
    proc.on('close', () => resolve(fs.existsSync(output)));
  });
}

// Subir una presentación de la PC: PDF (directo) o PowerPoint (convertido a PDF).
ipcMain.handle('pick-presentation', async () => {
  const r = await dialog.showOpenDialog(controlWindow, {
    title: 'Elige un PDF o PowerPoint',
    filters: [{ name: 'Presentación', extensions: ['pdf', 'pptx', 'ppt'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const f = r.filePaths[0];
  const send = (m) => controlWindow && controlWindow.webContents.send('yt-progress', m);
  if (/\.pdf$/i.test(f)) {
    reelYtPath = f; reelMediaKind = 'pdf'; ensureYtServer(); sendReelParams();
    return { ok: true, kind: 'pdf' };
  }
  send('Convirtiendo PowerPoint a PDF (LibreOffice o Keynote)…');
  const out = path.join(os.tmpdir(), `joom-ppt-${Date.now()}.pdf`);
  const ok = await convertPptToPdf(f, out);
  if (ok && fs.existsSync(out)) {
    reelYtPath = out; reelMediaKind = 'pdf'; ensureYtServer(); sendReelParams();
    return { ok: true, kind: 'pdf' };
  }
  return { ok: false, error: 'No se pudo convertir el PowerPoint. Instala LibreOffice (brew install --cask libreoffice) o ábrelo en Keynote/PowerPoint y expórtalo a PDF, y sube el PDF.' };
});

// Google Slides: descargar la presentación como PDF (debe estar compartida públicamente).
ipcMain.handle('slides-download', async (_e, url) => {
  const m = /presentation\/d\/([a-zA-Z0-9_-]+)/.exec(String(url || ''));
  if (!m) return { ok: false, error: 'URL de Google Slides no válida.' };
  const send = (msg) => controlWindow && controlWindow.webContents.send('yt-progress', msg);
  const pdfUrl = `https://docs.google.com/presentation/d/${m[1]}/export/pdf`;
  const out = path.join(os.tmpdir(), `joom-slides-${Date.now()}.pdf`);
  send('Descargando Google Slides…');
  try {
    await downloadFile(pdfUrl, out);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('Archivo vacío (¿la presentación es pública?)');
    reelYtPath = out; reelMediaKind = 'pdf'; ensureYtServer(); sendReelParams();
    return { ok: true, kind: 'pdf' };
  } catch (e) {
    return { ok: false, error: 'No se pudo descargar. Comparte la presentación como "cualquiera con el enlace". ' + e.message };
  }
});

// Navegar diapositivas durante la grabación (recbar -> recorder).
ipcMain.on('slide-nav', (_e, dir) => {
  if (recorderWindow) recorderWindow.webContents.send('slide-nav-cmd', dir === 'next' ? 'next' : 'prev');
});

// Zoom de la pantalla en banda durante la grabación (recbar -> recorder).
ipcMain.on('screen-zoom', (_e, delta) => {
  if (recorderWindow) recorderWindow.webContents.send('screen-zoom-cmd', Number(delta) || 0);
});

// Pausar/reanudar el video durante la grabación (recbar -> recorder + eco a la barra).
ipcMain.on('yt-toggle', () => {
  ytPlaying = !ytPlaying;
  if (recorderWindow) recorderWindow.webContents.send('yt-toggle-cmd', ytPlaying);
  if (recbarWindow) recbarWindow.webContents.send('yt-toggle-cmd', ytPlaying);
});

// Regresar/avanzar el video N segundos durante la grabación (recbar -> recorder).
ipcMain.on('yt-seek', (_e, delta) => {
  if (recorderWindow) recorderWindow.webContents.send('yt-seek-cmd', Number(delta) || 0);
});

// --- Transcodificación WebM -> MP4 (H.264 + AAC) -----------------------------

function runFfmpeg(args, onProgress, cwd) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath || 'ffmpeg';
    const proc = spawn(bin, args, cwd ? { cwd } : undefined);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString());
      if (m && onProgress) {
        const secs = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        onProgress(secs);
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg salió con código ${code}\n${stderr.slice(-800)}`));
    });
  });
}

// WebM (VP8/Opus) -> MP4 (H.264 + AAC): recodifica.
function transcodeToMp4(input, output, onProgress) {
  return runFfmpeg(
    [
      '-y', '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '160k',
      output,
    ],
    onProgress
  );
}

// MP4 ya en H.264/AAC: solo reempaqueta (rápido, sin pérdida de calidad).
function remuxToMp4(input, output, onProgress) {
  return runFfmpeg(
    ['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output],
    onProgress
  );
}

// --- Subtítulos con Groq (Whisper hospedado) ---------------------------------

// Tamaño del video (parseando la salida de ffmpeg -i) para escalar la fuente.
function probeSize(file) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', file]);
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', () => {
      const m = /,\s(\d{2,5})x(\d{2,5})/.exec(err);
      resolve(m ? { w: +m[1], h: +m[2] } : { w: 1920, h: 1080 });
    });
    proc.on('error', () => resolve({ w: 1920, h: 1080 }));
  });
}

// Reparte la duración del segmento entre palabras (tras corregir el texto).
function redistributeWordTimes(segStart, segEnd, text) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((w) => Math.max(1, w.length + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.001, segEnd - segStart);
  let acc = 0;
  return words.map((w, i) => {
    const wDur = (weights[i] / total) * dur;
    const s = segStart + acc; const e = s + wDur; acc += wDur;
    return { word: w, start: s, end: e };
  });
}

// Transcribe con Groq (whisper-large-v3) pidiendo timestamps por palabra.
async function groqTranscribe(audioPath, apiKey, lang) {
  const data = fs.readFileSync(audioPath);
  const fd = new FormData();
  fd.append('file', new Blob([data]), 'audio.mp3');
  fd.append('model', 'whisper-large-v3');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  if (lang) fd.append('language', lang);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Groq HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  return res.json();
}

// Groq devuelve words a nivel raíz; las repartimos en cada segmento por tiempo.
function attachWordsToSegments(json) {
  const segs = json.segments || [];
  const words = json.words || [];
  if (!words.length || !segs.length) return json;
  let wi = 0;
  for (const seg of segs) {
    seg.words = [];
    while (wi < words.length && words[wi].start < seg.end - 1e-3) {
      seg.words.push({ word: words[wi].word, start: words[wi].start, end: words[wi].end });
      wi++;
    }
  }
  while (wi < words.length) {
    segs[segs.length - 1].words.push({ word: words[wi].word, start: words[wi].start, end: words[wi].end });
    wi++;
  }
  return json;
}

// Corrige errores obvios de transcripción/puntuación con un LLM de Groq.
async function groqPolish(text, apiKey) {
  const body = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'Corrige SOLO errores obvios de transcripción, puntuación y mayúsculas iniciales en español. Mantén EXACTAMENTE las mismas palabras y su orden; no añadas ni quites contenido ni expliques nada. Responde solo con la frase corregida, sin comillas.' },
      { role: 'user', content: text },
    ],
    temperature: 0.1,
  };
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Groq LLM HTTP ' + res.status);
  const j = await res.json();
  let out = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  if (out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
  return out;
}

// Quema los subtítulos .ass en el video. En Windows el filtro 'ass' no acepta
// rutas con "C:\..."; por eso ejecutamos ffmpeg con cwd en la carpeta del .ass
// y lo referenciamos solo por su nombre (sin ruta, sin dos puntos ni barras).
function burnSubs(input, assPath, output, onProgress) {
  const dir = path.dirname(assPath);
  const name = path.basename(assPath);
  return runFfmpeg(
    ['-y', '-i', input, '-vf', `ass=${name}`, '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'copy', output],
    onProgress,
    dir
  );
}

ipcMain.handle('gen-subs', async (_e, opts) => {
  const apiKey = (opts.apiKey || '').trim();
  if (!apiKey) return { ok: false, error: 'Pon tu API key de Groq en la pestaña Subtítulos.' };
  const send = (m) => controlWindow && controlWindow.webContents.send('subs-status', m);

  const pick = await dialog.showOpenDialog(controlWindow, {
    title: 'Elige el video para subtitular',
    defaultPath: lastSavedPath || app.getPath('videos') || app.getPath('desktop'),
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, error: 'Cancelado.' };
  const file = pick.filePaths[0];

  const mp3 = path.join(os.tmpdir(), `joom-aud-${Date.now()}.mp3`);
  const ass = path.join(os.tmpdir(), `joom-sub-${Date.now()}.ass`);
  try {
    send('Extrayendo audio…');
    await runFfmpeg(['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
    const sz = fs.existsSync(mp3) ? fs.statSync(mp3).size : 0;
    if (sz === 0) throw new Error('No se pudo extraer el audio.');
    if (sz > 24 * 1024 * 1024) {
      fs.unlink(mp3, () => {});
      return { ok: false, error: 'El audio supera ~24 MB (video muy largo para una sola petición). Usa un clip más corto.' };
    }

    send('Transcribiendo con Groq… (puede tardar unos segundos)');
    const json = await groqTranscribe(mp3, apiKey, (opts.lang || '').trim());
    fs.unlink(mp3, () => {});
    if (!json || !json.segments || !json.segments.length) {
      return { ok: false, error: 'Groq no devolvió texto.' };
    }
    attachWordsToSegments(json);

    if (opts.polish) {
      const total = json.segments.length;
      for (let i = 0; i < total; i++) {
        const seg = json.segments[i];
        const original = (seg.text || '').trim();
        if (!original) continue;
        send(`Corrigiendo con IA… ${i + 1}/${total}`);
        try {
          const fixed = await groqPolish(original, apiKey);
          const ratio = fixed.length / Math.max(1, original.length);
          if (fixed && fixed !== original && ratio > 0.5 && ratio < 1.6) {
            seg.text = fixed;
            seg.words = redistributeWordTimes(seg.start, seg.end, fixed);
          }
        } catch (e) { /* si falla, se queda el original */ }
      }
    }

    send('Generando subtítulos…');
    const size = await probeSize(file);
    fs.writeFileSync(ass, buildAss(json, opts.style || 'pop', size));

    const out = file.replace(/\.(mp4|mov|webm|mkv|m4v)$/i, '') + '-subs.mp4';
    send('Insertando subtítulos en el video…');
    await burnSubs(file, ass, out, (secs) => send(`Insertando… ${secs.toFixed(0)}s`));
    fs.unlink(ass, () => {});

    shell.showItemInFolder(out);
    return { ok: true, filePath: out };
  } catch (err) {
    fs.unlink(mp3, () => {});
    fs.unlink(ass, () => {});
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// --- Arranque de la app ------------------------------------------------------

// Endurecer todos los webContents que se creen en la app: bloquear navegación
// fuera de los HTML locales y rechazar cualquier window.open o nuevo target.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch (_) { /* ignored */ }
    return { action: 'deny' };
  });
  contents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) ev.preventDefault();
  });
});

app.whenReady().then(() => {
  // Manejador para getDisplayMedia: entrega la pantalla seleccionada y, si está
  // activado, el audio del sistema vía loopback.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const give = (video) => {
        const res = { video };
        if (systemAudio) res.audio = 'loopback'; // mantiene el sonido reproduciéndose
        callback(res);
      };
      if (selectedSource) {
        give(selectedSource);
      } else {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => give(sources[0]));
      }
    },
    { useSystemPicker: false }
  );

  createControlWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
