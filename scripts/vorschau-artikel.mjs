/**
 * Die vier Bilder fuer den Artikel.
 *
 *   1  Anmeldung          schmal beschnitten, nur die Karte
 *   2  Ansems Posteingang, voll, mit einem geoeffneten Gespraech
 *   3  Dasselbe Gespraech aus der Sicht des Halters
 *   4  Die Abstimmungen
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (einmal)
 *   node --experimental-strip-types scripts/dev-stack.mjs &
 *   node scripts/vorschau-artikel.mjs
 *
 * Aufgenommen, nicht gebaut: die Seite laeuft gegen den echten Stapel, das
 * Blatt kommt aus public/styles.css, und ueber die Bilder wird nichts gelegt
 * ausser dem Ausblenden der Entwicklungs-Schalter und dem Wasserzeichen.
 *
 * Bild 2 und 3 zeigen DASSELBE Gespraech von zwei Seiten - das ist der Grund,
 * warum dieses Skript zweimal anmeldet. Vorher standen dort zwei
 * verschiedene: in Ansems Posteingang das eine, in der Nutzeransicht ein
 * anderes, und wer die Bilder nacheinander liest, stolpert darueber. Das
 * Gespraech steht von Hand in der Saat (sechs Nachrichten, ein Hin und Her);
 * die 500 gewuerfelten sind fuer die LISTE gemacht und ergeben aufgeklappt
 * keinen Sinn.
 *
 * Drei der vier Bilder tragen DEMO DATA. Die Anmeldung nicht: dort steht
 * nichts Erfundenes, nur ein leeres Feld und ein Knopf.
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
const SKALA = 2;

const ANSEM = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
// Der eine Halter, mit dem man sich anmelden kann - siehe die Begruendung in
// scripts/seed-ansem-voll.sql. Sein Gespraech ist das, was in Bild 2 offen
// steht und Bild 3 ganz fuellt.
const HALTER = '6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR';

const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

/** Legt DEMO DATA in ein gemessenes leeres Feld des fertigen Fotos. */
function stempeln(datei, wasser) {
  const plan = path.join(OUT, '.plan-artikel.json');
  fs.writeFileSync(plan, JSON.stringify({
    foto: datei,
    ziel: datei,
    skala: SKALA,
    rand: 0,                    // kein Rand: hier stehen keine Saetze
    wasserzeichen: 'DEMO DATA',
    kaesten: {},
    gassen: { wasser },
    beschriftung: [],
  }));
  execFileSync('python3', [path.join(root, 'scripts', 'beschriften.py'), plan], { stdio: 'pipe' });
  fs.rmSync(plan, { force: true });
}

/** Meldet eine Wallet an und gibt ihr Token zurueck. */
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

async function angemeldet(jwt, hoehe = 820, breite = 1280) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: hoehe }, deviceScaleFactor: SKALA,
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, jwt);
  page.on('load', () => page.addStyleTag({ content: HIDE }).catch(() => {}));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}

const ansem = await anmelden(ANSEM);
const halter = await anmelden(HALTER);

// Der Punkt der zwei Anmeldungen, deshalb geprueft und nicht angenommen: der
// lokale Stapel liest app_config einmal beim Start - steht dort eine alte
// Wallet, kommt fuer beide dasselbe zurueck, und die Bilder zeigen zweimal
// dieselbe Ansicht, ohne dass man es sieht.
console.log(`\n  Ansem  is_admin=${ansem.istAdmin}`);
console.log(`  Halter is_admin=${halter.istAdmin}`);
if (ansem.istAdmin !== true || halter.istAdmin !== false) {
  throw new Error('Die beiden Sitzungen unterscheiden sich nicht - dev-stack mit '
    + 'aktueller app_config neu starten');
}

