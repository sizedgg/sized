// ============================================================================
// Vorschaubild: Logo-Ideen für SIZED
//
// Erzeugt preview/logo-ideen.png.
//
// Jede Idee wird in drei Größen gezeigt, und das ist der eigentliche Zweck des
// Bildes: Ein Zeichen, das groß gut aussieht, kann als Favicon eine graue
// Pampe sein. Deshalb 96 px (Startbildschirm), 26 px (Kopfzeile der Seite) und
// 16 px (Reiter im Browser) nebeneinander – und daneben die Wortmarke, wie sie
// oben links tatsächlich stünde.
//
// Alle Zeichen sind reine SVG-Pfade in einem 100er-Raster, ohne Schrift und
// ohne Bilddatei. Das heißt: beliebig skalierbar, ein paar hundert Byte groß,
// direkt als Favicon einsetzbar und in einer Farbe umfärbbar.
//
// Die Ideen kommen nicht aus dem Formenkatalog, sondern aus dem, was die Seite
// tut: Sie ordnet Leute nach der Größe ihres Bestands und lässt ab einer
// Schwelle herein. Zeichen, die Zunahme oder Einlass zeigen, sind deshalb
// näher an der Sache als ein hübsches Monogramm.
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// node scripts/vorschau-logo.mjs          -> die Formen
// node scripts/vorschau-logo.mjs farben   -> dieselben Formen in acht Toenen
const SATZ = process.argv[2] ?? 'formen';
const ZIEL = {
  formen: 'preview/logo-ideen.png',
  farben: 'preview/logo-farben.png',
  aktuell: 'preview/logo-aktuell-farben.png',
  weiss: 'preview/logo-weiss.png',
  balken: 'preview/logo-balken.png',
  gleich: 'preview/logo-gleich.png',
}[SATZ];
if (!ZIEL) throw new Error(`Unbekannter Satz: ${SATZ}`);
const FARBSATZ = SATZ === 'farben';

const A = 'var(--accent)';   // Solana-Grün, die Hausfarbe
const T = 'var(--text)';

