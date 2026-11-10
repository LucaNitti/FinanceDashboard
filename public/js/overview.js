/* FinFlow — Sezione Panoramica: KPI, grafici, dettaglio mese, widget previste e anomalie. */
/* ============================================================
   METRICS
   ============================================================ */
/** Schermo da telefono (stesso limite delle regole in fondo a style.css). */
function telefono() { return window.matchMedia('(max-width: 600px)').matches; }
// Freccia dei blocchi pieghevoli: si vede solo sul telefono, dove i blocchi partono chiusi
const segnoPiega = '<span class="piega-segno" aria-hidden="true">›</span>';

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

/**
 * Riquadro del mese: il mese scelto con le frecce (ovMonth, -1 = ultimo con dati) con entrate, uscite
 * e saldo, gli ultimi sei mesi e il confronto con lo stesso mese dell'anno prima.
 */
function renderMetrics(data) {
  const el = document.getElementById('metricsRow');
  if (!el) return;
  const { inc, out } = getMonthly(data);
  const prevM = getPrevisteMonthly(getPreviste());
  const prevInM = getEntratePrevisteMonthly(getPreviste());
  const withData = MONTHS.map((_, i) => i).filter(i => inc[i] > 0 || out[i] > 0);
  const now = new Date();
  const yearNum = parseInt(activeYear);
  const isCurrentYear = yearNum === now.getFullYear();

  if (!withData.length && !prevM.some(v => v > 0) && !prevInM.some(v => v > 0)) {
    el.innerHTML = `<div class="empty">Nessun movimento nel ${activeYear}.</div>`;
    return;
  }

  const m = withData.includes(ovMonth) ? ovMonth : withData.length ? withData[withData.length - 1] : (isCurrentYear ? now.getMonth() : 0);
  const isCurrentMonth = isCurrentYear && m === now.getMonth();
  const dayCap = isCurrentMonth ? now.getDate() : daysInMonth(yearNum, m);
  // Ultimo giorno del mese mostrato per cui esiste almeno un movimento
  const lastDay = data.reduce((mx, r) => parseMonth(r.date) === m ? Math.max(mx, parseDay(r.date)) : mx, 0);
  const lastLabel = lastDay
    ? `Ultimo movimento registrato: ${new Date(yearNum, m, lastDay).toLocaleDateString('it-IT', { weekday: 'long' })} ${lastDay} ${MONTHS_FULL[m].toLowerCase()}`
    : 'Nessun movimento registrato in questo mese';

  // Mese in corso: confronto a parità di giorni con l'anno prima
  const prevYear = String(yearNum - 1);
  const refData = (allData[prevYear] || []).filter(r => parseDay(r.date) <= dayCap);
  const { inc: rInc, out: rOut } = getMonthly(refData);
  const hasRef = rInc[m] > 0 || rOut[m] > 0;

  const curIn = inc[m] || 0, curOut = out[m] || 0, curPrev = prevM[m] || 0, curPrevIn = prevInM[m] || 0;
  const curCard = getCardMonthly(data)[m] || 0;
  const curBal = curIn - curOut - curPrev + curPrevIn;
  const conPreviste = curPrev > 0 || curPrevIn > 0;

  const pos = withData.indexOf(m);
  const noPrev = pos <= 0, noNext = pos < 0 || pos >= withData.length - 1;
  const nomeMese = i => MONTHS_FULL[i].toLowerCase();

  // Frase di confronto: stesso mese dell'anno prima e saldo da gennaio
  const inParole = pctParole(curIn, rInc[m]), outParole = pctParole(curOut, rOut[m]);
  const riferimento = isCurrentMonth ? `ai primi ${dayCap} giorni di ${nomeMese(m)} ${prevYear}` : `${aMese(m)} ${prevYear}`;
  const confronto = hasRef && (inParole || outParole)
    ? `Rispetto ${riferimento}: ${[inParole && `entrate ${inParole}`, outParole && `uscite ${outParole}`].filter(Boolean).join(', ')}. ` : '';
  // Il mese in corso resta fuori da totali e medie: ha già lo stipendio ma non tutte le spese
  const chiusi = mesiChiusi(yearNum, now);
  const chiusiFinoA = chiusi.filter(i => i <= m);
  const daGennaio = riepilogoMesi(inc, out, chiusiFinoA).totale;
  const ultimoChiuso = chiusiFinoA[chiusiFinoA.length - 1];
  const fraseGennaio = !withData.length || !chiusiFinoA.length ? ''
    : ultimoChiuso === m ? `Da gennaio la differenza è di ${fmtS(daGennaio)}. `
    : `Da gennaio ${ultimoChiuso > 0 ? `a ${nomeMese(ultimoChiuso)} ` : ''}la differenza è di ${fmtS(daGennaio)}, senza ${nomeMese(m)} che è in corso. `;

  // Gli ultimi sei mesi con movimenti, fino all'ultimo dell'anno
  const sei = withData.slice(-6);
  const maxSei = Math.max(1, ...sei.flatMap(i => [inc[i], out[i]]));
  const cardM = getCardMonthly(data);
  const seiRighe = sei.map(i => {
    const net = inc[i] - out[i];
    const inCorso = !chiusi.includes(i);
    return `<div class="sei-riga${i === m ? ' corrente' : ''}${inCorso ? ' in-corso' : ''}" title="${MONTHS_FULL[i]}${inCorso ? ' (in corso, fuori dalla media)' : ''}: entrate ${fmt(inc[i])}, uscite ${fmt(out[i])}${cardM[i] > 0 ? `, di cui carta ${fmt(cardM[i])}` : ''}">
      <span class="sei-mese">${MESI_3[i]}${inCorso ? '<span class="sei-corso">in corso</span>' : ''}</span>
      <span class="sei-barre" aria-hidden="true">
        <span class="sei-in" style="width:${(inc[i] / maxSei * 100).toFixed(1)}%"></span>
        <span class="sei-out" style="width:${(out[i] / maxSei * 100).toFixed(1)}%"><span style="flex:${Math.max(0, out[i] - cardM[i]).toFixed(0)}"></span><span class="sei-carta" style="flex:${cardM[i].toFixed(0)}"></span></span>
      </span>
      <span class="sei-net ${tone(net)}">${fmtS(net)}</span>
    </div>`;
  }).join('');
  const seiChiusi = sei.filter(i => chiusi.includes(i));
  // Sul telefono categorie e sei mesi partono chiusi: la scheda del saldo arriva subito dopo le tre cifre
  const aperto = telefono() ? '' : ' open';
  const mediaSei = riepilogoMesi(inc, out, seiChiusi).media;

  el.innerHTML = `
    <div class="ov-mese-testa">
      <div>
        <h1 class="page-title">${MONTHS_FULL[m]} ${activeYear}</h1>
        <p class="page-sub">${lastLabel}</p>
      </div>
      <div class="freccette">
        <button type="button" class="btn-sm freccia" onclick="stepMese(-1)" ${noPrev ? 'disabled' : ''} aria-label="${noPrev ? 'Nessun mese precedente' : `Mese precedente: ${nomeMese(withData[pos - 1])}`}">‹</button>
        <button type="button" class="btn-sm freccia" onclick="stepMese(1)" ${noNext ? 'disabled' : ''} aria-label="${noNext ? 'Nessun mese successivo con movimenti' : `Mese successivo: ${nomeMese(withData[pos + 1])}`}">›</button>
      </div>
    </div>
    <div class="ov-mese-corpo">
      <div class="ov-mese-sx">
      <dl class="tre-cifre">
        <div>
          <dt>Entrate</dt>
          <dd class="cifra pos">${curIn > 0 ? fmt(curIn) : '—'}</dd>
        </div>
        <div>
          <dt>Uscite</dt>
          <dd class="cifra-con-nota">
            <span class="cifra out">${curOut > 0 ? fmt(curOut) : '—'}</span>
            ${curCard > 0 ? `<span class="cifra-nota" title="Spese con carta: addebito sul conto ${cardDebitLabel(m) === MONTHS_FULL[m + 1]?.toLowerCase() ? aMese(m + 1) : 'a ' + cardDebitLabel(m)}"><span>conto ${fmt(curOut - curCard)}</span><span>carta ${fmt(curCard)} (${Math.round(curCard / curOut * 100)}%)</span></span>` : ''}
          </dd>
        </div>
        <div class="tre-saldo">
          <dt>${conPreviste ? 'Differenza stimata' : 'Differenza'}</dt>
          <dd class="cifra forte ${curBal >= 0 ? 'pos' : 'neg'}">${conPreviste ? '≈ ' : ''}${fmtS(curBal)}</dd>
          <dd class="cifra-sotto">${conPreviste ? `entrate meno uscite a fine mese, con quanto è ancora ${stimaMedie ? 'previsto e le spese medie' : 'previsto'}` : 'entrate meno uscite del mese'}</dd>
        </div>
      </dl>
      ${bloccoCategorieMese(data, m, isCurrentMonth, aperto)}
      </div>
      ${sei.length ? `<details class="ov-sei ov-piega"${aperto}>
        <summary><h2 class="blocco-titolo">Gli ultimi sei mesi</h2>${segnoPiega}</summary>
        <p class="section-sub">Barra verde entrate, barra rossa uscite, a destra la differenza.</p>
        <div class="sei-lista">${seiRighe}</div>
        ${seiChiusi.length ? `<div class="sei-media"><span>Media mensile differenza${seiChiusi.length < sei.length ? `<span class="sei-media-nota">${seiChiusi.length === 1 ? 'sul mese chiuso' : `sui ${seiChiusi.length} mesi chiusi`}</span>` : ''}</span><span class="b ${tone(mediaSei)}">${fmtS(mediaSei)}</span></div>` : ''}
      </details>` : ''}
    </div>
    <p class="ov-confronto">${confronto}${fraseGennaio}${withData.includes(m) ? `<button type="button" class="link-btn link-acc" onclick="openMeseModal(${m})">Dettaglio del mese</button>` : ''}</p>`;
}

