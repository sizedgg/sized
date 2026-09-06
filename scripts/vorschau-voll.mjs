// ============================================================================
// Wie Chat und DMs mit echtem Andrang aussehen.
//
// Der Zweck ist nicht "sieht huebsch aus", sondern: Was passiert, wenn die
// Listen voll sind? Leere Ansichten verzeihen alles. Erst bei fuenfundzwanzig
// Zeilen sieht man, ob die Betraege untereinander stehen, ob ein Zitat ueber
// mehrere Zeilen den Rhythmus zerreisst, und ob ein Posteingang mit vielen
// Gespraechen noch zu ueberblicken ist.
//
// Deshalb steht in den Daten unten ausdruecklich das Unangenehme und nicht das
// Vorzeigbare:
//
//   * Betraege ueber den ganzen Bereich – <$1 bis $12.4M –, damit man sieht,
//     ob die Spalte bei "$1.2K" und "$12.4M" gleich breit bleibt.
//   * Eine Nachricht ohne ein einziges Leerzeichen (ein langer Link), die
//     jede Spalte sprengt, die nicht umbrechen kann.
//   * Ein Zitat, das gekuerzt werden muss, und eines, dessen Original weg ist.
//   * Zwei Leute mit demselben Kuerzel "7xK" – genau der Fall, fuer den es die
//     vier Farbtoene ueberhaupt gibt.
//   * Eine sehr lange Nachricht, die entscheidet, ob eine Chatzeile noch als
//     Zeile liest oder zu einem Absatz mit einem Namen davor wird.
//   * Im Posteingang: ungelesene und gelesene Gespraeche gemischt, und ein
//     Gespraech, das ueber mehrere Tage laeuft – also mit Datumstrennern.
//
// Es wird nichts nachgebaut: Markup und Hilfsfunktionen kommen woertlich aus
// app.js, das Blatt aus styles.css, die Geruoste aus index.html.
//
// Erzeugt preview/voll-*.png
//   node scripts/vorschau-voll.mjs
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const stueck = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};

const zahlen = schneide('const nfCompact =', '/* Ausgeschrieben statt');
const kurz = schneide('const STUFEN =', '\n/**\n * Datumstrenner');
const tage = schneide('const tagBeginn =', 'const handleOf');
const namen = schneide('const handleOf =', '\nconst esc =');
const escFn = schneide('const esc = (s) =>', '\n\n');
const linkify = schneide('const LINK_MUSTER =', '\nfunction toast(');
const chatBau = schneide('const istAdmin =', '\nfunction appendMessage');
const dmBau = schneide('function dmQuoteHtml(row)', '\n// ------');
// Die Posteingangsliste woertlich statt nachgetippt. Beim ersten Versuch hatte
// ich die Zeile hier von Hand nachgebaut – und prompt standen "$86400" und
// "$0.4" darin statt "$86.4K" und "<$1", weil die echte Fassung fmtUsd benutzt
// und meine Abschrift nicht. Ein Vorschaubild, das das Produkt schlechter
// aussehen laesst, als es ist, ist genauso falsch wie eines, das es schoener
// macht.
const threadBau = schneide('function renderThreads()', '\nfunction dmQuoteHtml(row)');

const chatGeruest = stueck('<main id="pane-chat"', '</main>');
const dmGeruest = stueck('<main id="pane-dms"', '</main>');

// ---------------------------------------------------------------------------
// Die Daten. Absichtlich unbequem – siehe Kopf.
// ---------------------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  b: '7xK9zYxWvUtSrQpOnMlKjIhGfEdCbA1234567890abc',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
  e: 'Zm2nB4vC6xZ8lK0jH2gF4dS6aP8oI0uY2tR4eW6qA8s',
  f: 'Hf5gJ7kL9zX1cV3bN5mQ7wE9rT1yU3iO5pA7sD9fG1h',
  g: 'Pl4oK6iJ8uH0yG2tF4rD6eS8wA0qZ2xC4vB6nM8mL0k',
};
const std = (h) => Date.now() - h * 3600e3;
const min = (m) => Date.now() - m * 60_000;