const IDEEN = [
  {
    nr: 1,
    name: 'Zielscheibe',
    hinweis: 'Das heutige ◎, als Pfad statt als Schriftzeichen. Ruhig und sofort als Marke lesbar – aber es sagt nichts über die Seite.',
    svg: `
      <circle cx="50" cy="50" r="34" fill="none" stroke="${A}" stroke-width="8"/>
      <circle cx="50" cy="50" r="13" fill="${A}"/>`,
  },
  {
    nr: 2,
    name: 'Aufsteigende Balken',
    hinweis: 'Drei Balken, die wachsen. Das ist wörtlich, was die Liste zeigt – Bestände nach Größe. Am eindeutigsten von allen.',
    svg: `
      <rect x="20" y="52" width="16" height="28" rx="4" fill="${A}" opacity=".45"/>
      <rect x="42" y="36" width="16" height="44" rx="4" fill="${A}" opacity=".72"/>
      <rect x="64" y="20" width="16" height="60" rx="4" fill="${A}"/>`,
  },
  {
    nr: 3,
    name: 'Ringe nach außen',
    hinweis: 'Derselbe Gedanke als Kreis: Je weiter außen, desto stärker. Passt zu den Stufen, ab denen man hereinkommt.',
    svg: `
      <circle cx="50" cy="50" r="12" fill="${A}"/>
      <circle cx="50" cy="50" r="25" fill="none" stroke="${A}" stroke-width="6"/>
      <circle cx="50" cy="50" r="39" fill="none" stroke="${A}" stroke-width="11"/>`,
  },
  {
    nr: 4,
    name: 'Wachsende Punkte',
    hinweis: 'Drei Punkte, die größer werden. Die leiseste Fassung des Gedankens – auf 16 px allerdings nur noch drei Flecken.',
    svg: `
      <circle cx="22" cy="50" r="7"  fill="${A}" opacity=".45"/>
      <circle cx="50" cy="50" r="12" fill="${A}" opacity=".72"/>
      <circle cx="80" cy="50" r="18" fill="${A}"/>`,
  },
  {
    nr: 5,
    name: 'Stapel',
    hinweis: 'Drei Lagen, nach unten breiter. Liest sich als Stapel oder Podest – Größe als etwas, worauf man steht.',
    svg: `
      <rect x="34" y="22" width="32" height="14" rx="4" fill="${A}" opacity=".45"/>
      <rect x="26" y="43" width="48" height="14" rx="4" fill="${A}" opacity=".72"/>
      <rect x="18" y="64" width="64" height="14" rx="4" fill="${A}"/>`,
  },
  {
    nr: 6,
    name: 'Offener Ring',
    hinweis: 'Ein Ring mit einer Lücke, in der ein Punkt sitzt. Das Tor: Wer groß genug ist, schließt den Kreis. Die Erklärung braucht es allerdings.',
    svg: `
      <path d="M74 26 A34 34 0 1 0 74 74" fill="none" stroke="${A}"
            stroke-width="8" stroke-linecap="round"/>
      <circle cx="82" cy="50" r="11" fill="${A}"/>`,
  },
  {
    nr: 7,
    name: 'Zielscheibe mit Position',
    hinweis: 'Ring plus ein Punkt, der auf ihm sitzt statt in der Mitte. Eine eingegangene Position – eigenwilliger als 1, aber nicht mehr symmetrisch.',
    svg: `
      <circle cx="50" cy="50" r="32" fill="none" stroke="${A}" stroke-width="7" opacity=".55"/>
      <circle cx="50" cy="50" r="11" fill="${A}" opacity=".55"/>
      <circle cx="72" cy="28" r="13" fill="${A}"/>`,
  },
  {
    nr: 8,
    name: 'Monogramm D',
    hinweis: 'Das D aus SIZED als Zeichen. Am nächsten am Namen, am weitesten weg von der Sache – und ein D allein gehört niemandem.',
    svg: `
      <path d="M28 20 h20 a30 30 0 0 1 0 60 h-20 z" fill="none" stroke="${A}"
            stroke-width="10" stroke-linejoin="round"/>
      <circle cx="46" cy="50" r="9" fill="${A}"/>`,
  },
  {
    nr: 9,
    name: 'Nur die Wortmarke',
    hinweis: 'Gar kein Zeichen. Ehrlich, wenn keins von allein überzeugt – aber ohne Zeichen gibt es kein Favicon und kein Symbol auf dem Startbildschirm.',
    svg: '',
    nurWort: true,
  },
];

