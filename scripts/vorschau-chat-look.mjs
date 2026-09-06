// ============================================================================
// Vorschaubild: Wie soll der Chat aussehen?
//
// Ausgangspunkt: Polls und Ansems Posteingang liegen in umrandeten, gerundeten
// Flächen auf dem Seitengrund. Der Chat ist als einziger Bereich randlos – die
// Filterleiste ist ein fensterbreites Band, die Nachrichten laufen bis an den
// Rand, die Eingabe hängt unten an einer durchgehenden Linie. Genau das ist der
// Unterschied, der ihn unfertig wirken lässt.
//
// Erzeugt preview/chat-look.png: derselbe Chat viermal untereinander.
//
// Die Vorlage ist das echte Markup aus msgHtml() – Klassennamen, Reihenfolge
// und Verschachtelung stimmen mit app.js überein. Nur so zeigt das Bild, was
// das echte Stylesheet daraus macht, statt eine hübsche Attrappe zu sein.
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// --- Der gemeinsame Grundstock: Chat in einer Fläche -------------------------
// Die Werte sind aus .thread-view und .poll übernommen, nicht neu erfunden.
const PANEL = `
  .chat-panel {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--bg-1); overflow: hidden;
  }
  /* Die Filterleiste wird zur Kopfzeile der Fläche: Ihre Linie endet jetzt am
     Rand der Fläche statt am Fensterrand. */
  .chat-panel .filters { padding: .7rem .9rem; }
  .chat-panel .chat-list { padding: .9rem; }
  .chat-panel .composer { padding: .7rem .9rem; border-top: 1px solid var(--line); }
  /* Eingabefelder in einer Fläche liegen tiefer als die Fläche – dieselbe
     Regel, nach der .poll-admin input schon var(--bg) benutzt. Auf var(--bg-1)
     wären sie randlos unsichtbar. */
  .chat-panel .composer input,
  .chat-panel .filter-group { background: var(--bg); }
  /* Der Zeigerhinweis muss eine Stufe höher, sonst deckt er sich mit der
     Fläche und die Zeile reagiert scheinbar nicht. */
  .chat-panel .msg:hover { background: var(--bg-2); }
`;

// --- Nachrichten als Blasen, wie in den DMs ---------------------------------
const BLASEN = `
  @ .chat-list { gap: .35rem; }
  @ .msg {
    width: fit-content; max-width: 86%;
    padding: .42rem .7rem;
    border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg-2);
  }
  @ .msg:hover { background: var(--bg-3); }
  @ .msg .meta { align-self: end; }
`;

// --- Zweiter Durchgang: die Spalte vor dem Text ----------------------------
// Blasen legen sich um ihren Inhalt, also fängt jede Zeile woanders an – und
// weil der Betrag mal "$3" und mal "$781.42K" breit ist, rutscht der Text bei
// jeder Nachricht an eine andere Stelle. Dagegen hilft nur eines: Kürzel und
// Betrag stehen in einer Spalte fester Breite, und der Text beginnt dahinter
// immer am selben Punkt.
//
// Die Breite ist nicht geraten. fmtUsd() kürzt ab 10.000 auf "$31.5K", der
// längste Fall ist damit achtstellig ("$781.42K"). Acht Zeichen Schreibmaschine
// plus Innenabstand der Pille plus drei Zeichen Kürzel plus Zwischenraum – das
// ergibt die 7,1rem unten, mit etwas Luft für ein längeres Tokenkürzel als
// "ANSEM".
const SPALTE = (extra = '') => `
  ${BLASEN}
  @ .msg .who {
    display: inline-grid; grid-template-columns: 3ch minmax(0, 1fr);
    align-items: center; gap: .35rem; width: 7.1rem;
  }
  /* Der Betrag liegt jetzt auf der helleren Blase statt auf dem Seitengrund.
     Damit die Pille dort nicht verschwindet, wird sie eine Spur deutlicher. */
  @ .worth {
    background: rgba(255, 255, 255, .05);
    border-color: var(--bg-3);
  }
  ${extra}
`;

