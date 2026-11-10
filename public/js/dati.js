/* FinFlow — Sezione Dati: elenco movimenti con filtri, ricerca e paginazione. */
/* ============================================================
   SEZIONE DATI
   ============================================================ */
function initDatiFilters(data) {
  const cats = [...new Set(data.filter(r => r.amount < 0).map(r => r.cat))].sort();
  const sel = document.getElementById('datiCatFilter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Tutte</option>';
  cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === prev) o.selected = true; sel.appendChild(o); });
}

/** Categoria → sottocategorie usate, su tutti gli anni (per i menu della tabella). */
function mappaCategorie() {
  const m = new Map();
  Object.values(allData).forEach(rows => rows.forEach(r => {
    if (!r.cat) return;
    if (!m.has(r.cat)) m.set(r.cat, new Set());
    if (r.sub) m.get(r.cat).add(r.sub);
  }));
  return m;
}

const ordina = arr => [...arr].sort((x, y) => x.localeCompare(y, 'it'));
const senzaAccenti = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** La sottocategoria "-" del foglio vale come nessuna sottocategoria. */
const subVera = sub => (sub && sub !== '-' ? sub : '');

/** Campo ricercabile di categoria o sottocategoria di un movimento (foglio unico con scrittura abilitata). */
function comboCampo(r, campo) {
  const nome = campo === 'cat' ? 'Categoria' : 'Sottocategoria';
  return `<input type="text" class="cat-sel" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="comboLista"
    autocomplete="off" spellcheck="false" data-riga="${r.riga}" data-campo="${campo}" value="${esc(campo === 'cat' ? r.cat : subVera(r.sub))}"
    placeholder="${campo === 'cat' ? 'Scegli' : '—'}" aria-label="${nome} di ${esc(r.op || 'questo movimento')}">`;
}

/* ============================================================
   CAMPI RICERCABILI — un solo elenco (#comboLista), aperto sotto il campo con il focus.
   Si salva scegliendo una voce; uscendo dal campo senza scegliere torna il valore di prima.
   ============================================================ */
let combo = null; // { input, iniziale, voci: [{ valore, testo, nuova }], attiva, scritto }

function comboValori(input) {
  const r = movimentoPerRiga(Number(input.dataset.riga));
  const cats = mappaCategorie();
  if (input.dataset.campo === 'cat') { const nomi = new Set(cats.keys()); if (r) nomi.add(r.cat); return ordina(nomi); }
  const subs = new Set(r ? cats.get(r.cat) || [] : []);
  subs.delete('-');
  if (r && subVera(r.sub)) subs.add(r.sub);
  return ordina(subs);
}

function comboDisegna() {
  const lista = document.getElementById('comboLista');
  if (!combo || !lista) return;
  const { input } = combo;
  const testo = input.value.trim(), cerca = combo.scritto ? senzaAccenti(testo) : '';
  const valori = comboValori(input);
  // Prima le voci che iniziano con il testo cercato, poi quelle che lo contengono
  const trovate = valori.filter(v => senzaAccenti(v).includes(cerca));
  const voci = [...trovate.filter(v => senzaAccenti(v).startsWith(cerca)), ...trovate.filter(v => !senzaAccenti(v).startsWith(cerca))].map(v => ({ valore: v, testo: v }));
  if (input.dataset.campo === 'sub' && !cerca) voci.unshift({ valore: '', testo: 'Nessuna sottocategoria' });
  if (combo.scritto && testo && !valori.some(v => senzaAccenti(v) === cerca)) voci.push({ valore: testo, testo: `Nuova: «${testo}»`, nuova: true });
  combo.voci = voci;
  // Appena aperto è evidenziato il valore attuale; scrivendo, il primo risultato
  if (combo.scritto) combo.attiva = voci.length ? 0 : -1;
  else combo.attiva = voci.findIndex(v => v.valore === combo.iniziale);
  lista.innerHTML = voci.length ? voci.map((v, i) => `<li id="comboVoce${i}" role="option" data-i="${i}" aria-selected="${i === combo.attiva}"
    class="combo-voce${i === combo.attiva ? ' attiva' : ''}${v.nuova ? ' nuova' : ''}">${esc(v.testo)}</li>`).join('')
    : '<li class="combo-vuota">Nessuna voce</li>';
  lista.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  comboSegnaAttiva();
  comboPosiziona();
}

function comboSegnaAttiva() {
  const lista = document.getElementById('comboLista');
  lista.querySelectorAll('.combo-voce').forEach((li, i) => {
    li.classList.toggle('attiva', i === combo.attiva);
    li.setAttribute('aria-selected', String(i === combo.attiva));
    if (i === combo.attiva) li.scrollIntoView({ block: 'nearest' });
  });
  if (combo.attiva >= 0) combo.input.setAttribute('aria-activedescendant', `comboVoce${combo.attiva}`);
  else combo.input.removeAttribute('aria-activedescendant');
}

