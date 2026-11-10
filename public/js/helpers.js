/* FinFlow — Helper condivisi: formattazione, grafici, aggregazioni, carta di credito, spese previste, saldo. */
/* ============================================================
   HELPERS
   ============================================================ */
function renderAll() {
  const d = allData[activeYear] || [];
  syncThemeTokens();
  renderSection(currentSection, true);
  updateControlliBadge();
}

/** Escape HTML per il testo che arriva dai fogli (descrizioni, categorie...) prima di finire in innerHTML. */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
/** Classe di colore per un valore con segno: 'pos' se va bene, 'neg' se va male, 'muted' se zero o assente. */
function tone(v, higherIsBetter = true) {
  if (!v) return 'muted';
  return (v > 0) === higherIsBetter ? 'pos' : 'neg';
}
function fmt(v) { return Math.round(v).toLocaleString('it-IT').replace('-', '−') + '\u00a0€'; }
/** Importo con il segno anche se positivo: +849 €, −60 €, 0 €. */
function fmtS(v) { return (Math.round(v) > 0 ? '+' : '') + fmt(v); }
/** Con i centesimi: abbonamenti (2,99 €) e spese detraibili, dove l'arrotondamento all'euro inganna. */
function fmtCents(v) { return v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
/** "6% in meno" / "21% in più" / "uguale": variazione percentuale scritta in parole; '' se non c'è il riferimento. */
function pctParole(cur, ref) {
  if (!(Math.abs(ref) > 0)) return '';
  const p = Math.round((cur - ref) / Math.abs(ref) * 100);
  return p === 0 ? 'uguale' : `${Math.abs(p)}% ${p < 0 ? 'in meno' : 'in più'}`;
}
/** "a ottobre", "ad aprile", "ad agosto": il mese (0-11) con la preposizione giusta. */
function aMese(m) { return (m === 3 || m === 7 ? 'ad ' : 'a ') + MONTHS_FULL[m].toLowerCase(); }
/** Variazione percentuale già calcolata, col segno: +5%, −12%, 0%. */
function pctS(p) { return `${p > 0 ? '+' : ''}${String(p).replace('-', '−')}%`; }
/** Quota con al massimo un decimale e la virgola: 20,6%, 8%. */
function quota(v) { return v.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%'; }
function mkChart(id, cfg) {
  const existing = charts[id];
  if (existing && existing.config.type === cfg.type) {
    existing.data = cfg.data;
    if (cfg.options) existing.options = cfg.options;
    existing.update('none');
    return;
  }
  if (existing) { existing.destroy(); delete charts[id]; }
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, cfg);
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function syncThemeTokens() {
  TREND_COLORS = [
    cssVar('--chart-1', THEME_FALLBACKS.chart1),
    cssVar('--chart-2', THEME_FALLBACKS.chart2),
    cssVar('--chart-3', THEME_FALLBACKS.chart3),
    cssVar('--chart-4', THEME_FALLBACKS.chart4),
    cssVar('--chart-5', THEME_FALLBACKS.chart5),
    cssVar('--chart-6', THEME_FALLBACKS.chart6),
    cssVar('--chart-7', THEME_FALLBACKS.chart7),
    cssVar('--chart-8', THEME_FALLBACKS.chart8),
    cssVar('--chart-9', THEME_FALLBACKS.chart9),
    cssVar('--chart-10', THEME_FALLBACKS.chart10)
  ];
  CHART_IN = cssVar('--chart-in', '#7CCBA8');
  CHART_OUT = cssVar('--chart-out', '#F0937B');
  tc = cssVar('--chart-axis', THEME_FALLBACKS.chartAxis);
  if (window.Chart) {
    Chart.defaults.font.family = cssVar('--font', 'system-ui, sans-serif');
    Chart.defaults.font.size = 11;
  }
  gc = cssVar('--chart-grid', THEME_FALLBACKS.chartGrid);
}

function renderSection(name, force) {
  const d = allData[activeYear] || [];
  if (!force && renderedSections.has(name)) return;

  if (name === 'overview') {
    renderMetrics(d);
    renderSaldoCard();
    renderMonthlyChart(d);
    renderPatrimonioChart();
    renderOverviewMonthlyTable(d);
    renderPrevisteWidget();
    renderAnomalieMese(d);
    renderAbbonamentiWidget();
    renderAnnualiWidget();
    renderSaldoControllo();
  }
  if (name === 'categories') {
    renderCatHead(d);
    renderCatOutBars(d);
    renderCatInBars(d);
    renderExpenseHeatmap(d);
    renderProiezioneCategorie(d);
    renderDetraibili();
    renderCatModal();
  }
  if (name === 'cashflow') {
    renderFlowChart(d);
    renderFlowDettagli(d);
    renderTrendSection(d);
  }
  if (name === 'bollette') {
    renderBolletteSection();
  }
  if (name === 'compare') {
    renderCompare();
  }
  if (name === 'periodo') {
    renderPeriodo();
  }
  if (name === 'dati') {
    datiPage = 0;
    renderControlli();
    renderDaClassificare();
    initDatiFilters(d);
    renderDati();
  }
  renderedSections.add(name);
}

function scales(cb) {
  return {
    x: { ticks: { color: tc }, grid: { display: false }, border: { color: gc } },
    y: { ticks: { color: tc, callback: cb || (v => Math.round(v).toLocaleString('it-IT').replace('-', '−')) }, grid: { color: gc }, border: { display: false } }
  };
}

/**
 * Plugin Chart.js: contorno tratteggiato sulle barre dei dataset con `contorno: colore`
 * (le previsioni: Chart.js non tratteggia da solo il bordo delle barre).
 */
const barreTratteggiate = {
  id: 'barreTratteggiate',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((ds, i) => {
      if (!ds.contorno || !chart.isDatasetVisible(i)) return;
      ctx.save();
      ctx.strokeStyle = ds.contorno;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      chart.getDatasetMeta(i).data.forEach((bar, k) => {
        if (!ds.data[k]) return;
        const { x, y, base, width } = bar.getProps(['x', 'y', 'base', 'width'], true);
        ctx.strokeRect(x - width / 2, Math.min(y, base), width, Math.abs(base - y));
      });
      ctx.restore();
    });
  }
};

/** Plugin Chart.js: zona sotto zero colorata (--below-zero) e linea dello zero. */
const zonaSottoZero = {
  id: 'zonaSottoZero',
  beforeDatasetsDraw(chart) {
    const y = chart.scales.y, area = chart.chartArea;
    if (!y || !area) return;
    const y0 = Math.min(Math.max(y.getPixelForValue(0), area.top), area.bottom);
    const ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = cssVar('--below-zero', '#2A1E22');
    ctx.fillRect(area.left, y0, area.right - area.left, area.bottom - y0);
    ctx.strokeStyle = cssVar('--line-strong', '#2E3B50');
    ctx.beginPath(); ctx.moveTo(area.left, y0); ctx.lineTo(area.right, y0); ctx.stroke();
    ctx.fillStyle = cssVar('--muted', '#96A3B5');
    ctx.font = '11px ' + cssVar('--font', 'sans-serif');
    ctx.textBaseline = 'bottom';
    ctx.fillText('0 €', area.left + 2, y0 - 2);
    ctx.restore();
  }
};

function onDatiSearchInput() {
  clearTimeout(datiSearchTimer);
  datiSearchTimer = setTimeout(() => {
    datiPage = 0;
    renderDati();
  }, 120);
}

function resetDatiFilters() {
  const search = document.getElementById('datiSearch');
  const cat = document.getElementById('datiCatFilter');
  const tipo = document.getElementById('datiTipoFilter');
  const metodo = document.getElementById('datiMetodoFilter');
  const mese = document.getElementById('datiMeseFilter');
  const sort = document.getElementById('datiSortBy');
  if (search) search.value = '';
  if (cat) cat.value = '';
  if (tipo) tipo.value = '';
  if (metodo) metodo.value = '';
  if (mese) mese.value = '';
  if (sort) sort.value = 'date-desc';
  datiPage = 0;
  renderDati();
}

function parseMonth(date) {
  const p = date.split(/[\/\-\.]/);
  if (p.length >= 2) { if (p[0].length === 4) return parseInt(p[1]) - 1; return parseInt(p[1]) - 1; }
  return 0;
}
function getMonthly(data) {
  const inc = Array(12).fill(0), out = Array(12).fill(0);
  data.forEach(r => { const m = parseMonth(r.date); if (m < 0 || m > 11) return; if (r.amount >= 0) inc[m] += r.amount; else out[m] += Math.abs(r.amount); });
  return { inc, out };
}
function getCats(data) { const s = new Set(); data.filter(r => r.amount < 0).forEach(r => s.add(r.cat)); return [...s].sort(); }

/* ============================================================
   CARTA DI CREDITO — colonna "Carta" del foglio. La spesa conta nel mese in
   cui è fatta, ma esce fisicamente dal conto il mese successivo.
   ============================================================ */
/** Uscite con carta per mese (0-11), in valore assoluto. */
function getCardMonthly(data) {
  const card = Array(12).fill(0);
  (data || []).forEach(r => {
    if (!r.card || r.amount >= 0) return;
    const m = parseMonth(r.date);
    if (m >= 0 && m <= 11) card[m] += Math.abs(r.amount);
  });
  return card;
}
/** Mese in cui viene addebitata la carta del mese m (il successivo, anche a cavallo d'anno). */
function cardDebitLabel(m, year = activeYear) {
  return m === 11 ? `gennaio ${parseInt(year) + 1}` : MONTHS_FULL[m + 1].toLowerCase();
}
const CARD_BADGE = '<span class="card-badge" title="Pagato con carta: addebito sul conto il mese successivo">carta</span>';
function cardColor() { return cssVar('--card', '#8E5A55'); }
/**
 * Uscite dell'anno divise in conto e carta. `cassa` = true sposta le spese carta
 * al mese in cui escono dal conto (il successivo); gennaio riceve la carta di
 * dicembre dell'anno prima, la carta di dicembre esce dall'anno.
 */
function getOutSplit(data, cassa, year = activeYear) {
  const { out } = getMonthly(data);
  const card = getCardMonthly(data);
  const conto = out.map((v, i) => v - card[i]);
  if (!cassa) return { conto, card, hasCard: card.some(v => v > 0) };
  const prevDec = getCardMonthly(allData[String(parseInt(year) - 1)])[11];
  const shifted = card.map((_, i) => i === 0 ? prevDec : card[i - 1]);
  return { conto, card: shifted, hasCard: card.some(v => v > 0) || prevDec > 0 };
}
/** Variazione mese su mese del saldo conto reale (scheda Saldo mensile) per l'anno attivo; null dove manca. */
function getSaldoDeltaMonthly(year = activeYear) {
  const series = getSaldoSeries();
  const byKey = {};
  series.forEach(p => { byKey[p.year + '-' + p.monthIdx] = p.saldo; });
  const y = parseInt(year);
  return MONTHS.map((_, m) => {
    const cur = byKey[y + '-' + m];
    const prev = m === 0 ? byKey[(y - 1) + '-11'] : byKey[y + '-' + (m - 1)];
    return (cur === undefined || prev === undefined) ? null : cur - prev;
  });
}

/* ============================================================
   SPESE PREVISTE — scheda "Previste" del foglio annuale
   ============================================================ */
/**
 * Previste dell'anno attivo, ordinate per data. `open` = nel mese corrente o
 * successivi → pesa su tabella, grafico, saldi e proiezione. Nessun match con i
 * movimenti bancari: una voce resta aperta finché il suo mese non è passato
 * (o finché non viene tolta dal foglio).
 */
function getPreviste(year = activeYear, conStime = stimaMedie) {
  const yr = parseInt(year);
  const list = (previsteData[year] || []).filter(p => p.anno === yr);
  const now = new Date();
  if (!list.length && !(conStime && yr === now.getFullYear())) return [];
  const firstOpenMonth = yr > now.getFullYear() ? 0 : yr < now.getFullYear() ? 12 : now.getMonth();
  const voci = list
    .slice().sort((a, b) => a.mese - b.mese || (a.giorno || 0) - (b.giorno || 0))
    .map(p => ({ ...p, open: p.mese >= firstOpenMonth, firstOpenMonth }));
  if (!conStime || yr !== now.getFullYear()) return voci;
  // In coda, così le voci vere restano in ordine e il primo mese aperto si legge da voci[0]
  return voci.concat(getStimaVariabili(voci, now).map(s => ({ ...s, open: true, firstOpenMonth })));
}

/**
 * Spese variabili stimate (interruttore «spese medie» del widget Previste) per ogni mese
 * che resta dell'anno in corso, una voce per categoria: mediana di quanto la categoria è
 * costata negli ultimi 12 mesi chiusi con movimenti, meno le previste della stessa
 * categoria in quel mese (mutuo, abbonamenti... non contano due volte). La mediana ignora
 * i mesi eccezionali e azzera le categorie usate in meno di metà dei mesi: le spese annuali
 * restano al widget «Spese annuali in arrivo». Nel mese in corso conta solo la parte non
 * ancora spesa. → [{ anno, mese, cat, descr, importo, stimata: true }]
 */
function getStimaVariabili(previste, now = new Date()) {
  const yr = now.getFullYear(), cur = now.getMonth();
  const chiave = `${yr}-${cur}-${now.getDate()}`;
  const memo = getStimaVariabili.memo;
  if (memo && memo.dati === allData && memo.previste === previsteData && memo.chiave === chiave) return memo.voci;

  // Ultimi 12 mesi chiusi (prima del mese in corso), solo quelli con almeno un movimento
  const mesi = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(yr, cur - i, 1);
    mesi.push(d.getFullYear() * 12 + d.getMonth());
  }
  const perMese = {}, conDati = new Set(), spesoOra = {}, nomi = {};
  [yr - 1, yr].forEach(y => (allData[String(y)] || []).forEach(r => {
    const m = parseMonth(r.date);
    if (m < 0 || m > 11) return;
    const k = y * 12 + m;
    const isCur = y === yr && m === cur;
    if (!isCur && !mesi.includes(k)) return;
    if (!isCur) conDati.add(k);
    if (r.amount >= 0 || !r.cat) return;
    const c = r.cat.toLowerCase();
    nomi[c] = nomi[c] || r.cat;
    if (isCur) spesoOra[c] = (spesoOra[c] || 0) + Math.abs(r.amount);
    else ((perMese[c] = perMese[c] || {})[k] = (perMese[c][k] || 0) + Math.abs(r.amount));
  }));
  const voci = [];
  if (conDati.size >= 3) {
    const elenco = [...conDati];
    const previsteCat = {};
    previste.forEach(p => {
      if (p.entrata || p.stimata || !p.cat || p.anno !== yr) return;
      const k = p.cat.toLowerCase() + '|' + p.mese;
      previsteCat[k] = (previsteCat[k] || 0) + p.importo;
    });
    Object.keys(perMese).forEach(c => {
      const valori = elenco.map(k => perMese[c][k] || 0).sort((a, b) => a - b);
      const h = valori.length >> 1;
      const mediana = valori.length % 2 ? valori[h] : (valori[h - 1] + valori[h]) / 2;
      if (mediana < 1) return;
      for (let m = cur; m < 12; m++) {
        let importo = mediana - (previsteCat[c + '|' + m] || 0) - (m === cur ? spesoOra[c] || 0 : 0);
        importo = Math.round(importo);
        if (importo > 0) voci.push({ anno: yr, mese: m, cat: nomi[c], sub: '', descr: 'Spesa media', importo, stimata: true });
      }
    });
  }
  getStimaVariabili.memo = { dati: allData, previste: previsteData, chiave, voci };
  return voci;
}
/** Somma per mese delle spese previste ancora aperte (senza le entrate fisse). */
function getPrevisteMonthly(previste) {
  const m = Array(12).fill(0);
  previste.forEach(p => { if (p.open && !p.entrata) m[p.mese] += p.importo; });
  return m;
}
/** Somma per mese delle entrate previste ancora aperte (entrate fisse di «Ricorrenti»). */
function getEntratePrevisteMonthly(previste) {
  const m = Array(12).fill(0);
  previste.forEach(p => { if (p.open && p.entrata) m[p.mese] += p.importo; });
  return m;
}

