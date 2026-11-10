/* FinFlow — Sezione Bollette: tabella, prossime attese, confronto anno su anno, consumi. */
/* ============================================================
   BOLLETTE
   ============================================================ */
/** Colore di una fornitura: gas come le uscite, luce come le previsioni, le altre dalla palette. */
function bollColore(c) {
  const n = String(c).toLowerCase();
  if (n.includes('gas') || n.includes('metano')) return CHART_OUT;
  if (n.includes('luc') || n.includes('ener') || n.includes('elett')) return TREND_COLORS[3];
  const tutte = [...new Set(bolletteData.map(x => x.commodity))];
  return TREND_COLORS[(tutte.indexOf(c) + 4) % TREND_COLORS.length];
}

/** Plugin Chart.js: il totale sopra ogni pila di barre. */
const totaliPila = {
  id: 'totaliPila',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx, metas = chart.getSortedVisibleDatasetMetas();
    if (!metas.length) return;
    ctx.save();
    ctx.fillStyle = cssVar('--text', '#E8EDF4');
    ctx.font = '11px ' + cssVar('--font', 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    chart.data.labels.forEach((_, i) => {
      const tot = chart.data.datasets.reduce((s, d) => s + (d.data[i] || 0), 0);
      if (!tot) return;
      const y = Math.min(...metas.map(m => m.data[i] ? m.data[i].y : Infinity));
      ctx.fillText(fmt(tot), metas[0].data[i].x, y - 3);
    });
    ctx.restore();
  }
};

