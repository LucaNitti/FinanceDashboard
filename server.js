const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sheetsClient, colonna, formatiDati } = require('./lib/google');
const { leggiEstratto, leggiFoglioDati, confronta, operazioniScrittura, testo, centesimi } = require('./lib/importa');
const { MESI_IT, parseAmount, isCardValue, parseDataPrevista, chiaveMovimento, dateNum } = require('./lib/valori');

const CONFIG_PATH = path.join(__dirname, 'config.json');
/** Credenziali Google (apiKey + ID dei fogli): file separato, mai committato. Override con SECRETS_PATH. */
const SECRETS_PATH = process.env.SECRETS_PATH || path.join(__dirname, 'secrets.json');
/** Cache dei dati scaricati. Override con CACHE_PATH (in Docker sta su un volume, così sopravvive ai rebuild). */
const CACHE_PATH = process.env.CACHE_PATH || path.join(__dirname, 'cache.json');
const PUBLIC_PATH = path.join(__dirname, 'public');

/** Es. /finflow — stesso path usato in Nginx location. Vuoto = radice del sito. */
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const INDEX_INJECT_MARK = '%%FINFLOW_BASE_INJECT%%';

function stripBasePath(pathnameRaw) {
  if (!BASE_PATH) return pathnameRaw;
  if (pathnameRaw === BASE_PATH || pathnameRaw.startsWith(BASE_PATH + '/')) {
    if (pathnameRaw === BASE_PATH) return '/';
    const rest = pathnameRaw.slice(BASE_PATH.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }

  // Fallback: consente richieste senza prefisso (/api/data, /app.js, /style.css)
  // utile quando il reverse proxy inoltra senza BASE_PATH.
  if (
    pathnameRaw === '/' ||
    pathnameRaw === '/index.html' ||
    pathnameRaw.startsWith('/api/') ||
    /\.(js|css|json|webmanifest|png|jpg|jpeg|gif|svg|ico|webp|map|woff2)$/i.test(pathnameRaw)
  ) {
    return pathnameRaw;
  }

  return null;
}

/**
 * Versione mostrata sotto il titolo: numero da package.json + commit e sua data. In Docker
 * non c'è .git: commit e data arrivano come FINFLOW_COMMIT / FINFLOW_COMMIT_DATA, passati
 * al build da tools/auto-update.sh; fuori da Docker si chiedono a git (se c'è).
 */
const VERSIONE = (() => {
  const v = { numero: '', commit: process.env.FINFLOW_COMMIT || '', data: process.env.FINFLOW_COMMIT_DATA || '' };
  try { v.numero = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || ''; } catch(e) {}
  if (!v.commit) {
    try {
      const out = require('child_process').execFileSync('git', ['log', '-1', '--format=%h %cs'],
        { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
      [v.commit, v.data] = out.split(' ');
    } catch(e) {}
  }
  return v;
})();

function getIndexHtml() {
  const raw = fs.readFileSync(path.join(PUBLIC_PATH, 'index.html'), 'utf8');
  const inject = (BASE_PATH
    ? `<base href="${BASE_PATH}/">\n<script>window.__FINFLOW_BASE__=${JSON.stringify(BASE_PATH)};</script>\n`
    : '') + `<script>window.__FINFLOW_VERSIONE__=${JSON.stringify(VERSIONE).replace(/</g, '\\u003c')};</script>\n`;
  return raw.replace(INDEX_INJECT_MARK, inject);
}

/**
 * Chiavi che danno accesso ai fogli Google: vivono in secrets.json, non in config.json.
 * Due configurazioni: foglio unico (sheetId + serviceAccount, che permette anche di
 * scrivere) oppure un foglio per anno (apiKey + sheetMap, solo lettura).
 */
const SECRET_KEYS = ['apiKey', 'sheetMap', 'bolletteSheetId', 'saldoSheetId', 'sheetId', 'serviceAccount', 'importPassword'];

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e) { console.error(`${label} non trovato o non valido:`, e.message); return null; }
}

/**
 * Unisce config.json (impostazioni generiche) e secrets.json (credenziali Google).
 * Le chiavi sensibili vengono lette SOLO da secrets.json: se qualcuno le lascia
 * in config.json vengono ignorate con un avviso, così non finiscono nel repo.
 */
function loadConfig() {
  const config = readJson(CONFIG_PATH, 'config.json');
  const secrets = readJson(SECRETS_PATH, 'secrets.json');
  if (!config || !secrets) return null;
  const leaked = SECRET_KEYS.filter(k => k in config);
  if (leaked.length) console.warn(`ATTENZIONE: ${leaked.join(', ')} in config.json vengono ignorate: spostale in secrets.json`);
  const merged = { ...config };
  SECRET_KEYS.forEach(k => { delete merged[k]; if (k in secrets) merged[k] = secrets[k]; });
  if (merged.sheetId) {
    if (!merged.serviceAccount && !merged.apiKey) { console.error('secrets.json incompleto: con sheetId serve serviceAccount (o apiKey per la sola lettura)'); return null; }
  } else if (!merged.apiKey || !merged.sheetMap || !Object.keys(merged.sheetMap).length) {
    console.error('secrets.json incompleto: servono sheetId e serviceAccount, oppure apiKey e sheetMap'); return null;
  }
  // Non enumerabile: resta fuori da log e copie dell'oggetto
  Object.defineProperty(merged, 'google', { value: sheetsClient({ apiKey: merged.apiKey, serviceAccount: merged.serviceAccount }) });
  return merged;
}

/** Import dei CSV possibile: foglio unico, account di servizio e password impostati. */
function importAbilitato(config) {
  return !!(config && config.sheetId && config.google.puoScrivere && config.importPassword);
}

/** Minuti di validità della cache: 0 = ricarica sempre da Google; assente o non valido = 60. */
function cacheTTLMinutes(config) {
  const v = Number(config && config.cacheTTLMinutes);
  return Number.isFinite(v) && v >= 0 ? v : 60;
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch(e) { return { data: null, lastUpdate: null }; }
}

/** Scrittura atomica (file temporaneo + rename): un'interruzione a metà non lascia un cache.json corrotto. */
function saveCache(data) {
  const tmp = CACHE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ data, lastUpdate: new Date().toISOString() }));
    fs.renameSync(tmp, CACHE_PATH);
  } catch(e) { console.error('Errore salvataggio cache:', e.message); }
}

/**
 * Scarica tutti i fogli in parallelo. Se un pezzo fallisce (rete, quota, permessi)
 * non lo sostituisce con dati vuoti: riusa il valore della cache precedente
 * (`prev`) e registra l'errore in `result.errors`. Se falliscono i dati di tutti
 * gli anni rilancia l'errore, così il chiamante serve la cache così com'è.
 */
async function fetchAllData(config, prev) {
  const result = { allData: {}, bollette: [], saldo: {}, previste: {}, ricorrenti: {}, consumi: [], controlli: {}, errors: [], lastUpdate: new Date().toISOString() };
  const old = prev || {};
  const g = config.google;

  // Esegue fn; in caso di errore logga, lo registra e ritorna il fallback dalla cache.
  const guard = async (label, fn, fallback) => {
    try { return await fn(); }
    catch(e) {
      console.error(`  Errore ${label}:`, e.message);
      result.errors.push(`${label}: ${e.message}`);
      return fallback;
    }
  };

  const bollette = config.bolletteSheetId ? Promise.all([
    guard('bollette', async () => parseBollette(await g.get(config.bolletteSheetId, config.bolletteSheetName || 'bollette')), old.bollette || []),
    guard('consumi', async () => parseConsumi(await g.getOptional(config.bolletteSheetId, 'Consumi')), old.consumi || []),
  ]) : Promise.resolve([[], []]);

  const [datiOk, [boll, consumi]] = await Promise.all([
    config.sheetId ? fetchFoglioUnico(config, old, result, guard) : fetchFogliAnnuali(config, old, result, guard),
    bollette,
  ]);
  if (!datiOk) throw Object.assign(new Error(result.errors.join('; ')), { errors: result.errors });
  result.bollette = boll;
  result.consumi = consumi;

  generaPrevisteRicorrenti(result);
  normalizeCategories(result.allData);
  return result;
}