/**
 * Proiezione del saldo del conto per l'anno in corso (proiezioneSaldo in calcoli.js): dall'ultimo
 * saldo mensile noto aggiunge i movimenti già registrati dei mesi successivi (le spese con carta
 * escono il mese dopo), sottrae le spese previste e aggiunge le entrate previste aperte, mese per
 * mese, fino all'ultimo mese con previste. conStime: contare le spese medie (default l'interruttore).
 * Ritorna [{ year, monthIdx, label, v, ...righe del mese }] oppure [] se non c'è nulla da proiettare.
 */
function getSaldoProjection(series, conStime = stimaMedie) {
  const yr = String(new Date().getFullYear());
  const cur = series.filter(p => p.year === yr);
  if (!cur.length) return [];
  const last = cur[cur.length - 1];
  const { inc, out } = getMonthly(allData[yr] || []);
  const card = getCardMonthly(allData[yr] || []);
  return proiezioneSaldo(last, { inc, out, card }, getPreviste(yr, conStime), conStime)
    .map(p => ({ ...p, year: yr, label: `≈ ${MONTHS[p.monthIdx]} ${yr.slice(2)}` }));
}

/**
 * Saldo calcolato dai movimenti per ogni punto della serie del saldo (stesso indice):
 * saldo del mese prima + entrate − uscite dal conto − spese con carta del mese prima
 * (addebitate in questo mese). null se il punto precedente non è il mese prima.
 * La differenza con il saldo inserito segnala movimenti mancanti o doppi, o un saldo sbagliato.
 */
