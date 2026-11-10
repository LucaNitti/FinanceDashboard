/* FinFlow — Sezione Periodo: statistiche su un intervallo di date libero (anche a cavallo d'anno),
   confrontate con il periodo precedente della stessa durata. Indipendente dall'anno selezionato. */
/* ============================================================
   PERIODO
   ============================================================ */
const PERIODO_PRESETS = [
  ['30g', 'Ultimi 30 giorni'], ['3m', 'Ultimi 3 mesi'], ['12m', 'Ultimi 12 mesi'],
  ['anno', 'Da inizio anno'], ['annoPrec', 'Anno scorso']
];

/** Date locali ↔ 'AAAA-MM-GG' (valore degli <input type="date">) senza passare da UTC. */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromIso(s) {
  const p = parseDmy(s);
  return p ? new Date(p.y, p.m, p.d) : null;
}
const isoKey = s => +String(s).replace(/-/g, '');
const giorniTra = (a, b) => Math.round((b - a) / 86400000) + 1;

function setPeriodoPreset(p) {
  const oggi = new Date();
  let dal = new Date(oggi), al = new Date(oggi);
  if (p === '30g') dal.setDate(dal.getDate() - 29);
  else if (p === '3m') { dal.setMonth(dal.getMonth() - 3); dal.setDate(dal.getDate() + 1); }
  else if (p === '12m') { dal.setFullYear(dal.getFullYear() - 1); dal.setDate(dal.getDate() + 1); }
  else if (p === 'anno') dal = new Date(oggi.getFullYear(), 0, 1);
  else if (p === 'annoPrec') { dal = new Date(oggi.getFullYear() - 1, 0, 1); al = new Date(oggi.getFullYear() - 1, 11, 31); }
  periodo = { dal: isoDate(dal), al: isoDate(al), preset: p };
  renderPeriodo();
}

function onPeriodoDateChange() {
  const dal = document.getElementById('periodoDal').value, al = document.getElementById('periodoAl').value;
  if (!dal || !al) return;
  // Date invertite: le scambio invece di mostrare un periodo vuoto
  periodo = isoKey(dal) <= isoKey(al) ? { dal, al, preset: '' } : { dal: al, al: dal, preset: '' };
  renderPeriodo();
}

/** Movimenti di tutti gli anni con data tra dal e al (chiavi AAAAMMGG, estremi inclusi). */
function movimentiTra(dalK, alK) {
  const out = [];
  Object.values(allData).forEach(rows => rows.forEach(r => {
    const k = dateKey(r.date);
    if (k >= dalK && k <= alK) out.push(r);
  }));
  return out;
}

function sommaPeriodo(rows) {
  let inc = 0, out = 0, card = 0;
  const catOut = {}, catIn = {};
  rows.forEach(r => {
    const cat = r.cat || 'Senza categoria';
    if (r.amount >= 0) { inc += r.amount; catIn[cat] = (catIn[cat] || 0) + r.amount; }
    else {
      const a = Math.abs(r.amount);
      out += a; catOut[cat] = (catOut[cat] || 0) + a;
      if (r.card) card += a;
    }
  });
  return { inc, out, card, net: inc - out, catOut, catIn, n: rows.length };
}