function renderBolletteSection() {
  const bollAnno = bolletteData.filter(b => b.anno === activeYear);
  const allYears = [...new Set(bolletteData.map(b => b.anno))].filter(Boolean).sort();
  const commodities = [...new Set(bolletteData.map(b => b.commodity))];

  // Titolo: quanto, in quante fatture, per fornitura
  const bc = {}; bollAnno.forEach(b => { bc[b.commodity] = (bc[b.commodity] || 0) + b.importo; });
  const pe = Object.entries(bc).sort((a, b) => b[1] - a[1]);
  const totAnno = pe.reduce((s, [, v]) => s + v, 0);
  document.getElementById('bollTitolo').textContent = `Bollette ${activeYear}`;
  document.getElementById('bollSub').textContent = bollAnno.length
    ? `${fmt(totAnno)} in ${bollAnno.length} ${bollAnno.length === 1 ? 'fattura' : 'fatture'}: ${pe.map(([c, v]) => `${c.toLowerCase()} ${fmt(v)}`).join(', ')}. Gli importi mensili sono per competenza: ogni bolletta è divisa sui mesi che copre.`
    : `Nessuna bolletta nel ${activeYear}.`;

  document.getElementById('bollAnnoLegenda').innerHTML = commodities.map(c => `<span><i class="leg-box" style="background:${bollColore(c)}"></i>${esc(c)}</span>`).join('');
  const sc = scales();
  mkChart('bolletteAnnualeChart', { type: 'bar', plugins: [totaliPila],
    data: { labels: allYears, datasets: commodities.map(c => ({
      label: c, data: allYears.map(y => Math.round(bolletteData.filter(b => b.anno === y && b.commodity === c).reduce((s,b) => s + b.importo, 0))),
      backgroundColor: bollColore(c), stack: 'anno', barPercentage: .7
    }))},
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw || 0)}` } } },
      scales: { x: { ...sc.x, stacked: true }, y: { display: false, stacked: true } } } });

  renderConsumiChart('consumiGasChart', 'gas', 'gas', 'm³',
    commodities.find(c => c.toLowerCase().includes('gas') || c.toLowerCase().includes('metano')));
  renderConsumiChart('consumiLuceChart', 'luce', 'luce', 'kWh',
    commodities.find(c => c.toLowerCase().includes('luc') || c.toLowerCase().includes('ener') || c.toLowerCase().includes('elett')));

  renderBolletteAttese(commodities);
  renderBolletteMedia(commodities);
  renderBolletteYoy(commodities);
  renderBolletteTable();
}

/**
 * Emissioni bimestrali (di solito la luce): 50–75 giorni dall'emissione precedente della stessa
 * commodity (per la prima, fino alla successiva). Bolletta per bolletta, perché la cadenza di un
 * fornitore può cambiare. Ritorna { chiavi: Set("commodity|t"), commodity: Set }.
 */
function bollBimestrali() {
  const DAY = 86400000, chiavi = new Set(), commodity = new Set();
  [...new Set(bolletteData.map(b => b.commodity))].forEach(c => {
    const ts = [...new Set(bolletteData.filter(b => b.commodity === c).map(bollDate).filter(Boolean).map(d => d.t))].sort((a, b) => a - b);
    ts.forEach((t, i) => {
      const gap = (i > 0 ? t - ts[i - 1] : i + 1 < ts.length ? ts[i + 1] - t : 0) / DAY;
      if (gap >= 50 && gap <= 75) { chiavi.add(`${c}|${t}`); commodity.add(c); }
    });
  });
  return { chiavi, commodity };
}

/**
 * Bollette con il mese a cui si riferiscono ({ y, m }). Con bollDividi le bimestrali diventano
 * due voci da metà importo, sui due mesi prima dell'emissione (il periodo che coprono:
 * stessa logica di bollAccrualMonthly). Le altre restano sul mese di emissione.
 */
function bollVoci() {
  const bim = bollDividi ? bollBimestrali().chiavi : new Set();
  const voci = [];
  bolletteData.forEach(b => {
    const d = bollDate(b);
    if (!d) return;
    if (!bim.has(`${b.commodity}|${d.t}`)) { voci.push({ ...b, rif: { y: d.y, m: d.m } }); return; }
    [2, 1].forEach(k => {
      const t = new Date(d.y, d.m - k, 1);
      voci.push({ ...b, importo: b.importo / 2, rif: { y: t.getFullYear(), m: t.getMonth() }, meta: true });
    });
  });
  return voci;
}

function setBollDividi(v) {
  if (v === bollDividi) return;
  bollDividi = v;
  renderBolletteYoy([...new Set(bolletteData.map(b => b.commodity))]);
  renderBolletteTable();
}

function renderBolletteTable() {
  const bimestrali = bollBimestrali();
  const bim = bimestrali.commodity;
  document.querySelectorAll('.boll-dividi').forEach(e => { e.hidden = !bim.size; });
  document.querySelectorAll('.boll-dividi .seg-btn').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.mode === 'si') === bollDividi)));
  const titolo = document.getElementById('bolletteTableTitolo');
  if (titolo) titolo.textContent = `Elenco bollette ${activeYear}`;
  const sub = document.getElementById('bolletteTableSub');
  if (sub) sub.textContent = bollDividi && bim.size ? "Le bollette bimestrali sono divise a metà sui due mesi prima dell'emissione." : '';
  // Senza divisione si tiene l'anno del foglio (colonna Anno), come nel resto della sezione
  const tempo = b => { const d = bollDate(b); return d ? d.t : 0; };
  const rows = bollDividi
    ? bollVoci().filter(b => String(b.rif.y) === activeYear).sort((a, b) => b.rif.m - a.rif.m || a.commodity.localeCompare(b.commodity))
    : bolletteData.filter(b => b.anno === activeYear).slice().sort((a, b) => tempo(b) - tempo(a));
  const el = document.getElementById('bolletteTableEl');
  const data = b => String(b.emissione || b.mese || '').replace(/\./g, '/');
  const pallino = c => `<span class="boll-pallino" style="background:${bollColore(c)}"></span>`;
  const tipo = b => { const d = bollDate(b); return d && bimestrali.chiavi.has(`${b.commodity}|${d.t}`) ? 'Bimestrale' : 'Mensile'; };
  const riga = b => `<tr>
      <td>${bollDividi ? `${MONTHS_FULL[b.rif.m]} ${b.rif.y}` : esc(data(b))}</td>
      <td>${pallino(b.commodity)}${esc(b.commodity)}</td>
      <td class="muted"${b.fattura ? ` title="Fattura ${esc(b.fattura)}"` : ''}>${b.meta ? `Metà della bolletta del ${esc(data(b))}` : tipo(b)}</td>
      <td class="r b">${fmt(b.importo)}</td>
    </tr>`;
  const tot = rows.reduce((s, b) => s + b.importo, 0);
  el.innerHTML = `<thead><tr><th>${bollDividi ? 'Mese' : 'Emessa il'}</th><th>Fornitura</th><th>Come fatturata</th><th class="r">Importo</th></tr></thead>
    <tbody>${rows.length ? rows.map(riga).join('') : `<tr><td colspan="4" class="empty-cell">Nessuna bolletta trovata per il ${esc(activeYear)}.</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr class="hm-tot"><th scope="row" colspan="3">Totale</th><td class="r">${fmt(tot)}</td></tr></tfoot>` : ''}`;
}

/**
 * Media mensile per commodity nell'anno selezionato: spesa per competenza (bollAccrualMonthly)
 * divisa per i mesi coperti da bollette, così le bimestrali e i mesi non ancora fatturati non
 * abbassano la media. Confronto con l'anno prima.
 */
function renderBolletteMedia(commodities) {
  const el = document.getElementById('bolletteMedia');
  if (!el) return;
  const prevYear = String(parseInt(activeYear) - 1);
  const media = (c, y) => {
    const v = bollAccrualMonthly(c, y).filter(x => x !== null);
    return v.length ? { avg: v.reduce((s, x) => s + x, 0) / v.length, mesi: v.length } : null;
  };
  const rows = commodities.map(c => ({ c, cur: media(c, activeYear), prev: media(c, prevYear) })).filter(r => r.cur);
  const testa = `<h2 class="section-title">Quanto costano al mese</h2><p class="section-sub">Media ${esc(activeYear)} e confronto con il ${prevYear}</p>`;
  if (!rows.length) { el.innerHTML = testa + `<div class="empty">Nessuna bolletta nel ${esc(activeYear)}.</div>`; return; }
  const tot = rows.reduce((s, r) => s + r.cur.avg, 0);
  const totPrev = rows.every(r => r.prev) ? rows.reduce((s, r) => s + r.prev.avg, 0) : null;
  const delta = (a, b) => {
    if (!(b > 0)) return '<span class="media-delta"></span>';
    const pct = Math.round((a - b) / b * 100);
    return `<span class="media-delta ${Math.abs(pct) < 5 ? 'muted' : tone(pct, false)}" title="Media mensile ${prevYear}: ${fmt(b)}">${pctS(pct)}</span>`;
  };
  el.innerHTML = testa + rows.map(r => `<div class="media-riga">
      <span>${esc(r.c)} <span class="media-mesi">${r.cur.mesi} ${r.cur.mesi === 1 ? 'mese' : 'mesi'}</span></span>
      <span><b class="media-val">${fmt(r.cur.avg)}</b>${r.prev ? delta(r.cur.avg, r.prev.avg) : delta(0, 0)}</span>
    </div>`).join('') + (rows.length > 1 ? `<div class="media-riga media-tot">
      <span class="b">Totale</span>
      <span><b class="media-val grande">${fmt(tot)}</b>${totPrev ? delta(tot, totPrev) : delta(0, 0)}</span>
    </div>` : '');
}

/** Data di riferimento di una bolletta: emissione, altrimenti il campo mese. */
function bollDate(b) {
  for (const src of [b.emissione, b.mese]) {
    const p = parseDmy(src);
    if (p && p.y > 2000) return { ...p, t: new Date(p.y, p.m, p.d || 1).getTime() };
  }
  return null;
}

/**
 * Prossima bolletta attesa per commodity: cadenza = mediana degli intervalli tra
 * le ultime emissioni distinte; importo = bollette dello stesso mese dell'anno
 * prima, altrimenti media delle ultime 3. Non ci sono scadenze nel foglio, quindi
 * la data è una stima ("intorno al").
 */
function renderBolletteAttese(commodities) {
  const el = document.getElementById('bolletteAttese');
  if (!el) return;
  const now = Date.now(), DAY = 86400000;
  const rows = commodities.map(c => {
    const bills = bolletteData.filter(b => b.commodity === c).map(b => ({ ...b, d: bollDate(b) })).filter(b => b.d).sort((a, b) => a.d.t - b.d.t);
    if (!bills.length) return null;
    const dates = [...new Set(bills.map(b => b.d.t))].slice(-7);
    const gaps = dates.slice(1).map((t, i) => Math.round((t - dates[i]) / DAY)).sort((a, b) => a - b);
    const cadence = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const last = bills[bills.length - 1];
    const lastTot = bills.filter(b => b.d.t === last.d.t).reduce((s, b) => s + b.importo, 0);
    if (!cadence) return { c, last, lastTot, next: null };
    let next = last.d.t + cadence * DAY;
    // Se siamo già oltre di più di una cadenza, sposta avanti (bollette non ancora inserite)
    while (next + cadence * DAY < now) next += cadence * DAY;
    const nd = new Date(next);
    // Stesso mese dell'anno prima se è un importo "vero" (conguagli a 0 o negativi esclusi), altrimenti media delle ultime 3 positive
    const sameLastYear = bills.filter(b => b.d.y === nd.getFullYear() - 1 && b.d.m === nd.getMonth()).reduce((s, b) => s + b.importo, 0);
    const recent = bills.filter(b => b.importo > 0).slice(-3);
    const useSame = sameLastYear > 0;
    const est = useSame ? sameLastYear : (recent.length ? recent.reduce((s, b) => s + b.importo, 0) / recent.length : 0);
    return { c, last, lastTot, cadence, next: nd, est, basis: useSame ? `da ${MONTHS_FULL[nd.getMonth()].toLowerCase()} ${nd.getFullYear() - 1}` : 'dalla media delle ultime 3' };
  }).filter(Boolean);

  const testa = est => `<div class="riga-titolo riga-base">
      <h2 class="section-title">Prossime bollette</h2>
      ${est ? `<span class="muted">in tutto circa <b class="boll-tot">${fmt(est)}</b></span>` : ''}
    </div>
    <p class="section-sub">Stimate dalla cadenza delle emissioni e dallo stesso periodo dell'anno scorso.</p>`;
  if (!rows.length) { el.innerHTML = testa(0) + `<div class="empty">Nessuna bolletta caricata.</div>`; return; }
  const giornoMese = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const totEst = rows.reduce((s, r) => s + (r.est || 0), 0);
  el.innerHTML = testa(rows.filter(r => r.next).length > 1 ? totEst : 0) + `<div class="boll-attese">${rows.map(r => {
    if (!r.next) return `<div class="boll-attesa"><div class="boll-attesa-testa"><span class="boll-nome">${esc(r.c)}</span></div><div class="boll-attesa-sub">Una sola emissione: cadenza non stimabile.</div></div>`;
    const days = Math.round((r.next.getTime() - now) / DAY);
    const late = days < 0;
    const quando = late ? `in ritardo di ${-days} ${-days === 1 ? 'giorno' : 'giorni'}` : days === 0 ? 'oggi' : `tra ${days} ${days === 1 ? 'giorno' : 'giorni'}`;
    const lastStr = `${String(r.last.d.d).padStart(2, '0')}/${String(r.last.d.m + 1).padStart(2, '0')}`;
    return `<div class="boll-attesa${late ? ' in-ritardo' : ''}">
      <div class="boll-attesa-testa"><span class="boll-nome">${esc(r.c)}</span><span class="boll-stima">circa ${fmt(r.est)}</span></div>
      <div class="boll-attesa-quando">Attesa intorno al ${giornoMese(r.next)}: ${quando}</div>
      <div class="boll-attesa-sub">Arriva ogni ${r.cadence} giorni circa. Ultima il ${lastStr}, ${fmt(r.lastTot)}. Stima ${r.basis}.</div>
    </div>`;
  }).join('')}</div>`;
}

