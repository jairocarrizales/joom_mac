// Subtítulos (Groq). Reutiliza $ y fitWindow de control.js (scripts clásicos comparten ámbito global).

// --- Selector visual de estilos de subtítulos -------------------------------
// Cada entrada describe un estilo: id (debe coincidir con el value que espera
// el backend en buildAss), label corto, categoría para filtrar, texto de
// ejemplo y clase de preview. bg/color sobrescriben el fondo/color del
// preview para los DIN, que comparten clase pero varían en paleta.
const SUB_STYLES = [
  { id: 'pop',         label: 'POP abajo',        cat: 'pop',  text: 'HOLA',  cls: 'sp-pop',     pos: 'bottom' },
  { id: 'popcenter',   label: 'POP centro',       cat: 'pop',  text: 'HOLA',  cls: 'sp-pop',     pos: 'center' },
  { id: 'reel',        label: 'Reel resaltado',   cat: 'pop',  text: 'HOLA',  cls: 'sp-reel-box',pos: 'center' },

  { id: 'word',        label: 'Una palabra (c)',  cat: 'word', text: 'HOLA',  cls: 'sp-word',    pos: 'center' },
  { id: 'wordbottom',  label: 'Una palabra (b)',  cat: 'word', text: 'HOLA',  cls: 'sp-word',    pos: 'bottom' },
  { id: 'jelly',       label: 'Gomita',           cat: 'word', text: 'hola',  cls: 'sp-jelly',   pos: 'center' },
  { id: 'bigword',     label: 'Grande+normales (c)', cat: 'word', text: 'HOLA', cls: 'sp-bigword', html: '<strong>HOLA</strong>esto es', pos: 'center' },
  { id: 'bigwordb',    label: 'Grande+normales (b)', cat: 'word', text: 'HOLA', cls: 'sp-bigword', html: '<strong>HOLA</strong>esto es', pos: 'bottom' },

  { id: 'box',             label: 'Caja blanca',   cat: 'box', text: 'hola', cls: 'sp-box',      pos: 'center' },
  { id: 'amarillobonito',  label: 'Amarillo (c)',  cat: 'box', text: 'HOLA', cls: 'sp-amarillo', pos: 'center' },
  { id: 'amarillobonitob', label: 'Amarillo (b)',  cat: 'box', text: 'HOLA', cls: 'sp-amarillo', pos: 'bottom' },

  { id: 'magic',  label: 'Pensando',          cat: 'hand', text: 'idea',  cls: 'sp-magic',  pos: 'top' },
  { id: 'hand',   label: 'Manuscrita',        cat: 'hand', text: 'Hola',  cls: 'sp-hand',   pos: 'center' },
  { id: 'handb',  label: 'Bradley legible',   cat: 'hand', text: 'Hola',  cls: 'sp-hand-b', pos: 'center' },
  { id: 'hand2',  label: '2 líneas verde',    cat: 'hand', text: 'hola',  cls: 'sp-hand2',  pos: 'center' },
  { id: 'hand2b', label: '2 líneas Bradley',  cat: 'hand', text: 'hola',  cls: 'sp-hand2',  pos: 'center', fontFamily: 'Segoe Print, cursive' },

  { id: 'din_white_c',  label: 'DIN blanco (c)',   cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'center', bg: '#fff',   color: '#000' },
  { id: 'din_white_b',  label: 'DIN blanco (b)',   cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'bottom', bg: '#fff',   color: '#000' },
  { id: 'din_black_c',  label: 'DIN negro (c)',    cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'center', bg: '#000',   color: '#fff' },
  { id: 'din_black_b',  label: 'DIN negro (b)',    cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'bottom', bg: '#000',   color: '#fff' },
  { id: 'din_yellow_c', label: 'DIN amarillo (c)', cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'center', bg: '#ffd000',color: '#000' },
  { id: 'din_yellow_b', label: 'DIN amarillo (b)', cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'bottom', bg: '#ffd000',color: '#000' },
  { id: 'din_orange_c', label: 'DIN naranja (c)',  cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'center', bg: '#ff7f1e',color: '#fff' },
  { id: 'din_orange_b', label: 'DIN naranja (b)',  cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'bottom', bg: '#ff7f1e',color: '#fff' },
  { id: 'din_green_c',  label: 'DIN verde (c)',    cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'center', bg: '#34c759',color: '#fff' },
  { id: 'din_green_b',  label: 'DIN verde (b)',    cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'bottom', bg: '#34c759',color: '#fff' },
  { id: 'din_purple_c', label: 'DIN morado (c)',   cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'center', bg: '#6c5ce7',color: '#fff' },
  { id: 'din_purple_b', label: 'DIN morado (b)',   cat: 'din', text: 'HOLA', cls: 'sp-din', pos: 'bottom', bg: '#6c5ce7',color: '#fff' },

  { id: 'wow',    label: 'Disruptivo',  cat: 'wow', text: 'WOW!', cls: 'sp-wow',   pos: 'center' },
  { id: 'wow2',   label: 'Impacto (c)', cat: 'wow', text: 'BAM!', cls: 'sp-wow2',  pos: 'center' },
  { id: 'wow2b',  label: 'Impacto (b)', cat: 'wow', text: 'BAM!', cls: 'sp-wow2',  pos: 'bottom' },
  { id: 'laser',  label: 'Láser (c)',   cat: 'wow', text: 'HOLA', cls: 'sp-laser', pos: 'center' },
  { id: 'laserb', label: 'Láser (b)',   cat: 'wow', text: 'HOLA', cls: 'sp-laser', pos: 'bottom' },

  { id: 'centered', label: 'Centrado',  cat: 'classic', text: 'palabra',    cls: 'sp-centered', pos: 'center' },
  { id: 'classic',  label: 'Clásico',   cat: 'classic', text: 'hola mundo', cls: 'sp-classic',  pos: 'bottom' },
];
const SUB_STYLE_CATS = [
  { id: 'all',     label: 'Todos' },
  { id: 'pop',     label: 'POP / Reel' },
  { id: 'word',    label: 'Palabra' },
  { id: 'box',     label: 'Caja' },
  { id: 'hand',    label: 'Manuscrita' },
  { id: 'din',     label: 'DIN colores' },
  { id: 'wow',     label: 'Disruptivos' },
  { id: 'classic', label: 'Clásico' },
];