function renderPeriodo() {
  if (!periodo.dal) { setPeriodoPreset('12m'); return; }
  const dalD = fromIso(periodo.dal), alD = fromIso(periodo.al);
  const giorni = giorniTra(dalD, alD);
  // Periodo precedente: stessa durata, finisce il giorno prima dell'inizio
  const pAl = new Date(dalD); pAl.setDate(pAl.getDate() - 1);
  const pDal = new Date(pAl); pDal.setDate(pDal.getDate() - giorni + 1);

  const rows = movimentiTra(isoKey(periodo.dal), isoKey(periodo.al));
  const prevRows = movimentiTra(isoKey(isoDate(pDal)), isoKey(isoDate(pAl)));
  const cur = sommaPeriodo(rows), prev = sommaPeriodo(prevRows);
  const hasPrev = prev.n > 0;

  // Controlli: pulsanti rapidi e date
  const seg = document.getElementById('periodoPresetSeg');
  if (seg && !seg.children.length) {
    seg.innerHTML = PERIODO_PRESETS.map(([k, l]) => `<button type="button" class="chip" data-mode="${k}" aria-pressed="false" onclick="setPeriodoPreset('${k}')">${l}</button>`).join('');
  }
  syncSeg('periodoPresetSeg', periodo.preset);
  document.getElementById('periodoDal').value = periodo.dal;
  document.getElementById('periodoAl').value = periodo.al;
  const fmtD = d => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  const prevLabel = `${fmtD(pDal)} – ${fmtD(pAl)}`;
  document.getElementById('periodoSub').textContent =
    `${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}, ${cur.n.toLocaleString('it-IT')} movimenti. Confronto con ${prevLabel}` +
    (hasPrev ? '.' : ', dove non ci sono movimenti.');

  const kpiEl = document.getElementById('periodoKpi'), medieEl = document.getElementById('periodoMedie');
  if (!cur.n) {
    kpiEl.innerHTML = '<div class="empty">Nessun movimento nel periodo scelto.</div>';
    medieEl.innerHTML = '';
    ['periodoCatOut', 'periodoCatIn', 'periodoTop'].forEach(id => { document.getElementById(id).innerHTML = ''; });
    mkChart('periodoChart', { type: 'bar', data: { labels: [], datasets: [] } });
    return;
  }

  // --- Totali con il confronto col periodo prima, scritto in parole ---
  const unAnno = giorni >= 365 && giorni <= 366;
  const rifer = unAnno ? "dell'anno prima" : 'del periodo prima', come = unAnno ? "circa come l'anno prima" : 'circa come il periodo prima';
  const cfr = (c, pr) => {
    if (!hasPrev || !(pr > 0)) return 'nessun confronto';
    const t = pctParole(c, pr);
    return t === 'uguale' ? come : `${t} ${rifer}`;
  };
  const cfrSaldo = (c, pr) => {
    if (!hasPrev) return 'nessun confronto';
    const d = Math.round(c - pr);
    return d === 0 ? come : `${fmt(Math.abs(d))} ${d < 0 ? 'in meno' : 'in più'} ${rifer}`;
  };
  const rate = s => s.inc > 0 ? s.net / s.inc * 100 : null;
  const curRate = rate(cur), prevRate = rate(prev);
  const mesi = giorni / 30.44;
  const percento = v => quota(Math.round(v * 10) / 10).replace('-', '−');
  kpiEl.innerHTML = `<dl class="tre-cifre periodo-cifre">
    <div>
      <dt>Entrate</dt>
      <dd class="cifra pos">${fmt(cur.inc)}</dd>
      <dd class="cifra-sotto">${cfr(cur.inc, prev.inc)}</dd>
    </div>
    <div>
      <dt>Uscite</dt>
      <dd class="cifra-con-nota">
        <span class="cifra out">${fmt(cur.out)}</span>
        ${cur.card > 0 ? `<span class="cifra-nota"><span>conto ${fmt(cur.out - cur.card)}</span><span>carta ${fmt(cur.card)} (${Math.round(cur.card / cur.out * 100)}%)</span></span>` : ''}
      </dd>
      <dd class="cifra-sotto">${cfr(cur.out, prev.out)}</dd>
    </div>
    <div class="tre-saldo">
      <dt>Saldo</dt>
      <dd class="cifra forte ${cur.net >= 0 ? 'pos' : 'neg'}">${fmtS(cur.net)}</dd>
      <dd class="cifra-sotto">${cfrSaldo(cur.net, prev.net)}</dd>
    </div>
  </dl>`;
  const punti = hasPrev && curRate !== null && prevRate !== null ? Math.round((curRate - prevRate) * 10) / 10 : null;
  medieEl.innerHTML = `<div>
      <div class="prev-tot-label">Tasso di risparmio</div>
      <div class="cifra ${tone(curRate)}">${curRate === null ? '—' : percento(curRate)}</div>
      <div class="cifra-sotto">${punti === null ? 'nessun confronto' : punti === 0 ? come : `${Math.abs(punti).toLocaleString('it-IT')} punti in ${punti < 0 ? 'meno' : 'più'}`}</div>
    </div>
    <div>
      <div class="prev-tot-label">Uscite medie</div>
      <div class="cifra tx">${fmt(giorni >= 28 ? cur.out / mesi : cur.out / giorni)}</div>
      <div class="cifra-sotto">${giorni >= 28 ? `al mese, ${fmt(cur.out / giorni)} al giorno` : 'al giorno'}</div>
    </div>`;

  renderPeriodoChart(rows, dalD, alD, giorni);

  // --- Categorie (uscite ed entrate) con variazione vs periodo precedente ---
  const catList = (byCat, prevByCat, tot, goodUp, titolo, sotto, TOP, conQuota, cls) => {
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const testa = `<h2 class="section-title">${titolo}</h2>${sotto ? `<p class="section-sub">${sotto}</p>` : ''}`;
    if (!sorted.length) return testa + '<div class="empty">Nessun movimento</div>';
    const top = sorted.slice(0, TOP);
    const rest = sorted.slice(TOP);
    if (rest.length) top.push([`Altre (${rest.length})`, rest.reduce((a, [, v]) => a + v, 0), true]);
    const max = top[0][1];
    return testa + `<div class="barre-lista">` + top.map(([name, v, altre]) => {
      const refV = prevByCat[name];
      let delta = '';
      if (hasPrev && !altre) {
        if (!refV) delta = 'nuova';
        else { const pct = Math.round((v - refV) / refV * 100); delta = `<span class="${tone(pct, goodUp)}">${pctS(pct)}</span>`; }
      }
      return `<div class="barra-riga periodo-riga${conQuota ? ' con-quota' : ''}" title="${hasPrev && refV ? `Periodo prima: ${fmt(refV)}` : ''}">
        <span class="barra-nome">${esc(name)}</span>
        <span class="bar-track thin ${cls}" aria-hidden="true"><span style="width:${Math.max(2, v / max * 100)}%"></span></span>
        <span class="barra-val">${fmt(v)}</span>
        ${conQuota ? `<span class="barra-pct">${Math.round(v / tot * 100)}%</span>` : ''}
        <span class="barra-pct">${delta}</span>
      </div>`;
    }).join('') + '</div>';
  };
  document.getElementById('periodoCatOut').innerHTML = catList(cur.catOut, prev.catOut, cur.out, false, 'Uscite per categoria', hasPrev ? "Quota sul totale e variazione sul periodo prima" : 'Quota sul totale', 12, true, '');
  document.getElementById('periodoCatIn').innerHTML = catList(cur.catIn, prev.catIn, cur.inc, true, 'Entrate per categoria', '', 6, false, 'bar-in');

  // --- Le uscite più grandi ---
  const topMoves = rows.filter(r => r.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 10);
  document.getElementById('periodoTop').innerHTML = `<h2 class="section-title mb-8">Le uscite più grandi</h2>` +
    (topMoves.length ? `<div class="mese-moves">${topMoves.map(r => {
      const d = parseDmy(r.date);
      return `<div class="mese-move">
        <span class="prev-date periodo-date">${String(d.d).padStart(2, '0')}/${String(d.m + 1).padStart(2, '0')}/${String(d.y).slice(2)}</span>
        <span class="mese-move-op" title="${esc(r.op)}">${esc(r.op || '—')}<span class="prev-cat">${r.card ? CARD_BADGE.replace('card-badge', 'card-badge lead') : ''}${esc(r.cat)}${r.sub ? ' · ' + esc(r.sub) : ''}</span></span>
        <span class="mese-move-amt">${fmt(Math.abs(r.amount))}</span>
      </div>`;
    }).join('')}</div>` : '<div class="empty">Nessuna uscita</div>');
}

