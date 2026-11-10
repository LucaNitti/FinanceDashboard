/* FinFlow — Sezione Categorie: barre per categoria, heatmap mensile, proiezione e dialogo della categoria. */
/* ============================================================
   CATEGORIE
   ============================================================ */
/** Titolo della pagina: il periodo con dati e i due totali dell'anno. */
function renderCatHead(data) {
  const { inc, out } = getMonthly(data);
  const conDati = MONTHS.map((_, i) => i).filter(i => inc[i] > 0 || out[i] > 0);
  const t = document.getElementById('catPagina'), s = document.getElementById('catPaginaSub');
  if (t) t.textContent = `Categorie ${activeYear}`;
  if (!s) return;
  if (!conDati.length) { s.textContent = `Nessun movimento nel ${activeYear}.`; return; }
  const a = MONTHS_FULL[conDati[0]], b = MONTHS_FULL[conDati[conDati.length - 1]].toLowerCase();
  const periodo = conDati.length === 1 ? a : `Da ${a.toLowerCase()} a ${b}`;
  s.textContent = `${periodo}: uscite ${fmt(out.reduce((x, v) => x + v, 0))}, entrate ${fmt(inc.reduce((x, v) => x + v, 0))}. Clicca una categoria per le sottocategorie, un riquadro della tabella per il confronto.`;
}

/** Dove vanno le uscite: le 9 categorie più grandi (ogni riga apre il dialogo) e «Tutte le altre». */
function renderCatOutBars(data) {
  const el = document.getElementById('catOutBars');
  if (!el) return;
  const cats = {};
  data.filter(r => r.amount < 0).forEach(r => { cats[r.cat] = (cats[r.cat] || 0) + Math.abs(r.amount); });
  const all = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const totale = all.reduce((s, [, v]) => s + v, 0);
  const testa = `<h2 class="section-title" id="catOutTitolo">Dove vanno le uscite</h2><p class="section-sub">Quota sul totale delle uscite</p>`;
  if (!all.length) { el.innerHTML = testa + `<div class="empty">Nessuna uscita nel ${esc(activeYear)}.</div>`; return; }
  const MAX = all.length > 10 ? 9 : all.length;
  const max = all[0][1];
  const riga = (nome, v) => `
      <span class="barra-nome">${esc(nome)}</span>
      <span class="bar-track" aria-hidden="true"><span style="width:${Math.max(1, v / max * 100).toFixed(1)}%"></span></span>
      <span class="barra-val">${fmt(v)}</span>
      <span class="barra-pct">${quota(v / totale * 100)}</span>`;
  const righe = all.slice(0, MAX).map(([nome, v]) =>
    `<button type="button" class="barra-riga barra-btn" data-cat="${esc(nome)}" onclick="apriCategoria(this.dataset.cat)" aria-label="Sottocategorie di ${esc(nome)}: ${fmt(v)}">${riga(nome, v)}</button>`).join('');
  const resto = all.slice(MAX);
  const restoTot = resto.reduce((s, [, v]) => s + v, 0);
  el.innerHTML = testa + `<div class="barre-lista">${righe}${resto.length ? `<div class="barra-riga barra-altre" title="${resto.length} categorie piccole">${riga('Tutte le altre', restoTot)}</div>` : ''}</div>`;
}

/** Da dove arrivano le entrate: le 5 categorie più grandi e «Altre». */
function renderCatInBars(data) {
  const el = document.getElementById('catInBars');
  if (!el) return;
  const cats = {};
  data.filter(r => r.amount > 0).forEach(r => { cats[r.cat] = (cats[r.cat] || 0) + r.amount; });
  const all = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const totale = all.reduce((s, [, v]) => s + v, 0);
  const testa = `<h2 class="section-title mb-10" id="catInTitolo">Da dove arrivano le entrate</h2>`;
  if (!all.length) { el.innerHTML = testa + `<div class="empty">Nessuna entrata nel ${esc(activeYear)}.</div>`; return; }
  const top = all.slice(0, 5);
  const resto = all.slice(5).reduce((s, [, v]) => s + v, 0);
  if (resto > 0) top.push([`Altre (${all.length - 5})`, resto]);
  const max = all[0][1];
  el.innerHTML = testa + top.map(([nome, v]) => `<div class="barra-riga barra-stretta">
      <span class="barra-nome">${esc(nome)}</span>
      <span class="bar-track bar-in" aria-hidden="true"><span style="width:${Math.max(1, v / max * 100).toFixed(1)}%"></span></span>
      <span class="barra-val">${fmt(v)}</span>
      <span class="barra-pct">${quota(v / totale * 100)}</span>
    </div>`).join('');
}