// --- Dritter Durchgang: der Betrag ohne eigene Blase ------------------------
// Die Pille war ein Kasten in einem Kasten – sobald die Nachricht selbst eine
// Blase ist, ist das eine Umrandung zu viel. Der Betrag steht jetzt als blosse
// Zahl da.
//
// Und er ist kurz: kurzUsd() kuerzt ab tausend mit K, sodass nie mehr als drei
// Ziffernstellen dastehen ($1.4K statt $1,412). Damit ist der laengste Fall
// fuenf Zeichen breit ($781K, $1.2M) – die Spalte kann eng sein, ohne je
// ueberzulaufen.
const NACKT = (extra = '') => `
  ${BLASEN}
  @ .msg .who {
    display: inline-grid; grid-template-columns: 3ch 5ch;
    align-items: baseline; gap: .55rem; width: auto;
  }
  /* Keine Blase mehr um den Betrag: kein Rahmen, kein Grund, kein Innenabstand.
     Die feste Breite kommt jetzt aus der Rasterspalte, nicht aus der Pille. */
  @ .worth {
    display: block; height: auto; padding: 0;
    background: none; border: 0; border-radius: 0;
    font-size: .82rem; text-align: right;
  }
  ${extra}
`;

const ZAHL_SATZ = [
  {
    nr: 1,
    name: 'Rechtsbündig, hell',
    hinweis: 'Die Zahl steht rechtsbündig in ihrer Spalte, in voller Helligkeit. Tausender stehen unter Tausendern.',
    css: NACKT(),
  },
  {
    nr: 2,
    name: 'Rechtsbündig, gedämpft',
    hinweis: 'Dieselbe Anordnung, die Zahl aber eine Stufe leiser – sie begleitet den Namen, statt mit ihm um Aufmerksamkeit zu ringen.',
    css: NACKT('@ .worth { color: var(--dim); }'),
  },
  {
    nr: 3,
    name: 'Linksbündig am Kürzel',
    hinweis: 'Die Zahl beginnt direkt hinter dem Kürzel. Zwei linke Kanten – dafür stehen die Ziffern nicht mehr untereinander.',
    css: NACKT('@ .worth { text-align: left; }'),
  },
  {
    nr: 4,
    name: 'Rechtsbündig, hell, kleiner',
    hinweis: 'Wie 1, die Zahl aber deutlich kleiner gesetzt. Der Name führt, der Betrag folgt.',
    css: NACKT('@ .worth { font-size: .72rem; }'),
  },
];

const SPALTEN_SATZ = [
  {
    nr: 1,
    name: 'Pille links',
    hinweis: 'Kürzel und Pille beginnen beide an fester Stelle, der Text ebenfalls. Drei linke Kanten, die untereinander stehen – die Pille selbst ist mal breiter, mal schmaler.',
    css: SPALTE('@ .worth { justify-self: start; }'),
  },
  {
    nr: 2,
    name: 'Pille rechts',
    hinweis: 'Die Pille rückt an den Text heran und schließt bündig an ihn an. Dafür wandert der Zwischenraum hinter das Kürzel und wird bei kleinen Beträgen groß.',
    css: SPALTE('@ .worth { justify-self: end; }'),
  },
  {
    nr: 3,
    name: 'Pille fest, Zahl rechtsbündig',
    hinweis: 'Die Pille hat immer dieselbe Breite, die Zahl steht rechts darin. Damit stehen auch Tausender unter Tausendern – Beträge lassen sich untereinander vergleichen, ohne sie zu lesen.',
    css: SPALTE(`
      @ .worth { justify-self: stretch; justify-content: flex-end; }
    `),
  },
  {
    nr: 4,
    name: 'Pille fest, Zahl mittig',
    hinweis: 'Wie 3, die Zahl steht aber mittig in der Pille – so wie bisher im Chat.',
    css: SPALTE('@ .worth { justify-self: stretch; }'),
  },
];