function getSaldoCalcolato(series) {
  const perAnno = {};
  const mesi = y => perAnno[y] || (perAnno[y] = { ...getMonthly(allData[y] || []), card: getCardMonthly(allData[y] || []) });
  return series.map((p, i) => {
    const prev = series[i - 1];
    if (!prev) return null;
    const consecutivo = (+p.year * 12 + p.monthIdx) - (+prev.year * 12 + prev.monthIdx) === 1;
    if (!consecutivo) return null;
    const m = mesi(p.year), mp = mesi(prev.year);
    const v = prev.saldo + m.inc[p.monthIdx] - (m.out[p.monthIdx] - m.card[p.monthIdx]) - mp.card[prev.monthIdx];
    return Math.round(v);
  });
}

/** Etichetta della proiezione del saldo: con l'interruttore «spese medie» include anche le spese stimate. */
function attesoLabel() {
  return stimaMedie ? 'atteso (netto previste e spese medie)' : 'atteso (netto previste)';
}

/** Dataset tratteggiato della proiezione, ancorato all'ultimo punto reale (indice anchorIdx). */
function projectionDataset(anchorIdx, anchorValue, proj, label) {
  const data = Array(anchorIdx).fill(null).concat([anchorValue], proj.map(p => p.v));
  return { label: label || 'Saldo atteso', data, borderColor: TREND_COLORS[3], backgroundColor: 'transparent',
    borderDash: [4, 4], borderWidth: 1.5, pointBackgroundColor: TREND_COLORS[3], pointBorderColor: TREND_COLORS[3],
    pointStyle: 'rectRot', pointRadius: 4, pointHoverRadius: 6, tension: .3, fill: false, spanGaps: false };
}

