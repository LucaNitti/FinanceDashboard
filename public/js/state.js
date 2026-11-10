/* FinFlow — Stato globale, costanti e percorso base (reverse proxy). */
/** Prefisso URL se il portale è dietro reverse proxy (es. /finflow) — valorizzato da index.html */
function inferBasePath() {
  const pathname = window.location.pathname || '/';
  if (pathname === '/' || pathname === '/index.html') return '';
  const clean = pathname.replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1 && /\.[a-z0-9]+$/i.test(parts[0])) return '';
  return `/${parts[0]}`;
}

const FINFLOW_BASE = (typeof window.__FINFLOW_BASE__ === 'string' && window.__FINFLOW_BASE__)
  ? window.__FINFLOW_BASE__.replace(/\/+$/, '')
  : inferBasePath();
function apiUrl(path) {
  const p = path.startsWith('/') ? path : '/' + path;
  return FINFLOW_BASE + p;
}

const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const MONTHS_FULL = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const MESI_3 = MONTHS.map(m => m.toLowerCase()); // etichette dei grafici e dei testi: gen, feb...
const THEME_FALLBACKS = {
  chartGrid: '#1E2836',
  chartAxis: '#7F8CA0',
  chart1: '#A3AEFF',
  chart2: '#2FB5C6',
  chart3: '#D98BB0',
  chart4: '#E6C46A',
  chart5: '#6FA8E8',
  chart6: '#8FBF6A',
  chart7: '#C195E0',
  chart8: '#E08E5A',
  chart9: '#4FB89A',
  chart10: '#C9A87C'
};
let TREND_COLORS = [];
// Colori di entrate e uscite nei grafici (fuori dalla palette delle categorie)
let CHART_IN = '#7CCBA8', CHART_OUT = '#F0937B';
let tc = THEME_FALLBACKS.chartAxis;
let gc = THEME_FALLBACKS.chartGrid;

let allData = {}, bolletteData = [], saldoData = {}, previsteData = {}, consumiData = [], charts = {}, activeYear = '', config = {};
// Analisi del server: problemi del foglio per anno, ricorrenti senza addebito (anno in corso),
// possibili abbonamenti (ultimi 12 mesi), spese detraibili per anno (regole in config.json)
let controlliData = {}, ricorrentiNonTrovate = { anno: '', voci: [] }, abbonamentiData = [], detraibiliData = {};
// Spese annuali attese nei prossimi 12 mesi (assicurazioni, tasse...) non ancora tra le Previste
let annualiData = [];
// Categorie che dicono il mezzo di pagamento, non la spesa (config.json): elenco «Da classificare» in Dati
let categorieGeneriche = [];
// Foglio unico con account di servizio e password: il portale può scrivere (Importa, modifiche)
let scritturaAbilitata = false;
// Demo statica con dati inventati (tools/crea-demo.js, GitHub Pages): non c'è un server dietro
let demo = false;
let selectedCats = [];
const DATI_PAGE_SIZE = 50;
let datiPage = 0;
let currentSection = 'overview';
const renderedSections = new Set();
let datiSearchTimer = null;
let isYearSwitching = false;
let bollYoyCommodity = ''; // commodity selezionata nel confronto anno su anno delle bollette
let ovMonth = -1; // mese selezionato nel "Dettaglio mese" di Panoramica (-1 = ultimo con dati)
let compareMode = 'timeline'; // 'timeline' (nel tempo) | 'monthly' (per mese) — tab Anni
let patrimonioMode = 'tutto'; // 'tutto' (tutta la serie) | 'anno' (solo l'anno selezionato) — Patrimonio nel tempo
// Previste + spese variabili stimate dalla mediana delle categorie (getStimaVariabili): acceso se non
// c'è nulla salvato, perché le sole voci previste danno mesi futuri troppo leggeri; '0' = spento
let stimaMedie = (() => { try { return localStorage.getItem('finflow-stima-medie') !== '0'; } catch (e) { return true; } })();
let bollDividi = false; // bollette bimestrali divise sui due mesi che coprono (elenco e confronto anno su anno)
let periodo = { dal: '', al: '', preset: '' }; // sezione Periodo: date 'AAAA-MM-GG' e pulsante rapido attivo
