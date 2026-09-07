// ============================================================================
// Five images for the post on X
//
//   1  a running poll, from a user's point of view
//   2  the conversation with Ansem, from a user's point of view
//   3  Ansem's inbox, sorted by holdings
//   4  Ansem creates a poll
//   5  the login: an exact amount to an address
//
// ----------------------------------------------------------------------------
// Why this is not an image editor
//
// The images are produced from the REAL index.html, the real styles.css,
// and the real drawing functions from app.js. None of it is reconstructed.
//
// That matters more for promotional images than for a preview meant just
// for us: a reconstructed image shows what someone wishes were true.
// Whoever sees it signs up and finds something else. That cannot happen
// here - if the interface changes, these images change with it on the
// next run, and if a function disappears, the cutting fails.
//
// ----------------------------------------------------------------------------
// About the sample texts
//
// The messages are invented, and they have to be - there are no real ones
// yet. They are therefore deliberately chosen not to put words in Ansem's
// mouth: no opinion, no promise, no statement about the market. Just the
// kind of sentence that shows what the interface is for.
//
//   node scripts/vorschau-post.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};

// The real drawing functions, verbatim from app.js.
const CODE = [
  cut('const esc = (s) =>', '\n\n'),
  cut('const nfGanz =', 'const wholeNumber'),
  cut('const wholeNumber =', '\n'),
  cut('const fmtTime =', '\n'),
  cut('const TIERS =', '\n'),
  cut('function shortUsd(', '\n}') + '\n}',
  cut('const handleOf =', '\n'),
  cut('const HANDLE_TONES', '\n'),
  cut('function toneOf(wallet) {', '\n}') + '\n}',
  cut('const LINK_MUSTER =', '\n'),
  cut('function withLinks(text) {', '\n}') + '\n}',
  cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;'),
  cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;'),
  cut('const BALD_MS =', 'let fristT = null;'),
  cut('const leadingShare =', '\nasync function drawPoll'),
  cut('function pollHtml(p) {', 'async function deletePoll(id) {'),
  cut('function dmQuoteHtml(row) {', '\n}') + '\n}',
  cut('function dmHtml(row) {', '\n}') + '\n}',
  cut('const STRICH_MAX =', '\n'),
  cut('const STRICH_MIN =', '\n'),
  cut('function renderThreads() {', '\n}\n') + '\n}',
  // Helpers declared with const/let stay in eval's own scope and are not
  // visible from outside; ones declared with function are. The handful
  // that the setups below need are therefore explicitly handed out - the
  // real ones, not copied out by hand.
  'window.handleOf = handleOf; window.esc = esc; window.fullUsd = fullUsd;',
].join('\n\n');

// ---------------------------------------------------------------------------
// The sample data
// ---------------------------------------------------------------------------

const POLLS = [
  { id: 1, closed: false, myOptionId: 2, totalUsd: 1284000,
    closesAt: new Date(Date.now() + 19 * 3600e3).toISOString(),
    question: 'Which chain should we cover next?',
    options: [
      { id: 1, label: 'Base', usd: 214000, share: 0.167 },
      { id: 2, label: 'Hyperliquid', usd: 731000, share: 0.569 },
      { id: 3, label: 'Stay Solana only', usd: 339000, share: 0.264 },
    ] },
  // Closed. Only then does pollHtml highlight the leading option - before
  // that it would be a forecast that influences the outcome: whoever sees
  // what is currently leading votes differently.
  { id: 2, closed: true, myOptionId: 4, totalUsd: 486500, closesAt: null,
    question: 'Next AMA time?',
    options: [
      { id: 4, label: 'Friday 8pm ET', usd: 301200, share: 0.619 },
      { id: 5, label: 'Sunday 2pm ET', usd: 185300, share: 0.381 },
    ] },
];

