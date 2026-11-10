/* FinFlow — Import degli estratti CSV della banca (conto e carta) nel foglio: scelta dei file,
   anteprima con le categorie proposte, conferma. Il confronto e la scrittura li fa il server
   (/api/importa/anteprima e /api/importa/conferma, lib/importa.js). */
/* ============================================================
   IMPORTA MOVIMENTI
   ============================================================ */
let impStato = { files: [], anteprima: null, password: '' };

/** Il pulsante Importa compare solo se il server ha foglio unico, account di servizio e password. */
function syncImportButton(abilitato) {
  document.querySelectorAll('.import-btn').forEach(b => { b.hidden = !abilitato; });
}

function apriImport() {
  impStato = { files: [], anteprima: null, password: impStato.password };
  const modal = document.getElementById('importModal');
  ricordaFocus(modal);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  renderImportScelta();
  const btn = document.getElementById('impChiudi');
  if (btn) btn.focus();
}

function chiudiImport() {
  const modal = document.getElementById('importModal');
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  restituisciFocus(modal);
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('importModal');
  if (modal && !modal.hidden && e.key === 'Escape') { e.preventDefault(); chiudiImport(); }
});

function impErrore(msg) {
  const el = document.getElementById('impErr');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}

/* --- Passo 1: file e password --- */
function renderImportScelta() {
  document.getElementById('impSub').textContent = 'Liste movimenti del conto e della carta scaricate dalla banca (CSV)';
  document.getElementById('impBody').innerHTML = `
    <div class="imp-scelta">
      <label class="imp-drop">
        <input type="file" id="impFile" accept=".csv,text/csv" multiple onchange="impFileScelti(this.files)">
        <span class="b tx">Scegli i file CSV</span>
        <span class="fs-12 muted">Puoi sceglierne più di uno insieme (conto e carta)</span>
      </label>
      <div id="impFiles" class="prev-list"></div>
      <label class="fs-12 muted" for="impPwd">Password per scrivere nel foglio</label>
      <input type="password" id="impPwd" class="filter-input" autocomplete="current-password" value="${esc(impStato.password)}"
        onkeydown="if (event.key === 'Enter') impAnteprima()">
      <div class="setup-err" id="impErr" role="alert" hidden></div>
      <div class="imp-actions">
        <button type="button" class="btn-sm imp-primary" id="impGo" onclick="impAnteprima()" disabled>Controlla i movimenti</button>
      </div>
      <div class="note">Niente viene scritto finché non confermi. I movimenti già nel foglio vengono riconosciuti dal codice della banca e saltati.</div>
    </div>`;
}

/** Testo del file: UTF-8, oppure Windows-1252 se non è UTF-8 valido (export di alcune banche). */
async function leggiFileTesto(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}

async function impFileScelti(fileList) {
  impErrore('');
  const files = [...fileList];
  impStato.files = await Promise.all(files.map(async f => ({ nome: f.name, testo: await leggiFileTesto(f) })));
  document.getElementById('impFiles').innerHTML = impStato.files.map(f => `
    <div class="prev-row"><span class="prev-descr">${esc(f.nome)}</span><span class="fs-12 muted">${Math.max(0, f.testo.split('\n').length - 1)} righe</span></div>`).join('');
  document.getElementById('impGo').disabled = !impStato.files.length;
}

async function impChiama(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    // La password va in un'intestazione: codificata, perché le intestazioni accettano solo ASCII
    headers: { 'Content-Type': 'application/json', 'X-FinFlow': '1', 'X-FinFlow-Password': encodeURIComponent(impStato.password) },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch (e) {}
  if (!res.ok || json.error) throw new Error(json.error || `Il server risponde ${res.status}`);
  return json;
}