/** Raggruppa per anno (stringa) secondo `annoDi(x)`; gli elementi senza anno sono scartati. */
function perAnno(list, annoDi) {
  const out = {};
  list.forEach(x => { const a = annoDi(x); if (a) (out[a] = out[a] || []).push(x); });
  return out;
}
const annoData = s => { const d = parseDataPrevista(s); return d ? String(d.anno) : null; };

/**
 * Foglio unico (config.sheetId): tutti gli anni nelle stesse schede (dati, Saldo mensile,
 * Previste, Ricorrenti); l'anno di ogni riga viene dalla sua data. Ritorna false se la
 * scheda dati non è stata letta. Ricorrenti vale per l'anno in corso.
 */
async function fetchFoglioUnico(config, old, result, guard) {
  const g = config.google, id = config.sheetId;
  const annoCorrente = String(new Date().getFullYear());
  const controlli = {};
  const [dati, saldo, previste, ricorrenti] = await Promise.all([
    guard('dati', async () => parseFinanziari(await g.get(id, 'dati'), controlli), null),
    guard('saldo', async () => perAnno(parseSaldo(await g.getOptional(id, 'Saldo mensile')), s => annoData(s.mese)), old.saldo || {}),
    guard('previste', async () => perAnno(parsePreviste(await g.getOptional(id, 'Previste')), p => String(p.anno)),
      Object.fromEntries(Object.entries(old.previste || {}).map(([y, l]) => [y, l.filter(p => !p.ricorrente)]))),
    guard('ricorrenti', async () => parseRicorrenti(await g.getOptional(id, 'Ricorrenti')), (old.ricorrenti || {})[annoCorrente] || []),
  ]);
  if (dati === null) return false;
  result.allData = perAnno(dati, r => annoData(r.date));
  result.saldo = saldo;
  result.previste = previste;
  result.ricorrenti = { [annoCorrente]: ricorrenti };
  // Problemi del foglio divisi per anno; quelli senza una data valida vanno all'anno più recente
  const anni = Object.keys(result.allData).sort();
  const ultimo = anni[anni.length - 1] || annoCorrente;
  const vuoto = () => ({ scartate: [], senzaCategoria: [], doppioni: [], dateAnomale: [] });
  [...anni, ultimo].forEach(y => { result.controlli[y] = result.controlli[y] || vuoto(); });
  ['scartate', 'senzaCategoria', 'doppioni', 'dateAnomale'].forEach(k => (controlli[k] || []).forEach(x => {
    const y = (x.date && annoData(x.date)) || ultimo;
    (result.controlli[y] = result.controlli[y] || vuoto())[k].push(x);
  }));
  return true;
}

/** Un foglio per anno (config.sheetMap), lettura con apiKey. Ritorna false se non è stato letto nessun anno. */
async function fetchFogliAnnuali(config, old, result, guard) {
  const g = config.google;
  const annoCorrente = String(new Date().getFullYear());
  const oldYear = (key, yr) => (old[key] && old[key][yr]) || [];

  const years = Object.entries(config.sheetMap).map(async ([yr, sheetId]) => {
    const controlli = { anno: yr };
    const [dati, saldo, previste, ricorrenti] = await Promise.all([
      guard(`dati ${yr}`, async () => parseFinanziari(await g.get(sheetId, 'dati'), controlli), null),
      guard(`saldo ${yr}`, async () => {
        // Ogni foglio annuale ha la propria scheda "Saldo mensile" con i dati di
        // quell'anno: carichiamo il saldo dal foglio dell'anno. config.saldoSheetId
        // resta solo come fallback se l'anno non ha la propria scheda.
        let parsed = parseSaldo(await g.getOptional(sheetId, 'Saldo mensile'));
        if (!parsed.length && config.saldoSheetId && config.saldoSheetId !== sheetId) {
          parsed = parseSaldo(await g.getOptional(config.saldoSheetId, 'Saldo mensile'));
        }
        return parsed;
      }, oldYear('saldo', yr)),
      // Scheda "Previste" (opzionale): spese future già note ma non ancora in banca.
      // Si conservano solo le righe manuali: le ricorrenti vengono rigenerate sotto.
      guard(`previste ${yr}`, async () => parsePreviste(await g.getOptional(sheetId, 'Previste')),
        oldYear('previste', yr).filter(p => !p.ricorrente)),
      // Scheda "Ricorrenti" (opzionale, solo anno corrente): spese fisse mensili
      // (affitto, utenze, rate...) da generare automaticamente come previste.
      yr === annoCorrente
        ? guard(`ricorrenti ${yr}`, async () => parseRicorrenti(await g.getOptional(sheetId, 'Ricorrenti')), oldYear('ricorrenti', yr))
        : null,
    ]);
    const datiFailed = dati === null;
    result.allData[yr] = datiFailed ? oldYear('allData', yr) : dati;
    const oldControlli = old.controlli && old.controlli[yr];
    if (!datiFailed) result.controlli[yr] = controlli;
    else if (oldControlli) result.controlli[yr] = oldControlli;
    result.saldo[yr] = saldo;
    result.previste[yr] = previste;
    if (ricorrenti) result.ricorrenti[yr] = ricorrenti;
    return datiFailed;
  });
  return !(await Promise.all(years)).every(Boolean);
}

/**
 * Un solo download da Google alla volta: le richieste contemporanee (più
 * dispositivi, /api/data + /api/refresh) aspettano lo stesso risultato.
 * Salva in cache solo se tutto è andato a buon fine, così un errore parziale
 * non rinfresca lastUpdate e al giro successivo si riprova.
 */
let inflight = null;
/**
 * Dopo un download fallito (anche in parte) la cache non viene aggiornata: senza una
 * pausa ogni apertura della pagina riproverebbe subito, e durante un blocco per quota
 * di Google (60 letture/minuto) lo prolungherebbe. Per RETRY_AFTER_FAIL_MS /api/data
 * serve la cache; /api/refresh (pulsante Aggiorna) riprova comunque.
 */
