/* FinFlow — Service worker: l'app si apre anche a server spento, con l'ultima copia vista.
   Sempre prima la rete (il server manda tutto no-store e si aggiorna da solo da GitHub):
   la copia salvata serve solo quando il server non risponde. Registrato da main.js, solo
   in contesto sicuro (HTTPS o localhost). Lo scope è la cartella del file (BASE_PATH/). */
const CACHE = 'finflow-v2';
const SHELL = [
  './', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'vendor/chart.umd.js', 'vendor/hanken-grotesk-latin.woff2', 'vendor/newsreader-latin.woff2',
  'js/state.js', 'js/calcoli.js', 'js/helpers.js', 'js/overview.js', 'js/categorie.js', 'js/andamento.js',
  'js/bollette.js', 'js/anni.js', 'js/periodo.js', 'js/dati.js', 'js/controlli.js', 'js/detraibili.js', 'js/importa.js', 'js/modifica.js', 'js/main.js',
];
// Oltre questi tempi senza risposta si usa la copia: fuori casa l'IP del server non risponde
// affatto e il browser aspetterebbe minuti. /api/data può metterci qualche secondo (download
// da Google), quindi ha più margine; la risposta arrivata in ritardo aggiorna comunque la copia.
const TIMEOUT_FILE_MS = 4000;
const TIMEOUT_API_MS = 12000;

const scoped = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Rete con timeout; se la rete fallisce o tarda, la copia salvata sotto `key` (se c'è). */
async function networkFirst(request, key, timeoutMs, fallback) {
  const cache = await caches.open(CACHE);
  const net = fetch(request).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  net.catch(() => {}); // se ha già risposto la copia, un errore di rete tardivo non va segnalato
  const saved = () => cache.match(key).then(r => (r && fallback ? fallback(r) : r));
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => saved().then(resolve), timeoutMs); });
  try {
    const res = await Promise.race([net, late]);
    if (res) return res;
    return await net; // nessuna copia: si aspetta comunque la rete
  } catch (e) {
    const r = await saved();
    if (r) return r;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Copia di /api/data marcata offline, così la pagina lo dice accanto al pulsante Aggiorna. */
async function markOffline(res) {
  const data = await res.json();
  return new Response(JSON.stringify({ ...data, offline: true, fromCache: true }), { headers: { 'Content-Type': 'application/json' } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return;

  // Aggiorna dati: va sempre in rete; la risposta buona diventa la copia di /api/data
  if (req.method === 'POST' && url.pathname.endsWith('/api/refresh')) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(scoped('api/data'), copy)); }
      return res;
    }));
    return;
  }
  if (req.method !== 'GET') return;

  if (url.pathname.endsWith('/api/data')) {
    e.respondWith(networkFirst(req, scoped('api/data'), TIMEOUT_API_MS, markOffline));
  } else if (url.pathname.includes('/api/')) {
    return; // /api/status e simili: solo rete
  } else if (req.mode === 'navigate') {
    // Qualunque pagina del portale è index.html (il server fa lo stesso per i percorsi sconosciuti)
    e.respondWith(networkFirst(req, scoped('./'), TIMEOUT_FILE_MS));
  } else {
    e.respondWith(networkFirst(req, url.href.split('?')[0], TIMEOUT_FILE_MS));
  }
});