async function impAnteprima() {
  const pwd = document.getElementById('impPwd');
  impStato.password = pwd ? pwd.value : impStato.password;
  if (!impStato.files.length) return;
  if (!impStato.password) { impErrore('Scrivi la password.'); return; }
  const btn = document.getElementById('impGo');
  btn.disabled = true; btn.textContent = 'Controllo…';
  try {
    impStato.anteprima = await impChiama('/api/importa/anteprima', { file: impStato.files });
    renderImportAnteprima();
  } catch (e) {
    impErrore(e.message);
    btn.disabled = false; btn.textContent = 'Controlla i movimenti';
  }
}

/* --- Passo 2: anteprima --- */
const IMP_FONTE = { storico: 'come l\'ultima volta', banca: 'categoria della banca' };

function renderImportAnteprima() {
  const a = impStato.anteprima;
  const nuovi = a.righe.filter(r => r.stato === 'nuovo');
  const agg = a.righe.filter(r => r.stato === 'aggiorna');
  const pres = a.righe.filter(r => r.stato === 'presente');
  document.getElementById('impSub').textContent = a.file.map(f => `${f.nome} (${f.formato === 'carta' ? 'carta' : 'conto'}, ${f.movimenti} movimenti)`).join(' · ');

  const amt = r => `<span class="ctl-amt ${r.amount < 0 ? 'out' : 'pos'}">${r.amount < 0 ? '−' : '+'} ${fmtCents(Math.abs(r.amount))}</span>`;
  const badge = r => (r.carta ? CARD_BADGE : '') + (r.provvisorio ? '<span class="imp-badge" title="Non ancora contabilizzato: il codice verrà aggiornato al prossimo import">in attesa</span>' : '');

  let html = `<div class="imp-riepilogo">
      <span><span class="ctl-count imp-new">${nuovi.length}</span> nuovi</span>
      <span><span class="ctl-count">${agg.length}</span> da aggiornare</span>
      <span><span class="ctl-count imp-dim">${pres.length}</span> già nel foglio</span>
    </div>`;
  a.file.forEach(f => {
    if (f.saldo && !isNaN(f.saldo.importo)) html += `<div class="note">Saldo del conto al ${esc(f.saldo.data || '')}: <span class="tx">${fmtCents(f.saldo.importo)}</span></div>`;
    if (f.scartate.length) html += `<div class="note ctl-warn">⚠ ${esc(f.nome)}: ${f.scartate.length} righe non lette (${f.scartate.map(s => 'riga ' + s.riga).join(', ')})</div>`;
  });

  if (nuovi.length) {
    html += `<div class="mese-block-title mt">Da aggiungere</div>
      ${datalistCategorie('imp')}
      <div class="imp-list">${nuovi.map(r => `
        <div class="imp-row" data-id="${esc(r.id)}">
          <label class="imp-check"><input type="checkbox" checked aria-label="Aggiungi ${esc(r.op)}"></label>
          <div class="imp-main">
            <div class="imp-line">
              <span class="prev-date">${esc(r.date)}</span>
              <span class="prev-descr" title="${esc(r.op)}">${esc(r.op || '—')}${badge(r)}</span>
              ${amt(r)}
            </div>
            <div class="imp-cats">
              <input class="filter-input imp-cat" list="impCats" value="${esc(r.cat)}" placeholder="Categoria" aria-label="Categoria">
              <input class="filter-input imp-sub" list="impSubs" value="${esc(r.sub)}" placeholder="Sottocategoria" aria-label="Sottocategoria">
              <span class="fs-11 ${r.fonte ? 'muted' : 'ctl-warn'}">${r.fonte ? IMP_FONTE[r.fonte] : '⚠ senza categoria'}</span>
            </div>
          </div>
        </div>`).join('')}</div>`;
  }
  if (agg.length) {
    html += `<details class="ctl-group mt"><summary><span class="ctl-count">${agg.length}</span>codici da aggiornare</summary>
      <div class="note">Movimenti già nel foglio con un codice provvisorio: ora la banca li ha contabilizzati e viene scritto il codice definitivo.</div>
      <div class="prev-list">${agg.map(r => `
        <div class="prev-row"><span class="prev-date">${esc(r.date)}</span>
          <span class="prev-descr">${esc(r.op)}<span class="prev-cat">riga ${r.riga}: ${esc(r.codiceVecchio || '(vuoto)')} → ${esc(r.codice)}</span></span>${amt(r)}</div>`).join('')}</div>
    </details>`;
  }
  if (pres.length) {
    html += `<details class="ctl-group"><summary><span class="ctl-count imp-dim">${pres.length}</span>già nel foglio, saltati</summary>
      <div class="prev-list">${pres.map(r => `
        <div class="prev-row"><span class="prev-date">${esc(r.date)}</span>
          <span class="prev-descr">${esc(r.op)}<span class="prev-cat">riga ${r.riga} · ${esc(r.cat)}${r.sub ? ' · ' + esc(r.sub) : ''}</span></span>${amt(r)}</div>`).join('')}</div>
    </details>`;
  }
  const addebiti = a.righe.filter(r => r.stato === 'addebitoCarta');
  if (addebiti.length) {
    html += `<details class="ctl-group"><summary><span class="ctl-count imp-dim">${addebiti.length}</span>addebiti della carta di credito, saltati</summary>
      <div class="note">Il totale della carta addebitato sul conto non viene scritto: le singole spese arrivano dall'estratto della carta.</div>
      <div class="prev-list">${addebiti.map(r => `
        <div class="prev-row"><span class="prev-date">${esc(r.date)}</span>
          <span class="prev-descr">${esc(r.op)}</span>${amt(r)}</div>`).join('')}</div>
    </details>`;
  }
  const daScrivere = nuovi.length + agg.length;
  html += `<div class="setup-err" id="impErr" role="alert" hidden></div>
    <div class="imp-actions">
      <button type="button" class="btn-sm" onclick="renderImportScelta()">Indietro</button>
      ${daScrivere ? `<button type="button" class="btn-sm imp-primary" id="impConferma" onclick="impConferma()">Scrivi nel foglio</button>`
        : '<span class="muted fs-12">Niente da scrivere: il foglio è già aggiornato ✓</span>'}
    </div>`;
  document.getElementById('impBody').innerHTML = html;
}

