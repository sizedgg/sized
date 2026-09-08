// ============================================================================
// Die Vorschau vor dem Download.
//
// Was hier auf dem Spiel steht, ist nicht das Aussehen, sondern eine
// Behauptung: auf dem Desktop wird NICHTS gespeichert, bevor man es gesehen
// hat. Genau das laesst sich still verlieren - der Dialog geht auf und die
// Datei liegt trotzdem schon im Ordner, und niemand merkt es, weil der Dialog
// ja richtig aussieht.
//
// Deshalb wird hier nicht geprueft, ob der Dialog erscheint, sondern ob der
// Browser einen Download bekommen hat. Der Anker-Klick wird abgefangen und
// gezaehlt; die Zahl ist die Aussage.
//
// Zweiter Punkt, derselbe Gedanke von der anderen Seite: wo das System-Blatt
// die Karte schon zeigt, darf der Dialog NICHT kommen - zwei Vorschauen
// hintereinander sind eine zu viel. Das haengt am Blatt, nicht am Geraet;
// warum, steht bei Fall 5.
//
//   node scripts/test-teilen-dialog.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const htmlRoh = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};

// Wortwoertlich aus app.js. Eine nachgebaute Fassung wuerde bestehen,
// waehrend die echte kaputt ist - genau der Fehler, den dieses Projekt schon
// mehrfach gemacht hat.
const zeichnen = cut('const cssWert =', 'async function ladePollBild');
const lader = cut('async function ladePollBild', '\nfunction pollHtml');
const knopfZustand = cut('const BUTTON_ROLES = {', 'const pollLink = (id) => `${location.origin}/p/${id}`;');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const CHECK_SVG = cut('const CHECK_SVG =', 'const DOWNLOAD_SVG =');
const DOWNLOAD_SVG = cut('const DOWNLOAD_SVG =', 'const TRASH_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"');
const TRASH_SVG = cut('const TRASH_SVG =', '\n// ------');

// Der Dialog selbst - Markup aus index.html, nicht hier nachgetippt.
const dialogMarkup = /<div id="bild-dialog"[\s\S]*?\n  <\/div>/.exec(htmlRoh);
if (!dialogMarkup) throw new Error('Der Dialog fehlt in index.html');

const seite = `<!doctype html><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${css}</style>
  <body style="margin:0">
  <div style="padding:20px">
    <button class="icon-btn poll-image" data-image="1"
            aria-label="Download this poll as an image">D</button>
  </div>
  ${dialogMarkup[0]}`;

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' }).end(seite));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Die Seite selbst - einmal gebaut, von allen Faellen benutzt. Der echte Code
// aus app.js, nur mit einer Abstimmung davor gelegt.
const skript = `
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const state = { cfg: { symbol: 'ANSEM' }, polls: [{
    id: 1, closed: true, totalVotes: 77, totalUsd: 310000,
    question: 'Next AMA time?',
    options: [
      { id: 0, label: 'Friday 8pm ET', votes: 55, usd: 220100, share: 2201 / 3100 },
      { id: 0, label: 'Sunday 2pm ET', votes: 22, usd: 89900, share: 899 / 3100 },
    ],
  }] };
  window.tosts = [];
  const toast = (m, err) => window.tosts.push({ m, err: Boolean(err) });
  ${formate}
  ${CHECK_SVG}
  ${DOWNLOAD_SVG}
  ${TRASH_SVG}
  ${knopfZustand}
  ${zeichnen}
  ${lader}
  teilenDialogVerdrahten();
  window.ladePollBild = ladePollBild;
  window.zeitstempel = zeitstempel;
  $('.poll-image').addEventListener('click', () => ladePollBild('1'));
`;

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

/**
 * Eine Seite mit dem echten Code drin.
 *
 * grob: ob sich das Geraet wie ein Handy meldet. Das entscheidet in
 * ladePollBild, welcher der drei Wege genommen wird, also muss der Test es
 * setzen koennen - und zwar VOR dem Skript, sonst hat der Code matchMedia
 * schon gelesen.
 */