/** Spesa bollette per mese (0-11) di una commodity in un anno: mese di emissione, o mesi coperti con bollDividi. */
function bollMonthly(commodity, year) {
  const arr = Array(12).fill(0);
  bollVoci().forEach(b => {
    if (b.commodity === commodity && String(b.rif.y) === String(year)) arr[b.rif.m] += b.importo;
  });
  return arr;
}

/**
 * Spesa bollette per competenza, per mese (0-11) di una commodity in un anno.
 * Le bollette non arrivano ogni mese (e a volte due nello stesso mese), quindi
 * ogni importo viene ripartito in proporzione ai giorni sui mesi del periodo
 * che copre: dall'emissione precedente (esclusa) alla propria (inclusa).
 * Bollette emesse lo stesso giorno vengono sommate. Senza emissione precedente
 * utile (prima in assoluto, o buco > 200 gg) si usa la durata del periodo
 * successivo, altrimenti 30 gg. Mesi non coperti da nessuna bolletta → null.
 */
function bollAccrualMonthly(commodity, year) {
  const DAY = 86400000, MAX_GAP = 200 * DAY;
  const byDay = new Map();
  bolletteData.forEach(b => {
    if (b.commodity !== commodity) return;
    const d = bollDate(b);
    if (!d) return;
    const t = Date.UTC(d.y, d.m, d.d || 1);
    byDay.set(t, (byDay.get(t) || 0) + b.importo);
  });
  const ts = [...byDay.keys()].sort((a, b) => a - b);
  const arr = Array(12).fill(null);
  const y = parseInt(year, 10);
  const yStart = Date.UTC(y, 0, 1), yEnd = Date.UTC(y + 1, 0, 1);
  ts.forEach((end, i) => {
    let len = i > 0 ? end - ts[i - 1] : 0;
    if (len <= 0 || len > MAX_GAP) len = (i + 1 < ts.length && ts[i + 1] - end <= MAX_GAP) ? ts[i + 1] - end : 30 * DAY;
    const start = end - len;
    if (end <= yStart || start >= yEnd) return;
    const perDay = byDay.get(end) / (len / DAY);
    for (let m = 0; m < 12; m++) {
      const overlap = Math.min(end, Date.UTC(y, m + 1, 1)) - Math.max(start, Date.UTC(y, m, 1));
      if (overlap > 0) arr[m] = (arr[m] || 0) + perDay * overlap / DAY;
    }
  });
  return arr;
}