/**
 * Le 6 categorie con più uscite nel mese, ognuna con la barra e la tacca della sua media mensile
 * nell'anno (medieCategorie: mesi chiusi). Nel mese in corso niente percentuale: pochi giorni di
 * spesa contro un mese intero sembrerebbero un risparmio. '' se nel mese non ci sono uscite.
 */
function bloccoCategorieMese(data, m, inCorso, aperto = ' open') {
  const { perNome } = medieCategorie(data);
  const top = getExpenseCategorySummary(data)
    .filter(c => c.monthly[m] > 0)
    .map(c => ({ name: c.name, v: c.monthly[m], media: perNome[c.name] || 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 6);
  if (!top.length) return '';
  const max = Math.max(...top.flatMap(c => [c.v, c.media]));
  // La tacca è bianca sul fondo scuro; nel tema chiaro si vede solo scura (--tacca)
  const tacca = document.documentElement.getAttribute('data-theme') === 'light' ? 'tacca scura' : 'tacca bianca';
  const differenza = (v, media) => {
    if (inCorso) return media > 0 ? `<span class="muted">di solito ${fmt(media)}</span>` : '<span class="muted">di solito nulla</span>';
    if (!(media > 0)) return '<span class="muted">non di solito</span>';
    const pct = (v - media) / media * 100;
    if (Math.abs(pct) < 5) return '<span class="muted">nella media</span>';
    return `<span class="${pct > 0 ? 'neg' : 'pos'}">${pctS(Math.round(pct))}</span>`;
  };
  return `<details class="cat-mese ov-piega"${aperto}>
    <summary class="cat-mese-testa">
      <h2 class="blocco-titolo">Uscite di ${MONTHS_FULL[m].toLowerCase()} per categoria${inCorso ? ', finora' : ''}</h2>
      <span class="cat-mese-nota">${tacca}: media ${esc(activeYear)}</span>${segnoPiega}
    </summary>
    <div class="cat-mese-griglia">${top.map(c => `<div class="cat-mese-riga" title="${esc(c.name)}: ${fmt(c.v)}, media ${esc(activeYear)} ${fmt(c.media)}">
      <div class="cat-mese-sopra"><span class="cat-mese-nome">${esc(c.name)}</span>${differenza(c.v, c.media)}</div>
      <span class="cat-mese-barra" aria-hidden="true"><span class="cat-mese-pieno" style="width:${(c.v / max * 100).toFixed(1)}%"></span><span class="cat-mese-tacca" style="left:${(c.media / max * 100).toFixed(1)}%"></span></span>
      <span class="cat-mese-val">${fmt(c.v)}${inCorso ? '<span class="cat-mese-finora"> finora</span>' : ''}</span>
    </div>`).join('')}</div>
  </details>`;
}

/**
 * Le voci che portano dall'ultimo saldo inserito al saldo previsto, divise per riga: sono le righe dei
 * punti di getSaldoProjection (proiezioneSaldo in calcoli.js), quindi sommano esattamente al saldo.
 * Il mese d'arrivo è il primo proiettato dal mese in corso in poi.
 */
function calcoloSaldoPrevisto(series, proj) {
  const yr = String(new Date().getFullYear());
  const cur = series.filter(p => p.year === yr);
  const last = cur[cur.length - 1];
  const target = proj.find(p => p.monthIdx >= new Date().getMonth()) || proj[0];
  return { last, target, ...righeSaldoPrevisto(proj, target.monthIdx) };
}

/**
 * Riquadro a destra: anno in corso con previsioni → saldo previsto con il calcolo riga per riga
 * e il grafico del conto; altrimenti il saldo del conto e il saldo entrate/uscite dell'anno.
 */
function renderSaldoCard() {
  const el = document.getElementById('saldoCard');
  if (!el) return;
  const { inc, out } = getMonthly(allData[activeYear] || []);
  const last = MONTHS.reduce((L, _, i) => inc[i] > 0 || out[i] > 0 ? i : L, -1);
  const series = getSaldoSeries();
  const delAnno = series.filter(p => p.year === activeYear);
  const now = new Date();
  const annoCorrente = parseInt(activeYear) === now.getFullYear();
  // Il numero grande conta sempre le spese medie; la forchetta mostra anche le sole voci previste
  const projMedie = annoCorrente ? getSaldoProjection(series, true) : [];
  const projSolo = annoCorrente ? getSaldoProjection(series, false) : [];
  const proj = projMedie.length ? projMedie : projSolo;
  if (charts.saldoSpark) { charts.saldoSpark.destroy(); delete charts.saldoSpark; }
  if (last < 0 && !delAnno.length && !proj.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const previsto = proj.length > 0 && delAnno.length > 0;
  el.classList.toggle('ov-saldo-prev', previsto);

  const riga = (label, valore, cls = '', title = '') => `<div${title ? ` title="${title}"` : ''}><dt>${label}</dt><dd class="${cls}">${valore}</dd></div>`;
  const meno = v => `− ${fmt(Math.abs(v))}`;
  const grafico = `<div class="chart-wrap h-mini"><canvas id="saldoSpark" role="img" aria-label="Saldo del conto mese per mese${previsto ? ', con la previsione tratteggiata' : ''}"></canvas></div>`;
  const totIn = inc.reduce((s, v) => s + v, 0), totOut = out.reduce((s, v) => s + v, 0);
  const bal = totIn - totOut;

  if (previsto) {
    const c = calcoloSaldoPrevisto(series, proj);
    const fine = proj[proj.length - 1];
    const soloTarget = projSolo.find(p => p.monthIdx === c.target.monthIdx);
    const soloFine = projSolo.find(p => p.monthIdx === fine.monthIdx);
    const forchetta = soloTarget && soloTarget.v !== c.target.v;
    const carta = c.addebitoDi.length === 1 ? `Addebito carta di ${MONTHS_FULL[c.addebitoDi[0]].toLowerCase()}` : 'Addebiti della carta';
    const mesiReg = c.target.monthIdx === c.last.monthIdx + 1 ? MONTHS_FULL[c.target.monthIdx].toLowerCase() : `da ${MONTHS_FULL[c.last.monthIdx + 1].toLowerCase()} a ${MONTHS_FULL[c.target.monthIdx].toLowerCase()}`;
    el.innerHTML = `
      <h2 class="saldo-titolo">Saldo previsto a fine ${MONTHS_FULL[c.target.monthIdx].toLowerCase()}</h2>
      <div class="saldo-cifra ${c.target.v < 0 ? 'neg' : 'prev'}">${fmtS(c.target.v)}</div>
      ${forchetta ? `<p class="saldo-forchetta">Tra ${fmtS(Math.min(c.target.v, soloTarget.v))} e ${fmtS(Math.max(c.target.v, soloTarget.v))}</p>` : ''}
      <p class="saldo-nota">Contando ${c.nVoci === 1 ? 'la voce prevista' : `le ${c.nVoci} voci previste`}${c.medie > 0 ? ' e le spese medie per categoria' : ''}.${forchetta ? ` Con le sole voci previste sarebbe ${fmtS(soloTarget.v)}.` : ''}</p>
      <dl class="saldo-righe">
        ${riga(`Sul conto a fine ${MONTHS_FULL[c.last.monthIdx].toLowerCase()}`, fmt(c.last.saldo))}
        ${Math.round(c.registrati) ? riga(`Movimenti già registrati ${mesiReg === MONTHS_FULL[c.target.monthIdx].toLowerCase() ? 'di ' + mesiReg : mesiReg}`, c.registrati >= 0 ? `+ ${fmt(c.registrati)}` : meno(c.registrati), c.registrati >= 0 ? 'pos' : 'neg', 'Entrate meno uscite dal conto già nel foglio, le spese con carta escono il mese dopo') : ''}
        ${riga('Entrate attese', `+ ${fmt(c.entrate)}`, 'pos')}
        ${riga('Voci previste', meno(c.voci), 'neg')}
        ${c.medie > 0 ? riga('Spese medie del mese', meno(c.medie), 'neg', 'Mediana degli ultimi 12 mesi per categoria, meno le previste e quanto già speso') : ''}
        ${c.addebito > 0 ? riga(carta, meno(c.addebito), 'neg') : ''}
      </dl>
      <div class="saldo-grafico">
        ${grafico}
        ${fine !== c.target ? `<p class="saldo-nota">A fine ${MONTHS_FULL[fine.monthIdx].toLowerCase()} il conto arriva a ${fmtS(fine.v)}${soloFine && soloFine.v !== fine.v ? ` (${fmtS(soloFine.v)} con le sole voci previste)` : ''}.</p>` : ''}
      </div>`;
  } else {
    const conto = delAnno[delAnno.length - 1];
    const nowM = now.getMonth();
    const pendingCard = annoCorrente ? getCardMonthly(allData[activeYear])[nowM] : 0;
    el.innerHTML = `
      <h2 class="saldo-titolo">${conto ? `Sul conto a fine ${MONTHS_FULL[conto.monthIdx].toLowerCase()} ${activeYear}` : `Saldo entrate/uscite ${activeYear}`}</h2>
      <div class="saldo-cifra ${(conto ? conto.saldo : bal) < 0 ? 'neg' : 'tx'}">${conto ? fmt(conto.saldo) : fmtS(bal)}</div>
      <dl class="saldo-righe">
        ${riga(`Entrate ${activeYear}`, `+ ${fmt(totIn)}`, 'pos')}
        ${riga(`Uscite ${activeYear}`, meno(totOut), 'neg')}
        ${conto ? riga(`Saldo entrate/uscite ${activeYear}`, fmtS(bal), tone(bal)) : ''}
        ${pendingCard > 0 ? riga(`Carta di ${MONTHS_FULL[nowM].toLowerCase()}, addebito a ${cardDebitLabel(nowM)}`, meno(pendingCard), 'neg') : ''}
      </dl>
      ${delAnno.length ? `<div class="saldo-grafico">${grafico}</div>` : ''}`;
  }
  if (!delAnno.length) return;

  // Grafico: saldo inserito del mese, poi la previsione tratteggiata dall'ultimo punto reale
  const reale = Array(12).fill(null);
  delAnno.forEach(p => { reale[p.monthIdx] = p.saldo; });
  const ultimo = delAnno[delAnno.length - 1].monthIdx;
  const atteso = Array(12).fill(null);
  if (previsto) { atteso[ultimo] = reale[ultimo]; proj.forEach(p => { atteso[p.monthIdx] = p.v; }); }
  const fineAsse = previsto ? proj[proj.length - 1].monthIdx : ultimo;
  const prevColor = TREND_COLORS[3];
  mkChart('saldoSpark', {
    type: 'line',
    plugins: [zonaSottoZero],
    data: { labels: MESI_3.slice(0, fineAsse + 1), datasets: [
      { data: reale.slice(0, fineAsse + 1), borderColor: TREND_COLORS[0], borderWidth: 2, pointRadius: 0, tension: 0, spanGaps: true },
      ...(previsto ? [{ data: atteso.slice(0, fineAsse + 1), borderColor: prevColor, borderWidth: 2, borderDash: [5, 4], tension: 0, spanGaps: true,
        pointRadius: ctx => ctx.dataIndex === proj[0].monthIdx ? 3 : 0, pointBackgroundColor: prevColor, pointBorderColor: prevColor }] : [])
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false, filter: c => c.raw !== null, callbacks: { label: c => fmt(c.raw) } } },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4 } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: tc, autoSkip: false, maxRotation: 0,
          callback(v, i) { return i === 0 || i === ultimo || i === fineAsse ? this.getLabelForValue(v) : ''; } } },
        y: { display: false, suggestedMin: 0 }
      } }
  });
}

