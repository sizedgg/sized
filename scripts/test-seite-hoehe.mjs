// ============================================================================
// The page itself never scrolls. Scrolling happens INSIDE the lists.
//
// ----------------------------------------------------------------------------
// The bug that triggered this test
//
// The page has text that exists only for screen readers and is hidden from
// sight - Ansem's three characters under his profile picture, the
// " — your vote" after an answer. All of them sit under the same rule:
//
//   position: absolute; width: 1px; height: 1px;
//   overflow: hidden; clip-path: inset(50%);
//
// That's the usual pattern for this, and it has a condition that's written
// nowhere: the parent element has to be positioned. Otherwise position:
// absolute picks the whole document as its reference - and the element ends
// up not "1 px inside the list" but 1 px at the spot it would occupy in the
// UNSCROLLED flow. With forty entries that's over a thousand pixels below
// the window, and the document grows to match exactly that.
//
// It wasn't visible as a shifted element - you never see these spans
// anyway - it showed up as: "when I scroll, the whole page scrolls up."
// The wheel slid past the end of the list onto the document and pushed the
// whole app out of frame. Measured: a 1493 px document inside a 738 px
// window. It happened back then in chat; chat is gone now, but the rule and
// its trap are still here.
//
// ----------------------------------------------------------------------------
// Why this test measures the DOCUMENT HEIGHT and not the rule
//
// You could check that .opt-label carries position: relative. That catches
// exactly this one case and no other. But the claim that actually matters
// is about the whole page: it's as tall as the window, never taller.
// Anything that makes it taller - an absolutely positioned element with no
// reference, an image that's too wide, a margin that overhangs at the
// bottom - shows up here, no matter what caused it.
//
// Checked against the REAL index.html and the real stylesheet, in both
// tabs, with full lists and once at phone width.
//
//   node scripts/test-seite-hoehe.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');

// A real little file server instead of an assembled page: the question
// hinges on the height of the whole document, and that only comes out
// right when index.html, styles.css, and the images load the way they do
// in production.
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(publicDir, pfad);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// The lists get filled with markup that matches the real shape - including
// the hidden handles, since those were exactly the problem. What matters is
// the VOLUME: with five rows nothing stands out, because the unscrolled
// flow is then barely longer than the window.
const AUFBAU = {
  Polls: (n) => `document.querySelector('#pane-polls').hidden = false;
    document.querySelector('#poll-list').innerHTML = Array.from({ length: ${n} }, (_, i) =>
      \`<article class="poll"><div class="poll-head"><h4>Frage \${i}</h4></div>
        <div class="poll-meta">120 votes</div>
        <div class="opt mine"><div class="opt-bar"><div class="opt-fill" style="width:60%"></div>
          <div class="opt-text"><span class="opt-label">Antwort
            <span class="nur-vorlesen"> — your vote</span></span>
            <span class="opt-num"><span class="held">$1</span>
            <span class="votes">1 vote</span></span></div></div></div>
      </article>\`).join('');
    document.querySelector('#poll-list').scrollTop = 1e6;`,

  DMs: (n) => `document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-thread').innerHTML = Array.from({ length: ${n} }, (_, i) =>
      \`<div class="dm-row \${i % 2 ? 'mine' : ''}"><div class="dm-block">
        <div class="msg dm \${i % 2 ? 'mine' : ''}"><span class="body">nachricht \${i}</span>
        <span class="meta"><span class="time">19:0\${i % 10}</span></span></div>
      </div></div>\`).join('');
    document.querySelector('#dm-thread').scrollTop = 1e6;`,
};

