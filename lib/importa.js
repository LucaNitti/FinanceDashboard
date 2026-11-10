/* FinFlow — Import degli estratti della banca (CSV del conto e della carta) nella scheda "dati".
   Tutto puro, senza accessi a Google: server.js legge la scheda, chiama confronta() per
   l'anteprima e operazioniScrittura() per sapere cosa scrivere dopo la conferma. */
const { parseAmount, parseDataPrevista, chiaveMovimento, dateNum, isCardValue } = require('./valori');

/** Colonne della scheda dati in un foglio nuovo (le stesse create dalla migrazione). */
const INTESTAZIONE_DATI = ['Codice', 'Data', 'Operazione', 'Importo', 'Categoria', 'Sottocategoria', 'Carta'];

/** CSV con campi tra virgolette (anche con a capo e "" all'interno); separatore , o ; scelto dalla prima riga. */
function parseCsv(testo) {
  const s = String(testo || '').replace(/^﻿/, '');
  const primaRiga = s.slice(0, s.search(/\r?\n|$/));
  const sep = (primaRiga.match(/;/g) || []).length > (primaRiga.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], campo = '', virgolette = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (virgolette) {
      if (c === '"' && s[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') virgolette = false;
      else campo += c;
    } else if (c === '"') virgolette = true;
    else if (c === sep) { row.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(campo); rows.push(row); row = []; campo = '';
    } else campo += c;
  }
  if (campo || row.length) { row.push(campo); rows.push(row); }
  return rows;
}

const norm = v => String(v == null ? '' : v).trim().toLowerCase();

/** Formato dall'intestazione: "conto" (lista movimenti del conto) o "carta" (lista movimenti della carta). */
function riconosciFormato(intestazione) {
  const h = intestazione.map(norm);
  if (h.includes('codice identificativo') && h.includes('data operazione') && h.includes('importo')) return 'conto';
  if (h.includes('data operazione') && h.includes('riferimento') && h.includes('importo in euro')) return 'carta';
  return null;
}

/** Data come GG/MM/AAAA (il formato della scheda dati), da GG/MM/AAAA o AAAA-MM-GG. */
function dataGMA(raw) {
  const d = parseDataPrevista(raw);
  if (!d || !d.giorno) return null;
  return `${String(d.giorno).padStart(2, '0')}/${String(d.mese + 1).padStart(2, '0')}/${d.anno}`;
}

/**
 * Addebito sul conto del totale della carta di credito ("VISA CLASSIC SETTEMBRE", sottocategoria
 * della banca "Carta di credito"): le singole spese arrivano già dall'estratto della carta, quindi
 * contarlo anche qui le raddoppierebbe. Il canone della carta ha un'altra sottocategoria.
 */
function isAddebitoCarta(m) {
  return m.amount < 0 && (norm(m.sub) === 'carta di credito' || /^visa classic/i.test(m.op));
}

/**
 * Legge un estratto della banca. Movimenti: { codice, provvisorio, date, op, amount, cat, sub, carta }.
 * Provvisorio = non ancora contabilizzato: sul conto "Data valuta" è "-" e il codice cambierà;
 * sulla carta il riferimento è "N.D." (codice vuoto). La riga "Saldo al …" del conto dà `saldo`.
 * `addebitoCarta`: addebito mensile della carta di credito sul conto (vedi isAddebitoCarta).
 */
function leggiEstratto(testo, nome = '') {
  const rows = parseCsv(testo);
  const iHead = rows.findIndex(r => riconosciFormato(r));
  if (iHead < 0) return { nome, formato: null, movimenti: [], saldo: null, scartate: [] };
  const formato = riconosciFormato(rows[iHead]);
  const h = rows[iHead].map(norm);
  const col = n => h.indexOf(n);
  const c = formato === 'conto'
    ? { codice: col('codice identificativo'), data: col('data operazione'), valuta: col('data valuta'), descr: col('descrizione'),
        importo: col('importo'), cat: col('categoria'), sub: col('sottocategoria') }
    : { codice: col('riferimento'), data: col('data operazione'), descr: col('descrizione'), importo: col('importo in euro') };
  const movimenti = [], scartate = [];
  let saldo = null;
  for (let i = iHead + 1; i < rows.length; i++) {
    const r = rows[i].map(v => String(v == null ? '' : v).trim());
    if (r.every(v => !v)) continue;
    const iSaldo = r.findIndex(v => /^saldo al\b/i.test(v));
    if (iSaldo >= 0) {
      const m = r[iSaldo].match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      saldo = { data: m ? dataGMA(m[1]) : null, importo: parseAmount(r[iSaldo + 1]) };
      continue;
    }
    if (r.some(v => /^totale speso\b/i.test(v))) continue;
    const date = dataGMA(r[c.data]);
    const amount = parseAmount(r[c.importo]);
    if (!date || isNaN(amount)) { scartate.push({ riga: i + 1, testo: r.filter(Boolean).join(' · ') }); continue; }
    const codice = r[c.codice] || '';
    const provvisorio = formato === 'conto' ? (!r[c.valuta] || r[c.valuta] === '-') : (!codice || /^n\.?\s*d\.?$/i.test(codice));
    const m = {
      codice: formato === 'carta' && provvisorio ? '' : codice, provvisorio, date, op: r[c.descr] || '', amount,
      cat: formato === 'conto' && r[c.cat] !== '-' ? r[c.cat] || '' : '', sub: formato === 'conto' && r[c.sub] !== '-' ? r[c.sub] || '' : '',
      carta: formato === 'carta',
    };
    if (formato === 'conto' && isAddebitoCarta(m)) m.addebitoCarta = true;
    movimenti.push(m);
  }
  return { nome, formato, movimenti, saldo, scartate };
}

/**
 * Scheda dati letta da Google: posizione delle colonne (dall'intestazione) e righe con il
 * loro numero nel foglio. `vuota` = nemmeno l'intestazione (foglio appena creato).
 */
function leggiFoglioDati(rows) {
  const h = (rows[0] || []).map(norm);
  if (!h.some(Boolean)) {
    const colonne = Object.fromEntries(INTESTAZIONE_DATI.map((n, i) => [n.toLowerCase(), i]));
    return { vuota: true, colonne: { ...colonne, n: INTESTAZIONE_DATI.length }, righe: [] };
  }
  const trova = re => h.findIndex(x => re.test(x));
  const colonne = {
    codice: trova(/^codice/), data: h.indexOf('data'), operazione: trova(/^(operazione|descrizione)$/), importo: trova(/^importo/),
    categoria: h.indexOf('categoria'), sottocategoria: h.indexOf('sottocategoria'), carta: trova(/carta|metodo|pagamento/), n: h.length,
  };
  const righe = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const v = k => (colonne[k] >= 0 ? String(r[colonne[k]] == null ? '' : r[colonne[k]]).trim() : '');
    const amount = parseAmount(v('importo'));
    if (!parseDataPrevista(v('data')) || isNaN(amount)) continue;
    righe.push({ riga: i + 1, codice: v('codice'), date: v('data'), op: v('operazione'), amount,
      cat: v('categoria'), sub: v('sottocategoria'), carta: isCardValue(v('carta')) });
  }
  return { vuota: false, colonne, righe };
}