/**
 * Variazione di una cella della heatmap rispetto a un riferimento.
 * Riferimento assente (≤ 0 o n/d) → pct null.
 */
function mkHmVar(mark, value, baseline, label) {
  if (!(baseline > 0)) {
    return { pct: null, tip: `${mark}  ${label}: n/d` };
  }
  const pct = Math.round((value - baseline) / baseline * 100);
  return { pct, tip: `${mark}  ${label}: ${pctS(pct)} (${fmt(baseline)})` };
}

let hmStato = null; // dati della tabella per il riquadro di confronto (hmScegli)

function renderExpenseHeatmap(data) {
  const summary = getExpenseCategorySummary(data);
  const categories = summary.slice(0, 10);
  const root = document.getElementById('expenseHeatmapEl');
  if (!root) return;
  const prevYear = String(parseInt(activeYear, 10) - 1);
  const info = document.getElementById('hmInfo');
  if (info) { info.hidden = true; info.innerHTML = ''; }
  const sub = document.getElementById('expenseHeatmapSub');
  if (sub) sub.textContent = `Più il riquadro è acceso, più quel mese è stato caro per quella categoria. Clicca un riquadro per il confronto con il mese prima e con il ${prevYear}.`;
  if (!categories.length) {
    root.innerHTML = '<div class="empty">Nessuna spesa disponibile per costruire la tabella.</div>';
    return;
  }
  // Anno precedente: stesso mese un anno fa e mese prima di gennaio (dicembre). Mappa per nome categoria.
  const prevByName = {};
  const prevSummary = getExpenseCategorySummary(allData[prevYear] || []);
  prevSummary.forEach(c => { prevByName[c.name] = c.monthly; });
  const hasPrev = prevSummary.length > 0;
  // Mese in corso: confronto con gli stessi giorni dell'anno prima, non con il mese intero
  const oggi = new Date();
  const meseCorso = parseInt(activeYear, 10) === oggi.getFullYear() ? oggi.getMonth() : -1;
  const prevParziale = {};
  if (meseCorso >= 0) getExpenseCategorySummary((allData[prevYear] || []).filter(r => parseDay(r.date) <= oggi.getDate()))
    .forEach(c => { prevParziale[c.name] = c.monthly[meseCorso]; });
  const rifPrev = (name, monthly, m) => m === meseCorso ? (prevParziale[name] || 0) : (monthly[m] || 0);
  // Media mensile = totale nei mesi chiusi con movimenti / quei mesi (medieCategorie, uguale in tutte
  // le viste), così una categoria saltuaria non sembra più cara di quanto pesa davvero sul mese.
  const mesiConDati = summary.flatMap(c => c.monthly.flatMap((v, m) => v > 0 ? [m] : []));
  const { mesi: mesiMedia, perNome: mediaDi } = medieCategorie(data);
  const nMonths = mesiMedia.length;
  const ultimoMese = Math.max(...mesiConDati);
  const mesi = MONTHS.map((_, i) => i).filter(i => i <= ultimoMese);
  hmStato = { categories, prevByName, prevYear, attiva: null };

  const monthTotals = Array(12).fill(0);
  const varCella = (cur, ref, inRosso) => {
    if (!ref) return '<td class="r muted">—</td>';
    const p = Math.round((cur - ref) / ref * 100);
    return `<td class="r ${inRosso ? tone(p, false) : ''}" title="${prevYear}: ${fmt(ref)}">${pctS(p)}</td>`;
  };
  const rows = categories.map((cat, ri) => {
    const mx = Math.max(...cat.monthly, 1);
    const cells = mesi.map(m => {
      const value = cat.monthly[m];
      monthTotals[m] += value;
      if (!value) return `<td class="hm-td"><button type="button" class="hm-btn hm-vuota" data-r="${ri}" data-m="${m}" aria-label="${esc(cat.name)}, ${MONTHS_FULL[m].toLowerCase()}: nessuna spesa">—</button></td>`;
      const { alpha, ink } = readableTint(CHART_OUT, .06 + value / mx * .5);
      return `<td class="hm-td" style="background:${mixWithAlpha(CHART_OUT, alpha)}"><button type="button" class="hm-btn" style="color:${ink}" data-r="${ri}" data-m="${m}" aria-label="${esc(cat.name)}, ${MONTHS_FULL[m].toLowerCase()}: ${fmt(value)}. Confronta">${fmt(value)}</button></td>`;
    }).join('');
    const rowTotal = cat.monthly.reduce((s, v) => s + v, 0);
    const prevM = prevByName[cat.name];
    const prevRow = prevM ? cat.monthly.reduce((s, v, m) => v > 0 ? s + rifPrev(cat.name, prevM, m) : s, 0) : 0;
    const vsCell = !hasPrev ? '' : !prevM ? '<td class="r muted">nuova</td>' : varCella(rowTotal, prevRow, true);
    return `<tr>
      <th scope="row"><button type="button" class="mese-link hm-cat-btn" data-cat="${esc(cat.name)}" title="${esc(cat.name)}: sottocategorie">${esc(cat.name)}</button></th>
      ${cells}
      <td class="r b" title="${esc(cat.name)}, totale: ${fmt(rowTotal)}">${shortNum(rowTotal)}&nbsp;€</td>
      <td class="r muted">${nMonths ? `${shortNum(mediaDi[cat.name] || 0)}&nbsp;€` : '—'}</td>
      ${vsCell}
    </tr>`;
  }).join('');
  const prevMonthTotals = Array(12).fill(0), prevRif = Array(12).fill(0);
  Object.entries(prevByName).filter(([name]) => categories.some(c => c.name === name)).forEach(([name, monthly]) => monthly.forEach((v, m) => {
    prevMonthTotals[m] += v;
    prevRif[m] += rifPrev(name, monthly, m);
  }));
  const grand = monthTotals.reduce((s, v) => s + v, 0);
  const prevGrand = monthTotals.reduce((s, v, m) => v > 0 ? s + prevRif[m] : s, 0);
  const nomeTotale = summary.length > categories.length ? `Totale delle ${categories.length} mostrate` : 'Totale';
  root.innerHTML = `<table class="cat-table hm-table">
    <thead><tr><th>Categoria</th>${mesi.map(m => `<th class="r">${MESI_3[m]}</th>`).join('')}<th class="r">Totale</th><th class="r" title="Media mensile sui mesi chiusi${mesiMedia.length ? ` (${mesiMedia.length})` : ''}: il mese in corso non conta">Media</th>${hasPrev ? `<th class="r"${meseCorso >= 0 ? ` title="${MONTHS_FULL[meseCorso]} confrontato con i primi ${oggi.getDate()} giorni di ${MONTHS_FULL[meseCorso].toLowerCase()} ${prevYear}"` : ''}>vs ${prevYear}</th>` : ''}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="hm-tot"><th scope="row" title="${summary.length > categories.length ? `Le altre ${summary.length - categories.length} categorie non sono nella tabella` : ''}">${nomeTotale}</th>${mesi.map(m => `<td class="r" title="${MONTHS_FULL[m]}: ${fmt(monthTotals[m])}${prevMonthTotals[m] > 0 ? `, ${prevYear}: ${fmt(prevMonthTotals[m])}` : ''}">${monthTotals[m] ? `${shortNum(monthTotals[m])}&nbsp;€` : '—'}</td>`).join('')}<td class="r">${shortNum(grand)}&nbsp;€</td><td class="r muted">${nMonths ? `${shortNum(mediaCategoria(monthTotals, mesiMedia))}&nbsp;€` : '—'}</td>${hasPrev ? varCella(grand, prevGrand, true) : ''}</tr></tfoot>
  </table>`;
  root.querySelector('.hm-table').addEventListener('click', e => {
    const lbl = e.target.closest('.hm-cat-btn');
    if (lbl) { apriCategoria(lbl.dataset.cat); return; }
    const cella = e.target.closest('.hm-btn');
    if (cella) hmScegli(+cella.dataset.r, +cella.dataset.m, cella);
  });
}

