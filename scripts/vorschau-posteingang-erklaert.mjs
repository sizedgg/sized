/**
 * Ansems Posteingang, beschriftet.
 *
 * Sechs rote Kaesten mit je einem Satz daneben - fuer den Artikel, damit
 * jemand, der die Seite nie gesehen hat, die Liste lesen kann.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql        (einmal)
 *   node --experimental-strip-types scripts/dev-stack.mjs &
 *   node scripts/vorschau-posteingang-erklaert.mjs
 *
 * Aufgenommen, nicht gebaut: die Seite laeuft gegen den echten Stapel, das
 * Blatt kommt aus public/styles.css. Die Kaesten werden NICHT von Hand
 * gesetzt, sondern aus getBoundingClientRect() der echten Elemente - eine
 * Zahl im Skript waere beim naechsten Umbau falsch, ohne dass es auffaellt.
 *
 * Beschriftet wird im Rand, nicht auf der Seite: die Saetze stehen links
 * und rechts NEBEN dem Bildschirmfoto, mit einer duennen Linie zum Kasten.
 * Auf die Oberflaeche gelegt wuerden sie genau das verdecken, was sie
 * erklaeren.
 *
 * Drei Gespraeche werden vorher verborgen - sonst haette die Zeile
 * "3 conversations hidden by you" nichts zu zeigen, und der Kasten
 * darum waere ein Kasten um etwas, das es nur in der Theorie gibt.
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
const ANSEM = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';
const SKALA = 2;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

/** Meldet Ansem an und gibt sein Token zurueck. */
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

const ansem = await anmelden(ANSEM);
// Ohne Verwaltungsrechte gibt es keinen Posteingang, sondern ein einzelnes
// Gespraech - und das Bild waere ein anderes, ohne dass etwas fehlschlaegt.
if (ansem.istAdmin !== true) {
  throw new Error('Diese Sitzung ist keine Verwaltungssitzung - dev-stack mit '
    + 'aktueller app_config neu starten');
}

const ctx = await browser.newContext({
  // Etwas niedriger als die 900 der anderen Artikelbilder: der Verlauf
  // steht unten, und bei 900 klafft ueber der ersten Blase ein halbes Bild
  // Papier.
  viewport: { width: 1280, height: 820 }, deviceScaleFactor: SKALA,
});
const page = await ctx.newPage();
await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, ansem.jwt);
page.on('load', () => page.addStyleTag({ content: HIDE }).catch(() => {}));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: HIDE });
await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
await page.click('.tab[data-tab="dms"]');
await page.waitForSelector('.thread', { timeout: 25_000 });
await page.waitForTimeout(700);

/* --------------------------------------------------------------------------
 * Drei Gespraeche verbergen - ueber die Oberflaeche, nicht in der Datenbank.
 * Der Weg durch die Seite ist der, den Ansem auch geht; ein INSERT in
 * dm_hidden waere ein Zustand, von dem niemand weiss, ob er so entsteht.
 * ----------------------------------------------------------------------- */

// Erst zuruecksetzen. Ein zweiter Lauf haette sonst sechs verborgene
// Gespraeche und der Satz im Bild wuerde etwas anderes sagen als das Bild -
// beim ersten Mal faellt das auf, beim zehnten nicht mehr.
{
  const zeile = await page.$('#thread-versteckt');
  if (zeile && !(await zeile.isHidden())) {
    await page.click('#btn-versteckt');            // in die verborgenen
    await page.waitForTimeout(400);
    for (let i = 0; i < 60; i++) {
      const w = await page.evaluate(() =>
        document.querySelector('#thread-items .thread')?.dataset.wallet ?? null);
      if (!w) break;
      await page.click(`.thread[data-wallet="${w}"]`);
      await page.waitForSelector('#btn-hide-thread:not([hidden])', { timeout: 10_000 });
      await page.click('#btn-hide-thread');        // heisst hier "Unhide"
      await page.waitForTimeout(350);
    }
    await page.click('#btn-versteckt');            // zurueck
    await page.waitForTimeout(500);
  }
}