/** Codice definitivo della banca (conto: 14 cifre, carta: 13); provvisori, "TMP…", "OLD_TMP_…", "N.D." no. */
const definitivo = c => /^\d{11,}$/.test(String(c || ''));
const giorno = s => { const d = parseDataPrevista(s); return d ? Date.UTC(d.anno, d.mese, d.giorno || 1) / 864e5 : NaN; };
const centesimi = a => Math.round(a * 100);

/** Stessa descrizione a meno di numeri e spazi, o almeno le prime due parole uguali. */
function descrizioneSimile(a, b) {
  const ka = chiaveMovimento(a), kb = chiaveMovimento(b);
  if (!ka || !kb) return norm(a).replace(/\s+/g, ' ') === norm(b).replace(/\s+/g, ' ');
  return ka === kb || ka.split(' ').slice(0, 2).join(' ') === kb.split(' ').slice(0, 2).join(' ');
}

/** Giorni di distanza ammessi tra un movimento provvisorio e la sua versione contabilizzata. */
const GIORNI_TOLLERANZA = 5;

/**
 * Confronta gli estratti con la scheda dati. Ogni movimento diventa:
 * - "presente": stesso codice già nel foglio, oppure stesso movimento (importo, data vicina,
 *   descrizione simile) con un codice provvisorio da una delle due parti;
 * - "aggiorna": nel foglio c'è la versione provvisoria (o con codice TMP/OLD_TMP) e l'estratto
 *   porta il codice definitivo → si scrive il nuovo codice su quella riga;
 * - "addebitoCarta": addebito mensile della carta sul conto, non ancora nel foglio → saltato;
 * - "nuovo": da aggiungere, con la categoria usata l'ultima volta per la stessa descrizione
 *   (fonte "storico"), altrimenti quella della banca (fonte "banca").
 * Ogni riga del foglio corrisponde al più a un movimento. Due codici definitivi diversi
 * sono sempre due movimenti diversi (es. due caffè uguali lo stesso giorno).
 */