/** Sotto il campo; sopra, se sotto non c'è spazio (su telefono c'è anche la barra in basso). */
function comboPosiziona() {
  const lista = document.getElementById('comboLista');
  if (!combo || lista.hidden) return;
  const r = combo.input.getBoundingClientRect();
  const larghezza = Math.max(r.width, 220);
  lista.style.width = `${larghezza}px`;
  lista.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - larghezza - 8))}px`;
  const altezza = lista.offsetHeight;
  const sotto = window.innerHeight - r.bottom;
  lista.style.top = `${sotto >= altezza + 8 || r.top < altezza + 8 ? r.bottom + 4 : r.top - altezza - 4}px`;
}

function comboChiudi(ripristina) {
  const lista = document.getElementById('comboLista');
  if (lista) { lista.hidden = true; lista.innerHTML = ''; }
  if (!combo) return;
  const { input, iniziale } = combo;
  if (ripristina) input.value = iniziale;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  combo = null;
}

function comboApri(input) {
  if (combo && combo.input === input) return;
  comboChiudi(true);
  const r = movimentoPerRiga(Number(input.dataset.riga));
  if (!r) return;
  combo = { input, iniziale: input.dataset.campo === 'cat' ? r.cat : subVera(r.sub), voci: [], attiva: -1, scritto: false };
  input.select();
  comboDisegna();
}

/** Voce scelta: la categoria nuova tiene la sottocategoria solo se esiste anche lì. */
function comboScegli(i) {
  if (!combo || !combo.voci[i]) return;
  const { input, iniziale } = combo;
  const valore = combo.voci[i].valore;
  const riga = Number(input.dataset.riga), r = movimentoPerRiga(riga);
  const tr = input.closest('tr');
  comboChiudi(false);
  input.value = valore;
  if (!r || valore === iniziale) return;
  const campi = [tr.querySelector('[data-campo="cat"]'), tr.querySelector('[data-campo="sub"]')];
  if (input.dataset.campo === 'sub') { salvaCategoriaRiga(riga, r.cat, valore, campi); return; }
  const delleNuove = mappaCategorie().get(valore) || new Set();
  const sub = delleNuove.has(r.sub) ? r.sub : '';
  campi[1].value = subVera(sub);
  salvaCategoriaRiga(riga, valore, sub, campi);
}

document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('input.cat-sel')) comboApri(e.target); });
document.addEventListener('focusout', e => { if (combo && e.target === combo.input) comboChiudi(true); });
document.addEventListener('input', e => {
  if (!combo || e.target !== combo.input) return;
  combo.scritto = true;
  comboDisegna();
});
document.addEventListener('keydown', e => {
  if (!e.target.matches || !e.target.matches('input.cat-sel')) return;
  if (!combo) {
    if (e.key === 'ArrowDown') { e.preventDefault(); comboApri(e.target); }
    return;
  }
  const n = combo.voci.length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); combo.attiva = (combo.attiva + 1) % n; comboSegnaAttiva(); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); combo.attiva = (combo.attiva - 1 + n) % n; comboSegnaAttiva(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (combo.attiva >= 0) comboScegli(combo.attiva); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); comboChiudi(true); }
});
window.addEventListener('resize', comboPosiziona);
document.addEventListener('scroll', e => { if (combo && !(e.target.id === 'comboLista')) comboPosiziona(); }, true);
document.addEventListener('DOMContentLoaded', () => {
  const lista = document.getElementById('comboLista');
  // Il focus resta sul campo mentre si tocca l'elenco, altrimenti si chiuderebbe prima della scelta
  lista.addEventListener('mousedown', e => e.preventDefault());
  lista.addEventListener('click', e => {
    const li = e.target.closest('.combo-voce');
    if (li) comboScegli(Number(li.dataset.i));
  });
});

/** Riga sotto il conteggio con l'esito dell'ultima modifica. */
function datiEsito(testo, errore) {
  const el = document.getElementById('datiEsito');
  if (!el) return;
  el.textContent = testo || '';
  el.classList.toggle('neg', !!errore);
}

/** Testo con escape HTML e le occorrenze di `query` evidenziate con <mark>. */
function highlight(text, query) {
  if (!query) return esc(text);
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  // split con gruppo di cattura: gli indici dispari sono le occorrenze trovate
  return String(text).split(re).map((part, i) => i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join('');
}

function renderDati() {
  comboChiudi(true);
  datiEsito('');
  const data = allData[activeYear] || [];
  const search = (document.getElementById('datiSearch').value || '').toLowerCase().trim();
  const catF = document.getElementById('datiCatFilter').value;
  const tipoF = document.getElementById('datiTipoFilter').value;
  const metodoF = (document.getElementById('datiMetodoFilter') || {}).value || '';
  const meseF = document.getElementById('datiMeseFilter').value;
  const sortBy = document.getElementById('datiSortBy').value;

  let rows = data.filter(r => {
    if (tipoF === 'in' && r.amount < 0) return false;
    if (tipoF === 'out' && r.amount >= 0) return false;
    if (catF && r.cat !== catF) return false;
    if (metodoF === 'card' && !r.card) return false;
    if (metodoF === 'conto' && r.card) return false;
    if (meseF !== '' && parseMonth(r.date) !== parseInt(meseF)) return false;
    if (search && ![r.op, r.cat, r.sub, r.date, r.card ? 'carta' : ''].join(' ').toLowerCase().includes(search)) return false;
    return true;
  });

  rows = [...rows].sort((a,b) => {
    if (sortBy === 'date-desc') return dateKey(b.date) - dateKey(a.date);
    if (sortBy === 'date-asc') return dateKey(a.date) - dateKey(b.date);
    if (sortBy === 'amount-desc') return Math.abs(b.amount) - Math.abs(a.amount);
    if (sortBy === 'amount-asc') return Math.abs(a.amount) - Math.abs(b.amount);
    return 0;
  });

  const total = rows.length;
  const pages = Math.ceil(total / DATI_PAGE_SIZE);
  if (datiPage >= pages) datiPage = 0;
  const slice = rows.slice(datiPage * DATI_PAGE_SIZE, (datiPage + 1) * DATI_PAGE_SIZE);
  const cardTot = rows.reduce((s, r) => r.card ? s + Math.abs(r.amount) : s, 0);
  document.getElementById('datiCount').textContent = `${total.toLocaleString('it-IT')} ${total === 1 ? 'movimento trovato' : 'movimenti trovati'}` +
    (cardTot > 0 ? `, ${fmt(cardTot)} con la carta` : '');

  const el = document.getElementById('datiTableEl');
  const isCompact = window.matchMedia('(max-width: 760px)').matches;
  el.classList.toggle('compatta', isCompact);
  // Foglio unico con scrittura: categoria e sottocategoria da menu, e il pulsante per togliere la riga
  const editabile = scritturaAbilitata;
  const nCol = (isCompact ? 4 : 5) + (editabile ? 1 : 0);
  el.innerHTML = '<thead><tr><th>Data</th><th>Movimento</th><th>Categoria</th>' + (isCompact ? '' : '<th>Sottocategoria</th>')
    + '<th class="r">Importo</th>' + (editabile ? '<th><span class="sr-only">Togli</span></th>' : '') + '</tr></thead>';
  const tb = document.createElement('tbody');
  if (!slice.length) {
    const tr = document.createElement('tr'); tr.innerHTML = `<td colspan="${nCol}" class="empty-cell">Nessun risultato. Prova a cambiare filtri o testo di ricerca.</td>`; tb.appendChild(tr);
  } else {
    slice.forEach(r => {
      const isOut = r.amount < 0;
      const tr = document.createElement('tr');
      const modificabile = editabile && r.riga;
      const cat = modificabile ? comboCampo(r, 'cat') : highlight(r.cat, search);
      const sub = modificabile ? comboCampo(r, 'sub') : `<span class="muted fs-12">${highlight(r.sub || '—', search)}</span>`;
      tr.innerHTML = `
        <td class="dati-date">${esc(r.date)}</td>
        <td class="dati-op">${highlight(r.op || '—', search)}${r.card ? CARD_BADGE : ''}</td>
        ${isCompact ? `<td class="dati-cat">${cat}${modificabile || r.sub ? sub : ''}</td>` : `<td>${cat}</td><td>${sub}</td>`}
        <td class="dati-amt ${isOut ? 'tx' : 'pos'}">${isOut ? '−' : '+'} ${fmt(Math.abs(r.amount))}</td>
        ${editabile ? `<td class="dati-del">${modificabile ? `<button type="button" class="btn-sm dati-del-btn" onclick="eliminaMovimento(${r.riga})" aria-label="Togli ${esc(r.op || 'movimento')} dal foglio" title="Togli dal foglio">✕</button>` : ''}</td>` : ''}`;
      tb.appendChild(tr);
    });
  }
  el.appendChild(tb);

  const pager = document.getElementById('datiPager');
  pager.innerHTML = '';
  if (pages <= 1) return;
  const addBtn = (label, page, active) => {
    const b = document.createElement('button');
    b.className = 'pager-btn' + (active ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { datiPage = page; renderDati(); };
    pager.appendChild(b);
  };
  if (datiPage > 0) addBtn('←', datiPage - 1, false);
  let start = Math.max(0, datiPage - 3), end = Math.min(pages - 1, datiPage + 3);
  if (start > 0) { addBtn('1', 0, false); if (start > 1) pager.appendChild(Object.assign(document.createElement('span'), { textContent: '…', className: 'pager-gap' })); }
  for (let p = start; p <= end; p++) addBtn(p + 1, p, p === datiPage);
  if (end < pages - 1) { pager.appendChild(Object.assign(document.createElement('span'), { textContent: '…', className: 'pager-gap' })); addBtn(pages, pages - 1, false); }
  if (datiPage < pages - 1) addBtn('→', datiPage + 1, false);
}
