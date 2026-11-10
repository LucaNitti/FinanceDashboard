/* FinFlow — Avvio: navigazione, caricamento dati dal server, cambio anno, cambio sezione. */
/* ============================================================
   NAV — collega top nav tabs e bottom nav buttons
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  syncThemeTokens();
  showVersion();
  // Top nav tabs
  document.querySelectorAll('#topNav .tab').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
    if (btn.classList.contains('active')) btn.setAttribute('aria-current', 'page');
  });
  // Bottom nav buttons
  document.querySelectorAll('#bottomNav .bnav-btn').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
    if (btn.classList.contains('active')) btn.setAttribute('aria-current', 'page');
  });

  // Popup dettaglio mese: Esc chiude, clic sullo sfondo chiude
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('meseModal');
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMeseModal(); }
    if (e.key === 'ArrowLeft') stepMese(-1);
    if (e.key === 'ArrowRight') stepMese(1);
  });
  // Tema chiaro/scuro del sistema cambiato (es. al tramonto): i grafici leggono i colori
  // dalle variabili CSS solo quando vengono disegnati, quindi vanno ridisegnati.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', onColorSchemeChange);
  applyTheme();

  const modalEl = document.getElementById('meseModal');
  if (modalEl) modalEl.addEventListener('click', e => { if (e.target === modalEl) closeMeseModal(); });

  // App consultabile anche a server spento (sw.js). Il browser accetta i service worker solo
  // in contesto sicuro (HTTPS o localhost): su http://IP-del-server resta un normale sito.
  // Percorso relativo: con BASE_PATH si risolve contro <base href>, e lo scope è BASE_PATH/.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker non registrato:', e.message));
  }
});

/** Versione sotto il titolo: numero di package.json e commit, iniettati dal server in index.html. */
function showVersion() {
  const v = window.__FINFLOW_VERSIONE__;
  if (!v || !v.numero) return;
  const data = v.data ? new Date(v.data + 'T12:00:00').toLocaleDateString('it-IT') : '';
  // Il commit sta in uno span a parte: sui telefoni stretti viene nascosto (style.css)
  const html = `v${esc(v.numero)}${v.commit ? `<span class="ver-commit"> (${esc(v.commit)})</span>` : ''}`;
  const titolo = `Versione ${v.numero}${v.commit ? `, commit ${v.commit}` : ''}${data ? ` del ${data}` : ''}`;
  document.querySelectorAll('.app-version').forEach(el => { el.innerHTML = html; el.title = titolo; });
}

/* Tema: preferenza a tre posizioni (auto → chiaro → scuro) in <html data-theme-pref>,
   tema effettivo in <html data-theme>. Lo script in <head> li imposta prima del primo
   disegno; qui il pulsante e il cambio di tema del sistema (seguito solo in "auto").
   La preferenza è salvata in localStorage; "auto" = nessun valore salvato. */
const THEME_KEY = 'finflow-theme';
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_NAMES = { auto: 'automatico', light: 'chiaro', dark: 'scuro' };
let themePrefMem = null; // copia in memoria se localStorage non è disponibile

function themePref() {
  let t = themePrefMem;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
  return t === 'light' || t === 'dark' ? t : 'auto';
}
function systemTheme() { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }

function applyTheme() {
  const root = document.documentElement;
  const pref = themePref();
  const t = pref === 'auto' ? systemTheme() : pref;
  const changed = root.getAttribute('data-theme') !== t;
  root.setAttribute('data-theme', t);
  root.setAttribute('data-theme-pref', pref);
  const meta = document.getElementById('themeColor');
  if (meta) meta.setAttribute('content', t === 'light' ? cssVar('--bg', '#F2F4F7') : '#0E141C');
  const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length];
  const label = `Tema ${THEME_NAMES[pref]}${pref === 'auto' ? ` (ora ${THEME_NAMES[t]})` : ''}: passa a ${THEME_NAMES[next]}`;
  document.querySelectorAll('.theme-btn').forEach(b => { b.setAttribute('aria-label', label); b.title = label; });
  // I grafici leggono i colori dalle variabili CSS solo quando vengono disegnati: vanno rifatti
  if (changed && Object.keys(allData).length) { renderedSections.clear(); renderAll(); }
}

function toggleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(themePref()) + 1) % THEME_ORDER.length];
  themePrefMem = next === 'auto' ? null : next;
  try {
    if (next === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch (e) {}
  applyTheme();
}

function onColorSchemeChange() {
  if (themePref() === 'auto') applyTheme();
}

/* ============================================================
   INIT — carica dati dal server
   ============================================================ */
window.onload = async function() {
  setSetupMsg('Connessione al server in corso...');
  try {
    const res = await fetch(apiUrl('/api/data'));
    if (!res.ok) throw new Error(`Server risponde ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    loadFromServerResponse(json);
  } catch(e) {
    setSetupErr('Non riesco a collegarmi al server.\nDettaglio: ' + e.message + '\n\nCosa puoi fare ora:\n1) Avvia server.js\n2) Ricarica la pagina');
  }
};

function loadFromServerResponse(json) {
  allData = json.allData || {};
  bolletteData = json.bollette || [];
  saldoData = json.saldo || {};
  previsteData = json.previste || {};
  consumiData = json.consumi || [];
  controlliData = json.controlli || {};
  ricorrentiNonTrovate = json.ricorrentiNonTrovate || { anno: '', voci: [] };
  abbonamentiData = json.abbonamenti || [];
  annualiData = json.annuali || [];
  detraibiliData = json.detraibili || {};
  categorieGeneriche = (json.categorieGeneriche || []).map(c => String(c).trim().toLowerCase());
  scritturaAbilitata = !!json.importa;
  demo = !!json.demo;
  syncImportButton(scritturaAbilitata);
  config.years = Object.keys(allData).sort((a,b) => b - a);
  const ci = document.getElementById('cacheIndicator');
  if (ci) {
    const errs = json.errors || [];
    const quando = testoAggiornato(json.lastUpdate);
    // offline = risposta dal service worker (sw.js): server non raggiungibile, ultima copia salvata sul dispositivo
    const avviso = json.offline ? 'Offline' : json.stale ? 'Dati non aggiornati' : errs.length ? 'Dati parziali' : '';
    ci.textContent = demo ? 'Demo con dati inventati' : avviso ? `⚠ ${avviso}${quando ? ', ' + quando.toLowerCase() : ''}` : quando;
    ci.classList.toggle('warn', !!avviso && !demo);
    // Dettaglio degli errori di Google al passaggio del mouse
    ci.title = demo ? 'Famiglia, movimenti e importi sono inventati: nessun dato reale'
      : json.offline ? 'Server non raggiungibile: mostro la copia salvata su questo dispositivo'
      : errs.length ? 'Non aggiornati (mostro i dati in cache):\n' + errs.join('\n') : '';
  }
  // I dati sono cambiati: le sezioni già disegnate vanno rifatte quando si riaprono
  renderedSections.clear();
  showDashboard();
}

/** "Aggiornato oggi alle 00:00", "Aggiornato ieri alle 18:30", "Aggiornato il 2 novembre alle 22:22". */
function testoAggiornato(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const giorno = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((giorno(new Date()) - giorno(d)) / 86400000);
  const quando = diff === 0 ? 'oggi' : diff === 1 ? 'ieri' : 'il ' + d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  return `Aggiornato ${quando} alle ${ora}`;
}

function setSetupMsg(msg) { document.getElementById('setupMsg').textContent = msg; }
function setSetupErr(msg) {
  const el = document.getElementById('setupErr');
  el.style.display = 'block';
  el.style.whiteSpace = 'pre-line';
  el.textContent = msg;
  document.getElementById('setupMsg').style.display = 'none';
  document.querySelector('#setup .spinner').style.display = 'none';
}

async function reloadData() {
  // Tutti i pulsanti di aggiornamento (desktop e mobile): l'icona gira finché il server risponde
  const btns = document.querySelectorAll('.reload-btn');
  btns.forEach(b => { b.classList.add('is-loading'); b.disabled = true; });
  showLoading('Aggiorno i dati, attendi un momento...');
  try {
    // Nella demo statica non c'è /api/refresh: si rilegge il file dei dati
    const res = demo ? await fetch(apiUrl('/api/data'))
      : await fetch(apiUrl('/api/refresh'), { method: 'POST', headers: { 'X-FinFlow': '1' } });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    loadFromServerResponse(json);
  } catch(e) {
    console.error('Errore aggiornamento:', e);
    const ci = document.getElementById('cacheIndicator');
    if (ci) { ci.textContent = '⚠ Aggiornamento non riuscito'; ci.classList.add('warn'); ci.title = e.message; }
  }
  btns.forEach(b => { b.classList.remove('is-loading'); b.disabled = false; });
  hideLoading();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function showDashboard() {
  document.getElementById('setup').style.display = 'none';
  const dash = document.getElementById('dashboard');
  dash.style.display = 'flex';
  dash.style.flexDirection = 'column';
  rebuildYearSelect();
  renderAll();
}

function rebuildYearSelect() {
  const years = Object.keys(allData).sort((a,b) => b - a);
  config.years = years;
  ['yearSelect','yearSelectMobile'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value; sel.innerHTML = '';
    years.forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o); });
    sel.value = years.includes(prev) ? prev : years[0];
  });
  activeYear = document.getElementById('yearSelect').value || years[0];
}

function setYearControlsDisabled(disabled) {
  ['yearSelect', 'yearSelectMobile'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.disabled = disabled;
  });
}

function switchYear(y) {
  if (!y || y === activeYear || isYearSwitching) {
    ['yearSelect','yearSelectMobile'].forEach(id => { const s = document.getElementById(id); if (s && y) s.value = y; });
    return;
  }
  isYearSwitching = true;
  setYearControlsDisabled(true);
  // Il ridisegno dura pochi millisecondi: basta attenuare la pagina, niente spinner a tutto schermo
  document.body.classList.add('busy');
  activeYear = y;
  ['yearSelect','yearSelectMobile'].forEach(id => { const s = document.getElementById(id); if (s) s.value = y; });
  // Breve attesa per lasciar dipingere l'attenuazione prima del ridisegno sincrono.
  // setTimeout e non requestAnimationFrame: rAF è sospeso nelle schede in background.
  setTimeout(() => {
    try {
      selectedCats = [];
      ovMonth = -1;
      closeMeseModal();
      renderedSections.clear();
      renderAll();
    } finally {
      document.body.classList.remove('busy');
      setYearControlsDisabled(false);
      isYearSwitching = false;
    }
  }, 20);
}


/* ============================================================
   UI
   ============================================================ */
function showSection(name) {
  currentSection = name;
  document.querySelectorAll('.tabs-section').forEach(s => s.classList.remove('visible'));
  const sec = document.getElementById('sec-' + name);
  if (!sec) { currentSection = 'overview'; document.getElementById('sec-overview').classList.add('visible'); return; }
  sec.classList.add('visible');

  // Sincronizza top nav
  document.querySelectorAll('#topNav .tab').forEach(t => {
    const isActive = t.dataset.section === name;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  // Sincronizza bottom nav
  document.querySelectorAll('#bottomNav .bnav-btn').forEach(t => {
    const isActive = t.dataset.section === name;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Scroll in cima
  window.scrollTo({ top: 0, behavior: 'smooth' });

  renderSection(name, false);
}
