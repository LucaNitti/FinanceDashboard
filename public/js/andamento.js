/* FinFlow — Sezione Flusso: flusso di cassa, sintesi, tabella mese per mese, categorie nel tempo. */
/* ============================================================
   UNA CATEGORIA NEL TEMPO
   ============================================================ */
function renderTrendSection(data) {
  const cats = getCats(data);
  selectedCats = selectedCats.filter(c => cats.includes(c));
  if (selectedCats.length === 0) selectedCats = cats.slice(0, Math.min(3, cats.length));
  const sel = document.getElementById('catSelectorEl');
  sel.innerHTML = cats.map((cat, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${selectedCats.includes(cat)}">${esc(cat)}</button>`).join('');
  sel.querySelectorAll('button').forEach(b => { b.onclick = () => toggleCat(cats[+b.dataset.i], b, data); });
  renderTrendChart(data);
}

/** Almeno una categoria resta sempre selezionata. */
function toggleCat(cat, btn, data) {
  if (selectedCats.includes(cat)) {
    if (selectedCats.length === 1) return;
    selectedCats = selectedCats.filter(c => c !== cat);
    btn.setAttribute('aria-pressed', 'false');
  } else {
    selectedCats.push(cat);
    btn.setAttribute('aria-pressed', 'true');
  }
  renderTrendChart(data);
}

/** Un piccolo grafico per categoria selezionata: barre mensili e media tratteggiata. */
function renderTrendChart(data) {
  const box = document.getElementById('trendSmall');
  if (!box) return;
  Object.keys(charts).filter(k => k.startsWith('trendSmall-')).forEach(k => { charts[k].destroy(); delete charts[k]; });
  const { inc, out } = getMonthly(data);
  const ultimo = Math.max(0, MONTHS.reduce((L, _, i) => inc[i] > 0 || out[i] > 0 ? i : L, 0));
  const labels = MESI_3.slice(0, ultimo + 1);
  const mesiMedia = mesiPerMedia(inc, out, activeYear, new Date());
  const dati = selectedCats.map(cat => {
    const monthly = Array(12).fill(0);
    data.filter(r => r.amount < 0 && r.cat === cat).forEach(r => { const m = parseMonth(r.date); if (m >= 0 && m < 12) monthly[m] += Math.abs(r.amount); });
    const tot = monthly.reduce((s, v) => s + v, 0);
    return { cat, monthly, tot, avg: Math.round(mediaCategoria(monthly, mesiMedia)) };
  });
  box.innerHTML = dati.map((d, i) => `<div class="piccolo">
      <div class="piccolo-testa"><span class="b">${esc(d.cat)}</span><span class="piccolo-media" title="Media mensile sui mesi chiusi, come in Categorie">media ${esc(activeYear)} ${fmt(d.avg)}</span></div>
      <div class="chart-wrap h-piccolo"><canvas id="trendSmall-${i}" role="img" aria-label="${esc(d.cat)} per mese nel ${esc(activeYear)}, media ${fmt(d.avg)}"></canvas></div>
      <div class="piccolo-tot">Totale ${fmt(d.tot)}</div>
    </div>`).join('');
  dati.forEach((d, i) => mkChart(`trendSmall-${i}`, { type: 'bar', data: { labels, datasets: [
    { type: 'bar', label: d.cat, data: d.monthly.slice(0, ultimo + 1).map(Math.round), backgroundColor: CHART_OUT, borderRadius: 2, barPercentage: .7, order: 2 },
    { type: 'line', label: 'Media', data: labels.map(() => d.avg), borderColor: TREND_COLORS[3], borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, order: 1 }
  ] }, options: { responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { displayColors: false, filter: c => c.datasetIndex === 0, callbacks: { label: c => fmt(c.raw) } } },
    scales: { x: { grid: { display: false }, border: { color: gc }, ticks: { color: tc, autoSkip: false, maxRotation: 0, callback(v, k) { return k === 0 || k === ultimo ? this.getLabelForValue(v) : ''; } } }, y: { display: false, beginAtZero: true } } } }));
}

/* ============================================================
   FLUSSO
   ============================================================ */
// 'competenza': la spesa nel mese in cui è fatta · 'cassa': le spese carta nel mese in cui escono dal conto
let flowMode = 'competenza';
function setFlowMode(mode) {
  if (mode === flowMode) return;
  flowMode = mode;
  const d = allData[activeYear] || [];
  renderFlowChart(d);
  renderFlowDettagli(d);
}

function renderFlowChart(data) {
  const { inc } = getMonthly(data);
  const cassa = flowMode === 'cassa';
  const { conto, card, hasCard } = getOutSplit(data, cassa);
  const prevM = getPrevisteMonthly(getPreviste());
  const prevInM = getEntratePrevisteMonthly(getPreviste());
  const hasPrev = prevM.some(v => v > 0), hasPrevIn = prevInM.some(v => v > 0);
  const net = inc.map((v, i) => Math.round(v - conto[i] - card[i] - prevM[i] + prevInM[i]));
  // Variazione reale del saldo conto: per cassa dovrebbe ricalcare il netto
  const dSaldo = cassa ? getSaldoDeltaMonthly().map(v => v === null ? null : Math.round(v)) : [];
  const hasSaldo = dSaldo.some(v => v !== null);
  const sc = scales();

  // Interruttore e testi: visibili solo se l'anno ha spese con carta
  const bar = document.getElementById('flowModeBar');
  if (bar) bar.style.display = hasCard ? '' : 'none';
  syncSeg('flowModeSeg', flowMode);
  const titolo = document.getElementById('flowTitolo');
  if (titolo) titolo.textContent = `Flusso di cassa ${activeYear}`;
  const sub = document.getElementById('flowSub');
  if (sub) sub.textContent = !hasCard ? 'Entrate, uscite e netto per mese. Le previste si sommano alle uscite.'
    : cassa ? 'Le spese con carta contano nel mese in cui vengono addebitate, cioè il mese dopo.'
    : 'Le spese con carta contano nel mese in cui le fai. Le previste si sommano alle uscite.';
  const legCard = document.getElementById('flowLegendCard'), legSaldo = document.getElementById('flowLegendSaldo'), legConto = document.getElementById('flowLegendConto');
  if (legCard) legCard.style.display = hasCard ? '' : 'none';
  if (legSaldo) legSaldo.style.display = (cassa && hasSaldo) ? '' : 'none';
  if (legConto) legConto.textContent = hasCard ? 'Uscite dal conto' : 'Uscite';

  // Tutto nella stessa pila: le entrate salgono, conto, carta e previste scendono
  mkChart('flowChart', { type: 'bar', plugins: [barreTratteggiate], data: { labels: MESI_3, datasets: [
    { label: 'Entrate', data: inc.map(Math.round), backgroundColor: CHART_IN, stack: 'flusso', barPercentage: .6 },
    ...(hasPrevIn ? [{ label: 'Entrate previste', data: prevInM.map(Math.round), backgroundColor: CHART_IN + '40', contorno: CHART_IN, stack: 'flusso', barPercentage: .6 }] : []),
    { label: hasCard ? 'Uscite dal conto' : 'Uscite', data: conto.map(v => -Math.round(v)), backgroundColor: CHART_OUT, stack: 'flusso', barPercentage: .6 },
    ...(hasCard ? [{ label: cassa ? 'Addebito carta' : 'Carta', data: card.map(v => -Math.round(v)), backgroundColor: cardColor(), stack: 'flusso', barPercentage: .6 }] : []),
    ...(hasPrev ? [{ label: 'Previste', data: prevM.map(v => -Math.round(v)), backgroundColor: TREND_COLORS[3] + '33', contorno: TREND_COLORS[3], stack: 'flusso', barPercentage: .6 }] : []),
    { label: 'Netto', data: net, type: 'line', borderColor: TREND_COLORS[0], backgroundColor: TREND_COLORS[0], pointBackgroundColor: TREND_COLORS[0], borderWidth: 2, pointRadius: 3, tension: 0 },
    ...(cassa && hasSaldo ? [{ label: 'Variazione reale del saldo', data: dSaldo, type: 'line', borderColor: TREND_COLORS[3], backgroundColor: 'transparent',
      borderDash: [4, 4], borderWidth: 1.5, pointBackgroundColor: TREND_COLORS[3], pointBorderColor: TREND_COLORS[3], pointStyle: 'rectRot', pointRadius: 4, spanGaps: false, tension: 0 }] : [])
  ]}, options: { responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { filter: c => c.raw !== null && c.raw !== 0, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.dataset.type === 'line' ? (ctx.raw || 0) : Math.abs(ctx.raw || 0))}` } } },
    scales: { x: { ...sc.x, stacked: true }, y: { ...sc.y, stacked: true } } } });
}

/** «da gennaio a ottobre» per un elenco di mesi in ordine. */
function periodoMesi(mesi) {
  const a = MONTHS_FULL[mesi[0]].toLowerCase(), b = MONTHS_FULL[mesi[mesi.length - 1]].toLowerCase();
  return mesi.length === 1 ? a : `da ${a} a ${b}`;
}

/** Riquadro «In sintesi» e tabella mese per mese: stessi numeri del grafico, nella stessa modalità. */
function renderFlowDettagli(data) {
  const { inc, out } = getMonthly(data);
  const cassa = flowMode === 'cassa';
  const { conto, card, hasCard } = getOutSplit(data, cassa);
  const uscite = conto.map((v, i) => v + card[i]);
  const prevM = getPrevisteMonthly(getPreviste());
  const prevInM = getEntratePrevisteMonthly(getPreviste());
  const incP = inc.map((v, i) => v + prevInM[i]);
  // (Entrate − Uscite − Previste) / Entrate × 100: le entrate previste contano come entrate
  const rates = incP.map((v, i) => v > 0 ? Math.round((v - uscite[i] - prevM[i]) / v * 1000) / 10 : null);
  const net = inc.map((v, i) => Math.round(v - uscite[i] - prevM[i] + prevInM[i]));
  const conDati = MONTHS.map((_, i) => i).filter(i => inc[i] > 0 || out[i] > 0);
  // Sintesi sui soli mesi chiusi con movimenti: il mese in corso ha già le entrate ma non tutte le spese
  const chiusi = mesiChiusi(activeYear, new Date()).filter(i => conDati.includes(i));
  const inCorso = conDati.filter(i => !chiusi.includes(i));
  const riep = riepilogoMesi(inc, uscite, chiusi);
  const tasso = tassoRisparmio(inc, uscite, chiusi);
  const best = riep.migliore, worst = riep.peggiore, positivi = riep.positivi;
  const tassoMese = i => { const t = tassoRisparmio(inc, uscite, [i]); return t === null ? '—' : quota(Math.round(t * 10) / 10).replace('-', '−'); };
  const cardSpese = getCardMonthly(data);
  const totCarta = cardSpese.reduce((s, v) => s + v, 0);
  const mesiCarta = cardSpese.filter(v => v > 0).length;
  const mesiPrevisti = MONTHS.map((_, i) => i).filter(i => !conDati.includes(i) && (prevM[i] > 0 || prevInM[i] > 0));
  const nomi = l => l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0];
  const nomiMesi = nomi(mesiPrevisti.map(i => MONTHS_FULL[i].toLowerCase()));
  const notaPreviste = mesiPrevisti.length
    ? `${nomiMesi[0].toUpperCase()}${nomiMesi.slice(1)} ${mesiPrevisti.length > 1 ? 'contano' : 'conta'} ${stimaMedie ? 'le voci previste e le spese medie.' : 'solo le voci previste, senza le spese medie: per questo il netto può risultare più alto.'}` : '';
  const riga = (a, b, v, cls = '') => `<div class="sintesi-riga"><span><span class="sintesi-nome">${a}</span>${b ? `<span class="sintesi-nota">${b}</span>` : ''}</span><span class="sintesi-val ${cls}">${v}</span></div>`;
  const sint = document.getElementById('flowSintesi');
  if (sint) sint.innerHTML = `<h2 class="section-title">In sintesi</h2>
    <div class="sintesi-blocco">${riga('Risparmio', chiusi.length ? `${periodoMesi(chiusi)}: risparmiato ${fmtS(riep.totale)} su ${fmt(chiusi.reduce((s, i) => s + inc[i], 0))} di entrate` : 'nessun mese chiuso', tasso === null ? '—' : quota(Math.round(tasso * 10) / 10).replace('-', '−'), 'grande')}</div>
    ${chiusi.length ? `<div class="sintesi-blocco">
      ${riga('Mese migliore', `${MONTHS_FULL[best].toLowerCase()}, risparmio ${tassoMese(best)}`, fmtS(inc[best] - uscite[best]), tone(inc[best] - uscite[best]))}
      ${riga('Mese peggiore', `${MONTHS_FULL[worst].toLowerCase()}, risparmio ${tassoMese(worst)}`, fmtS(inc[worst] - uscite[worst]), tone(inc[worst] - uscite[worst]))}
    </div>
    <div class="sintesi-blocco">
      ${riga('Mesi in positivo', chiusi.length > 1 ? periodoMesi(chiusi) : '', `${positivi} su ${chiusi.length}`)}
      ${totCarta > 0 ? riga('Pagato con carta', `media ${fmt(totCarta / mesiCarta)} al mese`, fmt(totCarta)) : ''}
    </div>` : ''}
    ${inCorso.length ? `<p class="sintesi-fine">${MONTHS_FULL[inCorso[0]]} è in corso: si vede nella tabella ma non entra nella sintesi.</p>` : ''}
    ${notaPreviste ? `<p class="sintesi-fine">${notaPreviste}</p>` : ''}`;

  const el = document.getElementById('flowTableEl');
  if (!el) return;
  const importo = v => v > 0 ? fmt(v) : '—';
  const rows = MONTHS_FULL.map((nome, i) => {
    const haDati = conDati.includes(i);
    const previsto = mesiPrevisti.includes(i);
    const vuoto = !haDati && !previsto;
    const pv = [prevM[i] > 0 ? fmt(prevM[i]) : '', prevInM[i] > 0 ? `<span class="pos">+${fmt(prevInM[i])}</span>` : ''].filter(Boolean).join(' ') || '—';
    return `<tr${vuoto ? ' class="ov-row vuoto"' : ''}>
      <th scope="row"${previsto ? ' class="prev"' : ''}>${nome}${previsto ? ' (previsto)' : inCorso.includes(i) ? ' (in corso)' : ''}</th>
      <td class="r pos">${importo(inc[i])}</td>
      <td class="r out">${importo(conto[i])}</td>
      ${hasCard ? `<td class="r t-carta">${importo(card[i])}</td>` : ''}
      <td class="r prev">${pv}</td>
      <td class="r b ${vuoto ? 'muted' : tone(net[i])}">${vuoto ? '—' : fmtS(net[i])}</td>
      <td class="r ${vuoto ? 'muted' : tone(net[i])}">${rates[i] === null ? '—' : quota(rates[i]).replace('-', '−')}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<thead><tr><th>Mese</th><th class="r">Entrate</th><th class="r">${hasCard ? 'Uscite dal conto' : 'Uscite'}</th>${hasCard ? `<th class="r">${cassa ? 'Carta (addebito del mese)' : 'Carta (spese del mese)'}</th>` : ''}<th class="r">Previste</th><th class="r">Netto</th><th class="r" title="(Entrate − Uscite − Previste) / Entrate × 100">Risparmio</th></tr></thead><tbody>${rows}</tbody>`;
  const nota = document.getElementById('flowTableNote');
  if (nota) nota.textContent = !cassa ? '' : 'Per cassa ogni mese mostra l\'addebito della carta del mese prima. Nel grafico la linea tratteggiata è la variazione reale del saldo del conto.'
    + (conDati.includes(0) && !(card[0] > 0) ? ` Gennaio non comprende l'addebito di dicembre ${parseInt(activeYear) - 1}: quell'anno le spese con carta non sono segnate.` : '');
}