function getExpenseCategorySummary(data) {
  const cats = {};
  data.filter(r => r.amount < 0).forEach(r => {
    const month = parseMonth(r.date);
    if (!cats[r.cat]) cats[r.cat] = { total: 0, monthly: Array(12).fill(0), monthsActive: new Set() };
    const absAmount = Math.abs(r.amount);
    cats[r.cat].total += absAmount;
    if (month >= 0 && month < 12) {
      cats[r.cat].monthly[month] += absAmount;
      if (absAmount > 0) cats[r.cat].monthsActive.add(month);
    }
  });
  return Object.entries(cats).map(([name, info]) => ({
    name,
    total: info.total,
    monthly: info.monthly,
    activeMonths: info.monthsActive.size
  })).sort((a, b) => b.total - a.total);
}

/**
 * Media mensile di ogni categoria di spesa dell'anno, la stessa in tutte le viste: totale della categoria
 * nei mesi chiusi con movimenti ÷ quei mesi (mediaCategoria e mesiPerMedia in calcoli.js).
 * → { mesi, perNome: { categoria: media } }
 */
function medieCategorie(data, anno = activeYear) {
  const { inc, out } = getMonthly(data);
  const mesi = mesiPerMedia(inc, out, anno, new Date());
  const perNome = {};
  getExpenseCategorySummary(data).forEach(c => { perNome[c.name] = mediaCategoria(c.monthly, mesi); });
  return { mesi, perNome };
}

