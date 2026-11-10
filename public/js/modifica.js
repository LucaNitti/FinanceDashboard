/* FinFlow — Modifiche dal portale scritte nel foglio unico (POST /api/modifica): categoria di un
   movimento, spesa o entrata ricorrente nuova, spesa prevista nuova o pagata. Una sola finestra (#editModal)
   per tutte; la password è quella dell'import, chiesta una volta per sessione (impStato.password). */
/* ============================================================
   FINESTRA DI MODIFICA
   ============================================================ */
let edCorrente = null; // { payload(valori) → body, campi }

/** Suggerimenti per i campi categoria e sottocategoria: tutte quelle usate negli anni. */
function datalistCategorie(prefisso) {
  const cats = new Set(), subs = new Set();
  Object.values(allData).forEach(rows => rows.forEach(r => { if (r.cat) cats.add(r.cat); if (r.sub) subs.add(r.sub); }));
  const opz = set => [...set].sort((x, y) => x.localeCompare(y, 'it')).map(v => `<option value="${esc(v)}">`).join('');
  return `<datalist id="${prefisso}Cats">${opz(cats)}</datalist><datalist id="${prefisso}Subs">${opz(subs)}</datalist>`;
}

/**
 * Apre la finestra. campi: [{ id, label, value, list ('cat'|'sub'), tipo, placeholder, nota }];
 * payload(valori) → corpo per /api/modifica. `pericolo` = bottone di conferma rosso.
 */
function apriModifica({ titolo, sotto = '', testo = '', campi = [], bottone = 'Salva', pericolo = false, payload, dopo }) {
  edCorrente = { payload, dopo };
  document.getElementById('edTitle').textContent = titolo;
  document.getElementById('edSub').textContent = sotto;
  const campo = c => `
    <label class="ed-field">
      <span class="fs-12 muted">${esc(c.label)}</span>
      <input class="filter-input" data-campo="${esc(c.id)}" type="${c.tipo || 'text'}" ${c.tipo === 'number' ? 'step="0.01" inputmode="decimal"' : ''}
        value="${esc(c.value == null ? '' : c.value)}" placeholder="${esc(c.placeholder || '')}"
        ${c.list ? `list="ed${c.list === 'cat' ? 'Cats' : 'Subs'}"` : ''} onkeydown="if (event.key === 'Enter') edSalva()">
      ${c.nota ? `<span class="fs-11 muted">${esc(c.nota)}</span>` : ''}
    </label>`;
  document.getElementById('edBody').innerHTML = `
    ${testo ? `<div class="ed-testo">${testo}</div>` : ''}
    ${datalistCategorie('ed')}
    <div class="ed-campi">${campi.map(campo).join('')}</div>
    ${impStato.password ? '' : `<label class="ed-field"><span class="fs-12 muted">Password per scrivere nel foglio</span>
      <input class="filter-input" id="edPwd" type="password" autocomplete="current-password" onkeydown="if (event.key === 'Enter') edSalva()"></label>`}
    <div class="setup-err" id="edErr" role="alert" hidden></div>
    <div class="imp-actions">
      <button type="button" class="btn-sm" onclick="chiudiModifica()">Annulla</button>
      <button type="button" class="btn-sm ${pericolo ? 'ed-danger' : 'imp-primary'}" id="edGo" onclick="edSalva()">${esc(bottone)}</button>
    </div>`;
  const modal = document.getElementById('editModal');
  if (modal.hidden) ricordaFocus(modal);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const primo = document.querySelector('#edBody input');
  if (primo) primo.focus();
}

function chiudiModifica() {
  const modal = document.getElementById('editModal');
  modal.hidden = true;
  if (document.getElementById('importModal').hidden) document.body.classList.remove('modal-open');
  edCorrente = null;
  restituisciFocus(modal);
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('editModal');
  if (modal && !modal.hidden && e.key === 'Escape') { e.preventDefault(); chiudiModifica(); }
});

async function edSalva() {
  if (!edCorrente) return;
  const err = document.getElementById('edErr');
  const valori = {};
  document.querySelectorAll('#edBody [data-campo]').forEach(i => { valori[i.dataset.campo] = i.value.trim(); });
  const pwd = document.getElementById('edPwd');
  if (pwd) impStato.password = pwd.value;
  if (!impStato.password) { err.hidden = false; err.textContent = 'Scrivi la password.'; return; }
  const btn = document.getElementById('edGo');
  const testoBtn = btn.textContent;
  btn.disabled = true; btn.textContent = 'Scrivo…';
  try {
    const { dopo } = edCorrente;
    const json = await impChiama('/api/modifica', edCorrente.payload(valori));
    chiudiModifica();
    loadFromServerResponse(json.data);
    if (dopo) dopo(valori);
  } catch (e) {
    if (/password/i.test(e.message)) impStato.password = '';
    err.hidden = false; err.textContent = e.message;
    btn.disabled = false; btn.textContent = testoBtn;
  }
}

/* ============================================================
   AZIONI
   ============================================================ */