const measure = async (tab, width, height, anzahl) => {
  const page = await browser.newPage({ viewport: { width: width, height: height } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(300);
  const r = await page.evaluate((build) => {
    // In production the app script decides what's shown; here it's set by
    // hand, because nothing would be visible without logging in.
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    // eslint-disable-next-line no-eval
    eval(build);
    const d = document.documentElement;
    // And report right away WHO is sitting too far down - without this,
    // next time means another hour spent hunting an invisible element.
    const culprit = [...document.querySelectorAll('*')]
      .map((e) => ({ e, u: e.getBoundingClientRect().bottom }))
      .filter((x) => x.u > d.clientHeight + 2)
      .sort((a, b) => b.u - a.u).slice(0, 3)
      .map((x) => `${x.e.tagName.toLowerCase()}.${String(x.e.className).split(' ')[0]} bei ${Math.round(x.u)}`);
    return { scrollH: d.scrollHeight, clientH: d.clientHeight, culprit };
  }, AUFBAU[tab](anzahl));
  await page.close();
  return r;
};

console.log('\nDie Seite bleibt so hoch wie das Fenster\n');

for (const tab of ['Polls', 'DMs']) {
  const r = await measure(tab, 1300, 738, 40);
  check(`${tab} am Rechner, volle Liste`, r.scrollH <= r.clientH,
    `${r.scrollH} px Dokument in ${r.clientH} px Fenster`
    + (r.culprit.length ? ` — zu far bottom: ${r.culprit.join(', ')}` : ''));
}

// On a phone it's worse, not better: the window is shorter there, so the
// unscrolled flow is proportionally longer - and a document that scrolls
// along with it there costs you the address bar, which slides in and out
// as you scroll.
for (const tab of ['Polls', 'DMs']) {
  const r = await measure(tab, 390, 720, 40);
  check(`${tab} auf 390 px`, r.scrollH <= r.clientH,
    `${r.scrollH} px Dokument in ${r.clientH} px Fenster`
    + (r.culprit.length ? ` — zu far bottom: ${r.culprit.join(', ')}` : ''));
}

// The counter-check: the test has to ACTUALLY see the bug too. Without it,
// a rule could sit here that never fires - and nobody would know.
//
// It re-creates the mechanism instead of reverting the page, and that's for
// a reason worth spelling out:
//
// The bug happened in chat, on Ansem's hidden handle. Chat is gone now.
// What's left are two spots with such spans - the " — your vote" after an
// answer, and Ansem's handle in the header - and at BOTH of them it can no
// longer be triggered: .opt-bar is positioned (that's where the fill bar
// lives), .poll-list is too (that's where the centered "No polls yet"
// sentence lives), and the header contains exactly one such element instead
// of forty. The rules for .opt-label and .me .handle.admin-name still sit
// there anyway: they're what's left over once someone takes position away
// from one of the other two containers again.
//
// So a list without a positioned ancestor gets built here instead. It
// doesn't prove the page HAS the bug - it proves the measurement would see
// it.
console.log('\nGegenprobe: Der Test sieht den Fehler auch\n');
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 738 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    const pane = document.querySelector('#pane-polls');
    pane.hidden = false;
    // Deliberately without position on the box: exactly the state the
    // rules in the stylesheet prevent.
    //
    // And deliberately OUTSIDE .app, not inside it.
    // -----------------------------------------------------------------------
    // Since .app carries a transform (the compensation for the keyboard,
    // see --versatz), .app itself has become a reference point for
    // everything absolute inside it. A box INSIDE .app could therefore no
    // longer inflate the document at all - the counter-check would come
    // back green because the bug could no longer be reproduced, not because
    // the measurement would catch it. That's exactly the distinction this
    // is about.
    //
    // As a side note, this is a genuine extra safeguard for the app. But a
    // counter-check must not rely on it: its job is to show that the
    // MEASUREMENT triggers.
    const panel = document.createElement('div');
    panel.style.cssText = 'height: 300px; overflow-y: auto;';
    panel.innerHTML = Array.from({ length: 40 }, (_, i) =>
      `<div style="padding: 12px">Zeile ${i}<span class="nur-vorlesen"> versteckt</span></div>`).join('');
    document.body.appendChild(panel);
    panel.scrollTop = 1e6;
    const d = document.documentElement;
    return { scrollH: d.scrollHeight, clientH: d.clientHeight };
  });
  await page.close();
  check('Versteckte Spans ohne Bezugspunkt blähen das Dokument auf – der Test würde anschlagen',
    r.scrollH > r.clientH, `${r.scrollH} px statt ${r.clientH} px`);
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
