'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Lee la cámara pasada por additionalArguments (solo para la burbuja).
function getCameraIdArg() {
  const arg = process.argv.find((a) => a.startsWith('--camera-id='));
  return arg ? arg.replace('--camera-id=', '') : '';
}

// El puente sigue exponiéndose como `window.loom` por compatibilidad interna
// con los renderers; la app es Joom.
contextBridge.exposeInMainWorld('loom', {
  // --- Panel de control ---
  getSources: () => ipcRenderer.invoke('get-sources'),
  checkPermissions: () => ipcRenderer.invoke('check-permissions'),
  getScreenStatus: () => ipcRenderer.invoke('get-screen-status'),
  selectSource: (id) => ipcRenderer.invoke('select-source', id),
  updateCamera: (opts) => ipcRenderer.invoke('update-camera', opts),

  // Modo de grabación (normal / reel vertical / podcast) y zona de pantalla
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  setReel: (opts) => ipcRenderer.send('set-reel', opts),
  setZoom: (z) => ipcRenderer.send('set-zoom', z),
  zoneToggle: (on) => ipcRenderer.send('zone-toggle', on),
  zoneRect: (r) => ipcRenderer.send('zone-rect', r),
  onZoneConfig: (cb) => ipcRenderer.on('zone-config', (_e, c) => cb(c)),
  onZoneMark: (cb) => ipcRenderer.on('zone-mark', (_e, c) => cb(c)),
  startRecording: (settings) => ipcRenderer.invoke('start-recording', settings),
  pauseRecording: () => ipcRenderer.send('pause-recording'),
  resumeRecording: () => ipcRenderer.send('resume-recording'),
  stopRecording: () => ipcRenderer.send('stop-recording'),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (_e, pct) => cb(pct)),
  onExportDone: (cb) => ipcRenderer.on('export-done', (_e, r) => cb(r)),
  onExportBusy: (cb) => ipcRenderer.on('export-busy', () => cb()),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, a) => cb(a)),
  resizeControl: (h) => ipcRenderer.send('resize-control', h),
  revealFile: (p) => ipcRenderer.invoke('reveal-file', p),

  // --- Subtítulos (Groq) ---
  genSubs: (opts) => ipcRenderer.invoke('gen-subs', opts),
  onSubsStatus: (cb) => ipcRenderer.on('subs-status', (_e, m) => cb(m)),

  // --- Teleprompter ---
  teleprompterToggle: (on) => ipcRenderer.invoke('teleprompter-toggle', on),
  onTpState: (cb) => ipcRenderer.on('tp-state', (_e, s) => cb(s)),

  // --- Burbuja (overlay) ---
  cameraId: getCameraIdArg(),
  resizeOverlay: (size) => ipcRenderer.send('overlay-resize', size),
  onOverlayConfig: (cb) => ipcRenderer.on('overlay-config', (_e, c) => cb(c)),

  // --- Anotaciones ---
  annotToggle: (on) => ipcRenderer.invoke('annot-toggle', on),
  annotTool: (t) => ipcRenderer.send('annot-cmd', { type: 'tool', value: t }),
  annotColor: (c) => ipcRenderer.send('annot-cmd', { type: 'color', value: c }),
  annotWidth: (w) => ipcRenderer.send('annot-cmd', { type: 'width', value: w }),
  annotNumBg: (c) => ipcRenderer.send('annot-cmd', { type: 'numbg', value: c }),
  annotClearCmd: () => ipcRenderer.send('annot-cmd', { type: 'clear' }),
  annotConfetti: () => ipcRenderer.send('annot-cmd', { type: 'confetti' }),
  onAnnotConfig: (cb) => ipcRenderer.on('annot-config', (_e, c) => cb(c)),
  onAnnotClear: (cb) => ipcRenderer.on('annot-clear', () => cb()),
  onConfetti: (cb) => ipcRenderer.on('confetti', () => cb()),
  onSetActiveTool: (cb) => ipcRenderer.on('set-active-tool', (_e, t) => cb(t)),

  // --- Barra unificada de grabación (recbar) ---
  recbarResize: (w) => ipcRenderer.send('recbar-resize', w),
  onRb: (cb) => ipcRenderer.on('rb', (_e, c) => cb(c)),
  raiseCamera: () => ipcRenderer.send('raise-camera'),

  // --- Contenido en el reel (video de YouTube/PC o presentación PDF/PPT/Slides) ---
  ytDownload: (url) => ipcRenderer.invoke('yt-download', url),
  pickVideo: () => ipcRenderer.invoke('pick-video'),               // subir video de la PC
  pickPresentation: () => ipcRenderer.invoke('pick-presentation'), // subir PDF/PowerPoint
  slidesDownload: (url) => ipcRenderer.invoke('slides-download', url), // Google Slides
  onYtProgress: (cb) => ipcRenderer.on('yt-progress', (_e, m) => cb(m)),
  ytToggle: () => ipcRenderer.send('yt-toggle'),               // recbar -> main (pausa/play video)
  ytSeek: (delta) => ipcRenderer.send('yt-seek', delta),       // recbar -> main (regresar/avanzar video)
  slideNav: (dir) => ipcRenderer.send('slide-nav', dir),       // recbar -> main (anterior/siguiente diapositiva)
  screenZoom: (delta) => ipcRenderer.send('screen-zoom', delta), // recbar -> main (zoom de pantalla en banda)
  onYtToggleCmd: (cb) => ipcRenderer.on('yt-toggle-cmd', (_e, playing) => cb(playing)),
  onYtSeekCmd: (cb) => ipcRenderer.on('yt-seek-cmd', (_e, delta) => cb(delta)),
  onSlideNavCmd: (cb) => ipcRenderer.on('slide-nav-cmd', (_e, dir) => cb(dir)),
  onScreenZoomCmd: (cb) => ipcRenderer.on('screen-zoom-cmd', (_e, d) => cb(d)),
  onYtButton: (cb) => ipcRenderer.on('yt-button', (_e, c) => cb(c)),

  // --- Recorder (compositor) ---
  onBeginRecording: (cb) => ipcRenderer.on('begin-recording', (_e, s) => cb(s)),
  onStartPreview: (cb) => ipcRenderer.on('start-preview', (_e, s) => cb(s)),
  onStopPreview: (cb) => ipcRenderer.on('stop-preview', () => cb()),
  onReelParams: (cb) => ipcRenderer.on('reel-params', (_e, p) => cb(p)),
  cropUpdate: (r) => ipcRenderer.send('crop-update', r),
  onPause: (cb) => ipcRenderer.on('pause-recording', () => cb()),
  onResume: (cb) => ipcRenderer.on('resume-recording', () => cb()),
  onStop: (cb) => ipcRenderer.on('stop-recording', () => cb()),
  onWebcamRect: (cb) => ipcRenderer.on('webcam-rect', (_e, r) => cb(r)),
  recStart: (mime) => ipcRenderer.invoke('rec-start', mime),
  recChunk: (buf) => ipcRenderer.send('rec-chunk', buf),
  recStop: () => ipcRenderer.invoke('rec-stop'),
  recError: (msg) => ipcRenderer.send('rec-error', msg),
});