// ============================================================================
// Vierter Durchgang: neue Formen, jetzt in Knochenweiß
//
// Ohne Farbe ändert sich die Aufgabe. Vorher konnten drei Balken über drei
// Deckkraftstufen "wachsend" sagen; in einem Ton muss die Silhouette das
// allein tragen. Diese Zeichen sind deshalb kräftiger und einfacher gebaut –
// wenige Teile, klare Umrisse, viel Gewichtsunterschied.
//
// var(--accent) steht seit der Farbentscheidung ohnehin auf Knochenweiß, die
// Zeichen brauchen also keine eigene Farbangabe.
//
// Aufruf: node scripts/vorschau-logo.mjs weiss
// ============================================================================
const NEUE_IDEEN = [
  {
    nr: 1,
    name: 'Über der Linie',
    hinweis: 'Ein Körper über einem Strich. Das ist die Seite in einem Bild: Es gibt eine Schwelle, und man ist darüber oder nicht. Kräftig genug für jede Größe.',
    svg: `
      <circle cx="50" cy="27" r="15" fill="${A}"/>
      <rect x="12" y="66" width="76" height="9" rx="4.5" fill="${A}"/>`,
  },
  {
    nr: 2,
    name: 'Zu groß für den Rahmen',
    hinweis: 'Ein Kreis, der über sein Quadrat hinauswächst. Wörtlich: passt nicht mehr rein. Eigenwillig – und bei 16 px die Wette dieses Satzes.',
    svg: `
      <rect x="27" y="27" width="46" height="46" rx="9" fill="none"
            stroke="${A}" stroke-width="8"/>
      <circle cx="50" cy="50" r="33" fill="none" stroke="${A}" stroke-width="9"/>`,
  },
  {
    nr: 3,
    name: 'Waage',
    hinweis: 'Zwei Gewichte an einem Balken, eines deutlich größer. Größe im Vergleich statt Größe an sich – und genau darum geht es in der Liste.',
    svg: `
      <rect x="14" y="45" width="72" height="9" rx="4.5" fill="${A}"/>
      <circle cx="26" cy="49.5" r="10" fill="${A}"/>
      <circle cx="70" cy="49.5" r="20" fill="${A}"/>`,
  },
  {
    nr: 4,
    name: 'Keil',
    hinweis: 'Die knappste Form für "nach oben". Ein Vollkörper ohne Innenleben – das hält jede Verkleinerung aus, auch die auf 16 px.',
    svg: `
      <path d="M20 78 L80 78 L80 22 Z" fill="${A}" stroke="${A}"
            stroke-width="10" stroke-linejoin="round"/>`,
  },
  {
    nr: 5,
    name: 'Zwei Ringe',
    hinweis: 'Ein großer und ein kleiner Ring, ineinandergreifend. Zwei Größen, die sich berühren – ruhig und ohne Richtung.',
    svg: `
      <circle cx="40" cy="44" r="27" fill="none" stroke="${A}" stroke-width="9"/>
      <circle cx="70" cy="68" r="15" fill="none" stroke="${A}" stroke-width="9"/>`,
  },
  {
    nr: 6,
    name: 'Halbmond',
    hinweis: 'Ein Vollkreis, aus dem ein zweiter herausgeschnitten ist. Der stärkste Umriss im Satz – bei 16 px noch eindeutig, wo Ringe längst zulaufen.',
    svg: `
      <path fill="${A}" fill-rule="evenodd" d="
        M50 50 m-36 0 a36 36 0 1 0 72 0 a36 36 0 1 0 -72 0 Z
        M64 46 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0 Z"/>`,
  },
  {
    nr: 7,
    name: 'Zwei Balken',
    hinweis: 'Nur zwei: einer dünn, einer dick. Die Reduktion der aufsteigenden Balken auf das, was ohne Farbabstufungen noch trägt.',
    svg: `
      <rect x="26" y="34" width="12" height="46" rx="6" fill="${A}"/>
      <rect x="52" y="18" width="26" height="62" rx="10" fill="${A}"/>`,
  },
  {
    nr: 8,
    name: 'Quadrate nach außen',
    hinweis: 'Wie die Ringe, aber eckig – und damit näher an der Form, in der das Symbol auf dem Startbildschirm ohnehin sitzt.',
    svg: `
      <rect x="40" y="40" width="20" height="20" rx="4" fill="${A}"/>
      <rect x="27" y="27" width="46" height="46" rx="9" fill="none" stroke="${A}" stroke-width="6"/>
      <rect x="12" y="12" width="76" height="76" rx="16" fill="none" stroke="${A}" stroke-width="10"/>`,
  },
  {
    nr: 9,
    name: 'Blockmonogramm S',
    hinweis: 'Das S aus SIZED, aus geraden Blöcken gebaut statt geschrieben. Näher am Namen als am Gegenstand, aber unverwechselbarer als ein D.',
    svg: `
      <path d="M74 28 H38 a12 12 0 0 0 0 24 h24 a12 12 0 0 1 0 24 H26"
            fill="none" stroke="${A}" stroke-width="12" stroke-linecap="round"/>`,
  },
];

// ============================================================================
// Fünfter Durchgang: Balken
//
// Die Richtung steht: zwei oder drei Balken unterschiedlicher Größe. Was hier
// noch variiert, sind die Stellschrauben, an denen so ein Zeichen kippt –
// Anzahl, Breitenverhältnis, wo die Balken stehen und wie die Enden aussehen.
//
// Aufruf: node scripts/vorschau-logo.mjs balken
// ============================================================================
const B = (x, y, w, h, r) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${A}"/>`;