// Kept neutral - see the note above.
const CONVERSATION = [
  { id: 1, from_admin: false, reply_to: null, created_at: heute(8, 41),
    body: 'gm' },
  { id: 2, from_admin: false, reply_to: null, created_at: heute(8, 42),
    body: 'holding since june, never sold a single one' },
  { id: 3, from_admin: true, reply_to: null, created_at: heute(9, 2),
    body: 'gm' },
  { id: 4, from_admin: false, reply_to: null, created_at: heute(9, 4),
    body: 'would love a longer format on market structure. the threads are good but they end where it gets interesting' },
  { id: 5, from_admin: true, reply_to: null, created_at: heute(9, 12),
    body: 'how long are you thinking' },
  { id: 6, from_admin: false, reply_to: null, created_at: heute(9, 13),
    body: 'an hour, once a month' },
  { id: 7, from_admin: false, reply_to: null, created_at: heute(9, 14),
    body: 'even recorded is fine, does not have to be live' },
  { id: 8, from_admin: true, reply_to: null, created_at: heute(9, 31),
    body: 'noted. put it in the next poll' },
  { id: 9, from_admin: false, reply_to: null, created_at: heute(9, 32),
    body: 'appreciate it' },
  { id: 10, from_admin: false, reply_to: null, created_at: heute(9, 33),
    body: 'and thanks for actually reading these' },
];
function heute(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// A full inbox. The list is sorted by holdings, and that is exactly what
// the image is meant to show: the largest holders at the top, the smaller
// ones below, and the column stretching across the whole screen.
//
// The addresses are invented. Putting real holder addresses in a
// promotional image would mean publishing other people's balances - and
// they never chose that.
const INBOX = [
  // wallet, $ balance, last message, unread, from Ansem?
  ['7xKm9QpLvRt2sYwE4nBc6HjA1dFgZuVmTqXrPyNb3Ks', 2840000, 'longer format on market structure would be great', 3, false],
  ['Kd2Vn8XwPq5LzTc7HyBf3RjE9aUmGtVrZoXbM1Ns6Jp', 1190000, 'the last poll flipped in the final hour', 2, false],
  ['Hs7QvNmK4dGbXe2LpRcTfZaU9wYjB6xM1noAiEuS3rVt', 812000, 'will look at it', 0, true],
  ['Bq4Nz7VtLmXs9WcHy2RfEd6KjP1aUgTvZnQrYbM5Jx8', 604500, 'sent you the numbers from last quarter', 4, false],
  ['Wf5Tj1KcRb8NxMz3VqHd7LpA2eUsGmYtZoXnPr9Bk4', 478000, 'friday, yes', 0, true],
  ['Ms3Yd8FkQwLp5TvNc7HxBz2RjE9aUmGtVrZoXbP1Kn6', 341000, 'when is the next one', 2, false],
  ['Ln7Rq2WbKt4XyPz9HcVf6MdJ3aEsUgTvZoXnYrB8Km5', 276400, 'added more this morning', 1, false],
  ['Zp8Vc3NkWq6LxTy1HbRf9MdJ4aEsUgTvOnXrYmB2Kt7', 219800, 'noted', 0, true],
  ['Gt1Xb6MnKw9LzPc4HyRf2VdJ7aEsUqTvZoXnYrB5Km3', 168000, 'first poll i ever voted in', 1, false],
  ['Ct6Wg1PbNxKm4RzVy8HfLd3JqA7eUsTvZoXnYrM9Bk2', 124500, 'welcome', 0, true],
  ['Hj9Kz4VbNq7LxWc2TyRf5MdP1aEsUgOvZnXrYmB6Kt8', 96700, 'how does the vote weight work', 2, false],
  ['Yr2Bn5KwQt8LzXc6HyVf1MdJ9aEsUgTpZoXnRmB4Kk7', 71300, 'in since last week', 1, false],
  ['Dv4Mk7RbQn1LzXc9HyWf6TdJ2aEsUgOpZoXnYmB3Kt5', 54900, 'can i change my vote', 1, false],
  ['Nq6Pt3XbKw2LzMc8HyRf4VdJ5aEsUgTiZoXnYmB7Kr1', 38200, 'gm', 0, true],
  ['Ux8Lb1KnWq5LzTc3HyVf7MdJ6aEsUgOpZoXnYrB9Km2', 21600, 'holding, not selling', 1, false],
// The field names are the ones from loadThreads: preview and
// last_from_admin. Here they were first called last_body, and the preview
// line stayed empty as a result - no error, no hint. Exactly the kind of
// spot where a reconstructed image starts showing something other than
// the site.
//
// Which line came from Ansem is set per row and not computed: it first
// said "every fourth one", and then it read "You: when is the next one" -
// Ansem asking his own people when the next one is.
].map(([wallet, usd, preview, unread, last_from_admin], i) => ({
  wallet, usd, preview, unread, last_from_admin, hidden: false,
  last_at: heute(9 - Math.floor(i / 2), 55 - (i % 2) * 20),
}));

// ---------------------------------------------------------------------------

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(pub, pfad);
  if (!file.startsWith(pub) || !fs.existsSync(file)) return res.writeHead(404).end('');
  // app.js stays empty: the preview sets the state itself, otherwise the
  // script starts the login flow and hides everything again.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

/**
 * One image.
 *
 * @param name    filename without extension
 * @param geraet  image dimensions
 * @param aufbau  runs INSIDE the browser, with the real functions in reach
 */
async function bild(name, geraet, aufbau, daten = {}) {
  const page = await browser.newPage({
    viewport: { width: geraet.w, height: geraet.h },
    deviceScaleFactor: geraet.dpr ?? 2,
    isMobile: geraet.w < 800, hasTouch: geraet.w < 800,
  });
  await page.goto(base, { waitUntil: 'load' });
  const setUp = () => page.evaluate(({ code, build, d }) => {
    const $ = (s, w = document) => w.querySelector(s);
    const $$ = (s, w = document) => [...w.querySelectorAll(s)];
    window.$ = $; window.$$ = $$;
    window.state = {
      cfg: { symbol: 'ANSEM', min_dm_usd: 1000 },
      me: { isAdmin: false, wallet: '' },
      dmThreads: [], dmMessages: [], dmMinEntwurf: null,
      dmHideAvailable: true, zeigeVerborgene: false, dmRepliesAvailable: true,
    };
    // eslint-disable-next-line no-eval
    (0, eval)(code);
    $('#login').hidden = true;
    $('#app').hidden = false;
    $$('.pane').forEach((p) => { p.hidden = true; });
    // eslint-disable-next-line no-new-func
    new Function('d', build)(d);
  }, { code: CODE, build: aufbau, d: daten });

  await setUp();

  // Crop to the content.
  // ---------------------------------------------------------------------------
  // A screenshot at full device height is honest, but in the post there
  // would then be a third of black area below it - and in a timeline
  // every image gets scaled to the same width, so the empty third gets
  // scaled along with it. So instead it measures where the content ends,
  // sets the height to that, and rebuilds: the page is a flex stack at
  // full height, merely shrinking it would wrap it instead of cropping it.
  if (geraet.zuschneiden !== false) {
    const needed = await page.evaluate((wahl) => {
      const parts = [...document.querySelectorAll(wahl)];
      if (!parts.length) return null;
      const bottom = Math.max(...parts.map((e) => e.getBoundingClientRect().bottom));
      return Math.ceil(bottom + 24);
    }, geraet.measure ?? '.pane > *:not([hidden]) > *:not([hidden])');
    // In BOTH directions. It first only ever shrank, and that created a
    // bug instead of fixing one: in Ansem's view there are two polls below
    // the form, together taller than the screen - the second one got cut
    // off at the bottom, and in the image it looked like it was missing.
    // Capped upward too, or a screenshot would eventually turn into a scroll.
    const height = Math.min(Math.max(needed ?? geraet.h, 320), geraet.maxH ?? 1400);
    if (needed && height !== geraet.h) {
      await page.setViewportSize({ width: geraet.w, height: height });
      await setUp();
    }
  }

  const file = path.join(root, 'preview', `post-${name}.png`);
  await page.screenshot({ path: file });
  const { width, height } = page.viewportSize();
  await page.close();
  console.log(`  ${path.relative(root, file).padEnd(26)} ${width}x${height}`);
}

console.log('\nFive images for the post\n');

// 1 - running poll, user view
await bild('1-poll', { w: 1280, h: 800, dpr: 2 }, `
  $('#pane-polls').hidden = false;
  $('#poll-admin').hidden = true;
  $('#poll-list').innerHTML = d.polls.map(pollHtml).join('');
`, { polls: POLLS });

// 2 - conversation with Ansem, user view
await bild('2-dm', { w: 1280, h: 800, dpr: 2, zuschneiden: false }, `
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'dms'));
  $('#pane-dms').hidden = false;
  $('#dm-user').hidden = false;
  $('#dm-thread').innerHTML = d.rows.map(dmHtml).join('');
  $('#dm-thread').scrollTop = 1e6;
`, { rows: CONVERSATION });

// 3 - Ansem's inbox
await bild('3-inbox', { w: 1280, h: 800, dpr: 2, zuschneiden: false }, `
  state.me.isAdmin = true;
  state.dmThreads = d.threads;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'dms'));
  $('#pane-dms').hidden = false;
  $('#dm-user').hidden = true;
  $('#dm-admin').hidden = false;
  renderThreads();
  $('#dm-min-input').value = '1,000';
  $('#dm-min-unit').textContent = 'in $ANSEM';

  // An open conversation alongside it. Without this, "Select a thread"
  // shows on the right and half the image is empty - in production Ansem
  // sees the conversation he just tapped there.
  const peek = d.threads[0];
  $$('#thread-items .thread').forEach((b, i) => b.classList.toggle('is-active', i === 0));
  $('#thread-title').classList.remove('dim');
  $('#thread-title').innerHTML =
    '<strong class="h t' + toneOf(peek.wallet) + '">' + handleOf(peek.wallet) + '</strong>'
    + '<span class="addr dim">' + peek.wallet + '</span>';
  $('#admin-thread').innerHTML = d.rows.map(dmHtml).join('');
  $('#admin-dm-form').hidden = false;
  $('#btn-hide-thread').hidden = false;
`, { threads: INBOX, rows: CONVERSATION });

// 4 - Ansem creates a poll
await bild('4-neu', { w: 1280, h: 800, dpr: 2 }, `
  state.me.isAdmin = true;
  $('#pane-polls').hidden = false;
  $('#poll-admin').hidden = false;
  $('#poll-admin-felder').hidden = false;
  $('#btn-poll-neu')?.setAttribute('aria-expanded', 'true');
  // A DIFFERENT question from the one already running below: showing the
  // same one twice would be an error everyone would see in the image.
  // This one comes from the conversation in image 2 - "put it in the next poll".
  $('#poll-question').value = 'Monthly AMA, one hour?';
  // The sheet has two option fields; a third one gets created in
  // production by the "+ Option" button. Here the second one is cloned -
  // the actual element, not a reconstructed one.
  const panel = $('#poll-options');
  while (panel.children.length < 3) {
    panel.append(panel.lastElementChild.cloneNode(true));
  }
  const fields = $$('#poll-options input');
  ['Yes, recorded is fine', 'Yes, but live', 'Not interested'].forEach((t, i) => {
    if (fields[i]) fields[i].value = t;
  });
  $('#poll-list').innerHTML = d.polls.map(pollHtml).join('');
`, {
  // Without myOptionId: in Ansem's view a checkmark would otherwise sit
  // on an option while a line above reads "you do not vote in your own
  // polls". The database rejects his vote anyway - it certainly must not
  // show up in the image.
  // Both: the running one and the closed one. Ansem's view should also
  // include a closed poll, so the blue bar is visible.
  polls: POLLS.map((p) => ({ ...p, myOptionId: null })),
});

// 5 - the login
// ---------------------------------------------------------------------------
// The step that sets SIZED apart from everything else: no wallet connect,
// but sending an exact amount to an address. The final decimal places are
// the identifier.
//
// The amount is genuinely computed, not made up: the same formula as in
// verify (base_lamports plus a multiple of 1,000 lamports), so the image
// does not show a number that could never actually occur.
const LAMPORTS = 2_000_000 + 437 * 1_000;
// Tighter than the others: the card is only 520 px wide and sits centered
// - at full desktop height the image would be two thirds empty.
await bild('5-login', { w: 1280, h: 470, dpr: 2, zuschneiden: false }, `
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#step-install').hidden = true;
  $('#step-address').hidden = true;
  $('#step-pay').hidden = false;
  $('#pay-amount').textContent = d.amount + ' SOL';
  $('#pay-treasury').textContent = d.adresse;
  $('#pay-timer').textContent = '· 21m left';
`, {
  amount: (LAMPORTS / 1e9).toFixed(6),
  // A made-up address in the right format: 44 characters from the Base58
  // alphabet, like a real Solana address. It belongs to nobody - there is
  // no key for this pattern, and anyone who sends something there from
  // the image loses it. But that holds for ANY address in a promotional
  // image, even the real treasury: the amount there matches no challenge.
  adresse: 'MASi45ub7Qe4ZE36UT5G6cU4ud8Fhhe4deS4F3cw9KTA',
});

await browser.close();
server.close();
console.log('');