/** Parsa una data dd/mm/yyyy oppure yyyy-mm-dd → { d, m (0-11), y }. null se non valida. */
function parseDmy(s) {
  const p = String(s || '').trim().split(/[\/\-\.]/);
  if (p.length < 2) return null;
  let d, m, y;
  if (p[0].length === 4) { y = +p[0]; m = +p[1]; d = +(p[2] || 1); }
  else { d = +(p[0] || 1); m = +p[1]; y = +(p[2] || 0); }
  if (!y || !m || m < 1 || m > 12) return null;
  return { d, m: m - 1, y };
}

/** Chiave numerica AAAAMMGG per ordinare cronologicamente le date del foglio (GG/MM/AAAA o AAAA-MM-GG). */
function dateKey(s) {
  const p = parseDmy(s);
  return p ? p.y * 10000 + (p.m + 1) * 100 + p.d : 0;
}

/**
 * Serie canonica del saldo: il foglio "Saldo mensile" è unico ma viene caricato
 * sotto ogni chiave-anno, quindi i dati sono duplicati. Qui deduplico per `mese`,
 * ricavo l'anno civile dalla DATA (non dalla chiave) e ordino cronologicamente.
 */
function getSaldoSeries() {
  const validYears = new Set(Object.keys(allData || {}));
  const seen = new Set(); const pts = [];
  Object.values(saldoData || {}).forEach(arr => (arr || []).forEach(r => {
    if (!r || seen.has(r.mese)) return;
    seen.add(r.mese);
    const p = parseDmy(r.mese);
    if (!p) return;
    // Mostra solo gli anni presenti nei dati (esclude p.es. il saldo d'apertura
    // 31/12 dell'anno precedente al primo anno tracciato).
    if (validYears.size && !validYears.has(String(p.y))) return;
    pts.push({ mese: r.mese, saldo: Math.round(r.saldo), monthIdx: p.m, year: String(p.y),
      sortKey: new Date(p.y, p.m, p.d).getTime() });
  }));
  pts.sort((a, b) => a.sortKey - b.sortKey);
  return pts;
}

