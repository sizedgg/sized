/**
 * Der Verbindungstest von check.html.
 *
 * Er stand als <script type="module"> mitten in der Seite - und damit war
 * die Seite im Betrieb tot: die Content-Security-Policy erlaubt
 * script-src 'self', und ein Skript im Dokument ist nicht 'self'. Auf dem
 * eigenen Rechner faellt das nicht auf, dort liefert kein Server die
 * Kopfzeilen mit.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (s) => document.querySelector(s);
const ATTEMPTS = 5;

$('#meta').textContent = 'Target: ' + SUPABASE_URL;

/**
 * Show this device's public address.
 *
 * This isn't a gimmick, it's the core of the test: a phone on the same wifi
 * as the reference machine shows up on the outside under the same address.
 * Without this display, a green result could just as easily mean both
 * devices share an address - and the conclusion would be wrong.
 */
(async () => {
  for (const url of ['https://api.ipify.org?format=json', 'https://ipapi.co/json/']) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      if (j.ip) { $('#ip').textContent = j.ip; return; }
    } catch { /* next service */ }
  }
  $('#ip').textContent = 'could not be determined';
})();

/**
 * Open a single realtime connection.
 *
 * This is exactly where the error we're hunting shows up: if the connection
 * is refused, it happens at setup - before any login and before any
 * database query. That's why the public anon key is enough.
 *
 * For security reasons the browser won't reveal which HTTP status came back
 * on a failed WebSocket. But it does reveal whether the setup succeeded -
 * and that's all we need.
 */
function openOne(timeoutMs = 12000) {
  return new Promise((resolve) => {
    const url = SUPABASE_URL.replace(/^http/, 'ws')
      + '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPABASE_ANON_KEY) + '&vsn=1.0.0';
    const t0 = performance.now();
    let ws;
    const done = (ok, msg) => {
      clearTimeout(timer);
      try { ws && ws.close(); } catch { /* doesn't matter */ }
      resolve({ ok, msg, ms: Math.round(performance.now() - t0) });
    };
    const timer = setTimeout(() => done(false, 'Timed out'), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      done(false, 'Blocked: ' + e.message);
      return;
    }
    ws.onopen = () => done(true, 'Connected');
    ws.onerror = () => done(false, 'Refused');
    ws.onclose = (ev) => done(false, 'Closed before opening (code ' + ev.code + ')');
  });
}

$('#run').addEventListener('click', async () => {
  const btn = $('#run');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  $('#rows').innerHTML = '';
  setVerdict('', 'Checking…', `Opening ${ATTEMPTS} connections.`);

  let good = 0;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const r = await openOne();
    if (r.ok) good++;
    const row = document.createElement('div');
    row.className = 'row ' + (r.ok ? 'ok' : 'bad');
    row.innerHTML = `<span class="n">${i}</span>
      <span class="msg">${r.msg}</span><span class="ms">${r.ms} ms</span>`;
    $('#rows').appendChild(row);
  }

  if (good === ATTEMPTS) {
    setVerdict('ok', 'All ' + good + ' connected',
      'This device can reach the live chat normally.');
  } else if (good > 0) {
    setVerdict('bad', good + ' of ' + ATTEMPTS + ' connected',
      'Some connections were refused.');
  } else {
    setVerdict('bad', 'None connected',
      'Every connection from this device was refused.');
  }

  btn.disabled = false;
  btn.textContent = 'Run again';
});

function setVerdict(cls, big, sub) {
  const v = $('#verdict');
  v.className = 'verdict ' + cls;
  v.innerHTML = `<span class="big">${big}</span><span class="sub">${sub}</span>`;
}
