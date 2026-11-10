/* FinFlow — Client minimo per Google Sheets API v4, senza dipendenze.
   Due modi di accesso:
   - apiKey: solo lettura, il foglio deve essere leggibile da chi ha il link
   - serviceAccount (il JSON scaricato da Google Cloud): lettura e scrittura, il foglio va
     condiviso come Editor con l'indirizzo client_email dell'account di servizio.
   GOOGLE_SHEETS_URL e GOOGLE_TOKEN_URL cambiano gli indirizzi solo per i test (Google simulato). */
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const SHEETS_URL = () => process.env.GOOGLE_SHEETS_URL || 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TIMEOUT_MS = 20000;

/** Richiesta JSON con timeout. Rifiuta su HTTP ≥ 400 o risposta { error } di Google (err.status = codice HTTP). */
function request(targetUrl, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('http:') ? http : https;
    const req = lib.request(targetUrl, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json;
        try { json = data ? JSON.parse(data) : {}; }
        catch(e) { return reject(Object.assign(new Error(`HTTP ${res.statusCode}, JSON non valido: ${data.slice(0, 100)}`), { status: res.statusCode })); }
        if (res.statusCode >= 400 || json.error) {
          const err = json.error;
          const msg = (err && (err.message || err.error_description || (typeof err === 'string' ? err : ''))) || json.error_description || `HTTP ${res.statusCode}`;
          return reject(Object.assign(new Error(msg), { status: res.statusCode }));
        }
        resolve(json);
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout dopo ${TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Asserzione JWT firmata RS256 con la chiave dell'account di servizio (flusso OAuth "jwt-bearer"). */
function jwtAssertion(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL(), iat: nowSec, exp: nowSec + 3600 }));
  const firma = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${b64url(firma)}`;
}

const tokens = new Map(); // client_email → { value, exp }

/** Token di accesso, riusato finché mancano più di 5 minuti alla scadenza (dura un'ora). */
async function accessToken(sa) {
  const t = tokens.get(sa.client_email);
  if (t && t.exp - Date.now() > 5 * 60 * 1000) return t.value;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwtAssertion(sa) }).toString();
  const json = await request(TOKEN_URL(), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  });
  tokens.set(sa.client_email, { value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

/** Scheda inesistente: Google risponde 400 "Unable to parse range". */
function isMissingTab(e) {
  return e.status === 400 && /parse range/i.test(e.message);
}

/** Nome di scheda per un range A1: tra apici se contiene spazi o simboli. */
function tab(nome) {
  return /^[A-Za-z0-9_]+$/.test(nome) ? nome : `'${String(nome).replace(/'/g, "''")}'`;
}

/**
 * Client per un account: { apiKey } (solo lettura) o { serviceAccount } (lettura e scrittura;
 * se ci sono entrambi vince l'account di servizio). `puoScrivere` dice se le scritture sono possibili.
 */