/** Confronto anno attivo vs anno precedente, per la commodity selezionata. */
function renderBolletteYoy(commodities) {
  const pillsEl = document.getElementById('bolletteYoyPills'), note = document.getElementById('bolletteYoyNote'), titolo = document.getElementById('bolletteYoyTitolo'), legenda = document.getElementById('bollYoyLegenda');
  if (!pillsEl) return;
  if (!commodities.includes(bollYoyCommodity)) bollYoyCommodity = commodities[0] || '';
  pillsEl.innerHTML = commodities.map(c => `<button type="button" class="seg-btn" aria-pressed="${c === bollYoyCommodity}">${esc(c)}</button>`).join('');
  pillsEl.querySelectorAll('button').forEach((b, i) => b.onclick = () => { bollYoyCommodity = commodities[i]; renderBolletteYoy(commodities); });
  if (!bollYoyCommodity) { mkChart('bolletteYoyChart', { type: 'bar', data: { labels: MESI_3, datasets: [] }, options: { responsive: true, maintainAspectRatio: false, scales: scales() } }); if (note) note.textContent = ''; return; }

  const prevYear = String(parseInt(activeYear) - 1);
  const cur = bollMonthly(bollYoyCommodity, activeYear), prev = bollMonthly(bollYoyCommodity, prevYear);
  const colore = bollColore(bollYoyCommodity), grigio = cssVar('--chart-muted', '#6B7A90');
  if (titolo) titolo.textContent = `${bollYoyCommodity}, ${activeYear} contro ${prevYear}`;
  if (legenda) legenda.innerHTML = `<span><i class="leg-box" style="background:${grigio}"></i>${prevYear}</span><span><i class="leg-box" style="background:${colore}"></i>${esc(activeYear)}</span>`;
  const sc = scales();
  mkChart('bolletteYoyChart', { type: 'bar', data: { labels: MESI_3, datasets: [
    { label: prevYear, data: prev.map(Math.round), backgroundColor: grigio, borderRadius: 2 },
    { label: activeYear, data: cur.map(Math.round), backgroundColor: colore, borderRadius: 2 }
  ]}, options: { responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw || 0)}` } } },
    scales: { x: sc.x, y: { display: false, beginAtZero: true } } } });

  // Confronto a parità di periodo (fino all'ultimo mese con bollette nell'anno attivo)
  if (!note) return;
  const come = bollDividi && bollBimestrali().commodity.has(bollYoyCommodity) ? 'Bimestrali divise sui mesi coperti.' : 'Per mese di emissione.';
  const lastM = cur.reduce((L, v, i) => v > 0 ? i : L, -1);
  if (lastM < 0) { note.textContent = `Nessuna bolletta di ${bollYoyCommodity.toLowerCase()} nel ${activeYear}.`; return; }
  const periodo = lastM === 0 ? 'A gennaio' : `Da gennaio ${aMese(lastM)}`;
  const a = cur.slice(0, lastM + 1).reduce((s, v) => s + v, 0), b = prev.slice(0, lastM + 1).reduce((s, v) => s + v, 0);
  if (!(b > 0)) { note.textContent = `${periodo}: ${fmt(a)}. Nessun dato del ${prevYear} per il confronto. ${come}`; return; }
  note.textContent = `${periodo}: ${fmt(a)} contro ${fmt(b)}, ${pctParole(a, b) === 'uguale' ? 'la stessa spesa' : 'il ' + pctParole(a, b)}. ${come}`;
}

/** Consumi (barre) e spesa per competenza (linea) dell'anno, con una frase di lettura sotto. */
function renderConsumiChart(canvasId, consumoKey, label, unit, commodityName) {
  const annoConsumi = consumiData.filter(c => c.anno === activeYear);
  const consumiMensili = Array(12).fill(null);
  annoConsumi.forEach(c => { consumiMensili[c.meseIdx] = c[consumoKey]; });

  // Spesa per competenza: ogni bolletta ripartita sui mesi che copre, così la
  // linea è continua anche se le emissioni non sono mensili.
  const spesaMensile = commodityName ? bollAccrualMonthly(commodityName, activeYear) : Array(12).fill(null);

  const hasConsumi = consumiMensili.some(v => v !== null);
  const hasSpesa = spesaMensile.some(v => v !== null);
  const base = canvasId.replace('Chart', '');
  const nota = document.getElementById(base + 'Nota'), legenda = document.getElementById(base + 'Legenda');

  if (!hasConsumi && !hasSpesa) {
    if (nota) nota.textContent = 'Nessun dato per l\'anno selezionato.';
    if (legenda) legenda.innerHTML = '';
    mkChart(canvasId, { type: 'bar', data: { labels: MESI_3, datasets: [] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: scales().x, y: { display: false } } } });
    return;
  }

  const colore = commodityName ? bollColore(commodityName) : TREND_COLORS[3];
  const barre = cssVar('--line-strong', '#2E3B50');
  if (legenda) legenda.innerHTML = `${hasConsumi ? `<span><i class="leg-box" style="background:${barre}"></i>Consumi in ${unit}</span>` : ''}${hasSpesa ? `<span><i class="leg-linea" style="background:${colore}"></i>Spesa in €</span>` : ''}`;
  const datasets = [];
  if (hasSpesa) datasets.push({ type: 'line', label: 'Spesa', data: spesaMensile.map(v => v !== null ? Math.round(v) : null), borderColor: colore, backgroundColor: colore, pointBackgroundColor: colore, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0, yAxisID: 'ySpesa', spanGaps: false, order: 1 });
  if (hasConsumi) datasets.push({ type: 'bar', label: 'Consumi', data: consumiMensili, backgroundColor: barre, borderRadius: 2, yAxisID: 'yConsumi', order: 2 });

  mkChart(canvasId, { type: 'bar', data: { labels: MESI_3, datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { filter: c => c.raw !== null, callbacks: { label: c => c.dataset.label === 'Spesa' ? ` Spesa: ${fmt(c.raw)}` : ` Consumi: ${c.raw} ${unit}` } } },
      scales: {
        x: scales().x,
        yConsumi: { display: false, beginAtZero: true },
        ySpesa: { display: false, beginAtZero: true }
      } } });

  if (nota) {
    const massimo = arr => arr.reduce((m, v, i) => v !== null && (m < 0 || v > arr[m]) ? i : m, -1);
    const mC = massimo(consumiMensili), mS = massimo(spesaMensile);
    const nomeC = mC >= 0 ? MONTHS_FULL[mC].toLowerCase() : '', nomeS = mS >= 0 ? MONTHS_FULL[mS].toLowerCase() : '';
    const parti = [];
    if (mC >= 0) parti.push(`${nomeC[0].toUpperCase()}${nomeC.slice(1)} è il mese con più consumi: ${consumiMensili[mC]} ${unit}.`);
    if (mS >= 0) parti.push(mS === mC ? 'Anche la spesa è la più alta dell\'anno.' : `La spesa più alta è ${aMese(mS)}: ${fmt(spesaMensile[mS])}.`);
    nota.textContent = parti.join(' ');
  }
}