/** Movimento per numero di riga del foglio (unico nel foglio unico). */
function movimentoPerRiga(riga) {
  for (const rows of Object.values(allData)) { const r = rows.find(x => x.riga === riga); if (r) return r; }
  return null;
}

/** Valori iniziali diversi da quelli del movimento (scelti nei menu della tabella Dati) ed errore da mostrare. */
function modificaCategoria(riga, valori = {}, errore = '', dopoSalvataggio = null) {
  const r = movimentoPerRiga(riga);
  if (!r) return;
  apriModifica({
    titolo: 'Cambia categoria',
    sotto: `${r.date} · ${r.amount < 0 ? '−' : '+'} ${fmtCents(Math.abs(r.amount))} · riga ${r.riga} del foglio`,
    testo: esc(r.op || '—'),
    campi: [
      { id: 'cat', label: 'Categoria', value: valori.cat != null ? valori.cat : r.cat === 'Altro' ? '' : r.cat, list: 'cat' },
      { id: 'sub', label: 'Sottocategoria', value: valori.sub != null ? valori.sub : r.sub, list: 'sub' },
    ],
    payload: v => ({ azione: 'categoria', riga: r.riga, date: r.date, op: r.op, amount: r.amount, cat: v.cat, sub: v.sub }),
    dopo: dopoSalvataggio && (v => dopoSalvataggio(v.cat, v.sub)),
  });
  // Valori già scelti nella tabella: manca solo la password
  const pwd = document.getElementById('edPwd');
  if (pwd && valori.cat) pwd.focus();
  if (errore) { const e = document.getElementById('edErr'); e.hidden = false; e.textContent = errore; }
}

/**
 * Dai campi della tabella Dati: scrive subito se la password è già nota, altrimenti (o se la
 * scrittura fallisce) apre la finestra con i valori scelti, dove si mette la password.
 * Dopo il salvataggio resta sulla stessa pagina e dice com'è andata.
 */
async function salvaCategoriaRiga(riga, cat, sub, controlli = []) {
  const r = movimentoPerRiga(riga);
  if (!r) return;
  const pagina = datiPage, nomeOp = r.op || 'Il movimento';
  const fatto = (c, s) => {
    datiPage = pagina;
    renderDati();
    const nomi = [c, subVera(s)].filter(Boolean).join(' · ');
    const campoCat = document.querySelector(`#datiTableEl input.cat-sel[data-riga="${riga}"][data-campo="cat"]`);
    datiEsito(`Salvato: ${nomeOp} ora è in ${nomi}.${campoCat ? '' : ' Non è più in elenco perché i filtri lo escludono.'}`);
    // Categoria cambiata e sottocategorie disponibili: si può scegliere subito anche quella
    if (campoCat && !subVera(s) && (mappaCategorie().get(c) || new Set()).size) {
      const campoSub = campoCat.closest('tr').querySelector('[data-campo="sub"]');
      if (campoSub) campoSub.focus();
    }
  };
  if (!impStato.password) { modificaCategoria(riga, { cat, sub }, '', fatto); renderDati(); return; }
  controlli.forEach(c => { c.disabled = true; });
  datiEsito('Salvo…');
  try {
    const json = await impChiama('/api/modifica', { azione: 'categoria', riga: r.riga, date: r.date, op: r.op, amount: r.amount, cat, sub });
    loadFromServerResponse(json.data);
    fatto(cat, sub);
  } catch (e) {
    if (/password/i.test(e.message)) impStato.password = '';
    controlli.forEach(c => { c.disabled = false; });
    datiEsito('');
    modificaCategoria(riga, { cat, sub }, e.message, fatto);
    renderDati();
  }
}

/** Toglie un movimento dalla scheda dati (riga eliminata), dopo conferma. */
function eliminaMovimento(riga) {
  const r = movimentoPerRiga(riga);
  if (!r) return;
  apriModifica({
    titolo: 'Togliere il movimento?',
    sotto: `${r.date} · ${r.amount < 0 ? '−' : '+'} ${fmtCents(Math.abs(r.amount))} · riga ${r.riga} del foglio`,
    testo: `Tolgo <b>${esc(r.op || '—')}</b> (${esc(r.cat)}${r.sub ? ' · ' + esc(r.sub) : ''}) dalla scheda «dati» del foglio.
      <br><span class="fs-12 muted">Se reimporti un estratto conto che lo contiene, verrà aggiunto di nuovo.</span>`,
    bottone: 'Sì, togli dal foglio', pericolo: true,
    payload: () => ({ azione: 'eliminaMovimento', riga: r.riga, date: r.date, op: r.op, amount: r.amount }),
  });
}