/** Popup del dettaglio mese: aperto da una riga del riepilogo. */
function openMeseModal(m) {
  const modal = document.getElementById('meseModal');
  if (!modal) return;
  if (typeof m === 'number') ovMonth = m;
  ricordaFocus(modal);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const data = allData[activeYear] || [];
  renderMeseDetail(data);
  renderMetrics(data);
  const btn = document.getElementById('meseChiudi');
  if (btn) btn.focus();
}
function closeMeseModal() {
  const modal = document.getElementById('meseModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  restituisciFocus(modal);
}
/** Mese precedente o successivo con movimenti: vale per il riquadro del mese e per il dialogo. */
function stepMese(delta) {
  const data = allData[activeYear] || [];
  const { inc, out } = getMonthly(data);
  const withData = MONTHS.map((_, i) => i).filter(i => inc[i] > 0 || out[i] > 0);
  if (!withData.length) return;
  const pos = withData.indexOf(ovMonth);
  const from = pos < 0 ? withData.length - 1 : pos;
  const next = withData[Math.min(withData.length - 1, Math.max(0, from + delta))];
  if (next === ovMonth || (pos < 0 && next === withData[from])) return;
  ovMonth = next;
  renderMetrics(data);
  const modal = document.getElementById('meseModal');
  if (modal && !modal.hidden) renderMeseDetail(data);
}

/* ============================================================
   PANORAMICA CHARTS
   ============================================================ */
function renderMonthlyChart(data) {
  const { inc, out } = getMonthly(data);
  // Quota carta: banda fra la linea uscite e la linea "uscite conto"
  const { conto, card, hasCard } = getOutSplit(data, false);
  const legCard = document.getElementById('monthlyLegendCard');
  if (legCard) legCard.style.display = hasCard ? '' : 'none';
  // Saldo con le previste aperte; uscite + previste (ed entrate + previste) tratteggiate nei mesi che ne hanno
  const prevM = getPrevisteMonthly(getPreviste());
  const prevInM = getEntratePrevisteMonthly(getPreviste());
  const net = inc.map((value, index) => Math.round(value - out[index] - prevM[index] + prevInM[index]));
  // I mesi con sole previsioni hanno la barra tratteggiata, gli altri quella piena
  const soloPrevisto = i => !(inc[i] > 0 || out[i] > 0) && (prevM[i] > 0 || prevInM[i] > 0);
  const conPreviste = (base, add) => {
    const line = base.map((v, i) => add[i] > 0 ? Math.round(v + add[i]) : null);
    const first = add.findIndex(v => v > 0);
    if (first > 0) line[first - 1] = Math.round(base[first - 1]);   // ancora sulla linea reale
    return first >= 0 ? line : null;
  };
  const outPrev = conPreviste(out, prevM), incPrev = conPreviste(inc, prevInM);
  const legPrevIn = document.getElementById('monthlyLegendPrevIn');
  if (legPrevIn) legPrevIn.style.display = incPrev ? '' : 'none';
  // Le linee reali finiscono all'ultimo mese con movimenti, non scendono a zero nei mesi ancora vuoti
  const ultimoDato = inc.reduce((L, v, i) => v > 0 || out[i] > 0 ? i : L, -1);
  const finoAlDato = valori => valori.map((v, i) => i > ultimoDato ? null : Math.round(v));
  const netColore = TREND_COLORS[0];
  const linea = (label, data, color, extra = {}) => ({ type: 'line', label, data, borderColor: color, backgroundColor: 'transparent',
    pointBackgroundColor: color, pointBorderColor: color, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2, tension: 0, ...extra });
  mkChart('monthlyChart', {
    type: 'bar',
    plugins: [barreTratteggiate],
    data: {
      labels: MESI_3,
      datasets: [
        { type: 'bar', label: 'Differenza', grouped: false, data: net.map((v, i) => soloPrevisto(i) ? null : v),
          backgroundColor: net.map(v => v >= 0 ? netColore + 'b3' : CHART_OUT + '73'), borderRadius: 3, barPercentage: .4, order: 3 },
        { type: 'bar', label: 'Differenza prevista', grouped: false, data: net.map((v, i) => soloPrevisto(i) ? v : null),
          backgroundColor: 'transparent', contorno: TREND_COLORS[3], barPercentage: .4, order: 3 },
        linea('Entrate', finoAlDato(inc), CHART_IN, { order: 1 }),
        linea('Uscite', finoAlDato(out), CHART_OUT, { order: 2 }),
        ...(hasCard ? [linea('Uscite conto', finoAlDato(conto), cardColor(), { borderWidth: 1, pointRadius: 0, pointHoverRadius: 0,
          fill: { target: 3, above: cardColor() + 'aa', below: cardColor() + 'aa' }, order: 2 })] : []),   // 3 = dataset Uscite
        ...(outPrev ? [linea('Uscite previste', outPrev, TREND_COLORS[3], { borderDash: [5, 4], spanGaps: true, order: 0 })] : []),
        ...(incPrev ? [linea('Entrate previste', incPrev, CHART_IN, { borderDash: [5, 4], spanGaps: true, order: 0 })] : [])
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: item => item.dataset.label !== 'Uscite conto' && item.raw !== null,
          callbacks: {
            label(context) {
              return ` ${context.dataset.label}: ${fmt(context.raw || 0)}`;
            },
            afterLabel(context) {
              if (context.dataset.label !== 'Uscite' || !hasCard) return '';
              const c = card[context.dataIndex], o = out[context.dataIndex];
              return c > 0 ? `   di cui carta ${fmt(c)} (${Math.round(c / o * 100)}%)` : '';
            }
          }
        }
      },
      scales: scales()
    }
  });
}