async function baue({ grob = false, teilenGeht = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();

  await page.addInitScript(({ istGrob, kannTeilen }) => {
    window.__downloads = [];
    window.__geteilt = 0;
    const echt = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloads.push(this.download); return; }
      return echt.apply(this, arguments);
    };
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      (q.includes('pointer: coarse')
        ? { matches: istGrob, media: q, addEventListener() {}, removeEventListener() {} }
        : mm(q));
    if (kannTeilen) {
      navigator.canShare = () => true;
      navigator.share = async () => { window.__geteilt += 1; };
    } else {
      delete navigator.canShare;
    }
  }, { istGrob: grob, kannTeilen: teilenGeht });

  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: skript });
  return { ctx, page };
}

// --- 1. Desktop: erst zeigen, dann speichern --------------------------------
console.log('\nAuf dem Desktop wird erst gezeigt\n');
{
  const { ctx, page } = await baue();
  await page.click('.poll-image');
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });

  const sofort = await page.evaluate(() => window.__downloads.length);
  check('Beim Klick auf den Knopf wird noch nichts gespeichert',
    sofort === 0, `${sofort} Downloads`);
  check('Sondern der Dialog geht auf',
    await page.isVisible('#bild-dialog'));

  // Das Bild ist DA - ein leerer Kasten waere ebenfalls "offen".
  const bild = await page.evaluate(() => {
    const i = document.querySelector('#bild-dialog-bild');
    return { quelle: (i?.getAttribute('src') || '').slice(0, 5), breite: i?.naturalWidth || 0 };
  });
  check('Und zeigt wirklich die Karte', bild.quelle === 'blob:' && bild.breite > 100,
    `${bild.quelle}… ${bild.breite}px breit`);

  // Der Stempel im Dialog ist DER der Karte, nicht eine zweite Uhr.
  const stempel = await page.textContent('#bild-dialog-stempel');
  check('Der Zeitstempel steht im Dialog', /^\d{2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC$/.test(stempel.trim()),
    stempel.trim());

  const fokus = await page.evaluate(() => document.activeElement?.id);
  check('Der Fokus liegt auf dem Download-Knopf', fokus === 'bild-dialog-laden', fokus);

  // Und erst jetzt.
  await page.click('#bild-dialog-laden');
  const danach = await page.evaluate(() => window.__downloads);
  check('Erst der Knopf im Dialog speichert', danach.length === 1, danach.join(', '));
  check('Und zwar unter dem Namen der Abstimmung',
    danach[0] === 'sized-poll-1.png', danach[0]);
  check('Danach ist der Dialog wieder zu', await page.isHidden('#bild-dialog'));
  const zurueck = await page.evaluate(() =>
    document.activeElement?.classList.contains('poll-image'));
  check('Und der Fokus liegt wieder auf dem Knopf, der ihn geoeffnet hat', zurueck);
  await ctx.close();
}

// --- 2. Schliessen, ohne zu speichern ---------------------------------------
console.log('\nZu machen, ohne zu speichern\n');
for (const [wie, tun] of [
  ['Escape', async (page) => page.keyboard.press('Escape')],
  ['das Kreuz', async (page) => page.click('#bild-dialog-zu')],
  // Auf den Grund, nicht auf die Karte: mousedown, weil genau darauf
  // gehoert wird - ein click waere auch dann gruen, wenn die Karte selbst
  // den Dialog schliessen wuerde.
  ['der Klick daneben', async (page) => page.mouse.down({ position: { x: 5, y: 5 } })],
]) {
  const { ctx, page } = await baue();
  await page.click('.poll-image');
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });
  if (wie === 'der Klick daneben') {
    await page.mouse.move(5, 5);
    await page.mouse.down();
    await page.mouse.up();
  } else {
    await tun(page);
  }
  await page.waitForTimeout(150);
  check(`${wie} schliesst den Dialog`, await page.isHidden('#bild-dialog'));
  const n = await page.evaluate(() => window.__downloads.length);
  check(`${wie} speichert nichts`, n === 0, `${n} Downloads`);
  await ctx.close();
}