const RETRY_AFTER_FAIL_MS = 60 * 1000;
let lastFail = null; // { at, errors }
function refreshData(config) {
  if (inflight) return inflight;
  inflight = (async () => {
    const cache = loadCache();
    const t0 = Date.now();
    let data;
    try { data = await fetchAllData(config, cache.data); }
    catch (e) { lastFail = { at: Date.now(), errors: e.errors || [e.message] }; throw e; }
    console.log(`[fetch] Completato in ${((Date.now() - t0) / 1000).toFixed(1)}s${data.errors.length ? ` con ${data.errors.length} errori` : ''}.`);
    if (data.errors.length) lastFail = { at: Date.now(), errors: data.errors };
    else { lastFail = null; saveCache(data); }
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}

/**
 * Unifica categorie e sottocategorie che differiscono solo per maiuscole/minuscole
 * o spazi ("Regali e Donazioni" / "Regali e donazioni"): per ogni chiave normalizzata
 * vince la grafia più usata su tutti gli anni, così i totali non si spezzano.
 */
function normalizeCategories(allData) {
  const canon = field => {
    const counts = {};
    Object.values(allData).forEach(rows => rows.forEach(r => {
      const v = r[field]; if (!v) return;
      const k = v.toLowerCase().replace(/\s+/g, ' ');
      (counts[k] = counts[k] || {})[v] = (counts[k][v] || 0) + 1;
    }));
    const best = {};
    Object.entries(counts).forEach(([k, variants]) => {
      best[k] = Object.entries(variants).sort((a, b) => b[1] - a[1])[0][0];
    });
    Object.values(allData).forEach(rows => rows.forEach(r => {
      if (r[field]) r[field] = best[r[field].toLowerCase().replace(/\s+/g, ' ')];
    }));
  };
  canon('cat'); canon('sub');
}



/**
 * `controlli` (facoltativo) raccoglie i problemi del foglio, con il numero di riga:
 * righe scartate (senza data o importo leggibile), movimenti senza categoria (contati
 * in "Altro"), possibili doppioni (stessa data, importo e descrizione, senza due codici
 * univoci diversi) e date non leggibili o di un altro anno (`controlli.anno`).
 */
function parseFinanziari(rows, controlli = null) {
  const data = [];
  // Le colonne Data/Operazione/Importo/Categoria/Sottocategoria sono sempre in
  // quest'ordine, ma possono essere precedute da altre (es. il codice univoco
  // aggiunto nel 2026): individuo "Data" nell'intestazione e parto da lì.
  const header = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
  const start = Math.max(0, header.indexOf('data'));
  // Colonna "Carta" (o "Metodo"/"Pagamento"): può stare ovunque, la cerco per nome.
  const cardCol = header.findIndex(h => /carta|metodo|pagamento/.test(h));
  // Se c'è il codice univoco (colonna prima di "Data"), le righe con lo stesso
  // codice sono doppioni: tengo solo la prima occorrenza.
  const seen = new Set();
  let dup = 0, card = 0;
  const c = controlli ? Object.assign(controlli, { scartate: [], senzaCategoria: [], doppioni: [], dateAnomale: [] }) : null;
  const simili = new Map(); // data|importo|descrizione → { riga, id } della prima occorrenza
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const riga = i + 1; // numero di riga nel foglio (la 1 è l'intestazione)
    // Righe vuote (anche con il solo codice univoco, es. formula trascinata in basso): ignorate
    const vuota = !row || row.slice(start).every(v => !String(v == null ? '' : v).trim());
    if (vuota) continue;
    const [date, op, amt, cat, sub] = row.slice(start);
    const amount = parseAmount(amt);
    if (!date || isNaN(amount)) {
      if (c) {
        const motivo = !date ? 'data mancante'
          : amt === undefined || !String(amt).trim() ? 'importo mancante' : `importo non leggibile «${String(amt).trim()}»`;
        c.scartate.push({ riga, motivo, testo: row.slice(start, start + 3).map(v => String(v == null ? '' : v).trim()).filter(Boolean).join(' · ') });
      }
      continue;
    }
    const id = start > 0 && row[0] ? String(row[0]).trim() : '';
    if (id) {
      if (seen.has(id)) { dup++; continue; }
      seen.add(id);
    }
    // riga = numero di riga nel foglio: serve alle modifiche dal portale (POST /api/modifica)
    const rec = { date: String(date).trim(), op: (op||'').trim(), amount, cat: (cat||'Altro').trim(), sub: (sub||'').trim(), riga };
    if (id) rec.id = id;
    if (cardCol >= 0 && amount < 0 && isCardValue(row[cardCol])) { rec.card = true; card++; }
    data.push(rec);

    if (!c) continue;
    const info = { riga, date: rec.date, op: rec.op, amount };
    if (!String(cat || '').trim()) c.senzaCategoria.push(info);
    const d = parseDataPrevista(rec.date);
    if (!d) c.dateAnomale.push({ ...info, motivo: 'data non leggibile' });
    else if (c.anno && d.anno !== Number(c.anno)) c.dateAnomale.push({ ...info, motivo: `data del ${d.anno}` });
    // Due movimenti uguali con codici univoci diversi sono veri (es. due caffè): non li segnalo
    const k = `${rec.date}|${amount}|${rec.op.toLowerCase().replace(/\s+/g, ' ')}`;
    const prima = simili.get(k);
    if (!prima) simili.set(k, { riga, id });
    else if (!(prima.id && id && prima.id !== id)) c.doppioni.push({ ...info, rigaPrima: prima.riga });
  }
  if (dup) console.log(`  ${dup} doppioni scartati (stesso codice)`);
  if (card) console.log(`  ${card} movimenti con carta`);
  return data;
}

function parseSaldo(rows) {
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const mese = (row[0]||'').trim();
    const saldo = parseAmount(row[1]);
    if (!mese || isNaN(saldo)) continue;
    data.push({ mese, saldo });
  }
  return data;
}


/** Colonne: Data prevista | Descrizione | Importo | Categoria | Sottocategoria. L'importo è sempre una spesa (segno ignorato). */
function parsePreviste(rows) {
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;
    const [dataRaw, descr, imp, cat, sub] = row;
    const d = parseDataPrevista(dataRaw);
    const importo = Math.abs(parseAmount(imp));
    if (!d || isNaN(importo) || !importo) continue;
    data.push({ ...d, descr: (descr || '').trim(), importo, cat: (cat || '').trim(), sub: (sub || '').trim(), riga: i + 1 });
  }
  return data;
}

/**
 * Colonne: Descrizione | Importo | Categoria | Sottocategoria | Corrispondenza | Tipo.
 * "Corrispondenza" è il testo da cercare (case-insensitive) nella colonna
 * Operazione di "Dati" per riconoscere il movimento reale una volta registrato;
 * se vuota si usa la Descrizione. "Tipo" = "Entrata" per le entrate fisse (stipendio,
 * affitto incassato...): vuoto o altro = spesa. Il segno dell'importo è ignorato.
 */
function parseRicorrenti(rows) {
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const [descr, imp, cat, sub, match, tipo] = row;
    const d = (descr || '').trim();
    const importo = Math.abs(parseAmount(imp));
    if (!d || isNaN(importo) || !importo) continue;
    const rec = { descr: d, importo, cat: (cat || '').trim(), sub: (sub || '').trim(), match: (match || d).trim().toLowerCase() };
    if (isEntrata(tipo)) rec.entrata = true;
    data.push(rec);
  }
  return data;
}

/**
 * La descrizione del movimento contiene il testo di Corrispondenza? Senza maiuscole, spazi e
 * punteggiatura: "Alfa srl" riconosce "ALFA S.R.L.", "banca demo" "BANCA DEMO S P A".
 */
const soloLettere = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const contieneTesto = (op, match) => soloLettere(op).includes(soloLettere(match));

/** Colonna Tipo di Ricorrenti: "Entrata", "entrate", "E"... */
const isEntrata = v => /^\s*e(ntrat[ae])?\s*$/i.test(String(v || ''));

/**
 * Genera le voci "previste" per le spese e le entrate ricorrenti (scheda "Ricorrenti"), da
 * questo mese a dicembre dell'anno corrente. Salta un mese se l'addebito reale
 * è già in "Dati" (match sul testo nella colonna Operazione) o se esiste già
 * una riga manuale in "Previste" con la stessa descrizione per quel mese —
 * così l'utente non deve mai cancellarle a mano. `now` è parametro solo per i test.
 */