function setPatrimonioMode(mode) {
  if (mode === patrimonioMode) return;
  patrimonioMode = mode;
  renderPatrimonioChart();
}

function renderPatrimonioChart() {
  const card = document.getElementById('patrimonioCard');
  const series = getSaldoSeries();
  if (!series.length) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = '';
  syncSeg('patrimonioModeSeg', patrimonioMode);
  const annoBtn = document.getElementById('patrimonioAnnoBtn');
  if (annoBtn) annoBtn.textContent = `Solo il ${activeYear}`;
  // Vista annuale: i mesi dell'anno selezionato, partendo dalla chiusura dell'anno prima
  const idxs = series.map((p, i) => p.year === activeYear ? i : -1).filter(i => i >= 0);
  const anno = patrimonioMode === 'anno' && idxs.length;
  const shown = anno ? series.slice(Math.max(0, idxs[0] - 1), idxs[idxs.length - 1] + 1) : series;
  const titolo = document.getElementById('patrimonioTitolo');
  if (titolo) titolo.textContent = anno ? `Il conto nel ${activeYear}` : `Il conto dal ${series[0].year}`;
  const picco = shown.reduce((a, b) => b.saldo > a.saldo ? b : a);
  const ultimo = shown[shown.length - 1];
  const sub = document.getElementById('patrimonioSub');
  if (sub) sub.textContent = `Il punto più alto è ${fmt(picco.saldo)} ${aMese(picco.monthIdx)} ${picco.year}. A fine ${MONTHS_FULL[ultimo.monthIdx].toLowerCase()} ${ultimo.year} il conto è a ${fmt(ultimo.saldo)}.`;
  // Linea unica continua: l'anno selezionato nel colore del saldo, gli altri attenuati
  const anni = shown.map(p => p.year);
  const colore = y => y === activeYear ? TREND_COLORS[0] : cssVar('--chart-muted', '#6B7A90');
  const dataset = { label: 'Saldo', data: shown.map(p => p.saldo), borderColor: TREND_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: anno ? 3 : 0,
    pointHoverRadius: 5, pointBackgroundColor: anni.map(colore), pointBorderColor: anni.map(colore), tension: 0, fill: false, spanGaps: true,
    segment: { borderColor: ctx => colore(anni[ctx.p1DataIndex] ?? anni[ctx.p0DataIndex]) } };
  // Coda tratteggiata: saldo atteso al netto delle spese previste (solo se la vista arriva all'ultimo punto)
  const allProj = getSaldoProjection(series);
  const proj = shown[shown.length - 1] === series[series.length - 1] ? allProj : [];
  const labels = shown.map(p => `${MESI_3[p.monthIdx]} ${p.year.slice(2)}`).concat(proj.map(p => `${MESI_3[p.monthIdx]} ${p.year.slice(2)}`));
  const datasets = proj.length ? [dataset, { ...projectionDataset(shown.length - 1, shown[shown.length - 1].saldo, proj), pointRadius: 0, pointHoverRadius: 5, borderWidth: 2, tension: 0, borderDash: [5, 4] }] : [dataset];
  const sc = scales();
  mkChart('patrimonioChart', { type: 'line',
    plugins: [zonaSottoZero],
    data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { filter: c => c.raw !== null, callbacks: { label: ctx => ` ${ctx.datasetIndex === 1 ? 'atteso ' : ''}${fmt(ctx.raw || 0)}` } } },
      scales: { x: { ...sc.x, ticks: { ...sc.x.ticks, autoSkip: true, maxTicksLimit: 10, maxRotation: 0 } }, y: sc.y } } });
  const legend = document.getElementById('patrimonioLegend');
  if (legend) legend.innerHTML = `<span><i class="leg-linea s-net"></i>${esc(activeYear)}</span>${anno ? '' : '<span><i class="leg-linea s-muted"></i>Altri anni</span>'}${proj.length ? `<span><i class="leg-trat s-prev"></i>Saldo ${attesoLabel()}</span>` : ''}`;
}