const CHAT = [
  { id: 1, wallet: W.c, usd: 1240, body: 'gm', createdAt: std(6) },
  { id: 2, wallet: W.a, usd: 86400, body: 'is the gate still at $10 or did that change', createdAt: std(6) },
  { id: 3, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'still $10. read the pinned poll before asking again https://sized.gg/p/12', createdAt: std(5) },
  { id: 4, wallet: W.b, usd: 0.4, body: 'made it in with dust lol', createdAt: std(5) },
  { id: 5, wallet: W.d, usd: 3420, body: 'wen poll', createdAt: std(5) },
  { id: 6, wallet: W.e, usd: 214000, replyTo: 3,
    body: 'the pinned one is closed though, the new one is up now', createdAt: std(4) },
  { id: 7, wallet: W.f, usd: 9800, body: 'voted. ship it', createdAt: std(4) },
  { id: 8, wallet: W.g, usd: 47200, replyTo: 6,
    body: 'same, waiting on the audit feels like an excuse at this point', createdAt: std(4) },
  { id: 9, wallet: W.a, usd: 86400,
    body: 'https://explorer.example.com/tx/5KJhgFdsaPoiuytrewqLkjhgfdsaMnbvcxzQwertyuiopAsdfghjklZxcvbnm1234567890', createdAt: std(3) },
  { id: 10, wallet: W.c, usd: 1240, body: 'that link is dead for me', createdAt: std(3) },
  { id: 11, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'new poll is live. 24h. go', createdAt: std(3) },
  { id: 12, wallet: W.d, usd: 3420, replyTo: 11, body: 'done', createdAt: std(2) },
  { id: 13, wallet: W.e, usd: 214000, body: 'anyone else seeing the balance lag by a minute or two after buying', createdAt: std(2) },
  { id: 14, wallet: W.b, usd: 0.4, replyTo: 13, body: 'yeah it catches up', createdAt: std(2) },
  { id: 15, wallet: W.f, usd: 9800, replyTo: 999, body: 'this', createdAt: min(95) },
  { id: 16, wallet: W.g, usd: 47200, body: 'the download card looks clean on X btw', createdAt: min(80) },
  { id: 17, wallet: W.a, usd: 86400, body: 'agreed, posted mine this morning', createdAt: min(74) },
  { id: 18, wallet: W.c, usd: 1240,
    body: 'quick question — if i sell half do i lose the vote i already cast or does it just count for less', createdAt: min(52) },
  { id: 19, wallet: W.ansem, usd: 12400000, isAdmin: true, replyTo: 18,
    body: 'counts for less. weight follows the balance while the poll is open', createdAt: min(48) },
  { id: 20, wallet: W.d, usd: 3420, body: 'that is actually the best part of this', createdAt: min(40) },
  { id: 21, wallet: W.e, usd: 214000, body: 'ok', createdAt: min(31) },
  { id: 22, wallet: W.f, usd: 9800, body: 'how long until the next one', createdAt: min(22) },
  { id: 23, wallet: W.b, usd: 0.4, body: 'gm again', createdAt: min(12) },
  { id: 24, wallet: W.g, usd: 47200,
    body: 'longest message in here on purpose, because a wall of text is exactly the thing that decides whether a chat row still reads as a row or turns into a paragraph with a name stuck to the front of it', createdAt: min(6) },
  { id: 25, wallet: W.c, usd: 1240, body: 'fair', createdAt: min(2) },
];

const THREADS = [
  { wallet: W.a, usd: 86400, unread: 3, preview: 'can you look at the numbers i sent, the second one especially' },
  { wallet: W.e, usd: 214000, unread: 1, preview: 'thanks — one more thing' },
  { wallet: W.f, usd: 9800, unread: 2, preview: 'sent' },
  { wallet: W.g, usd: 47200, unread: 0, preview: 'sounds good, i will hold off until thursday then' },
  { wallet: W.d, usd: 3420, unread: 0, preview: 'appreciate it' },
  { wallet: W.c, usd: 1240, unread: 0, preview: 'is there a way to see who voted what or is that private' },
  { wallet: W.b, usd: 0.4, unread: 0, preview: 'ok' },
];

const DM = [
  { id: 1, from_admin: false, body: 'hey — congrats on the launch', created_at: std(52) },
  { id: 2, from_admin: true, body: 'thanks', created_at: std(51) },
  { id: 3, from_admin: false, body: 'quick one: is the token gate number final or are you still moving it around', created_at: std(50) },
  { id: 4, from_admin: true, reply_to: 3, body: 'final for now. i will say something in chat if it changes', created_at: std(50) },
  { id: 5, from_admin: false, body: 'perfect', created_at: std(28) },
  { id: 6, from_admin: false, body: 'sent you the numbers: https://sized.gg/p/12 and the second sheet is in there too', created_at: std(27) },
  { id: 7, from_admin: true, body: 'looking', created_at: std(26) },
  { id: 8, from_admin: false, reply_to: 7, body: 'no rush', created_at: std(26) },
  { id: 9, from_admin: true, body: 'the second one is the interesting part. where did the 40% come from', created_at: min(220) },
  { id: 10, from_admin: false, body: 'that is holders above the gate as a share of all holders, not of supply — i should have labelled it', created_at: min(210) },
  { id: 11, from_admin: true, body: 'right, that makes more sense', created_at: min(90) },
  { id: 12, from_admin: false, body: 'can you look at the numbers i sent, the second one especially', created_at: min(11) },
];

