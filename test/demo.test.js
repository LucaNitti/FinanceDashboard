// Demo con dati inventati (tools/crea-demo.js): la risposta ha la forma di /api/data e i conti tornano.
const test = require('node:test');
const assert = require('node:assert');
const { creaDati } = require('../tools/crea-demo.js');

const OGGI = new Date(2026, 10, 10); // 10 novembre 2026

test('demo: quattro anni di movimenti, senza scrittura e marcata come demo', () => {
  const d = creaDati(OGGI);
  assert.deepStrictEqual(Object.keys(d.allData), ['2023', '2024', '2025', '2026']);
  assert.strictEqual(d.demo, true);
  assert.strictEqual(d.importa, false);
  assert.ok(d.allData['2025'].length > 300);
  assert.ok(d.bollette.length > 40 && d.consumi.length > 12);
  // Nessun movimento dopo oggi
  assert.ok(d.allData['2026'].every(r => { const [g, m] = r.date.split('/').map(Number); return m < 11 || (m === 11 && g <= 10); }));
});

test('demo: stessa data, stessi dati', () => {
  assert.deepStrictEqual(creaDati(OGGI), creaDati(OGGI));
});

test('demo: il saldo inserito coincide con quello calcolato dai movimenti (carta addebitata il mese dopo)', () => {
  const d = creaDati(OGGI);
  const mese = (y, m) => d.allData[y].filter(r => Number(r.date.split('/')[1]) === m);
  const somma = (l, f) => l.filter(f).reduce((s, r) => s + r.amount, 0);
  const set = d.saldo['2026'].find(s => s.mese === '30/09/2026').saldo;
  const ott = d.saldo['2026'].find(s => s.mese === '31/10/2026').saldo;
  const atteso = set + somma(mese('2026', 10), r => !r.card) + somma(mese('2026', 9), r => r.card);
  assert.ok(Math.abs(ott - atteso) < 0.05, `${ott} vs ${atteso}`);
});

test('demo: le analisi hanno qualcosa da mostrare', () => {
  const d = creaDati(OGGI);
  assert.ok(d.abbonamenti.length >= 1);
  assert.ok(d.annuali.some(a => /ASSICURAZIONE/.test(a.op)));
  assert.strictEqual(d.controlli['2026'].senzaCategoria.length, 1);
  assert.ok(d.previste['2026'].some(p => p.ricorrente && p.entrata));
  assert.ok(d.detraibili['2025'][0].totale > 0);
});