const FLAECHEN_SATZ = [
  {
    nr: 1,
    name: 'Jetzt',
    hinweis: 'Der Stand von heute, zum Vergleich. Randlos – als einziger Bereich der Seite.',
    css: `
      @ .chat-panel { border: 0; background: none; border-radius: 0; overflow: visible; }
      @ .chat-panel .filters { padding: .7rem 0; }
      @ .chat-panel .chat-list { padding: .9rem 0; }
      @ .chat-panel .composer { padding: .7rem 0 0; }
      @ .chat-panel .composer input, @ .chat-panel .filter-group { background: var(--bg-1); }
      @ .chat-panel .msg:hover { background: var(--bg-1); }
    `,
  },
  {
    nr: 2,
    name: 'Fläche',
    hinweis: 'Der ganze Chat in einer umrandeten Fläche, wie ein Poll und wie Ansems Posteingang. An den Nachrichten selbst ändert sich nichts.',
    css: '',
  },
  {
    nr: 3,
    name: 'Fläche + Blasen',
    hinweis: 'Zusätzlich bekommt jede Nachricht eine Blase, die sich um ihren Inhalt legt – wie in den DMs. Einzeilig bleibt einzeilig.',
    css: BLASEN,
  },
  {
    nr: 4,
    name: 'Fläche + Blasen, eigene rechts',
    hinweis: 'Wie 3, dazu stehen die eigenen Nachrichten rechts und grün – genau wie im DM-Verlauf.',
    css: `
      ${BLASEN}
      @ .msg.mine {
        margin-left: auto;
        background: rgba(20, 241, 149, .14); border-color: rgba(20, 241, 149, .3);
      }
      @ .msg.mine:hover { background: rgba(20, 241, 149, .19); }
    `,
  },
];

// --- Vierter Durchgang: andere Wege -----------------------------------------
// Blasen sind gescheitert, und zwar an einer Sache, die vorher nicht sichtbar
// war: Im Chat steht vor jedem Text noch etwas – Kuerzel und Betrag. Eine
// Blase legt sich um ihren Inhalt, also fangen alle drei Dinge bei jeder
// Nachricht woanders an, und jeder Versuch, das zu ordnen, hat den Betrag
// weiter eingezwaengt.
//
// Der Ausweg kommt aus dem Posteingang, dem Teil, der am besten funktioniert:
// Dort steht der Betrag NICHT neben dem Namen, sondern ganz rechts am
// Zeilenende. Damit ist die Reihenfolge Name – Text – Betrag, und alle drei
// haben ihre eigene Spalte, die ueber die ganze Liste haelt.
//
// Voraussetzung dafuer ist eine kleine Aenderung am Markup: .worth muss ein
// Geschwister von .who sein statt darin zu stecken, sonst laesst es sich nicht
// ans andere Ende der Zeile setzen. Genau das machen diese vier Varianten.
const ZEILE = `
  @ .msg {
    grid-template-columns: 3.2rem minmax(0, 1fr) auto auto;
    grid-template-areas: "who body worth meta";
    gap: .2rem .7rem; padding: .32rem .5rem;
  }
  @ .msg.has-quote { grid-template-areas: "quote quote quote quote" "who body worth meta"; }
  @ .msg .worth { grid-area: worth; }
  /* Der Betrag steht am Zeilenende, direkt vor der Uhrzeit – dieselbe
     Reihenfolge wie in Ansems Posteingang. Keine Umrandung: In einer Spalte,
     die ohnehin haelt, braucht die Zahl keinen eigenen Kasten. */
  @ .worth {
    display: block; height: auto; padding: 0;
    background: none; border: 0; border-radius: 0;
    font-size: .78rem; text-align: right; min-width: 3.4rem;
  }
`;

