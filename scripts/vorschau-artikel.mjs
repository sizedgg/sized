/**
 * Die vier Bilder fuer den Artikel.
 *
 * Aufgenommen, nicht gebaut: die Seite laeuft gegen den echten Stapel, das
 * Blatt kommt aus public/styles.css, und ueber die Bilder wird nichts
 * gelegt ausser dem Ausblenden der Entwicklungs-Schalter.
 *
 *   1  Anmeldung
 *   2  Ansems Posteingang, voll
 *   3  Ein Gespraech aus der Sicht eines Halters
 *   4  Die Abstimmungen
 *
 * Bild 3 ist der Grund, warum dieses Skript zweimal anmeldet. Die anderen
 * drei zeigen Ansems Seite; die dritte muss aus einer anderen Wallet kommen,
 * sonst waere es wieder die Verwaltungsansicht mit der Liste links - und
 * genau die sieht ein Halter nie. Wer nur Ansems Sitzung benutzt und die
 * Liste wegschneidet, bekommt ein Bild, das aussieht wie die Nutzersicht und
 * keine ist.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (einmal)
 *   node scripts/vorschau-artikel.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'artikel');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

const ANSEM = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
// Ein Halter mit einem echten Hin und Her. Ein Gespraech, in dem nur eine
// Seite geschrieben hat, zeigt die eigene Blase nicht, und die ist die
// groesste farbige Flaeche der Seite.
//
// Diese Adresse kommt aus der Saat und ist die einzige, mit der man sich
// anmelden KANN: die 500 anderen sind erfunden und werden von verify()
// abgewiesen - isSolanaAddress verlangt base58, das zu genau 32 Bytes
// dekodiert. Fuer die Liste im Posteingang reicht das, dort stehen nur drei
// Zeichen; fuer eine Anmeldung nicht.
const HALTER = '6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR';

const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

/** Meldet eine Wallet an und gibt ihr Token zurueck. */
async function tokenFuer(wallet) {
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

async function angemeldet(jwt, hoehe = 900) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: hoehe }, deviceScaleFactor: 2,
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

const ansem = await tokenFuer(ANSEM);
const halter = await tokenFuer(HALTER);

// Der Punkt des ganzen Skripts, deshalb wird er geprueft und nicht
// angenommen: die zweite Sitzung darf KEINE Verwaltungssitzung sein. Der
// lokale Stapel liest app_config einmal beim Start - steht dort eine alte
// Wallet, kommt fuer beide is_admin false oder true zurueck, und die Bilder
// zeigen zweimal dasselbe, ohne dass man es sieht.
console.log(`\n  Ansem  is_admin=${ansem.istAdmin}`);
console.log(`  Halter is_admin=${halter.istAdmin}`);
if (ansem.istAdmin !== true || halter.istAdmin !== false) {
  throw new Error('Die beiden Sitzungen unterscheiden sich nicht - dev-stack mit '
    + 'aktueller app_config neu starten');
}

// --- 1. Die Anmeldung -------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '1-anmeldung.png') });
  await ctx.close();
  console.log('  1  Anmeldung');
}

// --- 2. Ansems Posteingang --------------------------------------------------
{
  const { ctx, page } = await angemeldet(ansem.jwt, 900);
  await page.click('.tab[data-tab="dms"]');
  await page.waitForSelector('.thread', { timeout: 25_000 });
  await page.waitForTimeout(900);
  const n = await page.evaluate(() => document.querySelectorAll('.thread').length);

  // Mit geoeffnetem Gespraech. Ohne Auswahl steht rechts "Select a thread"
  // und zwei Drittel des Bildes sind leeres Papier - fuer einen Artikel ist
  // das die Haelfte der Ansicht, die weggelassen wird.
  //
  // Und zwar das LAENGSTE, nicht das erstbeste mit einer Antwort darin. Der
  // erste Versuch nahm das erste Gespraech, in dem Ansem geantwortet hatte;
  // das hatte zwei Nachrichten, und der rechte Bereich war wieder fast leer.
  // Diese Wallet ist der oberste Eintrag mit einem echten Hin und Her: sechs
  // Nachrichten, davon eine von Ansem, und mit 1,9 Mio. der reichste - also
  // ganz oben in der nach Bestand sortierten Liste, ohne dass gescrollt
  // werden muss.
  const LANG = 'xKGwnf2uA3U1W5JZQjryzqCM8PcoSFaZpFg5YTpRkTQP';
  await page.click(`.thread[data-wallet="${LANG}"]`);
  await page.waitForSelector('.dm-row', { timeout: 25_000 });
  await page.waitForTimeout(900);
  const offen = await page.evaluate(() => ({
    zeilen: document.querySelectorAll('.dm-row').length,
    eigene: document.querySelectorAll('.dm-row.mine').length,
  }));
  if (!offen.eigene) throw new Error('Im geoeffneten Gespraech steht keine Antwort von Ansem');
  if (offen.zeilen < 4) throw new Error(`Nur ${offen.zeilen} Nachrichten - zu leer fuer das Bild`);
  await page.screenshot({ path: path.join(OUT, '2-posteingang.png') });
  await ctx.close();
  console.log(`  2  Posteingang mit ${n} Gespraechen, offen: ${offen.zeilen} Nachrichten`);
}

// --- 3. Ein Gespraech, wie ein Halter es sieht ------------------------------
{
  const { ctx, page } = await angemeldet(halter.jwt, 900);
  await page.click('.tab[data-tab="dms"]');
  await page.waitForSelector('.dm-row', { timeout: 25_000 });
  await page.waitForTimeout(900);
  const zahlen = await page.evaluate(() => ({
    zeilen: document.querySelectorAll('.dm-row').length,
    eigene: document.querySelectorAll('.dm-row.mine').length,
    liste: document.querySelectorAll('.thread').length,
  }));
  // Ohne diese beiden Zeilen waere ein Bild ohne eigene Blase - oder mit
  // Ansems Posteingang darin - genauso durchgegangen.
  if (!zahlen.eigene) throw new Error('Keine eigene Nachricht im Bild');
  if (zahlen.liste) throw new Error('Die Verwaltungsliste ist sichtbar - das ist nicht die Nutzersicht');
  await page.screenshot({ path: path.join(OUT, '3-dm-halter.png') });
  await ctx.close();
  console.log(`  3  Gespraech, ${zahlen.zeilen} Nachrichten, davon ${zahlen.eigene} eigene`);
}

// --- 4. Die Abstimmungen ----------------------------------------------------
{
  const { ctx, page } = await angemeldet(halter.jwt, 980);
  await page.waitForSelector('.poll', { timeout: 25_000 });
  await page.waitForTimeout(800);
  const n = await page.evaluate(() => document.querySelectorAll('.poll').length);
  await page.screenshot({ path: path.join(OUT, '4-polls.png') });
  await ctx.close();
  console.log(`  4  ${n} Abstimmungen`);
}

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
