// Generador de subtitulos .ass (20 estilos). Extraido de la version anterior (loom).
'use strict';

function assTime(t) {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assHeader(w, h, styleLine) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

function assEsc(t) {
  return String(t).replace(/[{}\\]/g, '').replace(/\n/g, ' ').trim();
}

function extractWords(segs) {
  const words = [];
  for (const s of segs) {
    if (s.words && s.words.length) {
      for (const wd of s.words) { const t = (wd.word || '').trim(); if (t) words.push({ s: wd.start, e: wd.end, t }); }
    } else {
      const t = (s.text || '').trim(); if (t) words.push({ s: s.start, e: s.end, t });
    }
  }
  return words;
}

// Genera el .ass según el estilo. El tamaño de fuente se basa en la dimensión
// MENOR (así encaja igual en horizontal y en vertical).
function buildAss(json, style, size) {
  const { w, h } = size;
  const segs = json.segments || [];
  const base = Math.min(w, h);
  const mLR = Math.round(w * 0.06);
  const HL = '&H0000E5FF';   // amarillo (palabra resaltada)
  const WHITE = '&H00FFFFFF';
  const OUT = '&H00101010';
  const SH = '&H64000000';
  const BOX = '&H00F05B5B';  // caja (azul/morado)
  const JELLY = ['&H00FFFFFF', '&H0000E5FF', '&H00FFFF00']; // blanco, amarillo, cian
  const mvBottom = Math.round(h * 0.10);
  let body = '';
  const words = extractWords(segs);

  // Clásico (abajo) — segmentos completos
  if (style === 'classic') {
    const fs = Math.round(base * 0.042);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,${Math.round(fs * 0.1)},1,2,${mLR},${mLR},${Math.round(h * 0.05)},1`;
    for (const s of segs) { const t = assEsc(s.text); if (t) body += `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},S,,0,0,0,,${t}\n`; }
    return assHeader(w, h, styleLine) + body;
  }

  // 🟨 Amarillo bonito: caja amarilla con texto negro, Arial Black MAYÚS (estilo viral Reels)
  // 'amarillobonito' = centro · 'amarillobonitob' = abajo
  if (style === 'amarillobonito' || style === 'amarillobonitob') {
    const fs = Math.round(base * 0.082);
    const YELLOW = '&H0000FFFF';
    const BLACK = '&H00101010';
    const pad = Math.round(fs * 0.18);
    // BorderStyle 3: el Outline pinta la caja sólida del color del OutlineColour
    const styleLine = `Style: S,Arial Black,${fs},${BLACK},${BLACK},${YELLOW},${YELLOW},0,0,0,0,100,100,0,0,3,${pad},0,5,${mLR},${mLR},0,1`;
    const x = Math.round(w / 2);
    const y = Math.round(h * (style === 'amarillobonitob' ? 0.80 : 0.55));
    const N = 3;
    for (let i = 0; i < words.length; i += N) {
      const g = words.slice(i, i + N);
      const start = g[0].s;
      const end = (i + N < words.length) ? words[i + N].s : g[g.length - 1].e + 0.3;
      const t = assEsc(g.map((x2) => x2.t).join(' ')).toUpperCase();
      // pequeño pop de entrada
      body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\an5\\pos(${x},${y})\\fad(80,100)\\fscx88\\fscy88\\t(0,140,\\fscx100\\fscy100)}${t}\n`;
    }
    return assHeader(w, h, styleLine) + body;
  }

  // Centrado: 2 palabras a la vez, blanco con stroke suave
  if (style === 'centered') {
    const fs = Math.round(base * 0.055);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},&H00000000,${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.07)},0,5,${mLR},${mLR},0,1`;
    for (let i = 0; i < words.length; i += 2) {
      const g = words.slice(i, i + 2);
      const t = assEsc(g.map((x) => x.t).join(' '));
      body += `Dialogue: 0,${assTime(g[0].s)},${assTime(g[g.length - 1].e)},S,,0,0,0,,{\\fad(70,70)}${t}\n`;
    }
    return assHeader(w, h, styleLine) + body;
  }

  // Una palabra (centro / abajo), enorme, con POP
  if (style === 'word' || style === 'wordbottom') {
    const fs = Math.round(base * 0.085);
    const align = style === 'wordbottom' ? 2 : 5;
    const mv = style === 'wordbottom' ? mvBottom : 0;
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.1)},2,${align},${mLR},${mLR},${mv},1`;
    for (const wd of words) {
      const t = assEsc(wd.t).toUpperCase();
      body += `Dialogue: 0,${assTime(wd.s)},${assTime(wd.e)},S,,0,0,0,,{\\fad(50,40)\\fscx55\\fscy55\\t(0,110,\\fscx100\\fscy100)}${t}\n`;
    }
    return assHeader(w, h, styleLine) + body;
  }

  // Palabra con caja de color detrás (BorderStyle 3), abajo
  if (style === 'box') {
    const fs = Math.round(base * 0.065);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${BOX},&H00000000,1,0,0,0,100,100,0,0,3,${Math.round(fs * 0.28)},0,2,${mLR},${mLR},${mvBottom},1`;
    for (const wd of words) {
      const t = assEsc(wd.t).toUpperCase();
      body += `Dialogue: 0,${assTime(wd.s)},${assTime(wd.e)},S,,0,0,0,,{\\fad(40,30)}${t}\n`;
    }
    return assHeader(w, h, styleLine) + body;
  }

  // Gomita (elástico): palabra por palabra con rebote + cambio de color, abajo
  if (style === 'jelly') {
    const fs = Math.round(base * 0.075);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.12)},2,2,${mLR},${mLR},${mvBottom},1`;
    words.forEach((wd, i) => {
      const t = assEsc(wd.t).toUpperCase();
      const c = JELLY[i % JELLY.length];
      body += `Dialogue: 0,${assTime(wd.s)},${assTime(wd.e)},S,,0,0,0,,{\\c${c}\\fad(30,30)\\fscx35\\fscy35\\t(0,90,\\fscx115\\fscy115)\\t(90,170,\\fscx100\\fscy100)}${t}\n`;
    });
    return assHeader(w, h, styleLine) + body;
  }

  // 💭 Pensando (disruptivo): arriba, letras blancas en cursiva, difuso y flotando
  if (style === 'magic') {
    const fs = Math.round(base * 0.058); // un poco más grande
    // Italic=1, Alignment 8 (arriba-centro), borde y sombra suaves
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},0,1,0,0,100,100,0,0,1,${Math.round(fs * 0.07)},1,8,${mLR},${mLR},${Math.round(h * 0.07)},1`;
    const x = Math.round(w / 2);
    const yTop = Math.round(h * 0.05);    // posición final (parte alta de la banda)
    const yStart = Math.round(h * 0.20);  // arranca dentro de la banda superior y sube poco
    const N = 3;
    for (let i = 0; i < words.length; i += N) {
      const g = words.slice(i, i + N);
      const start = g[0].s, end = g[g.length - 1].e;
      const dur = Math.max(300, Math.round((end - start) * 1000));
      const blurEnd = Math.round(dur * 0.8); // desenfoque durante el 80% del ascenso
      // cada palabra hace un "pop" de goma (jelly) justo cuando se pronuncia
      const t = g.map((wd) => {
        const o = Math.max(0, Math.round((wd.s - start) * 1000));
        return `{\\fscx100\\fscy100\\t(${o},${o + 80},\\fscx126\\fscy126)\\t(${o + 80},${o + 170},\\fscx92\\fscy92)\\t(${o + 170},${o + 300},\\fscx100\\fscy100)}${assEsc(wd.t)}`;
      }).join(' ');
      // sube dentro de la banda superior con desenfoque de movimiento que se aclara = pensamiento
      body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\an8\\fad(180,200)\\blur5\\move(${x},${yStart},${x},${yTop},0,${dur})\\t(0,${blurEnd},\\blur0.3)}${t}\n`;
    }
    return assHeader(w, h, styleLine) + body;
  }

  // ✍️ Manuscrita: fuente cursiva (letras corridas) que se "escribe" de izquierda a derecha
  // 'hand' = Segoe Script (caligráfica) · 'handb' = Segoe Print (legible, mayúsculas normales)
  if (style === 'hand' || style === 'handb') {
    const cursive = style === 'handb' ? 'Segoe Print' : 'Segoe Script';
    const fs = Math.round(base * (style === 'handb' ? 0.072 : 0.078));
    const styleLine = `Style: S,${cursive},${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.05)},2,2,${mLR},${mLR},${mvBottom},1`;
    const N = 3; // pocas palabras por línea para que quepa en una sola y se revele limpio
    for (let i = 0; i < words.length; i += N) {
      const g = words.slice(i, i + N);
      const start = g[0].s, end = g[g.length - 1].e;
      const t = assEsc(g.map((x2) => x2.t).join(' '));
      const dur = Math.max(400, Math.round((end - start) * 1000));
      const rev = Math.round(dur * 0.85); // se termina de "escribir" antes de salir
      // máscara que crece de izquierda a derecha = se va escribiendo a mano
      body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\fad(120,150)\\clip(0,0,0,${h})\\t(0,${rev},\\clip(0,0,${w},${h}))}${t}\n`;
    }
    return assHeader(w, h, styleLine) + body;
  }

  // ✍️ Manuscrita 2 líneas: 1ª cursiva (se escribe), 2ª normal debajo; palabra hablada en verde
  // 'hand2' = Segoe Script · 'hand2b' = Segoe Print (legible, mayúsculas normales)
  if (style === 'hand2' || style === 'hand2b') {
    const cursive = style === 'hand2b' ? 'Segoe Print' : 'Segoe Script';
    const cursiveK = style === 'hand2b' ? 1.13 : 1.12; // factor de tamaño de la cursiva (Bradley más grande)
    const fs = Math.round(base * 0.066);
    const HLG = '&H0044E644'; // verde vivo (BGR)
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.06)},2,2,${mLR},${mLR},${mvBottom},1`;
    const x = Math.round(w / 2);
    const yL1 = Math.round(h * 0.66);
    const yL2 = yL1 + Math.round(fs * (style === 'hand2b' ? 1.38 : 1.25)); // separación según el tamaño de la cursiva
    const BN = 6, HALF = 3;
    // pinta de verde la palabra mientras se pronuncia, blanca antes y después
    // (el \c blanco estático resetea lo heredado de palabras previas; si no, se "filtra")
    const colorWord = (wd, lineStart) => {
      const o = Math.max(0, Math.round((wd.s - lineStart) * 1000));
      const oe = Math.max(o + 60, Math.round((wd.e - lineStart) * 1000));
      return `{\\c${WHITE}\\t(${o},${o + 40},\\c${HLG})\\t(${oe},${oe + 40},\\c${WHITE})}${assEsc(wd.t)}`;
    };
    for (let i = 0; i < words.length; i += BN) {
      const blk = words.slice(i, i + BN);
      const l1 = blk.slice(0, HALF);
      const l2 = blk.slice(HALF);
      const blockEnd = blk[blk.length - 1].e;
      // Línea 1 (cursiva) — aparece primero y se escribe de izquierda a derecha
      const s1 = l1[0].s, e1 = l1[l1.length - 1].e;
      const rev1 = Math.max(300, Math.round((e1 - s1) * 1000 * 0.9));
      const t1 = l1.map((wd) => colorWord(wd, s1)).join(' ');
      body += `Dialogue: 0,${assTime(s1)},${assTime(blockEnd)},S,,0,0,0,,{\\an8\\pos(${x},${yL1})\\fn${cursive}\\fs${Math.round(fs * cursiveK)}\\fad(120,150)\\clip(0,0,0,${h})\\t(0,${rev1},\\clip(0,0,${w},${h}))}${t1}\n`;
      // Línea 2 (normal) — aparece debajo después, sin quitar la primera
      if (l2.length) {
        const s2 = l2[0].s;
        const t2 = l2.map((wd) => colorWord(wd, s2)).join(' ');
        body += `Dialogue: 0,${assTime(s2)},${assTime(blockEnd)},S,,0,0,0,,{\\an8\\pos(${x},${yL2})\\fad(140,150)}${t2}\n`;
      }
    }
    return assHeader(w, h, styleLine) + body;
  }

  // 🔠 Palabra grande: 1 palabra grande arriba + 2-3 normales abajo; color + desenfoque de movimiento
  // 'bigword' = centrado · 'bigwordb' = ubicación inferior
  if (style === 'bigword' || style === 'bigwordb') {
    const nFs = Math.round(base * 0.07);    // tamaño normal (línea 2), un poco más grande
    const bFs = Math.round(base * 0.11);    // palabra grande (línea 1)
    const HLY = '&H0000E5FF';               // amarillo (palabra grande)
    const HLG = '&H0044E644';               // verde (línea normal)
    const styleLine = `Style: S,Helvetica,${nFs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(nFs * 0.07)},2,2,${mLR},${mLR},${mvBottom},1`;
    const x = Math.round(w / 2);
    const yBig = Math.round(h * (style === 'bigwordb' ? 0.70 : 0.40)); // abajo o centro
    const yNorm = yBig + Math.round(bFs * 1.0); // más pegada a la palabra grande
    const drift = Math.round(h * 0.03);
    const BN = 4; // 1 grande + hasta 3 normales
    const colorWord = (wd, lineStart, hl) => {
      const o = Math.max(0, Math.round((wd.s - lineStart) * 1000));
      const oe = Math.max(o + 60, Math.round((wd.e - lineStart) * 1000));
      return `{\\c${WHITE}\\t(${o},${o + 40},\\c${hl})\\t(${oe},${oe + 40},\\c${WHITE})}${assEsc(wd.t)}`;
    };
    for (let i = 0; i < words.length; i += BN) {
      const blk = words.slice(i, i + BN);
      const big = blk[0];
      const rest = blk.slice(1);
      const blockEnd = blk[blk.length - 1].e;
      // Línea 1: palabra grande; entra con desenfoque de movimiento que se aclara al 80%
      const sB = big.s;
      const tB = colorWord(big, sB, HLY);
      body += `Dialogue: 0,${assTime(sB)},${assTime(blockEnd)},S,,0,0,0,,{\\an8\\fs${bFs}\\fad(100,150)\\blur6\\move(${x},${yBig + drift},${x},${yBig},0,420)\\t(0,336,\\blur0.4)}${tB}\n`;
      // Línea 2: 2-3 palabras normales; se revela de izquierda a derecha (no sube desde abajo)
      if (rest.length) {
        const sN = rest[0].s, eN = rest[rest.length - 1].e;
        const rev2 = Math.max(300, Math.round((eN - sN) * 1000 * 0.85));
        const tN = rest.map((wd) => colorWord(wd, sN, HLG)).join(' ');
        body += `Dialogue: 0,${assTime(sN)},${assTime(blockEnd)},S,,0,0,0,,{\\an8\\pos(${x},${yNorm})\\fad(100,120)\\clip(0,0,0,${h})\\t(0,${rev2},\\clip(0,0,${w},${h}))}${tN}\n`;
      }
    }
    return assHeader(w, h, styleLine) + body;
  }

  // 🅱️ Bahnschrift Condensed Bold: una palabra a la vez con desenfoque de movimiento, en varios colores
  // valores: din_<color>_<c|b>  (color: white/black/yellow/orange/green/purple · c=centro, b=abajo)
  if (style === 'bebas' || style === 'bebasb' || style.startsWith('din_')) {
    const DCOL = {
      white:  '&H00FFFFFF',
      black:  '&H00000000',
      yellow: '&H0000E5FF',
      orange: '&H00008CFF',
      green:  '&H0044E644',
      purple: '&H00E75C6C',
    };
    // stroke: negro para colores claros, blanco para oscuros (negro/morado)
    const DSTROKE = {
      white: '&H00000000', black: '&H00FFFFFF',
      yellow: '&H00000000', orange: '&H00000000',
      green: '&H00000000', purple: '&H00FFFFFF',
    };
    let colorKey = 'white', pos = 'c';
    if (style === 'bebasb') pos = 'b';
    else if (style.startsWith('din_')) { const p = style.split('_'); colorKey = p[1]; pos = p[2]; }
    const fill = DCOL[colorKey] || DCOL.white;
    const strokeC = DSTROKE[colorKey] || '&H00000000';
    const shadow = colorKey === 'black' ? '&H96FFFFFF' : '&H96000000'; // sombra clara para el texto negro
    const fs = Math.round(base * 0.12);
    const strokeW = Math.max(2, Math.round(fs * 0.03)); // stroke pequeño
    // Outline 0 en el estilo: el \blur difumina el RELLENO al entrar; el stroke se anima con \bord al aclararse
    const styleLine = `Style: S,Bahnschrift Condensed,${fs},${fill},${fill},${strokeC},${shadow},1,0,0,0,100,100,0,0,1,0,4,5,${mLR},${mLR},0,1`;
    const x = Math.round(w / 2);
    const y = Math.round(h * (pos === 'b' ? 0.80 : 0.50));
    const drift = Math.round(h * 0.025);
    words.forEach((wd, i) => {
      const start = wd.s;
      const end = (i + 1 < words.length) ? words[i + 1].s : wd.e + 0.3;
      const dur = Math.max(150, Math.round((wd.e - wd.s) * 1000));
      const revBlur = Math.max(140, Math.round(dur * 0.8)); // se aclara al 80%
      const t = assEsc(wd.t);
      // entra fuera de foco (bord 0) subiendo un poco; se aclara a nítido y aparece el stroke
      body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\an5\\bord0\\fad(60,80)\\blur16\\move(${x},${y + drift},${x},${y},0,${revBlur})\\t(0,${revBlur},\\blur0.4)\\t(${revBlur},${revBlur + 120},\\bord${strokeW})}${t}\n`;
    });
    return assHeader(w, h, styleLine) + body;
  }

  // 🌀 Nunca visto (disruptivo): cada palabra entra volando y girando, con rebote
  if (style === 'wow') {
    const fs = Math.round(base * 0.08);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.12)},2,5,${mLR},${mLR},0,1`;
    const x2 = Math.round(w / 2), y2 = Math.round(h / 2);
    words.forEach((wd, i) => {
      const dir = i % 2 ? 1 : -1;
      const c = JELLY[i % JELLY.length];
      const x1 = x2 + dir * Math.round(w * 0.14);
      const y1 = y2 + Math.round(h * 0.05);
      body += `Dialogue: 0,${assTime(wd.s)},${assTime(wd.e)},S,,0,0,0,,{\\an5\\c${c}\\fad(40,40)\\move(${x1},${y1},${x2},${y2},0,170)\\frz${dir * 25}\\t(0,170,\\frz0)\\fscx45\\fscy45\\t(0,110,\\fscx116\\fscy116)\\t(110,185,\\fscx100\\fscy100)}${assEsc(wd.t).toUpperCase()}\n`;
    });
    return assHeader(w, h, styleLine) + body;
  }

  // 💥 Impacto (disruptivo): cada palabra entra GIGANTE y se asienta (slam) con leve giro, blur y colores
  // 'wow2' = centro · 'wow2b' = abajo
  if (style === 'wow2' || style === 'wow2b') {
    const fs = Math.round(base * 0.085);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.12)},2,5,${mLR},${mLR},0,1`;
    const PAL = ['&H00C83CFF', '&H00FFDC3C', '&H0000E5FF', '&H0044E644']; // magenta, cian, amarillo, lima
    const x2 = Math.round(w / 2), y2 = Math.round(h * (style === 'wow2b' ? 0.80 : 0.50));
    words.forEach((wd, i) => {
      const start = wd.s;
      const end = (i + 1 < words.length) ? words[i + 1].s : wd.e + 0.3;
      const c = PAL[i % PAL.length];
      const dir = i % 2 ? 1 : -1;
      const t = assEsc(wd.t).toUpperCase();
      // entra gigante (185), baja con leve undershoot (90) y asienta (100); giro pequeño y blur de impacto
      body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\an5\\pos(${x2},${y2})\\c${c}\\fad(0,40)\\frz${dir * 7}\\t(0,200,\\frz0)\\blur9\\t(0,130,\\blur0)\\fscx185\\fscy185\\t(0,110,\\fscx90\\fscy90)\\t(110,210,\\fscx100\\fscy100)}${t}\n`;
    });
    return assHeader(w, h, styleLine) + body;
  }

  // ⚡ Láser: cada palabra aparece y se subraya con una línea láser (roja con brillo) de izq→der
  // 'laser' = centro · 'laserb' = abajo
  if (style === 'laser' || style === 'laserb') {
    const fs = Math.round(base * 0.08);
    const styleLine = `Style: S,Helvetica,${fs},${WHITE},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.07)},2,5,${mLR},${mLR},0,1`;
    const LAS = '&H003C3CFF'; // rojo láser (BGR)
    const x = Math.round(w / 2), y = Math.round(h * (style === 'laserb' ? 0.80 : 0.50));
    const yU = y + Math.round(fs * 0.46);          // justo debajo de la palabra
    const TH = Math.max(6, Math.round(fs * 0.09)); // grosor del subrayado
    words.forEach((wd, i) => {
      const start = wd.s;
      const end = (i + 1 < words.length) ? words[i + 1].s : wd.e + 0.3;
      const t = assEsc(wd.t);
      const wl = Math.round(wd.t.length * fs * 0.54); // ancho estimado de la palabra
      const xL = Math.round(x - wl / 2);
      const dur = Math.max(150, Math.round((wd.e - wd.s) * 1000));
      const draw = Math.min(320, Math.max(120, Math.round(dur * 0.6))); // velocidad del trazo
      // palabra (capa 1, encima)
      body += `Dialogue: 1,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\an5\\pos(${x},${y})\\fad(50,0)}${t}\n`;
      // subrayado láser que se traza de izquierda a derecha (capa 0)
      body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,{\\an7\\pos(${xL},${yU})\\p1\\bord0\\shad0\\c${LAS}\\blur4\\clip(${xL},${yU},${xL},${yU + TH})\\t(0,${draw},\\clip(${xL},${yU},${xL + wl},${yU + TH}))}m 0 0 l ${wl} 0 l ${wl} ${TH} l 0 ${TH}\n`;
    });
    return assHeader(w, h, styleLine) + body;
  }

  // reel / pop / popcenter: grupos de palabras con karaoke
  const upper = style === 'pop' || style === 'popcenter';
  const center = style === 'popcenter';
  const fs = Math.round(base * 0.07);
  const align = center ? 5 : 2;
  const mv = center ? 0 : mvBottom;
  const N = 4;
  const styleLine = `Style: S,Helvetica,${fs},${HL},${WHITE},${OUT},${SH},1,0,0,0,100,100,0,0,1,${Math.round(fs * 0.13)},2,${align},${mLR},${mLR},${mv},1`;
  for (let i = 0; i < words.length; i += N) {
    const g = words.slice(i, i + N);
    const start = g[0].s, end = g[g.length - 1].e;
    let text = '';
    for (const wd of g) {
      const cs = Math.max(1, Math.round((wd.e - wd.s) * 100));
      let t = assEsc(wd.t);
      if (upper) t = t.toUpperCase();
      text += `{\\kf${cs}}${t} `;
    }
    const intro = upper
      ? '{\\fad(90,70)\\fscx70\\fscy70\\t(0,150,\\fscx100\\fscy100)}'
      : '{\\fad(90,70)}';
    body += `Dialogue: 0,${assTime(start)},${assTime(end)},S,,0,0,0,,${intro}${text.trim()}\n`;
  }
  return assHeader(w, h, styleLine) + body;
}

module.exports = { buildAss, assTime, assHeader, assEsc, extractWords };
