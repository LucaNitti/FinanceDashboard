/* FinFlow — Sezione Anni: confronto tra anni e stagionalità. */
/* ============================================================
   CONFRONTO ANNI
   ============================================================ */
/** Plugin Chart.js: una fascia sì e una no per distinguere gli anni in un grafico continuo (dataset.anni: anno di ogni punto). */
const fasceAnni = {
  id: 'fasceAnni',
  beforeDatasetsDraw(chart) {
    const anni = chart.data.datasets[0] && chart.data.datasets[0].anni;
    if (!anni) return;
    const x = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
    const passo = anni.length > 1 ? x.getPixelForValue(1) - x.getPixelForValue(0) : 0;
    const lista = [...new Set(anni)];
    ctx.save();
    ctx.fillStyle = cssVar('--surface-2', '#151D28');
    lista.forEach((y, k) => {
      if (k % 2) return;
      const a = anni.indexOf(y), b = anni.lastIndexOf(y);
      ctx.fillRect(x.getPixelForValue(a) - passo / 2, area.top, passo * (b - a + 1), area.bottom - area.top);
    });
    ctx.restore();
  }
};

/** Asse x di una serie continua: l'anno scritto a metà dei suoi punti. */
function tickAnni(anni) {
  const centro = {};
  [...new Set(anni)].forEach(y => { centro[Math.floor((anni.indexOf(y) + anni.lastIndexOf(y)) / 2)] = y; });
  return { color: tc, autoSkip: false, maxRotation: 0, callback: (_, i) => centro[i] || '' };
}

/** Colore di ogni anno nei grafici «per mese»: dall'ultimo al primo, gli anni vecchi sono più tenui. */
function coloreAnno(i, n) {
  const dalFondo = n - 1 - i;
  return [CHART_OUT, TREND_COLORS[3], TREND_COLORS[1]][dalFondo] || cssVar('--chart-muted', '#6B7A90');
}