const BALKEN_IDEEN = [
  {
    nr: 1,
    name: 'Wie gehabt',
    hinweis: 'Nummer 7 von eben, unverändert – der Bezugspunkt für die anderen acht.',
    svg: B(26, 34, 12, 46, 6) + B(52, 18, 26, 62, 10),
  },
  {
    nr: 2,
    name: 'Gleiche Breite',
    hinweis: 'Nur die Höhe unterscheidet sie. Ruhiger und regelmäßiger – aber auch näher an jedem anderen Balkendiagramm.',
    svg: B(30, 42, 18, 38, 9) + B(54, 20, 18, 60, 9),
  },
  {
    nr: 3,
    name: 'Stärkerer Kontrast',
    hinweis: 'Sehr dünn neben sehr dick. Der Größenunterschied ist der Inhalt des Zeichens – hier ist er am deutlichsten.',
    svg: B(22, 46, 8, 34, 4) + B(44, 16, 34, 64, 14),
  },
  {
    nr: 4,
    name: 'Drei statt zwei',
    hinweis: 'Aufsteigend, alle gleich breit. Erzählt eine Reihe statt eines Vergleichs – dafür bei 16 px enger beieinander.',
    svg: B(18, 50, 15, 30, 7) + B(42, 35, 15, 45, 7) + B(66, 20, 15, 60, 7),
  },
  {
    nr: 5,
    name: 'Umgekehrt',
    hinweis: 'Der dicke links, der dünne rechts. Im Westen liest man von links – so beginnt das Zeichen groß und wird kleiner.',
    svg: B(22, 18, 26, 62, 10) + B(62, 34, 12, 46, 6),
  },
  {
    nr: 6,
    name: 'Mittig statt auf der Linie',
    hinweis: 'Beide um dieselbe Mitte gewachsen, statt auf einem Boden zu stehen. Schwebender, weniger Diagramm.',
    svg: B(26, 27, 12, 46, 6) + B(52, 19, 26, 62, 10),
  },
  {
    nr: 7,
    name: 'Eckige Enden',
    hinweis: 'Dieselbe Form ohne Rundungen. Härter und technischer; hält bei 16 px minimal besser, weil nichts zuläuft.',
    svg: B(26, 34, 12, 46, 1) + B(52, 18, 26, 62, 1),
  },
  {
    nr: 8,
    name: 'Von oben hängend',
    hinweis: 'Beide beginnen oben und reichen verschieden weit nach unten. Ungewohnt genug, um nicht nach Diagramm auszusehen.',
    svg: B(26, 20, 12, 40, 6) + B(52, 20, 26, 62, 10),
  },
  {
    nr: 9,
    name: 'Der dicke sprengt den Rahmen',
    hinweis: 'Der große Balken läuft oben aus dem Feld heraus. Nimmt den Gedanken von Nummer 2 auf: zu groß für den Kasten.',
    svg: B(26, 40, 12, 40, 6) + B(52, -6, 26, 86, 10),
  },
];

// ============================================================================
// Sechster Durchgang: gleiche Breite, feinjustiert
//
// Zwei Balken gleicher Breite, verschieden hoch. Der Einwand "das ist ein
// Balkendiagramm" traegt bei ZWEI Balken deutlich weniger als bei drei –
// Diagramme haben selten zwei Saeulen, und was hier zaehlt, ist ohnehin nicht
// die Messung, sondern der Groessenunterschied.
//
// Justiert wird deshalb nur noch: Hoehenverhaeltnis, Breite, Abstand,
// Rundung und welcher Balken links steht.
//
// Aufruf: node scripts/vorschau-logo.mjs gleich
// ============================================================================
// Zwei Balken, immer mittig im Feld und auf derselben Grundlinie bei y = 80.
const ZWEI = (w, luecke, kurz, lang, r, langLinks = false) => {
  const x1 = 50 - w - luecke / 2;
  const x2 = 50 + luecke / 2;
  const [hL, hR] = langLinks ? [lang, kurz] : [kurz, lang];
  return B(x1, 80 - hL, w, hL, r) + B(x2, 80 - hR, w, hR, r);
};

