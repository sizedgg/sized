/**
 * Die Karte zu einer geschlossenen Abstimmung ueber die naechste Chain.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (einmal)
 *   node --experimental-strip-types scripts/dev-stack.mjs &
 *   node scripts/karte-chain.mjs
 *
 * Das Bild wird NICHT nachgebaut. Es ist die Karte, die die Seite selbst
 * zeichnet - dasselbe drawPoll(), dasselbe Blatt, derselbe Zeitstempel -,
 * abgeholt aus dem Vorschaufenster, das der Knopf oeffnet. Ein zweites
 * Zeichnen dieser Karte waere eine zweite Wahrheit darueber, wie sie
 * aussieht, und die beiden laufen auseinander, sobald jemand am Original
 * etwas aendert.
 *
 * Die Abstimmung dafuer wird angelegt und hinterher wieder geloescht. Sie
 * gehoert nicht in die Saat: dort stehen genau zwei, und die Artikelbilder
 * rechnen damit.
 *
 * Ihre Zahlen sind ECHT in dem Sinn, der hier moeglich ist - es stimmen
 * sechs Wallets aus der Saat ab, und auf den Balken steht die Summe ihrer
 * Bestaende. Die Betraege sind also nicht eingetragen, sondern kommen aus
 * denselben Halterzahlen wie ueberall sonst.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'artikel');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';
const SKALA = 2;
const HALTER = '6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR';
const FRAGE = 'Which chain should I cover next on stream?';
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const db = new pg.Client({
  connectionString: process.env.PGURL || 'postgres://root@/ansem_test?host=/tmp',
});
await db.connect();

/** Legt die Abstimmung an - geschlossen, drei Antworten, sechs Stimmen. */
async function anlegen() {
  await db.query('begin');
  await db.query(`alter table public.polls disable trigger all`);
  await db.query(`alter table public.poll_options disable trigger all`);
  await db.query(`alter table public.votes disable trigger all`);
  const { rows } = await db.query(
    `insert into public.polls (question, closes_at, closed, created_at)
     values ($1, now() - interval '2 days', true, now() - interval '5 days')
     returning id`, [FRAGE]);
  const poll = rows[0].id;
  await db.query(
    `insert into public.poll_options (poll_id, label, idx)
     values ($1,'Solana',1), ($1,'Hyperliquid',2), ($1,'Base',3)`, [poll]);

  // Wer abstimmt: sechs Wallets, nach Bestand ausgesucht, damit die drei
  // Balken von oben nach unten fallen. Dieselbe Ueberlegung wie in der Saat -
  // eine Karte, auf der der mittlere Balken der laengste ist, liest sich als
  // Fehler, auch wenn sie keiner ist.
  await db.query(`
    insert into public.votes (poll_id, option_id, wallet, weight_tokens, weight_usd, created_at)
    select $1, o.id, w.address, w.ui_amount, w.usd_value, now() - interval '3 days'
      from (select address, ui_amount, usd_value,
                   row_number() over (order by usd_value desc) as r
              from public.wallets
             where address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw') w
      join (values (2,1),(5,1),(6,2),(9,2),(12,3),(15,3)) as z(rang, idx) on z.rang = w.r
      join public.poll_options o on o.poll_id = $1 and o.idx = z.idx`, [poll]);
  await db.query(`
    insert into public.poll_totals (poll_id, option_id, votes, usd)
    select v.poll_id, v.option_id, count(*), sum(v.weight_usd)
      from public.votes v where v.poll_id = $1 group by v.poll_id, v.option_id`, [poll]);
  await db.query(`alter table public.votes enable trigger all`);
  await db.query(`alter table public.poll_options enable trigger all`);
  await db.query(`alter table public.polls enable trigger all`);
  await db.query('commit');

  const { rows: stand } = await db.query(
    `select o.label, t.usd::bigint as usd from public.poll_options o
       join public.poll_totals t on t.option_id = o.id
      where o.poll_id = $1 order by o.idx`, [poll]);
  const summe = stand.reduce((a, z) => a + Number(z.usd), 0);
  if (summe < 1_000_000) throw new Error(`Nur ${summe} Dollar Volumen - unter der Million`);
  for (let i = 1; i < stand.length; i++) {
    if (Number(stand[i].usd) >= Number(stand[i - 1].usd)) {
      throw new Error(`Balken ${i + 1} ist nicht kuerzer als der darueber: ${JSON.stringify(stand)}`);
    }
  }
  return { poll, stand, summe };
}