function renderCompare() {
  const years = Object.keys(allData).sort();
  const incs = [], outs = [], prevs = [], prevIns = [], nets = [], tassi = [];
  const oggi = new Date();
  years.forEach(y => {
    const d = allData[y] || [];
    const i = d.filter(r => r.amount > 0).reduce((s,r) => s + r.amount, 0);
    const o = d.filter(r => r.amount < 0).reduce((s,r) => s + Math.abs(r.amount), 0);
    const p = getPrevisteMonthly(getPreviste(y)).reduce((s, v) => s + v, 0);   // aperte solo per l'anno in corso
    const pi = getEntratePrevisteMonthly(getPreviste(y)).reduce((s, v) => s + v, 0);
    // Risparmio sui mesi chiusi (per l'anno in corso senza il mese in corso e senza previste)
    const mm = getMonthly(d);
    tassi.push(tassoRisparmio(mm.inc, mm.out, mesiChiusi(y, oggi)));
    incs.push(Math.round(i)); outs.push(Math.round(o)); prevs.push(Math.round(p)); prevIns.push(Math.round(pi)); nets.push(Math.round(i - o - p + pi));
  });
  const hasPrev = prevs.some(v => v > 0) || prevIns.some(v => v > 0);
  const annoOra = String(new Date().getFullYear());

  // --- Titolo: quali anni, fin dove arriva l'anno in corso ---
  const sub = document.getElementById('compareSub');
  if (sub && years.length) {
    const { inc, out } = getMonthly(allData[annoOra] || []);
    const ultimo = MONTHS.reduce((L, _, i) => inc[i] > 0 || out[i] > 0 ? i : L, -1);
    const previsti = MONTHS.map((_, i) => i).filter(i => getPrevisteMonthly(getPreviste(annoOra))[i] > 0 || getEntratePrevisteMonthly(getPreviste(annoOra))[i] > 0);
    const nomi = previsti.map(i => MONTHS_FULL[i].toLowerCase());
    const elenco = nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : nomi[0];
    sub.textContent = `Dal ${years[0]} al ${years[years.length - 1]}.`
      + (allData[annoOra] && ultimo >= 0 ? ` Il ${annoOra} è aggiornato ${aMese(ultimo)}${elenco ? `; ${elenco} ${nomi.length > 1 ? 'sono previsti' : 'è previsto'}` : ''}.` : '');
  }

  // --- Riepilogo per anno ---
  const el = document.getElementById('compareTableEl');
  el.innerHTML = `<thead><tr><th>Anno</th><th class="r">Entrate</th><th class="r">Uscite</th>${hasPrev ? '<th class="r" title="Spese previste non ancora in banca e, col +, le entrate fisse attese">Previste</th>' : ''}<th class="r" title="${hasPrev ? 'Entrate − uscite − spese previste + entrate previste' : 'Entrate − uscite'}">Saldo</th><th class="r">Risparmio</th><th class="r">Bollette</th></tr></thead>
    <tbody>${years.map((y, i) => {
      const rate = tassi[i] === null ? null : Math.round(tassi[i] * 10) / 10;
      const bollTot = bolletteData.filter(b => b.anno === y).reduce((s, b) => s + b.importo, 0);
      const conPrev = prevs[i] > 0 || prevIns[i] > 0;
      const prevVal = [prevs[i] > 0 ? `−${fmt(prevs[i])}` : '', prevIns[i] > 0 ? `+${fmt(prevIns[i])}` : ''].filter(Boolean).join(' / ');
      const cTone = nets[i] >= 0 ? 'pos' : 'neg';
      return `<tr class="${y === annoOra ? 'anno-corrente' : ''}">
        <th scope="row">${y}</th>
        <td class="r pos">${fmt(incs[i])}</td>
        <td class="r out">${fmt(outs[i])}</td>
        ${hasPrev ? `<td class="r prev">${conPrev ? prevVal : '—'}</td>` : ''}
        <td class="r b ${cTone}">${conPrev ? 'circa ' : ''}${fmtS(nets[i])}</td>
        <td class="r ${rate === null ? 'muted' : tone(rate)}"${y === annoOra ? ' title="Sui mesi chiusi, senza il mese in corso e senza le previste"' : ''}>${rate === null ? '—' : quota(rate).replace('-', '−')}</td>
        <td class="r muted">${bollTot > 0 ? fmt(bollTot) : '—'}</td>
      </tr>`;
    }).join('')}</tbody>`;
  const nota = document.getElementById('compareNota');
  const iOra = years.indexOf(annoOra);
  if (nota) nota.textContent = iOra >= 0 && (prevs[iOra] > 0 || prevIns[iOra] > 0)
    ? `Per il ${annoOra} le previste sono ${fmt(prevs[iOra])} di uscite e ${fmt(prevIns[iOra])} di entrate nei mesi che restano. Il saldo è una stima.` : '';

  // --- Due barre per anno, con la previsione in tinta chiara ---
  const mx = Math.max(1, ...years.map((_, i) => Math.max(incs[i] + prevIns[i], outs[i] + prevs[i])));
  document.getElementById('compareBars').innerHTML = years.map((y, i) => `<div class="anno-barre">
      <div class="anno-barre-testa"><span class="b">${y}</span><span class="b ${nets[i] >= 0 ? 'pos' : 'neg'}">${fmtS(nets[i])}</span></div>
      <div class="anno-barre-corpo" aria-hidden="true">
        <span class="anno-barra" style="width:${((incs[i] + prevIns[i]) / mx * 100).toFixed(1)}%"><span class="b-in" style="flex:${incs[i] || 0}"></span><span class="b-in-prev" style="flex:${prevIns[i]}"></span></span>
        <span class="anno-barra" style="width:${((outs[i] + prevs[i]) / mx * 100).toFixed(1)}%"><span class="b-out" style="flex:${outs[i] || 0}"></span><span class="b-out-prev" style="flex:${prevs[i]}"></span></span>
      </div>
    </div>`).join('');
  const barsNota = document.getElementById('compareBarsNota');
  if (barsNota) barsNota.textContent = `Verde entrate, rosso uscite.${hasPrev ? ' La parte chiara è la previsione dei mesi che restano.' : ''}`;

  // --- Interruttore: nel tempo / per mese ---
  const isTimeline = compareMode === 'timeline';
  syncSeg('compareModeSeg', compareMode);
  document.getElementById('compareTempo').hidden = !isTimeline;
  document.getElementById('compareMese').hidden = isTimeline;
  const sc = scales();

  if (isTimeline) {
    // Una linea continua per entrate e una per uscite, con le fasce degli anni
    const punti = [];
    years.forEach(y => {
      const { inc, out } = getMonthly(allData[y] || []);
      const last = MONTHS.reduce((L, _, i) => inc[i] > 0 || out[i] > 0 ? i : L, -1);
      for (let m = 0; m <= last; m++) punti.push({ y, m, inc: Math.round(inc[m]), out: Math.round(out[m]) });
    });
    const anni = punti.map(p => p.y);
    const linea = (label, key, color) => ({ label, data: punti.map(p => p[key]), anni, borderColor: color, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: color, tension: 0 });
    mkChart('compareTimelineChart', { type: 'line', plugins: [fasceAnni],
      data: { labels: punti.map(p => `${MESI_3[p.m]} ${p.y}`), datasets: [linea('Entrate', 'inc', CHART_IN), linea('Uscite', 'out', CHART_OUT)] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw || 0)}` } } },
        scales: { x: { ...sc.x, ticks: tickAnni(anni) }, y: { ...sc.y, beginAtZero: true } } } });
    if (charts.compareTimelineChart) charts.compareTimelineChart.resize();
    const picchi = document.getElementById('comparePicchi');
    if (picchi && punti.length) {
      const pIn = punti.reduce((a, b) => b.inc > a.inc ? b : a), pOut = punti.reduce((a, b) => b.out > a.out ? b : a);
      picchi.textContent = `I picchi: entrate ${fmt(pIn.inc)} ${aMese(pIn.m)} ${pIn.y}, uscite ${fmt(pOut.out)} ${aMese(pOut.m)} ${pOut.y}.`;
    }
  } else {
    // Una linea per anno: l'anno selezionato più spesso
    const lineaAnno = (y, i, valueFn) => ({
      label: y,
      data: cutFuture(valueFn(allData[y] || []).map(Math.round), y),
      borderColor: coloreAnno(i, years.length),
      backgroundColor: 'transparent',
      borderWidth: y === activeYear ? 2.5 : 1.5, pointRadius: 0, pointHoverRadius: 4, tension: 0, fill: false
    });
    document.getElementById('compareAnniLegenda').innerHTML = years.map((y, i) => `<span><i class="leg-linea" style="background:${coloreAnno(i, years.length)}"></i>${y}</span>`).join('');
    const lineOptions = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { filter: c => c.raw !== null, callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw || 0)}` } } },
      scales: sc };
    const incSets = years.map((y, i) => lineaAnno(y, i, d => getMonthly(d).inc));
    const outSets = years.map((y, i) => lineaAnno(y, i, d => getMonthly(d).out));
    // Per l'anno con previste aperte: tratteggio "uscite + previste" nei mesi che ne hanno
    years.forEach(y => {
      const prevM = getPrevisteMonthly(getPreviste(y));
      if (!prevM.some(v => v > 0)) return;
      const out = getMonthly(allData[y] || []).out;
      const data = out.map((v, m) => prevM[m] > 0 ? Math.round(v + prevM[m]) : null);
      const first = prevM.findIndex(v => v > 0);
      if (first > 0) data[first - 1] = Math.round(out[first - 1]);
      outSets.push({ label: `${y} con le previste`, data, borderColor: TREND_COLORS[3], backgroundColor: 'transparent', borderDash: [4, 4], borderWidth: 1.5,
        pointRadius: 0, pointHoverRadius: 4, tension: 0, fill: false, spanGaps: true });
    });
    mkChart('compareMonthlyIncChart', { type: 'line', data: { labels: MESI_3, datasets: incSets }, options: lineOptions });
    mkChart('compareMonthlyOutChart', { type: 'line', data: { labels: MESI_3, datasets: outSets }, options: lineOptions });
    ['compareMonthlyIncChart', 'compareMonthlyOutChart'].forEach(k => { if (charts[k]) charts[k].resize(); });
  }

  // --- Saldo del conto: linea continua e atteso tratteggiato ---
  const series = getSaldoSeries();
  const saldoEl = document.getElementById('compareSaldoChartWrap');
  if (saldoEl) saldoEl.style.display = series.length ? '' : 'none';
  if (series.length) {
    const proj = getSaldoProjection(series);
    const anniS = series.map(p => p.year).concat(proj.map(p => p.year));
    const labels = series.map(p => `${MESI_3[p.monthIdx]} ${p.year}`).concat(proj.map(p => `${MESI_3[p.monthIdx]} ${p.year}`));
    const datasets = [{ label: 'Saldo', data: series.map(p => p.saldo), borderColor: TREND_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: TREND_COLORS[0], tension: 0 }];
    if (proj.length) datasets.push({ ...projectionDataset(series.length - 1, series[series.length - 1].saldo, proj), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 4, tension: 0 });
    mkChart('compareSaldoChart', { type: 'line', plugins: [zonaSottoZero], data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { filter: c => c.raw !== null, callbacks: { label: c => ` ${c.datasetIndex ? 'atteso ' : ''}${fmt(c.raw || 0)}` } } },
        scales: { x: { ...sc.x, ticks: tickAnni(anniS) }, y: sc.y } } });
    const saldoSub = document.getElementById('compareSaldoSub');
    if (saldoSub) saldoSub.textContent = proj.length
      ? `La linea tratteggiata è il saldo atteso ${stimaMedie ? 'con le voci previste e le spese medie' : 'contando solo le voci previste'}: ${proj.map(p => `${fmt(p.v)} ${aMese(p.monthIdx)}`).join(', ')}.`
      : 'Il saldo inserito nel foglio, mese per mese.';
  }

  renderSeasonalityChart();
}