/** Clic su un riquadro della tabella: sopra compare il valore con le variazioni sul mese prima e sull'anno prima. */
function hmScegli(ri, m, btn) {
  const info = document.getElementById('hmInfo');
  if (!info || !hmStato) return;
  const { categories, prevByName, prevYear } = hmStato;
  const cat = categories[ri];
  const value = cat.monthly[m];
  document.querySelectorAll('.hm-btn.attiva').forEach(b => b.classList.remove('attiva'));
  btn.classList.add('attiva');
  const prevAnno = prevByName[cat.name] || null;
  const riga = (v, nome) => {
    if (v.pct === null) return `<span class="muted">${nome}: nessun dato</span>`;
    return `<span class="${tone(v.pct, false)}">${nome}: ${pctS(v.pct)}</span>`;
  };
  const baseMese = m > 0 ? cat.monthly[m - 1] : (prevAnno ? prevAnno[11] : null);
  const nomeMese = m > 0 ? MONTHS_FULL[m - 1].toLowerCase() : `dicembre ${prevYear}`;
  const conImporto = (nome, base) => base > 0 ? `${nome} (${fmt(base)})` : nome;
  const vMese = mkHmVar('M', value, baseMese, nomeMese);
  const baseAnno = prevAnno ? prevAnno[m] : null;
  const vAnno = mkHmVar('A', value, baseAnno, MONTHS_FULL[m].toLowerCase());
  info.hidden = false;
  info.innerHTML = `<b>${esc(cat.name)}, ${MONTHS_FULL[m].toLowerCase()}</b>
    <span>${value ? fmt(value) : 'nessuna spesa'}</span>
    ${riga(vMese, `rispetto ${m > 0 ? aMese(m - 1) + '' : 'a dicembre ' + prevYear} ${baseMese > 0 ? `(${fmt(baseMese)})` : ''}`.trim())}
    ${riga(vAnno, `rispetto ${aMese(m)} ${prevYear} ${baseAnno > 0 ? `(${fmt(baseAnno)})` : ''}`.trim())}
    <button type="button" class="btn-sm hm-chiudi" onclick="hmChiudi()" aria-label="Chiudi il confronto">✕</button>`;
}
function hmChiudi() {
  const info = document.getElementById('hmInfo');
  if (info) { info.hidden = true; info.innerHTML = ''; }
  document.querySelectorAll('.hm-btn.attiva').forEach(b => b.classList.remove('attiva'));
}