function generaPrevisteRicorrenti(result, now = new Date()) {
  const anno = now.getFullYear();
  const yr = String(anno);
  const ricorrenti = result.ricorrenti && result.ricorrenti[yr];
  if (!ricorrenti || !ricorrenti.length) return;

  const dati = result.allData[yr] || [];
  const manuali = result.previste[yr] || [];
  const meseCorrente = now.getMonth();
  const generate = [];

  // Se più regole condividono lo stesso testo di corrispondenza (es. due addebiti
  // dello stesso fornitore), il solo testo non basta a capire quale movimento reale
  // soddisfa quale regola: in quel caso serve anche l'importo (con tolleranza).
  // Con un testo univoco per regola, basta la presenza del movimento nel mese.
  const matchCounts = {};
  ricorrenti.forEach(r => { const k = `${!!r.entrata}|${r.match}`; matchCounts[k] = (matchCounts[k] || 0) + 1; });

  for (const rule of ricorrenti) {
    const richiedeImporto = matchCounts[`${!!rule.entrata}|${rule.match}`] > 1;
    const tolleranza = Math.max(5, rule.importo * 0.5);

    for (let mese = meseCorrente; mese <= 11; mese++) {
      const candidati = dati.filter(r => {
        const d = parseDataPrevista(r.date);
        // Un'entrata fissa si riconosce solo da un accredito, una spesa solo da un addebito
        return d && d.anno === anno && d.mese === mese && (rule.entrata ? r.amount > 0 : r.amount < 0) && contieneTesto(r.op, rule.match);
      });
      const giaRegistrata = richiedeImporto
        ? candidati.some(r => Math.abs(Math.abs(r.amount) - rule.importo) <= tolleranza)
        : candidati.length > 0;
      if (giaRegistrata) continue;

      const giaManuale = !rule.entrata && manuali.some(p => p.mese === mese && p.anno === anno && p.descr.toLowerCase() === rule.descr.toLowerCase());
      if (giaManuale) continue;

      const p = { giorno: null, mese, anno, descr: rule.descr, importo: rule.importo, cat: rule.cat, sub: rule.sub, ricorrente: true };
      if (rule.entrata) p.entrata = true;
      generate.push(p);
    }
  }

  result.previste[yr] = manuali.concat(generate);
}

/**
 * Regole di "Ricorrenti" che non trovano più il movimento in "Dati" dell'anno in corso
 * (addebito per le spese, accredito per le entrate): mai trovato (la Corrispondenza non
 * compare in nessuna Operazione) oppure non trovato da più di un mese rispetto all'ultimo
 * mese con movimenti (contratto chiuso o descrizione cambiata in banca).
 * Ritorna [{ descr, match, ultimoMese (0-11 o null), entrata? }].
 */
function controllaRicorrenti(ricorrenti, dati, now = new Date()) {
  const anno = now.getFullYear();
  const movs = (dati || []).map(r => ({ d: parseDataPrevista(r.date), op: String(r.op || '').toLowerCase(), out: r.amount < 0 }))
    .filter(m => m.d && m.d.anno === anno);
  if (!movs.length) return [];
  const ultimoConDati = Math.max(...movs.map(m => m.d.mese));
  return (ricorrenti || []).map(rule => {
    const trovati = movs.filter(m => m.out === !rule.entrata && contieneTesto(m.op, rule.match)).map(m => m.d.mese);
    const ultimo = trovati.length ? Math.max(...trovati) : null;
    if (ultimo !== null && ultimo >= ultimoConDati - 1) return null;
    return { descr: rule.descr, match: rule.match, ultimoMese: ultimo, ...(rule.entrata ? { entrata: true } : {}) };
  }).filter(Boolean);
}


/**
 * Testo da usare come Corrispondenza: il tratto più lungo di parole senza cifre del
 * movimento più recente che compare (minuscolo) in tutte le descrizioni del gruppo.
 */
function corrispondenzaComune(ops) {
  const ultimo = ops[ops.length - 1];
  const lower = ops.map(o => o.toLowerCase());
  const parole = [...ultimo.matchAll(/\S+/g)];
  const lettere = p => /[a-zà-ÿ]/i.test(p[0]); // il tratto inizia e finisce con una parola, non con "-" o "*"
  let best = '';
  for (let i = 0; i < parole.length; i++) {
    if (!lettere(parole[i])) continue;
    for (let j = i; j < parole.length && !/\d/.test(parole[j][0]); j++) {
      if (!lettere(parole[j])) continue;
      const s = ultimo.slice(parole[i].index, parole[j].index + parole[j][0].length).toLowerCase();
      if (s.length > best.length && lower.every(o => o.includes(s))) best = s;
    }
  }
  return best;
}

/**
 * Possibili abbonamenti: uscite con la stessa descrizione e lo stesso importo (±1%, minimo
 * 10 centesimi) in almeno 3 mesi degli ultimi 12, presenti in almeno 3 mesi su 4 del loro
 * periodo, una o due volte al mese, ancora attive (ultimo o penultimo mese con dati) e non
 * già coperte da una regola di "Ricorrenti" o da un testo di `ignora` (config.abbonamentiIgnora).
 * Esclusi i commercianti molto frequenti (più di 6 movimenti al mese, es. supermercato).
 */
function trovaAbbonamenti(allData, ricorrenti = [], ignora = []) {
  const escludi = (ricorrenti || []).filter(r => !r.entrata).map(r => r.match).concat((ignora || []).map(s => String(s).toLowerCase())).filter(Boolean);
  const movs = [];
  Object.values(allData || {}).forEach(rows => (rows || []).forEach(r => {
    if (!(r.amount < 0)) return;
    const d = parseDataPrevista(r.date);
    const key = chiaveMovimento(r.op);
    if (d && key) movs.push({ r, idx: d.anno * 12 + d.mese, abs: Math.abs(r.amount), key, lower: r.op.toLowerCase() });
  }));
  if (!movs.length) return [];
  const ultimoIdx = Math.max(...movs.map(m => m.idx));
  const finestra = movs.filter(m => m.idx > ultimoIdx - 12 && !escludi.some(t => contieneTesto(m.lower, t)));
  const perChiave = {};
  finestra.forEach(m => (perChiave[m.key] = perChiave[m.key] || []).push(m));
  const mese = idx => `${String(idx % 12 + 1).padStart(2, '0')}/${Math.floor(idx / 12)}`;

  const trovati = [];
  for (const list of Object.values(perChiave)) {
    if (list.length / new Set(list.map(m => m.idx)).size > 6) continue;
    const gruppi = [];
    list.slice().sort((a, b) => a.abs - b.abs).forEach(m => {
      const g = gruppi[gruppi.length - 1];
      if (g && m.abs - g[0].abs <= Math.max(0.1, g[0].abs * 0.01)) g.push(m); else gruppi.push([m]);
    });
    for (const g of gruppi) {
      const perMese = {};
      g.forEach(m => { perMese[m.idx] = (perMese[m.idx] || 0) + 1; });
      const mesi = Object.keys(perMese).map(Number);
      const primo = Math.min(...mesi), ultimo = Math.max(...mesi);
      if (mesi.length < 3 || Math.max(...Object.values(perMese)) > 2) continue;
      if (mesi.length / (ultimo - primo + 1) < 0.75 || ultimo < ultimoIdx - 1) continue;
      g.sort((a, b) => a.idx - b.idx || dateNum(a.r.date) - dateNum(b.r.date));
      const importi = g.map(m => m.abs).sort((a, b) => a - b);
      const volte = Math.round(g.length / mesi.length);
      const recente = g[g.length - 1].r;
      const corr = corrispondenzaComune(g.map(m => m.r.op)) || g[0].key.split(' ')[0];
      // Descrizione proposta: le prime parole della Corrispondenza, con le maiuscole della banca
      const pos = recente.op.toLowerCase().indexOf(corr);
      const descr = (pos >= 0 ? recente.op.slice(pos, pos + corr.length) : g[0].key).split(/\s+/).slice(0, 3).join(' ');
      const inGruppo = new Set(g);
      trovati.push({
        op: recente.op, descr,
        importo: Math.round(importi[importi.length >> 1] * volte * 100) / 100,
        volte, mesi: mesi.length, da: mese(primo), ultimo: mese(ultimo),
        cat: recente.cat, sub: recente.sub, corrispondenza: corr,
        // La stessa Corrispondenza compare anche in altri pagamenti (es. PayPal): in
        // Ricorrenti la voce prevista sparirebbe con uno qualunque di quei pagamenti.
        condivisa: finestra.some(m => !inGruppo.has(m) && m.lower.includes(corr)),
      });
    }
  }
  return trovati.sort((a, b) => b.importo - a.importo);
}