const WEGE_SATZ = [
  {
    nr: 1,
    name: 'Betrag ans Zeilenende',
    markup: 'geschwister',
    hinweis: 'Name links, Text daneben, Betrag und Uhrzeit rechts – die Reihenfolge aus dem Posteingang. Der Text beginnt immer an derselben Stelle, weil vor ihm nur noch das dreistellige Kürzel steht.',
    css: ZEILE,
  },
  {
    nr: 2,
    name: 'Betrag rechts, Zeilen getrennt',
    markup: 'geschwister',
    hinweis: 'Wie 1, dazu eine Haarlinie zwischen den Zeilen und mehr Luft – der Verlauf liest sich dann wie die Liste im Posteingang.',
    css: `
      ${ZEILE}
      @ .chat-list { gap: 0; padding: 0; }
      @ .msg { padding: .5rem .9rem; border-bottom: 1px solid var(--line); border-radius: 0; }
      @ .msg:last-child { border-bottom: 0; }
    `,
  },
  {
    nr: 3,
    name: 'Absenderzeile darüber',
    markup: 'geschwister',
    hinweis: 'Name, Betrag und Uhrzeit stehen in einer eigenen kleinen Zeile, der Text darunter über die volle Breite. Vor dem Text steht dann gar nichts mehr, was ihn verschieben könnte.',
    css: `
      @ .msg {
        grid-template-columns: auto auto minmax(0, 1fr);
        grid-template-areas: "who worth meta" "body body body";
        gap: .1rem .5rem; padding: .35rem .5rem;
      }
      @ .msg.has-quote { grid-template-areas: "who worth meta" "quote quote quote" "body body body"; }
      @ .msg .worth { grid-area: worth; }
      @ .msg .meta { justify-self: start; }
      @ .worth {
        display: block; height: auto; padding: 0;
        background: none; border: 0; border-radius: 0;
        font-size: .76rem; color: var(--dim);
      }
      @ .msg .time { font-size: .7rem; }
      @ .chat-list { gap: .5rem; }
    `,
  },
  {
    nr: 4,
    name: 'Feste Namensspalte',
    markup: 'geschwister',
    hinweis: 'Name und Betrag stehen zusammen in einer schmalen Spalte am linken Rand, durch eine senkrechte Linie vom Text getrennt. Rechts bleibt nur die Uhrzeit.',
    css: `
      @ .msg {
        grid-template-columns: 3.2rem 3.6rem minmax(0, 1fr) auto;
        grid-template-areas: "who worth body meta";
        gap: .2rem .7rem; padding: .32rem .5rem;
      }
      @ .msg.has-quote { grid-template-areas: "quote quote quote quote" "who worth body meta"; }
      @ .msg .worth { grid-area: worth; }
      @ .worth {
        display: block; height: auto; padding: 0 .7rem 0 0;
        background: none; border: 0; border-right: 1px solid var(--line); border-radius: 0;
        font-size: .78rem; text-align: right;
      }
    `,
  },
];

// --- Fuenfter Durchgang: die Liste feinjustieren ----------------------------
// Der Weg steht fest: eine Liste gleichfoermiger Zeilen in der Flaeche, Betrag
// rechtsbuendig in einer eigenen Spalte. Was hier noch variiert, ist nur die
// Dichte, die Staerke der Trennlinie und das Gewicht des Betrags.
const LISTE = `
  ${ZEILE}
  @ .chat-list { gap: 0; padding: 0; }
  @ .msg { padding: .5rem .9rem; border-bottom: 1px solid var(--line); border-radius: 0; }
  @ .msg:last-child { border-bottom: 0; }
`;