function confronta(estratti, foglio) {
  const perCodice = new Map();
  foglio.righe.forEach(r => { if (r.codice) perCodice.set(r.codice, r); });
  const usate = new Set();
  // Categoria usata più di recente per la stessa descrizione; in mancanza, per le stesse prime
  // due parole (le descrizioni della banca cambiano coda ogni mese: "FIBRA DEMO SpA ADDEBITO … SDD 83…")
  const storico = new Map(), storicoInizio = new Map();
  const inizio = k => { const w = k.split(' '); return w.length >= 2 ? w.slice(0, 2).join(' ') : null; };
  const ricorda = (map, k, r) => {
    const s = map.get(k);
    if (!s || dateNum(r.date) >= s.dn) map.set(k, { cat: r.cat, sub: r.sub, dn: dateNum(r.date) });
  };
  foglio.righe.forEach(r => {
    const k = chiaveMovimento(r.op);
    if (!k || !r.cat) return;
    ricorda(storico, k, r);
    if (inizio(k)) ricorda(storicoInizio, inizio(k), r);
  });
  const categoriaStorica = op => { const k = chiaveMovimento(op); return storico.get(k) || (inizio(k) && storicoInizio.get(inizio(k))); };
  const codiciUsati = new Set(perCodice.keys());
  const nuovoCodice = m => {
    const base = `ND-${m.date.split('/').reverse().join('')}-${Math.abs(centesimi(m.amount))}`;
    let c = base;
    for (let n = 2; codiciUsati.has(c); n++) c = `${base}-${n}`;
    codiciUsati.add(c);
    return c;
  };

  const righe = [];
  estratti.forEach((e, fi) => e.movimenti.forEach((m, mi) => {
    const base = { id: `${fi}:${mi}`, file: e.nome, formato: e.formato, date: m.date, op: m.op, amount: m.amount,
      codice: m.codice, provvisorio: m.provvisorio, carta: m.carta };
    const stesso = m.codice && perCodice.get(m.codice);
    if (stesso) {
      usate.add(stesso.riga);
      righe.push({ ...base, stato: 'presente', riga: stesso.riga, cat: stesso.cat, sub: stesso.sub });
      return;
    }
    const candidati = foglio.righe.filter(r => !usate.has(r.riga)
      && !(definitivo(r.codice) && definitivo(m.codice))
      && centesimi(r.amount) === centesimi(m.amount)
      && Math.abs(giorno(r.date) - giorno(m.date)) <= GIORNI_TOLLERANZA
      && descrizioneSimile(r.op, m.op))
      .sort((a, b) => Math.abs(giorno(a.date) - giorno(m.date)) - Math.abs(giorno(b.date) - giorno(m.date)));
    const r = candidati[0];
    if (r) {
      usate.add(r.riga);
      const aggiorna = definitivo(m.codice) && !definitivo(r.codice);
      righe.push({ ...base, stato: aggiorna ? 'aggiorna' : 'presente', riga: r.riga, codiceVecchio: r.codice,
        cat: r.cat, sub: r.sub, segnaCarta: aggiorna && m.carta && !r.carta });
      return;
    }
    if (m.addebitoCarta) {
      righe.push({ ...base, stato: 'addebitoCarta', cat: m.cat, sub: m.sub });
      return;
    }
    const s = categoriaStorica(m.op);
    const cat = s ? s.cat : m.cat, sub = s ? s.sub : m.sub;
    righe.push({ ...base, stato: 'nuovo', codice: m.codice || nuovoCodice(m), cat, sub,
      fonte: s ? 'storico' : m.cat ? 'banca' : null });
  }));
  const conta = st => righe.filter(r => r.stato === st).length;
  return {
    righe,
    riepilogo: { nuovi: conta('nuovo'), aggiorna: conta('aggiorna'), presenti: conta('presente'), addebitiCarta: conta('addebitoCarta') },
    file: estratti.map(e => ({ nome: e.nome, formato: e.formato, movimenti: e.movimenti.length, scartate: e.scartate, saldo: e.saldo })),
  };
}