/* --- Passo 3: conferma e scrittura --- */
async function impConferma() {
  const modifiche = {};
  document.querySelectorAll('#impBody .imp-row').forEach(row => {
    const r = impStato.anteprima.righe.find(x => x.id === row.dataset.id);
    const cat = row.querySelector('.imp-cat').value.trim(), sub = row.querySelector('.imp-sub').value.trim();
    const m = {};
    if (!row.querySelector('input[type=checkbox]').checked) m.escludi = true;
    if (cat !== r.cat) m.cat = cat;
    if (sub !== r.sub) m.sub = sub;
    if (Object.keys(m).length) modifiche[r.id] = m;
  });
  const btn = document.getElementById('impConferma');
  btn.disabled = true; btn.textContent = 'Scrivo…';
  try {
    const json = await impChiama('/api/importa/conferma', { file: impStato.files, modifiche });
    loadFromServerResponse(json.data);
    const { aggiunti, aggiornati } = json.esito;
    document.getElementById('impBody').innerHTML = `
      <div class="empty">✓ Foglio aggiornato: ${aggiunti} ${aggiunti === 1 ? 'movimento aggiunto' : 'movimenti aggiunti'}${aggiornati ? `, ${aggiornati} ${aggiornati === 1 ? 'codice aggiornato' : 'codici aggiornati'}` : ''}. I dati del portale sono già ricaricati.</div>
      <div class="imp-actions"><button type="button" class="btn-sm" onclick="apriImport()">Importa altri file</button><button type="button" class="btn-sm imp-primary" onclick="chiudiImport()">Chiudi</button></div>`;
  } catch (e) {
    impErrore(e.message);
    btn.disabled = false; btn.textContent = 'Scrivi nel foglio';
  }
}