/**
 * Spese annuali (assicurazione, bollo, TARI...): uscite con la stessa descrizione (chiaveMovimento)
 * da almeno `minimo` € che tornano nello stesso periodo dell'anno (±1 mese) in almeno 2 anni
 * diversi, una volta per anno, con importi simili (il più alto al massimo 1,5 volte il più basso). Le descrizioni che compaiono in più di 3 mesi dello stesso anno
 * sono spese frequenti, non annuali; le rate (TARI a luglio e dicembre) diventano voci separate.
 * Per ogni voce calcola il prossimo mese atteso; tiene solo quelle ancora attive (viste negli
 * ultimi 14 mesi), non già pagate quest'anno e non coperte da una prevista vicina (±1 mese,
 * descrizione simile o importo entro il 25%) o da una regola di Ricorrenti / `ignora`.
 * Ritorna [{ descr, op, cat, sub, mese (0-11), anno, importo, importi: [{ anno, importo }], anni, inRitardo }].
 */
function trovaAnnuali(allData, previste = {}, ricorrenti = [], ignora = [], now = new Date(), minimo = 50) {
  const escludi = (ricorrenti || []).filter(r => !r.entrata).map(r => r.match).concat((ignora || []).map(s => String(s).toLowerCase())).filter(Boolean);
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const perChiave = {};
  Object.values(allData || {}).forEach(rows => (rows || []).forEach(r => {
    if (!(r.amount < 0)) return;
    const d = parseDataPrevista(r.date);
    const key = chiaveMovimento(r.op);
    if (!d || !key || escludi.some(t => contieneTesto(r.op, t))) return;
    (perChiave[key] = perChiave[key] || []).push({ r, anno: d.anno, mese: d.mese, idx: d.anno * 12 + d.mese, abs: Math.abs(r.amount) });
  }));
  const tuttePreviste = Object.values(previste || {}).flat().filter(p => p && !p.entrata);
  const distanza = (a, b) => { const x = Math.abs(a - b) % 12; return Math.min(x, 12 - x); };

  const trovati = [];
  for (const list of Object.values(perChiave)) {
    const mesiPerAnno = {};
    list.forEach(m => (mesiPerAnno[m.anno] = mesiPerAnno[m.anno] || new Set()).add(m.mese));
    if (Object.values(mesiPerAnno).some(s => s.size > 3)) continue;
    // Gruppi per periodo dell'anno: un movimento entra nel gruppo se è a ±1 mese dal primo
    const gruppi = [];
    list.slice().sort((a, b) => a.mese - b.mese || a.idx - b.idx).forEach(m => {
      const g = gruppi.find(g => distanza(g[0].mese, m.mese) <= 1);
      if (g) g.push(m); else gruppi.push([m]);
    });
    for (const g of gruppi) {
      const anni = new Set(g.map(m => m.anno));
      if (anni.size < 2 || anni.size !== g.length) continue; // una volta per anno, in almeno due anni
      g.sort((a, b) => a.idx - b.idx);
      const ultimo = g[g.length - 1];
      if (ultimo.abs < minimo || ultimo.idx < nowIdx - 14) continue;
      // Importi troppo diversi tra un anno e l'altro: acquisti capitati nello stesso mese, non una spesa fissa
      const importiG = g.map(m => m.abs);
      if (Math.max(...importiG) > Math.min(...importiG) * 1.5) continue;
      const atteso = ultimo.idx + 12;
      if (atteso < nowIdx - 2) continue;
      const anno = Math.floor(atteso / 12), mese = atteso % 12;
      const coperta = tuttePreviste.some(p => Math.abs(p.anno * 12 + p.mese - atteso) <= 1 &&
        ((p.descr && (contieneTesto(ultimo.r.op, p.descr) || contieneTesto(p.descr, chiaveMovimento(ultimo.r.op)))) ||
         Math.abs(p.importo - ultimo.abs) <= ultimo.abs * 0.25));
      if (coperta) continue;
      trovati.push({
        descr: ultimo.r.op.split(/\s+/).filter(t => t && !/\d/.test(t)).slice(0, 4).join(' ') || ultimo.r.op,
        op: ultimo.r.op, cat: ultimo.r.cat, sub: ultimo.r.sub, mese, anno,
        importo: Math.round(ultimo.abs * 100) / 100,
        importi: g.map(m => ({ anno: m.anno, importo: Math.round(m.abs * 100) / 100 })),
        anni: anni.size, inRitardo: atteso < nowIdx,
      });
    }
  }
  return trovati.sort((a, b) => a.anno - b.anno || a.mese - b.mese || b.importo - a.importo);
}

/**
 * Spese detraibili per anno secondo le regole di config.detraibili:
 * { voce, categorie: ["Cat" | "Cat > Sottocat"], escludi: [...], testo: ["farmacia"],
 *   percentuale, franchigia, tetto }. Un'uscita va alla prima regola in cui la categoria
 * (o la sottocategoria) è in `categorie` o la descrizione contiene un `testo`, se non è
 * in `escludi`. Detrazione stimata = percentuale × (min(spesa, tetto) − franchigia).
 * Ritorna { anno: [{ voce, totale, detrazione|null, movimenti: [...] }] }.
 */
function calcolaDetraibili(allData, regole) {
  if (!Array.isArray(regole) || !regole.length) return {};
  const lista = v => (Array.isArray(v) ? v : v ? [v] : []).map(String);
  const spec = s => { const [cat, sub] = s.split('>').map(x => x.trim().toLowerCase()); return { cat, sub: sub || null }; };
  const inLista = (r, specs) => specs.some(s => s.cat === r.cat.toLowerCase() && (s.sub === null || s.sub === r.sub.toLowerCase()));
  const norm = regole.filter(rg => rg && rg.voce).map(rg => ({
    voce: String(rg.voce),
    categorie: lista(rg.categorie || rg.categoria).map(spec),
    escludi: lista(rg.escludi).map(spec),
    testo: lista(rg.testo).map(t => t.toLowerCase()),
    percentuale: Number(rg.percentuale) || null,
    franchigia: Number(rg.franchigia) || 0,
    tetto: Number(rg.tetto) || null,
  }));
  const out = {};
  for (const [yr, rows] of Object.entries(allData || {})) {
    const voci = norm.map(rg => ({ rg, movimenti: [] }));
    (rows || []).forEach(r => {
      if (!(r.amount < 0)) return;
      const r2 = { ...r, cat: r.cat || '', sub: r.sub || '' };
      const op = String(r.op || '').toLowerCase();
      const v = voci.find(({ rg }) => (inLista(r2, rg.categorie) || rg.testo.some(t => op.includes(t))) && !inLista(r2, rg.escludi));
      if (v) v.movimenti.push({ date: r.date, op: r.op, amount: Math.abs(r.amount), cat: r.cat, sub: r.sub, ...(r.card ? { card: true } : {}) });
    });
    out[yr] = voci.map(({ rg, movimenti }) => {
      movimenti.sort((a, b) => dateNum(a.date) - dateNum(b.date));
      const totale = Math.round(movimenti.reduce((s, m) => s + m.amount, 0) * 100) / 100;
      const base = Math.max(0, Math.min(totale, rg.tetto || Infinity) - rg.franchigia);
      return { voce: rg.voce, totale, movimenti, percentuale: rg.percentuale, franchigia: rg.franchigia || null, tetto: rg.tetto,
        detrazione: rg.percentuale ? Math.round(base * rg.percentuale) / 100 : null };
    });
  }
  return out;
}

