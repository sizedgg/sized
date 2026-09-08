/**
 * Die Abstimmungen, beschriftet.
 *
 * Das Gegenstueck zu scripts/vorschau-posteingang-erklaert.mjs, gleiche
 * Machart: rote Kaesten an den echten Elementen, die Saetze im Rand, die
 * Linien durch gemessene Gassen, ein Wasserzeichen im leeren Feld.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql        (einmal)
 *   node --experimental-strip-types scripts/dev-stack.mjs &
 *   node scripts/vorschau-polls-erklaert.mjs
 *
 * Zwei Abstimmungen: oben die laufende ueber die naechste Chain, mit Frist,
 * darunter die geschlossene ueber den Ticker. Beides kommt aus der Saat,
 * nicht aus dem Skript.
 *
 * Angemeldet wird als HALTER, nicht als Ansem. Der Unterschied ist das
 * halbe Bild: Ansem sieht bei seinen eigenen Abstimmungen "you do not vote
 * in your own polls", einen Knopf zum Schliessen und keinen Haken. Was hier
 * erklaert werden soll - die eigene Stimme, das Umentscheiden - gibt es nur
 * in der Ansicht eines Halters.
 *
 * Und es wird wirklich abgestimmt, ueber die Oberflaeche. Ein Haken, den
 * ein UPDATE in die Tabelle geschrieben hat, sieht genauso aus - aber dann
 * steht im Bild ein Zustand, von dem niemand weiss, ob die Seite ihn
 * ueberhaupt herstellt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'artikel');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

// Der Halter aus der Saat - die einzige erfundene Adresse, mit der man sich
// anmelden KANN: die 500 anderen bestehen die base58-Pruefung nicht.
const HALTER = '37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa';
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';
const SKALA = 2;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

async function anmelden(wallet) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#wallet-input', wallet);
  await page.click('#btn-challenge');
  await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  const id = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);
  await page.evaluate(async (cid) => {
    await fetch('/functions/v1/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId: cid }),
    });
  }, id);
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  const jwt = await page.evaluate(() => localStorage.getItem('ansem_jwt'));
  const istAdmin = await page.evaluate(() => {
    try {
      const t = localStorage.getItem('ansem_jwt').split('.')[1];
      return Boolean(JSON.parse(atob(t.replace(/-/g, '+').replace(/_/g, '/'))).is_admin);
    } catch { return null; }
  });
  await ctx.close();
  return { jwt, istAdmin };
}

const halter = await anmelden(HALTER);
if (halter.istAdmin !== false) {
  throw new Error('Diese Sitzung ist eine Verwaltungssitzung - dann fehlen Haken und '
    + 'Antwortknoepfe. dev-stack mit aktueller app_config neu starten');
}

const ctx = await browser.newContext({
  // Breiter als die anderen Bilder: die Karte hoert bei 1180 auf, und was
  // daneben frei bleibt, sind die Gassen fuer die Linien. Bei 1280 waeren
  // sie 50 Punkte breit, und jede Linie liefe an der Kante der Karte
  // entlang.
  viewport: { width: 1560, height: 820 }, deviceScaleFactor: SKALA,
});
const page = await ctx.newPage();
await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, halter.jwt);
page.on('load', () => page.addStyleTag({ content: HIDE }).catch(() => {}));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: HIDE });
await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
await page.waitForSelector('.poll', { timeout: 25_000 });
await page.waitForTimeout(700);

const lage = await page.evaluate(() => {
  const polls = [...document.querySelectorAll('.poll')];
  return {
    anzahl: polls.length,
    fragen: polls.map((p) => p.querySelector('h4')?.textContent?.trim()),
    frist: polls[0]?.querySelector('.frist-rest')?.textContent?.trim() ?? null,
    zu: Boolean(polls[1]?.querySelector('.closed-tag')),
  };
});
if (lage.anzahl !== 2) throw new Error(`${lage.anzahl} Abstimmungen statt zwei`);
if (!/chain/i.test(lage.fragen[0] ?? '')) throw new Error(`Oben steht: ${lage.fragen[0]}`);
if (!/\dh/.test(lage.frist ?? '')) throw new Error(`Die Frist oben sagt: ${lage.frist}`);
if (!lage.zu) throw new Error('Die zweite Abstimmung ist nicht geschlossen');

// Abstimmen - nicht fuer den Fuehrenden. Eine Stimme auf dem laengsten
// Balken sieht aus wie ein Haken auf dem Sieger; auf dem zweiten sieht man,
// dass beides nichts miteinander zu tun hat.
const zweite = await page.evaluate(() =>
  document.querySelectorAll('.poll')[0].querySelectorAll('.opt')[1].dataset.option);
await page.click(`.opt[data-option="${zweite}"]`);
await page.waitForTimeout(900);
const eigene = await page.evaluate(() =>
  [...document.querySelectorAll('.opt[aria-pressed="true"]')].map((o) => o.dataset.option));
if (eigene.length !== 1 || eigene[0] !== zweite) {
  throw new Error(`Die Stimme steht nicht: ${JSON.stringify(eigene)}`);
}

/* --------------------------------------------------------------------------
 * Die Kaesten
 * ----------------------------------------------------------------------- */