/* ============================================================
   PROIEZIONE DI FINE ANNO PER CATEGORIA (solo anno in corso)
   ============================================================ */
/**
 * Speso finora + stima dei mesi che mancano: per ogni mese quanto la categoria è costata nello
 * stesso mese dell'anno prima (così contano stagionalità e spese annuali), oppure, se l'anno
 * prima manca, la media mensile di quest'anno. Il mese in corso aggiunge solo la parte non
 * ancora spesa rispetto a quel riferimento.
 */
function renderProiezioneCategorie(data) {
  const el = document.getElementById('proiezioneCard');
  if (!el) return;
  const now = new Date();
  el.hidden = parseInt(activeYear) !== now.getFullYear();
  if (el.hidden) return;
  const cur = now.getMonth();
  const prevYear = String(now.getFullYear() - 1);
  const prevData = allData[prevYear] || [];
  const { out: prevOut } = getMonthly(prevData);
  const prevMesi = prevOut.map(v => v > 0); // mesi dell'anno prima con dati
  const trascorsi = cur + now.getDate() / daysInMonth(now.getFullYear(), cur);
  const prevByCat = {};
  getExpenseCategorySummary(prevData).forEach(c => { prevByCat[c.name] = c; });

  const righe = getExpenseCategorySummary(data).map(c => {
    const media = c.total / trascorsi;
    // Categoria nuova (assente l'anno prima): solo la media di quest'anno
    const rif = m => prevMesi[m] && prevByCat[c.name] ? prevByCat[c.name].monthly[m] : media;
    let resto = Math.max(0, rif(cur) - c.monthly[cur]);
    for (let m = cur + 1; m < 12; m++) resto += rif(m);
    const prev = prevByCat[c.name] ? prevByCat[c.name].total : 0;
    return { name: c.name, finora: c.total, stima: c.total + resto, prev };
  });
  // Categorie dell'anno prima senza spese finora: possono ancora arrivare se erano spese di pochi
  // mesi (es. una spesa annuale); una categoria usata tutto l'anno e sparita è stata rinominata o chiusa
  Object.values(prevByCat).forEach(p => {
    if (righe.some(r => r.name === p.name) || p.activeMonths > 3) return;
    let resto = 0;
    for (let m = cur; m < 12; m++) resto += p.monthly[m];
    if (resto > 0) righe.push({ name: p.name, finora: 0, stima: resto, prev: p.total });
  });
  righe.sort((a, b) => b.stima - a.stima);
  if (!righe.length) { el.innerHTML = `<h2 class="section-title" id="proiezioneTitolo">Come finirà l'anno</h2><div class="empty">Nessuna uscita nel ${esc(activeYear)}.</div>`; return; }

  const tot = righe.reduce((t, r) => ({ finora: t.finora + r.finora, stima: t.stima + r.stima, prev: t.prev + r.prev }), { finora: 0, stima: 0, prev: 0 });
  const delta = (stima, prev) => {
    if (!(prev > 0)) return '<span class="muted">nuova</span>';
    const pct = Math.round((stima - prev) / prev * 100);
    return `<span class="${Math.abs(pct) < 5 ? 'muted' : tone(pct, false)}">${pctS(pct)}</span>`;
  };
  const MAX = 15;
  const nomiAnno = new Set(getExpenseCategorySummary(data).map(c => c.name));
  const riga = (r, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}>
      <th scope="row">${r.link ? `<button type="button" class="mese-link" data-cat="${esc(r.name)}" onclick="apriCategoria(this.dataset.cat)">${esc(r.name)}</button>` : `<span class="mese-link-no">${esc(r.name)}</span>`}</th><td class="r">${fmt(r.finora)}</td><td class="r prev">${fmt(r.stima)}</td>
      <td class="r muted">${r.prev > 0 ? fmt(r.prev) : '—'}</td><td class="r">${delta(r.stima, r.prev)}</td></tr>`;
  const altre = righe.slice(MAX);
  const altreTot = altre.reduce((t, r) => ({ name: `Altre ${altre.length} categorie`, finora: t.finora + r.finora, stima: t.stima + r.stima, prev: t.prev + r.prev }), { finora: 0, stima: 0, prev: 0 });
  const diff = tot.stima - tot.prev;
  el.innerHTML = `<h2 class="section-title" id="proiezioneTitolo">Come finirà l'anno</h2>
    <p class="page-sub sezione-sub proj-frase">A questo ritmo nel ${esc(activeYear)} spenderai circa <b class="tx">${fmt(tot.stima)}</b>${tot.prev > 0
      ? `, ${fmt(Math.abs(diff))} ${diff > 0 ? 'più' : 'meno'} del ${prevYear} (${fmt(tot.prev)})` : ''}. La stima somma lo speso finora e, per i mesi che mancano, quanto speso negli stessi mesi del ${prevYear}, o la media mensile del ${esc(activeYear)} se allora manca. Le voci previste non sono sommate, per non contarle due volte.</p>
    <div class="scroll-x"><table class="cat-table proj-table">
      <thead><tr><th>Categoria</th><th class="r">Finora</th><th class="r">Fine anno, circa</th><th class="r">${prevYear}</th><th class="r">Differenza</th></tr></thead>
      <tbody>${righe.slice(0, MAX).map(r => riga({ ...r, link: nomiAnno.has(r.name) })).join('')}${altre.length ? riga(altreTot) : ''}</tbody>
      <tfoot>${riga({ name: 'Totale', ...tot }, 'hm-tot')}</tfoot>
    </table></div>`;
}

/* ============================================================
   POPUP SOTTOCATEGORIE DI UNA CATEGORIA DI SPESA
   Aperto dalla torta uscite, dalle etichette della heatmap e dalla proiezione.
   ============================================================ */
let catModal = { name: '', sub: null }; // sub: sottocategoria selezionata (null = tutte)
const SENZA_SUB = '(senza sottocategoria)';

function apriCategoria(name) {
  const modal = document.getElementById('catModal');
  if (!modal || !name) return;
  catModal = { name, sub: null };
  ricordaFocus(modal);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  renderCatModal();
  const btn = document.getElementById('catChiudi');
  if (btn) btn.focus();
}

function chiudiCategoria() {
  const modal = document.getElementById('catModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  restituisciFocus(modal);
}

/** Categoria precedente/successiva, nell'ordine di spesa dell'anno. */
function stepCategoria(delta) {
  const nomi = getExpenseCategorySummary(allData[activeYear] || []).map(c => c.name);
  const i = nomi.indexOf(catModal.name);
  const next = nomi[Math.min(nomi.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
  if (!next || next === catModal.name) return;
  catModal = { name: next, sub: null };
  renderCatModal();
}

function scegliSottocategoria(i) {
  const s = (catModal.subs || [])[i];
  if (!s) return;
  catModal.sub = catModal.sub === s.name ? null : s.name;
  renderCatModal();
}

/** Apre il tab Dati sulle uscite della categoria (la sottocategoria scelta diventa la ricerca). */
function openDatiForCategoria() {
  ['datiSearch', 'datiMetodoFilter', 'datiMeseFilter'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('datiCatFilter', catModal.name);
  set('datiTipoFilter', 'out');
  if (catModal.sub && catModal.sub !== SENZA_SUB) set('datiSearch', catModal.sub);
  chiudiCategoria();
  showSection('dati');
  datiPage = 0;
  renderDati();
}

function renderCatModal() {
  const modal = document.getElementById('catModal');
  if (!modal || modal.hidden) return;
  const data = allData[activeYear] || [];
  const prevYear = String(parseInt(activeYear, 10) - 1);
  const name = catModal.name;
  const subName = r => r.sub || SENZA_SUB;
  const movs = data.filter(r => r.amount < 0 && r.cat === name);
  // Confronto con l'anno prima negli stessi mesi in cui quest'anno ci sono uscite
  const mesiDati = new Set(data.filter(r => r.amount < 0).map(r => parseMonth(r.date)));
  const prevMovs = (allData[prevYear] || []).filter(r => r.amount < 0 && r.cat === name && mesiDati.has(parseMonth(r.date)));

  const raggruppa = arr => {
    const o = {};
    arr.forEach(r => {
      const k = subName(r);
      if (!o[k]) o[k] = { name: k, total: 0, n: 0, monthly: Array(12).fill(0) };
      o[k].total += Math.abs(r.amount); o[k].n++;
      const m = parseMonth(r.date);
      if (m >= 0 && m < 12) o[k].monthly[m] += Math.abs(r.amount);
    });
    return o;
  };
  const cur = raggruppa(movs), prev = raggruppa(prevMovs);
  const subs = Object.values(cur).sort((a, b) => b.total - a.total);
  catModal.subs = subs;
  if (catModal.sub && !cur[catModal.sub]) catModal.sub = null;

  const nomi = getExpenseCategorySummary(data).map(c => c.name);
  const pos = nomi.indexOf(name);
  document.getElementById('catPrevBtn').disabled = pos <= 0;
  document.getElementById('catNextBtn').disabled = pos < 0 || pos >= nomi.length - 1;
  document.getElementById('catTitle').textContent = name;
  const tot0 = subs.reduce((s, x) => s + x.total, 0);
  const mesiOrd = [...mesiDati].filter(m => m >= 0).sort((a, b) => a - b);
  const periodoCat = mesiOrd.length > 1 ? `Da ${MONTHS_FULL[mesiOrd[0]].toLowerCase()} a ${MONTHS_FULL[mesiOrd[mesiOrd.length - 1]].toLowerCase()}` : (MONTHS_FULL[mesiOrd[0]] || activeYear);
  document.getElementById('catSub').textContent = `${periodoCat}: ${fmt(tot0)}, ${movs.length} ${movs.length === 1 ? 'movimento' : 'movimenti'}, in media ${fmt(tot0 / (mesiDati.size || 1))} al mese. Confronto con gli stessi mesi del ${prevYear}.`;
  const body = document.getElementById('catBody');
  if (!movs.length) {
    body.innerHTML = `<div class="empty">Nessuna uscita in «${esc(name)}» nel ${esc(activeYear)}.</div>`;
    return;
  }

  const tot = subs.reduce((s, x) => s + x.total, 0);
  const prevTot = prevMovs.reduce((s, r) => s + Math.abs(r.amount), 0);
  const nMesi = mesiDati.size || 1;
  const colore = i => TREND_COLORS[i % TREND_COLORS.length];

  const righe = subs.map((s, i) => {
    const sel = catModal.sub === s.name;
    const p = prev[s.name];
    return `<button type="button" class="sub-riga${sel ? ' selected' : ''}${catModal.sub && !sel ? ' dim' : ''}" onclick="scegliSottocategoria(${i})" aria-pressed="${sel}" title="${s.n} ${s.n === 1 ? 'movimento' : 'movimenti'}, media ${fmt(s.total / nMesi)} al mese, ${Math.round(s.total / tot * 100)}% della categoria">
      <span class="sub-nome"><span class="sub-testo"><span class="cat-sub-dot" style="background:${colore(i)}"></span>${esc(s.name)}</span>
        <span class="bar-track thin" aria-hidden="true"><span style="width:${Math.max(2, s.total / subs[0].total * 100)}%"></span></span></span>
      <span class="r b">${fmt(s.total)}</span>
      <span class="r muted">${p ? fmt(p.total) : '—'}</span>
    </button>`;
  }).join('');
  // Sottocategorie che l'anno prima c'erano e quest'anno no
  const sparite = Object.values(prev).filter(p => !cur[p.name]).sort((a, b) => b.total - a.total);
  const righeSparite = sparite.map(p => `<div class="sub-riga dim sub-sparita">
      <span class="sub-nome"><span class="sub-testo">${esc(p.name)}</span></span>
      <span class="r">—</span><span class="r muted">${fmt(p.total)}</span></div>`).join('');

  const elenco = movs.filter(r => !catModal.sub || subName(r) === catModal.sub).sort((a, b) => dateKey(b.date) - dateKey(a.date));
  const MAX = 40;
  body.innerHTML = `
    <div class="sub-testa"><span>Sottocategoria</span><span class="r">${esc(activeYear)}</span><span class="r">${prevYear}</span></div>
    <div class="sub-lista">${righe}${righeSparite}</div>
    <p class="section-sub">Clicca una sottocategoria per vedere solo i suoi movimenti.</p>
    <h3 class="blocco-titolo mese-blocco">Per mese${catModal.sub ? `: ${esc(catModal.sub)}` : ''}</h3>
    <div class="chart-wrap h-sm"><canvas id="catSubChart" aria-label="Uscite mensili per sottocategoria" role="img"></canvas></div>
    <h3 class="blocco-titolo mese-blocco">Movimenti${catModal.sub ? ` di ${esc(catModal.sub)}` : ''} (${elenco.length})</h3>
    <div class="mese-moves">${elenco.slice(0, MAX).map(r => `
      <div class="mese-move">
        <span class="prev-date">${esc(String(r.date).slice(0, 5))}</span>
        <span class="mese-move-op" title="${esc(r.op)}">${esc(r.op || '—')}<span class="prev-cat">${r.card ? CARD_BADGE.replace('card-badge', 'card-badge lead') : ''}${esc(subName(r))}</span></span>
        <span class="mese-move-amt">${fmt(Math.abs(r.amount))}</span>
      </div>`).join('')}</div>
    ${elenco.length > MAX ? `<p class="note">Qui ci sono i ${MAX} più recenti: «Vedi i movimenti» li mostra tutti.</p>` : ''}`;

  // Barre impilate per mese, una serie per sottocategoria (con una selezionata, solo quella).
  // Il canvas è nuovo a ogni render: il grafico vecchio va distrutto, non aggiornato.
  if (charts.catSubChart) { charts.catSubChart.destroy(); delete charts.catSubChart; }
  const visibili = subs.map((s, i) => ({ s, i })).filter(({ s }) => !catModal.sub || s.name === catModal.sub);
  const sc = scales();
  mkChart('catSubChart', { type: 'bar',
    data: { labels: MESI_3, datasets: visibili.map(({ s, i }) => ({ label: s.name, data: s.monthly.map(v => Math.round(v)), backgroundColor: colore(i) + 'cc', borderRadius: 3 })) },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { filter: ctx => ctx.raw > 0, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: { x: { ...sc.x, stacked: true }, y: { ...sc.y, stacked: true } } } });
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('catModal');
  if (!modal || modal.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); chiudiCategoria(); }
  if (e.key === 'ArrowLeft') stepCategoria(-1);
  if (e.key === 'ArrowRight') stepCategoria(1);
});
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'catModal') chiudiCategoria();
});