function setCompareMode(mode) {
  if (mode === compareMode) return;
  compareMode = mode;
  renderCompare();
}

/**
 * Stagionalità: uscita tipica di ogni mese su tutti gli anni (barre, mediana: con 3 o 4 anni la media
 * la decide un solo mese eccezionale) + punti dell'anno selezionato. Solo mesi chiusi con movimenti.
 */
function renderSeasonalityChart() {
  const years = Object.keys(allData).sort();
  const valori = MONTHS.map(() => []);
  const oggi = new Date();
  years.forEach(y => {
    const { inc, out } = getMonthly(allData[y] || []);
    mesiChiusi(y, oggi).forEach(m => { if (out[m] > 0 || inc[m] > 0) valori[m].push(out[m]); });
  });
  const avg = valori.map(v => v.length ? Math.round(mediana(v)) : 0);
  const { out: curOut } = getMonthly(allData[activeYear] || []);
  const curLast = curOut.reduce((L, v, i) => v > 0 ? i : L, -1);
  const curLine = curOut.map((v, i) => i <= curLast ? Math.round(v) : null);

  const piuCaro = avg.reduce((a, v, i) => v > avg[a] ? i : a, 0);
  const sub = document.getElementById('seasonalitySub');
  const nomeMese = MONTHS_FULL[piuCaro];
  if (sub) sub.textContent = `Barre: uscita tipica di ogni mese (la mediana degli anni, così un mese eccezionale non sposta la barra). Puntini: il ${activeYear}. ${nomeMese} è di solito il mese più caro (${fmt(avg[piuCaro])}, su ${valori[piuCaro].length} ${valori[piuCaro].length === 1 ? 'anno' : 'anni'}).`;
  const sc = scales();
  mkChart('seasonalityChart', { type: 'bar', data: { labels: MESI_3, datasets: [
    { type: 'bar', label: 'Mediana degli anni', data: avg, backgroundColor: cssVar('--line-strong', '#2E3B50'), borderRadius: 3, order: 2 },
    { type: 'line', label: activeYear, data: curLine, showLine: false, borderColor: CHART_OUT, backgroundColor: CHART_OUT, pointBackgroundColor: CHART_OUT, pointBorderColor: CHART_OUT, pointRadius: 4, pointHoverRadius: 6, order: 1 }
  ]}, options: { responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { filter: c => c.raw !== null, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw || 0)}` } } },
    scales: { x: sc.x, y: { display: false, beginAtZero: true } } } });
}