const GLEICH_IDEEN = [
  { nr: 1, name: 'Wie gehabt',
    hinweis: 'Nummer 2 von eben, unverändert – der Bezugspunkt.',
    svg: ZWEI(18, 6, 38, 60, 9) },
  { nr: 2, name: 'Größerer Höhenunterschied',
    hinweis: 'Der kurze Balken deutlich kürzer. Der Unterschied ist der Inhalt – hier tritt er stärker hervor, ohne die Regelmäßigkeit aufzugeben.',
    svg: ZWEI(18, 6, 26, 64, 9) },
  { nr: 3, name: 'Kleinerer Höhenunterschied',
    hinweis: 'Die beiden näher beieinander. Ruhiger, aber der Zeichencharakter verliert.',
    svg: ZWEI(18, 6, 48, 62, 9) },
  { nr: 4, name: 'Schmaler',
    hinweis: 'Dünnere Balken bei gleichem Abstand. Leichter und eleganter – bei 16 px allerdings dünn.',
    svg: ZWEI(13, 6, 38, 60, 6.5) },
  { nr: 5, name: 'Breiter',
    hinweis: 'Dickere Balken. Mehr Gewicht, hält kleine Größen am besten aus.',
    svg: ZWEI(24, 6, 38, 60, 12) },
  { nr: 6, name: 'Enger zusammen',
    hinweis: 'Schmalerer Zwischenraum. Die beiden werden zu einer Figur statt zu zwei Dingen.',
    svg: ZWEI(18, 3, 38, 60, 9) },
  { nr: 7, name: 'Weiter auseinander',
    hinweis: 'Mehr Luft dazwischen. Zwei getrennte Größen – und bei 16 px fällt die Lücke zuerst zu.',
    svg: ZWEI(18, 14, 38, 60, 9) },
  { nr: 8, name: 'Weniger Rundung',
    hinweis: 'Kanten statt Pillen. Härter, technischer, nicht mehr ganz so freundlich.',
    svg: ZWEI(18, 6, 38, 60, 4) },
  { nr: 9, name: 'Der hohe links',
    hinweis: 'Umgekehrte Richtung. Man liest von links – so beginnt es groß und wird kleiner statt umgekehrt.',
    svg: ZWEI(18, 6, 38, 60, 9, true) },
];

// ============================================================================
// Zweiter Durchgang: die Farbe
//
// Grün ist hier nicht irgendein Grün – es ist Solanas Grün, und damit die
// Farbe, die in dieser Ecke ohnehin jeder benutzt. Genau das lässt es beliebig
// wirken. Deshalb ein Satz Gegenvorschläge, alle auf demselben dunklen Grund.
//
// Aufruf: node scripts/vorschau-logo.mjs farben
// ============================================================================
const JETZT = {
  nr: 0, name: 'Solana-Grün', ton: '#14f195', jetzt: true,
  hinweis: 'Der heutige Stand, als Bezugspunkt. Jede Zeile darunter zeigt dasselbe Zeichen in einem anderen Ton.',
};

const FARBEN = [
  {
    nr: 1, name: 'Knochenweiß', ton: '#eceff5',
    hinweis: 'Gar keine Farbe. In einer Gegend, in der jedes Zeichen leuchtet, ist das die auffälligste Entscheidung – und die einzige, die in fünf Jahren noch nicht alt aussieht.',
  },
  {
    nr: 2, name: 'Bernstein', ton: '#f5b53c',
    hinweis: 'Warm gegen den kalten Grund. Gold hat hier allerdings schon eine Bedeutung: Es ist Ansems Farbe im Chat.',
  },
  {
    nr: 3, name: 'Zinnober', ton: '#ff6a3d',
    hinweis: 'Kräftig und in Solana-Umgebung selten. Rotorange steht sonst für Warnung – als Marke muss es das aushalten.',
  },
  {
    nr: 4, name: 'Elektrisches Blau', ton: '#4d8dff',
    hinweis: 'Sachlich, technisch, gut lesbar. Dafür die Farbe, die die meisten Anwendungen benutzen.',
  },
  {
    nr: 5, name: 'Stahlblau', ton: '#8ab2dc',
    hinweis: 'Leiser als 4 und schon im Haus: derselbe Ton, in dem ungeöffnete Gespräche liegen.',
  },
  {
    nr: 6, name: 'Violett', ton: '#a86bff',
    hinweis: 'Die zweite Solana-Farbe. Weniger abgegriffen als das Grün, aber aus demselben Baukasten.',
  },
  {
    nr: 7, name: 'Cyan', ton: '#3ed0dc',
    hinweis: 'Kühl und klar. Nah genug am Grün, dass es sich nicht ganz davon löst.',
  },
  {
    nr: 8, name: 'Weiß mit einem Akzent', ton: '#eceff5', akzent: '#f5b53c',
    hinweis: 'Das Zeichen weiß, nur das größte Element farbig. Die Farbe markiert dann etwas, statt nur dazusein.',
  },
];