/**
 * Tabella unica della Panoramica: entrate, uscite e differenza del mese, saldo inserito nel foglio,
 * saldo calcolato dai movimenti e scarto. Nei mesi con previsioni entrate e uscite le comprendono.
 */
function renderOverviewMonthlyTable(data) {
  const el = document.getElementById('overviewMonthlyTable');
  if (!el) return;
  const titolo = document.getElementById('mesiTitolo');
  if (titolo) titolo.textContent = `Il ${activeYear} mese per mese`;
  const { inc, out } = getMonthly(data);
  const cardM = getCardMonthly(data);
  const previste = getPreviste();
  const prevM = getPrevisteMonthly(previste);
  const prevInM = getEntratePrevisteMonthly(previste);
  const now = new Date();
  const isCurrentYear = parseInt(activeYear) === now.getFullYear();
  const currentMonth = now.getMonth();
  const withData = MONTHS.map((_, i) => i).filter(i => inc[i] > 0 || out[i] > 0);
  // Il totale considera solo i mesi fino all'ultimo con dati reali: le previste dei
  // mesi futuri (senza ancora entrate/uscite) non vanno sommate al saldo a consuntivo.
  const lastDataIdx = withData.length ? Math.max(...withData) : (isCurrentYear ? currentMonth : 11);
  const totIn = inc.reduce((s, v) => s + v, 0);
  const totOut = out.reduce((s, v) => s + v, 0);
  const totPrev = prevM.reduce((s, v, i) => i <= lastDataIdx ? s + v : s, 0);
  const totPrevIn = prevInM.reduce((s, v, i) => i <= lastDataIdx ? s + v : s, 0);
  const totBal = totIn - totOut - totPrev + totPrevIn;   // saldo con le previste aperte

  // Saldo inserito e calcolato per mese dell'anno; previsto dalla proiezione
  const series = getSaldoSeries();
  const calcolato = getSaldoCalcolato(series);
  const saldi = {};
  series.forEach((p, i) => { if (p.year === activeYear) saldi[p.monthIdx] = { saldo: p.saldo, calc: calcolato[i] }; });
  const attesi = {};
  getSaldoProjection(series).filter(p => p.year === activeYear).forEach(p => { attesi[p.monthIdx] = p.v; });

  const SOGLIA = 5, EVIDENZA = 50; // sotto i 5 € è arrotondamento; oltre i 50 € lo scarto si vede
  const scartoCell = d => d === null ? '<td class="r muted">—</td>'
    : Math.abs(d) < SOGLIA ? '<td class="r muted">0</td>'
    : `<td class="r ${Math.abs(d) > EVIDENZA ? 'prev' : 'muted'}">${fmtS(d)}</td>`;
  const circa = (v, p) => `${p > 0 ? '≈ ' : ''}${v > 0 ? fmt(v) : '—'}`;
  let totScarto = 0;

  const rows = MONTHS_FULL.map((nome, i) => {
    const hasData = inc[i] > 0 || out[i] > 0;
    const p = prevM[i], pi = prevInM[i], haPrev = p > 0 || pi > 0;
    const bal = inc[i] - out[i] - p + pi;
    const s = saldi[i];
    const scarto = s && s.calc !== null ? s.saldo - s.calc : null;
    if (scarto !== null) totScarto += scarto;
    const solo = !hasData && haPrev;
    const etichetta = solo ? `${nome} (previsto)` : hasData && haPrev ? `${nome} (in parte previsto)` : nome;
    const mese = hasData
      ? `<button type="button" class="mese-link" onclick="openMeseModal(${i})" aria-label="Apri il dettaglio di ${nome}">${etichetta}</button>`
      : `<span class="mese-link-no">${etichetta}</span>`;
    const titoloOut = [cardM[i] > 0 ? `di cui ${fmt(cardM[i])} con carta, addebito a ${cardDebitLabel(i)}` : '', p > 0 ? `di cui ${fmt(p)} previste` : ''].filter(Boolean).join(' · ');
    const saldo = s ? `<td class="r bordo-sx tx">${fmt(s.saldo)}</td>` : attesi[i] !== undefined ? `<td class="r bordo-sx prev" title="Saldo ${attesoLabel()}">${fmt(attesi[i])}</td>` : '<td class="r bordo-sx muted">—</td>';
    return `<tr class="ov-row${i === ovMonth ? ' selected' : ''}${solo ? ' previsto' : ''}${!hasData && !haPrev ? ' vuoto' : ''}" data-m="${i}">
      <th scope="row">${mese}</th>
      <td class="r ${solo ? 'prev' : 'pos'}" title="${pi > 0 ? `di cui ${fmt(pi)} previste` : ''}">${circa(inc[i] + pi, pi)}</td>
      <td class="r ${solo ? 'prev' : 'out'}" title="${titoloOut}">${circa(out[i] + p, p)}</td>
      ${hasData || haPrev ? `<td class="r b ${solo ? 'prev' : tone(bal)}">${haPrev ? '≈ ' : ''}${fmtS(bal)}</td>` : '<td class="r muted">—</td>'}
      ${saldo}
      <td class="r muted">${s && s.calc !== null ? fmt(s.calc) : '—'}</td>
      ${scartoCell(scarto)}
    </tr>`;
  }).join('');
  const ultimoSaldo = series.filter(p => p.year === activeYear).slice(-1)[0];
  const perTotale = lastDataIdx === 0 ? 'Gennaio' : lastDataIdx === 11 ? 'Totale' : `Gennaio–${MONTHS_FULL[lastDataIdx].toLowerCase()}`;
  el.innerHTML = `<table class="cat-table ov-table">
    <thead><tr>
      <th>Mese</th>
      <th class="r">Entrate</th>
      <th class="r">Uscite</th>
      <th class="r" title="Entrate − uscite − spese previste + entrate previste">Differenza</th>
      <th class="r bordo-sx">Saldo inserito</th>
      <th class="r" title="Saldo del mese prima + entrate − uscite dal conto − carta del mese prima">Saldo calcolato</th>
      <th class="r" title="Saldo inserito − saldo calcolato dai movimenti">Scarto</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="ov-tot">
      <th scope="row">${perTotale}</th>
      <td class="r pos">${fmt(totIn + totPrevIn)}</td>
      <td class="r out">${fmt(totOut + totPrev)}</td>
      <td class="r ${tone(totBal)}">${totPrev > 0 || totPrevIn > 0 ? '≈ ' : ''}${fmtS(totBal)}</td>
      <td class="r bordo-sx tx">${ultimoSaldo ? fmt(ultimoSaldo.saldo) : '—'}</td>
      <td></td>
      ${scartoCell(ultimoSaldo ? totScarto : null)}
    </tr></tfoot>
  </table>`;
  const nota = document.getElementById('overviewMonthlyNote');
  if (nota) nota.textContent = 'Saldo calcolato = saldo del mese prima + entrate − uscite dal conto − spese con carta del mese prima, addebitate in questo mese.';
}