// ---------------------------------------------------------------------------
// Das Blatt steht hier in einem <style> und nicht als Datei – relative
// Adressen darin (Ansems Profilbild) zeigen deshalb auf die SEITE. Ohne diese
// zwei Zeilen laedt das Bild nicht, und die Vorschau zeigte einen leeren Kreis
// als waere das der Entwurf.
const server = http.createServer((q, res) => {
  const datei = path.join(root, 'public', decodeURIComponent(q.url.split('?')[0]));
  if (q.url !== '/' && datei.startsWith(path.join(root, 'public')) && fs.existsSync(datei)
      && fs.statSync(datei).isFile()) {
    const typ = datei.endsWith('.jpg') ? 'image/jpeg'
      : datei.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    return res.writeHead(200, { 'content-type': typ }).end(fs.readFileSync(datei));
  }
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">
         ${chatGeruest}${dmGeruest}
       </div>`);
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const grundgeruest = (admin) => `
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = {
    cfg: { symbol: 'ANSEM', admin_wallet: ${JSON.stringify(W.ansem)} },
    me: { isAdmin: ${admin}, wallet: ${JSON.stringify(admin ? W.ansem : W.a)} },
    live: new Map(), quoted: new Map(), filters: { usd: 0 },
    dmMessages: [], activeThread: ${JSON.stringify(W.a)}, dmRepliesAvailable: true,
  };
  const toast = () => {};
  ${escFn}
  ${zahlen}
  ${kurz}
  ${tage}
  ${namen}
  ${linkify}
  ${chatBau}
  ${dmBau}
  ${threadBau}
  const usdOf = (m) => m.usd;
  const passesFilter = () => true;
  window.msgHtml = msgHtml;
  window.dmListeHtml = dmListeHtml;
  window.renderThreads = renderThreads;
  window.state = state;`;

async function schuss(datei, breite, admin, aufbau) {
  const seite = await browser.newPage({
    viewport: { width: breite, height: breite < 500 ? 780 : 900 }, deviceScaleFactor: 2,
  });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({ content: grundgeruest(admin) });
  await seite.evaluate(aufbau, { CHAT, THREADS, DM, W });
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(350);
  await seite.locator('#app').screenshot({ path: path.join(ausgabe, datei) });
  await seite.close();
  console.log(`  ${path.join(ausgabe, datei)}`);
}

const chatAufbau = ({ CHAT }) => {
  document.querySelector('#pane-dms').hidden = true;
  document.querySelector('#pane-chat').hidden = false;
  // Die Zitate kommen aus derselben Quelle wie in der echten Seite.
  for (const m of CHAT) window.state.quoted.set(m.id, m);
  document.querySelector('#chat-list').innerHTML = CHAT.map(window.msgHtml).join('');
  document.querySelector('#chat-list').scrollTop = 1e6;
  const einheit = document.querySelector('#filter-unit');
  if (einheit) einheit.textContent = 'in $ANSEM';
};

const dmAufbau = ({ DM }) => {
  document.querySelector('#pane-chat').hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-admin').hidden = true;
  window.state.dmMessages = DM;
  document.querySelector('#dm-thread').innerHTML = window.dmListeHtml(DM);
  document.querySelector('#dm-thread').scrollTop = 1e6;
};

const posteingangAufbau = ({ DM, THREADS }) => {
  document.querySelector('#pane-chat').hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = true;
  document.querySelector('#dm-admin').hidden = false;
  window.state.dmMessages = DM;
  window.state.dmThreads = THREADS;
  // Die echte Funktion, nicht eine Abschrift davon.
  window.renderThreads();
  document.querySelector('#admin-thread').innerHTML = window.dmListeHtml(DM);
  document.querySelector('#admin-thread').scrollTop = 1e6;
  const kopf = document.querySelector('#admin-thread-who');
  if (kopf) kopf.textContent = THREADS[0].wallet.slice(0, 3);
};

await schuss('voll-chat.png', 900, false, chatAufbau);
await schuss('voll-chat-handy.png', 390, false, chatAufbau);
await schuss('voll-dm-nutzer.png', 900, false, dmAufbau);
await schuss('voll-dm-nutzer-handy.png', 390, false, dmAufbau);
await schuss('voll-dm-posteingang.png', 1100, true, posteingangAufbau);

await browser.close();
server.close();