/**
 * Per l'anno in corso i mesi successivi a quello attuale diventano null: nelle linee
 * mensili non devono apparire come spesa/entrata zero (la linea finisce all'ultimo mese).
 */
function cutFuture(values, year = activeYear) {
  const now = new Date();
  if (parseInt(year) !== now.getFullYear()) return values;
  return values.map((v, i) => i > now.getMonth() ? null : v);
}

/**
 * Tinta di una cella colorata (heatmap) leggibile: sceglie il testo chiaro o scuro con più
 * contrasto sulla tinta `hex` con opacità `alpha` stesa sopra lo sfondo della pagina (--bg).
 * Se nemmeno il migliore arriva a 4.5:1 (fondi di luminosità intermedia) riduce l'opacità
 * finché ci arriva. Ritorna { alpha, ink }.
 */
function readableTint(hex, alpha) {
  const rgb = h => { const v = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)); };
  const lum = c => { const [r, g, b] = c.map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const surface = rgb(cssVar('--bg', '#0E141C')), tint = rgb(hex);
  const inks = { '#16151f': rgb('#16151f'), '#f4f4f8': rgb('#f4f4f8') };
  for (let a = alpha; ; a = Math.max(0.1, a - 0.04)) {
    const bg = tint.map((c, i) => c * a + surface[i] * (1 - a));
    const [ink, r] = Object.entries(inks).map(([k, v]) => [k, ratio(v, bg)]).sort((x, y) => y[1] - x[1])[0];
    if (r >= 4.5 || a <= 0.1) return { alpha: a, ink };
  }
}

function mixWithAlpha(hex, alpha) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const normalized = hex.length === 4
    ? '#' + hex.slice(1).split('').map(ch => ch + ch).join('')
    : hex;
  const value = normalized.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Formato numero compatto: 1234 → "1,2k", 980 → "980". */
function shortNum(v) {
  return v >= 1000 ? (Math.round(v / 100) / 10).toLocaleString('it-IT') + 'k' : Math.round(v).toLocaleString('it-IT');
}

/** Dialoghi: alla chiusura il focus torna al controllo da cui si è aperto. */
function ricordaFocus(modal) { modal._focusPrima = document.activeElement; modal.scrollTop = 0; }
function restituisciFocus(modal) {
  const el = modal._focusPrima;
  modal._focusPrima = null;
  if (el && el.isConnected && el.focus) el.focus();
}

/** Controllo segmentato: segna come premuto il pulsante con data-mode === mode. */
function syncSeg(id, mode) {
  document.querySelectorAll(`#${id} [data-mode]`).forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false'));
}
function showLoading(t) { document.getElementById('loadingOverlay').style.display = 'flex'; setLoadingText(t || 'Caricamento dati in corso...'); }
function setLoadingText(t) { document.getElementById('loadingText').textContent = t; }
function hideLoading() { document.getElementById('loadingOverlay').style.display = 'none'; }