const LISTE_SATZ = [
  {
    nr: 1,
    name: 'Wie gehabt',
    markup: 'geschwister',
    hinweis: 'Variante 2 von eben, unverändert – der Bezugspunkt für die anderen fünf.',
    css: LISTE,
  },
  {
    nr: 2,
    name: 'Linie leiser',
    markup: 'geschwister',
    hinweis: 'Dieselbe Zeile, die Trennlinie aber deutlich schwächer. Sie gliedert noch, tritt aber hinter den Text zurück.',
    css: `${LISTE}
      @ .msg { border-bottom-color: rgba(255, 255, 255, .045); }
    `,
  },
  {
    nr: 3,
    name: 'Betrag ganz außen',
    markup: 'geschwister',
    hinweis: 'Uhrzeit und Betrag tauschen den Platz: Der Betrag steht als letztes am Rand – genau wie in Ansems Posteingang, wo er die äußerste Spalte ist.',
    css: `${LISTE}
      @ .msg { grid-template-areas: "who body meta worth"; }
      @ .msg.has-quote { grid-template-areas: "quote quote quote quote" "who body meta worth"; }
    `,
  },
  {
    nr: 4,
    name: 'Enger',
    markup: 'geschwister',
    hinweis: 'Weniger Höhe je Zeile. Man sieht mehr vom Verlauf, ohne zu scrollen – in einem lebhaften Raum zählt das.',
    css: `${LISTE}
      @ .msg { padding: .33rem .9rem; }
    `,
  },
  {
    nr: 5,
    name: 'Luftiger',
    markup: 'geschwister',
    hinweis: 'Mehr Höhe je Zeile. Ruhiger zu lesen, dafür passt weniger ins Fenster.',
    css: `${LISTE}
      @ .msg { padding: .7rem .9rem; }
    `,
  },
  {
    nr: 6,
    name: 'Betrag kräftiger',
    markup: 'geschwister',
    hinweis: 'Wie 1, der Betrag aber in der Größe des Textes statt kleiner. Er ist der Kern der Seite – hier bekommt er das Gewicht dafür.',
    css: `${LISTE}
      @ .worth { font-size: .88rem; font-weight: 650; }
    `,
  },
];

// node scripts/vorschau-chat-look.mjs           -> die vier Stufen
// node scripts/vorschau-chat-look.mjs spalten   -> die Spalte vor dem Text
const SAETZE = {
  liste: {
    datei: 'preview/chat-liste.png',
    titel: 'Der Chat – die Liste feinjustiert',
    lead: 'Alle sechs sind Variante 2: Liste in der Fläche, Betrag rechtsbündig in eigener Spalte. Unterschiedlich sind Dichte, Trennlinie und das Gewicht des Betrags.',
    varianten: LISTE_SATZ,
    nurListe: true,
    hoehe: 'auto',
  },
  wege: {
    datei: 'preview/chat-wege.png',
    titel: 'Der Chat – vier andere Wege',
    lead: 'Ohne Blasen. Alle vier liegen in der Fläche und kürzen den Betrag auf höchstens drei Ziffernstellen; unterschiedlich ist, wo Name, Betrag und Uhrzeit stehen.',
    varianten: WEGE_SATZ,
  },
  flaechen: {
    datei: 'preview/chat-look.png',
    titel: 'Der Chat',
    lead: 'Polls und Ansems Posteingang liegen in umrandeten Flächen. Der Chat ist der einzige Bereich ohne – hier vier Stufen, ihn anzugleichen.',
    varianten: FLAECHEN_SATZ,
  },
  zahl: {
    datei: 'preview/chat-zahl.png',
    titel: 'Der Chat – der Betrag ohne eigene Blase',
    lead: 'Alle vier haben Fläche und Blasen. Der Betrag hat keine Umrandung mehr und ist gekürzt: ab tausend mit K, nie mehr als drei Ziffernstellen. Der Text beginnt überall an derselben Stelle.',
    varianten: ZAHL_SATZ,
  },
  spalten: {
    datei: 'preview/chat-spalten.png',
    titel: 'Der Chat – wo der Text anfängt',
    lead: 'Alle vier haben die Fläche und die Blasen aus Variante 3. Unterschiedlich ist nur, wie Kürzel und Betrag in der festen Spalte davor sitzen. Der Text beginnt überall an derselben Stelle.',
    varianten: SPALTEN_SATZ,
  },
};

