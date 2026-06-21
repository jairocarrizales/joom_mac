'use strict';

const textEl = document.getElementById('text');
const playBtn = document.getElementById('play');
const spdEl = document.getElementById('spd');

let playing = false;
let speed = 40;      // píxeles por segundo (independiente del monitor)
let pos = 0;         // acumulador decimal (scrollTop redondea, por eso lo guardamos aparte)
let last = 0;
let raf = null;

function loop(t) {
  if (!playing) return;
  if (last) {
    pos += (speed * (t - last)) / 1000;
    textEl.scrollTop = pos;
  }
  last = t;
  if (textEl.scrollTop + textEl.clientHeight >= textEl.scrollHeight - 1) {
    setPlaying(false); // llegó al final
    return;
  }
  raf = requestAnimationFrame(loop);
}

function setPlaying(p) {
  playing = p;
  playBtn.textContent = p ? '⏸' : '▶';
  if (p) {
    pos = textEl.scrollTop; // continuar desde donde está
    last = 0;
    raf = requestAnimationFrame(loop);
  } else if (raf) {
    cancelAnimationFrame(raf);
    raf = null;
  }
}

function setSpeed(v) {
  speed = Math.max(10, Math.min(300, v));
  spdEl.textContent = 'vel ' + speed;
}

playBtn.addEventListener('click', () => setPlaying(!playing));
document.getElementById('slower').addEventListener('click', () => setSpeed(speed - 10));
document.getElementById('faster').addEventListener('click', () => setSpeed(speed + 10));

let fontSize = 30;
function setFont(px) {
  fontSize = Math.max(16, Math.min(80, px));
  textEl.style.fontSize = fontSize + 'px';
}
document.getElementById('smaller').addEventListener('click', () => setFont(fontSize - 2));
document.getElementById('bigger').addEventListener('click', () => setFont(fontSize + 2));

document.getElementById('reset').addEventListener('click', () => { textEl.scrollTop = 0; pos = 0; });
document.getElementById('tpclose').addEventListener('click', () => window.loom.teleprompterToggle(false));

setSpeed(speed);
setFont(fontSize);