const zeichen = (idee, ton, akzent) => idee.svg
  .replaceAll('var(--accent)', ton)
  // Beim Akzentsatz bekommt das letzte, groesste Element die Farbe. Es ist im
  // Quelltext das letzte mit voller Deckkraft – deshalb von hinten ersetzen.
  .replace(new RegExp(`(.*)"${ton}"`, 's'), (_, davor) => `${davor}"${akzent ?? ton}"`);

// ============================================================================
// Dritter Durchgang: das Zeichen, das schon da ist
//
// Kein neues Zeichen, sondern genau das heutige – das Schriftzeichen ◎ neben
// der Wortmarke, so wie es oben links steht – nur in anderen Farben.
//
// Bewusst als Schriftzeichen und nicht als nachgebauter SVG-Pfad: Es geht
// darum, wie es HEUTE aussieht, und die Rundungen einer Glyphe sind andere
// als die eines Kreises, den ich zeichne.
//
// Aufruf: node scripts/vorschau-logo.mjs aktuell
// ============================================================================
const aktuellKarte = (f) => `
  <section class="karte">
    <h2><span class="nr">${f.nr}</span>${f.name}<code class="ton">${f.ton}</code>${
      f.jetzt ? '<span class="jetzt">heute</span>' : ''}</h2>
    <p class="hinweis">${f.hinweis}</p>
    <div class="reihe">
      <div class="probe">
        <div class="buehne gross"><span class="glyphe" style="color:${f.ton}; font-size:76px">◎</span></div>
        <span class="mass">96 px</span>
      </div>
      <div class="probe">
        <div class="buehne"><span class="glyphe" style="color:${f.ton}; font-size:21px">◎</span></div>
        <span class="mass">26 px</span>
      </div>
      <div class="probe">
        <div class="buehne"><span class="glyphe" style="color:${f.ton}; font-size:13px">◎</span></div>
        <span class="mass">16 px</span>
      </div>
      <div class="probe breit">
        <div class="buehne links">
          <span class="lockup"><span class="glyphe" style="color:${f.ton}">◎</span><b>SIZED</b></span>
        </div>
        <span class="mass">So stünde es oben links</span>
      </div>
    </div>
  </section>`;

const farbKarte = (f) => `
  <section class="karte">
    <h2><span class="nr">${f.nr}</span>${f.name}<code class="ton">${f.ton}</code></h2>
    <p class="hinweis">${f.hinweis}</p>
    <div class="reihe">
      ${[2, 3, 8].map((n) => {
        const idee = IDEEN.find((i) => i.nr === n);
        return `
        <div class="probe">
          <div class="buehne">
            <svg viewBox="0 0 100 100" width="60" height="60">${zeichen(idee, f.ton, f.akzent)}</svg>
          </div>
          <span class="mass">${idee.name}</span>
        </div>`;
      }).join('')}
      <div class="probe breit">
        <div class="buehne links">
          <span class="lockup">
            <svg viewBox="0 0 100 100" width="22" height="22">${zeichen(IDEEN[1], f.ton, f.akzent)}</svg>
            <b>SIZED</b>
          </span>
        </div>
        <span class="mass">Kopfzeile</span>
      </div>
    </div>
  </section>`;

const mark = (idee, px) => idee.svg
  ? `<svg viewBox="0 0 100 100" width="${px}" height="${px}" aria-hidden="true">${idee.svg}</svg>`
  : `<span class="wortersatz" style="font-size:${Math.round(px * .55)}px">SD</span>`;