/**
 * Analisi calcolate a ogni risposta (non in cache): dipendono dalla data di oggi e da
 * config.json, così una regola cambiata vale subito senza aspettare il download.
 */
/**
 * Equivalenze di `categorieAlias` (config.json): { "Vecchio": "Nuovo", "Cat > Sub": "Nuova" } →
 * funzione che rinomina un record ({ cat, sub }), o null se non ci sono equivalenze. Maiuscole e
 * spazi non contano; la chiave "Cat > Sub" vince su "Cat". La destinazione può essere "Cat" (la
 * sottocategoria resta, o si svuota se la chiave la nominava: è stata promossa a categoria) oppure
 * "Cat > Sub". Il foglio non viene toccato.
 */
function aliasCategoria(alias) {
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const mappa = {};
  Object.entries(alias && typeof alias === 'object' ? alias : {}).forEach(([k, v]) => {
    const [c, s] = k.split('>').map(norm);
    if (c && v) mappa[s ? `${c}>${s}` : c] = String(v);
  });
  if (!Object.keys(mappa).length) return null;
  return rec => {
    if (!rec || !rec.cat) return rec;
    const c = norm(rec.cat), s = norm(rec.sub);
    const conSub = s ? mappa[`${c}>${s}`] : undefined;
    const dest = conSub || mappa[c];
    if (!dest) return rec;
    const [nc, ns] = dest.split('>').map(x => x.trim());
    return { ...rec, cat: nc, sub: ns !== undefined ? ns : conSub ? '' : rec.sub };
  };
}

/** I dati con le equivalenze applicate a movimenti, previste e ricorrenti (copie: la cache resta com'è). */
function applicaAlias(data, alias) {
  const f = aliasCategoria(alias);
  if (!f) return data;
  const perAnno = o => o && Object.fromEntries(Object.entries(o).map(([y, l]) => [y, Array.isArray(l) ? l.map(f) : l]));
  return { ...data, allData: perAnno(data.allData), previste: perAnno(data.previste), ricorrenti: perAnno(data.ricorrenti) };
}

function conAnalisi(dati, config, now = new Date()) {
  const data = applicaAlias(dati, config && config.categorieAlias);
  const yr = String(now.getFullYear());
  const ricorrenti = (data.ricorrenti && data.ricorrenti[yr]) || [];
  const allData = data.allData || {};
  return {
    ...data,
    ricorrentiNonTrovate: { anno: yr, voci: controllaRicorrenti(ricorrenti, allData[yr], now) },
    abbonamenti: trovaAbbonamenti(allData, ricorrenti, config && config.abbonamentiIgnora),
    annuali: trovaAnnuali(allData, data.previste, ricorrenti, config && config.annualiIgnora, now),
    detraibili: calcolaDetraibili(allData, config && config.detraibili),
    importa: importAbilitato(config), // la pagina mostra il pulsante Importa
    categorieGeneriche: (config && Array.isArray(config.categorieGeneriche)) ? config.categorieGeneriche : [], // «Da classificare» in Dati
  };
}

function parseBollette(rows) {
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 6) continue;
    const [contratto, podpdr, titolare, fattura, emissione, importo, importo_norm, stato, mese, indirizzo, commodity, annoCol] = row;
    const imp = parseAmount(importo_norm || importo);
    if (isNaN(imp)) continue;
    let anno = (annoCol || '').trim();
    if (!anno && emissione) { const p = emissione.split(/[\/\-\.]/); anno = p.find(x => x.length === 4) || ''; }
    if (!anno && mese) { const p = mese.split(/[\/\-\.]/); anno = p.find(x => x.length === 4) || ''; }
    data.push({ fattura: fattura||'', emissione: emissione||'', importo: imp,
      stato: (stato||'').trim(), mese: (mese||'').trim(), commodity: (commodity||'Altro').trim(), anno });
  }
  return data;
}


function parseConsumi(rows) {
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const meseStr = (row[0]||'').trim().toLowerCase();
    if (!meseStr) continue;
    const parts = meseStr.split(/\s+/);
    const mIdx = MESI_IT[parts[0]];
    const anno = parts[1] || '';
    if (mIdx === undefined || !anno) continue;
    const gas = parseAmount(row[1]);
    const f1 = parseAmount(row[2]);
    const f2 = parseAmount(row[3]);
    const f3 = parseAmount(row[4]);
    const luce = [f1,f2,f3].filter(v => !isNaN(v)).reduce((s,v) => s+v, 0);
    data.push({ mese: row[0].trim(), meseIdx: mIdx, anno,
      gas: isNaN(gas)?null:gas, f1: isNaN(f1)?null:f1,
      f2: isNaN(f2)?null:f2, f3: isNaN(f3)?null:f3, luce: luce||null });
  }
  return data;
}

// Niente intestazioni CORS: la pagina chiama le API dalla stessa origine, e senza CORS
// un altro sito aperto nel browser non può leggere i dati finanziari da /api/data.
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// File statici sempre rivalidati: niente cache stantia di app.js/style.css/index.html
// dopo un deploy. I file sono piccoli, quindi il ri-download è trascurabile.
const NO_CACHE = 'no-cache, no-store, must-revalidate';

function serveFile(res, filePath, bodyOverride = null) {
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  if (bodyOverride != null) {
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control': NO_CACHE });
    res.end(bodyOverride);
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control': NO_CACHE });
    res.end(data);
  });
}

const MAX_BODY = 5 * 1024 * 1024;

/** Corpo della richiesta come testo, al massimo MAX_BODY byte (oltre: errore con status 413). */
function leggiBody(req) {
  return new Promise((resolve, reject) => {
    const parti = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > MAX_BODY) { reject(Object.assign(new Error('troppo grande'), { status: 413 })); req.destroy(); return; }
      parti.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parti).toString('utf8')));
    req.on('error', reject);
  });
}

/** Confronto a tempo costante (sugli hash, così anche lunghezze diverse non si notano). */
function passwordGiusta(data, attesa) {
  const h = s => crypto.createHash('sha256').update(String(s || '')).digest();
  return !!data && crypto.timingSafeEqual(h(data), h(attesa));
}

/**
 * Limite ai tentativi di password: dopo `max` errori in `finestraMs` blocca tutte le scritture per
 * `bloccoMs`; una password giusta azzera il conto. Contatore unico, non per indirizzo: dietro un
 * proxy inverso o Tailscale il server vede spesso sempre lo stesso IP. `now` in millisecondi.
 */
function limiteTentativi({ max = 5, finestraMs = 10 * 60e3, bloccoMs = 15 * 60e3 } = {}) {
  let errori = [], bloccatoFino = 0;
  return {
    /** Millisecondi di blocco che restano (0 = si può provare). */
    attesa(now) { return Math.max(0, bloccatoFino - now); },
    errore(now) {
      errori = errori.filter(t => now - t < finestraMs).concat(now);
      if (errori.length >= max) { bloccatoFino = now + bloccoMs; errori = []; }
    },
    riuscito() { errori = []; }
  };
}
const tentativiPassword = limiteTentativi();

let scrittureInCorso = Promise.resolve();

/**
 * Anteprima (conferma = false): legge la scheda dati da Google e la confronta con gli estratti,
 * senza scrivere. Conferma: rifà il confronto sulla scheda appena riletta (se nel frattempo è
 * cambiata, conta lo stato attuale), scrive codici aggiornati e righe nuove, poi riscarica i dati.
 * body = { file: [{ nome, testo }], modifiche: { id: { cat, sub, escludi } } }.
 */
