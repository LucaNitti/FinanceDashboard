/* FinFlow — Controllo dati (tab Dati, badge in navigazione) e possibili abbonamenti (Panoramica). */
/* ============================================================
   CONTROLLO DATI — problemi del foglio trovati dal server in lettura
   ============================================================ */
/** Problemi dell'anno: righe del foglio (controlliData) + ricorrenti senza movimento (solo anno in corso). */
function getControlli(year = activeYear) {
  const c = controlliData[year];
  const ric = ricorrentiNonTrovate.anno === String(year) ? ricorrentiNonTrovate.voci || [] : [];
  if (!c) return { disponibile: false, ric, totale: ric.length };
  const totale = c.scartate.length + c.doppioni.length + c.senzaCategoria.length + c.dateAnomale.length + ric.length;
  return { disponibile: true, ...c, ric, totale };
}

/** Numero di problemi sul pulsante Dati (barra in alto e in basso). */
function updateControlliBadge() {
  const n = getControlli().totale;
  document.querySelectorAll('[data-section="dati"]').forEach(btn => {
    let b = btn.querySelector('.nav-badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; btn.appendChild(b); }
    b.textContent = n > 99 ? '99+' : n;
    b.title = `${n} ${n === 1 ? 'problema' : 'problemi'} nei dati del ${activeYear}`;
  });
}

const CONTROLLI_MAX_RIGHE = 30;
const segnoImporto = a => `<span class="ctl-amt ${a < 0 ? 'out' : 'pos'}">${a < 0 ? '−' : '+'} ${fmtCents(Math.abs(a))}</span>`;

/** Testata della scheda Dati: titolo, e un badge con l'esito del controllo; se ci sono problemi apre l'elenco. */
function renderControlli() {
  const el = document.getElementById('controlliCard');
  if (!el) return;
  const c = getControlli();
  const badge = document.getElementById('controlliBadge');
  const titolo = document.getElementById('datiTitolo'), sub = document.getElementById('datiPaginaSub');
  if (titolo) titolo.textContent = `Movimenti ${activeYear}`;
  if (sub) sub.textContent = scritturaAbilitata ? 'Cambia la categoria direttamente nella riga. Le modifiche vanno nel foglio dei dati.' : 'Tutti i movimenti dell\'anno, con ricerca e filtri.';
  const spunta = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';
  if (!c.disponibile && !c.ric.length) {
    el.hidden = true; el.innerHTML = '';
    badge.innerHTML = '<span class="badge-controllo neutro">Controllo dati: premi «Aggiorna dati» per controllare il foglio</span>';
    return;
  }
  if (!c.totale) {
    el.hidden = true; el.innerHTML = '';
    badge.innerHTML = `<span class="badge-controllo ok">${spunta}Controllo dati: nessun problema nel foglio del ${esc(activeYear)}</span>`;
    return;
  }
  badge.innerHTML = `<button type="button" class="badge-controllo avviso" id="controlliApri" aria-expanded="${!el.hidden}" aria-controls="controlliCard" onclick="apriChiudiControlli()">Controllo dati: ${c.totale} ${c.totale === 1 ? 'problema' : 'problemi'} nel foglio del ${esc(activeYear)}</button>`;
  let html = `<h2 class="section-title">Controllo dati ${esc(activeYear)}</h2><p class="section-sub mb-8">Righe del foglio «dati» da sistemare. Il controllo si ripete a ogni aggiornamento.</p>`;

  const riga = (left, main, sub, right = '') => `<div class="prev-row">
      <span class="prev-date">${left}</span>
      <span class="prev-descr">${main}${sub ? `<span class="prev-cat">${sub}</span>` : ''}</span>${right}
    </div>`;
  const mov = x => riga(`riga ${x.riga}`, esc(x.op || '—'), esc(x.date), segnoImporto(x.amount));
  const gruppi = [
    { list: c.scartate || [], titolo: 'righe non conteggiate',
      nota: 'Senza data o con un importo che non si legge: non entrano in nessun totale.',
      row: x => riga(`riga ${x.riga}`, esc(x.testo || '(vuota)'), esc(x.motivo)) },
    { list: c.doppioni || [], titolo: 'possibili doppioni',
      nota: 'Stessa data, importo e descrizione di una riga precedente. Se sono due spese vere, ignora l\'avviso.',
      row: x => riga(`riga ${x.riga}`, esc(x.op || '—'), `${esc(x.date)} · uguale alla riga ${x.rigaPrima}`, segnoImporto(x.amount)) },
    { list: c.senzaCategoria || [], titolo: 'movimenti senza categoria',
      nota: scritturaAbilitata ? 'Contati in «Altro»: assegna una categoria con il pulsante.' : 'Contati in «Altro»: assegna una categoria nel foglio.',
      row: x => riga(`riga ${x.riga}`, esc(x.op || '—'), esc(x.date), segnoImporto(x.amount)
        + (scritturaAbilitata ? `<button type="button" class="btn-sm abb-copy" onclick="modificaCategoria(${x.riga})">Categoria</button>` : '')) },
    { list: c.dateAnomale || [], titolo: 'date da controllare',
      nota: `Data non leggibile o di un altro anno: il movimento finisce nel mese sbagliato o in nessun mese.`,
      row: x => riga(`riga ${x.riga}`, esc(x.op || '—'), `${esc(x.date)} · ${esc(x.motivo)}`, segnoImporto(x.amount)) },
    { list: c.ric, titolo: 'voci ricorrenti senza movimento',
      nota: 'Scheda «Ricorrenti»: se il contratto è chiuso togli la riga, se la banca ha cambiato descrizione aggiorna la Corrispondenza. Finché non trova l\'addebito (o l\'accredito, per le entrate fisse), la voce resta tra le previste.',
      row: x => riga(x.entrata ? 'entrata' : '', esc(x.descr), x.ultimoMese === null
        ? `nessuna ${x.entrata ? 'entrata' : 'uscita'} contiene «${esc(x.match)}» nel ${esc(activeYear)}`
        : `«${esc(x.match)}» trovato l'ultima volta a ${MONTHS_FULL[x.ultimoMese].toLowerCase()}`) },
  ];

  html += `<div class="ctl-groups">` + gruppi.filter(g => g.list.length).map(g => {
    const extra = g.list.length - CONTROLLI_MAX_RIGHE;
    return `<details class="ctl-group">
      <summary><span class="ctl-count">${g.list.length}</span>${g.titolo}</summary>
      <div class="note">${g.nota}</div>
      <div class="prev-list">${g.list.slice(0, CONTROLLI_MAX_RIGHE).map(g.row).join('')}</div>
      ${extra > 0 ? `<div class="note">… e altre ${extra}</div>` : ''}
    </details>`;
  }).join('') + `</div>`;
  el.innerHTML = html;
}

/**
 * «Da classificare»: le uscite dell'anno nelle categorie generiche di config.json (Satispay,
 * Trasferimenti...), dalla più grande, per dare loro una categoria vera con il pulsante.
 */
function renderDaClassificare() {
  const el = document.getElementById('daClassificare');
  if (!el) return;
  const lista = categorieGeneriche.length ? (allData[activeYear] || [])
    .filter(r => r.amount < 0 && categorieGeneriche.includes(String(r.cat || '').toLowerCase()))
    .sort((a, b) => a.amount - b.amount) : [];
  el.hidden = !lista.length;
  if (el.hidden) { el.innerHTML = ''; return; }
  const tot = lista.reduce((s, r) => s + Math.abs(r.amount), 0);
  const nomi = [...new Set(lista.map(r => r.cat))];
  const extra = lista.length - CONTROLLI_MAX_RIGHE;
  el.innerHTML = `<details class="ctl-group">
    <summary><span class="ctl-count">${lista.length}</span>da classificare: ${fmt(tot)} in ${esc(nomi.join(', '))}</summary>
    <div class="note">Queste categorie dicono come hai pagato, non per cosa. ${scritturaAbilitata ? 'Dai a ogni movimento la categoria vera con il pulsante, dalla spesa più grande.' : 'Dai a ogni movimento la categoria vera nel foglio.'} L'elenco delle categorie generiche è in <code>config.json</code> (<code>categorieGeneriche</code>).</div>
    <div class="prev-list">${lista.slice(0, CONTROLLI_MAX_RIGHE).map(r => `<div class="prev-row">
      <span class="prev-date">${esc(r.date)}</span>
      <span class="prev-descr">${esc(r.op || '—')}<span class="prev-cat">${esc(r.cat)}${r.sub ? ` › ${esc(r.sub)}` : ''}</span></span>${segnoImporto(r.amount)}${scritturaAbilitata && r.riga ? `<button type="button" class="btn-sm abb-copy" onclick="modificaCategoria(${r.riga})">Categoria</button>` : ''}
    </div>`).join('')}</div>
    ${extra > 0 ? `<div class="note">… e altri ${extra}, più piccoli</div>` : ''}
  </details>`;
}

function apriChiudiControlli() {
  const el = document.getElementById('controlliCard');
  if (!el) return;
  el.hidden = !el.hidden;
  const b = document.getElementById('controlliApri');
  if (b) b.setAttribute('aria-expanded', String(!el.hidden));
}

/* ============================================================
   POSSIBILI ABBONAMENTI — addebiti fissi mensili non in «Ricorrenti»
   ============================================================ */
function renderAbbonamentiWidget() {
  const el = document.getElementById('abbonamentiWidget');
  if (!el) return;
  // Riguardano gli ultimi 12 mesi: hanno senso solo guardando l'anno in corso
  el.hidden = parseInt(activeYear) !== new Date().getFullYear() || !abbonamentiData.length;
  if (el.hidden) return;
  const mese = mmyyyy => { const [m, y] = mmyyyy.split('/'); return `${MESI_3[+m - 1]} ${y.slice(2)}`; };
  const mensile = abbonamentiData.reduce((s, a) => s + a.importo, 0);
  el.innerHTML = `<h3 class="check-titolo">Sembrano abbonamenti</h3>
    <p class="check-testo">Stesso importo ogni mese, ma non sono tra le ricorrenti. Insieme fanno ${fmtCents(mensile)} al mese, ${fmt(mensile * 12)} l'anno.</p>
    ${abbonamentiData.map((a, i) => `<div class="check-voce">
      <span class="check-nome" title="${esc(a.op)}">
        <span class="check-blocchetto">${esc(a.descr || a.op)}</span>
        <span class="check-dettaglio">${esc(a.cat)}${a.sub ? ' · ' + esc(a.sub) : ''}, da ${mese(a.da)}${a.volte > 1 ? `, ${a.volte} addebiti al mese` : ''}</span>
        ${a.condivisa ? '<span class="check-dettaglio prev">Stessa descrizione di altri pagamenti: controlla prima di aggiungere.</span>' : ''}
      </span>
      <span class="b nowrap">${fmtCents(a.importo)}</span>
      ${scritturaAbilitata
        ? `<button type="button" class="btn-sm" onclick="aggiungiAbbonamento(${i})" aria-label="Aggiungi ${esc(a.descr)} alle ricorrenti" title="Aggiungi alla scheda Ricorrenti del foglio">Aggiungi</button>`
        : `<button type="button" class="btn-sm" onclick="copiaAbbonamento(${i}, this)" aria-label="Copia ${esc(a.descr)} per la scheda Ricorrenti" title="Copia la riga da incollare nella scheda Ricorrenti">Copia</button>`}
    </div>`).join('')}
    <p class="check-nota">Per nascondere un falso allarme aggiungi il testo in <code>abbonamentiIgnora</code> di config.json.</p>`;
}

/* ============================================================
   SPESE ANNUALI IN ARRIVO — assicurazioni, tasse, iscrizioni che tornano ogni anno
   ============================================================ */
function renderAnnualiWidget() {
  const el = document.getElementById('annualiWidget');
  if (!el) return;
  // Calcolate rispetto a oggi: hanno senso solo guardando l'anno in corso
  el.hidden = parseInt(activeYear) !== new Date().getFullYear() || !annualiData.length;
  if (el.hidden) return;
  const annoOra = new Date().getFullYear();
  const quando = a => `${aMese(a.mese)}${a.anno !== annoOra ? ' ' + a.anno : ''}`;
  const n = annualiData.length;
  const tot = annualiData.reduce((s, a) => s + a.importo, 0);
  const prima = a => { const l = a.importi || []; return l.find(x => x.anno === a.anno - 1) || l[l.length - 1]; };
  el.innerHTML = `<h3 class="check-titolo">${n === 1 ? 'Una spesa che torna' : `${n} spese che tornano`} ogni anno</h3>
    ${annualiData.map((a, i) => { const p = prima(a); return `<div class="check-annuale">
      <p class="check-frase" title="${esc(a.op)}">${esc(a.descr)}, circa <b>${fmt(a.importo)}</b>, ${a.inRitardo ? `<span class="prev">attesa ${quando(a)} e non ancora vista</span>` : `attesa ${quando(a)}`}.${p ? ` Nel ${p.anno} era ${fmt(p.importo)}.` : ''}</p>
      ${scritturaAbilitata ? `<button type="button" class="btn-sm" onclick="aggiungiAnnuale(${i})" aria-label="Aggiungi ${esc(a.descr)} alle previste" title="Aggiungi alla scheda Previste del foglio">Aggiungi alle previste</button>` : ''}
    </div>`; }).join('')}
    <p class="check-nota">Mettendo da parte ${fmt(tot / 12)} al mese le copri.${scritturaAbilitata ? '' : ' Aggiungile alla scheda «Previste» del foglio per vederle nei saldi.'} Per nascondere un falso allarme aggiungi il testo in <code>annualiIgnora</code> di config.json.</p>`;
}

/** Riga per la scheda Ricorrenti, separata da tabulazioni: incollata nel foglio riempie le cinque colonne. */
function copiaAbbonamento(i, btn) {
  const a = abbonamentiData[i];
  if (!a) return;
  const importo = a.importo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  const testo = [a.descr, importo, a.cat, a.sub, a.corrispondenza].join('\t');
  copiaTesto(testo).then(() => {
    btn.textContent = 'Copiato ✓';
  }, () => {
    btn.textContent = 'Non riuscito';
  }).finally(() => setTimeout(() => { btn.textContent = 'Copia'; }, 1600));
}

/**
 * Copia negli appunti. navigator.clipboard esiste solo in contesto sicuro (HTTPS o
 * localhost) e può essere negato: allora si ripiega su execCommand con una textarea nascosta.
 */
function copiaTesto(testo) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(testo).catch(() => copiaConTextarea(testo));
  return copiaConTextarea(testo);
}
function copiaConTextarea(testo) {
  const ta = document.createElement('textarea');
  ta.value = testo;
  ta.setAttribute('readonly', '');
  ta.className = 'sr-only';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error('copia non riuscita'));
}
