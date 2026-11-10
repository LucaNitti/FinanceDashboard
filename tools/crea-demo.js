#!/usr/bin/env node
/* FinFlow — Demo con dati inventati, senza server e senza Google.
   Crea una copia statica di public/ con api/data già pronto: una famiglia finta (stipendi,
   mutuo, spesa, bollette...) da gennaio di tre anni fa a oggi, passata dagli stessi parser e
   dalle stesse analisi del server. Si pubblica così com'è su GitHub Pages
   (.github/workflows/demo.yml). Nessun dato viene da secrets.json, cache.json o config.json.

   Uso: node tools/crea-demo.js [cartella]          crea la cartella (default _site)
        node tools/crea-demo.js [cartella] --serve [porta]   la crea e la serve su localhost (default 3100) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const srv = require('../server.js');

const RADICE = path.join(__dirname, '..');
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Impostazioni della demo (al posto di config.json, che descrive il foglio vero). */
const CONFIG_DEMO = {
  categorieGeneriche: ['Altre spese'],
  detraibili: [
    { voce: 'Spese sanitarie', categorie: ['Salute e benessere'], escludi: ['Salute e benessere > Parrucchiere'], percentuale: 19, franchigia: 129.11 },
    { voce: 'Istruzione', categorie: ['Istruzione'], percentuale: 19 },
  ],
};

/** Generatore di numeri casuali con seme (mulberry32): gli stessi mesi danno sempre gli stessi movimenti. */
function casuale(seme) {
  let a = seme >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.tra = (min, max) => min + r() * (max - min);
  r.intero = (min, max) => Math.floor(r.tra(min, max + 1));
  r.scegli = lista => lista[Math.floor(r() * lista.length)];
  return r;
}

const due = n => String(n).padStart(2, '0');
const data = (a, m, g) => `${due(g)}/${due(m + 1)}/${a}`;
const euro = n => (Math.round(n * 100) / 100).toFixed(2);
const giorniDelMese = (a, m) => new Date(a, m + 1, 0).getDate();

/**
 * Le schede del foglio finto, come le restituirebbe Google (righe di testo), fino a `oggi`.
 * Ritorna { dati, saldo, previste, ricorrenti, bollette, consumi }.
 */
