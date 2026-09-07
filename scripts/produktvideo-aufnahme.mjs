// ============================================================================
// Nimmt die Rohclips fuer das Produktvideo auf
//
// Drei getrennte Aufnahmen statt einer langen: Anmeldung, Abstimmung,
// Posteingang. Ein einziger Durchlauf waere zwar "echter", aber jeder Patzer
// – ein Klick daneben, eine Antwort, die eine Sekunde laenger braucht –
// zwaenge zur Wiederholung des Ganzen. Drei Clips lassen sich einzeln neu
// aufnehmen, und der Schnitt braucht die Grenzen ohnehin.
//
// Aufgenommen wird gegen den lokalen Stack (scripts/dev-stack.mjs), nicht
// gegen sized.gg: Die echte Seite hat weder Abstimmungen noch Gespraeche, und
// eine Zahlung auf der Kette dauert im Video zu lange. Der Posteingang kommt
// aus dem Demo-Modus – erfundene Gespraeche, im fertigen Video sichtbar so
// beschriftet.
//
// ----------------------------------------------------------------------------
// VORHER: die eigene Stimme loeschen
//
//   psql "$PGURL_DEV" -c "delete from public.votes where wallet =
//     '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j'"
//
// Sonst steht der Haken schon vor dem Klick. Beim ersten Durchlauf faellt das
// nicht auf, ab dem zweiten zeigt der Abstimmungsclip eine Auswahl, die sich
// beim Klicken nicht aendert – eine Aufnahme davon, wie nichts passiert.
//
//   node scripts/produktvideo-aufnahme.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUS = path.join(root, 'video-roh');
const BASIS = process.env.BASIS || 'http://localhost:4000';
// Aufgenommen wird in voller Auflaesung, vergroessert wird die SEITE.
//
// Der erste Anlauf nahm bei 960x540 auf und wollte auf 1920x1080 ausgeben.
// Playwright skaliert dabei aber nicht, es legt das kleine Bild grau gerahmt
// in die Ecke – nachgesehen, nachdem der erste Schnitt seltsam aussah.
//
// Der Grund fuer den Umweg bleibt richtig: Die Seite hat eine feste
// Hoechstbreite und waechst nicht mit dem Fenster, bei echten 1920 Pixeln
// klebt sie im oberen Drittel. Nur ist der Hebel die Vergroesserung der
// Seite (zoom), nicht ein kleineres Fenster – so entsteht das Bild von
// vornherein in 1920x1080 und muss nirgends hochgerechnet werden.
const BREITE = 1920;
const HOEHE = 1080;
const ZOOM_ENG = 2;      // Anmeldung und Abstimmung: eine Spalte
// Der Posteingang bleibt bei 1. Vergroessert man ihn, passt die zweispaltige
// Ansicht nicht mehr in die Hoehe: Die Liste laeuft unten aus dem Bild und das
// Eingabefeld des Gespraechs verschwindet. Er fuellt den Rahmen ohnehin, weil
// er im Gegensatz zu den anderen beiden die ganze Breite nutzt.
const ZOOM_BREIT = 1;

// Zwei Dinge, die es nur im lokalen Stack gibt und die im Video eine
// Unwahrheit waeren:
//
//   #btn-mock-pay  "Simulate payment (mock mode)" – auf sized.gg gibt es
//                  keinen Knopf, der eine Zahlung vortaeuscht.
//   der Hinweis    "Live updates unavailable" – der lokale Stack kann kein
//                  Realtime, die echte Seite schon.
//
// Beide werden ausgeblendet statt umgangen: Wer das Video sieht, soll die
// Seite sehen, die es wirklich gibt.
const nurLokalVerstecken = (zoom) => `
  :root { zoom: ${zoom}; }
  #btn-mock-pay { display: none !important; }
  #toast { display: none !important; }
`;

// Die Adresse, die im Video eingetippt wird. Echt aussehend, aber niemandem
// gehoerend – base58, 44 Zeichen.
const NUTZER = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';
const ANSEM  = 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52';