async function loeschen(poll) {
  await db.query(`delete from public.votes where poll_id = $1`, [poll]);
  await db.query(`delete from public.poll_totals where poll_id = $1`, [poll]);
  await db.query(`delete from public.poll_options where poll_id = $1`, [poll]);
  await db.query(`delete from public.polls where id = $1`, [poll]);
}

const { poll, stand, summe } = await anlegen();
console.log(`\n  ${FRAGE}`);
for (const z of stand) console.log(`    ${z.label.padEnd(12)} $${Number(z.usd).toLocaleString('en-US')}`);
console.log(`    ${'gesamt'.padEnd(12)} $${summe.toLocaleString('en-US')}\n`);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

let ziel;
try {
  // Anmelden - als Halter, nicht als Ansem: die Karte ist dieselbe, aber
  // Ansems Ansicht traegt zusaetzlich den Loeschen-Knopf, und der eine
  // Fehlklick darauf waere hier teuer.
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p1 = await ctx1.newPage();
  await p1.goto(BASE, { waitUntil: 'networkidle' });
  await p1.fill('#wallet-input', HALTER);
  await p1.click('#btn-challenge');
  await p1.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  const id = await p1.evaluate(() =>
    JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);
  await p1.evaluate(async (cid) => {
    await fetch('/functions/v1/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId: cid }),
    });
  }, id);
  await p1.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  const jwt = await p1.evaluate(() => localStorage.getItem('ansem_jwt'));
  await ctx1.close();

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: SKALA,
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, jwt);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForSelector(`#poll-${poll}`, { timeout: 25_000 });
  await page.waitForTimeout(600);

  // Der Knopf, den auch ein Besucher druecken wuerde.
  await page.click(`#poll-${poll} .poll-image`);
  await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 20_000 });
  await page.waitForTimeout(400);

  const daten = await page.evaluate(async () => {
    const img = document.querySelector('#bild-dialog-bild');
    const antwort = await fetch(img.src);
    const blob = await antwort.blob();
    return await new Promise((fertig) => {
      const leser = new FileReader();
      leser.onload = () => fertig(leser.result);
      leser.readAsDataURL(blob);
    });
  });
  const stempel = (await page.textContent('#bild-dialog-stempel')) ?? '';

  ziel = path.join(OUT, '7-karte-chain.png');
  fs.writeFileSync(ziel, Buffer.from(daten.split(',')[1], 'base64'));
  const { width, height } = await page.evaluate(() => {
    const img = document.querySelector('#bild-dialog-bild');
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  await ctx.close();
  console.log(`  Karte ${width}x${height}, Stempel: ${stempel.trim()}`);

  // Das Wasserzeichen: klein, unten links, wo auf der Karte nichts steht.
  // Auf die Mitte gelegt liegt es auf den Balken, und die sind der Inhalt.
  const plan = path.join(OUT, '.plan-karte.json');
  fs.writeFileSync(plan, JSON.stringify({
    foto: ziel, ziel, skala: 1, rand: 0,
    wasserzeichen: 'DEMO DATA',
    kaesten: {}, beschriftung: [],
    gassen: {
      wasser: {
        x: width * 0.5, y: height * 0.855,
        groesse: Math.round(width * 0.026),
        // beschriften.py sieht nach, ob dort wirklich nichts steht.
        pruefen: true,
      },
    },
  }));
  execFileSync('python3', [path.join(root, 'scripts', 'beschriften.py'), plan], { stdio: 'pipe' });
  fs.rmSync(plan, { force: true });
  console.log(`  ${path.relative(root, ziel)}\n`);
} finally {
  await browser.close();
  await loeschen(poll);
  await db.end();
}
