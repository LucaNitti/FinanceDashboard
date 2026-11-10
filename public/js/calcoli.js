/* FinFlow — Calcoli puri: niente pagina, niente stato globale, la data di oggi arriva come parametro.
   Caricato come script classico (funzioni globali) e da Node per i test (test/calcoli.test.js). */

/**
 * Indici (0-11) dei mesi finiti dell'anno: tutti per gli anni passati, quelli prima del mese di
 * `now` per l'anno in corso, nessuno per gli anni futuri. Il mese in corso non è mai chiuso.
 */
function mesiChiusi(anno, now) {
  const a = parseInt(anno, 10), y = now.getFullYear();
  const n = a < y ? 12 : a > y ? 0 : now.getMonth();
  return [...Array(n).keys()];
}

/**
 * Riepilogo della differenza entrate − uscite sui mesi dati (di solito i mesi chiusi con movimenti):
 * { n, totale, media, positivi, migliore, peggiore } (migliore/peggiore = indice del mese, null se nessuno).
 */
function riepilogoMesi(inc, out, mesi) {
  const diff = i => (inc[i] || 0) - (out[i] || 0);
  const n = mesi.length;
  const totale = mesi.reduce((s, i) => s + diff(i), 0);
  return {
    n,
    totale,
    media: n ? totale / n : 0,
    positivi: mesi.filter(i => diff(i) > 0).length,
    migliore: n ? mesi.reduce((a, b) => diff(b) > diff(a) ? b : a) : null,
    peggiore: n ? mesi.reduce((a, b) => diff(b) < diff(a) ? b : a) : null
  };
}

/**
 * Tasso di risparmio in percentuale: (somma entrate − somma uscite) ÷ somma entrate sui mesi dati.
 * null se in quei mesi non ci sono entrate.
 */
function tassoRisparmio(inc, out, mesi) {
  const e = mesi.reduce((s, i) => s + (inc[i] || 0), 0);
  const u = mesi.reduce((s, i) => s + (out[i] || 0), 0);
  return e > 0 ? (e - u) / e * 100 : null;
}

/**
 * Media mensile di una categoria: somma dei suoi importi nei mesi dati ÷ numero di quei mesi
 * (anche quelli in cui la categoria non ha spese: una spesa saltuaria pesa per quanto pesa sul mese).
 */
function mediaCategoria(mensili, mesi) {
  return mesi.length ? mesi.reduce((s, i) => s + (mensili[i] || 0), 0) / mesi.length : 0;
}

/** Mediana di un elenco di numeri (null se vuoto): non risente dei valori eccezionali. */
function mediana(valori) {
  if (!valori.length) return null;
  const v = valori.slice().sort((a, b) => a - b), h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/**
 * Mesi su cui calcolare le medie mensili di un anno: i mesi chiusi con almeno un movimento.
 * Se non ce ne sono (gennaio dell'anno in corso) i mesi con movimenti, così una media c'è comunque.
 */
function mesiPerMedia(inc, out, anno, now) {
  const conDati = [...Array(12).keys()].filter(i => (inc[i] || 0) > 0 || (out[i] || 0) > 0);
  const chiusi = mesiChiusi(anno, now).filter(i => conDati.includes(i));
  return chiusi.length ? chiusi : conDati;
}

/**
 * Proiezione del saldo del conto mese per mese, dall'ultimo saldo inserito
 * (ultimo = { monthIdx, saldo }) fino all'ultimo mese con previste aperte.
 * mov = { inc, out, card }: movimenti già registrati per mese (card = spese con carta, che escono
 * dal conto il mese dopo). previste = [{ mese, importo, entrata, stimata, open }]: contano solo le
 * aperte; con conSpeseMedie = false le stimate (spese medie) sono ignorate.
 * Ogni punto ha le righe del mese: v = saldo di partenza + somma di (registrati + entrate − voci −
 * medie − addebito) fino a quel mese, arrotondato. [] se non c'è nulla da proiettare.
 */
function proiezioneSaldo(ultimo, mov, previste, conSpeseMedie) {
  const voci = previste.filter(p => p.open && (conSpeseMedie || !p.stimata));
  const uscite = Array(12).fill(0), entrate = Array(12).fill(0);
  voci.forEach(p => { (p.entrata ? entrate : uscite)[p.mese] += p.importo; });
  const fine = uscite.reduce((L, v, i) => v > 0 || entrate[i] > 0 ? i : L, -1);
  if (fine <= ultimo.monthIdx) return [];
  let saldo = ultimo.saldo;
  const punti = [];
  for (let m = ultimo.monthIdx + 1; m <= fine; m++) {
    const r = { monthIdx: m, registrati: (mov.inc[m] || 0) - ((mov.out[m] || 0) - (mov.card[m] || 0)),
      addebito: mov.card[m - 1] || 0, entrate: 0, voci: 0, medie: 0, nVoci: 0 };
    voci.forEach(p => {
      if (p.mese !== m) return;
      if (p.entrata) r.entrate += p.importo;
      else if (p.stimata) r.medie += p.importo;
      else r.voci += p.importo;
      if (!p.stimata) r.nVoci++;
    });
    saldo += r.registrati + r.entrate - r.voci - r.medie - r.addebito;
    r.v = Math.round(saldo);
    punti.push(r);
  }
  return punti;
}

/**
 * Le righe della proiezione sommate dal primo punto fino al mese `fino` compreso:
 * { registrati, entrate, voci, medie, addebito, nVoci, addebitoDi: [mesi della carta addebitata] }.
 */
function righeSaldoPrevisto(punti, fino) {
  const c = { registrati: 0, entrate: 0, voci: 0, medie: 0, addebito: 0, nVoci: 0, addebitoDi: [] };
  punti.filter(p => p.monthIdx <= fino).forEach(p => {
    ['registrati', 'entrate', 'voci', 'medie', 'addebito', 'nVoci'].forEach(k => { c[k] += p[k]; });
    if (p.addebito > 0) c.addebitoDi.push(p.monthIdx - 1);
  });
  return c;
}

if (typeof module !== 'undefined') module.exports = { mesiChiusi, mesiPerMedia, mediana, riepilogoMesi, tassoRisparmio, mediaCategoria, proiezioneSaldo, righeSaldoPrevisto };