for (const i of [3, 6, 10]) {
  const wallet = await page.evaluate((n) =>
    document.querySelectorAll('.thread')[n]?.dataset.wallet ?? null, i);
  if (!wallet) continue;
  await page.click(`.thread[data-wallet="${wallet}"]`);
  await page.waitForSelector('#btn-hide-thread:not([hidden])', { timeout: 10_000 });
  await page.click('#btn-hide-thread');
  await page.waitForTimeout(500);
}
await page.waitForTimeout(600);
const verborgenText = (await page.textContent('#thread-versteckt-zahl').catch(() => '') ?? '').trim();
if (!/3 conversations hidden/.test(verborgenText)) {
  throw new Error(`Die Zeile fuer Verborgenes sagt: "${verborgenText}"`);
}

// Das eine Gespraech, das in der Saat von Hand geschrieben ist: vier
// Nachrichten, ein Hin und Her, und es ergibt aufgeklappt einen Sinn. Die
// 500 gewuerfelten sind fuer die Liste gemacht, nicht zum Aufklappen.
const LANG = 'Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs';
await page.click(`.thread[data-wallet="${LANG}"]`);
await page.waitForSelector('.dm-row', { timeout: 20_000 });
await page.waitForTimeout(900);

const zahlen = await page.evaluate(() => ({
  faeden: document.querySelectorAll('.thread').length,
  zeilen: document.querySelectorAll('.dm-row').length,
  eigene: document.querySelectorAll('.dm-row.mine').length,
}));
if (!zahlen.eigene) throw new Error('Im offenen Gespraech steht keine Antwort von Ansem');
if (zahlen.faeden < 15) throw new Error(`Nur ${zahlen.faeden} Gespraeche - das ist kein voller Posteingang`);

/* --------------------------------------------------------------------------
 * Die Kaesten
 *
 * Die Zeilen sind gemessen und nicht gewaehlt: Vorschau in der ERSTEN
 * Zeile, Betrag in einer aus der Mitte, das Kuerzel dazwischen. Drei
 * verschiedene Zeilen, damit sich die Linien zum Rand nicht kreuzen.
 * ----------------------------------------------------------------------- */

const { kaesten, gassen } = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  // Welche Zeilen beschriftet werden, wird gesucht und nicht gezaehlt.
  // Feste Nummern trafen zweimal daneben: einmal eine Zeile, deren
  // Vorschau "gm" war - ein Kasten um zwei Buchstaben zeigt nicht, was
  // "abgeschnitten" heisst -, und einmal eine mit dem blauen Punkt fuer
  // Ungelesenes, der im Kasten um den Betrag mit drinsteht.
  //
  // Gesucht wird deshalb nach dem, was die Zeile zeigen soll:
  //   Vorschau  eine wirklich abgeschnittene, und ohne "You:" davor - der
  //             Satz daneben redet von der Nachricht des anderen.
  //   Kuerzel   irgendeine darueber, aber nicht die erste: ueber der ersten
  //             sitzt der Kasten um die verborgenen Gespraeche.
  //   Betrag    eine aus der Mitte, ungelesen kommt nicht in Frage.
  const zeilen = [...document.querySelectorAll('#thread-items .thread')];
  // Abgeschnitten wird in der Vorlage, nicht im Text: im Element steht der
  // ganze Satz, die drei Punkte macht CSS. Also wird gemessen, ob er
  // hineinpasst, statt im Text nach Punkten zu suchen - danach zu suchen
  // war der erste Versuch, und er fand nie etwas.
  const abgeschnitten = (z) => {
    const v = z.querySelector('.thread-prev');
    return Boolean(v) && v.scrollWidth > v.clientWidth + 1 && !z.querySelector('.thread-du');
  };
  const vorschauZeile = zeilen.find((z, i) => i >= 3 && abgeschnitten(z));
  const kuerzelZeile = zeilen.find((z, i) => i >= 1 && z !== vorschauZeile);
  const betragZeile = zeilen.find((z, i) =>
    i >= 9 && z !== vorschauZeile && z !== kuerzelZeile && !z.classList.contains('is-unread'));

  const liste = rect(document.querySelector('.thread-list'));
  const fenster = rect(document.querySelector('.thread-view'));
  const verlauf = rect(document.querySelector('#admin-thread'));
  const ersteBlase = rect(document.querySelector('#admin-thread .dm-row'));

  return {
    kaesten: {
      schwelle: rect(document.querySelector('#dm-min-row')),
      verborgen: rect(document.querySelector('#thread-versteckt')),
      kuerzel: rect(kuerzelZeile?.querySelector('.h')),
      vorschau: rect(vorschauZeile?.querySelector('.thread-prev')),
      betrag: rect(betragZeile?.querySelector('.w')),
      verbergen: rect(document.querySelector('#btn-hide-thread')),
    },
    // Die Gassen, durch die die Linien laufen. Gemessen und nicht geraten:
    // links neben der Liste, in der Luecke zwischen Liste und Fenster, und
    // die freie Hoehe ueber der obersten Nachrichtenblase - der Verlauf
    // steht unten, oben ist Papier.
    gassen: {
      links: liste.x - 14,
      spalt: (liste.x + liste.w + fenster.x) / 2,
      frei: (verlauf.y + (ersteBlase ? ersteBlase.y : verlauf.y + 200)) / 2,
      // Mitte des Gespraechsfensters - dort steht das Wasserzeichen.
      fenstermitte: fenster.x + fenster.w / 2,
      blaseOben: ersteBlase ? ersteBlase.y : null,
      verlaufOben: verlauf.y,
    },
  };
});
for (const [name, k] of Object.entries(kaesten)) {
  if (!k || k.w < 4 || k.h < 4) throw new Error(`Kasten "${name}" ist leer oder winzig: ${JSON.stringify(k)}`);
}

