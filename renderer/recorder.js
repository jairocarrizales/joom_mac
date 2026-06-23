'use strict';

const screenVideo = document.getElementById('screen');
const webcamVideo = document.getElementById('webcam');
const ytVideo = document.getElementById('ytvideo');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

// YouTube en reel: video servido por el servidor local (http://127.0.0.1).
let ytUrl = '';          // URL actual cargada
let ytAudioNode = null;  // nodo de audio del video (se crea una sola vez)
function loadYt(url) {
  if (url && url !== ytUrl) {
    ytUrl = url;
    ytVideo.src = url;
    ytVideo.load();
  } else if (!url && ytUrl) {
    ytUrl = '';
    try { ytVideo.removeAttribute('src'); ytVideo.load(); } catch (_) {}
  }
}
const ytReady = () => ytUrl && ytVideo.readyState >= 2;

// Presentación (PDF / Google Slides / PowerPoint convertido) renderizada con pdf.js.
let mediaKind = 'video';   // 'video' | 'pdf'
let pdfDoc = null;
let pdfUrlLoaded = '';
let pdfPage = 1;
let pdfNumPages = 0;
let pdfReady = false;
const pdfCanvas = document.createElement('canvas');
const pdfCtx = pdfCanvas.getContext('2d');
if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.js';

async function loadPdf(url) {
  if (!url || url === pdfUrlLoaded || !window.pdfjsLib) return;
  pdfUrlLoaded = url;
  pdfReady = false;
  try {
    pdfDoc = await window.pdfjsLib.getDocument(url).promise;
    pdfNumPages = pdfDoc.numPages;
    pdfPage = 1;
    await renderPdfPage(1);
  } catch (e) { console.error('PDF load:', e); pdfDoc = null; }
}

async function renderPdfPage(n) {
  if (!pdfDoc) return;
  try {
    const page = await pdfDoc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = 1080 / base.width;       // ancho objetivo ~1080
    const vp = page.getViewport({ scale });
    pdfCanvas.width = Math.round(vp.width);
    pdfCanvas.height = Math.round(vp.height);
    pdfCtx.fillStyle = '#fff'; pdfCtx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    await page.render({ canvasContext: pdfCtx, viewport: vp }).promise;
    pdfReady = true;
  } catch (e) { console.error('PDF page:', e); }
}

// Pantalla en banda del reel (con zoom/pan en vivo para resaltar un detalle).
let screenZoom = 1;        // 1 = 100% (pantalla completa horizontal)
let screenPanX = 0.5;      // 0..1 (centro) — solo aplica con zoom > 1
let screenPanY = 0.5;
let screenOverflowX = 0, screenOverflowY = 0; // px que sobresalen (para mapear el arrastre)

// Carga el contenido del reel: video (ytVideo) o presentación (pdf.js).
function loadMedia(url, kind) {
  mediaKind = kind === 'pdf' ? 'pdf' : 'video';
  if (mediaKind === 'pdf') {
    loadYt('');             // soltar el video si lo había
    loadPdf(url);
  } else {
    pdfDoc = null; pdfReady = false; pdfUrlLoaded = '';
    loadYt(url);
  }
}

let screenStream = null;
let webcamStream = null;
let micStream = null;
let audioCtx = null;   // mezcla de micrófono + audio del sistema + efectos
let sfxDest = null;    // destino para mezclar efectos (obturador) en la grabación
let mediaRecorder = null;
let drawInt = null;
let webcamRect = null; // { fx, fy, fw, fh } en fracciones del display
let shape = 'circle';  // 'circle' | 'vertical' | 'none'
let border = true;     // ¿dibujar borde blanco alrededor de la cámara?

let mode = 'normal';   // 'normal' | 'reel'
let bandPos = 'bottom';
let bandHeightFrac = 0.30;
let cropRect = { fx: 0.15, fy: 0.1, fw: 0.7, fh: 0.8 };
let webcamZoom = 1;    // zoom de la webcam (recorte central uniforme)
let fullCam = false;   // webcam a pantalla completa (alternable en vivo)
let fullCamT = 0;      // progreso (0 = pantalla, 1 = cámara)
let reelHeadline = { text: '', text2: '', fg: '#ffffff', bg: '#000000', animate: false }; // banner central en modo reel
let reelHeadlineOffset = 0; // 0..0.60 distancia del banner a la cámara
let reelHeadlinePos = 'camera'; // 'camera' | 'top' | 'bottom'
let bubbleSizeFrac = 0;          // 0 = auto, >0 = ancho de la burbuja como % del canvas en reel+bubble
let bubbleLocked = false;        // si true, usar bubbleLockedRect (en fracciones de canvas)
let bubbleLockedRect = null;     // {fx, fy, fw, fh} congelados
let transition = 'scale'; // 'scale' | 'circle' | 'slide'
let fcStart = -1, fcFrom = 0, fcTarget = 0;
const FC_DUR = 480;    // ms de la transición

// Banner de nombre (lower-third)
let bannerName = '';
let bannerSub = '';
let bannerSub2 = '';
let bannerLoops = 0;        // 0 = infinito; si >0, número de "pares" antes de fijar la última frase
let bannerColor = '#6c5ce7';
let bannerShow = false;
let bannerT = 0;
let bannerAnimStart = 0;    // cuándo empezó la animación de la línea alterna

// Calidad
let fps = 30;
let maxW = 1920;
let vbps = 5_000_000;

// Fondo bonito + márgenes (modo normal)
let niceBg = false;
let bgPreset = 'purple';
let padFrac = 0.08;

const BG_PRESETS = {
  purple: ['#7d6cf0', '#4834d4'],
  sunset: ['#ff9966', '#ff5e62'],
  ocean: ['#36d1dc', '#5b86e5'],
  mint: ['#11998e', '#38ef7d'],
  dark: ['#3a3d4a', '#14151a'],
};