function creaFogli(oggi = new Date()) {
  const annoOra = oggi.getFullYear(), meseOra = oggi.getMonth(), giornoOra = oggi.getDate();
  const primoAnno = annoOra - 3;
  const dati = [['Codice', 'Data', 'Operazione', 'Importo', 'Categoria', 'Sottocategoria', 'Carta']];
  const bollette = [['Contratto', 'POD/PDR', 'Titolare', 'Fattura', 'Emissione', 'Importo', 'Importo normalizzato', 'Stato', 'Mese', 'Indirizzo', 'Commodity', 'Anno']];
  const consumi = [['Mese', 'Gas (Smc)', 'F1 (kWh)', 'F2 (kWh)', 'F3 (kWh)']];
  const saldo = [['Mese', 'Saldo']];
  let codice = 10000000000000, fattura = 4100;
  let saldoConto = 9200, cartaMesePrima = 0;

  for (let anno = primoAnno; anno <= annoOra; anno++) {
    const crescita = 1 + 0.03 * (anno - primoAnno); // stipendi e prezzi salgono un po' ogni anno
    for (let mese = 0; mese <= (anno === annoOra ? meseOra : 11); mese++) {
      const r = casuale(anno * 12 + mese);
      const inCorso = anno === annoOra && mese === meseOra;
      const ultimoGiorno = inCorso ? giornoOra : giorniDelMese(anno, mese);
      let entrate = 0, uscite = 0, carta = 0;
      const righe = [];
      /** Movimento del mese: saltato se il giorno non è ancora arrivato (mese in corso). */
      const mov = (giorno, op, importo, cat, sub = '', conCarta = false) => {
        const g = Math.min(giorno, giorniDelMese(anno, mese));
        if (g > ultimoGiorno) return;
        righe.push({ g, riga: [String(++codice), data(anno, mese, g), op, euro(importo), cat, sub, conCarta ? 'sì' : ''] });
        if (importo > 0) entrate += importo; else { uscite -= importo; if (conCarta) carta -= importo; }
      };
      const giorno = () => r.intero(1, giorniDelMese(anno, mese));

      // Entrate
      mov(27, 'ACCREDITO STIPENDIO ALFA SRL', 2150 * crescita, 'Stipendio');
      mov(10, 'ACCREDITO EMOLUMENTI BETA SPA', 1680 * crescita, 'Stipendio');
      if (mese === 11) mov(18, 'ACCREDITO TREDICESIMA ALFA SRL', 1950 * crescita, 'Stipendio');
      if (r() < 0.25) mov(giorno(), 'BONIFICO DA BIANCHI G. RIMBORSO CENA', r.tra(20, 90), 'Rimborsi');

      // Spese fisse
      mov(5, `RATA MUTUO BANCA DEMO N. ${due(mese + 1)}/${anno}`, -780, 'Casa', 'Mutuo');
      mov(15, 'ADDEBITO SDD FIBRA DEMO TELECOM', -29.9, 'Casa', 'Internet');
      mov(8, 'NETFLIX.COM', -13.99, 'Abbonamenti', 'Streaming', true);
      mov(12, 'MUSICA DEMO PREMIUM', -10.99, 'Abbonamenti', 'Streaming', true);
      if (mese !== 6 && mese !== 7) {
        mov(3, 'SDD PALESTRA FITDEMO', -39, 'Sport e tempo libero', 'Palestra');
        mov(6, 'RETTA MENSA SCOLASTICA COMUNE DI DEMO', -96, 'Istruzione', 'Mensa');
      }
      if (mese === 2) mov(14, 'ASSICURAZIONE AUTO DEMO ASSICURA', -(498 + 14 * (anno - primoAnno)), 'Viaggi e trasporti', 'Assicurazione');
      if (mese === 4) mov(20, 'BOLLO AUTO REGIONE', -198.4, 'Viaggi e trasporti', 'Bollo');
      if (mese === 6 || mese === 11) mov(16, 'TARI COMUNE DI DEMO', -(158 + 4 * (anno - primoAnno)), 'Casa', 'Tasse');
      if (mese === 8) mov(9, 'LIBRERIA SCOLASTICA DEMO', -r.tra(140, 190), 'Istruzione', 'Libri');

      // Bollette: gas ogni mese (di più d'inverno), luce ogni due mesi
      const freddo = [1, 0.9, 0.7, 0.4, 0.2, 0.12, 0.1, 0.1, 0.15, 0.35, 0.7, 0.95][mese];
      const smc = Math.round(18 + 150 * freddo * r.tra(0.85, 1.15));
      const gas = 14 + smc * 1.05 * crescita;
      const kwh = [0, 1, 2].map(() => Math.round(r.tra(55, 95) * (mese === 6 || mese === 7 ? 1.4 : 1)));
      const emessa = g => g <= ultimoGiorno;
      if (emessa(4)) {
        bollette.push(['GAS-0001', 'PDR00000000001', 'Rossi Mario', `G${++fattura}`, data(anno, mese, 4), euro(gas), euro(gas), 'Pagata', data(anno, mese, 1), 'Via Demo 1', 'Gas', String(anno)]);
        mov(19, 'SDD ENERGIA DEMO GAS', -gas, 'Casa', 'Bollette');
      }
      if (mese % 2 === 1 && emessa(12)) {
        const luce = 38 + kwh.reduce((s, k) => s + k, 0) * 2 * 0.31 * crescita;
        bollette.push(['LUCE-0001', 'IT001E00000001', 'Rossi Mario', `L${++fattura}`, data(anno, mese, 12), euro(luce), euro(luce), 'Pagata', data(anno, mese, 1), 'Via Demo 1', 'Luce', String(anno)]);
        mov(27, 'SDD ENERGIA DEMO LUCE', -luce, 'Casa', 'Bollette');
      }
      if (anno >= annoOra - 1 && !inCorso) consumi.push([`${MESI[mese]} ${anno}`, String(smc), ...kwh.map(String)]);

      // Spese variabili
      for (let i = r.intero(8, 12); i > 0; i--) {
        mov(giorno(), r.scegli(['SUPERMERCATO DEMO VIA ROMA', 'SUPERMERCATO DEMO VIA ROMA', 'IPERMERCATO ESEMPIO', 'MERCATO RIONALE', 'PANIFICIO DEMO']), -r.tra(12, 105) * crescita, 'Alimentari');
      }
      for (let i = r.intero(4, 8); i > 0; i--) {
        const bar = r() < 0.4;
        mov(giorno(), bar ? 'BAR CENTRALE DEMO' : r.scegli(['PIZZERIA DA DEMO', 'TRATTORIA ESEMPIO', 'SUSHI DEMO']), -(bar ? r.tra(3, 12) : r.tra(22, 75)), 'Ristoranti e bar', bar ? 'Bar' : 'Ristoranti', !bar);
      }
      for (let i = r.intero(2, 4); i > 0; i--) mov(giorno(), 'DISTRIBUTORE DEMO CARBURANTI', -r.tra(38, 72), 'Viaggi e trasporti', 'Carburante', true);
      mov(2, 'ADDEBITO PEDAGGI AUTOSTRADA DEMO', -r.tra(9, 46), 'Viaggi e trasporti', 'Pedaggi');
      for (let i = r.intero(1, 3); i > 0; i--) mov(giorno(), 'FARMACIA DEMO', -r.tra(7, 42), 'Salute e benessere', 'Farmacia');
      if (r() < 0.3) mov(giorno(), 'STUDIO MEDICO ESEMPIO VISITA', -r.tra(80, 160), 'Salute e benessere', 'Visite');
      if (r() < 0.5) mov(giorno(), 'PARRUCCHIERE DEMO', -r.tra(18, 55), 'Salute e benessere', 'Parrucchiere');
      for (let i = r.intero(1, 4); i > 0; i--) {
        mov(giorno(), r.scegli(['NEGOZIO ABBIGLIAMENTO DEMO', 'ACQUISTI ONLINE ESEMPIO', 'FERRAMENTA DEMO', 'ARREDO CASA ESEMPIO']), -r.tra(18, 140), 'Shopping', '', true);
      }
      for (let i = r.intero(0, 3); i > 0; i--) mov(giorno(), r.scegli(['CINEMA DEMO', 'LIBRERIA ESEMPIO', 'PISCINA COMUNALE']), -r.tra(8, 38), 'Sport e tempo libero');
      for (let i = r.intero(1, 2); i > 0; i--) mov(giorno(), 'PRELIEVO BANCOMAT', -r.scegli([50, 50, 100, 150]), 'Altre spese');
      if (mese === 6 || mese === 7) {
        mov(r.intero(1, 10), 'HOTEL ESEMPIO MARE', -r.tra(620, 980), 'Viaggi e trasporti', 'Vacanze', true);
        mov(r.intero(11, 25), 'TRAGHETTI DEMO', -r.tra(140, 260), 'Viaggi e trasporti', 'Vacanze', true);
      }
      if (mese === 11) for (let i = 3; i > 0; i--) mov(r.intero(5, 23), 'GIOCATTOLI E REGALI DEMO', -r.tra(40, 130), 'Regali', '', true);
      if (r() < 0.12) mov(giorno(), 'OFFICINA DEMO RIPARAZIONE', -r.tra(180, 520), 'Viaggi e trasporti', 'Manutenzione');

      righe.sort((a, b) => a.g - b.g).forEach(x => dati.push(x.riga));

      // Saldo a fine mese come lo calcola il portale: le spese con carta escono dal conto il mese dopo
      saldoConto += entrate - (uscite - carta) - cartaMesePrima;
      cartaMesePrima = carta;
      if (!inCorso) saldo.push([data(anno, mese, giorniDelMese(anno, mese)), euro(saldoConto)]);
    }
  }
  // Un movimento senza categoria, per mostrare il «Controllo dati»
  dati.push([String(++codice), data(annoOra, meseOra, 1), 'PAGAMENTO POS NEGOZIO SCONOSCIUTO', '-23.50', '', '', '']);

  const ricorrenti = [
    ['Descrizione', 'Importo', 'Categoria', 'Sottocategoria', 'Corrispondenza', 'Tipo'],
    ['Stipendio Alfa', '2150', 'Stipendio', '', 'stipendio alfa', 'Entrata'],
    ['Stipendio Beta', '1680', 'Stipendio', '', 'emolumenti beta', 'Entrata'],
    ['Mutuo', '780', 'Casa', 'Mutuo', 'rata mutuo', ''],
    ['Fibra', '29.90', 'Casa', 'Internet', 'fibra demo', ''],
    ['Netflix', '13.99', 'Abbonamenti', 'Streaming', 'netflix', ''],
    ['Mensa scolastica', '96', 'Istruzione', 'Mensa', 'retta mensa', ''],
  ];
  // Spese future già note: alcune quest'anno, alcune l'anno prossimo
  const tra = n => { const d = new Date(annoOra, meseOra + n, 1); return `${due(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const previste = [
    ['Data prevista', 'Descrizione', 'Importo', 'Categoria', 'Sottocategoria'],
    [tra(0), 'Tagliando auto', '280', 'Viaggi e trasporti', 'Manutenzione'],
    [tra(1), 'Dentista', '350', 'Salute e benessere', 'Visite'],
    [tra(2), 'Lavatrice nuova', '390', 'Shopping', ''],
    [tra(4), 'Acconto vacanze', '900', 'Viaggi e trasporti', 'Vacanze'],
  ];
  return { dati, saldo, previste, ricorrenti, bollette, consumi };
}

/** La risposta di /api/data per i fogli finti: stessi parser e stesse analisi del server. */
function creaDati(oggi = new Date()) {
  const fogli = creaFogli(oggi);
  const annoOra = String(oggi.getFullYear());
  const controlli = {};
  const movimenti = srv.parseFinanziari(fogli.dati, controlli);
  const perAnno = (lista, annoDi) => lista.reduce((o, x) => { const a = annoDi(x); if (a) (o[a] = o[a] || []).push(x); return o; }, {});
  const annoDi = s => { const d = srv.parseDataPrevista(s); return d ? String(d.anno) : null; };
  const result = {
    allData: perAnno(movimenti, m => annoDi(m.date)),
    bollette: srv.parseBollette(fogli.bollette),
    saldo: perAnno(srv.parseSaldo(fogli.saldo), s => annoDi(s.mese)),
    previste: perAnno(srv.parsePreviste(fogli.previste), p => String(p.anno)),
    ricorrenti: { [annoOra]: srv.parseRicorrenti(fogli.ricorrenti) },
    consumi: srv.parseConsumi(fogli.consumi),
    controlli: {}, errors: [], lastUpdate: oggi.toISOString(),
  };
  const vuoto = () => ({ scartate: [], senzaCategoria: [], doppioni: [], dateAnomale: [] });
  Object.keys(result.allData).forEach(y => { result.controlli[y] = vuoto(); });
  ['scartate', 'senzaCategoria', 'doppioni', 'dateAnomale'].forEach(k => (controlli[k] || []).forEach(x => {
    result.controlli[(x.date && annoDi(x.date)) || annoOra][k].push(x);
  }));
  srv.generaPrevisteRicorrenti(result, oggi);
  srv.normalizeCategories(result.allData);
  return { ...srv.conAnalisi(result, CONFIG_DEMO, oggi), fromCache: false, demo: true };
}

/** Copia public/ in `dest`, con index.html già compilato e api/data pronto. */
function creaSito(dest, oggi = new Date()) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(RADICE, 'public'), dest, { recursive: true });
  const versione = { numero: require('../package.json').version || '', commit: '', data: '' };
  try {
    const out = require('child_process').execFileSync('git', ['log', '-1', '--format=%h %cs'], { cwd: RADICE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    [versione.commit, versione.data] = out.split(' ');
  } catch (e) {}
  const index = path.join(dest, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('%%FINFLOW_BASE_INJECT%%',
    `<script>window.__FINFLOW_VERSIONE__=${JSON.stringify(versione)};</script>\n`));
  const dati = creaDati(oggi);
  fs.mkdirSync(path.join(dest, 'api'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'api', 'data'), JSON.stringify(dati));
  fs.writeFileSync(path.join(dest, '.nojekyll'), ''); // GitHub Pages: file serviti così come sono
  return dati;
}

/** Serve la cartella su localhost, per guardare la demo prima di pubblicarla. */
function servi(dest, porta) {
  const tipi = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(dest, p === '/' ? 'index.html' : p));
    if (!file.startsWith(dest) || req.method !== 'GET' || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': tipi[path.extname(file)] || 'application/json', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }).listen(porta, '127.0.0.1', () => console.log(`Demo su http://localhost:${porta}/`));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const iServe = args.indexOf('--serve');
  const porta = iServe >= 0 ? Number(args[iServe + 1]) || 3100 : 0;
  const dest = path.resolve(args.find((a, i) => !a.startsWith('--') && !(iServe >= 0 && i === iServe + 1)) || path.join(RADICE, '_site'));
  const dati = creaSito(dest);
  const n = Object.values(dati.allData).reduce((s, l) => s + l.length, 0);
  console.log(`Demo creata in ${dest}: ${n} movimenti finti, anni ${Object.keys(dati.allData).join(', ')}`);
  if (porta) servi(dest, porta);
}

module.exports = { creaFogli, creaDati, creaSito };