// Zwei rote Kaesten, die sich schneiden, sind der eine Fehler, den man
// diesem Bild sofort ansieht. Die 5 Punkte Luft sind dieselben, die
// beschriften.py um das Element legt - wer sie dort aendert, aendert sie
// hier mit.
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
// Die Linie zum Betrag laeuft waagerecht durch das Fenster. Wenn dort keine
// Luft ueber der ersten Blase ist, faehrt sie mitten durch eine Nachricht -
// lieber hier stehenbleiben als das im fertigen Bild sehen.
if (!(gassen.blaseOben - gassen.verlaufOben > 90)) {
  throw new Error(`Ueber der ersten Blase sind nur ${Math.round(gassen.blaseOben - gassen.verlaufOben)} px frei`);
}

const foto = path.join(OUT, '.posteingang-roh.png');
await page.screenshot({ path: foto });
await browser.close();

/* --------------------------------------------------------------------------
 * Beschriften
 * ----------------------------------------------------------------------- */

const BESCHRIFTUNG = [
  { schluessel: 'schwelle', seite: 'links', route: 'korridor',
    text: 'Ansem sets this himself. Below it, nobody can write to him.' },
  { schluessel: 'verborgen', seite: 'links', route: 'korridor',
    text: 'Conversations he put away. One click brings them back.' },
  // eintritt: die Linie faehrt oben in den Kasten, nicht mittig - auf
  // halber Hoehe liefe sie durch das Kuerzel links daneben.
  { schluessel: 'kuerzel', seite: 'links', route: 'korridor',
    text: 'Who wrote: the first three characters of their address.' },
  // eintritt: die Linie faehrt oben in den Kasten, nicht mittig - auf
  // halber Hoehe liefe sie durch das Kuerzel links daneben.
  { schluessel: 'vorschau', seite: 'links', route: 'korridor', eintritt: 0.16,
    text: 'The last message, cut short.' },
  { schluessel: 'betrag', seite: 'rechts', route: 'spalt',
    text: 'What that wallet holds. The inbox is sorted by it, largest first.' },
  { schluessel: 'verbergen', seite: 'rechts', route: 'direkt',
    text: 'Takes this conversation out of the inbox. Nothing is deleted.' },
];

const plan = {
  foto,
  ziel: path.join(OUT, '5-posteingang-erklaert.png'),
  skala: SKALA,
  // Quer ueber das Foto, damit niemand die Liste fuer echte Halter und
  // echte Nachrichten haelt. Sie ist erfunden, jede Zeile davon - siehe
  // scripts/seed-ansem-voll.sql - und ein Bild dieser Art wandert weiter,
  // ohne den Satz mitzunehmen, der danebenstand.
  wasserzeichen: 'DEMO DATA',
  kaesten,
  gassen,
  beschriftung: BESCHRIFTUNG,
};
const planDatei = path.join(OUT, '.plan.json');
fs.writeFileSync(planDatei, JSON.stringify(plan, null, 2));

execFileSync('python3', [path.join(root, 'scripts', 'beschriften.py'), planDatei], { stdio: 'inherit' });
fs.rmSync(planDatei, { force: true });
fs.rmSync(foto, { force: true });

console.log(`\n  ${zahlen.faeden} Gespraeche sichtbar, 3 verborgen, `
  + `${zahlen.zeilen} Nachrichten im offenen Fenster`);
console.log(`  ${path.relative(root, plan.ziel)}\n`);