// --- 1. Die Anmeldung -------------------------------------------------------
//
// Beschnitten auf die Karte, mit etwas Luft nach oben und unten. Ein volles
// Fenster waere zu drei Vierteln leeres Blatt - im Artikel steht das Bild
// zwischen Absaetzen und nicht als Bildschirmfoto einer Sitzung.
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: SKALA,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForSelector('#login:not([hidden])', { timeout: 20_000 });
  await page.waitForTimeout(600);
  const karte = await page.evaluate(() => {
    // '#login .login-card' und nicht '.login-card': die Vorstartseite
    // (#soon) benutzt dieselbe Klasse, steht frueher im Dokument und ist
    // verborgen - der erste Treffer war also ein Kasten mit 0 mal 0, und
    // das Bild war 136 Punkte gross.
    const r = document.querySelector('#login .login-card').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (karte.w < 200 || karte.h < 120) throw new Error(`Die Anmeldekarte misst ${karte.w}x${karte.h}`);
  const LUFT = 34;
  await page.screenshot({
    path: path.join(OUT, '1-anmeldung.png'),
    clip: {
      x: Math.max(0, karte.x - LUFT), y: Math.max(0, karte.y - LUFT),
      width: karte.w + 2 * LUFT, height: karte.h + 2 * LUFT,
    },
  });
  await ctx.close();
  console.log(`  1  Anmeldung  ${Math.round(karte.w)}x${Math.round(karte.h)} plus ${LUFT} Punkte Luft`);
}

// --- 2. Ansems Posteingang, mit dem Gespraech des Halters offen -------------
{
  const { ctx, page } = await angemeldet(ansem.jwt);
  await page.click('.tab[data-tab="dms"]');
  await page.waitForSelector('.thread', { timeout: 25_000 });
  await page.waitForTimeout(700);
  const n = await page.evaluate(() => document.querySelectorAll('.thread').length);

  await page.click(`.thread[data-wallet="${HALTER}"]`);
  await page.waitForSelector('.dm-row', { timeout: 25_000 });
  await page.waitForTimeout(800);
  const offen = await page.evaluate(() => ({
    zeilen: document.querySelectorAll('.dm-row').length,
    eigene: document.querySelectorAll('.dm-row.mine').length,
    sichtbar: (() => {
      const z = document.querySelector('.thread.is-active');
      if (!z) return false;
      const r = z.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    })(),
  }));
  if (!offen.eigene) throw new Error('Im geoeffneten Gespraech steht keine Antwort von Ansem');
  if (offen.zeilen < 4) throw new Error(`Nur ${offen.zeilen} Nachrichten - zu leer fuer das Bild`);
  // Die geoeffnete Zeile muss auch IM BILD sein. Ohne diese Pruefung koennte
  // rechts ein Gespraech stehen, dessen Zeile links unterhalb des Randes
  // liegt - und das Bild zeigt eine Auswahl, die es scheinbar nicht gibt.
  if (!offen.sichtbar) throw new Error('Die geoeffnete Zeile liegt ausserhalb des Bildes');

  const datei = path.join(OUT, '2-posteingang.png');
  await page.screenshot({ path: datei });
  // Genau in die Mitte des rechten Kastens - nicht in die Luecke ueber der
  // ersten Nachricht.
  //
  // Die Luecke war der vorsichtige Platz: dort liegt das Wasserzeichen auf
  // nichts. Sie ist aber auch verschieden gross, je nachdem wie viel im
  // Gespraech steht, und wandert damit von Bild zu Bild. Die Mitte des
  // Fensters steht immer an derselben Stelle, und ein Wasserzeichen, das
  // ueber einer Blase liegt, ist genau das, was ein Wasserzeichen tun soll.
  const wasser = await page.evaluate(() => {
    const f = document.querySelector('.thread-view').getBoundingClientRect();
    return { x: f.x + f.width / 2, y: f.y + f.height / 2 };
  });
  stempeln(datei, wasser);
  await ctx.close();
  console.log(`  2  Posteingang, ${n} Gespraeche, offen: ${offen.zeilen} Nachrichten`);
}

// --- 3. Dasselbe Gespraech, wie der Halter es sieht -------------------------
{
  const { ctx, page } = await angemeldet(halter.jwt);
  await page.click('.tab[data-tab="dms"]');
  await page.waitForSelector('.dm-row', { timeout: 25_000 });
  await page.waitForTimeout(800);
  const zahlen = await page.evaluate(() => ({
    zeilen: document.querySelectorAll('.dm-row').length,
    eigene: document.querySelectorAll('.dm-row.mine').length,
    liste: document.querySelectorAll('.thread').length,
    kopf: document.querySelector('#me-holdings')?.textContent?.trim() ?? '',
  }));
  // Ohne diese drei Zeilen waere ein Bild ohne eigene Blase - oder mit
  // Ansems Posteingang darin - genauso durchgegangen.
  if (!zahlen.eigene) throw new Error('Keine eigene Nachricht im Bild');
  if (zahlen.liste) throw new Error('Die Verwaltungsliste ist sichtbar - das ist nicht die Nutzersicht');
  if (!/\d/.test(zahlen.kopf)) throw new Error(`Oben steht kein Bestand: "${zahlen.kopf}"`);

  const datei = path.join(OUT, '3-dm-halter.png');
  await page.screenshot({ path: datei });
  const wasser = await page.evaluate(() => {
    const verlauf = document.querySelector('#dm-thread').getBoundingClientRect();
    const blase = document.querySelector('#dm-thread > *').getBoundingClientRect();
    return { x: verlauf.x + verlauf.width / 2, y: (verlauf.y + blase.y) / 2, frei: blase.y - verlauf.y };
  });
  if (wasser.frei < 130) throw new Error(`Ueber dem Verlauf sind nur ${Math.round(wasser.frei)} px frei - das Wasserzeichen wuerde darauf liegen`);
  stempeln(datei, wasser);
  await ctx.close();
  console.log(`  3  Gespraech, ${zahlen.zeilen} Nachrichten, davon ${zahlen.eigene} eigene, Kopf ${zahlen.kopf}`);
}

// --- 4. Die Abstimmungen ----------------------------------------------------
{
  const { ctx, page } = await angemeldet(halter.jwt, 820, 1280);
  await page.waitForSelector('.poll', { timeout: 25_000 });
  await page.waitForTimeout(700);
  const lage = await page.evaluate(() => {
    const polls = [...document.querySelectorAll('.poll')];
    const letzte = polls.at(-1).getBoundingClientRect();
    return {
      anzahl: polls.length,
      fragen: polls.map((p) => p.querySelector('h4').textContent.trim()),
      summen: polls.map((p) => p.querySelector('.poll-meta span').textContent.trim()),
      zu: polls.map((p) => Boolean(p.querySelector('.closed-tag'))),
      frist: polls[0].querySelector('.frist-rest')?.textContent?.trim() ?? null,
      unten: letzte.bottom,
      hoehe: window.innerHeight,
      mitte: letzte.x + letzte.width / 2,
    };
  });
  if (lage.anzahl !== 2) throw new Error(`${lage.anzahl} Abstimmungen statt zwei`);
  if (!/chain/i.test(lage.fragen[0])) throw new Error(`Oben steht: ${lage.fragen[0]}`);
  if (!/\dh/.test(lage.frist ?? '')) throw new Error(`Die Frist sagt: ${lage.frist}`);
  if (lage.zu[0] || !lage.zu[1]) throw new Error('Nicht genau die untere ist geschlossen');
  if (lage.hoehe - lage.unten < 60) {
    throw new Error(`Unter der letzten Karte sind nur ${Math.round(lage.hoehe - lage.unten)} px frei`);
  }

  const datei = path.join(OUT, '4-polls.png');
  await page.screenshot({ path: datei });
  stempeln(datei, { x: lage.mitte, y: (lage.unten + lage.hoehe) / 2 });
  await ctx.close();
  console.log(`  4  ${lage.fragen[0]} (${lage.frist}) - ${lage.summen[0]}`);
  console.log(`     ${lage.fragen[1]} - ${lage.summen[1]}`);
}

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
