# FinFlow — demo

Portale finanziario di famiglia: entrate, uscite, categorie, bollette, saldo previsto e
confronto tra gli anni, in una pagina sola. Tema chiaro e scuro, utilizzabile da telefono.

**Tutti i dati di questa demo sono inventati.** La «famiglia Rossi», i negozi, gli stipendi e
gli importi sono generati da `tools/crea-demo.js`: non c'è nessun conto reale dietro.

## Avvio

Serve solo [Node.js](https://nodejs.org) 18 o successivo. Nessuna dipendenza da installare.

```bash
git clone https://github.com/LucaNitti/FinanceDashboard.git
cd FinanceDashboard
npm run demo
```

Poi apri <http://localhost:3100>.

Il comando crea la cartella `_site/` (il portale più un file `api/data` con i dati finti) e la
serve in locale. I dati vanno da gennaio di tre anni fa a oggi: rilanciando il comando un altro
giorno si aggiornano. Per usare un'altra porta:

```bash
node tools/crea-demo.js _site --serve 8080
```

Per creare solo la cartella statica, da pubblicare dove vuoi:

```bash
npm run build
```

## Cosa c'è dentro

| Sezione | Contenuto |
|---|---|
| Panoramica | mese in corso, saldo previsto a fine anno, voci da controllare, andamento dell'anno |
| Categorie | spese ed entrate per categoria, tabella categoria × mese, spese detraibili |
| Flusso | entrate e uscite mese per mese, per competenza o per cassa |
| Bollette | prossime bollette attese, media mensile, consumi di luce e gas |
| Anni | confronto tra gli anni e stagionalità |
| Periodo | un intervallo di date a scelta, confrontato con il periodo precedente |
| Dati | elenco dei movimenti con ricerca e filtri |

## Com'è fatto

- Nessuna dipendenza npm, nessun passaggio di build: JavaScript semplice in `public/js/`,
  grafici con Chart.js e caratteri serviti da `public/vendor/`.
- `tools/crea-demo.js` genera le righe di un foglio finto e le passa dagli stessi parser e
  dalle stesse analisi di `server.js` (abbonamenti, spese annuali, detraibili, previste).
- `server.js` e `lib/` sono il server del portale vero, che legge i movimenti da Google
  Sheets: qui servono solo per quei calcoli. La demo non contatta Google e non richiede
  credenziali; importazione e modifiche sono disattivate.

## Test

```bash
npm test
```

## Demo online (GitHub Pages)

`.github/workflows/demo.yml` rigenera e pubblica la demo a ogni push su `main` e ogni notte.
Va attivato una volta nel repository: **Settings → Pages → Source: GitHub Actions**.