const SATZ = SAETZE[process.argv[2] || 'flaechen'];
if (!SATZ) throw new Error(`Unbekannter Satz: ${process.argv[2]}`);
const VARIANTEN = SATZ.varianten;

// --- Der kurze Betrag ------------------------------------------------------
// Spiegelt kurzUsd() aus app.js. Die verbindliche Fassung steht dort und wird
// von scripts/test-realtime-switching.mjs geprueft; hier liegt sie nur, damit
// das Vorschaubild ohne app.js auskommt.
//
// Regel: nie mehr als drei Ziffernstellen. Unter 1000 die ganze Zahl, darueber
// mit K/M/B abgekuerzt – eine Nachkommastelle nur, solange die Vorzahl
// einstellig bleibt.
const STUFEN = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function kurzUsd(n) {
  if (!n || n <= 0) return '$0';
  if (n < 1) return '<$1';
  const gerundet = Number(n.toPrecision(3));
  for (const [ab, kurz] of STUFEN) {
    if (gerundet < ab) continue;
    const wert = gerundet / ab;
    return '$' + (wert < 9.95 ? wert.toFixed(1) : String(Math.round(wert))) + kurz;
  }
  return '$' + Math.round(gerundet);
}

// --- Nachrichten, gebaut wie msgHtml() in app.js ----------------------------
const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: 3444, body: 'gm', zeit: '14:02' },
  { h: '4tP', ton: 4, usd: 50, body: 'wen moon', zeit: '14:02',
    zitat: { h: 'Km9', ton: 3, text: 'is this thing on' } },
  { admin: true, body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'bH2', ton: 1, usd: 8820, zeit: '14:04',
    body: 'this is the longest single word i can think of right now: Donaudampfschifffahrtsgesellschaftskapitaenswitwe' },
  { h: 'Km9', ton: 3, usd: 1302, body: 'lfg', zeit: '14:05' },
  // Ab 10.000 kuerzt fmtUsd() auf "$31.5K" – der laengste Fall, den die feste
  // Spalte tragen muss, steht deshalb hier drin und nicht in einer Fussnote.
  { h: 'zQ4', ton: 0, usd: 781420, zeit: '14:06',
    body: 'I sold half my bag last week and my vote weight dropped immediately, thats actually a nice touch' },
  { h: '7xK', ton: 2, usd: 5208, body: 'same, and the poll weight updated within the minute', zeit: '14:07', mine: true },
  { h: 'Km9', ton: 1, usd: 3, body: 'different person, same three characters', zeit: '14:07' },
  { h: '3vR', ton: 2, usd: 201, body: 'ser', zeit: '14:08',
    zitat: { h: '9Qm', ton: 0, text: 'how much are we raising for the next round' } },
];

const zitatHtml = (z) => !z ? '' : `
  <button class="quote" type="button">
    <span class="h t${z.ton}">${z.h}</span>
    <span class="quote-body">${z.text}</span>
  </button>`;