// --- 3. Ein Klick auf die Karte schliesst NICHT ------------------------------
{
  const { ctx, page } = await baue();
  await page.click('.poll-image');
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });
  await page.click('#bild-dialog-stempel');
  await page.waitForTimeout(150);
  check('Ein Klick auf die Karte selbst schliesst nicht',
    await page.isVisible('#bild-dialog'));
  await ctx.close();
}

// --- 4. Auf dem Handy bleibt es beim Blatt des Systems -----------------------
console.log('\nAuf dem Handy nicht\n');
{
  const { ctx, page } = await baue({ grob: true, teilenGeht: true });
  await page.click('.poll-image');
  await page.waitForFunction(() => window.__geteilt > 0, { timeout: 25_000 });
  await page.waitForTimeout(200);
  check('Das System-Blatt uebernimmt', await page.evaluate(() => window.__geteilt) === 1);
  check('Und der Dialog bleibt zu', await page.isHidden('#bild-dialog'));
  const n = await page.evaluate(() => window.__downloads.length);
  check('Gespeichert wird dabei nichts doppelt', n === 0, `${n} Downloads`);
  await ctx.close();
}

// --- 5. Handy OHNE Teilen-Blatt: dann doch der Dialog ------------------------
//
// Diese Pruefung ist urspruenglich mit der umgekehrten Erwartung geschrieben
// worden - "grob, also Handy, also direkt speichern" - und sie ist
// durchgefallen. Zu Recht: der Dialog haengt nicht am Geraet, sondern an der
// Frage, ob jemand das Bild schon gesehen hat. Das System-Blatt zeigt es,
// sonst zeigt es nichts. Ein Telefon, dessen Browser nicht teilen kann, steht
// genau da, wo ein Desktop steht.
{
  const { ctx, page } = await baue({ grob: true, teilenGeht: false });
  await page.click('.poll-image');
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });
  check('Kann das Geraet nicht teilen, kommt auch dort der Dialog',
    await page.isVisible('#bild-dialog'));
  const n = await page.evaluate(() => window.__downloads.length);
  check('Und bis dahin ist nichts gespeichert', n === 0, `${n} Downloads`);
  await ctx.close();
}

// --- 5b. Das Blatt bricht ab: nichts passiert -------------------------------
//
// AbortError heisst, die Person hat das Blatt weggewischt. Dann ist das die
// Antwort und nicht der Anfang eines zweiten Angebots.
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__downloads = [];
    const echt = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloads.push(this.download); return; }
      return echt.apply(this, arguments);
    };
    window.matchMedia = (q) => ({ matches: q.includes('pointer: coarse'), media: q,
      addEventListener() {}, removeEventListener() {} });
    navigator.canShare = () => true;
    navigator.share = async () => {
      const e = new Error('abgebrochen'); e.name = 'AbortError'; throw e;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: skript });
  await page.click('.poll-image');
  await page.waitForTimeout(1200);
  check('Bricht das Blatt ab, bleibt der Dialog zu', await page.isHidden('#bild-dialog'));
  const n = await page.evaluate(() => window.__downloads.length);
  check('Und es wird nichts gespeichert', n === 0, `${n} Downloads`);
  await ctx.close();
}

// --- 5c. Das Blatt scheitert anders: dann der Dialog -------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__downloads = [];
    const echt = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloads.push(this.download); return; }
      return echt.apply(this, arguments);
    };
    window.matchMedia = (q) => ({ matches: q.includes('pointer: coarse'), media: q,
      addEventListener() {}, removeEventListener() {} });
    navigator.canShare = () => true;
    navigator.share = async () => { throw new Error('geht gerade nicht'); };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: skript });
  await page.click('.poll-image');
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });
  check('Scheitert das Blatt anders, faengt der Dialog es auf',
    await page.isVisible('#bild-dialog'));
  await ctx.close();
}