/** Testo per USER_ENTERED: un inizio come = + - @ verrebbe letto come formula. */
const testo = s => (/^[=+\-@]/.test(String(s)) ? `'${s}` : String(s == null ? '' : s));

/**
 * Cosa scrivere per le righe "nuovo" e "aggiorna" (salvo quelle escluse in `modifiche`, dove
 * si possono anche cambiare categoria e sottocategoria: { id: { cat, sub, escludi } }).
 * Ritorna { intestazione, update: [{ range, values }], append: [[...]] } per la scheda dati.
 * Codici con l'apostrofo (testo, niente notazione scientifica); date in ISO, che Google
 * riconosce in qualunque impostazione della lingua del foglio.
 */
function operazioniScrittura(confronto, foglio, modifiche = {}, colonna) {
  const col = { ...foglio.colonne };
  if (col.codice < 0 || col.data < 0 || col.operazione !== col.data + 1 || col.importo !== col.data + 2
    || col.categoria !== col.data + 3 || col.sottocategoria !== col.data + 4) {
    throw new Error('La scheda dati deve avere le colonne Codice e poi Data, Operazione, Importo, Categoria, Sottocategoria in quest\'ordine');
  }
  const update = [];
  const intestazione = foglio.vuota ? [...INTESTAZIONE_DATI] : null;
  const scelte = confronto.righe.filter(r => (r.stato === 'nuovo' || r.stato === 'aggiorna') && !(modifiche[r.id] && modifiche[r.id].escludi));
  if (col.carta < 0 && scelte.some(r => r.carta)) {
    col.carta = col.n;
    update.push({ range: `dati!${colonna(col.carta)}1`, values: [['Carta']] });
  }
  const iso = d => d.split('/').reverse().join('-');
  const append = [];
  scelte.forEach(r => {
    if (r.stato === 'aggiorna') {
      update.push({ range: `dati!${colonna(col.codice)}${r.riga}`, values: [[`'${r.codice}`]] });
      if (r.segnaCarta) update.push({ range: `dati!${colonna(col.carta)}${r.riga}`, values: [['sì']] });
      return;
    }
    const m = modifiche[r.id] || {};
    const riga = Array(Math.max(col.n, col.carta + 1)).fill('');
    riga[col.codice] = `'${r.codice}`;
    riga[col.data] = iso(r.date);
    riga[col.operazione] = testo(r.op);
    riga[col.importo] = r.amount;
    riga[col.categoria] = testo(m.cat !== undefined ? m.cat : r.cat);
    riga[col.sottocategoria] = testo(m.sub !== undefined ? m.sub : r.sub);
    if (col.carta >= 0) riga[col.carta] = r.carta ? 'sì' : '';
    append.push(riga);
  });
  return { intestazione, update, append };
}

module.exports = { INTESTAZIONE_DATI, parseCsv, riconosciFormato, isAddebitoCarta, leggiEstratto, leggiFoglioDati, confronta, operazioniScrittura, definitivo, testo, centesimi };