/* ============================================================
   DETTAGLIO MESE — un mese alla volta, confronto con lo stesso mese dell'anno prima
   ============================================================ */
function renderMeseDetail(data) {
  const kpiEl = document.getElementById('meseKpi'), catsEl = document.getElementById('meseCats'),
        topEl = document.getElementById('meseTop'), titleEl = document.getElementById('meseTitle');
  if (!kpiEl || !catsEl || !topEl) return;
  const { inc, out } = getMonthly(data);
  const withData = MONTHS.map((_, i) => i).filter(i => inc[i] > 0 || out[i] > 0);
  if (!withData.length) {
    catsEl.innerHTML = ''; topEl.innerHTML = '';
    kpiEl.innerHTML = `<div class="empty">Nessun movimento nel ${activeYear}.</div>`;
    return;
  }
  const m = withData.includes(ovMonth) ? ovMonth : withData[withData.length - 1];
  ovMonth = m;
  if (titleEl) titleEl.textContent = `${MONTHS_FULL[m]} ${activeYear}`;
  const moves = data.filter(r => parseMonth(r.date) === m);
  const lastD = moves.reduce((mx, r) => Math.max(mx, parseDay(r.date)), 0);
  const subEl = document.getElementById('meseSub');
  if (subEl) subEl.textContent = `${moves.length} movimenti, ultimo il ${String(lastD).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}`;
  const pos = withData.indexOf(m);
  const prevBtn = document.getElementById('mesePrevBtn'), nextBtn = document.getElementById('meseNextBtn');
  if (prevBtn) prevBtn.disabled = pos <= 0;
  if (nextBtn) nextBtn.disabled = pos >= withData.length - 1;
  // Tiene evidenziata nel riepilogo la riga del mese aperto
  document.querySelectorAll('#overviewMonthlyTable tr[data-m]').forEach(r => r.classList.toggle('selected', +r.dataset.m === m));
  const vedi = document.getElementById('meseMovimenti');
  if (vedi) vedi.onclick = () => openDatiForMonth(m);

  // Mese in corso: confronto a parità di giorni (1..oggi) con l'anno prima, e niente "vs media"
  const today = new Date();
  const isCurrentMonth = parseInt(activeYear) === today.getFullYear() && m === today.getMonth();
  const dayCap = isCurrentMonth ? today.getDate() : 31;
  const prevYear = String(parseInt(activeYear) - 1);
  const prevData = (allData[prevYear] || []).filter(r => parseDay(r.date) <= dayCap);
  const { inc: pInc, out: pOut } = getMonthly(prevData);
  const hasPrevYear = pInc[m] > 0 || pOut[m] > 0;
  const refLabel = isCurrentMonth ? `dei primi ${dayCap} giorni di ${MONTHS_FULL[m].toLowerCase()} ${prevYear}` : `di ${MONTHS_FULL[m].toLowerCase()} ${prevYear}`;
  const avgInc = inc.reduce((a, v) => a + v, 0) / withData.length;
  const avgOut = out.reduce((a, v) => a + v, 0) / withData.length;
  const prevOpen = getPrevisteMonthly(getPreviste())[m];
  const prevInOpen = getEntratePrevisteMonthly(getPreviste())[m];
  const curCard = getCardMonthly(data)[m];
  const curIn = inc[m], curOut = out[m], curBal = curIn - curOut - prevOpen + prevInOpen;
  const prevBal = pInc[m] - pOut[m];

  // --- Le tre cifre con il confronto scritto in parole ---
  const frase = (cur, ref, come) => { const p = pctParole(cur, ref); return p ? (p === 'uguale' ? `uguale ${come.replace(/^(di|dei) /, 'a ')}` : `${p} ${come}`) : ''; };
  const kpi = (label, value, cls, hints) => `
    <div class="mese-kpi">
      <div class="prev-tot-label">${label}</div>
      <div class="mese-cifra ${cls}">${value}</div>
      ${hints.filter(Boolean).map(h => `<div class="prev-tot-nota">${h}</div>`).join('')}
    </div>`;
  const vsMedia = (cur, avg) => isCurrentMonth ? '' : frase(cur, avg, `della media ${activeYear}`);
  kpiEl.innerHTML = `
    ${kpi('Entrate', fmt(curIn), 'pos', [hasPrevYear ? frase(curIn, pInc[m], refLabel) : '', vsMedia(curIn, avgInc)])}
    ${kpi('Uscite', fmt(curOut), 'out', [curCard > 0 ? `di cui carta ${fmt(curCard)}, addebito a ${cardDebitLabel(m)}` : '', hasPrevYear ? frase(curOut, pOut[m], refLabel) : '', vsMedia(curOut, avgOut)])}
    ${kpi('Saldo', `${prevOpen > 0 || prevInOpen > 0 ? '≈ ' : ''}${fmtS(curBal)}`, curBal >= 0 ? 'pos b' : 'neg b', [
      hasPrevYear ? `${fmtS(curBal - prevBal)} rispetto al saldo ${refLabel}` : '',
      prevOpen > 0 ? `di cui ${fmt(prevOpen)} di spese previste` : '',
      prevInOpen > 0 ? `di cui ${fmt(prevInOpen)} di entrate previste` : ''])}`;

  // --- Categorie del mese con variazione sullo stesso mese dell'anno prima ---
  const byCat = arr => { const o = {}; arr.forEach(r => { if (r.amount < 0 && parseMonth(r.date) === m) o[r.cat] = (o[r.cat] || 0) + Math.abs(r.amount); }); return o; };
  const cur = byCat(data), prev = byCat(prevData);
  const sorted = Object.entries(cur).sort((a, b) => b[1] - a[1]);
  const TOP = 7;
  const top = sorted.slice(0, TOP);
  const restTot = sorted.slice(TOP).reduce((a, [, v]) => a + v, 0);
  const max = top.length ? top[0][1] : 1;
  const catRow = (name, v, refV, altre) => {
    let delta = '';
    if (hasPrevYear && !altre) {
      if (!refV) delta = 'nuova';
      else { const pct = Math.round((v - refV) / refV * 100); delta = `<span class="${tone(pct, false)}">${pct > 0 ? '+' : ''}${pct}%</span>`.replace('-', '−'); }
    }
    return `<div class="barra-riga con-delta" title="${hasPrevYear && refV ? `${MONTHS_FULL[m]} ${prevYear}: ${fmt(refV)}` : ''}">
      <span class="barra-nome">${esc(name)}</span>
      <span class="bar-track thin" aria-hidden="true"><span style="width:${Math.max(2, v / max * 100)}%"></span></span>
      <span class="barra-val">${fmt(v)}</span>
      <span class="barra-pct">${delta}</span>
    </div>`;
  };
  catsEl.innerHTML = `<h3 class="blocco-titolo mese-blocco">Categorie con più uscite</h3>` +
    (top.length ? top.map(([k, v]) => catRow(k, v, prev[k])).join('') + (restTot > 0 ? catRow(`Altre (${sorted.length - TOP})`, restTot, undefined, true) : '')
      : `<div class="empty">Nessuna uscita</div>`);

  // --- Le uscite più grandi del mese ---
  const topMoves = moves.filter(r => r.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 8);
  topEl.innerHTML = `<h3 class="blocco-titolo mese-blocco">Le uscite più grandi</h3>` +
    (topMoves.length ? `<div class="mese-moves">${topMoves.map(r => `
      <div class="mese-move">
        <span class="prev-date">${String(parseDay(r.date)).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}</span>
        <span class="mese-move-op" title="${esc(r.op)}">${esc(r.op || '—')}<span class="prev-cat">${r.card ? CARD_BADGE.replace('card-badge', 'card-badge lead') : ''}${esc(r.cat)}${r.sub ? ' · ' + esc(r.sub) : ''}</span></span>
        <span class="mese-move-amt">${fmt(Math.abs(r.amount))}</span>
      </div>`).join('')}</div>` : `<div class="empty">Nessuna uscita</div>`);
}