function sheetsClient({ apiKey, serviceAccount } = {}) {
  const sa = serviceAccount && serviceAccount.client_email && serviceAccount.private_key ? serviceAccount : null;
  const call = async (path, { method = 'GET', query = {}, json, ritenta = true } = {}) => {
    const q = new URLSearchParams(query);
    const headers = {};
    if (sa) headers.Authorization = `Bearer ${await accessToken(sa)}`;
    else q.set('key', apiKey);
    let body = null;
    if (json !== undefined) { body = JSON.stringify(json); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    // Errori temporanei di Google (500 "Internal error", 503, 429 per la quota): fino a 3 tentativi.
    // Le scritture usate qui riscrivono le stesse celle: ripeterle non duplica dati (al più la
    // griglia si allunga di qualche riga vuota).
    for (let tentativo = 1; ; tentativo++) {
      try { return await request(`${SHEETS_URL()}/${path}?${q}`, { method, headers, body }); }
      catch (e) {
        if (!ritenta || tentativo >= 3 || !(e.status >= 500 || e.status === 429)) throw e;
        await new Promise(r => setTimeout(r, tentativo * 2000));
      }
    }
  };
  const range = (sheetId, r) => `${encodeURIComponent(sheetId)}/values/${encodeURIComponent(r)}`;

  return {
    puoScrivere: !!sa,
    email: sa ? sa.client_email : null,
    /** Righe di una scheda (valori formattati come nel foglio, colonne A:Z). */
    async get(sheetId, nome) {
      const json = await call(range(sheetId, `${tab(nome)}!A:Z`));
      return json.values || [];
    },
    /** Come get, ma una scheda mancante dà [] invece di un errore. */
    async getOptional(sheetId, nome) {
      try { return await this.get(sheetId, nome); }
      catch(e) { if (isMissingTab(e)) return []; throw e; }
    },
    /** Scrive celle sparse: data = [{ range: "dati!A5", values: [[...]] }]. USER_ENTERED: date e numeri come se scritti a mano. */
    update(sheetId, data) {
      return call(`${encodeURIComponent(sheetId)}/values:batchUpdate`, {
        method: 'POST', json: { valueInputOption: 'USER_ENTERED', data },
      });
    },
    /** Svuota i valori delle schede indicate (i formati restano). */
    svuota(sheetId, nomi) {
      return call(`${encodeURIComponent(sheetId)}/values:batchClear`, { method: 'POST', json: { ranges: nomi.map(n => `${tab(n)}!A:Z`) } });
    },
    /** Schede del file: [{ title, sheetId (numerico), rowCount }]. */
    async proprieta(sheetId) {
      const json = await call(encodeURIComponent(sheetId), { query: { fields: 'sheets.properties(title,sheetId,gridProperties.rowCount)' } });
      return (json.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId,
        rowCount: (s.properties.gridProperties || {}).rowCount || 0 }));
    },
    /** Nomi delle schede del file. */
    async schede(sheetId) {
      return (await this.proprieta(sheetId)).map(s => s.title);
    },
    /** Crea le schede che mancano. */
    async creaSchede(sheetId, nomi) {
      const esistenti = await this.schede(sheetId);
      const nuove = nomi.filter(n => !esistenti.includes(n));
      if (!nuove.length) return [];
      await call(`${encodeURIComponent(sheetId)}:batchUpdate`, {
        method: 'POST', json: { requests: nuove.map(title => ({ addSheet: { properties: { title } } })) },
      });
      return nuove;
    },
    /**
     * Elimina la riga `riga` (1 = la prima) della scheda; le righe sotto salgono di una.
     * Mai ripetuta in automatico: se Google avesse eseguito la prima richiesta, la seconda
     * cancellerebbe la riga successiva.
     */
    async eliminaRiga(sheetId, nome, riga) {
      const scheda = (await this.proprieta(sheetId)).find(s => s.title === nome);
      if (!scheda) throw new Error(`Scheda "${nome}" non trovata`);
      await call(`${encodeURIComponent(sheetId)}:batchUpdate`, { method: 'POST', ritenta: false, json: { requests: [
        { deleteDimension: { range: { sheetId: scheda.sheetId, dimension: 'ROWS', startIndex: riga - 1, endIndex: riga } } },
      ] } });
    },
    /**
     * Scrive `values` a partire dalla riga `primaRiga` (1 = la prima) della scheda, allargando la
     * griglia se serve. Niente "append": Google cerca da solo la fine della tabella e, con la prima
     * colonna vuota, inserisce le righe in mezzo. `formati` = [{ col (0-based), tipo: 'TEXT' |
     * 'DATE' | 'NUMBER', pattern }] viene applicato a quelle righe PRIMA di scrivere: una data
     * scritta in una cella in formato testo resterebbe testo.
     */
    async scriviRighe(sheetId, nome, primaRiga, values, formati = []) {
      if (!values.length) return;
      const scheda = (await this.proprieta(sheetId)).find(s => s.title === nome);
      if (!scheda) throw new Error(`Scheda "${nome}" non trovata`);
      const ultima = primaRiga + values.length - 1;
      const requests = [];
      if (ultima > scheda.rowCount) {
        requests.push({ appendDimension: { sheetId: scheda.sheetId, dimension: 'ROWS', length: ultima - scheda.rowCount } });
      }
      formati.forEach(f => requests.push({ repeatCell: {
        range: { sheetId: scheda.sheetId, startRowIndex: primaRiga - 1, endRowIndex: ultima, startColumnIndex: f.col, endColumnIndex: f.col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: f.tipo, ...(f.pattern ? { pattern: f.pattern } : {}) } } },
        fields: 'userEnteredFormat.numberFormat',
      } }));
      if (requests.length) await call(`${encodeURIComponent(sheetId)}:batchUpdate`, { method: 'POST', json: { requests } });
      for (let i = 0; i < values.length; i += 2000) {
        await this.update(sheetId, [{ range: `${tab(nome)}!A${primaRiga + i}`, values: values.slice(i, i + 2000) }]);
      }
    },
  };
}

/** Formati della scheda dati, dalle posizioni delle colonne: data GG/MM/AAAA in qualunque lingua del foglio. */
function formatiDati(col) {
  return [
    col.codice >= 0 && { col: col.codice, tipo: 'TEXT' },
    col.data >= 0 && { col: col.data, tipo: 'DATE', pattern: 'dd/mm/yyyy' },
    col.importo >= 0 && { col: col.importo, tipo: 'NUMBER', pattern: '0.00' },
  ].filter(Boolean);
}

/** Lettera di colonna da indice 0-based: 0 → A, 26 → AA. */
function colonna(i) {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

module.exports = { sheetsClient, request, jwtAssertion, isMissingTab, tab, colonna, formatiDati };