function fillBg(c, w, h, preset) {
  const stops = BG_PRESETS[preset] || BG_PRESETS.purple;
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, stops[0]);
  g.addColorStop(1, stops[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// El panel envía la posición de la burbuja cada vez que se mueve/redimensiona.
window.loom.onWebcamRect((rect) => {
  webcamRect = rect;
});

// Trazar la silueta de la cámara según la forma (para recorte y borde).
function tracePath(x, y, w, h) {
  if (shape === 'vertical') {
    const r = Math.min(w, h) * 0.12; // esquinas redondeadas tipo móvil
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else if (shape === 'wide') {
    const r = Math.min(w, h) * 0.10; // rect horizontal con esquinas suaves
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else if (shape === 'card') {
    // Squircle / superelipse (n≈4): esquinas continuas tipo iOS/macOS (no arcos).
    const cx = x + w / 2, cy = y + h / 2, a = w / 2, b = h / 2;
    const n = 4, N = 120, p = 2 / n;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const ct = Math.cos(t), st = Math.sin(t);
      const px = cx + a * Math.sign(ct) * Math.pow(Math.abs(ct), p);
      const py = cy + b * Math.sign(st) * Math.pow(Math.abs(st), p);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'pebble') {
    // Canto rodado: curva orgánica asimétrica (Catmull-Rom -> Bézier), normalizada 0..1.
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
    // Escudo/crest: curva Bézier simétrica (hombros redondeados + punta inferior).
    const X = (u) => x + u * w, Y = (v) => y + v * h;
    ctx.beginPath();
    ctx.moveTo(X(0.10), Y(0.12));
    ctx.bezierCurveTo(X(0.30), Y(0.07), X(0.70), Y(0.07), X(0.90), Y(0.12));
    ctx.bezierCurveTo(X(0.95), Y(0.42), X(0.82), Y(0.80), X(0.50), Y(0.96));
    ctx.bezierCurveTo(X(0.18), Y(0.80), X(0.05), Y(0.42), X(0.10), Y(0.12));
    ctx.closePath();
  } else if (shape === 'shield2') {
    // Escudo 2: top plano con esquinas redondeadas, lados rectos y base curva.
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
  } else {
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
    ctx.closePath();
  }
}

// Lienzo auxiliar para la forma "difuminada" (máscara alfa radial).
const featherCanvas = document.createElement('canvas');

// Dibuja la webcam recortada a la forma (cover + espejo), con borde blanco.
function drawWebcam() {
  if (shape === 'none' || !webcamRect || webcamVideo.readyState < 2) return;
  const cw = canvas.width;
  const ch = canvas.height;
  // En área (o reel+burbuja), la burbuja (en coords de pantalla) se remapea al recuadro.
  let fx = webcamRect.fx, fy = webcamRect.fy, fw = webcamRect.fw, fh = webcamRect.fh;
  if (mode === 'reel' && bandPos === 'bubble' && bubbleLocked && bubbleLockedRect) {
    // Posición congelada en el canvas: ignora cambios de cropRect y de la ventana
    fx = bubbleLockedRect.fx;
    fy = bubbleLockedRect.fy;
    fw = bubbleLockedRect.fw;
    fh = bubbleLockedRect.fh;
  } else if (mode === 'area' || (mode === 'reel' && bandPos === 'bubble')) {
    fx = (webcamRect.fx - cropRect.fx) / cropRect.fw;
    fy = (webcamRect.fy - cropRect.fy) / cropRect.fh;
    fw = webcamRect.fw / cropRect.fw;
    fh = webcamRect.fh / cropRect.fh;
  }
  let x = fx * cw;
  let y = fy * ch;
  let w = fw * cw;
  let h = fh * ch;
  // En reel+burbuja, si el usuario forzó un tamaño, lo aplicamos manteniendo el centro
  // y respetando el aspecto de la forma actual.
  if (mode === 'reel' && bandPos === 'bubble' && bubbleSizeFrac > 0) {
    const cx = x + w / 2, cy = y + h / 2;
    const newW = Math.round(cw * bubbleSizeFrac);
    const aspectH = shape === 'vertical' ? (16 / 9) : (shape === 'wide' ? (9 / 16) : (shape === 'shield' ? 1.12 : (shape === 'shield2' ? 1.35 : 1)));
    const newH = Math.round(newW * aspectH);
    x = cx - newW / 2;
    y = cy - newH / 2;
    w = newW;
    h = newH;
  }

  const vw = webcamVideo.videoWidth;
  const vh = webcamVideo.videoHeight;
  const scale = Math.max(w / vw, h / vh) * webcamZoom; // zoom de cámara
  const dw = vw * scale;
  const dh = vh * scale;
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Círculo difuminado (niebla): el borde se desvanece con una máscara alfa
  // radial, así la cámara se funde con el fondo en vez de verse "pegada".
  if (shape === 'feather') {
    const oc = featherCanvas;
    oc.width = Math.max(2, Math.round(w));
    oc.height = Math.max(2, Math.round(h));
    const octx = oc.getContext('2d');
    octx.clearRect(0, 0, oc.width, oc.height);
    octx.save();
    octx.translate(oc.width / 2, oc.height / 2);
    octx.scale(-1, 1);
    octx.drawImage(webcamVideo, -dw / 2, -dh / 2, dw, dh);
    octx.restore();
    octx.globalCompositeOperation = 'destination-in';
    const rad = Math.min(oc.width, oc.height) / 2;
    const g = octx.createRadialGradient(oc.width / 2, oc.height / 2, rad * 0.62, oc.width / 2, oc.height / 2, rad);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g;
    octx.fillRect(0, 0, oc.width, oc.height);
    octx.globalCompositeOperation = 'source-over';
    ctx.drawImage(oc, x, y);
    return;
  }

  ctx.save();
  tracePath(x, y, w, h);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.scale(-1, 1); // espejo horizontal (como en la vista previa)
  ctx.drawImage(webcamVideo, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // Borde blanco (opcional)
  if (border) {
    ctx.save();
    tracePath(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.02);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
    ctx.restore();
  }
}

// Capa de pantalla (según el modo): área recortada, fondo bonito o pantalla.
function drawScreenLayer() {
  if (screenVideo.readyState < 2) return;
  const W = canvas.width, H = canvas.height;
  if (mode === 'area') {
    const VW = screenVideo.videoWidth, VH = screenVideo.videoHeight;
    ctx.drawImage(screenVideo, cropRect.fx * VW, cropRect.fy * VH, cropRect.fw * VW, cropRect.fh * VH, 0, 0, W, H);
  } else if (niceBg) {
    fillBg(ctx, W, H, bgPreset);
    const m = Math.round(H * padFrac);
    const x = m, y = m, w = W - 2 * m, h = H - 2 * m;
    const r = Math.round(Math.min(w, h) * 0.03);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = Math.round(H * 0.03);
    ctx.shadowOffsetY = Math.round(H * 0.012);
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(screenVideo, x, y, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(screenVideo, 0, 0, W, H);
  }
}

// Webcam (cover + espejo + zoom) recortada a un rect con esquinas redondeadas.
function drawWebcamCover(x, y, w, h, radius) {
  const vw = webcamVideo.videoWidth, vh = webcamVideo.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(w / vw, h / vh) * webcamZoom;
  const dw = vw * s, dh = vh * s;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, Math.min(radius, Math.min(w, h) / 2));
  ctx.clip();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(-1, 1);
  ctx.drawImage(webcamVideo, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// Rect (en píxeles del lienzo) de la burbuja, con remapeo en modo área.
function webcamRectPx() {
  const cw = canvas.width, ch = canvas.height;
  let fx = webcamRect.fx, fy = webcamRect.fy, fw = webcamRect.fw, fh = webcamRect.fh;
  if (mode === 'area') {
    fx = (webcamRect.fx - cropRect.fx) / cropRect.fw;
    fy = (webcamRect.fy - cropRect.fy) / cropRect.fh;
    fw = webcamRect.fw / cropRect.fw;
    fh = webcamRect.fh / cropRect.fh;
  }
  return { x: fx * cw, y: fy * ch, w: fw * cw, h: fh * ch };
}

// Animación de "minimizar/maximizar": la cámara crece de la burbuja a pantalla.
function drawWebcamTransition(t) {
  const cw = canvas.width, ch = canvas.height;
  const b = webcamRectPx();
  const lerp = (a, z) => a + (z - a) * t;
  const x = lerp(b.x, 0), y = lerp(b.y, 0), w = lerp(b.w, cw), h = lerp(b.h, ch);
  const bubbleR = shape === 'vertical' ? Math.min(b.w, b.h) * 0.12 : Math.min(b.w, b.h) / 2;
  drawWebcamCover(x, y, w, h, bubbleR * (1 - t));
  if (border && t < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - t;
    roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, bubbleR * (1 - t) - 1.5));
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.02);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
    ctx.restore();
  }
}

function ease(kind, t) {
  if (kind === 'circle') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // inOutCubic
  return 1 - Math.pow(1 - t, 3); // outCubic (scale, slide)
}

// Transición "círculo (reveal)": un círculo crece desde la cámara revelándola.
function transCircle(p) {
  const W = canvas.width, H = canvas.height;
  const b = webcamRect ? webcamRectPx() : { x: W / 2, y: H / 2, w: 0, h: 0 };
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * p, 0, Math.PI * 2);
  ctx.clip();
  coverDrawMirrored(webcamVideo, 0, 0, W, H);
  ctx.restore();
}

function drawComposite() {
  // Progreso temporal con easing según la transición elegida.
  if (fcStart >= 0) {
    const raw = Math.min(1, (performance.now() - fcStart) / FC_DUR);
    fullCamT = fcFrom + (fcTarget - fcFrom) * ease(transition, raw);
    if (raw >= 1) fullCamT = fcTarget;
  }
  const p = fullCamT;

  if (p >= 1 && webcamVideo.readyState >= 2) {
    coverDrawMirrored(webcamVideo, 0, 0, canvas.width, canvas.height);
    return;
  }

  drawScreenLayer();
  if (p <= 0 || !webcamRect || webcamVideo.readyState < 2) {
    drawWebcam(); // burbuja estática
    return;
  }
  // Transición en curso
  if (transition === 'scale') drawWebcamTransition(p); // crece desde la burbuja
  else transCircle(p); // 'circle' (reveal)
}

// Banner de nombre (lower-third), encima de todo.
function drawBanner() {
  if (!bannerName) return;
  const wasZero = bannerT < 0.01;
  bannerT += ((bannerShow ? 1 : 0) - bannerT) * 0.18;
  if (bannerT < 0.01) return;
  // Al aparecer el banner, arranca el reloj de la animación alterna
  if (wasZero && bannerShow) bannerAnimStart = performance.now();

  const W = canvas.width, H = canvas.height;
  const namePx = Math.max(16, Math.round(H * 0.030));
  const subPx = Math.max(12, Math.round(H * 0.020));
  const padX = Math.round(namePx * 0.7);
  const padY = Math.round(namePx * 0.55);
  const barW = Math.round(namePx * 0.26);

  // ---- Subtítulo: cuál mostrar y estado de animación (alternancia) ----
  const hasAlt = !!(bannerSub && bannerSub2);
  let subText = bannerSub;
  let subAlpha = 1;
  let clipProgress = 1; // 0..1 para el "escribirse" (clip izq→der)
  if (hasAlt) {
    const writeMs = 800, holdMs = 2200, fadeMs = 500;
    const cycleMs = writeMs + holdMs + fadeMs;
    let elapsed = Math.max(0, performance.now() - bannerAnimStart);
    let cycleIdx = Math.floor(elapsed / cycleMs);
    let phaseT = elapsed - cycleIdx * cycleMs;
    if (bannerLoops > 0) {
      // bannerLoops = "veces que alterna" → cada vez son dos textos
      const maxCycles = bannerLoops * 2;
      if (cycleIdx >= maxCycles) {
        cycleIdx = maxCycles - 1;
        phaseT = writeMs + holdMs; // mantén la última frase nítida y sin desvanecer
      }
    }
    subText = (cycleIdx % 2 === 0) ? bannerSub : bannerSub2;
    if (phaseT < writeMs) {
      clipProgress = phaseT / writeMs; // se escribe
    } else if (phaseT < writeMs + holdMs) {
      clipProgress = 1; // visible nítido
    } else {
      clipProgress = 1;
      subAlpha = Math.max(0, 1 - (phaseT - writeMs - holdMs) / fadeMs); // se desvanece
    }
  }

  ctx.save();
  // Para medir el nombre
  ctx.font = `700 ${namePx}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const nameW = ctx.measureText(bannerName).width;
  // Para medir el sub (usar el ancho del MÁS LARGO si alterna, para que la caja no salte)
  let subW = 0;
  if (subText) {
    ctx.font = `500 ${subPx}px -apple-system, sans-serif`;
    if (hasAlt) {
      const wA = ctx.measureText(bannerSub).width;
      const wB = ctx.measureText(bannerSub2).width;
      subW = Math.max(wA, wB);
    } else {
      subW = ctx.measureText(subText).width;
    }
  }
  const textW = Math.max(nameW, subW);
  const lineGap = subText ? Math.round(subPx * 0.4) : 0;
  const textH = namePx + (subText ? subPx + lineGap : 0);
  const boxW = barW + padX + textW + padX;
  const boxH = textH + padY * 2;
  const x = Math.round(W * 0.045);
  const y = H - boxH - Math.round(H * 0.07);

  ctx.globalAlpha = bannerT;
  ctx.translate(-(1 - bannerT) * (boxW * 0.2 + 30), 0); // entra deslizando

  // Fondo
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.round(H * 0.02);
  ctx.shadowOffsetY = Math.round(H * 0.006);
  roundRectPath(ctx, x, y, boxW, boxH, Math.round(boxH * 0.16));
  ctx.fillStyle = 'rgba(18,19,24,0.85)';
  ctx.fill();
  ctx.restore();

  // Barra de acento
  roundRectPath(ctx, x + padX * 0.5, y + padY * 0.7, barW, boxH - padY * 1.4, barW / 2);
  ctx.fillStyle = bannerColor;
  ctx.fill();

  // Nombre (línea 1, estática)
  const tx = x + padX * 0.5 + barW + padX * 0.7;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${namePx}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(bannerName, tx, y + padY);

  // Subtítulo (línea 2 / alterna con línea 3)
  if (subText) {
    const sty = y + padY + namePx + lineGap;
    ctx.save();
    ctx.globalAlpha = bannerT * subAlpha;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = `500 ${subPx}px -apple-system, sans-serif`;
    if (clipProgress < 1) {
      // Máscara que crece de izquierda a derecha → efecto "escribiendo"
      const fullW = ctx.measureText(subText).width;
      ctx.beginPath();
      ctx.rect(tx, sty - subPx * 0.35, fullW * clipProgress + 2, subPx * 1.7);
      ctx.clip();
    }
    ctx.fillText(subText, tx, sty);
    ctx.restore();
  }
  ctx.restore();
}

function render() {
  if (mode === 'reel') drawReel();
  else if (mode === 'podcast') drawPodcast();
  else drawComposite();
  drawBanner();
}

// Modo podcast: lienzo 16:9 con pantalla a la izq (~75%) y webcam vertical a la der (~25%).
const PODCAST_CAM_FRAC = 0.25;
let podcastPanX = 0.5;       // 0..1: qué parte horizontal de la pantalla se ve (cover recorta los lados)
let podcastOverflowX = 0;    // px de pantalla que sobresalen del panel (para mapear el arrastre)
function drawPodcast() {
  // Respetar el atajo ⌘⇧F: si fullCam está activo, cubrir todo el lienzo con la webcam.
  if (fcStart >= 0) {
    const raw = Math.min(1, (performance.now() - fcStart) / FC_DUR);
    fullCamT = fcFrom + (fcTarget - fcFrom) * ease(transition, raw);
    if (raw >= 1) fullCamT = fcTarget;
  }
  if (fullCamT >= 1 && webcamVideo.readyState >= 2) {
    coverDrawMirrored(webcamVideo, 0, 0, canvas.width, canvas.height);
    return;
  }
  const W = canvas.width, H = canvas.height;
  const gap = niceBg ? Math.round(H * 0.04) : 0;
  const m = niceBg ? Math.round(H * 0.06) : 0;
  if (niceBg) fillBg(ctx, W, H, bgPreset);
  else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }

  const totalW = W - 2 * m - gap;
  const camW = Math.round(totalW * PODCAST_CAM_FRAC);
  const screenW = totalW - camW;
  const panelH = H - 2 * m;
  const screenX = m;
  const camX = m + screenW + gap;
  const panelY = m;
  const r = niceBg ? Math.round(Math.min(screenW, panelH) * 0.025) : 0;

  // Panel pantalla — fondo negro + contain del video, esquinas redondeadas si hay nice bg.
  ctx.save();
  if (niceBg) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = Math.round(H * 0.03);
    ctx.shadowOffsetY = Math.round(H * 0.012);
  }
  roundRectPath(ctx, screenX, panelY, screenW, panelH, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  if (screenVideo.readyState >= 2) {
    const VW = screenVideo.videoWidth, VH = screenVideo.videoHeight;
    const s = Math.max(screenW / VW, panelH / VH); // cover: llena el panel a alto completo (recorta lados)
    const dw = VW * s, dh = VH * s;
    // Lo que sobra a los lados se puede desplazar con la manito (podcastPanX).
    podcastOverflowX = Math.max(0, dw - screenW);
    const overflowY = Math.max(0, dh - panelH);
    const dx = screenX - podcastOverflowX * podcastPanX;
    const dy = panelY - overflowY * 0.5;
    ctx.save();
    roundRectPath(ctx, screenX, panelY, screenW, panelH, r);
    ctx.clip();
    ctx.drawImage(screenVideo, dx, dy, dw, dh);
    ctx.restore();
  }

  // Panel cámara vertical — cover + espejo recortando al centro de la webcam.
  ctx.save();
  if (niceBg) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = Math.round(H * 0.03);
    ctx.shadowOffsetY = Math.round(H * 0.012);
  }
  roundRectPath(ctx, camX, panelY, camW, panelH, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  if (webcamVideo.readyState >= 2) {
    drawWebcamCover(camX, panelY, camW, panelH, r);
  }
}

// Dibuja un video con object-fit: cover (+espejo) dentro de [dx,dy,dw,dh].
function coverDrawMirrored(video, dx, dy, dw, dh) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(dw / vw, dh / vh) * webcamZoom; // zoom de cámara
  const w = vw * s;
  const h = vh * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.scale(-1, 1);
  ctx.drawImage(video, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Compositor del modo reel: lienzo 1080x1920 con banda de webcam + zona de pantalla.
// Layout del banner: mide y rompe en líneas, devuelve dimensiones SIN dibujar.
function reelHeadlineLayout(W, H) {
  const fontSize = Math.round(H * 0.026);
  const padX = Math.round(W * 0.035);
  const padY = Math.round(fontSize * 0.6);
  const lineHeight = Math.round(fontSize * 1.18);
  const font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
  ctx.save();
  ctx.font = font;
  const maxLineW = W - padX * 2;
  const wrap = (txt) => {
    const out = [];
    for (const ul of (txt || '').split(/\r?\n/)) {
      const wds = ul.split(/\s+/).filter(Boolean);
      if (!wds.length) { out.push(''); continue; }
      let cur = '';
      for (const wd of wds) {
        const test = cur ? cur + ' ' + wd : wd;
        if (ctx.measureText(test).width > maxLineW && cur) { out.push(cur); cur = wd; }
        else cur = test;
      }
      if (cur) out.push(cur);
    }
    return out;
  };
  const lines = wrap(reelHeadline.text);
  const lines2 = (reelHeadline.animate && reelHeadline.text2) ? wrap(reelHeadline.text2) : [];
  ctx.restore();
  const maxLines = Math.max(1, lines.length, lines2.length);
  const h = padY * 2 + maxLines * lineHeight;
  return { h, lines, lines2, fontSize, padY, lineHeight, font };
}

function drawReelHeadlineStrip(W, y, layout) {
  ctx.save();
  // Fondo siempre presente
  ctx.fillStyle = reelHeadline.bg || '#000';
  ctx.fillRect(0, y, W, layout.h);

  // Elegir texto activo + estado de animación
  let activeLines = layout.lines;
  let alpha = 1;
  let clipProgress = 1;
  // Si "animar" está activo y hay al menos el texto 1, animamos.
  //   - con texto 2: alterna entre ambos (2 sub-ciclos)
  //   - sin texto 2: el mismo texto se re-escribe en bucle (1 sub-ciclo)
  const isAnimating = !!(reelHeadline.animate && reelHeadline.text);
  const hasAlt = isAnimating && !!reelHeadline.text2;
  if (isAnimating) {
    const writeMs = 900, holdMs = 10000, fadeMs = 600; // 10s entre uno y otro
    const cycleMs = writeMs + holdMs + fadeMs;
    const cycles = hasAlt ? 2 : 1;
    const elapsed = performance.now() % (cycleMs * cycles);
    const cycleIdx = Math.floor(elapsed / cycleMs);
    const phaseT = elapsed - cycleIdx * cycleMs;
    activeLines = (hasAlt && cycleIdx % 2 === 1) ? layout.lines2 : layout.lines;
    if (phaseT < writeMs) clipProgress = phaseT / writeMs;
    else if (phaseT < writeMs + holdMs) clipProgress = 1;
    else { clipProgress = 1; alpha = Math.max(0, 1 - (phaseT - writeMs - holdMs) / fadeMs); }
  }

  ctx.globalAlpha = alpha;
  ctx.fillStyle = reelHeadline.fg || '#fff';
  ctx.font = layout.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Si está escribiéndose, recortamos a una franja que crece de izq a der
  if (clipProgress < 1 && activeLines.length) {
    let maxLineW = 0;
    for (const l of activeLines) maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
    const halfW = maxLineW / 2;
    const xc = W / 2;
    ctx.beginPath();
    ctx.rect(xc - halfW, y, maxLineW * clipProgress + 4, layout.h);
    ctx.clip();
  }
  for (let i = 0; i < activeLines.length; i++) {
    const ty = y + layout.padY + layout.lineHeight * (i + 0.5);
    ctx.fillText(activeLines[i], Math.round(W / 2), ty);
  }
  ctx.restore();
}

function drawReel() {
  const W = canvas.width;   // 1080
  const H = canvas.height;  // 1920

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const ytMode = (bandPos === 'youtube-top' || bandPos === 'youtube-pie');
  const screenMode = (bandPos === 'screen-top' || bandPos === 'screen-pie');
  if (ytMode || screenMode) {
    const ytH = Math.round(W * 9 / 16);          // banda 16:9 a ancho completo (1080 -> 608)
    const camH = H - ytH;
    const top = (bandPos === 'youtube-top' || bandPos === 'screen-top'); // contenido arriba
    const ytY = top ? 0 : camH;
    const camY = top ? ytH : 0;
    // Cámara llena su área (cover + espejo)
    if (webcamVideo.readyState >= 2) coverDrawMirrored(webcamVideo, 0, camY, W, camH);
    // Banda de contenido
    ctx.save();
    ctx.beginPath(); ctx.rect(0, ytY, W, ytH); ctx.clip();
    ctx.fillStyle = '#000'; ctx.fillRect(0, ytY, W, ytH);
    if (screenMode) {
      // Pantalla: cover a la banda (a zoom 1 = 100% horizontal, exacto). Con zoom>1
      // magnifica y se puede desplazar (pan) para resaltar un detalle.
      if (screenVideo.readyState >= 2) {
        const vw = screenVideo.videoWidth, vh = screenVideo.videoHeight;
        const base = Math.max(W / vw, ytH / vh);
        const s = base * screenZoom;
        const dw = vw * s, dh = vh * s;
        screenOverflowX = Math.max(0, dw - W);
        screenOverflowY = Math.max(0, dh - ytH);
        const dx = 0 - screenOverflowX * screenPanX;
        const dy = ytY - screenOverflowY * screenPanY;
        try { ctx.drawImage(screenVideo, dx, dy, dw, dh); } catch (_) {}
      }
    } else {
      // Video o diapositiva: contain (sin distorsión ni espejo)
      let src = null, sw = 0, sh = 0;
      if (mediaKind === 'pdf' && pdfReady && pdfCanvas.width) { src = pdfCanvas; sw = pdfCanvas.width; sh = pdfCanvas.height; }
      else if (mediaKind === 'video' && ytReady()) { src = ytVideo; sw = ytVideo.videoWidth; sh = ytVideo.videoHeight; }
      if (src && sw && sh) {
        const s = Math.min(W / sw, ytH / sh);
        const dw = sw * s, dh = sh * s, dx = (W - dw) / 2, dy = ytY + (ytH - dh) / 2;
        try { ctx.drawImage(src, dx, dy, dw, dh); } catch (_) {}
      }
    }
    ctx.restore();
  } else {
    // 100% cámara
    if (webcamVideo.readyState >= 2) coverDrawMirrored(webcamVideo, 0, 0, W, H);
  }
}

// --- Elegir mimeType de grabación -------------------------------------------

function pickMime() {
  // Preferir H.264 (acelerado por hardware -VideoToolbox- en Mac) y evitar VP8/VP9
  // (encoder por software, pesado en CPU). Al saturar el encoder por software los
  // frames se retrasan y el video sale en CÁMARA LENTA / con la duración estirada;
  // con MP4/H.264 por hardware la grabación va en tiempo real.
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || 'video/webm';
}

// Mezcla micrófono + sistema + efectos (obturador) en una sola pista con la
// Web Audio API, así el efecto entra en la grabación.
function buildAudioTrack() {
  const micTracks = micStream ? micStream.getAudioTracks() : [];
  const sysTracks = screenStream ? screenStream.getAudioTracks() : [];
  audioCtx = new AudioContext();
  if (audioCtx.resume) audioCtx.resume().catch(() => {});
  sfxDest = audioCtx.createMediaStreamDestination();
  if (micTracks.length) audioCtx.createMediaStreamSource(new MediaStream(micTracks)).connect(sfxDest);
  if (sysTracks.length) audioCtx.createMediaStreamSource(new MediaStream(sysTracks)).connect(sfxDest);
  // Audio del video de YouTube (reel): tomamos su pista vía captureStream (no
  // reenruta la salida del elemento, así que también se oye por los altavoces)
  // y la mezclamos dentro de la grabación.
  if (mode === 'reel' && mediaKind === 'video' && (bandPos === 'youtube-top' || bandPos === 'youtube-pie') && ytUrl && ytVideo.captureStream) {
    try {
      const ytAudio = ytVideo.captureStream().getAudioTracks();
      if (ytAudio.length) audioCtx.createMediaStreamSource(new MediaStream(ytAudio)).connect(sfxDest);
    } catch (_) {}
  }
  return sfxDest.stream.getAudioTracks()[0];
}

// Sonido de obturador de cámara (réflex: dos clics) -> altavoces + grabación.
function playShutter() {
  if (!audioCtx) return;
  if (audioCtx.resume) audioCtx.resume().catch(() => {});
  const click = (start, gainVal) => {
    const dur = 0.045;
    const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const k = 1 - i / d.length; d[i] = (Math.random() * 2 - 1) * k * k; }
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 0.9;
    const g = audioCtx.createGain(); g.gain.value = gainVal;
    src.connect(bp); bp.connect(g);
    g.connect(audioCtx.destination);   // monitor en altavoces
    if (sfxDest) g.connect(sfxDest);   // dentro de la grabación
    src.start(start);
  };
  const t0 = audioCtx.currentTime + 0.01;
  click(t0, 0.5);          // apertura
  click(t0 + 0.07, 0.4);   // cierre
}

// --- Captura / preview / grabación -------------------------------------------

let previewing = false;

function applyReelSettings(settings) {
  shape = settings.shape || 'circle';
  border = settings.border !== false;
  mode = (settings.mode === 'reel' || settings.mode === 'area' || settings.mode === 'podcast') ? settings.mode : 'normal';
  if (settings.bandPos) bandPos = settings.bandPos;
  if (typeof settings.bandHeightFrac === 'number') bandHeightFrac = settings.bandHeightFrac;
  if (settings.reelHeadline && typeof settings.reelHeadline === 'object') reelHeadline = settings.reelHeadline;
  if (typeof settings.reelHeadlineOffset === 'number') reelHeadlineOffset = settings.reelHeadlineOffset;
  if (typeof settings.reelHeadlinePos === 'string') reelHeadlinePos = settings.reelHeadlinePos;
  if (typeof settings.bubbleSizeFrac === 'number') bubbleSizeFrac = settings.bubbleSizeFrac;
  if (typeof settings.bubbleLocked === 'boolean') bubbleLocked = settings.bubbleLocked;
  if (settings.bubbleLockedRect !== undefined) bubbleLockedRect = settings.bubbleLockedRect;
  if (settings.cropRect) cropRect = settings.cropRect;
  if (typeof settings.zoom === 'number') webcamZoom = settings.zoom;
  if (typeof settings.ytUrl === 'string') loadMedia(settings.ytUrl, settings.mediaKind);
  niceBg = settings.niceBg === true && (mode === 'normal' || mode === 'podcast');
  if (settings.bgPreset) bgPreset = settings.bgPreset;
  if (typeof settings.padFrac === 'number') padFrac = settings.padFrac;
  if (typeof settings.fps === 'number') fps = settings.fps;
  if (typeof settings.maxW === 'number') maxW = settings.maxW;
  if (typeof settings.vbps === 'number') vbps = settings.vbps;
  fullCam = false; fullCamT = 0; fcStart = -1; // arranca en pantalla + cámara
  if (settings.transition) transition = settings.transition;
  bannerName = settings.bannerName || '';
  bannerSub = settings.bannerSub || '';
  bannerSub2 = settings.bannerSub2 || '';
  bannerLoops = Number.isFinite(settings.bannerLoops) ? settings.bannerLoops : 0;
  if (settings.bannerColor) bannerColor = settings.bannerColor;
  bannerShow = false; bannerT = 0; bannerAnimStart = 0;
}

function sizeCanvas() {
  if (mode === 'reel') { canvas.width = 1080; canvas.height = 1920; return; }
  if (mode === 'podcast') { canvas.width = 1920; canvas.height = 1080; return; }
  const VW = screenVideo.videoWidth || 1920;
  const VH = screenVideo.videoHeight || 1080;
  let cw, ch;
  if (mode === 'area') {
    // El canvas es el tamaño del recuadro elegido (en píxeles de pantalla).
    cw = cropRect.fw * VW;
    ch = cropRect.fh * VH;
  } else {
    cw = VW;
    ch = VH;
  }
  if (cw > maxW) { const s = maxW / cw; cw *= s; ch *= s; }
  cw = Math.max(2, Math.round(cw)); ch = Math.max(2, Math.round(ch));
  cw -= cw % 2; ch -= ch % 2;
  canvas.width = cw;
  canvas.height = ch;
}

async function getScreen(wantSystemAudio) {
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: wantSystemAudio });
  } catch (e) {
    if (!wantSystemAudio) throw e;
    console.error('[audio] sin audio del sistema:', e);
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  }
}

// Captura pantalla + webcam (sin micrófono) e inicia el bucle de dibujo.
// Idempotente: reutiliza lo ya capturado (p. ej. la vista previa).
async function setupCapture(settings) {
  if (!screenStream) {
    screenStream = await getScreen(settings.systemAudio === true);
    screenVideo.srcObject = screenStream;
  }
  if ((mode === 'reel' || mode === 'podcast' || shape !== 'none') && !webcamStream) {
    const res = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: settings.cameraId ? { deviceId: { exact: settings.cameraId }, ...res } : res,
      audio: false,
    });
    webcamVideo.srcObject = webcamStream;
  }
  const plays = [screenVideo.play().catch(() => {})];
  if (webcamStream) plays.push(webcamVideo.play().catch(() => {}));
  await Promise.all(plays);
  await new Promise((res) => {
    if (screenVideo.videoWidth) return res();
    screenVideo.onloadedmetadata = () => res();
  });
  sizeCanvas();
  if (drawInt) clearInterval(drawInt);
  drawInt = setInterval(render, 1000 / fps);
}

function errMsg(err) {
  return /denied|not allowed|Permission/i.test(String(err))
    ? 'Permiso de grabación de pantalla/cámara denegado. Habilítalo en Ajustes del sistema → Privacidad y reinicia la app.'
    : 'Error: ' + err;
}

// Vista previa del reel: captura y compone, sin grabar.
async function startPreview(settings) {
  try {
    applyReelSettings(settings);
    await setupCapture(settings);
    previewing = true;
  } catch (err) {
    window.loom.recError(errMsg(err));
  }
}

async function begin(settings) {
  try {
    applyReelSettings(settings);
    await setupCapture(settings); // reutiliza la captura del preview si existe

    // Si se quiere audio del sistema pero el preview capturó la pantalla sin
    // audio, re-capturar la pantalla con loopback.
    if (settings.systemAudio === true && screenStream && screenStream.getAudioTracks().length === 0) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = await getScreen(true);
      screenVideo.srcObject = screenStream;
      await screenVideo.play().catch(() => {});
    }

    if (settings.micId && !micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: settings.micId }, echoCancellation: true },
        video: false,
      });
    }

    // Reel + video: arrancar desde el inicio al empezar a grabar (las diapositivas
    // son estáticas, no necesitan reproducción).
    if (mode === 'reel' && mediaKind === 'video' && (bandPos === 'youtube-top' || bandPos === 'youtube-pie') && ytUrl) {
      try { ytVideo.currentTime = 0; } catch (_) {}
      ytVideo.play().catch(() => {});
    }

    const canvasStream = canvas.captureStream(fps);
    const combined = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => combined.addTrack(t));
    const audioTrack = buildAudioTrack();
    if (audioTrack) combined.addTrack(audioTrack);

    const mime = pickMime();
    await window.loom.recStart(mime);

    mediaRecorder = new MediaRecorder(combined, {
      mimeType: mime,
      videoBitsPerSecond: vbps,
      audioBitsPerSecond: 128_000,
    });

    const pendingWrites = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        pendingWrites.push(e.data.arrayBuffer().then((ab) => window.loom.recChunk(new Uint8Array(ab))));
      }
    };
    mediaRecorder.onstop = async () => {
      await Promise.allSettled(pendingWrites);
      stopRecordingStreams();
      await window.loom.recStop();
    };
    mediaRecorder.start(1000);
  } catch (err) {
    cleanupStreams();
    window.loom.recError(errMsg(err));
  }
}

// Tras detener: parar micrófono y mezclador; mantener vivo el preview si lo hay.
function stopRecordingStreams() {
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; sfxDest = null; }
  try { ytVideo.pause(); } catch (_) {}
  mediaRecorder = null;
  if (!previewing) cleanupStreams();
}

function cleanupStreams() {
  if (drawInt) { clearInterval(drawInt); drawInt = null; }
  [screenStream, webcamStream, micStream].forEach((s) => {
    if (s) s.getTracks().forEach((t) => t.stop());
  });
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; sfxDest = null; }
  screenStream = webcamStream = micStream = null;
  previewing = false;
}

// --- Eventos de control ------------------------------------------------------

window.loom.onBeginRecording((settings) => begin(settings));
window.loom.onPause(() => { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause(); });
window.loom.onResume(() => { if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume(); });
window.loom.onStop(() => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); });
window.loom.onStartPreview((settings) => startPreview(settings));
window.loom.onStopPreview(() => cleanupStreams());
window.loom.onReelParams((p) => {
  if (p.bandPos) bandPos = p.bandPos;
  if (typeof p.bandHeightFrac === 'number') bandHeightFrac = p.bandHeightFrac;
  if (p.cropRect) cropRect = p.cropRect;
  if (typeof p.zoom === 'number') webcamZoom = p.zoom;
  if (p.reelHeadline && typeof p.reelHeadline === 'object') reelHeadline = p.reelHeadline;
  if (typeof p.reelHeadlineOffset === 'number') reelHeadlineOffset = p.reelHeadlineOffset;
  if (typeof p.reelHeadlinePos === 'string') reelHeadlinePos = p.reelHeadlinePos;
  if (typeof p.bubbleSizeFrac === 'number') bubbleSizeFrac = p.bubbleSizeFrac;
  if (typeof p.shape === 'string') shape = p.shape;
  if (typeof p.border === 'boolean') border = p.border;
  if (typeof p.bubbleLocked === 'boolean') bubbleLocked = p.bubbleLocked;
  if (p.bubbleLockedRect !== undefined) bubbleLockedRect = p.bubbleLockedRect;
  if (typeof p.ytUrl === 'string') loadMedia(p.ytUrl, p.mediaKind || mediaKind);
});

// Pausar/reanudar el video (desde la barra durante la grabación).
window.loom.onYtToggleCmd((playing) => {
  if (playing) ytVideo.play().catch(() => {});
  else ytVideo.pause();
});

// Regresar/avanzar el video N segundos.
window.loom.onYtSeekCmd((delta) => {
  try {
    const dur = isFinite(ytVideo.duration) ? ytVideo.duration : Infinity;
    ytVideo.currentTime = Math.max(0, Math.min(dur, (ytVideo.currentTime || 0) + (Number(delta) || 0)));
  } catch (_) {}
});

// Diapositiva anterior/siguiente (presentación).
window.loom.onSlideNavCmd((dir) => {
  if (mediaKind !== 'pdf' || !pdfNumPages) return;
  const n = Math.max(1, Math.min(pdfNumPages, pdfPage + (dir === 'next' ? 1 : -1)));
  if (n !== pdfPage) { pdfPage = n; renderPdfPage(n); }
});

// Zoom de la pantalla en banda (desde la barra: + / -).
window.loom.onScreenZoomCmd((delta) => {
  screenZoom = Math.max(1, Math.min(5, screenZoom * (delta > 0 ? 1.25 : 0.8)));
  if (screenZoom === 1) { screenPanX = 0.5; screenPanY = 0.5; }
});

// --- Ajuste de la zona desde la vista previa (arrastrar + zoom) ---------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Escala con la que el canvas 1080x1920 se muestra en la ventana (object-fit: contain).
function previewScale() {
  return Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
}

let cropPending = null;
function pushCrop() {
  if (cropPending) return;
  cropPending = requestAnimationFrame(() => {
    cropPending = null;
    window.loom.cropUpdate({ ...cropRect });
  });
}

let panning = null;
window.addEventListener('mousedown', (e) => {
  if (mode !== 'reel' && mode !== 'podcast') return;
  panning = { x: e.clientX, y: e.clientY };
  document.body.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  if (mode === 'podcast') {
    // Arrastrar la pantalla horizontalmente para ver las zonas recortadas.
    const sc = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    const cdx = (e.clientX - panning.x) / sc; // px de canvas
    panning = { x: e.clientX, y: e.clientY };
    if (podcastOverflowX > 0) {
      podcastPanX = clamp(podcastPanX - cdx / podcastOverflowX, 0, 1);
    }
    return;
  }
  if (mode !== 'reel') return;
  // Reel con pantalla en banda: arrastrar mueve la vista cuando hay zoom (>1).
  if (bandPos === 'screen-top' || bandPos === 'screen-pie') {
    const sc = previewScale() || 1;
    const cdx = (e.clientX - panning.x) / sc;
    const cdy = (e.clientY - panning.y) / sc;
    panning = { x: e.clientX, y: e.clientY };
    if (screenOverflowX > 0) screenPanX = clamp(screenPanX - cdx / screenOverflowX, 0, 1);
    if (screenOverflowY > 0) screenPanY = clamp(screenPanY - cdy / screenOverflowY, 0, 1);
  }
});
window.addEventListener('mouseup', () => {
  if (panning) { panning = null; document.body.style.cursor = 'grab'; }
});

// Rueda del ratón sobre la previa = zoom de la pantalla en banda (reel).
window.addEventListener('wheel', (e) => {
  if (mode !== 'reel' || !(bandPos === 'screen-top' || bandPos === 'screen-pie')) return;
  e.preventDefault();
  screenZoom = clamp(screenZoom * (e.deltaY < 0 ? 1.12 : 0.89), 1, 5);
  if (screenZoom === 1) { screenPanX = 0.5; screenPanY = 0.5; }
}, { passive: false });