fs.rmSync(AUS, { recursive: true, force: true });
fs.mkdirSync(AUS, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Der Posteingang braucht mehr Breite als die anderen beiden: Er ist
// zweispaltig, Liste links, Gespraech rechts. Bei 960 Pixeln quetschen sich
// die Betraege an den Rand.
async function clip(name, fn, zoom = ZOOM_ENG) {
  const ctx = await browser.newContext({
    viewport: { width: BREITE, height: HOEHE },
    deviceScaleFactor: 1,
    recordVideo: { dir: AUS, size: { width: BREITE, height: HOEHE } },
  });
  const page = await ctx.newPage();
  const stil = nurLokalVerstecken(zoom);
  // Bei jedem Seitenaufbau neu: addStyleTag haengt am Dokument, und das ist
  // nach einem goto ein anderes.
  page.on('load', () => page.addStyleTag({ content: stil }).catch(() => {}));
  await page.addStyleTag({ content: stil }).catch(() => {});
  try {
    await fn(page, ctx);
  } finally {
    const video = page.video();
    await ctx.close();                       // erst danach ist die Datei fertig
    const roh = await video.path();
    const ziel = path.join(AUS, `${name}.webm`);
    fs.renameSync(roh, ziel);
    const kb = Math.round(fs.statSync(ziel).size / 1024);
    console.log(`  ${name}.webm  ${kb} KB`);
  }
}

/** Tippt Zeichen fuer Zeichen, damit es im Video nach Tippen aussieht. */
const tippe = async (page, sel, text, ms = 45) => {
  await page.click(sel);
  await page.type(sel, text, { delay: ms });
};

/** Holt den JWT aus einer abgeschlossenen Anmeldung, fuer die naechsten Clips. */
async function meldeAn(page, wallet) {
  await page.goto(BASIS, { waitUntil: 'networkidle' });
  await page.fill('#wallet-input', wallet);
  await page.click('#btn-challenge');
  await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  const id = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('ansem_challenge') || 'null');
    return c?.challengeId ?? null;
  });
  await page.evaluate(async (challengeId) => {
    await fetch('/functions/v1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId }),
    });
  }, id);
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  return page.evaluate(() => localStorage.getItem('ansem_jwt'));
}

// ---------------------------------------------------------------------------
// 1. Anmelden ohne Wallet
// ---------------------------------------------------------------------------
console.log('\nAufnahme:');

let jwt = null;

await clip('1-anmelden', async (page) => {
  await page.goto(BASIS, { waitUntil: 'networkidle' });
  await schlaf(1200);

  await tippe(page, '#wallet-input', NUTZER, 38);
  await schlaf(700);
  await page.click('#btn-challenge');

  // Der Betrag erscheint. Hier stehenbleiben – das ist das Bild, um das es
  // geht: eine Zahl und eine Adresse, kein Wallet-Fenster, keine Signatur.
  await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await schlaf(2600);

  const id = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);

  // Die Uhr laufen lassen – im Schnitt wird dieser Teil beschleunigt.
  await schlaf(3000);

  await page.evaluate(async (challengeId) => {
    await fetch('/functions/v1/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId }),
    });
  }, id);

  // Drin ist man, wenn #app sichtbar wird – nicht, wenn #step-pay verschwindet.
  // Das war der erste Anlauf, und er lief in einen Zeitfehler: Beim Anmelden
  // wird der ganze Anmeldeschirm ausgeblendet, #step-pay bleibt darunter
  // stehen wie es war. Die Bedingung wurde also nie wahr, obwohl die Anmeldung
  // laengst durch war (die Challenge stand in der Datenbank auf "used").
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  await schlaf(2200);
  jwt = await page.evaluate(() => localStorage.getItem('ansem_jwt'));
});

// ---------------------------------------------------------------------------
// 2. Abstimmen
// ---------------------------------------------------------------------------
await clip('2-abstimmen', async (page, ctx) => {
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ }
  }, jwt);
  await page.goto(BASIS, { waitUntil: 'networkidle' });
  await page.waitForSelector('.opt', { timeout: 20_000 });
  await schlaf(1800);

  // Auf die Antwort zeigen, kurz warten, dann waehlen. Der Zeiger macht
  // sichtbar, dass hier jemand handelt und nicht die Seite von selbst laeuft.
  const ziel = page.locator('.opt').nth(2);
  await ziel.hover();
  await schlaf(800);
  await ziel.click();
  await schlaf(3000);

  // Einmal ueber die Balken fahren: zwei Zahlen pro Antwort, Stimmen und $.
  await page.locator('.opt').nth(0).hover();
  await schlaf(900);
  await page.locator('.opt').nth(3).hover();
  await schlaf(1400);
});

// ---------------------------------------------------------------------------
// 3. Ansems Posteingang (Demo-Daten)
// ---------------------------------------------------------------------------
await clip('3-posteingang', async (page) => {
  await meldeAn(page, ANSEM);
  await page.goto(`${BASIS}/?demo=60`, { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="dms"]');
  await schlaf(2000);

  // Der Posteingang ist nach Bestand sortiert, groesster zuerst. Langsam
  // scrollen, damit man die Reihenfolge sieht.
  await page.mouse.move(BREITE * 0.25, HOEHE * 0.6);
  for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, 120); await schlaf(260); }
  await schlaf(700);
  for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, -120); await schlaf(200); }
  await schlaf(600);

  const faden = page.locator('.thread').first();
  if (await faden.count()) {
    await faden.hover();
    await schlaf(600);
    await faden.click();
    await schlaf(2600);
  }
}, ZOOM_BREIT);

await browser.close();
console.log(`\nRohclips in ${path.relative(root, AUS)}/\n`);