const { kaesten, gassen } = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  // Die Frage steht in einem h4, und das ist so breit wie die Karte. Ein
  // Kasten darum waere ein Kasten um die halbe Karte und wuerde alles
  // darunter beruehren. Gemessen wird deshalb der TEXT, nicht das Element.
  const textRect = (el) => {
    if (!el) return null;
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const polls = [...document.querySelectorAll('.poll')];
  const oben = polls[0];
  const unten = polls[1];
  const karte = rect(oben);
  const letzte = rect(unten);

  // Der laengste Balken der oberen Frage - dort steht die groesste Zahl,
  // und an einer Zahl laesst sich erklaeren, was der Balken ueberhaupt
  // misst.
  const fuehrend = oben.querySelector('.opt');
  const meine = oben.querySelector('.opt[aria-pressed="true"]');

  return {
    kaesten: {
      frage: textRect(oben.querySelector('h4')),
      werkzeuge: rect(oben.querySelector('.poll-tools')),
      // Summe und Frist zusammen in einem Kasten, nicht einzeln.
      //
      // Einzeln standen sie nebeneinander in derselben Zeile: zwei Kaesten
      // mit acht Punkten Luft dazwischen, und die Linie zur Frist musste
      // quer durch die Karte nach rechts - dort kreuzte sie die Linie, die
      // vom Betrag kommt. Zusammengefasst gibt es beide Probleme nicht
      // mehr, und der Satz daneben sagt ohnehin beides.
      meta: textRect(oben.querySelector('.poll-meta')),
      betrag: rect(fuehrend?.querySelector('.opt-num .held')),
      eigene: rect(meine?.querySelector('.opt-label')),
      zu: rect(unten.querySelector('.closed-tag')),
    },
    gassen: {
      links: karte.x - 16,
      rechts: karte.x + karte.w + 16,
      spalt: karte.x + karte.w + 16,      // beschriften.py verlangt das Feld
      // Das leere Blatt unter der letzten Karte - dort steht DEMO DATA.
      frei: (letzte.y + letzte.h + window.innerHeight) / 2,
      unterkante: letzte.y + letzte.h,
      wasser: {
        x: karte.x + karte.w / 2,
        y: (letzte.y + letzte.h + window.innerHeight) / 2,
      },
    },
  };
});
for (const [name, k] of Object.entries(kaesten)) {
  if (!k || k.w < 4 || k.h < 4) throw new Error(`Kasten "${name}" ist leer oder winzig: ${JSON.stringify(k)}`);
}
// Unter der letzten Karte muss Platz fuer das Wasserzeichen sein - ohne
// diese Zeile stuende es auf der Karte, und das faellt erst im Bild auf.
if (gassen.frei - gassen.unterkante < 40) {
  throw new Error(`Unter der letzten Abstimmung sind nur ${Math.round(
    (gassen.frei - gassen.unterkante) * 2)} Punkte frei`);
}

const LUFT = 5;
const eintraege = Object.entries(kaesten);
for (let i = 0; i < eintraege.length; i++) {
  for (let j = i + 1; j < eintraege.length; j++) {
    const [na, a] = eintraege[i];
    const [nb, b] = eintraege[j];
    const ueber = (p, q) => p.x - LUFT < q.x + q.w + LUFT && q.x - LUFT < p.x + p.w + LUFT
      && p.y - LUFT < q.y + q.h + LUFT && q.y - LUFT < p.y + p.h + LUFT;
    if (ueber(a, b)) throw new Error(`Die Kaesten "${na}" und "${nb}" schneiden sich`);
  }
}

const foto = path.join(OUT, '.polls-roh.png');
await page.screenshot({ path: foto });
await browser.close();

const BESCHRIFTUNG = [
  { schluessel: 'frage', seite: 'links', route: 'korridor',
    text: 'Only Ansem posts a poll. Everyone holding $ANSEM can vote on it.' },
  { schluessel: 'meta', seite: 'links', route: 'korridor',
    text: 'Everything the wallets that voted hold, and how much longer this one stays open.' },
  { schluessel: 'eigene', seite: 'links', route: 'korridor',
    text: 'Your vote. Pick another answer and it moves over; sell, and it shrinks with your balance.' },
  { schluessel: 'werkzeuge', seite: 'rechts', route: 'rechts',
    text: 'Copy the link, or download the poll as a dated image.' },
  { schluessel: 'betrag', seite: 'rechts', route: 'rechts',
    text: 'Not one vote per wallet: the bar is what those wallets hold.' },
  { schluessel: 'zu', seite: 'rechts', route: 'rechts',
    text: 'Closed. Balances keep moving, this result does not.' },
];

const plan = {
  foto,
  ziel: path.join(OUT, '6-polls-erklaert.png'),
  skala: SKALA,
  wasserzeichen: 'DEMO DATA',
  kaesten,
  gassen,
  beschriftung: BESCHRIFTUNG,
};
const planDatei = path.join(OUT, '.plan-polls.json');
fs.writeFileSync(planDatei, JSON.stringify(plan, null, 2));
execFileSync('python3', [path.join(root, 'scripts', 'beschriften.py'), planDatei], { stdio: 'inherit' });
fs.rmSync(planDatei, { force: true });
fs.rmSync(foto, { force: true });

console.log(`\n  ${lage.fragen[0]} - ${lage.frist}`);
console.log(`  ${lage.fragen[1]} - geschlossen`);
console.log(`  ${path.relative(root, plan.ziel)}\n`);