/** Dal widget Possibili abbonamenti: riga nuova nella scheda Ricorrenti, campi modificabili. */
function aggiungiAbbonamento(i) {
  const a = abbonamentiData[i];
  if (!a) return;
  apriModifica({
    titolo: 'Aggiungi a Ricorrenti',
    sotto: `${a.op}`,
    campi: [
      { id: 'descr', label: 'Descrizione', value: a.descr },
      { id: 'importo', label: 'Importo al mese (€)', value: a.importo, tipo: 'number' },
      { id: 'cat', label: 'Categoria', value: a.cat, list: 'cat' },
      { id: 'sub', label: 'Sottocategoria', value: a.sub, list: 'sub' },
      { id: 'match', label: 'Corrispondenza', value: a.corrispondenza,
        nota: a.condivisa ? '⚠ Compare anche in altri pagamenti: la voce prevista sparirà con uno qualunque di questi' : 'Testo cercato nella descrizione dei movimenti per riconoscere l\'addebito' },
    ],
    bottone: 'Aggiungi',
    payload: v => ({ azione: 'ricorrente', descr: v.descr, importo: Number(v.importo), cat: v.cat, sub: v.sub, match: v.match }),
  });
}

/**
 * Dal widget Spese previste: uscita (affitto, rata...) o entrata (stipendio, affitto incassato...)
 * mensile nella scheda Ricorrenti.
 */
function aggiungiRicorrente(entrata) {
  apriModifica({
    titolo: entrata ? 'Nuova entrata ricorrente' : 'Nuova uscita ricorrente',
    sotto: 'Scheda «Ricorrenti» del foglio · ogni mese fino a dicembre',
    campi: [
      { id: 'descr', label: 'Descrizione', placeholder: entrata ? 'es. Stipendio' : 'es. Affitto' },
      { id: 'importo', label: 'Importo al mese (€)', tipo: 'number' },
      { id: 'cat', label: 'Categoria', list: 'cat' },
      { id: 'sub', label: 'Sottocategoria', list: 'sub' },
      { id: 'match', label: 'Corrispondenza',
        nota: `Testo cercato nella descrizione ${entrata ? 'degli accrediti' : 'degli addebiti'} per riconoscerla (vuoto = la descrizione)` },
    ],
    bottone: 'Aggiungi',
    payload: v => ({ azione: 'ricorrente', entrata, descr: v.descr, importo: Number(v.importo), cat: v.cat, sub: v.sub, match: v.match }),
  });
}

function aggiungiPrevista() {
  const now = new Date();
  apriModifica({
    titolo: 'Nuova spesa prevista',
    sotto: 'Scheda «Previste» del foglio',
    campi: [
      { id: 'data', label: 'Data prevista', value: `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`, placeholder: 'MM/AAAA o GG/MM/AAAA',
        nota: 'MM/AAAA se non conosci il giorno' },
      { id: 'descr', label: 'Descrizione' },
      { id: 'importo', label: 'Importo (€)', tipo: 'number' },
      { id: 'cat', label: 'Categoria', list: 'cat' },
      { id: 'sub', label: 'Sottocategoria', list: 'sub' },
    ],
    bottone: 'Aggiungi',
    payload: v => ({ azione: 'prevista', data: v.data, descr: v.descr, importo: Number(v.importo), cat: v.cat, sub: v.sub }),
  });
}

/** Dal widget Spese annuali in arrivo: riga nuova nella scheda Previste per il mese atteso. */
function aggiungiAnnuale(i) {
  const a = annualiData[i];
  if (!a) return;
  apriModifica({
    titolo: 'Aggiungi alle Previste',
    sotto: a.op,
    campi: [
      { id: 'data', label: 'Data prevista', value: `${String(a.mese + 1).padStart(2, '0')}/${a.anno}`, placeholder: 'MM/AAAA o GG/MM/AAAA',
        nota: 'Stesso periodo dell\'ultima volta' },
      { id: 'descr', label: 'Descrizione', value: a.descr },
      { id: 'importo', label: 'Importo (€)', value: a.importo, tipo: 'number', nota: 'Ultimo importo pagato' },
      { id: 'cat', label: 'Categoria', value: a.cat, list: 'cat' },
      { id: 'sub', label: 'Sottocategoria', value: a.sub, list: 'sub' },
    ],
    bottone: 'Aggiungi',
    payload: v => ({ azione: 'prevista', data: v.data, descr: v.descr, importo: Number(v.importo), cat: v.cat, sub: v.sub }),
  });
}

/** Spesa prevista pagata: la riga viene tolta dalla scheda Previste. */
function previstaPagata(riga) {
  const p = Object.values(previsteData).flat().find(x => x.riga === riga && !x.ricorrente);
  if (!p) return;
  const data = `${p.giorno ? String(p.giorno).padStart(2, '0') + '/' : ''}${String(p.mese + 1).padStart(2, '0')}/${p.anno}`;
  apriModifica({
    titolo: 'Spesa pagata?',
    sotto: `${data} · ${fmtCents(p.importo)}`,
    testo: `Tolgo <b>${esc(p.descr || '—')}</b> dalla scheda «Previste» del foglio (riga ${p.riga}).`,
    bottone: 'Sì, togli dal foglio', pericolo: true,
    payload: () => ({ azione: 'eliminaPrevista', riga: p.riga, data, descr: p.descr, importo: p.importo }),
  });
}