/** Entrate/uscite/saldo nel periodo: per giorno fino a 45 giorni, altrimenti per mese. */
function renderPeriodoChart(rows, dalD, alD, giorni) {
  const perGiorno = giorni <= 45;
  const buckets = [], idx = {};
  if (perGiorno) {
    for (let d = new Date(dalD); d <= alD; d.setDate(d.getDate() + 1)) {
      idx[d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()] = buckets.length;
      buckets.push({ label: `${d.getDate()} ${MESI_3[d.getMonth()]}`, inc: 0, out: 0 });
    }
  } else {
    const multiAnno = dalD.getFullYear() !== alD.getFullYear();
    for (let d = new Date(dalD.getFullYear(), dalD.getMonth(), 1); d <= alD; d.setMonth(d.getMonth() + 1)) {
      idx[d.getFullYear() * 100 + d.getMonth() + 1] = buckets.length;
      buckets.push({ label: MESI_3[d.getMonth()] + (multiAnno ? ' ' + String(d.getFullYear()).slice(2) : ''), inc: 0, out: 0 });
    }
  }
  rows.forEach(r => {
    const k = dateKey(r.date);
    const b = buckets[idx[perGiorno ? k : Math.floor(k / 100)]];
    if (!b) return;
    if (r.amount >= 0) b.inc += r.amount; else b.out += Math.abs(r.amount);
  });
  // Per giorno il saldo del singolo giorno è solo rumore: la linea è il saldo accumulato dall'inizio del periodo
  let acc = 0;
  const saldo = buckets.map(b => Math.round(perGiorno ? (acc += b.inc - b.out) : b.inc - b.out));
  const sub = document.getElementById('periodoChartSub'), tit = document.getElementById('periodoChartTitolo'), leg = document.getElementById('periodoLegSaldo');
  if (tit) tit.textContent = perGiorno ? 'Giorno per giorno' : 'Mese per mese';
  if (leg) leg.textContent = perGiorno ? 'Saldo progressivo' : 'Saldo del mese';
  if (sub) sub.textContent = perGiorno ? 'La linea è il saldo progressivo dall\'inizio del periodo.'
    : 'Il primo e l\'ultimo mese possono essere parziali.';
  mkChart('periodoChart', {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [
        { label: 'Entrate', data: buckets.map(b => Math.round(b.inc)), backgroundColor: CHART_IN, borderRadius: 3, order: 2 },
        { label: 'Uscite', data: buckets.map(b => Math.round(b.out)), backgroundColor: CHART_OUT, borderRadius: 3, order: 2 },
        { label: perGiorno ? 'Saldo progressivo' : 'Saldo', type: 'line', data: saldo, borderColor: TREND_COLORS[0],
          backgroundColor: TREND_COLORS[0], pointBackgroundColor: TREND_COLORS[0], borderWidth: 2, pointRadius: perGiorno ? 0 : 3, tension: 0, order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales: scales()
    }
  });
}