const karte = (idee) => `
  <section class="karte">
    <h2><span class="nr">${idee.nr}</span>${idee.name}</h2>
    <p class="hinweis">${idee.hinweis}</p>

    <div class="reihe">
      <div class="probe">
        <div class="buehne gross">${mark(idee, 96)}</div>
        <span class="mass">96 px · Startbildschirm</span>
      </div>
      <div class="probe">
        <div class="buehne">${mark(idee, 26)}</div>
        <span class="mass">26 px · Kopfzeile</span>
      </div>
      <div class="probe">
        <div class="buehne">${mark(idee, 16)}</div>
        <span class="mass">16 px · Browserreiter</span>
      </div>
      <div class="probe breit">
        <div class="buehne links">
          <span class="lockup">${idee.svg ? mark(idee, 22) : ''}<b>SIZED</b></span>
        </div>
        <span class="mass">So stünde es oben links</span>
      </div>
    </div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 28px; background: var(--bg); }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 86ch; }
  .karte {
    max-width: 1080px; margin: 0 0 14px; padding: 16px 18px;
    border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-1);
  }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .hinweis { margin: 0 0 .9rem; font-size: .79rem; color: var(--dimmer); max-width: 78ch; }
  .reihe { display: flex; align-items: flex-end; gap: 18px; }
  .probe { display: flex; flex-direction: column; align-items: center; gap: .45rem; }
  .probe.breit { flex: 1; align-items: stretch; }
  .buehne {
    display: flex; align-items: center; justify-content: center;
    min-width: 108px; height: 108px;
    border: 1px solid var(--line); border-radius: 10px; background: var(--bg);
  }
  .buehne.links { justify-content: flex-start; padding-left: 18px; }
  /* Die Glyphe genau wie .brand-mark in der Kopfzeile – gleiche Schrift,
     gleiche Groesse. Sonst vergleicht man etwas, das so nie dastuende. */
  .glyphe { line-height: 1; }
  .jetzt {
    margin-left: .5rem; padding: .1rem .45rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-size: .68rem; font-weight: 400; letter-spacing: .04em;
  }
  .ton { margin-left: .4rem; font-size: .74rem; color: var(--dimmer); font-weight: 400; }
  .mass { font-size: .68rem; color: var(--dimmer); font-family: var(--mono); }
  /* Die Wortmarke exakt wie .brand.small in der Kopfzeile. */
  .lockup { display: inline-flex; align-items: center; gap: .4rem; }
  .lockup b { font-size: .95rem; font-weight: 700; letter-spacing: .14em; }
  .wortersatz { font-weight: 700; letter-spacing: .1em; color: var(--text); }
</style>
<h1>${{ formen: 'Ein Zeichen für SIZED', farben: 'Welche Farbe?',
        aktuell: 'Das heutige Zeichen, in anderen Farben',
        weiss: 'Neue Zeichen, in Knochenweiß',
        balken: 'Balken – neun Abstufungen',
        gleich: 'Gleiche Breite – feinjustiert' }[SATZ]}</h1>
<p class="lead">${{
  formen: 'Jede Idee in den drei Größen, in denen sie halten muss – und daneben als Wortmarke, wie sie oben links stünde. Alles reine SVG-Pfade: umfärbbar, beliebig groß, ein paar hundert Byte.',
  farben: 'Dieselben drei Zeichen in acht Tönen. Das Grün der Seite ist Solanas Grün – deshalb steht es hier nicht mehr mit zur Wahl.',
  aktuell: 'Nichts Neues – das ◎ von oben links, unverändert in Form und Größe, nur in anderen Tönen. Ganz oben zum Vergleich der heutige Stand.',
  weiss: 'Ohne Farbe muss die Silhouette allein tragen – diese Zeichen sind deshalb kräftiger und einfacher gebaut als die aus dem ersten Durchgang. Wieder in allen drei Größen.',
  balken: 'Alle neun sind Balken unterschiedlicher Größe. Unterschiedlich sind Anzahl, Breitenverhältnis, Standlinie und Form der Enden.',
  gleich: 'Alle neun sind zwei Balken gleicher Breite. Justiert sind Höhenverhältnis, Breite, Abstand, Rundung und Richtung.',
}[SATZ]}</p>
${SATZ === 'aktuell' ? [JETZT, ...FARBEN].map(aktuellKarte).join('')
  : SATZ === 'farben' ? FARBEN.map(farbKarte).join('')
  : SATZ === 'weiss' ? NEUE_IDEEN.map(karte).join('')
  : SATZ === 'balken' ? BALKEN_IDEEN.map(karte).join('')
  : SATZ === 'gleich' ? GLEICH_IDEEN.map(karte).join('')
  : IDEEN.map(karte).join('')}
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-logo.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1160, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${process.cwd()}/public/_vorschau-logo.html`);
await seite.waitForTimeout(300);
await seite.screenshot({ path: ZIEL, fullPage: true });
await browser.close();

rmSync('public/_vorschau-logo.html', { force: true });
console.log(ZIEL);
