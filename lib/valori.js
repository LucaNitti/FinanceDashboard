/* FinFlow — Lettura di importi, date e descrizioni: condivisa da server.js e dall'import dei CSV (lib/importa.js). */

const MESI_IT = { 'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
  'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11 };

/**
 * Importo da testo: formato italiano (1.234,56), inglese (1,234.56), con simbolo di valuta,
 * meno tipografico (−12,50) o negativo contabile tra parentesi ((12,50) = -12,50).
 */
function parseAmount(raw) {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).trim().replace(/[€$£\s]/g, '').replace(/\u2212/g, '-');
  s = s.replace(/^\+/, ''); // il + degli accrediti negli estratti della banca: +2.446,00
  if (!s) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');                  // 1,234.56
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');                                    // 12,50
  return sign * parseFloat(s);
}

/**
 * Colonna "Carta" (opzionale): vero se il movimento è stato pagato con carta di
 * credito, quindi addebitato sul conto il mese successivo. Accetta un flag
 * (sì / x / 1 / ✓) oppure un metodo di pagamento che contenga "carta"
 * (ma non "bancomat"/"debito"/"prepagata", che escono subito dal conto).
 */
function isCardValue(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  if (!v) return false;
  if (/^(s[iì]|x|1|true|yes|ok|v|✓|cc)$/.test(v)) return true;
  if (/bancomat|debito|prepagat/.test(v)) return false;
  return /carta|credit/.test(v);
}

/**
 * Data di una spesa prevista o di un movimento di "Dati": accetta "MM/AAAA"
 * (giorno sconosciuto), "GG/MM/AAAA", "AAAA-MM" e "AAAA-MM-GG". Ritorna mese 0-11.
 */
function parseDataPrevista(raw) {
  const p = String(raw || '').trim().split(/[\/\-\.]/).map(x => x.trim());
  let giorno = null, mese, anno;
  if (p.length === 2 && p[1].length === 4)      { mese = +p[0]; anno = +p[1]; }
  else if (p.length === 2 && p[0].length === 4) { anno = +p[0]; mese = +p[1]; }
  else if (p.length === 3 && p[0].length === 4) { anno = +p[0]; mese = +p[1]; giorno = +p[2]; }
  else if (p.length === 3)                      { giorno = +p[0]; mese = +p[1]; anno = +p[2]; }
  else return null;
  if (!(mese >= 1 && mese <= 12) || !(anno > 1900)) return null;
  return { giorno: giorno || null, mese: mese - 1, anno };
}


/** AAAAMMGG da una data del foglio, per ordinare. */
function dateNum(s) {
  const d = parseDataPrevista(s);
  return d ? d.anno * 10000 + (d.mese + 1) * 100 + (d.giorno || 0) : 0;
}

/** Descrizione senza numeri, date e nomi di mese: "Affitto Ottobre A ROSSI" e "Affitto Maggio A ROSSI" coincidono. */
function chiaveMovimento(op) {
  return String(op || '').toLowerCase().split(/\s+/).filter(t => t && !/\d/.test(t) && !Object.hasOwn(MESI_IT, t))
    .join(' ').replace(/[^a-zà-ÿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { MESI_IT, parseAmount, isCardValue, parseDataPrevista, chiaveMovimento, dateNum };