function buildSubStyleCards(categoryId) {
  const grid = $('subStyleGrid');
  grid.innerHTML = '';
  const current = $('subStyle').value;
  for (const st of SUB_STYLES) {
    if (categoryId !== 'all' && st.cat !== categoryId) continue;
    const card = document.createElement('div');
    card.className = 'style-card' + (st.id === current ? ' active' : '');
    card.dataset.id = st.id;
    card.title = st.label;
    const prev = document.createElement('div');
    prev.className = 'style-preview';
    const txt = document.createElement('div');
    txt.className = st.cls + ' pos-' + st.pos;
    if (st.html) txt.innerHTML = st.html; else txt.textContent = st.text;
    if (st.bg) txt.style.background = st.bg;
    if (st.color) txt.style.color = st.color;
    if (st.fontFamily) txt.style.fontFamily = st.fontFamily;
    prev.appendChild(txt);
    card.appendChild(prev);
    const name = document.createElement('div');
    name.className = 'style-name';
    name.textContent = st.label;
    card.appendChild(name);
    card.addEventListener('click', () => {
      $('subStyle').value = st.id;
      localStorage.setItem('subStyle', st.id);
      grid.querySelectorAll('.style-card').forEach((c) => c.classList.toggle('active', c.dataset.id === st.id));
    });
    grid.appendChild(card);
  }
}

function buildSubStyleCategories() {
  const cats = $('subStyleCats');
  cats.innerHTML = '';
  // Empezar en la categoría del estilo seleccionado para que el usuario lo vea
  // sin tener que cambiar de filtro al abrir el panel.
  const currentStyle = SUB_STYLES.find((s) => s.id === $('subStyle').value);
  const savedCat = localStorage.getItem('subStyleCat') || (currentStyle ? currentStyle.cat : 'all');
  for (const cat of SUB_STYLE_CATS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-cat-btn' + (cat.id === savedCat ? ' active' : '');
    btn.textContent = cat.label;
    btn.dataset.cat = cat.id;
    btn.addEventListener('click', () => {
      cats.querySelectorAll('.style-cat-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat.id));
      localStorage.setItem('subStyleCat', cat.id);
      buildSubStyleCards(cat.id);
      fitWindow();
    });
    cats.appendChild(btn);
  }
  buildSubStyleCards(savedCat);
}

// --- API key de Groq + opciones + generar -----------------------------------
$('groqKey').value = localStorage.getItem('groqKey') || '';
$('groqKey').addEventListener('input', () => localStorage.setItem('groqKey', $('groqKey').value.trim()));
$('groqKeyToggle').addEventListener('click', () => {
  const inp = $('groqKey'); inp.type = inp.type === 'password' ? 'text' : 'password';
});
$('subLang').value = localStorage.getItem('subLang') || '';
$('subLang').addEventListener('change', () => localStorage.setItem('subLang', $('subLang').value));
$('subStyle').value = localStorage.getItem('subStyle') || 'pop';
$('subPolishChk').checked = localStorage.getItem('subPolish') === '1';
$('subPolishChk').addEventListener('change', () => localStorage.setItem('subPolish', $('subPolishChk').checked ? '1' : '0'));

buildSubStyleCategories();

const subBtn = $('subBtn');
const subStatusEl = $('subStatus');
window.loom.onSubsStatus((m) => { subStatusEl.textContent = m; fitWindow(); });
subBtn.addEventListener('click', async () => {
  const apiKey = $('groqKey').value.trim();
  if (!apiKey) { subStatusEl.textContent = 'Pon tu API key de Groq arriba.'; return; }
  subBtn.disabled = true;
  subStatusEl.textContent = 'Selecciona el video…';
  fitWindow();
  const r = await window.loom.genSubs({
    apiKey,
    lang: $('subLang').value,
    style: $('subStyle').value,
    polish: $('subPolishChk').checked,
  });
  subBtn.disabled = false;
  subStatusEl.textContent = r.ok ? ('✓ Listo: ' + r.filePath) : ('✗ ' + r.error);
  fitWindow();
});