async function importa(config, body, conferma) {
  const files = Array.isArray(body.file) ? body.file : [];
  if (!files.length) throw Object.assign(new Error('Nessun file'), { status: 400 });
  const estratti = files.map(f => leggiEstratto(String(f.testo || ''), String(f.nome || '')));
  const ignoti = estratti.filter(e => !e.formato).map(e => e.nome || 'senza nome');
  if (ignoti.length) throw Object.assign(new Error(`Formato non riconosciuto: ${ignoti.join(', ')} (servono le liste movimenti di conto o carta in CSV)`), { status: 400 });

  const g = config.google;
  const rows = await g.get(config.sheetId, 'dati');
  const foglio = leggiFoglioDati(rows);
  const confronto = confronta(estratti, foglio);
  if (!conferma) return confronto;

  const ops = operazioniScrittura(confronto, foglio, body.modifiche || {}, colonna);
  if (ops.intestazione) await g.scriviRighe(config.sheetId, 'dati', 1, [ops.intestazione]);
  if (ops.update.length) await g.update(config.sheetId, ops.update);
  // Righe nuove subito dopo l'ultima riga non vuota (rows esclude le righe vuote in fondo)
  if (ops.append.length) await g.scriviRighe(config.sheetId, 'dati', Math.max(rows.length, 1) + 1, ops.append, formatiDati(foglio.colonne));
  const modifiche = body.modifiche || {};
  const aggiornati = confronto.righe.filter(r => r.stato === 'aggiorna' && !(modifiche[r.id] && modifiche[r.id].escludi)).length;
  console.log(`[importa] ${ops.append.length} righe aggiunte, ${aggiornati} codici aggiornati`);
  return { esito: { aggiunti: ops.append.length, aggiornati }, data: await riscarica(config) };
}

/** Dopo una scrittura: un download partito prima non la vedrebbe, quindi si aspetta che finisca e se ne fa uno nuovo. */
async function riscarica(config) {
  if (inflight) await inflight.catch(() => {});
  const data = await refreshData(config);
  return { ...conAnalisi(data, config), fromCache: false, stale: data.errors.length > 0 };
}