// --- 6. Der Zeitstempel selbst ----------------------------------------------
console.log('\nDer Zeitstempel\n');
{
  const { ctx, page } = await baue();
  const proben = await page.evaluate(() => ({
    fest: window.zeitstempel(new Date(Date.UTC(2026, 8, 8, 15, 26))),
    einstellig: window.zeitstempel(new Date(Date.UTC(2026, 0, 3, 4, 5))),
    // Dieselbe Sekunde, zwei Zonen: der String muss derselbe sein.
    zone: window.zeitstempel(new Date(Date.UTC(2026, 8, 8, 23, 30))),
  }));
  check('Format wie abgesprochen', proben.fest === '08 SEP 2026 · 15:26 UTC', proben.fest);
  check('Fuehrende Nullen bei Tag und Uhrzeit',
    proben.einstellig === '03 JAN 2026 · 04:05 UTC', proben.einstellig);
  check('Spaet am Tag kippt nichts ins naechste Datum',
    proben.zone === '08 SEP 2026 · 23:30 UTC', proben.zone);
  await ctx.close();
}

// --- 7. Der Stempel steht auch AUF der Karte, unten rechts -------------------
{
  const { ctx, page } = await baue();
  // ladePollBild gibt die Leinwand nicht heraus, also wird sie ueber den
  // Dialog geholt: das Bild dort IST die Datei, die gespeichert wuerde.
  await page.click('.poll-image');
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });
  const treffer = await page.evaluate(async () => {
    const img = document.querySelector('#bild-dialog-bild');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    // Die Textzeile ganz unten, rechte und linke Haelfte getrennt.
    //
    // Das Band war zuerst "die unteren 14 % der Karte" und danach "die
    // unteren 6 %", und beide Male hat die Gegenprobe nicht gebissen: in
    // diesem Bereich liegt der 3px-Rahmen der Karte, der ueber die ganze
    // Breite laeuft und links wie rechts Tausende dunkler Punkte liefert.
    // Die Pruefung mass also den Rahmen und haette auch ohne jeden
    // Zeitstempel bestanden.
    //
    // Jetzt wird genau das Band genommen, in dem die Schrift sitzt: die
    // Grundlinie steht in app.js bei H - m - 38, also 72 Punkte ueber der
    // Unterkante, und die Leinwand ist doppelt so gross. Der Rahmen bei 34
    // Punkten liegt darunter und faellt heraus.
    const grund = [d[0], d[1], d[2]];
    const unten = c.height - (72 - 6) * 2;
    const oben = c.height - (72 + 24) * 2;
    const dunkel = (vonX, bisX) => {
      let n = 0;
      for (let y = oben; y < unten; y++) {
        for (let x = vonX; x < bisX; x++) {
          const i = (y * c.width + x) * 4;
          if (grund[0] - d[i] > 30) n++;
        }
      }
      return n;
    };
    return { links: dunkel(0, c.width >> 1), rechts: dunkel(c.width >> 1, c.width) };
  });
  // 1500 und nicht 200. Gemessen, weil die erste Zahl geraten war und die
  // Gegenprobe deshalb nicht gebissen hat: nimmt man den Zeitstempel wieder
  // heraus, bleiben in diesem Band 360 Punkte stehen - der senkrechte
  // Kartenrahmen, der durch jede Zeile laeuft. Mit Stempel sind es 3875. Die
  // Schwelle muss zwischen den beiden liegen, sonst prueft sie den Rahmen.
  check('Unten links steht weiterhin die Statuszeile', treffer.links > 1500, `${treffer.links} Punkte`);
  check('Unten rechts steht jetzt der Zeitstempel', treffer.rechts > 1500, `${treffer.rechts} Punkte`);
  await ctx.close();
}

await browser.close();
server.close();

const schlecht = befunde.filter((b) => !b.ok).length;
console.log(schlecht
  ? `\n  ${schlecht} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(schlecht ? 1 : 0);