// Zwei Bauweisen. "verschachtelt" ist der heutige Stand aus app.js: Der Betrag
// steckt im .who und kann die Zeile deshalb nie verlassen. "geschwister" zieht
// ihn eine Ebene hoeher – erst damit laesst er sich ans Zeilenende oder in
// eine eigene Spalte setzen. Fuer den Einbau hiesse das eine geaenderte Zeile
// in msgHtml().
const msgHtml = (m, bauweise) => {
  const klassen = `msg ${m.admin ? 'is-admin' : ''}${m.mine ? ' mine' : ''}${m.zitat ? ' has-quote' : ''}`;
  const name = m.admin
    ? '<span class="h admin-name">ANSEM</span>'
    : `<span class="h t${m.ton}">${m.h}</span>`;
  const betrag = m.admin ? '' : `<span class="worth">${kurzUsd(m.usd)}</span>`;

  const kopf = bauweise === 'geschwister'
    ? `<span class="who">${name}</span>${betrag}`
    : `<span class="who">${name}${betrag}</span>`;

  return `
  <div class="${klassen}">
    ${kopf}
    ${zitatHtml(m.zitat)}
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;
};

// Das Gerüst des Chat-Bereichs, wie es in index.html steht – nur die Fläche
// als zusätzliche Hülle. Sie ist in allen Varianten da; Variante 1 dreht ihr
// bloß Rahmen und Grund wieder ab, damit alle vier dasselbe Markup zeigen.
const chatHtml = (bauweise, nurListe = false) => `
  <div class="chat-panel">
    ${nurListe ? '' : `<div class="filters">
      <span class="filters-label">Only show wallets holding at least</span>
      <div class="filter-group">
        <span class="unit">$</span>
        <input type="text" value="" placeholder="0">
        <span class="unit unit-token">in $ANSEM</span>
      </div>
      <div class="presets">
        <button class="chip">All</button>
        <button class="chip">$100+</button>
        <button class="chip">$1k+</button>
        <button class="chip">$10k+</button>
        <button class="chip">$100k+</button>
      </div>
    </div>`}
    <div class="chat-list">${NACHRICHTEN.map((m) => msgHtml(m, bauweise)).join('')}</div>
    ${nurListe ? '' : `<form class="composer">
      <input type="text" placeholder="Message the room…">
      <button class="btn btn-primary" type="button">Send</button>
    </form>`}
  </div>`;

// Jede Variante zeichnet nur ihren eigenen Ausschnitt um. Die Regeln stehen
// deshalb mit einem @ vor jedem Selektor; hier wird daraus die Kennung des
// Ausschnitts. Ein Ersetzen statt einer Zerlegung des Selektors – kurz, und
// es kann an einem Komma oder einer Klammer nicht scheitern.
const karte = (v) => `
  <section class="karte">
    <style>${v.css.replaceAll('@', `#v${v.nr}`)}</style>
    <h2><span class="nr">${v.nr}</span>${v.name}</h2>
    <p class="hinweis">${v.hinweis}</p>
    <div class="chat-rahmen" id="v${v.nr}">${chatHtml(v.markup, SATZ.nurListe)}</div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  ${PANEL}
  body { padding: 26px; background: var(--bg); }
  .karte { max-width: 1180px; margin: 0 0 34px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .hinweis { margin: 0 0 .7rem; font-size: .8rem; color: var(--dimmer); max-width: 70ch; }
  /* Der Ausschnitt steht für den Bereich unter der Kopfleiste. Feste Höhe,
     damit alle vier gleich viel Platz haben und wirklich nur die Gestaltung
     verglichen wird. */
  .chat-rahmen { display: flex; flex-direction: column; height: ${SATZ.hoehe ?? '560px'}; }
  /* Im Ausschnitt fehlt die Klasse .scroll, die im echten Chat am Verlauf
     haengt. Ohne sie waechst die Liste ueber die feste Hoehe hinaus und schiebt
     die Eingabe aus der Flaeche. */
  .chat-rahmen .chat-list { overflow-y: auto; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 80ch; }
</style>
<h1>${SATZ.titel}</h1>
<p class="lead">${SATZ.lead}</p>
${VARIANTEN.map(karte).join('')}
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-chat.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${process.cwd()}/public/_vorschau-chat.html`);
await seite.waitForTimeout(300);
await seite.screenshot({ path: SATZ.datei, fullPage: true });
await browser.close();

// public/ wird als Ganzes hochgeladen – das Arbeitsblatt darf nicht liegen bleiben.
rmSync('public/_vorschau-chat.html', { force: true });
console.log(SATZ.datei);
