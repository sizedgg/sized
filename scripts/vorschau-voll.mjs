// ============================================================================
// What chat and DMs look like under real load.
//
// The point isn't "looks nice", it's: what happens when the lists are
// full? Empty views forgive everything. Only at twenty-five rows do you
// see whether the amounts line up in a column, whether a quote spanning
// several lines tears up the rhythm, and whether an inbox with many
// conversations is still easy to scan.
//
// So the data below deliberately includes the awkward stuff, not the
// presentable stuff:
//
//   * Amounts across the whole range - <$1 to $12.4M - so you can see
//     whether the column stays the same width at "$1.2K" and "$12.4M".
//   * A message with not a single space in it (a long link), which
//     breaks any column that can't wrap.
//   * A quote that has to be truncated, and one whose original is gone.
//   * Two people with the same handle "7xK" - exactly the case the four
//     color tones exist for in the first place.
//   * A very long message that decides whether a chat row still reads as
//     a row or turns into a paragraph with a name stuck in front of it.
//   * In the inbox: unread and read conversations mixed together, and a
//     conversation that spans several days - so it needs date separators.
//
// Nothing is rebuilt by hand: markup and helper functions come verbatim
// from app.js, the sheet from styles.css, the scaffolding from index.html.
//
// Generates preview/voll-*.png
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

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const piece = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};

const numbers = cut('const nfCompact =', 'const nfGanz = new Intl.NumberFormat(\'en-US\', { maximumFractionDigits: 0 });');
const short = cut('const TIERS =', 'const tagBeginn = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();');
const tage = cut('const tagBeginn =', 'const handleOf');
const namen = cut('const handleOf =', '\nconst esc =');
const escFn = cut('const esc = (s) =>', '\n\n');
const linkify = cut('const LINK_MUSTER =', '\nfunction toast(');
const chatBau = cut('const istAdmin =', '\nfunction appendMessage');
const dmBau = cut('function dmQuoteHtml(row)', '\n// ------');
// The inbox list verbatim instead of retyped. On the first attempt I
// rebuilt this row by hand - and sure enough it showed "$86400" and "$0.4"
// instead of "$86.4K" and "<$1", because the real version uses fmtUsd and
// my copy didn't. A preview image that makes the product look worse than
// it is, is just as wrong as one that makes it look better.
const threadBau = cut('function renderThreads()', '\nfunction dmQuoteHtml(row)');

const chatScaffold = piece('<main id="pane-chat"', '</main>');
const dmScaffold = piece('<main id="pane-dms"', '</main>');

// ---------------------------------------------------------------------------
// The data. Deliberately uncomfortable - see the header above.
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
// The sheet sits here in a <style> tag and not as a file - relative
// addresses inside it (Ansem's profile picture) therefore point at the
// SITE. Without these two lines the image wouldn't load, and the preview
// would show an empty circle as if that were the design.
const server = http.createServer((q, res) => {
  const file = path.join(root, 'public', decodeURIComponent(q.url.split('?')[0]));
  if (q.url !== '/' && file.startsWith(path.join(root, 'public')) && fs.existsSync(file)
      && fs.statSync(file).isFile()) {
    const typ = file.endsWith('.jpg') ? 'image/jpeg'
      : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    return res.writeHead(200, { 'content-type': typ }).end(fs.readFileSync(file));
  }
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">
         ${chatScaffold}${dmScaffold}
       </div>`);
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const baseScaffold = (admin) => `
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
  ${numbers}
  ${short}
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

async function shoot(file, width, admin, aufbau) {
  const page = await browser.newPage({
    viewport: { width: width, height: width < 500 ? 780 : 900 }, deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: baseScaffold(admin) });
  await page.evaluate(aufbau, { CHAT, THREADS, DM, W });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await page.locator('#app').screenshot({ path: path.join(ausgabe, file) });
  await page.close();
  console.log(`  ${path.join(ausgabe, file)}`);
}

const chatAufbau = ({ CHAT }) => {
  document.querySelector('#pane-dms').hidden = true;
  document.querySelector('#pane-chat').hidden = false;
  // The quotes come from the same source as on the real site.
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

const inboxSetup = ({ DM, THREADS }) => {
  document.querySelector('#pane-chat').hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = true;
  document.querySelector('#dm-admin').hidden = false;
  window.state.dmMessages = DM;
  window.state.dmThreads = THREADS;
  // The real function, not a transcription of it.
  window.renderThreads();
  document.querySelector('#admin-thread').innerHTML = window.dmListeHtml(DM);
  document.querySelector('#admin-thread').scrollTop = 1e6;
  const header = document.querySelector('#admin-thread-who');
  if (header) header.textContent = THREADS[0].wallet.slice(0, 3);
};

await shoot('voll-chat.png', 900, false, chatAufbau);
await shoot('voll-chat-handy.png', 390, false, chatAufbau);
await shoot('voll-dm-nutzer.png', 900, false, dmAufbau);
await shoot('voll-dm-nutzer-handy.png', 390, false, dmAufbau);
await shoot('voll-dm-posteingang.png', 1100, true, inboxSetup);

await browser.close();
server.close();
