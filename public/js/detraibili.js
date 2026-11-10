/* FinFlow — Spese detraibili dell'anno (tab Categorie) ed export CSV per il 730. Regole in config.json. */
/* ============================================================
   SPESE DETRAIBILI
   ============================================================ */
function renderDetraibili() {
  const el = document.getElementById('detraibiliCard');
  if (!el) return;
  const voci = detraibiliData[activeYear] || [];
  let html = `<div class="det-testa">
      <h2 class="section-title">Spese detraibili ${esc(activeYear)}</h2>
      ${voci.some(v => v.movimenti.length) ? `<button type="button" class="btn-sm" onclick="scaricaDetraibiliCsv()">Scarica CSV</button>` : ''}
    </div>`;
  if (!voci.length) {
    el.innerHTML = html + `<div class="empty">Nessuna regola configurata. Aggiungi la chiave «detraibili» in config.json (vedi README): per ogni voce le categorie o i testi da cercare.</div>`;
    return;
  }

  const regola = v => [
    `${v.movimenti.length} ${v.movimenti.length === 1 ? 'movimento' : 'movimenti'}`,
    v.percentuale ? `${v.percentuale}%` + (v.franchigia ? `, franchigia ${fmtCents(v.franchigia)}` : '') + (v.tetto ? `, fino a ${fmt(v.tetto)} di spesa` : '') : '',
  ].filter(Boolean).join(', ');
  html += `<div class="ctl-groups">` + voci.map(v => `
    <details class="ctl-group">
      <summary>
        <span class="det-voce">${esc(v.voce)}<span class="prev-cat">${regola(v)}</span></span>
        <span class="det-nums">
          <span class="tx b">${fmtCents(v.totale)}</span>
          ${v.detrazione !== null ? `<span class="pos fs-12">detrazione circa ${fmt(v.detrazione)}</span>` : ''}
        </span>
      </summary>
      ${v.movimenti.length ? `<div class="prev-list">${v.movimenti.map(m => `
        <div class="prev-row">
          <span class="prev-date">${esc(m.date)}</span>
          <span class="prev-descr" title="${esc(m.op)}">${esc(m.op || '—')}<span class="prev-cat">${m.card ? CARD_BADGE.replace('card-badge', 'card-badge lead') : ''}${esc(m.cat)}${m.sub ? ' · ' + esc(m.sub) : ''}</span></span>
          <span class="ctl-amt">${fmtCents(m.amount)}</span>
        </div>`).join('')}</div>` : `<div class="empty">Nessuna uscita per questa voce nel ${esc(activeYear)}.</div>`}
    </details>`).join('') + `</div>`;
  html += `<p class="note">Stima indicativa: il conto vero è quello del 730 precompilato o del CAF. Regole in config.json.</p>`;
  el.innerHTML = html;
}

/** CSV per Excel in italiano: separatore «;», decimali con la virgola, BOM per gli accenti. */
function scaricaDetraibiliCsv() {
  const voci = detraibiliData[activeYear] || [];
  // Testo che inizia con = + - @ verrebbe letto da Excel come formula: l'apostrofo lo tiene testo
  const cell = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s.replace(',', '.')))) s = "'" + s;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = v => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  const righe = [['Voce', 'Data', 'Descrizione', 'Categoria', 'Sottocategoria', 'Importo', 'Carta']];
  voci.forEach(v => v.movimenti.forEach(m => righe.push([v.voce, m.date, m.op, m.cat, m.sub, num(m.amount), m.card ? 'sì' : ''])));
  const csv = '﻿' + righe.map(r => r.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `spese-detraibili-${activeYear}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