const errore = (msg, status = 400) => Object.assign(new Error(msg), { status });
const stessoTesto = (a, b) => String(a || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Scrive una riga nuova in fondo a una scheda (creandola con l'intestazione se manca). */
async function aggiungiRiga(config, nome, intestazione, riga, formati) {
  const g = config.google, id = config.sheetId;
  await g.creaSchede(id, [nome]);
  const rows = await g.getOptional(id, nome);
  if (!rows.length) await g.scriviRighe(id, nome, 1, [intestazione]);
  await g.scriviRighe(id, nome, Math.max(rows.length, 1) + 1, [riga], formati);
}

/**
 * Modifiche dal portale, scritte nel foglio unico. Prima di toccare una riga esistente la si
 * rilegge e si controlla che sia ancora quella mostrata (data, descrizione, importo): se nel
 * frattempo il foglio è cambiato si rifiuta (409) invece di modificare la riga sbagliata.
 * - categoria: { riga, date, op, amount, cat, sub } → Categoria e Sottocategoria di un movimento
 * - eliminaMovimento: { riga, date, op, amount } → toglie la riga del movimento da dati
 * - ricorrente: { descr, importo, cat, sub, match, entrata } → riga nuova in Ricorrenti
 * - prevista: { data (MM/AAAA o GG/MM/AAAA), descr, importo, cat, sub } → riga nuova in Previste
 * - eliminaPrevista: { riga, data, descr, importo } → toglie una riga da Previste (spesa pagata)
 * Non riscarica i dati (lo fa l'endpoint), così si può provare con Google simulato.
 */
async function applicaModifica(config, body) {
  const g = config.google, id = config.sheetId;
  const importo = v => { const n = Number(v); if (!Number.isFinite(n) || !n) throw errore('Importo non valido'); return Math.abs(Math.round(n * 100) / 100); };
  // Movimento di "dati" alla riga indicata, solo se è ancora quello mostrato nel portale
  const movimento = async () => {
    const foglio = leggiFoglioDati(await g.get(id, 'dati'));
    const r = foglio.righe.find(x => x.riga === Number(body.riga));
    if (!r || dateNum(r.date) !== dateNum(body.date) || centesimi(r.amount) !== centesimi(Number(body.amount)) || !stessoTesto(r.op, body.op)) {
      throw errore('Nel foglio la riga è cambiata: premi Aggiorna dati e riprova', 409);
    }
    return { foglio, r };
  };
  switch (body.azione) {
    case 'categoria': {
      const { foglio, r } = await movimento();
      const c = foglio.colonne;
      await g.update(id, [
        { range: `dati!${colonna(c.categoria)}${r.riga}`, values: [[testo(String(body.cat || '').trim())]] },
        { range: `dati!${colonna(c.sottocategoria)}${r.riga}`, values: [[testo(String(body.sub || '').trim())]] },
      ]);
      return `categoria della riga ${r.riga}`;
    }
    case 'eliminaMovimento': {
      const { r } = await movimento();
      await g.eliminaRiga(id, 'dati', r.riga);
      return `movimento "${r.op}" del ${r.date} tolto (riga ${r.riga})`;
    }
    case 'ricorrente': {
      const descr = String(body.descr || '').trim();
      if (!descr) throw errore('Manca la descrizione');
      const intestazione = ['Descrizione', 'Importo', 'Categoria', 'Sottocategoria', 'Corrispondenza', 'Tipo'];
      await aggiungiRiga(config, 'Ricorrenti', intestazione,
        [testo(descr), importo(body.importo), testo(body.cat || ''), testo(body.sub || ''), testo(String(body.match || '').trim()), body.entrata ? 'Entrata' : 'Uscita'],
        [{ col: 1, tipo: 'NUMBER', pattern: '0.00' }]);
      // Schede create prima della colonna Tipo: si aggiunge l'intestazione mancante
      const testa = (await g.getOptional(id, 'Ricorrenti'))[0] || [];
      if (!String(testa[5] || '').trim()) await g.update(id, [{ range: 'Ricorrenti!F1', values: [['Tipo']] }]);
      return `${body.entrata ? 'entrata' : 'spesa'} ricorrente "${descr}"`;
    }
    case 'prevista': {
      const descr = String(body.descr || '').trim(), data = String(body.data || '').trim();
      if (!parseDataPrevista(data)) throw errore('Data non valida: usa MM/AAAA o GG/MM/AAAA');
      if (!descr) throw errore('Manca la descrizione');
      // La data resta testo: "09/2026" come data diventerebbe il 1° settembre
      await aggiungiRiga(config, 'Previste', ['Data prevista', 'Descrizione', 'Importo', 'Categoria', 'Sottocategoria'],
        [`'${data}`, testo(descr), importo(body.importo), testo(body.cat || ''), testo(body.sub || '')],
        [{ col: 0, tipo: 'TEXT' }, { col: 2, tipo: 'NUMBER', pattern: '0.00' }]);
      return `prevista "${descr}"`;
    }
    case 'eliminaPrevista': {
      const rows = await g.get(id, 'Previste');
      const riga = Number(body.riga), row = rows[riga - 1];
      const p = row && parsePreviste([[], row])[0];
      const d = parseDataPrevista(body.data);
      if (!p || !d || p.anno !== d.anno || p.mese !== d.mese || !stessoTesto(p.descr, body.descr) || centesimi(p.importo) !== centesimi(Math.abs(Number(body.importo)))) {
        throw errore('Nel foglio la riga è cambiata: premi Aggiorna dati e riprova', 409);
      }
      await g.eliminaRiga(id, 'Previste', riga);
      return `prevista "${p.descr}" tolta`;
    }
    default: throw errore('Azione sconosciuta');
  }
}

/** Scarica da Google e risponde; se il download fallisce del tutto serve la cache marcata stale. */
async function serveFresh(res, config, cache) {
  try {
    const data = await refreshData(config);
    json(res, { ...conAnalisi(data, config), fromCache: false, stale: data.errors.length > 0 });
  } catch(e) {
    console.error('[fetch] Errore:', e.message);
    if (cache.data) {
      console.log('[cache] Fallback su dati in cache.');
      return json(res, { ...conAnalisi(cache.data, config), fromCache: true, stale: true, errors: e.errors || [e.message] });
    }
    json(res, { error: e.message }, 500);
  }
}

const server = http.createServer(async (req, res) => {
  const pathnameRaw = new URL(req.url, 'http://localhost').pathname || '/';
  const pathname = stripBasePath(pathnameRaw);
  if (pathname == null) {
    res.writeHead(404); res.end('Not found'); return;
  }


  // GET /api/data — restituisce i dati (da cache o aggiorna)
  if (pathname === '/api/data' && req.method === 'GET') {
    const config = loadConfig();
    if (!config) return json(res, { error: 'config.json o secrets.json non trovati' }, 500);
    const cache = loadCache();
    const ttl = cacheTTLMinutes(config) * 60 * 1000;
    const age = cache.lastUpdate ? Date.now() - new Date(cache.lastUpdate).getTime() : Infinity;
    if (cache.data && age < ttl) {
      console.log(`[cache] Dati serviti dalla cache (${Math.round(age/60000)}m fa)`);
      return json(res, { ...conAnalisi(cache.data, config), fromCache: true });
    }
    if (cache.data && lastFail && Date.now() - lastFail.at < RETRY_AFTER_FAIL_MS) {
      console.log('[cache] Ultimo download fallito da poco: servo la cache senza riprovare.');
      return json(res, { ...conAnalisi(cache.data, config), fromCache: true, stale: true, errors: lastFail.errors });
    }
    console.log('[fetch] Aggiornamento dati da Google Sheets...');
    return serveFresh(res, config, cache);
  }

  // POST /api/refresh — ignora la cache, riscarica e restituisce i dati aggiornati
  if (pathname === '/api/refresh' && req.method === 'POST') {
    // Un altro sito può inviare un POST semplice (senza leggere la risposta) e far partire
    // download da Google consumando la quota. Un'intestazione personalizzata richiede un
    // permesso CORS che il server non dà: la può inviare solo la pagina di FinFlow.
    if (req.headers['x-finflow'] !== '1') return json(res, { error: 'Richiesta non valida' }, 403);
    const config = loadConfig();
    if (!config) return json(res, { error: 'config.json o secrets.json non trovati' }, 500);
    console.log('[refresh] Aggiornamento manuale da Google Sheets...');
    return serveFresh(res, config, loadCache());
  }

  // POST /api/importa/anteprima e /api/importa/conferma — estratti CSV della banca nella scheda dati
  // POST /api/modifica — categorie, Ricorrenti e Previste modificate dal portale
  const scrittura = ['/api/importa/anteprima', '/api/importa/conferma', '/api/modifica'].includes(pathname);
  if (scrittura && req.method === 'POST') {
    if (req.headers['x-finflow'] !== '1') return json(res, { error: 'Richiesta non valida' }, 403);
    const config = loadConfig();
    if (!importAbilitato(config)) return json(res, { error: 'Scrittura nel foglio non configurata: servono sheetId, serviceAccount e importPassword in secrets.json' }, 400);
    const attesa = tentativiPassword.attesa(Date.now());
    if (attesa > 0) {
      res.setHeader('Retry-After', String(Math.ceil(attesa / 1000)));
      return json(res, { error: `Troppi tentativi sbagliati: riprova tra ${Math.ceil(attesa / 60e3)} minuti` }, 429);
    }
    let pwd = '';
    try { pwd = decodeURIComponent(req.headers['x-finflow-password'] || ''); } catch(e) {} // codificata dalla pagina (le intestazioni sono solo ASCII)
    if (!passwordGiusta(pwd, config.importPassword)) {
      tentativiPassword.errore(Date.now());
      console.warn('[scrittura] Password sbagliata');
      return json(res, { error: 'Password sbagliata' }, 401);
    }
    tentativiPassword.riuscito();
    let body;
    try { body = JSON.parse(await leggiBody(req)); }
    catch(e) { return json(res, { error: e.status === 413 ? 'File troppo grandi' : 'Richiesta non valida' }, e.status || 400); }
    const lavoro = pathname === '/api/modifica'
      ? async () => { const fatto = await applicaModifica(config, body); console.log(`[modifica] ${fatto}`); return { esito: fatto, data: await riscarica(config) }; }
      : () => importa(config, body, pathname.endsWith('/conferma'));
    // Una scrittura alla volta: due conferme contemporanee aggiungerebbero le stesse righe due volte
    const run = scrittureInCorso.then(lavoro);
    scrittureInCorso = run.catch(() => {});
    try { return json(res, await run); }
    catch(e) {
      console.error(`[${pathname.slice(5)}] Errore:`, e.message);
      return json(res, { error: e.message }, e.status === 409 ? 409 : e.status && e.status < 500 ? 400 : 502);
    }
  }

  // GET /api/status — info server
  if (pathname === '/api/status' && req.method === 'GET') {
    const config = loadConfig();
    const cache = loadCache();
    return json(res, {
      ok: !!config,
      versione: VERSIONE,
      years:config && config.sheetMap ? Object.keys(config.sheetMap) : Object.keys((cache.data && cache.data.allData) || {}),
      lastUpdate: cache.lastUpdate,
      cacheTTLMinutes: config ? cacheTTLMinutes(config) : 60
    });
  }

  // Serve file statici da /public
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      try {
        serveFile(res, path.join(PUBLIC_PATH, 'index.html'), getIndexHtml());
      } catch (e) {
        res.writeHead(500); res.end('index.html non disponibile');
      }
      return;
    }
    const normalized = path.normalize(path.join(PUBLIC_PATH, pathname.replace(/^\//, '')));
    if (normalized !== PUBLIC_PATH && !normalized.startsWith(PUBLIC_PATH + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
      serveFile(res, normalized);
    } else {
      try {
        serveFile(res, path.join(PUBLIC_PATH, 'index.html'), getIndexHtml());
      } catch (e) {
        res.writeHead(500); res.end('index.html non disponibile');
      }
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// Funzioni pure esportate per i test (test/*.test.js): con require() il server non si mette in ascolto.
module.exports = { limiteTentativi, aliasCategoria, applicaAlias, conAnalisi, parseAmount, isCardValue, parseFinanziari, parseSaldo, parseDataPrevista, parsePreviste,
  parseRicorrenti, generaPrevisteRicorrenti, parseBollette, parseConsumi, normalizeCategories,
  controllaRicorrenti, chiaveMovimento, corrispondenzaComune, trovaAbbonamenti, trovaAnnuali, calcolaDetraibili, applicaModifica };

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => {
  const baseMsg = BASE_PATH ? `${BASE_PATH}` : '(radice)';
  console.log(`\nFinFlow server avviato su http://localhost:${PORT}`);
  console.log(`BASE_PATH: ${baseMsg}`);
  console.log(`Esempio URL pubblico: http://<IP-server>:${PORT}${BASE_PATH || ''}/\n`);
  const config = loadConfig();
  if (!config) console.warn('ATTENZIONE: config.json o secrets.json mancanti/non validi. Crea entrambi i file (vedi secrets.example.json) prima di usare il portale.\n');
  else if (config.sheetId) console.log(`Foglio unico ${config.sheetId} · import CSV ${importAbilitato(config) ? 'attivo' : 'non configurato'}\n`);
  else console.log(`Anni configurati: ${Object.keys(config.sheetMap).join(', ')}\n`);
});