/** Apre il tab Dati filtrato sul mese indicato (0-11). */
function openDatiForMonth(m) {
  const mese = document.getElementById('datiMeseFilter');
  closeMeseModal();
  ['datiSearch', 'datiCatFilter', 'datiTipoFilter', 'datiMetodoFilter'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  if (mese) mese.value = String(m);
  showSection('dati');
  datiPage = 0;
  renderDati();
}

/* ============================================================
   WIDGET SPESE PREVISTE
   ============================================================ */
function renderPrevisteWidget() {
  const el = document.getElementById('previsteWidget');
  if (!el) return;
  const all = getPreviste();
  const now = new Date();
  const yr = parseInt(activeYear);
  const annoCorrente = yr === now.getFullYear();
  el.classList.remove('prev-compact');
  el.style.display = '';
  // Niente da mostrare: il blocco si riduce ai pulsanti (o sparisce, se non si può scrivere né stimare)
  const comprimi = () => {
    const visibile = scritturaAbilitata || annoCorrente;
    el.classList.toggle('prev-compact', visibile);
    el.style.display = visibile ? '' : 'none';
    el.innerHTML = `<h2 class="section-title">Spese previste</h2>
      ${bottoneNuovaPrevista()}${annoCorrente ? interruttoreStima() : ''}`;
  };

  if (!all.length) { comprimi(); return; }
  if (yr < now.getFullYear()) {
    el.innerHTML = `<h2 class="section-title">Spese previste</h2>
      <p class="page-sub">Anno concluso: ${all.length} voci previste, tutte considerate avvenute.</p>`;
    return;
  }

  const from = all[0].firstOpenMonth;
  const shown = all.filter(p => p.mese === from);
  if (!shown.length) { comprimi(); return; }
  const spese = shown.filter(p => !p.entrata && !p.stimata), entrate = shown.filter(p => p.entrata);
  const stime = shown.filter(p => p.stimata).sort((a, b) => b.importo - a.importo);
  const totOpen = spese.reduce((s, p) => s + p.importo, 0);
  const totIn = entrate.reduce((s, p) => s + p.importo, 0);
  const totStima = stime.reduce((s, p) => s + p.importo, 0);
  // Come finisce il mese: quanto è già entrato e uscito, più quanto deve ancora arrivare e uscire
  // (stesso numero della «Differenza stimata» del riquadro del mese)
  const giaMese = getMonthly(allData[activeYear] || []);
  const giaIn = giaMese.inc[from] || 0, giaOut = giaMese.out[from] || 0;
  const resta = giaIn + totIn - giaOut - totOpen - totStima;
  const voci = n => `${n} ${n === 1 ? 'voce prevista' : 'voci previste'}`;

  // Una riga: casella se si può segnare come pagata, altrimenti il simbolo (+ entrata, ↻ ricorrente)
  const riga = p => {
    const spuntabile = scritturaAbilitata && p.riga && !p.ricorrente;
    const segno = spuntabile
      ? `<button type="button" class="prev-check" role="checkbox" aria-checked="false" onclick="previstaPagata(${p.riga})" aria-label="Da pagare: ${esc(p.descr)}. Segna come pagata" title="Pagata: togli dal foglio"></button>`
      : `<span class="prev-segno" title="${p.entrata ? 'Entrata ricorrente' : p.ricorrente ? 'Ricorrente' : 'Prevista'}">${p.entrata ? '+' : p.ricorrente ? '↻' : ''}</span>`;
    return `<div class="prev-riga">
      ${segno}
      <span class="prev-testo" title="${esc(p.sub || '')}">${esc(p.descr || '—')}</span>
      ${p.giorno ? `<span class="prev-giorno">${p.giorno} ${MESI_3[p.mese]}</span>` : ''}
      <span class="prev-importo${p.entrata ? ' pos' : ''}">${p.entrata ? '+' : ''}${fmt(p.importo)}</span>
    </div>`;
  };
  // Gruppi: prima le entrate, poi le categorie dalla più pesante
  const gruppi = {};
  spese.forEach(p => { const k = p.cat || 'Senza categoria'; (gruppi[k] = gruppi[k] || []).push(p); });
  const somma = l => l.reduce((s, p) => s + p.importo, 0);
  const gruppo = (nome, lista, cls = '') => `<div class="prev-gruppo">
      <div class="prev-gruppo-testa"><h3>${esc(nome)}</h3><span class="b ${cls}">${cls ? '+' : ''}${fmt(somma(lista))}</span></div>
      ${lista.map(riga).join('')}
    </div>`;
  const nomiIn = entrate.map(p => p.descr).filter(Boolean);

  let html = `<div class="prev-testa">
      <div>
        <h2 class="section-title">${MONTHS_FULL[from]}</h2>
        <p class="page-sub">${scritturaAbilitata ? 'Spunta le voci quando le hai pagate.' : 'Togli dal foglio le voci già pagate.'}</p>
        ${bottoneNuovaPrevista()}
      </div>
      ${interruttoreStima()}
    </div>
    <div class="prev-totali">
      <div><div class="prev-tot-label">Ancora da pagare</div><div class="prev-tot prev">${stime.length ? 'circa ' : ''}${fmt(totOpen + totStima)}</div><div class="prev-tot-nota">${voci(spese.length)}${stime.length ? ' più le spese medie' : ''}</div></div>
      <div><div class="prev-tot-label">In arrivo</div><div class="prev-tot pos">${fmt(totIn)}</div><div class="prev-tot-nota">${esc(nomiIn.length > 3 ? `${nomiIn.length} entrate ricorrenti` : nomiIn.join(' e ').toLowerCase() || 'nessuna entrata attesa')}</div></div>
      <div><div class="prev-tot-label">Differenza a fine mese</div><div class="prev-tot ${tone(resta)}">${stime.length ? 'circa ' : ''}${fmtS(resta)}</div><div class="prev-tot-nota" title="Entrate: ${fmt(giaIn)} già arrivate + ${fmt(totIn)} in arrivo. Uscite: ${fmt(giaOut)} già spese + ${fmt(totOpen + totStima)} da pagare">entrate ${fmt(giaIn + totIn)} meno uscite ${fmt(giaOut + totOpen + totStima)}, già registrate comprese</div></div>
    </div>`;
  if (entrate.length) html += gruppo('Entrate', entrate, 'pos');
  html += Object.entries(gruppi).sort((a, b) => somma(b[1]) - somma(a[1])).map(([nome, lista]) => gruppo(nome, lista)).join('');
  if (stime.length) {
    const resto = all.filter(p => p.stimata && p.mese > from).reduce((s, p) => s + p.importo, 0);
    html += `<details class="ctl-group prev-stima">
      <summary><span class="det-voce">Spese medie per categoria <span class="muted prev-stima-n">(${stime.length} ${stime.length === 1 ? 'categoria' : 'categorie'})</span></span><span class="b prev">circa ${fmt(totStima)}</span></summary>
      ${stime.map(p => `<div class="prev-riga"><span class="prev-segno"></span><span class="prev-testo">${esc(p.cat)}</span><span class="prev-importo">circa ${fmt(p.importo)}</span></div>`).join('')}
      <div class="note">Mediana degli ultimi 12 mesi per categoria, meno le previste della stessa categoria e quanto già speso questo mese.${resto > 0 ? ` ${from + 1 === 11 ? 'A' : `Da ${MONTHS_FULL[from + 1].toLowerCase()} a`} dicembre circa ${fmt(resto)}.` : ''}</div>
    </details>`;
  }
  el.innerHTML = html;
}

/** Interruttore delle spese variabili stimate: pesano su saldi, grafici e saldo atteso come le previste. */
function interruttoreStima() {
  return `<div class="seg prev-seg" role="group" aria-label="Cosa contare nelle uscite">
    <button type="button" class="seg-btn" aria-pressed="${!stimaMedie}" onclick="setStimaMedie(false)">Solo voci previste</button>
    <button type="button" class="seg-btn" aria-pressed="${stimaMedie}" onclick="setStimaMedie(true)" title="Aggiunge per ogni mese che resta la spesa tipica di ogni categoria">Con spese medie</button>
  </div>`;
}
function setStimaMedie(v) {
  if (v === stimaMedie) return;
  stimaMedie = v;
  try { localStorage.setItem('finflow-stima-medie', v ? '1' : '0'); } catch (e) {}
  renderedSections.clear();
  renderAll();
}

function bottoneNuovaPrevista() {
  return scritturaAbilitata ? `<div class="prev-btns">
    <button type="button" class="btn-sm" onclick="aggiungiPrevista()">Aggiungi spesa prevista</button>
    <button type="button" class="btn-sm" onclick="aggiungiRicorrente(false)">Aggiungi uscita ricorrente</button>
    <button type="button" class="btn-sm" onclick="aggiungiRicorrente(true)">Aggiungi entrata ricorrente</button>
  </div>` : '';
}

/* ============================================================
   OVERVIEW WIDGETS AVANZATI
   ============================================================ */
function getCurMonth(data) {
  const { inc, out } = getMonthly(data);
  const now = new Date();
  const last = inc.reduce((l, v, i) => v > 0 ? i : l, out.reduce((l, v, i) => v > 0 ? i : l, -1));
  return last >= 0 ? last : (parseInt(activeYear) === now.getFullYear() ? now.getMonth() : 0);
}

function parseDay(dateStr) {
  const p = dateStr.split(/[\/\-\.]/);
  if (p.length >= 3) return parseInt(p[0].length === 4 ? p[2] : p[0]) || 0;
  return 0;
}

function renderAnomalieMese(data) {
  const el = document.getElementById('anomalieWidget');
  if (!el) return;
  const curMonth = getCurMonth(data);
  const summary = getExpenseCategorySummary(data);
  const { perNome } = medieCategorie(data);
  const anomalie = summary
    .filter(cat => {
      const curr = cat.monthly[curMonth];
      const avg = perNome[cat.name] || 0;
      return curr > 0 && avg > 0 && curr > avg * 1.3;
    })
    .map(cat => {
      const curr = cat.monthly[curMonth];
      const avg = perNome[cat.name];
      return { name: cat.name, curr, avg, pct: Math.round((curr - avg) / avg * 100) };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const n = anomalie.length;
  const nome = MONTHS_FULL[curMonth];
  if (!n) { el.innerHTML = `<h3 class="check-titolo">${nome}: nessuna categoria sopra la media</h3>`; return; }
  el.innerHTML = `<h3 class="check-titolo">${nome}: ${n === 1 ? 'una categoria' : `${n} categorie`} sopra la media</h3>
    ${anomalie.map(a => `<div class="check-riga" title="Oltre il 30% della media mensile: +${a.pct}%">
      <span class="check-nome">${esc(a.name)}</span>
      <span class="b out">${fmt(a.curr)}</span>
      <span class="check-solito">di solito ${fmt(a.avg)}</span>
    </div>`).join('')}`;
}

/** Blocco «Da controllare»: il saldo inserito torna con quello calcolato dai movimenti? */
function renderSaldoControllo() {
  const el = document.getElementById('saldoControllo');
  if (!el) return;
  const series = getSaldoSeries();
  const calcolato = getSaldoCalcolato(series);
  // Sotto i 50 €: arrotondamenti, date valuta a cavallo del mese, piccoli movimenti dimenticati
  const SOGLIA = 50;
  const scarti = series.map((p, i) => ({ p, d: calcolato[i] === null ? null : p.saldo - calcolato[i] })).filter(x => x.p.year === activeYear && x.d !== null);
  el.hidden = !scarti.length;
  if (el.hidden) return;
  // Gennaio del primo anno con le spese con carta segnate: l'addebito della carta di dicembre
  // dell'anno prima (dove la carta non è segnata) manca dal calcolo, lo scarto è atteso
  const annoPrima = String(parseInt(activeYear, 10) - 1);
  const cartaPrima = getCardMonthly(allData[annoPrima] || []).some(v => v > 0);
  const cartaOra = getCardMonthly(allData[activeYear] || []).some(v => v > 0);
  const spiegato = x => x.p.monthIdx === 0 && cartaOra && !cartaPrima && (allData[annoPrima] || []).length > 0;
  const gennaio = scarti.find(x => spiegato(x) && Math.abs(x.d) >= SOGLIA);
  const notaGennaio = gennaio ? `<p class="check-testo">A gennaio il saldo inserito è ${fmt(Math.abs(gennaio.d))} più ${gennaio.d < 0 ? 'basso' : 'alto'}: è quasi certamente l'addebito della carta di dicembre ${esc(annoPrima)}, che nel ${esc(annoPrima)} non è segnata e quindi manca dal calcolo.</p>` : '';
  const diversi = scarti.filter(x => !spiegato(x) && Math.abs(x.d) >= SOGLIA);
  if (!diversi.length) {
    el.innerHTML = `<h3 class="check-titolo">Il saldo torna con i movimenti</h3>
      <p class="check-testo">In tutti i mesi del ${esc(activeYear)} il saldo che hai inserito è uguale a quello calcolato, a meno di ${fmt(SOGLIA)}.</p>${notaGennaio}`;
    return;
  }
  const max = diversi.reduce((a, b) => Math.abs(b.d) > Math.abs(a.d) ? b : a);
  const quale = `${aMese(max.p.monthIdx)[0].toUpperCase()}${aMese(max.p.monthIdx).slice(1)}`;
  const confrontati = scarti.filter(x => !spiegato(x)).length;
  el.innerHTML = `<h3 class="check-titolo">Il saldo non torna in ${diversi.length} ${diversi.length === 1 ? 'mese' : 'mesi'} su ${confrontati}</h3>
    <p class="check-testo">Il saldo che hai inserito è diverso da quello calcolato dai movimenti di almeno ${fmt(SOGLIA)}. ${quale} quello inserito è ${fmt(Math.abs(max.d))} più ${max.d < 0 ? 'basso' : 'alto'}. Possono mancare movimenti, essercene di doppi, o il saldo è scritto male. Le differenze sono nella tabella qui sotto.</p>${notaGennaio}`;
}
