// ---------------------------------------------------------------------------
// SIZED – Frontend.
//
// Nach der Verifikation spricht der Browser direkt mit Supabase (PostgREST +
// Realtime). Was er dabei darf, entscheidet ausschließlich RLS – hier wird
// nichts abgesichert, was nicht auch in der Datenbank abgesichert ist.
// ---------------------------------------------------------------------------

import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TOKEN_KEY = 'ansem_jwt';

/**
 * Die laufende Anmeldung, damit ein Neuladen sie fortsetzt.
 *
 * Darin steckt das Geheimnis der Challenge – der Nachweis, dass diese
 * Anmeldung MIR gehört. Die Edge Function gibt es genau einmal heraus und
 * kennt danach nur noch seinen Abdruck.
 *
 * Ohne diese Zeile wäre die Sperre in verify eine Verschlechterung statt
 * einer Verbesserung: Früher fand die Function eine offene Challenge über die
 * Wallet und gab sie jedem weiter, der dieselbe Adresse eintippte – genau
 * daran hing die Übernahme. Jetzt setzt sie nur fort, wer sein Geheimnis
 * mitschickt. Wer es beim Neuladen verliert, bekäme eine zweite Challenge mit
 * einem zweiten Betrag und zahlte zweimal.
 *
 * localStorage und nicht sessionStorage: Wer auf dem Handy zur Wallet-App
 * wechselt und zurückkommt, hat je nach Browser einen neuen Tab.
 */
const CHALLENGE_KEY = 'ansem_challenge';

const merkeChallenge = (c) => {
  try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify(c)); } catch { /* privater Modus */ }
};
const vergissChallenge = () => {
  try { localStorage.removeItem(CHALLENGE_KEY); } catch { /* egal */ }
};
const gemerkteChallenge = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CHALLENGE_KEY) || 'null');
    // Abgelaufenes gar nicht erst mitschicken – verify legt dann ohnehin eine
    // neue an, aber so bleibt der Fall hier sichtbar statt dort.
    return c && new Date(c.expiresAt).getTime() > Date.now() ? c : null;
  } catch { return null; }
};

/**
 * Merken, ob gerade mit der Tastatur oder mit der Maus bedient wird.
 *
 * Der Anlass: Ein Textfeld soll beim Anklicken nicht aufleuchten. Wer
 * hineinklickt, weiss, wo er hineingeklickt hat – der Rahmen sagt ihm nichts
 * Neues und ist bei jeder getippten DM wieder da.
 *
 * Beim Tabben ist es umgekehrt: Dort ist der Rahmen die einzige Auskunft
 * darueber, wo man steht, und im Abstimmungskasten koennen zehn gleich
 * aussehende Felder untereinander stehen.
 *
 * Warum das nicht in CSS geht, obwohl es dafuer :focus-visible gibt: Bei
 * Knoepfen trennt :focus-visible Maus und Tastatur sauber, bei Textfeldern
 * NICHT. Die Regel im Browser lautet, dass ein Feld, in das man tippen kann,
 * immer als "sichtbar fokussiert" gilt – auch nach einem Mausklick.
 * Nachgemessen in Chromium: Knopf nach Klick false, Textfeld nach Klick true.
 * Ohne diese paar Zeilen gaebe es die Unterscheidung fuer Felder also gar
 * nicht.
 *
 * Nur die Tabulatortaste zaehlt, nicht jede Taste: Wer in einem Feld tippt,
 * bedient die Tastatur, navigiert aber nicht – dabei soll kein Rahmen
 * erscheinen.
 */
addEventListener('keydown', (e) => {
  if (e.key === 'Tab') document.documentElement.dataset.tastatur = '';
}, true);
addEventListener('pointerdown', () => {
  delete document.documentElement.dataset.tastatur;
}, true);

/**
 * Ansems Ansicht anschauen, ohne etwas an der Datenbank zu ändern.
 *
 * Aufruf: ?preview=admin – und nur auf dem eigenen Rechner. Die Sperre auf
 * localhost ist kein Beiwerk: Ohne sie könnte jeder Besucher der echten Seite
 * den Parameter anhängen und sähe Ansems Posteingangs-Oberfläche.
 *
 * Es ist ausdrücklich nur die ANSICHT. Wer wirklich Adminrechte hat, steht in
 * app_config.admin_wallet, und danach fragt die Datenbank bei jedem Zugriff.
 * Eine Umfrage anlegen, fremde DMs lesen oder die DM-Schwelle setzen schlägt
 * in dieser Vorschau also fehl – mit genau der Fehlermeldung, die ein
 * Fremder auch bekäme. Das ist die richtige Antwort und kein Mangel: Ließe
 * sich die Oberfläche hier zum Schreiben überreden, wäre die eigentliche
 * Prüfung an der falschen Stelle.
 */
const NUR_HIER = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);

const PREVIEW_ADMIN =
  new URLSearchParams(location.search).get('preview') === 'admin' && NUR_HIER;

/**
 * Ein voller Posteingang zum Ansehen – erfunden, nicht geladen.
 *
 * Aufruf: ?demo=40 – und wie die Vorschau oben nur auf dem eigenen Rechner.
 *
 * Der Grund: Fast jede Frage an diesen Posteingang stellt sich erst bei
 * vierzig Zeilen und nicht bei vier. Bleibt die Schwelle beim Blaettern
 * stehen? Faellt ein ungelesenes Gespraech zwischen den anderen noch auf? Wie
 * liest sich eine Spalte aus vierzig Betraegen? Mit echten Daten waere die
 * Antwort: erst wenn Ansem vierzig Leute hat.
 *
 * WICHTIG: In
 * diesem Modus wird NICHTS geladen und NICHTS geschrieben. Die Gespraeche
 * gibt es nicht. Ein Klick auf "Hide" aendert nur die Anzeige – die Datenbank
 * sieht ihn gar nicht. So ist ausgeschlossen, dass beim Ausprobieren
 * Testdaten in einer Produktionsdatenbank landen.
 *
 * Die Zahl ist frei waehlbar (?demo=200 geht auch); ohne Zahl sind es 40.
 */
const DEMO_DMS = (() => {
  if (!NUR_HIER) return 0;
  const p = new URLSearchParams(location.search).get('demo');
  if (p === null) return 0;
  return Math.min(500, Math.max(1, Number(p) || 40));
})();

/**
 * Die erfundenen Gespraeche.
 *
 * Feste Streuzahl statt Math.random(): Zwei Aufrufe derselben Adresse sollen
 * dasselbe Bild ergeben. Sonst vergleicht man beim Hin- und Herschalten
 * zwischen zwei Fassungen des Blatts zwei verschiedene Datensaetze und haelt
 * den Unterschied fuer eine Wirkung der Aenderung.
 */
function demoThreads(n) {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let saat = 20260831;
  const zufall = () => (saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648;
  // Zwei Listen, nicht eine. Die Vorschau ist die letzte Nachricht, und die
  // hat einen Absender – steht "You:" davor, hat Ansem sie geschrieben. Aus
  // einem gemeinsamen Topf kam "You: wen poll" heraus, also Ansem, der sich
  // selbst nach einer Umfrage fragt.
  const VON_NUTZERN = [
    'gm', 'wen poll', 'thanks for the reply', 'can you look at this',
    'I sold half my bag last week and now I am not sure that was right',
    'Is the unlock linear or cliff based? I cannot tell from the docs',
    'any chance you do an AMA this month', 'appreciate the answer earlier',
    'sent you the details',
  ];
  const VON_ANSEM = [
    'will look at it', 'will cover it in the next stream', 'checking now',
    'thats in the docs', 'not yet', 'sent', 'ill post about it later',
  ];
  return Array.from({ length: n }, (_, i) => {
    // Betraege ueber die ganze Spanne, von siebenstellig bis unter jede
    // Schwelle – die Raender sind das, was man sehen will.
    const usd = Math.round(5_000_000 * (0.3 + zufall()) ** 3 * ((n - i) / n) ** 4) + 3;
    return {
      wallet: Array.from({ length: 44 }, () => B58[Math.floor(zufall() * 58)]).join(''),
      total: 1 + Math.floor(zufall() * 20),
      last_at: new Date(Date.now() - i * 3.6e6).toISOString(),
      unread: zufall() < 0.2 ? 1 : 0,
      tokens: usd * 12,
      usd,
      last_from_admin: false,
      hidden: zufall() < 0.08,
    };
  }).map((t) => ({
    // Wer zuletzt geschrieben hat, haengt am Ungelesen-Zaehler und ist nicht
    // frei wuerfelbar. Das war hier falsch, und es war im Bild zu sehen:
    // Gespraeche mit "You:" UND blauem Punkt.
    //
    // Den Zustand kann es nicht geben. Ungelesen zaehlt Nachricht DES ANDEREN,
    // die Ansem noch nicht gesehen hat – und um zu antworten, muss er das
    // Gespraech oeffnen, was sie als gelesen vermerkt. Hat er zuletzt
    // geschrieben, ist nichts mehr offen.
    //
    // Erfundene Daten muessen dieselben Regeln einhalten wie echte, sonst
    // prueft man die Oberflaeche gegen einen Fall, den sie nie sieht – und
    // uebersieht dafuer, wie sie im echten aussieht.
    ...t,
    last_from_admin: t.unread === 0 && zufall() < 0.45,
  })).map((t) => ({
    // Erst jetzt der Text: Er haengt daran, wer zuletzt geschrieben hat, und
    // das steht eine Zeile vorher fest.
    ...t,
    preview: t.last_from_admin
      ? VON_ANSEM[Math.floor(zufall() * VON_ANSEM.length)]
      : VON_NUTZERN[Math.floor(zufall() * VON_NUTZERN.length)],
  })).sort((a, b) => b.usd - a.usd);
}

/* Speicher, der auch dann nicht umfaellt, wenn es keinen gibt.
   ---------------------------------------------------------------------------
   localStorage ist nicht "manchmal leer", sondern manchmal VERBOTEN: Safari
   mit "alle Cookies blockieren", Brave mit harten Shields, mehrere
   In-App-Browser werfen beim blossen Zugriff einen SecurityError.

   Hier stand der Zugriff einmal nackt in der Zeile darunter, auf oberster
   Modulebene – der Fehler fiel also, bevor irgendetwas gezeichnet war, und der
   Besucher sah eine schwarze Flaeche. Kein Login, keine Meldung, und Neuladen
   half nie. Getroffen hat es ausgerechnet die, die einen Link aus X oder
   Telegram oeffnen.

   Ein leerer Speicher ist dagegen harmlos: Dann ist man eben nicht angemeldet.
   Deshalb faengt lies() den Fehler ab und gibt null zurueck, und schreib()
   schluckt ihn. Was verlorengeht, ist das Wiederkommen ohne neue Anmeldung –
   nicht die Seite. */
const lies = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreib = (k, v) => { try { localStorage.setItem(k, v); } catch { /* gesperrt */ } };
const loesche = (k) => { try { localStorage.removeItem(k); } catch { /* gesperrt */ } };

const state = {
  jwt: lies(TOKEN_KEY) || null,
  db: null,
  me: null,
  // min_chat_usd steht weiter in der Datenbank, wird hier aber nicht mehr
  // gelesen: Der Chat ist raus, und die Spalte bleibt nur stehen, damit
  // nichts gelöscht werden muss.
  cfg: { symbol: 'ANSEM', admin_wallet: null, treasury: null, min_dm_usd: 0 },
  dmMessages: [],
  dmReplyTo: null,
  dmRepliesAvailable: true,
  // Bereits geöffnete Gespräche, nach Adresse. Damit der zweite Klick auf
  // einen Faden sofort etwas zeigt statt erst nach der Netzantwort.
  dmCache: new Map(),
  // Was Ansem gerade tippt, bevor es gespeichert ist. Der Posteingang folgt
  // schon dieser Zahl; gespeichert wird erst beim Verlassen des Feldes.
  // Getrennt von cfg.min_dm_usd, weil sonst nicht mehr erkennbar wäre, ob
  // sich gegenüber dem gespeicherten Stand überhaupt etwas geändert hat.
  dmMinEntwurf: null,
  // Zeigt der Posteingang die von Hand verborgenen Gespraeche gerade mit?
  // Nur fuer diese Sitzung – beim naechsten Laden sind sie wieder weg, denn
  // das ist der Normalzustand.
  zeigeVerborgene: false,
  // Kennt die Datenbank das Verbergen ueberhaupt schon? Siehe pruefeVerbergen().
  dmHideAvailable: false,
  polls: [],
  dmThreads: [],
  activeThread: null,
  challenge: null,
  poller: null,      // fragt nach, ob die Zahlung angekommen ist (3s/10s/30s)
  uhr: null,         // schreibt den Rest auf dem Zahlungsbildschirm, im Sekundentakt
  activeTab: 'polls',
  channels: {},
  reloadTimers: {},
  fallback: {},
  stimmenTakt: null,   // fragt die Stimmenzahlen nach, statt sie zugestellt zu bekommen
};

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

// Zahlen bewusst im en-US-Format: "$1,325" ist eindeutig, "$1.325" liest sich
// im Deutschen wie ein Euro-Betrag mit Nachkommastellen.
const nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const nfFull = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const fmtUsd = (n) => (!n ? '$0' : n < 1 ? '$' + n.toFixed(2) : '$' + (n >= 10_000 ? nfCompact.format(n) : nfFull.format(n)));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/* Ausgeschrieben statt abgekürzt – für die Abstimmungen und für das Bild, das
   der Ladeknopf erzeugt.

   fmtUsd kürzt ab 10.000 ab ("$482.9K"), weil der Betrag im Posteingang in
   einer schmalen Spalte neben dem Kürzel steht; dort zählt Kürze. In einer
   Abstimmung steht er allein am Zeilenende und hat Platz, und dort ist
   "$482,900" die belastbarere Angabe: Es ist die Zahl, über die jemand
   streiten kann. */
const nfGanz = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const vollUsd = (n) => '$' + nfGanz.format(Math.round(Number(n) || 0));

/* Mit Tausendertrennung: "38100" liest sich als Ziffernkette, bei der man
   mitzählen muss – "38,100" nicht. */
const ganzeZahl = (n) => nfGanz.format(Number(n) || 0);

/**
 * Der Betrag neben einer Zeile im Posteingang – so kurz, dass er in eine
 * schmale Spalte passt.
 *
 * Regel: nie mehr als drei Ziffernstellen. Unter tausend die ganze Zahl,
 * darüber mit K, M oder B abgekürzt. Eine Nachkommastelle gibt es nur, solange
 * die Vorzahl einstellig bleibt:
 *
 *      1.412 → $1.4K        31.500 → $32K
 *      3.444 → $3.4K       781.420 → $781K
 *        999 → $999      1.240.000 → $1.2M
 *
 * Damit ist der längste Fall fünf Zeichen breit. Genau das macht die Spalte
 * möglich, in der die Beträge untereinander stehen: Sie kann eng sein und
 * läuft trotzdem nie über.
 *
 * Erst runden, dann die Einheit wählen. Andersherum würden aus 999.960 nach
 * dem Aufrunden "1000K" – vier Stellen, und die Spalte wäre gesprengt. Über
 * toPrecision(3) sind es 1.000.000 und damit "$1.0M".
 *
 * Unter einem Dollar steht "<$1" statt "$0.42": Zwei Nachkommastellen wären
 * der einzige Fall, der aus der Spalte fällt, und auf den Cent genau ist bei
 * einem Bestand von Cents ohnehin niemandem gedient.
 *
 * fmtUsd() bleibt daneben bestehen und wird weiter benutzt, wo Platz ist und
 * die genaue Zahl zählt: in der Kopfzeile, in den Sperrmeldungen und in der
 * Angabe, wie viele Gespräche der Posteingang gerade ausblendet.
 *
 * Die ZEILEN des Posteingangs benutzen dagegen kurzUsd. Sie standen anfangs
 * auf fmtUsd, und das kürzt erst ab 10.000 ab – daneben also "$9,800" und
 * "$214K" untereinander in derselben schmalen Spalte. Zwei Schreibweisen für
 * dieselbe Sache in einer Liste, und die längere ausgerechnet für die
 * kleineren Beträge.
 *
 * Zwischen 1.000 und 10.000 steht keine Nachkommastelle: "$9K" statt "$8.8K".
 * Die Begründung steht bei der Zeile selbst – kurz: Die Stelle behauptet dort
 * eine Genauigkeit, die die Zahl nicht hat.
 */
const STUFEN = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function kurzUsd(n) {
  const zahl = Number(n);
  if (!Number.isFinite(zahl) || zahl <= 0) return '$0';
  if (zahl < 1) return '<$1';
  const gerundet = Number(zahl.toPrecision(3));
  for (const [ab, kurz] of STUFEN) {
    if (gerundet < ab) continue;
    const wert = gerundet / ab;
    // Zwischen 1.000 und 10.000 KEINE Nachkommastelle: "$9K", nicht "$8.8K".
    //
    // Der Grund ist nicht Platz, sondern Ehrlichkeit. "$8.8K" sieht aus wie
    // eine genaue Angabe und ist keine – dahinter steht irgendetwas zwischen
    // 8.750 und 8.849. Die Stelle behauptet eine Genauigkeit, die die Zahl
    // nicht hat, und ausgerechnet dort, wo die Betraege dicht beieinander
    // liegen und man sie vergleicht.
    //
    // "$9K" sagt dasselbe und behauptet nichts. Wer den genauen Betrag will,
    // oeffnet das Gespraech.
    //
    // Nur diese eine Stufe: Bei Millionen bleibt die Nachkommastelle, weil
    // dort zwischen "$1M" und "$2M" eine Million liegt – da traegt sie eine
    // echte Auskunft.
    //
    // Gerundet wird hier vom ROHWERT und nicht von gerundet: Das toPrecision(3)
    // oben ist dafuer da, dass aus 999.960 nicht "1000K" wird – es macht aus
    // 1.499 aber schon 1.500, und Math.round() daraus dann "$2K". Zweimal
    // runden rundet zweimal auf. Vom Rohwert sind es "$1K", und das ist die
    // richtige Antwort.
    if (kurz === 'K' && wert < 9.95) return '$' + Math.round(zahl / ab) + kurz;
    return '$' + (wert < 9.95 ? wert.toFixed(1) : String(Math.round(wert))) + kurz;
  }
  return '$' + Math.round(gerundet);
}

/**
 * Datumstrenner in Gesprächen.
 *
 * Ein DM-Faden läuft über Tage oder Wochen. Ohne Trenner steht dort eine
 * Uhrzeit, und "09:12" sagt nicht, ob das heute früh war oder vor drei Wochen.
 *
 * "Today" und "Yesterday" statt eines Datums für die letzten zwei Tage: Das
 * ist die Auskunft, die man tatsächlich sucht, und man muss nicht erst
 * nachrechnen, welcher Wochentag heute ist. Das Jahr steht nur dabei, wenn es
 * nicht das laufende ist – sonst wiederholt es sich in jedem Trenner.
 */
const tagBeginn = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dfTag = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dfTagJahr = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function tagLabel(ts) {
  const d = new Date(ts);
  const jetzt = new Date();
  const diff = Math.round((tagBeginn(jetzt) - tagBeginn(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.getFullYear() === jetzt.getFullYear() ? dfTag.format(d) : dfTagJahr.format(d);
}
const handleOf = (wallet) => (wallet || '').slice(0, 3);

/* kurzAdresse() stand hier: die eigene Adresse als "EMwU…QLxP", vier Zeichen,
   Auslassung, vier Zeichen. Sie hat oben rechts das Kuerzel ersetzt, mit dem
   Argument, dort sei die Frage nicht "wer bin ich", sondern "mit welcher
   Wallet bin ich hier".

   Sie ist wieder raus, samt der Funktion: Oben rechts stehen jetzt wieder die
   drei Zeichen in der eigenen Farbe – dieselbe Kennung wie in den DMs und im
   Posteingang. Eine Abkuerzung ohne Aufrufer haette hier stehen bleiben
   koennen; sie sah aus, als wuerde sie gebraucht.

/**
 * Farbton für einen Nutzernamen.
 *
 * Drei Zeichen reichen nicht, um Leute sicher auseinanderzuhalten: Bei ein paar
 * hundert Mitgliedern teilen sich zwangsläufig welche dasselbe Kürzel. Eine
 * feste Farbe je Wallet gibt dem Namen ein zweites Merkmal, ohne ihn zu
 * verlängern – zwei "7xK" nebeneinander sehen dann trotzdem verschieden aus.
 *
 * Zwei Entscheidungen dahinter:
 *
 *   * Gerechnet wird über die volle Adresse, nicht über die drei Zeichen.
 *     Sonst bekämen ausgerechnet die Doppelgänger dieselbe Farbe.
 *   * Die Akzentfarbe ist hier nicht dabei. Sie gehört allein Ansem – so
 *     heißt sie überall "das ist er", und kein Teilnehmer kann zufällig in
 *     seiner Farbe erscheinen. Bleiben vier Töne, was für die Unterscheidung
 *     reicht.
 */
const HANDLE_TONES = 4;
function toneOf(wallet) {
  let h = 0;
  for (let i = 0; i < (wallet || '').length; i++) {
    h = (Math.imul(h, 31) + wallet.charCodeAt(i)) >>> 0;
  }
  return h % HANDLE_TONES;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Text mit anklickbaren Links.
 *
 * Die Reihenfolge ist hier das Sicherheitsmerkmal, nicht ein Detail: Der Text
 * wird ZERLEGT und jedes Stueck einzeln maskiert. Der naheliegende Weg – erst
 * maskieren, dann mit einem regulaeren Ausdruck ueber das Ergebnis laufen –
 * ist heikel, weil das Maskieren selbst Zeichen einfuegt (& wird &amp;), die
 * der Ausdruck dann wieder auseinandernehmen muesste. Wer sich dabei
 * verrechnet, baut ein Loch, durch das fremdes HTML in die Seite kommt.
 *
 * Nur http:// und https:// und www. – bewusst NICHT die nackte Domain wie
 * "sized.gg". Der Filter in der Datenbank kennt eine Liste von Endungen und
 * darf grosszuegig sein, weil er nur ablehnt. Hier wuerde dieselbe
 * Grosszuegigkeit aus "1.25" und "z.b" Links machen. Ablehnen ist billig,
 * einen falschen Link anbieten nicht.
 *
 * Bei www. wird https:// vorangestellt. Ohne Schema laese der Browser die
 * Adresse als relativen Pfad und landete auf sized.gg/www.example.com.
 *
 * Das Schema ist damit IMMER http oder https – "javascript:" kann hier nicht
 * entstehen, weil der Ausdruck es gar nicht erst faengt.
 *
 * rel und referrerpolicy sind nicht Kosmetik:
 *   * noopener  – ohne das kann die geoeffnete Seite ueber window.opener auf
 *                 diese hier zugreifen und sie z. B. auf eine Nachbau-Seite
 *                 umleiten, waehrend der Nutzer im anderen Tab liest.
 *   * noreferrer, no-referrer – die Zielseite erfaehrt nicht, woher der Klick
 *                 kam. In einem Raum, dessen Mitgliedschaft Geld kostet, ist
 *                 schon die Herkunft eine Auskunft.
 *   * nofollow  – kein Anreiz, die Seite als Linkschleuder zu benutzen.
 */
const LINK_MUSTER = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function mitLinks(text) {
  const roh = String(text ?? '');
  let out = '';
  let zuletzt = 0;

  for (const treffer of roh.matchAll(LINK_MUSTER)) {
    const start = treffer.index;
    let url = treffer[0];

    // Satzzeichen am Ende gehoeren zum Satz, nicht zur Adresse:
    // "schau auf https://sized.gg." endet nicht mit einem Punkt in der URL.
    // Eine schliessende Klammer bleibt nur, wenn sie eine oeffnende hat –
    // Wikipedia-Adressen enthalten welche.
    let schwanz = '';
    for (;;) {
      const letztes = url.slice(-1);
      // Bei der Klammer wird gezaehlt, nicht geraten: Eine schliessende zu
      // viel gehoert zum Satz, eine ausgeglichene zur Adresse.
      // "(https://de.wikipedia.org/wiki/Foo_(bar))" endet mit der Adresse
      // "..._(bar)" und einer Klammer, die den Satz schliesst.
      const zuViele = letztes === ')'
        && (url.split(')').length - 1) > (url.split('(').length - 1);
      if ('.,;:!?'.includes(letztes) || zuViele) {
        schwanz = letztes + schwanz;
        url = url.slice(0, -1);
        continue;
      }
      break;
    }
    if (!url) continue;

    const ziel = /^www\./i.test(url) ? 'https://' + url : url;
    out += esc(roh.slice(zuletzt, start));
    out += `<a href="${esc(ziel)}" target="_blank"`
      + ` rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">${esc(url)}</a>`;
    out += esc(schwanz);
    zuletzt = start + treffer[0].length;
  }

  out += esc(roh.slice(zuletzt));
  return out;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3400);
}

// ---------------------------------------------------------------------------
// Edge Functions
// ---------------------------------------------------------------------------

async function callFunction(name, body, withAuth = false) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${withAuth && state.jwt ? state.jwt : SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Wichtig: das Token über `accessToken` übergeben, nicht als fester Header.
 *
 * Ein Header in `global.headers` gilt nur für die REST-Aufrufe. Die
 * Realtime-Verbindung würde weiter mit dem anon-Key laufen, und weil unsere
 * RLS-Policies nur `authenticated` lesen lassen, käme dort kein einziges
 * Ereignis an – Nachrichten erschienen erst nach einem Reload.
 * `accessToken` gilt für beides und wird bei jeder Verbindung neu abgefragt.
 */
function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: async () => state.jwt,
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

/** Wirft mit sprechender Meldung statt mit dem rohen PostgREST-Objekt. */
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Database error');
  return data;
}

// ---------------------------------------------------------------------------
// Login per Zahlungsverifikation
// ---------------------------------------------------------------------------

// Enter im Adressfeld tut dasselbe wie der Knopf.
// ---------------------------------------------------------------------------
// Das Feld steht in keinem <form>, also gab es kein Absenden – und ohne
// Zuhoerer passierte auf Enter gar nichts. Auf dem Handy ist das der
// schlimmste Ort dafuer: Man tippt die Adresse, drueckt die "Los"-Taste der
// Tastatur, nichts geschieht, und der Knopf liegt in dem Moment hinter der
// eingeblendeten Tastatur. Das ist die erste Handlung jedes neuen Nutzers.
//
// Kein <form> nachtraeglich drumherum: Ein Formular ohne action laedt bei
// Enter die Seite neu, wenn das JavaScript einmal nicht laeuft – und dann ist
// die eingetippte Adresse weg. Ein Zuhoerer tut genau das eine, was er soll.
$('#wallet-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (!$('#btn-challenge').disabled) $('#btn-challenge').click();
});

$('#btn-challenge').addEventListener('click', async () => {
  const wallet = $('#wallet-input').value.trim();
  const err = $('#login-error');
  err.hidden = true;
  if (!wallet) { err.textContent = 'Enter your wallet address.'; err.hidden = false; return; }

  const btn = $('#btn-challenge');
  // disabled UND die Klasse: Das eine sperrt den zweiten Klick, das andere
  // zeigt, dass etwas laeuft. Bisher gab es nur das Erste – ein blasser Knopf
  // sieht aber aus wie kaputt, nicht wie beschaeftigt.
  btn.disabled = true;
  btn.classList.add('laedt');
  try {
    // Eine eigene, noch laufende Anmeldung für dieselbe Adresse fortsetzen –
    // sonst würfelt verify einen zweiten Betrag, und wer schon gezahlt hat,
    // zahlt noch einmal.
    const weiter = gemerkteChallenge();
    const c = await callFunction('verify', {
      action: 'challenge',
      wallet,
      ...(weiter?.wallet === wallet
        ? { challengeId: weiter.challengeId, secret: weiter.secret }
        : {}),
    });
    state.challenge = c;
    merkeChallenge(c);
    $('#pay-amount').textContent = c.sol.toFixed(9).replace(/0+$/, '') + ' SOL';
    $('#pay-treasury').textContent = c.treasury;
    $('#btn-mock-pay').hidden = !c.mock;
    $('#pay-error').hidden = true;
    $('#pay-status').textContent = 'Waiting for payment…';
    $('#step-address').hidden = true;
    $('#step-pay').hidden = false;
    startPolling();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.classList.remove('laedt');
  }
});

$('#btn-mock-pay').addEventListener('click', async () => {
  try {
    await callFunction('verify', {
      action: 'mock-pay',
      challengeId: state.challenge.challengeId,
      secret: state.challenge.secret,
    });
    $('#pay-status').textContent = 'Payment detected, verifying…';
  } catch (e) { toast(e.message, true); }
});

$('#btn-cancel').addEventListener('click', () => {
  stopPolling();
  state.challenge = null;
  // Abbrechen heisst abbrechen: Die naechste Anmeldung faengt neu an. Die
  // alte Challenge laeuft von selbst ab.
  vergissChallenge();
  $('#step-pay').hidden = true;
  $('#step-address').hidden = false;
});

/**
 * Kopieren mit sichtbarer Bestätigung.
 *
 * navigator.clipboard gibt es nur über HTTPS und nicht in jedem eingebetteten
 * Browser (etwa dem in Twitter). Der zweite Weg über ein verstecktes Feld
 * funktioniert überall – und wenn auch das scheitert, wird der Text wenigstens
 * markiert, damit man ihn von Hand kopieren kann. Hier hängt eine Zahlung
 * dran; Wegklicken ohne Ergebnis wäre die schlechteste Variante.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* zweiter Weg */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// Wie lange der Umriss nach dem Kopieren hell bleibt.
//
// Erst 1800, dann 900, jetzt 1500 – und die Zahl ist am Geraet entschieden
// und nicht am Schreibtisch. 1800 sahen aus wie ein Zustand statt einer
// Antwort; 900 waren, seit der Umriss nur noch dezent hell wird, zu knapp, um
// ihn ueberhaupt zu bemerken. Wer eine Adresse kopiert, schaut in dem Moment
// meist schon auf seine Wallet-App.
const KOPIERT_MS = 1500;

$$('.copy').forEach((b) => b.addEventListener('click', async () => {
  const el = $(b.dataset.copy);
  const text = el.textContent.replace(' SOL', '');
  const hint = $('.copy-hint', b);

  if (await copyText(text)) {
    b.classList.add('is-copied');
    if (hint) hint.textContent = 'Copied ✓';
    clearTimeout(b._t);
    b._t = setTimeout(() => {
      b.classList.remove('is-copied');
      if (hint) hint.textContent = 'Tap to copy';
    }, KOPIERT_MS);
    return;
  }

  // Letzter Ausweg: markieren, damit der Nutzer selbst kopieren kann.
  //
  // Die Klasse zuerst: Die Zeile ist sonst gar nicht markierbar (siehe
  // .pay-row in styles.css – ein blauer Block neben "Copied ✓" waere eine
  // zweite Antwort auf dasselbe Antippen). Ohne diese Zeile zeigte die
  // Meldung darunter auf nichts.
  b.classList.add('zum-markieren');
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* dann eben nicht */ }
  toast('Could not copy automatically - the text is selected for you', true);
}));

// ---------------------------------------------------------------------------
// Startbildschirm
//
// Auf dem Handy kommt vor dem Login die Aufforderung, die Seite abzulegen. Der
// Grund ist handfest: Browser räumen gespeicherte Sitzungen nach längerer Zeit
// ohne Besuch weg – und eine neue Anmeldung kostet hier eine echte Zahlung.
// Vom Startbildschirm aus gilt das nicht.
//
// Es ist eine Aufforderung, keine Sperre. Wer sie wegklickt, kommt weiter und
// wird nicht wieder gefragt: In eingebetteten Browsern (Twitter, Telegram)
// lässt sich gar nichts ablegen, und diese Leute jedes Mal anzuhalten wäre
// reine Schikane.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Die Tastatur schiebt nicht mehr die ganze Ansicht hoch
// ---------------------------------------------------------------------------
//
// Befund vom Geraet: Tippt man auf dem Handy eine DM, wandert alles nach oben
// aus dem Bild – Kopfzeile, die Reiter, der obere Rand des Rahmens.
//
// Warum iOS das tut, steht ausfuehrlich in styles.css bei --sicht. Kurz: Die
// Seite ist 100dvh hoch, und dvh weiss von der Tastatur nichts. Unten ist die
// halbe Seite verdeckt, das Eingabefeld liegt darunter – also schiebt iOS von
// sich aus alles hoch. Der einzige Weg, ihm das abzugewoehnen, ist, ihm den
// Anlass zu nehmen: Ist die Seite nur so hoch wie das, was man sieht, gibt es
// nichts zu schieben.
//
// visualViewport ist der Teil des Fensters, der wirklich zu sehen ist – ohne
// Tastatur, ohne Leisten. Genau die Zahl wird gebraucht.
//
// ---------------------------------------------------------------------------
// Warum eine Schwelle und nicht einfach immer die sichtbare Hoehe
//
// visualViewport.height aendert sich auch, wenn Safaris Adressleiste beim
// Rollen ein- und ausfaehrt – Dutzende Male pro Wisch, um wenige Pixel. Wuerde
// die Seitenhoehe dem folgen, zuckte bei jedem Rollen das ganze Blatt. Dafuer
// ist 100dvh da, und das macht der Browser fluessiger, als wir es koennten.
//
// Eine Tastatur nimmt dagegen ein Drittel des Bildschirms. 120 px trennt das
// eine sicher vom anderen: Weniger ist eine Leiste, mehr ist eine Tastatur.
const TASTATUR_AB_PX = 120;

function tastaturBeobachten() {
  const vv = window.visualViewport;
  // Aeltere Browser kennen das nicht. Dann bleibt es beim alten Verhalten –
  // unschoen, aber nicht kaputt.
  if (!vv) return;


  const nachfuehren = () => {
    const verdeckt = window.innerHeight - vv.height;
    if (verdeckt > TASTATUR_AB_PX) {
      document.documentElement.style.setProperty('--sicht', `${vv.height}px`);
      // --versatz ist die Haelfte, die beim ersten Versuch gefehlt hat.
      // -----------------------------------------------------------------
      // Die Hoehe allein reicht nicht. iOS macht zweierlei, wenn die Tastatur
      // kommt: Es verkleinert den sichtbaren Ausschnitt UND es SCHIEBT ihn
      // nach oben ueber die Seite hinweg, damit das Eingabefeld darin liegt.
      // Das zweite ist kein Rollen – die Seite selbst steht still, es ist der
      // Ausschnitt, der wandert. Deshalb half window.scrollTo(0, 0) hier auch
      // nichts: Es gibt nichts zu rollen, die Seite ist overflow: hidden.
      //
      // Wie weit geschoben wurde, steht in visualViewport.offsetTop. Und weil
      // die Seite stillsteht, waehrend der Ausschnitt wandert, muss die
      // Ansicht um GENAU denselben Betrag mitwandern, damit sie wieder unter
      // dem Ausschnitt liegt. Das ist der Versatz.
      //
      // Verschoben wird nur .app, nicht der Anmeldebildschirm: Dort SOLL die
      // Karte ausweichen (siehe styles.css).
      document.documentElement.style.setProperty('--versatz', `${vv.offsetTop}px`);
    } else {
      // Tastatur wieder unten: Die Zeilen ganz wegnehmen, nicht auf einen Wert
      // setzen. Nur so gilt wieder der Rueckfall im Blatt (100dvh), und der
      // folgt den Leisten des Browsers von selbst.
      document.documentElement.style.removeProperty('--sicht');
      document.documentElement.style.removeProperty('--versatz');
    }
  };

  vv.addEventListener('resize', nachfuehren);
  // Auch bei scroll: iOS verschiebt den sichtbaren Ausschnitt manchmal, ohne
  // seine Hoehe zu aendern – dann kommt kein resize, aber die Ansicht steht
  // trotzdem verrutscht.
  vv.addEventListener('scroll', nachfuehren);
  nachfuehren();
}
tastaturBeobachten();

/* ---------------------------------------------------------------------------
   Messanzeige: ?mess=1
   ---------------------------------------------------------------------------
   Ein kleiner Kasten, der zeigt, was der Browser gerade meldet und was das
   Blatt daraus macht. Er ist da, weil ein Fehler gemeldet wurde, den keine
   Nachstellung hier reproduziert – das Formular wird auf dem Geraet gestaucht,
   im Nachbau nicht. Statt zu raten, welcher Wert schuld ist, zeigt das Geraet
   ihn selbst.

   Bewusst nicht auf localhost beschraenkt, anders als ?demo= und ?preview=:
   Der Fehler tritt auf dem Telefon auf, und das Telefon kann kein localhost
   der Entwicklungsmaschine. Er zeigt auch nichts Vertrauliches – nur Zahlen
   ueber das Fenster, in dem er selbst laeuft. Wer die Adresse nicht kennt,
   sieht ihn nie.

   pointer-events: none, damit er nichts abfaengt: Ein Messgeraet, das die
   Messung stoert, misst sich selbst. */
const MESS_SCHALTER = 'size_mess';

/* Fuenfmal in die freie Flaeche der Kopfzeile tippen schaltet die Anzeige an
   und wieder aus.
   ---------------------------------------------------------------------------
   Erst haengte das an der Marke – ein Fehler: Die Marke ist ein Link auf den
   X-Account. Beim ersten Tippen war man weg, und die vier weiteren gab es nie.

   Jetzt haengt es an der Kopfzeile selbst, und Beruehrungen, die auf einem
   Link oder Knopf landen, zaehlen nicht mit. Auf dem Handy bricht die
   Kopfzeile um: Marke links, Bild rechts, dazwischen rund 220 px, die nichts
   tun. Genau dort hinein.

   Der Umweg ueber die Adresse (?mess=1) reicht naemlich nicht: Der Fehler
   tritt auf dem Startbildschirm auf, und dort GIBT es keine Adresszeile – die
   App startet immer mit der start_url aus dem Manifest. Ein Schalter, den man
   nur in Safari umlegen kann, misst genau den Fall nicht, um den es geht.
   (Der Speicher hilft auch nicht: iOS haelt den einer abgelegten App getrennt
   von dem in Safari.)

   Fuenf Beruehrungen in zwei Sekunden auf eine Flaeche, die sonst nichts tut:
   Von allein macht das niemand, und wer es absichtlich macht, sieht Zahlen
   ueber sein eigenes Fenster. Mehr steht dort nicht. */
(function messSchalter() {
  const kopf = document.querySelector('.topbar');
  if (!kopf) return;
  let zaehler = 0;
  let letzte = 0;
  kopf.addEventListener('click', (e) => {
    // Wer den Link oder einen Knopf trifft, wollte den Link oder den Knopf.
    if (e.target.closest('a, button, input')) { zaehler = 0; return; }
    const jetzt = Date.now();
    zaehler = jetzt - letzte < 2000 ? zaehler + 1 : 1;
    letzte = jetzt;
    if (zaehler < 5) return;
    zaehler = 0;
    try {
      const an = localStorage.getItem(MESS_SCHALTER) === '1';
      localStorage.setItem(MESS_SCHALTER, an ? '0' : '1');
    } catch {}
    location.reload();
  });
})();

const messAn = (() => {
  if (new URLSearchParams(location.search).get('mess') === '1') return true;
  try { return localStorage.getItem(MESS_SCHALTER) === '1'; } catch { return false; }
})();

if (messAn) {
  const kasten = document.createElement('pre');
  kasten.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;'
    + 'margin:0;padding:6px 8px;border-radius:6px;pointer-events:none;'
    + 'background:rgba(0,0,0,.82);color:#9fe8b0;font:11px/1.35 ui-monospace,monospace;'
    + 'white-space:pre;max-width:calc(100vw - 12px);border:1px solid #2a2f3a';
  document.body.appendChild(kasten);

  const box = (s) => {
    const e = document.querySelector(s);
    if (!e) return 'fehlt';
    const r = e.getBoundingClientRect();
    return `${Math.round(r.top)}..${Math.round(r.bottom)} h=${Math.round(r.height)}`;
  };
  const stil = (n) => getComputedStyle(document.documentElement)
    .getPropertyValue(n).trim() || '(leer)';

  const zeigen = () => {
    const vv = window.visualViewport;
    const admin = document.querySelector('#poll-admin');
    kasten.textContent = [
      `innerHeight  ${window.innerHeight}`,
      vv ? `vv.height    ${Math.round(vv.height)}   offsetTop ${Math.round(vv.offsetTop)}`
         : 'vv           fehlt',
      vv ? `verdeckt     ${Math.round(window.innerHeight - vv.height)}` : '',
      `--sicht      ${stil('--sicht')}   --versatz ${stil('--versatz')}`,
      `body         ${Math.round(document.body.getBoundingClientRect().height)}`,
      `.app         ${box('.app')}`,
      `pane-polls   ${box('#pane-polls')}`,
      `poll-admin   ${box('#poll-admin')}`,
      admin ? `  braucht    ${admin.scrollHeight}` : '',
      `poll-list    ${box('#poll-list')}`,
      `start-knopf  ${box('#btn-create-poll')}`,
      // Nicht isStandalone() aufrufen: Die Funktion steht weiter unten und
      // ist hier noch nicht initialisiert – der Aufruf wuerfe einen Fehler,
      // und zwar ausgerechnet in dem Werkzeug, das Fehler finden soll.
      `standalone   ${window.matchMedia?.('(display-mode: standalone)').matches
        || window.navigator?.standalone === true}`,
    ].filter(Boolean).join('\n');
  };

  zeigen();
  window.visualViewport?.addEventListener('resize', zeigen);
  window.visualViewport?.addEventListener('scroll', zeigen);
  window.addEventListener('resize', zeigen);
  document.addEventListener('focusin', () => setTimeout(zeigen, 350));
  document.addEventListener('click', () => setTimeout(zeigen, 350));
  setInterval(zeigen, 500);
}

const INSTALL_SKIPPED = 'size_install_skipped';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  window.navigator?.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '');
/* Ein Telefon erkennt man am Finger, nicht an der Breite.
   ---------------------------------------------------------------------------
   Hier stand (max-width: 760px). Ein iPhone 14 im Querformat ist aber 844 px
   breit, ein Pro Max 932 – wer den Link quer oeffnet, galt damit als Rechner
   und bekam den Hinweis auf den Startbildschirm nie zu sehen.
   
   Das ist teurer als es klingt: Genau dieser Hinweis schuetzt davor, dass iOS
   die Sitzung nach ein paar Tagen wegraeumt. Ist sie weg, kostet die naechste
   Anmeldung wieder eine Zahlung.
   
   (hover: none) und (pointer: coarse) zusammen: Das erste allein trifft auch
   Fernseher, das zweite allein auch Rechner mit Touchscreen. Beide zusammen
   sind ein Geraet, das man in der Hand haelt. */
const isPhone = () =>
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

// Chrome bietet das Ablegen selbst an – wir fangen das Angebot ab und lösen es
// erst aus, wenn der Nutzer auf unseren Knopf tippt.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('#btn-install').hidden = false;
});

/**
 * Den Anmeldebildschirm zeigen.
 *
 * Im Blatt ist er anfangs versteckt, genau wie die App. Erst der Start
 * entscheidet, was zu sehen ist, und zeigt genau eines – sonst blitzt bei
 * jedem Aufruf kurz der Login auf, auch bei angemeldeten Leuten.
 */
function zeigeLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

/** Das Gegenstück – auch hier wird genau eines von beiden gezeigt. */
function zeigeApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}


function maybeShowInstallStep() {
  if (state.jwt) return;                      // wer schon drin ist, wird nicht aufgehalten
  if (!isPhone() || isStandalone()) return;
  try { if (localStorage.getItem(INSTALL_SKIPPED)) return; } catch { /* egal */ }

  // iOS kennt keinen Knopf dafür – dort bleibt nur die Anleitung.
  $('#ios-steps').hidden = !isIos();
  $('#btn-install').hidden = !deferredInstall;
  $('#step-address').hidden = true;
  $('#step-install').hidden = false;
}

function leaveInstallStep() {
  $('#step-install').hidden = true;
  $('#step-address').hidden = false;
}

$('#btn-skip-install').addEventListener('click', () => {
  try { localStorage.setItem(INSTALL_SKIPPED, '1'); } catch { /* egal */ }
  leaveInstallStep();
});

$('#btn-install').addEventListener('click', async () => {
  if (!deferredInstall) { leaveInstallStep(); return; }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  $('#btn-install').hidden = true;
  // Bei Zustimmung stehen bleiben: Der Nutzer soll aus der abgelegten Fassung
  // heraus verifizieren, nicht hier im Browser.
  if (outcome !== 'accepted') leaveInstallStep();
});

window.addEventListener('appinstalled', () => {
  // Nicht automatisch weiterspringen: Verifiziert werden soll aus der
  // abgelegten Fassung heraus, sonst liegt die Sitzung wieder im Browser.
  const lede = $('#step-install .lede');
  if (lede) lede.textContent = 'Added. Open SIZED from your home screen and verify there.';
  $('#btn-install').hidden = true;
});

/**
 * Fragt nach, ob die Zahlung angekommen ist – mit wachsendem Abstand.
 *
 * Ein fester Takt von vier Sekunden über das ganze 25-Minuten-Fenster wären
 * bis zu 375 Function-Aufrufe für einen einzigen Login, jeder davon mit einem
 * RPC-Scan im Rücken. Die Zahlung kommt fast immer in der ersten Minute an,
 * also wird dort eng getaktet und danach ausgedünnt: gleiche gefühlte
 * Geschwindigkeit, gut ein Zehntel der Aufrufe.
 */
function pollDelay(elapsedMs) {
  if (elapsedMs < 60_000) return 3_000;
  if (elapsedMs < 300_000) return 10_000;
  return 30_000;
}

/**
 * Die Uhr auf dem Zahlungsbildschirm.
 *
 * Sie hat mit dem Nachfragen NICHTS zu tun, und genau daran lag der Fehler:
 * Der Rest wurde nur dann neu geschrieben, wenn eine Antwort zurueckkam. Weil
 * der Abstand zwischen den Anfragen waechst (3s, 10s, 30s), sprang die Anzeige
 * mit – erst um drei Sekunden, nach fuenf Minuten um dreissig. Man wartet auf
 * eine Ueberweisung und sieht eine Uhr, die stockt; das sieht kaputt aus, und
 * in dem Moment ist Vertrauen das Einzige, was die Seite anzubieten hat.
 *
 * Warum kein setInterval(…, 1000): Browser halten 1000 ms nicht ein, sie
 * garantieren nur MINDESTENS 1000. Die paar Millisekunden Verspaetung summieren
 * sich, wandern gegen die echte Sekundengrenze – und irgendwann faellt eine
 * Zahl aus: 24:59, 24:58, 24:56. Also derselbe Fehler in klein.
 *
 * Stattdessen wird jeder naechste Aufruf auf die naechste Sekundengrenze
 * gelegt (left % 1000), plus 20 ms Sicherheitsabstand, damit er nicht knapp
 * davor landet und dieselbe Zahl zweimal schreibt. Der Wert selbst wird immer
 * aus deadline und Date.now() gerechnet, nie hochgezaehlt: Wer den Tab in den
 * Hintergrund schiebt, wo Browser Zeitgeber ausbremsen, sieht beim
 * Zurueckkommen sofort die richtige Zeit und nicht die aufgelaufene Differenz.
 */
const restText = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')} left`;

function starteUhr(deadline) {
  const zeichne = () => {
    const left = Math.max(0, deadline - Date.now());
    $('#pay-timer').textContent = restText(left);
    if (left <= 0) return;
    state.uhr = setTimeout(zeichne, (left % 1000) + 20);
  };
  zeichne();
}

function startPolling() {
  stopPolling();
  const id = state.challenge.challengeId;
  const geheimnis = state.challenge.secret;
  const deadline = new Date(state.challenge.expiresAt).getTime();
  const startedAt = Date.now();

  starteUhr(deadline);

  const tick = async () => {
    const left = Math.max(0, deadline - Date.now());

    try {
      const r = await callFunction('verify', {
        action: 'status', challengeId: id, secret: geheimnis,
      });
      if (r.status === 'verified') {
        stopPolling();
        vergissChallenge();
        state.jwt = r.token;
        schreib(TOKEN_KEY, r.token);
        state.me = r.profile;
        await enterApp();
        return;
      }
      if (r.status === 'expired') {
        stopPolling();
        vergissChallenge();
        $('#pay-error').textContent = 'This request expired. Start over to get a new amount.';
        $('#pay-error').hidden = false;
        return;
      }
    } catch { /* nächster Versuch */ }

    if (left <= 0) { stopPolling(); return; }
    state.poller = setTimeout(tick, pollDelay(Date.now() - startedAt));
  };

  tick();
}

/**
 * Ein Ausschalter fuer beide Zeitgeber, nicht zwei.
 *
 * Es sind zwei voellig verschiedene Dinge – das Nachfragen und die Uhr – aber
 * sie enden immer gemeinsam: bei bestaetigter Zahlung, bei Ablauf, beim
 * Abmelden. Zwei Ausschalter waeren zwei Stellen, an denen man einen vergisst,
 * und die vergessene Uhr laeuft dann unsichtbar weiter und schreibt in ein
 * Feld, das niemand mehr ansieht.
 */
const stopPolling = () => {
  if (state.poller) clearTimeout(state.poller);
  if (state.uhr) clearTimeout(state.uhr);
  state.poller = null;
  state.uhr = null;
};

function logout() {
  loesche(TOKEN_KEY);
  unsubscribeAll();
  stopHoldingsTick();
  state.dmCache.clear();
  state.jwt = null; state.me = null; state.db = null;
  zeigeLogin();
  $('#step-pay').hidden = true;
  $('#step-address').hidden = false;
}
$('#btn-logout').addEventListener('click', logout);

// ---------------------------------------------------------------------------
// App-Start
// ---------------------------------------------------------------------------

async function enterApp() {
  state.db = makeClient();

  state.cfg = unwrap(await state.db.from('app_config').select('*').eq('id', 1).single());
  if (!state.me) state.me = await loadMe();

  // Kommt jemand über einen geteilten Abstimmungslink, ist das Ziel eine
  // BESTIMMTE Abstimmung – nicht einfach die Liste.
  const zielPoll = /^#poll-\d+$/.test(location.hash);

  $('#dm-min-unit').textContent = 'in $' + state.cfg.symbol;

  // Im Normalfall wird die App sofort sichtbar: Die Seite baut sich vor den
  // Augen auf, und das ist besser als eine Sekunde Schwarz.
  //
  // Beim Abstimmungslink andersherum. Dort waere sichtbar: leere
  // Abstimmungsliste, dann springt sie voll. Also bleibt die App verborgen,
  // bis die Abstimmungen geladen sind – siehe unten.
  if (!zielPoll) zeigeApp();
  $('#poll-admin').hidden = !state.me.isAdmin;
  // Deutlich sichtbar, damit niemand die Vorschau für echte Rechte hält.
  // Der Balken sagt, WARUM die Seite gerade nicht die Wahrheit zeigt: Man
  // sieht Ansems Oberflaeche, hat aber keine seiner Rechte, und jeder Versuch
  // zu speichern wird abgelehnt. Ohne den Satz haelt man das fuer Fehler.
  //
  // Im Demomodus steht dort NICHTS mehr. Der Balken stand dort einmal auch,
  // und das war richtig gedacht – aber er ist nur auf localhost ueberhaupt
  // erreichbar, sieht ihn also ausschliesslich der, der die Adresse selbst
  // getippt hat. Der weiss, dass er ?demo= aufgerufen hat. Bezahlt hat den
  // Hinweis dafuer jedes Bildschirmfoto: ein gelber Balken quer ueber dem
  // unteren Rand, in jedem Bild und jedem Mitschnitt.
  //
  // Der Schutz gegen versehentliche Testdaten haengt nicht an diesem Balken,
  // sondern daran, dass im Demomodus nichts geladen und nichts geschrieben
  // wird – siehe DEMO_DMS oben. Der Balken hat nur davon erzaehlt.
  const flagge = $('#preview-flag');
  flagge.hidden = !PREVIEW_ADMIN;
  renderMe();

  // Tab-Auswahl vor dem Laden: Sonst überschreibt der Aufruf am Ende einen
  // Tabwechsel, den der Nutzer während des Ladens schon vorgenommen hat.
  // sync/catchUp aus: beide Bereiche werden direkt danach ohnehin geladen.
  //
  // Polls ist seit dem Entfernen des Chats der Startpunkt – und damit auch
  // beim Abstimmungslink schon der richtige Tab. Der Aufruf bleibt trotzdem
  // stehen: Er setzt state.activeTab, und davon haengt ab, was dieser Browser
  // per Realtime mithoert.
  selectTab('polls', { sync: false });
  syncRealtime({ catchUp: false });
  startHoldingsTick();

  // allSettled, nicht all.
  //
  // Vorher hat ein einziger fehlgeschlagener Bereich den ganzen Start
  // abgebrochen – und weil der Aufrufer daraufhin den Login-Bildschirm zeigt,
  // sah das für den Nutzer aus wie ein Rauswurf. Bei einer Seite, auf der ein
  // neuer Login echtes Geld kostet, ist das die denkbar schlechteste Reaktion
  // auf eine Kleinigkeit.
  //
  // Wer ein gültiges Token hat, kommt jetzt in jedem Fall in die App. Was
  // nicht laden konnte, wird gemeldet und bleibt leer.
  const results = await Promise.allSettled([loadPolls(), loadDms()]);
  const failed = results.map((r) => r.reason).filter(Boolean);
  if (failed.length) {
    for (const err of failed) console.error('[start] section failed to load:', err.message);
    toast(failed[0].message || 'Some parts could not be loaded', true);
  }

  // Erst jetzt, nachdem die Abstimmungen im Blatt stehen: Vorher gäbe es das
  // Ziel des Sprungs noch gar nicht. Steht in der Adresse keine Raute,
  // passiert hier nichts.
  //
  // ohneRollen, weil die Liste in diesem Moment noch niemand gesehen hat: Ein
  // weiches Scrollen von oben wäre eine Bewegung ohne Ausgangspunkt.
  springeZuPollAusUrl({ ohneRollen: zielPoll });

  // Und jetzt erst zeigen – mit der richtigen Abstimmung schon im Bild.
  if (zielPoll) zeigeApp();

  // Ohne await: Das Nachtragen der Vorschaukarten darf den Start nicht
  // aufhalten. Es betrifft nur Ansem und nur Abstimmungen, die noch keine
  // haben.
  ergaenzeFehlendeKarten();
}

async function loadMe() {
  const { data } = await state.db.from('wallets').select('*').eq('address', walletFromJwt()).maybeSingle();
  const wallet = walletFromJwt();
  return {
    wallet,
    handle: handleOf(wallet),
    tokens: Number(data?.ui_amount ?? 0),
    usd: Number(data?.usd_value ?? 0),
    isAdmin: PREVIEW_ADMIN || (Boolean(state.cfg.admin_wallet) && wallet === state.cfg.admin_wallet),
  };
}

/** Rohdaten aus dem Token – ohne Prüfung, nur zur Anzeige und Zeitrechnung. */
function jwtPayload() {
  try {
    const p = state.jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '=')));
  } catch { return null; }
}

function walletFromJwt() {
  return jwtPayload()?.wallet ?? null;
}


// ---------------------------------------------------------------------------
// Bestandstakt
// ---------------------------------------------------------------------------

/**
 * Zieht die $-Beträge aller sichtbaren Adressen einmal pro Minute nach.
 *
 * Zwei Dinge daran sind Absicht:
 *
 * 1. Der Takt hängt an der Uhr, nicht am Ladezeitpunkt. Mit einem schlichten
 *    setInterval nach dem Laden springen die Beträge bei jedem Besucher zu
 *    einem anderen Zeitpunkt – wer nebeneinander sitzt, sieht sekundenlang
 *    verschiedene Zahlen. An der vollen Minute ausgerichtet ändert sich alles
 *    bei allen im selben Moment. Serverseitig gilt dasselbe: Dort wendet ein
 *    einziger Lauf pro Minute einen Kurs auf alle Wallets an.
 *
 * 2. Es wird nur nachgeschlagen, nicht gerechnet. Was hier ankommt, hat die
 *    Datenbank geschrieben; der Browser hat keinen Einfluss darauf, welcher
 *    Betrag neben einem Namen steht.
 */
const TICK_MS = 60_000;
let tickTimer = null;

function startHoldingsTick() {
  stopHoldingsTick();
  // Bis zur nächsten vollen Minute warten, danach im Minutentakt.
  const bisVoll = TICK_MS - (Date.now() % TICK_MS);
  tickTimer = setTimeout(function tick() {
    refreshLiveHoldings();
    tickTimer = setTimeout(tick, TICK_MS);
  }, bisVoll);
}

function stopHoldingsTick() {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
}

/**
 * Zieht den eigenen Bestand nach.
 *
 * Bis zum Entfernen des Chats war das ein Sammelnachschlagen fuer JEDE gerade
 * sichtbare Adresse – neben jeder Nachricht stand ein Betrag, und alle mussten
 * im selben Takt nachziehen. Uebrig ist davon genau eine Adresse: die eigene.
 *
 * Die Betraege im Posteingang kommen nicht von hier, sondern aus der Sicht
 * dm_threads, und werden mit ihr zusammen geladen. Sie hier zusaetzlich jede
 * Minute nachzuschlagen waere eine zweite Wahrheit ueber dieselbe Zahl.
 *
 * Warum die eigene ueberhaupt noch: Sie steuert die Schreibsperre fuer DMs und
 * den Betrag oben rechts. Wer Token nachkauft, soll nicht neu laden muessen,
 * damit die Sperre aufgeht – einen Auffrischknopf gibt es nicht mehr.
 */
async function refreshLiveHoldings() {
  if (!state.db || document.hidden || !state.me?.wallet) return;

  // Bei Ansem gibt es nichts nachzuziehen: Seine Zahl steht nirgends mehr,
  // und an einer Schwelle kommt er nicht vorbei – renderDmGate() steigt bei
  // isAdmin vorher aus. Eine Abfrage pro Minute fuer einen Wert, den niemand
  // liest, ist genau die Sorte Arbeit, die man erst bemerkt, wenn man sie
  // sucht.
  if (state.me.isAdmin) return;

  let zeile;
  try {
    const { data, error } = await state.db
      .from('wallets').select('usd_value').eq('address', state.me.wallet).maybeSingle();
    if (error || !data) return;
    zeile = data;
  } catch { return; }

  const meins = Number(zeile.usd_value);
  if (Number.isFinite(meins) && meins !== Number(state.me.usd)) {
    state.me.usd = meins;
    renderMe();
  }
}

/**
 * Schreibrecht für DMs an Ansem.
 *
 * Der Posteingang ist der teure Kanal: Dort liest eine einzelne Person mit,
 * statt dass etwas im Strom vorbeizieht. Ansem stellt den Wert selbst ein
 * (siehe unten).
 *
 * Für ihn selbst gibt es hier nichts zu sperren; er sieht ohnehin die
 * Posteingangsansicht und nicht dieses Eingabefeld.
 */
function renderDmGate() {
  const min = Number(state.cfg.min_dm_usd ?? 0);
  const allowed = state.me.isAdmin || min <= 0 || Number(state.me.usd ?? 0) >= min;

  $('#dm-form').classList.toggle('locked', !allowed);
  // Wer nicht schreiben darf, braucht auch keinen Antwortknopf.
  $('#dm-user').classList.toggle('no-write', !allowed);
  $('#dm-gate').hidden = allowed;
  if (!allowed) clearDmReply();
  if (!allowed) {
    $('#dm-gate-text').innerHTML = gateText(min, 'to message Ansem');
  }
}

/**
 * Der Text im Sperrhinweis.
 *
 * Nimmt den Anlass als Argument, obwohl es seit dem Entfernen des Chats nur
 * noch einen gibt. Das bleibt so: Die Trennung zwischen "wie viel" und "wofuer"
 * ist der Grund, warum der Satz beim naechsten Kanal nicht neu geschrieben
 * werden muss.
 *
 * Hier stand ein zweiter Satz: "You hold $102." Er ist weg, und zwar nicht nur
 * aus Geschmack. Der eigene Bestand steht bei jedem, der diesen Hinweis
 * ueberhaupt sieht, schon oben rechts in der Kopfzeile – dieselbe Zahl aus
 * derselben Quelle, zwei Handbreit darueber. Zweimal dasselbe zu sagen macht
 * die Aussage nicht deutlicher, es macht nur die zweite Stelle zu einer, die
 * irgendwann von der ersten abweichen kann.
 *
 * Und der Satz war die unfreundlichere Haelfte des Hinweises: "so viel
 * brauchst du" ist eine Auskunft, "so wenig hast du" ist eine Bewertung. Was
 * fehlt, rechnet sich ohnehin jeder selbst aus.
 */
function gateText(min, was) {
  return `Hold at least <strong>${esc(fmtUsd(min))}</strong> in $${esc(state.cfg.symbol)} ${esc(was)}.`;
}

function renderMe() {
  const holdings = $('#me-holdings');

  // Oben rechts stehen zwei verschiedene Dinge:
  //
  //   Ansem       sein Profilbild. Faehrt der Zeiger darueber, sagt ein
  //               Hinweis daneben, mit welchem Konto er angemeldet ist – bei
  //               ihm steht dort keine Adresse, und ein Bild sagt das nicht
  //               von selbst.
  //   alle andern ihre drei Zeichen, in ihrer eigenen Farbe – genau so, wie
  //               sie in den DMs und im Posteingang stehen.
  //
  // Hier stand eine Runde lang die gekuerzte Adresse (EMwU…QLxP) in der Farbe
  // des Betrags daneben, mit dem Argument: Oben rechts sei die Frage nicht
  // "wer bin ich", sondern "mit welcher Wallet bin ich hier".
  //
  // Das Argument stimmt, es rechtfertigte die Aenderung nur nicht: Die drei
  // Zeichen SIND, wie man auf dieser Seite heisst – neben jeder eigenen
  // Nachricht, im Zitat, im Posteingang. Oben rechts etwas anderes zu zeigen
  // hiess, sich unter zwei Namen zu sehen. Und die Farbe traegt die Auskunft
  // mit: Sie wird aus der vollen Adresse gerechnet, ist also fuer jede Wallet
  // eine andere.
  //
  // Beides sind <span> und keine Knoepfe. Es gibt hier nichts zu druecken: Der
  // Hinweis kommt mit dem Zeiger und geht mit ihm, das macht das Blatt allein.
  // Hier stand eine Runde lang ein <button> mit Klickzuhoerern, einem
  // Aussenklick-Handler und einer Escape-Taste – alles fuer einen Kasten, der
  // sich von selbst zeigt. Ein Knopf, der auf einen Klick nichts tut, liest
  // sich ausserdem als Defekt.
  //
  // Das Kuerzel bleibt bei Ansem im Dokument, obwohl das Blatt es versteckt:
  // Eine Vorlesestimme braucht einen Namen, ein Bild ist ihr keiner. Den
  // Hinweis bekommt sie ueber aria-describedby, auch wenn er nicht zu sehen
  // ist – ein Kasten, den nur der Zeiger hervorholt, waere fuer sie sonst gar
  // nicht da.
  $('#me-handle').outerHTML = state.me.isAdmin
    ? `<span id="me-handle" class="handle h admin-name" aria-describedby="me-info"
        ><span class="kuerzel">${esc(state.me.handle)}</span></span>`
    : `<span id="me-handle" class="handle h t${toneOf(state.me.wallet)}"
        >${esc(state.me.handle)}</span>`;

  // "DM" für alle anderen, "DMs" nur für Ansem – und das ist keine Kosmetik,
  // sondern die Wahrheit über den Tab: Ein Nutzer hat genau EIN Gespräch, das
  // mit Ansem. Es gibt für ihn keine Liste, in die er kommt, sondern einen
  // Verlauf. Ansem sieht dahinter einen Posteingang mit allen.
  //
  // Umgeschaltet wird eine Klasse und nicht der Text: Das "s" steht als
  // eigenes Element im Blatt und wird nur unsichtbar gemacht. Sein Platz
  // bleibt damit stehen, und Polls daneben rückt nicht.
  //
  // Wer hier wieder textContent setzt, loescht das Element und bekommt die
  // Verschiebung zurueck – dann stehen die Reiter bei Ansem und einem Nutzer
  // 4,5 px auseinander.
  $('[data-tab="dms"]').classList.toggle('zeigt-s', Boolean(state.me.isAdmin));

  // Der eigene Bestand steht oben rechts – bei allen ausser Ansem.
  //
  // Fuer sie ist es die Zahl, an der alles haengt: Sie entscheidet, ob sie
  // schreiben duerfen, und sie steht neben jeder ihrer Nachrichten. Wer sie
  // oben sieht, weiss, woran er ist.
  //
  // Bei Ansem beantwortet sie keine Frage. Er kommt an keiner Schwelle
  // vorbei, sein Bestand aendert nichts an dem, was er tun kann – und er
  // steht ausgerechnet ueber einem Posteingang, in dem jede Zeile einen
  // Betrag traegt. Genau dort ist eine weitere Zahl keine Auskunft mehr,
  // sondern eine, die man mitliest und wieder verwirft.
  holdings.hidden = Boolean(state.me.isAdmin);
  if (!state.me.isAdmin) holdings.textContent = fmtUsd(state.me.usd);
  renderDmGate();
}

/* Hier standen die Zuhoerer fuer den Hinweis neben Ansems Profilbild: ein
 * Klick zum Auf- und Zuklappen, ein zweiter aufs Dokument zum Schliessen und
 * die Escape-Taste dazu.
 *
 * Alle drei sind weg. Der Hinweis erscheint, solange der Zeiger auf dem Bild
 * steht, und verschwindet, sobald er herunterfaehrt – das steht als eine Regel
 * im Blatt (siehe .me-info) und braucht hier keine Zeile.
 */

/* Hier stand der Auffrischknopf mit seinem drehenden Symbol.
 *
 * Er ist weg, weil er nichts tat, was nicht ohnehin passiert:
 *
 *   - Der Helius-Webhook meldet jede Bewegung des $ANSEM-Mints und liest die
 *     betroffenen Wallets sofort neu ein.
 *   - Der Cron-Lauf von refresh-holdings ist das Netz darunter, auch fuer
 *     Kursaenderungen ohne Transfer.
 *   - refreshLiveHoldings() holt den gespeicherten Stand jede Minute in die
 *     offene Seite, ohne dass jemand etwas druecken muss.
 *
 * Was mit ihm verschwunden ist, gehoert dazugesagt: Der Knopf war der einzige
 * Weg, eine Kettenabfrage VON HAND auszuloesen. Wer gerade nachgekauft hat,
 * wartet jetzt auf Webhook oder Cron statt selbst zu druecken. Solange beide
 * laufen, sind das Sekunden; faellt beides aus, faellt es niemandem mehr auf,
 * weil es keinen Knopf mehr gibt, der sichtbar nichts tut.
 *
 * Die Edge Function refresh-holdings bleibt bestehen – sie ist genau das, was
 * der Cron aufruft.
 */


// ---------------------------------------------------------------------------
// Realtime
//
// Supabase rechnet Realtime pro Empfänger ab: Eine Stimme bei 1.000
// zuhörenden Browsern sind 1.000 abgerechnete Nachrichten. Deshalb hört jeder
// Browser nur das mit, was er gerade auch anzeigt:
//
//   * Seite im Hintergrund (anderer Tab, Handy gesperrt) -> gar nichts.
//     supabase-js trennt die WebSocket-Verbindung, sobald der letzte Kanal weg
//     ist; damit fällt der Nutzer auch aus der Zählung der gleichzeitigen
//     Verbindungen heraus.
//   * Abstimmungs-Kanal nur, solange der Abstimmungs-Tab offen ist.
//   * DMs laufen mit, solange die Seite sichtbar ist: winziges Volumen, aber
//     der Nutzer soll Ansems Antwort sofort sehen, egal wo er gerade ist.
//
// Beim Wiederanmelden wird der jeweilige Bereich einmal frisch geladen, damit
// nichts fehlt, was während der Pause passiert ist.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rückfallebene
//
// Kommt die Live-Leitung nicht zustande – Verbindungskontingent erschöpft,
// Störung bei Supabase, Firmennetz, das WebSockets blockiert –, dann darf die
// Seite nicht einfach verstummen. Genau das wäre sonst der Fall: Anmelden,
// Verlauf laden und Schreiben laufen über einen anderen Weg und funktionieren
// weiter. Nur neue Nachrichten kämen nie an, ohne jeden Hinweis.
//
// Also fragt die Seite in dem Fall selbst nach. Drei Sekunden Verzögerung
// merkt kaum jemand; eine tote Abstimmung merkt jeder. Nachfragen zählt zudem
// nicht als Realtime-Nachricht, kostet also nichts extra.
// ---------------------------------------------------------------------------

const FALLBACK_MS = 3000;

function startFallback(name) {
  // Kanäle, die wir selbst geschlossen haben, sollen nicht nachgefragt werden.
  if (!state.channels[name] || state.fallback[name]) return;
  // Die Abstimmungen fragen ohnehin im Takt nach, ob die Leitung steht oder
  // nicht – eine zweite Uhr daneben wäre nur eine doppelte Abfrage, und die
  // Meldung „Live updates unavailable" wäre schlicht falsch: Die Stimmen
  // kommen weiter an. Bricht die Leitung, verzögert sich einzig, wann eine
  // NEUE Abstimmung auftaucht, und auch die holt der Takt binnen 5 Sekunden.
  if (name === 'polls') return;
  console.warn(`[realtime] ${name}: no live connection, polling every ${FALLBACK_MS} ms`);
  if (!Object.keys(state.fallback).length) {
    toast('Live updates unavailable - refreshing every few seconds');
  }
  state.fallback[name] = setInterval(() => {
    CATCH_UP[name]().catch(() => { /* beim nächsten Durchlauf erneut */ });
  }, FALLBACK_MS);
}

function stopFallback(name) {
  if (!state.fallback[name]) return;
  clearInterval(state.fallback[name]);
  delete state.fallback[name];
}

const logStatus = (name) => (status, err) => {
  if (status === 'SUBSCRIBED') {
    console.info(`[realtime] ${name} verbunden`);
    // Wieder da: einmal nachladen, um die Lücke zu schließen, dann aufhören
    // zu fragen.
    if (state.fallback[name]) {
      CATCH_UP[name]().catch(() => {});
      toast('Live updates are back');
    }
    stopFallback(name);
  } else if (status === 'CHANNEL_ERROR') {
    console.warn(`[realtime] ${name} error:`, err?.message ?? err);
    startFallback(name);
  } else if (status === 'TIMED_OUT') {
    console.warn(`[realtime] ${name} timed out`);
    startFallback(name);
  }
};

/**
 * Mehrere Ereignisse kurz hintereinander zu einem Nachladen zusammenfassen.
 * Ohne das löst jede einzelne Stimme in jedem offenen Browser eine eigene
 * Abfrage aus – bei einer laufenden Abstimmung wäre das ein Anfragensturm.
 */
function reloadSoon(key, fn, delay = 400) {
  clearTimeout(state.reloadTimers[key]);
  state.reloadTimers[key] = setTimeout(fn, delay);
}

// ---------------------------------------------------------------------------
// Stimmen werden nicht zugestellt, sondern nachgefragt
//
// Hier stand einmal eine dritte Zeile: `.on(… table: 'votes', refresh)`. Sie
// hiess: Supabase, melde JEDE abgegebene Stimme an JEDEN offenen Browser.
//
// Supabase zählt solche Meldungen einzeln – eine Änderung an 500 Zuhörer sind
// 500 Nachrichten, nicht eine. Und weil `votes_read` in der Datenbank auf
// `using (true)` steht, ist jeder Zuhörer berechtigt, keiner fällt weg.
//
// Das rechnet sich so: Ansem stellt eine Abstimmung online, 500 Leute sind da
// und stimmen in einer halben Minute ab. Das sind rund 17 Stimmen pro Sekunde
// mal 500 Browser – etwa 8.300 Nachrichten pro Sekunde. Das Kontingent liegt
// je nach Tarif bei 500 oder 2.500. Darüber schliesst Supabase die Kanäle mit
// „Too many messages per second", alle treten gleichzeitig neu bei und laufen
// ins nächste Limit. Ausgerechnet in der Minute, auf die alles hinausläuft.
//
// Eine Stimmenzahl ist aber ein Zähler, kein Ereignis. Niemand muss auf die
// Zehntelsekunde wissen, dass ein Fremder abgestimmt hat – die Balken wandern
// ohnehin dauernd. Also fragt der Polls-Tab von sich aus nach, solange er offen
// ist. Aus 8.300 Nachrichten pro Sekunde werden 500 geteilt durch 5, also 100
// ganz gewöhnliche Abfragen – die zählen gegen kein Realtime-Kontingent.
//
// Was live bleibt: eine NEUE oder BEENDETE Abstimmung. Das passiert ein paar
// Mal am Tag und soll sich sofort anfühlen.
//
// Wer selbst abstimmt, wartet auf nichts: vote() lädt direkt neu.
//
// Passend dazu ist public.votes aus der Realtime-Veröffentlichung genommen
// (Wanderung 20260903040000_votes_nicht_mehr_live.sql). Wer die Zeile oben je
// wieder einbaut, muss die Tabelle dort auch wieder aufnehmen – sonst kommt
// nichts an, ohne Fehlermeldung.
// ---------------------------------------------------------------------------

const STIMMEN_TAKT_MS = 5000;

/**
 * Nach einem Stups die DMs nachziehen – und dabei nicht beim ersten Fehler
 * aufgeben.
 *
 * Hier stand nur `await loadDms()` ohne jede Absicherung. Der Unterschied fiel
 * beim Blick in die Konsole auf: Beim Umstellen der Datenbankgröße und während
 * eines Lasttests scheiterten Abfragen mit `net::ERR_FAILED` – die Antwort kam
 * gar nicht erst zustande. Trifft so ein Moment genau den Stups, ging er still
 * verloren, und die Nachricht erschien erst, wenn zufällig etwas anderes ein
 * Nachladen auslöste. Bei einer DM, die Ansem daraufhin nicht sieht, ist das
 * mehr als ein Schönheitsfehler.
 *
 * Drei Versuche mit wachsendem Abstand (0,6 / 1,2 s) decken genau den Fall ab,
 * um den es geht: eine kurze Störung. Eine längere fängt ohnehin die
 * Rückfallebene ab, die anspringt, sobald der Kanal selbst Fehler meldet.
 *
 * Der Abstimmungs-Takt braucht das nicht – er fragt sowieso alle 5 Sekunden
 * erneut nach. Ein Stups kommt nur einmal.
 */
async function dmsNachziehen(versuche = 3) {
  for (let i = 0; i < versuche; i++) {
    try {
      await loadDms();
      if (state.activeThread) openThread(state.activeThread);
      return true;
    } catch (e) {
      console.warn(`[dm] reload failed (${i + 1}/${versuche}):`, e.message);
      if (i < versuche - 1) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** i));
      }
    }
  }
  // Aufgeben, aber nicht schweigen: Der nächste Tabwechsel, das nächste
  // Sichtbarwerden und der nächste Stups laden ohnehin neu.
  console.error('[dm] reload after nudge failed for good');
  return false;
}

const CHANNELS = {
  polls: () => {
    const refresh = () => reloadSoon('polls', loadPolls);
    return state.db.channel('hub:polls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, refresh);
  },

  // -------------------------------------------------------------------------
  // DMs: ein Stups auf einem eigenen Kanal, keine Meldung an alle
  //
  // Hier stand `.on('postgres_changes', … table: 'dms')`. Bei dieser Art Kanal
  // prüft Supabase die Rechte EINZELN, für jeden Zuhörer, bei jeder Änderung –
  // eine DM an Ansem bei 3.000 offenen Seiten sind 3.000 Prüfungen. Und das
  // läuft einfädig, ein größerer Server hilft also nicht.
  //
  // Jetzt schickt ein Trigger in der Datenbank einen Stups an genau zwei
  // Kanäle: den eigenen Thread und Ansems Posteingang. Zwei Zustellungen statt
  // dreitausend Prüfungen, und die Rechte werden einmal beim Betreten geprüft.
  //
  // Der Stups trägt KEINEN Inhalt – nur "in deinem Thread hat sich etwas
  // getan". Gelesen wird danach wie immer über die Datenbank, wo die RLS von
  // public.dms greift. Selbst ein falsch gesetzter Kanal gäbe also nichts
  // preis ausser der Tatsache, dass eine Nachricht existiert.
  //
  // private: true ist nicht optional. Ohne das prüft Supabase die Zugangsregel
  // gar nicht erst, und der Kanal wäre für jeden offen.
  //
  // Zugehörige Wanderung: 20260904010000_dm_broadcast.sql. Wer diese Zeilen je
  // auf postgres_changes zurückbaut, muss public.dms dort wieder in die
  // Veröffentlichung aufnehmen – sonst kommt stillschweigend nichts an.
  // -------------------------------------------------------------------------
  dms: () => {
    const nachladen = () => reloadSoon('dms', dmsNachziehen);
    // Ansem hört an einem Posteingang für alle Threads, ein Nutzer nur am
    // eigenen. Zwei verschiedene Kanalnamen, dieselbe Behandlung.
    const thema = state.me.isAdmin ? 'dm:admin' : `dm:${state.me.wallet}`;
    return state.db
      .channel(thema, { config: { private: true } })
      .on('broadcast', { event: 'dm' }, nachladen);
  },
};

/** Was dieser Browser gerade mithören soll. */
function wantedChannels() {
  if (document.visibilityState === 'hidden') return [];
  const wanted = [];
  // Der DM-Kanal heisst seit dem Umbau nach der eigenen Wallet (dm:<adresse>)
  // beziehungsweise dm:admin. Ohne angemeldeten Nutzer gaebe es also einen
  // Kanal namens "dm:undefined" – der wuerde von der Zugangsregel abgewiesen,
  // und die Seite meldete eine Stoerung, wo gar keine ist.
  if (state.me?.wallet) wanted.push('dms');
  if (state.activeTab === 'polls') wanted.push('polls');
  return wanted;
}

/** Nachladen, um die Lücke zu schließen, die während der Abwesenheit entstand. */
const CATCH_UP = { polls: () => loadPolls(), dms: () => loadDms() };

/**
 * Der Takt, in dem der offene Polls-Tab die Stimmenzahlen nachfragt.
 *
 * Läuft genau so lange wie der Kanal 'polls' – also nur, wenn der Tab wirklich
 * offen und die Seite sichtbar ist. Ein Browser im Hintergrund fragt nichts.
 */
function taktAn() {
  if (state.stimmenTakt) return;
  state.stimmenTakt = setInterval(() => {
    loadPolls().catch((e) => console.warn('[poll] tick:', e.message));
  }, STIMMEN_TAKT_MS);
}

function taktAus() {
  clearInterval(state.stimmenTakt);
  state.stimmenTakt = null;
}

/**
 * Bringt die offenen Kanäle mit dem gewünschten Zustand in Deckung. Darf
 * beliebig oft aufgerufen werden – was schon läuft, bleibt unangetastet.
 */
function syncRealtime({ catchUp = true } = {}) {
  if (!state.db) return;
  const wanted = new Set(wantedChannels());

  for (const [name, channel] of Object.entries(state.channels)) {
    if (wanted.has(name)) continue;
    // Erst austragen, dann schließen: Sonst meldet supabase-js das Schließen
    // zurück, während der Kanal noch als gewollt gilt, und die Rückfallebene
    // würde für etwas anspringen, das wir selbst abgeschaltet haben.
    delete state.channels[name];
    stopFallback(name);
    if (name === 'polls') taktAus();
    state.db.removeChannel(channel);
  }

  for (const name of wanted) {
    if (state.channels[name]) continue;
    state.channels[name] = CHANNELS[name]().subscribe(logStatus(name));
    if (name === 'polls') taktAn();
    if (catchUp) CATCH_UP[name]().catch(() => { /* nächster Versuch beim nächsten Wechsel */ });
  }
}

function unsubscribeAll() {
  taktAus();
  for (const name of Object.keys(state.fallback)) stopFallback(name);
  for (const channel of Object.values(state.channels)) state.db?.removeChannel(channel);
  state.channels = {};
  for (const t of Object.values(state.reloadTimers)) clearTimeout(t);
  state.reloadTimers = {};
}

document.addEventListener('visibilitychange', () => {
  syncRealtime();
  // Ein Tab im Hintergrund fragt nichts ab. Beim Zurückkommen sofort einmal
  // nachziehen, statt bis zur nächsten vollen Minute veraltete Beträge zu
  // zeigen.
  if (!document.hidden) refreshLiveHoldings();
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

$$('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

function selectTab(tab, { sync = true } = {}) {
  state.activeTab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
  $('#pane-polls').hidden = tab !== 'polls';
  $('#pane-dms').hidden = tab !== 'dms';
  // Der Tabwechsel entscheidet mit, was dieser Browser mithört.
  if (sync) syncRealtime();
}
const scrollBottom = (el) => { el.scrollTop = el.scrollHeight; };

// ---------------------------------------------------------------------------
// Zahlenfelder
//
// Hier stand bis zum Entfernen des Chats auch dessen Betragsfilter. Die drei
// Helfer darunter sind geblieben, weil sie nie etwas mit dem Chat zu tun
// hatten: Sie gehoeren zu einem Eingabefeld, in das eine Geldsumme getippt
// wird. Davon gibt es noch eines – Ansems Schwelle fuer DMs.
// ---------------------------------------------------------------------------

/**
 * Laesst in einem Feld nur eine Zahl zu.
 *
 * Das Feld ist bewusst type="text": Ein Zahlenfeld blendet in jedem Browser die
 * winzigen Auf-/Ab-Pfeile ein, die auf einem Telefon nicht zu treffen sind.
 * Der Preis dafuer ist, dass der Browser auch keine Eingabe mehr prueft. Das
 * passiert deshalb hier.
 *
 * Erlaubt sind Ziffern und ein einzelner Punkt als Dezimaltrennzeichen.
 * Kommas fallen weg: Sie sind in diesem Feld das Tausendertrennzeichen und
 * werden von der Anzeige selbst gesetzt, siehe gruppiere().
 *
 * Vor dem Punkt ist bei MAX_STELLEN Schluss. Weitere Ziffern erscheinen gar
 * nicht erst – dasselbe Verhalten, das ein Feld mit maxlength haette. Nur
 * laesst sich maxlength hier nicht benutzen: Der Browser zaehlt Zeichen, und
 * die Trennzeichen setzt diese Datei selbst dazu. Eine Grenze von 13 waere
 * beim Tippen richtig und beim Einfuegen falsch, weil eingefuegter Text die
 * Kommas noch nicht hat.
 *
 * Nachkommastellen bleiben ungezaehlt. Sie machen die Zahl nicht groesser,
 * und gespeichert wird ohnehin auf zwei gerundet.
 */
const MAX_STELLEN = 10;

function saubereZahl(text) {
  let out = '';
  let trenner = false;
  let stellen = 0;
  for (const c of String(text)) {
    if (c >= '0' && c <= '9') {
      if (trenner) { out += c; continue; }
      if (stellen >= MAX_STELLEN) continue;
      stellen += 1;
      out += c;
      continue;
    }
    if (c === '.' && !trenner) { out += '.'; trenner = true; }
  }
  return out;
}

/**
 * Setzt Tausendertrennzeichen.
 *
 * Ab welcher Groesse? Ab vier Stellen, also ab 1,000 – und zwar nicht aus
 * Geschmack: Genau dort setzt sie auch der Betrag im Posteingang. In einer
 * Zeile steht "$1,325", und wer im Schwellenfeld "1325" eintippt, soll dieselbe
 * Zahl sehen und nicht raten muessen, ob er eine Null zu viel erwischt hat. Ab
 * fuenf Stellen zu gruppieren waere typografisch vertretbar, hier aber
 * inkonsequent.
 *
 * Komma und nicht Punkt, obwohl das auf einer deutschen Tastatur ungewohnt
 * ist: Die Seite ist durchgehend englisch, und "$1.325" liest sich im
 * Deutschen wie ein Betrag mit Nachkommastellen – also ausgerechnet
 * tausendmal falsch. Derselbe Grund steht schon bei nfFull weiter oben.
 *
 * Nur der Teil vor dem Punkt wird gruppiert. Nachkommastellen bekommen keine
 * Trennzeichen, sonst kaeme aus 0.12345 ein "0.123,45".
 */
function gruppiere(roh) {
  const text = String(roh);
  if (text === '') return '';
  const punkt = text.indexOf('.');
  const ganz = punkt === -1 ? text : text.slice(0, punkt);
  const rest = punkt === -1 ? '' : text.slice(punkt);
  return ganz.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
}

/**
 * Haengt Pruefung und Gruppierung an ein Feld.
 *
 * Der Umweg ueber die Schreibmarke ist noetig: Ersetzt man den Feldinhalt, setzt
 * der Browser die Marke ans Ende. Wer mitten in einer Zahl tippt, stuende
 * danach hinter der letzten Ziffer statt an seiner Stelle.
 *
 * Gezaehlt werden dabei nur Ziffern und der Punkt, nicht die Trennzeichen: Die
 * verschieben sich beim Tippen staendig – aus "999" wird mit einer weiteren
 * Ziffer "9,999", und alles danach rutscht um eine Stelle. Die Marke gehoert
 * hinter dieselbe Ziffer wie vorher, nicht an dieselbe Zeichenposition.
 */
function nurZahlen(input) {
  input.addEventListener('input', () => {
    const vorher = input.value;
    const pos = input.selectionStart ?? vorher.length;
    const zeichenDavor = saubereZahl(vorher.slice(0, pos)).length;

    const nachher = gruppiere(saubereZahl(vorher));
    if (nachher === vorher) return;
    input.value = nachher;

    let i = 0;
    let gezaehlt = 0;
    while (i < nachher.length && gezaehlt < zeichenDavor) {
      if (nachher[i] !== ',') gezaehlt++;
      i++;
    }
    try { input.setSelectionRange(i, i); } catch { /* nicht ueberall moeglich */ }
  });
}

nurZahlen($('#dm-min-input'));

/**
 * Der Strich rechts im Posteingang: erscheint beim Rollen, sagt wo man steht,
 * und geht wieder.
 *
 * Er ist kein Rollbalken des Browsers, sondern ein eigenes Kaestchen – warum,
 * steht in styles.css bei #thread-strich. Der Kern davon: Die Leiste des
 * Browsers ist immer so lang wie der sichtbare Anteil am Ganzen. Bei drei
 * Gespraechen fuellt sie fast die ganze Bahn. Diese Marke ist stattdessen
 * IMMER gleich klein und sagt nur eines, naemlich wo man steht.
 *
 * Gerechnet wird nur beim Rollen, und das genuegt: Zu sehen ist die Marke
 * ohnehin nur dann. Waechst die Liste oder aendert sich die Fensterhoehe,
 * waehrend sie unsichtbar ist, steht sie beim naechsten Rollen von selbst
 * wieder richtig – es braucht also keinen Beobachter, der zwischendurch
 * nachmisst.
 *
 * 700 ms sind kein Messwert, sondern die Spanne, in der eine Handbewegung noch
 * eine ist: Wer mit dem Finger nachschiebt, soll den Strich nicht zwischendurch
 * verlieren.
 */
const STRICH_BLEIBT = 700;
/**
 * Wie lang die Marke wird.
 *
 * Grundsatz ist der Anteil des Sichtbaren am Ganzen – also das, was ein
 * Rollbalken ohnehin tut: Bei einer langen Liste wird die Marke kurz, bei
 * einer kurzen lang. Das ist die Auskunft, die eine feste Groesse nicht geben
 * kann.
 *
 * Nur an den Raendern nicht. Ohne Deckel wuerde die Marke bei acht
 * Gespraechen fast die ganze Bahn fuellen und waere kein Zeichen mehr,
 * sondern ein Streifen; ohne Boden verschwaende sie bei sehr langen Listen zu
 * einem Punkt, den man beim Rollen aus den Augen verliert.
 */
const STRICH_MAX = 64;
const STRICH_MIN = 24;
{
  const liste = $('#thread-items');
  const strich = $('#thread-strich');
  let weg;

  const setze = () => {
    const rollweg = liste.scrollHeight - liste.clientHeight;
    // Nichts zu rollen: Dann gibt es auch keine Stelle, an der man stuende.
    if (rollweg <= 0) { liste.classList.remove('rollt'); return; }

    const anteil = liste.clientHeight / liste.scrollHeight;
    // Die eigene Zahl weiterverwenden statt offsetHeight zurueckzulesen: Der
    // Browser rechnet erst beim naechsten Bild nach, und die Lage haengt an
    // genau dieser Hoehe.
    const hoch = Math.round(
      Math.min(STRICH_MAX, Math.max(STRICH_MIN, liste.clientHeight * anteil)));
    strich.style.height = `${hoch}px`;

    const wo = Math.min(1, Math.max(0, liste.scrollTop / rollweg));
    strich.style.top = `${Math.round(wo * (liste.clientHeight - hoch))}px`;
    liste.classList.add('rollt');
  };

  liste.addEventListener('scroll', () => {
    setze();
    clearTimeout(weg);
    weg = setTimeout(() => liste.classList.remove('rollt'), STRICH_BLEIBT);
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Abstimmungen
// ---------------------------------------------------------------------------

/**
 * Drei erfundene Abstimmungen fuer den Demomodus.
 *
 * Bewusst mit sehr verschiedenen Summen: 2,4 Mio, 184 Tausend, 912 Dollar.
 * Genau daran entscheidet sich, ob die Zahlen in der Zeile noch
 * nebeneinanderpassen und ob kurzUsd() sinnvoll rundet – bei drei Abstimmungen
 * derselben Groessenordnung sieht jede Fassung gut aus.
 *
 * Und drei verschiedene Zustaende, weil sie verschieden aussehen: eine mit
 * Frist (die Zeile wird unter einer Stunde gold), eine ohne, eine geschlossene.
 *
 * Die Form ist genau die, die loadPolls() sonst aus der Datenbank baut – sonst
 * wuerde hier eine Oberflaeche geprueft, die es so nicht gibt.
 */
function demoPolls() {
  const inStunden = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const bauen = (id, question, closesAt, closed, paare) => {
    const totalUsd = paare.reduce((a, [, usd]) => a + usd, 0);
    return {
      id, question, closesAt, closed, totalUsd, myOptionId: null,
      options: paare.map(([label, usd], i) => ({
        id: id * 100 + i, label, usd,
        share: totalUsd > 0 ? usd / totalUsd : 0,
      })),
    };
  };
  return [
    bauen(9003, 'Where should I stream next?', inStunden(3), false, [
      ['Twitch', 1_640_000], ['X', 620_000], ['Both, alternating', 148_000],
    ]),
    bauen(9002, 'Should we do a weekly AMA?', null, false, [
      ['Yes, every Friday', 121_000], ['No, keep it spontaneous', 63_000],
    ]),
    bauen(9001, 'Change the ticker?', inStunden(-26), true, [
      ['Keep $ANSEM', 640], ['Something shorter', 180],
      ['Put it to a second vote', 62], ['No opinion', 30],
    ]),
  ];
}

async function loadPolls() {
  // Im Demomodus wird nichts geladen – siehe DEMO_DMS ganz oben.
  if (DEMO_DMS) {
    state.polls = demoPolls();
    renderPolls();
    return;
  }

  const [polls, results, mine] = await Promise.all([
    state.db.from('polls')
      .select('id, question, created_at, closes_at, closed, poll_options(id, label, idx)')
      .order('created_at', { ascending: false }).limit(50).then(unwrap),
    state.db.from('poll_results').select('*').then(unwrap),
    state.db.from('votes').select('poll_id, option_id').eq('wallet', state.me.wallet).then(unwrap),
  ]);

  const byOption = new Map(results.map((r) => [r.option_id, r]));
  const myVote = new Map(mine.map((v) => [v.poll_id, v.option_id]));

  state.polls = polls.map((p) => {
    const options = [...p.poll_options].sort((a, b) => a.idx - b.idx);
    const totals = options.map((o) => Number(byOption.get(o.id)?.usd ?? 0));
    const totalUsd = totals.reduce((a, b) => a + b, 0);
    return {
      id: p.id,
      question: p.question,
      closesAt: p.closes_at,
      closed: p.closed || (p.closes_at && new Date(p.closes_at) < new Date()),
      totalUsd,
      myOptionId: myVote.get(p.id) ?? null,
      options: options.map((o, i) => ({
        id: o.id,
        label: o.label,
        usd: totals[i],
        // Nur für die Balkenbreite, nicht als Zahl angezeigt.
        share: totalUsd > 0 ? totals[i] / totalUsd : 0,
      })),
    };
  });
  renderPolls();
}

/**
 * Wie lange eine Abstimmung noch läuft, als Text.
 *
 * Es wird ABGERUNDET, und das ist eine Entscheidung, keine Bequemlichkeit.
 * Bei 2 Stunden 59 Minuten steht hier "2h". Wer das liest, glaubt weniger Zeit
 * zu haben, als er hat – und irrt sich in die harmlose Richtung. Aufgerundet
 * stünde "3h", und jemand käme fünf Minuten zu spät, weil die Seite ihm Zeit
 * versprochen hat, die es nicht gab.
 *
 * Zwei Einheiten, nie drei: "2d 4h" sagt alles, was man für eine Entscheidung
 * braucht. "2d 4h 17m" liest niemand zu Ende, und die Minuten sind bei zwei
 * Tagen Restzeit ohnehin bedeutungslos.
 *
 * Unter einer Minute keine Zahl mehr: Eine Sekundenzahl in einer Liste, die
 * sich alle 30 Sekunden aktualisiert, wäre die meiste Zeit falsch.
 */
function fristText(closesAt) {
  const restMs = new Date(closesAt) - Date.now();
  if (restMs <= 0) return 'closing';
  const min = Math.floor(restMs / 60000);
  const std = Math.floor(min / 60);
  const tage = Math.floor(std / 24);
  if (tage > 0) return `${tage}d${std % 24 ? ` ${std % 24}h` : ''} left`;
  if (std > 0) return `${std}h${min % 60 ? ` ${min % 60}m` : ''} left`;
  if (min > 0) return `${min}m left`;
  return 'closing now';
}
// Unter einer Stunde wird die Zeile golden. Eine Stunde und nicht fuenf
// Minuten: Die Grenze soll den Punkt treffen, an dem Abstimmen noch etwas
// aendert. Wer sie bei fuenf Minuten zoege, faerbte die Zeile in dem Moment,
// in dem sie niemandem mehr nuetzt.
const BALD_MS = 60 * 60 * 1000;
const fristZeile = (p) =>
  `<span class="frist-rest${new Date(p.closesAt) - Date.now() < BALD_MS ? ' is-bald' : ''}"`
  + `>· ${esc(fristText(p.closesAt))}</span>`;

/**
 * Der Zeiger, der die Restzeit nachzieht.
 *
 * Er schreibt nur die Textstelle neu, statt die Liste neu zu bauen. Ein
 * innerHTML alle 30 Sekunden würde die Balkenanimation zurücksetzen, den
 * Mauszeiger von der Antwort werfen, über der er gerade steht, und den
 * Bildlauf verlieren – für eine Zahl, die sich um eine Minute geändert hat.
 *
 * Neu geladen wird nur in dem einen Fall, in dem sich wirklich etwas anderes
 * ändert: wenn eine Abstimmung gerade abgelaufen ist. Dann muss sie
 * tatsächlich neu gebaut werden, denn ihre Antworten sind ab jetzt gesperrt.
 * Ohne das bliebe sie anklickbar, und der Klick käme als rote Fehlermeldung
 * aus der Datenbank zurück – die Regel ist dort richtig durchgesetzt, aber der
 * Nutzer bekäme einen Defekt zu sehen, wo eine Frist abgelaufen ist.
 *
 * 30 Sekunden, nicht 60: Bei einem Takt von einer Minute stünde eine Minute
 * lang die vorherige Minute da.
 */
let fristT = null;
function fristTakt() {
  clearInterval(fristT);
  const laufend = state.polls.filter((p) => !p.closed && p.closesAt);
  if (!laufend.length) return;

  fristT = setInterval(() => {
    if (state.polls.some((p) => !p.closed && p.closesAt && new Date(p.closesAt) <= new Date())) {
      return loadPolls().catch((e) => console.warn('[poll] reload after deadline:', e.message));
    }
    for (const p of state.polls) {
      if (p.closed || !p.closesAt) continue;
      const el = document.querySelector(`#poll-${p.id} .frist-rest`);
      if (!el) continue;
      el.textContent = `· ${fristText(p.closesAt)}`;
      el.classList.toggle('is-bald', new Date(p.closesAt) - Date.now() < BALD_MS);
    }
  }, 30000);
}

/**
 * Woran ein Knopf in der Liste wiederzuerkennen ist, wenn sie neu gebaut wird.
 *
 * Die Knoten selbst sind danach andere; die Kombination aus Klasse und
 * Abstimmungsnummer bleibt. Gebraucht wird das, um den Tastaturfokus zu
 * halten: list.innerHTML wirft ihn auf <body>, und wer sich gerade mit der
 * Tabulatortaste zum Löschknopf vorgearbeitet hat, drückt danach Enter ins
 * Leere. Auch das ist "manchmal geht es nicht" – nur an der Tastatur.
 */
const knopfMerkmal = (el) => {
  if (!el || !el.dataset) return null;
  for (const [klasse, rolle] of Object.entries(KNOPF_ROLLEN)) {
    if (el.classList.contains(klasse)) return `.${klasse}[data-${rolle.feld}="${el.dataset[rolle.feld]}"]`;
  }
  return null;
};

function renderPolls() {
  const list = $('#poll-list');
  if (!state.polls.length) {
    list.innerHTML = '<div class="empty">No polls yet. Only Ansem can start one.</div>';
    clearInterval(fristT);
    return;
  }
  // Vor dem Neubau merken, was den Fokus hat – aber nur, wenn er in dieser
  // Liste liegt. Steht er in einem Feld des Anlegekastens, hat der Neubau ihn
  // gar nicht angefasst und darf ihn erst recht nicht verschieben.
  const fokusWar = list.contains(document.activeElement)
    ? knopfMerkmal(document.activeElement) : null;

  list.innerHTML = state.polls.map(pollHtml).join('');
  // Im selben Durchlauf wie der Neubau: Zwischen den beiden Zeilen kann kein
  // Bild auf den Schirm kommen, in dem ein scharfer Löschknopf harmlos
  // aussieht – und kein Klick dazwischenrutschen.
  knoepfeMalen(list);
  if (fokusWar) $(fokusWar, list)?.focus({ preventScroll: true });

  $$('.opt', list).forEach((el) => {
    const abstimmen = () => {
      if (!el.classList.contains('locked')) {
        vote(Number(el.dataset.poll), Number(el.dataset.option));
      }
    };
    el.addEventListener('click', abstimmen);
    // Enter und Leertaste – das ist, was ein Knopf tut, und role="button"
    // verspricht genau das. Ein Element, das sich als Knopf ausgibt und dann
    // auf keine Taste hoert, ist schlimmer als ein ehrliches div.
    //
    // preventDefault bei der Leertaste, sonst rollt die Seite darunter weg,
    // waehrend die Stimme abgegeben wird.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      abstimmen();
    });
  });
  $$('.btn-close-poll', list).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await state.db.from('polls').update({ closed: true }).eq('id', b.dataset.poll);
    if (error) toast(error.message, true); else loadPolls();
  }));
  $$('.poll-share', list).forEach((b) =>
    b.addEventListener('click', () => teilePoll(b.dataset.share)));
  $$('.poll-image', list).forEach((b) =>
    b.addEventListener('click', () => ladePollBild(b.dataset.image)));
  $$('.poll-delete', list).forEach((b) =>
    b.addEventListener('click', () => loeschePoll(b.dataset.delete)));
  fristTakt();
}

/* Eine Kette, kein Teilen-Pfeil. Der Pfeil verspricht das Systemmenü des
   Geräts – das gibt es aber nur auf dem Handy. Am Schreibtisch landet der Link
   in der Zwischenablage, und dafür ist die Kette das ehrlichere Bild. */
const LINK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>
  </svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 12.5l5 5 10-11"/>
  </svg>`;

/* Der Haken an der Antwort, für die man selbst gestimmt hat – ein Kreis mit
   einem Haken darin, wie bei X.

   Hier stand ein blosses ✓ hinter dem Text. Das Zeichen kam aus der Schrift,
   sah je nach Gerät anders aus und stand als Buchstabe im Satz – auf einem
   Mac fett und rund, auf Windows dünn und eckig. Als SVG ist es überall
   dasselbe Bild und nimmt seine Farbe vom Text darüber.

   Der Kreis ist nicht Zierde: Ein Haken allein heisst an anderen Stellen der
   Seite "erledigt" (Link kopiert, Löschen bestätigt). Der Kreis macht daraus
   eine Markierung an einer Sache statt einer Rückmeldung auf eine Handlung. */
const STIMME_SVG = `<svg class="opt-haken" viewBox="0 0 24 24" width="15" height="15"
    aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M8.2 12.3l2.7 2.7 4.9-5.5"/>
  </svg>`;

const DOWNLOAD_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3.5v11"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/>
    <path d="M4.5 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>
  </svg>`;

/* Ein Papierkorb, kein Kreuz. Das Kreuz heißt an zu vielen Stellen "schließen",
   und eine Abstimmung lässt sich auch schließen – das ist ein anderer Knopf
   mit einer anderen Folge. */
const TRASH_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 6.5h16"/><path d="M9.5 6.5V4.5h5v2"/>
    <path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>
    <path d="M10.5 10v6"/><path d="M13.5 10v6"/>
  </svg>`;

// ---------------------------------------------------------------------------
// Der flüchtige Zustand der drei Knöpfe an einer Abstimmung
// ---------------------------------------------------------------------------
//
// Alle drei zeigen für eine Weile einen Haken: der Löschknopf, bis der zweite
// Tipper kommt, Link und Bild als Quittung. Dieser Zustand hing bisher AM
// KNOPF – als btn._scharf und btn._t am DOM-Knoten selbst.
//
// Genau daran lag der Fehler, den Ansem gesehen hat:
//
//   renderPolls() baut die Liste mit list.innerHTML komplett neu. Jeder Knopf
//   darin ist danach ein ANDERER Knoten – ohne _scharf, mit einem Papierkorb
//   statt dem Haken. Der alte Knoten hängt nirgends mehr und sein Zeitgeber
//   läuft ins Leere.
//
//   Neu gebaut wird bei jeder fremden Stimme: Realtime meldet die Änderung an
//   votes, reloadSoon wartet 400 ms und lädt neu. Zwischen "Papierkorb
//   getippt" und "Haken getippt" liegen aber ein bis zwei Sekunden.
//
//   Also: Ansem tippt den Papierkorb, jemand stimmt ab, der Haken springt
//   zurück auf den Papierkorb – und sein zweiter Tipper schärft nur wieder
//   scharf, statt zu löschen. Nichts passiert, und beim nächsten Mal geht es.
//   "Manchmal."
//
// Deshalb steht der Zustand jetzt HIER und nicht am Knoten: an einer Kennung,
// die einen Neubau der Liste überlebt. Nach jedem Neubau werden die Knöpfe
// wieder in ihren Zustand gemalt – im selben Durchlauf, in dem die Liste
// entsteht, sodass dazwischen kein Bild zu sehen ist, in dem der Haken fehlt.
//
// Warum nicht einfach das Neuladen anhalten, solange scharf ist: Dann stünden
// die Zahlen fünf Sekunden lang still, und zwar bei jedem Löschen. Der Neubau
// ist nicht das Problem – dass er einen Zustand mitreisst, der ihn überleben
// soll, ist das Problem.
const KNOPF_ROLLEN = {
  'poll-delete': {
    feld: 'delete', dauer: 5000, ruhe: () => TRASH_SVG,
    ruheTitel: 'Delete this poll', aktivTitel: 'Tap again to delete',
  },
  'poll-share': { feld: 'share', dauer: 1800, ruhe: () => LINK_SVG, klasse: 'is-copied' },
  'poll-image': { feld: 'image', dauer: 1800, ruhe: () => DOWNLOAD_SVG, klasse: 'is-copied' },
};

/** Kennung -> Zeitgeber, der ihn wieder ausschaltet. */
const knopfAktiv = new Map();

/**
 * Kennungen, an denen gerade etwas läuft: das Löschen selbst, das Bauen des
 * Bildes.
 *
 * Auch das hing am Knoten – als btn.disabled, gesetzt vor dem Warten und
 * zurückgenommen danach. Wird die Liste in der Zwischenzeit neu gebaut, ist
 * der neue Knopf wieder bedienbar, und der zweite Klick löst dieselbe Sache
 * ein zweites Mal aus.
 */
const knopfLaeuft = new Set();

/**
 * Malt die Knöpfe so, wie ihr Zustand es sagt.
 *
 * Die Klasse knopf-aktiv am Knoten ist das Gedächtnis für "so sieht er gerade
 * aus". Stimmt sie mit dem Zustand überein, bleibt das Bild unangetastet –
 * sonst schriebe jeder Aufruf innerHTML neu, auch wenn dort schon das
 * Richtige steht. Ein frisch gebauter Knopf hat die Klasse nie, und ein
 * aktiver wird damit von selbst wieder zum Haken.
 *
 * Die Vorgabe ist das ganze Blatt und nicht #poll-list. renderPolls reicht
 * seine frisch gebaute Liste ausdrücklich herein, alle anderen Aufrufer
 * meinen einfach "male, was da ist" – und dürfen nicht davon abhängen, in
 * welchem Kasten die Knöpfe gerade hängen.
 */
function knoepfeMalen(wurzel = document) {
  if (!wurzel) return;
  for (const [klasse, rolle] of Object.entries(KNOPF_ROLLEN)) {
    for (const btn of $$(`.${klasse}`, wurzel)) {
      const kennung = `${klasse}:${btn.dataset[rolle.feld]}`;
      btn.disabled = knopfLaeuft.has(kennung);
      const aktiv = knopfAktiv.has(kennung);
      if (btn.classList.contains('knopf-aktiv') === aktiv) continue;
      btn.classList.toggle('knopf-aktiv', aktiv);
      btn.innerHTML = aktiv ? CHECK_SVG : rolle.ruhe();
      if (rolle.klasse) btn.classList.toggle(rolle.klasse, aktiv);
      const titel = aktiv ? rolle.aktivTitel : rolle.ruheTitel;
      // Nur wo es einen gibt: Link und Bild sagen ihre Quittung über den
      // Hinweis, nicht über einen Beschriftungstext, der mitwandert.
      if (titel) { btn.title = titel; btn.setAttribute('aria-label', titel); }
    }
  }
}

const knopfIstAn = (klasse, id) => knopfAktiv.has(`${klasse}:${id}`);

function knopfAus(klasse, id) {
  clearTimeout(knopfAktiv.get(`${klasse}:${id}`));
  knopfAktiv.delete(`${klasse}:${id}`);
  knoepfeMalen();
}

function knopfAn(klasse, id) {
  clearTimeout(knopfAktiv.get(`${klasse}:${id}`));
  knopfAktiv.set(`${klasse}:${id}`,
    setTimeout(() => knopfAus(klasse, id), KNOPF_ROLLEN[klasse].dauer));
  knoepfeMalen();
}

/** Sperrt einen Knopf, solange seine Sache läuft. Gibt false zurück, wenn
 *  sie schon läuft – dann ist der Klick ein zweiter und wird verworfen. */
function knopfBelegen(klasse, id) {
  const kennung = `${klasse}:${id}`;
  if (knopfLaeuft.has(kennung)) return false;
  knopfLaeuft.add(kennung);
  knoepfeMalen();
  return true;
}

function knopfFreigeben(klasse, id) {
  knopfLaeuft.delete(`${klasse}:${id}`);
  knoepfeMalen();
}

/**
 * Die Adresse einer einzelnen Abstimmung.
 *
 * Als Pfad /p/12, nicht als Raute.
 *
 * Der Grund ist X. Alles ab dem # wird niemals an einen Server geschickt –
 * das ist keine Einstellung, das ist die Definition eines Fragments. Für den
 * Crawler, der die Vorschaukarte baut, sähen deshalb alle Abstimmungen gleich
 * aus, weil sie dieselbe Adresse hätten. Mit der Nummer im Pfad kann er sie
 * unterscheiden, und /p/12 wird auf eine kleine Seite umgeleitet, die ihm
 * Frage, Zahlen und Bild nennt (supabase/functions/og).
 *
 * Wer den Link im Browser öffnet, wird von dort sofort auf /#poll-12
 * weitergeschickt – die alte Form funktioniert also weiter, sie steht nur
 * nicht mehr in geteilten Links.
 *
 * search wird bewusst weggelassen – dort stehen Parameter, die den Empfänger
 * nichts angehen.
 */
const pollLink = (id) => `${location.origin}/p/${id}`;

/**
 * Link teilen.
 *
 * Auf dem Handy das Systemmenü, sonst die Zwischenablage. Wichtig ist, was bei
 * einem Fehlschlag passiert: copyText() versucht schon zwei Wege, und wenn
 * beide scheitern, steht die Adresse im Hinweis – dann kann man sie wenigstens
 * ablesen. Ein Knopf, der nichts tut und nichts sagt, ist hier das Schlimmste,
 * weil man ihn für kaputt hält und weiterdrückt.
 */
async function teilePoll(id) {
  const url = pollLink(id);
  const frage = state.polls.find((p) => p.id === Number(id))?.question ?? 'Poll';

  // Kopieren, nicht teilen.
  //
  // Hier stand ein Aufruf von navigator.share: Auf dem Handy klappte damit das
  // Systemmenue mit WhatsApp, Mail und dem Rest hoch. Das ist ein zweiter
  // Schritt fuer etwas, das man meistens nur in die Zwischenablage will – und
  // der Knopf traegt ein Kettensymbol, kein Teilen-Symbol. Er verspricht also
  // ohnehin einen Link und kein Menue.
  //
  // frage wird seitdem nicht mehr gebraucht; sie stand nur im Titel des Menues.
  void frage;

  if (await copyText(url)) {
    knopfAn('poll-share', id);
    toast('Link copied');
    return;
  }
  toast(url, true);
}

/**
 * Einen geteilten Link öffnen.
 *
 * Der Empfänger ist beim ersten Aufruf fast nie schon angemeldet – er sieht den
 * Login. Die Raute bleibt dabei in der Adresse stehen, also greift der Sprung
 * nach der Anmeldung von selbst. Deshalb wird sie hinterher auch nicht
 * gelöscht: Wer die Seite neu lädt, soll wieder bei derselben Abstimmung
 * landen.
 */
function springeZuPollAusUrl({ ohneRollen = false } = {}) {
  const treffer = /^#poll-(\d+)$/.exec(location.hash);
  if (!treffer) return;
  const id = Number(treffer[1]);

  selectTab('polls');
  const el = document.getElementById(`poll-${id}`);
  if (!el) {
    // Geladen werden die letzten 50. Eine ältere oder gelöschte Abstimmung
    // fehlt schlicht – das gehört gesagt, sonst wirkt der Link kaputt.
    toast('That poll is not in the list anymore', true);
    return;
  }
  el.scrollIntoView({ block: 'center', behavior: ohneRollen ? 'auto' : 'smooth' });
  // Neu anstoßen, falls dieselbe Abstimmung zweimal hintereinander aufgerufen
  // wird: Ohne das Entfernen läuft die Animation kein zweites Mal.
  el.classList.remove('is-linked');
  void el.offsetWidth;
  el.classList.add('is-linked');
}

window.addEventListener('hashchange', () => {
  if (!$('#app').hidden) springeZuPollAusUrl();
});

// ---------------------------------------------------------------------------
// Das Bild einer Abstimmung
//
// Gezeichnet, nicht abfotografiert. Ein Bildschirmfoto der Karte hätte
// bedeutet, eine fremde Bibliothek einzubauen (html2canvas & Co.), und es
// hätte mitgeliefert, was gerade zufällig auf dem Schirm war: den Zeiger auf
// einem Balken, den eigenen Haken, den Rand einer angeschnittenen Karte, die
// Breite des jeweiligen Telefons.
//
// Hier entsteht stattdessen ein eigenes Bild in fester Größe. "Clean" heißt
// deshalb konkret: keine Knöpfe, kein eigener Stimmhaken, keine Spuren der
// Bedienung – nur die Frage, die Antworten und die Zahlen.
//
// Die Farben werden aus dem Stylesheet gelesen statt hier noch einmal
// hingeschrieben. Sonst driftet das Bild bei der nächsten Farbänderung
// unbemerkt von der Seite weg – und genau das ist im Verlauf dieses Projekts
// schon einmal passiert, als Grün an sechs Stellen fest im Blatt stand.
// ---------------------------------------------------------------------------

const cssWert = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();


/* roundRect gibt es erst ab Safari 16.4. Wer ein älteres iPhone hat, soll kein
   kaputtes Bild bekommen, sondern eines mit eckigen Balken. */
function rundesRechteck(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/**
 * Text in Zeilen brechen, die in maxW passen. Gibt die Zeilen zurück.
 *
 * Umbrochen wird an Leerzeichen – und WENN ES SEIN MUSS mitten im Wort.
 *
 * Der zweite Teil hat gefehlt, und das war ein echter Fehler mit einem
 * sichtbaren Ergebnis: Hier stand `|| !zeile`, also "ein Wort, das allein schon
 * zu breit ist, kommt trotzdem ganz in seine Zeile". Diese Zeile war dann zu
 * lang, und was danach kam, hat kuerzen() beim Zeichnen abgeschnitten.
 *
 * Bei normalen Saetzen faellt das nie auf. Sichtbar wurde es an einer Frage
 * ohne ein einziges Leerzeichen – "abshridmajabshridmaj..." ueber 100 Zeichen.
 * Fuer diese Funktion war das EIN Wort, also EINE Zeile, also zwei Drittel des
 * Textes weg, obwohl die Karte drei Zeilen dafuer hat und die Verkleinerung
 * bereitstand: Beide greifen erst ab der vierten Zeile, und es gab nur eine.
 *
 * Das ist die Sorte Fehler, die eine Grenze im Formular nicht abfaengt – 100
 * Zeichen waren erlaubt und wurden trotzdem nicht gezeigt. Und die
 * Zufallssaetze, mit denen die Grenze geprueft wurde, hatten alle Leerzeichen.
 */
function umbrechen(ctx, text, maxW) {
  const worte = String(text).split(/\s+/).filter(Boolean);
  const zeilen = [];
  let zeile = '';
  for (const wort of worte) {
    const versuch = zeile ? `${zeile} ${wort}` : wort;
    if (ctx.measureText(versuch).width <= maxW) {
      zeile = versuch;
      continue;
    }
    if (zeile) { zeilen.push(zeile); zeile = ''; }
    // Passt das Wort auch allein nicht, wird es zerlegt – zeichenweise, so weit
    // wie jeweils hineingeht.
    let rest = wort;
    while (ctx.measureText(rest).width > maxW) {
      let n = rest.length;
      while (n > 1 && ctx.measureText(rest.slice(0, n)).width > maxW) n -= 1;
      zeilen.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    zeile = rest;
  }
  if (zeile) zeilen.push(zeile);
  return zeilen;
}

/** Ein einzelnes Wort, das allein schon zu breit ist, wird hart gekürzt. */
function kuerzen(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

/**
 * Zeichnet die Abstimmung und gibt die Leinwand zurück.
 *
 * Das Bild IST die Karte – es gibt keinen Grund ringsherum. Außerhalb der
 * abgerundeten Ecken bleibt die Leinwand durchsichtig, das PNG trägt also
 * einen Alphakanal.
 *
 * Die Größe zielt fest auf 16:9. Der Grund liegt nicht in der Ästhetik: X
 * zeigt ein einzelnes Bild in der Zeitleiste bis 16:9 vollständig und
 * schneidet alles Höhere oben und unten ab. Eine Abstimmung mit zehn Antworten
 * in ein 16:9-Format zu pressen hieße allerdings, die Schrift unlesbar klein
 * zu setzen – deshalb darf das Bild wachsen, aber nur bis 4:5. Das ist die
 * höchste Form, die X noch ungeschnitten zeigt.
 */
const BILD_BREITE = 1600;   // Punkte; die Leinwand ist doppelt so groß
const BILD_SKALA = 2;
const BILD_ECKE = 28;

/**
 * Die Fassung des Kartenbilds. HOCHZÄHLEN, wenn sich das Aussehen ändert.
 *
 * Der Grund: Die Karte wird genau einmal geschrieben, beim Anlegen der
 * Abstimmung, und nie überschrieben – das ist Absicht, damit unter einem
 * geteilten Link immer dieselbe Einladung steht. Der Preis war, dass eine
 * Änderung am Aussehen die bestehenden Abstimmungen nie erreicht: Sie behalten
 * ihre alte Karte, für immer.
 *
 * Die Nummer steht im Dateinamen. Wird sie erhöht, sucht ergaenzeFehlendeKarten()
 * beim nächsten Start Ansems nach poll-<id>-v<neu>.png, findet nichts und
 * zeichnet alles neu. Kein Aufräumen von Hand, kein vergessener Rest.
 *
 * ACHTUNG: Dieselbe Nummer steht in supabase/functions/og/index.ts. Beide
 * müssen übereinstimmen, sonst zeigt die Karte auf eine Datei, die es nicht
 * gibt, und der Link bekommt die Ersatzkarte.
 */
const KARTEN_VERSION = 9;

/** Der Name des Kartenbilds in der Ablage – an einer Stelle, nicht an drei. */
const kartenDatei = (id) => `poll-${id}-v${KARTEN_VERSION}.png`;

/**
 * Der Anteil der führenden Antwort – oder null, wenn keine markiert wird.
 *
 * Markiert wird erst, wenn die Abstimmung ZU ist. Solange sie läuft, sagen die
 * Balkenlängen schon, wo es steht; die blaue Fläche darüber macht daraus eine
 * Ansage. Und eine Ansage über einen Zwischenstand ist eine Aufforderung: Wer
 * unentschieden hereinkommt und sieht, dass eine Antwort "die" Antwort ist,
 * stimmt eher dafür. Der Rang kann sich bis zur letzten Minute drehen – bei
 * dieser Abstimmung besonders, weil ein einziger großer Halter ihn dreht.
 *
 * Geschlossen ist das Blau dagegen genau richtig: Dann ist es kein Hinweis
 * mehr, sondern das Ergebnis.
 *
 * EINE Stelle für beide Darstellungen, die Liste im Blatt und das Bild, das
 * nach draußen geht. Liefen die auseinander, zeigte ein geteiltes Bild einen
 * Gewinner, den die Seite daneben nicht kennt – und das fiele niemandem auf,
 * weil beide für sich richtig aussehen.
 *
 * Bei Gleichstand tragen beide die Markierung, und ohne eine einzige Stimme
 * keine: Ohne totalUsd wäre der größte Anteil die 0, und die hätte jede
 * Antwort.
 */
const fuehrenderAnteil = (p) =>
  (p.closed && p.totalUsd > 0) ? Math.max(...p.options.map((o) => o.share), 0) : null;

async function zeichnePoll(p, { fuerKarte = false } = {}) {
  // Die Karte wird in einfacher Auflösung gezeichnet, das Bild zum
  // Herunterladen in doppelter.
  //
  // Der Grund ist die Dateigröße, und die ist hier keine Kleinigkeit: Der
  // schwache Lichtschein im Grund ist ein Verlauf, und PNG rastert Verläufe
  // mit einem Rauschen, das sich bei doppelter Auflösung vervierfacht. Dasselbe
  // Bild wiegt bei 3200 px 1,5 MB und bei 1600 px 136 KB – elfmal weniger, ohne
  // sichtbaren Unterschied. X zeigt eine Kachel ohnehin rund 600 px breit an;
  // 1600 sind schon das Zweieinhalbfache davon.
  // Ohne das Warten misst der erste Aufruf mit der Ersatzschrift und der Text
  // steht hinterher zu breit oder zu schmal im Bild.
  try { await document.fonts?.ready; } catch { /* dann eben ungewartet */ }

  const S = fuerKarte ? 1 : BILD_SKALA;
  const B = BILD_BREITE;
  // Die Karte sitzt eingerückt auf der Grundfarbe der Seite. Ohne diesen
  // Abstand liegt die Rundung genau auf der Bildkante und ist damit unsichtbar
  // – ein abgerundetes Rechteck erkennt man erst, wenn daneben etwas anderes
  // steht.
  // Ringsherum derselbe Abstand. Der freie Platz fuer Xs Titelkasten liegt
  // deshalb INNERHALB der Karte, nicht darunter – siehe innenUnten.
  const m = 34;
  const rand = m + 52;
  const inhalt = B - rand * 2;

  // Eine Schrift, wie auf der Seite. Die Karte war zuletzt die einzige Flaeche
  // in Grotesk – und ausgerechnet die, die nach draussen geht.
  //
  // Die Groessen bleiben dabei unveraendert, und das ist eine bewusste
  // Entscheidung gegen das naheliegende "Mono baut breiter, also kleiner
  // setzen". Nachgemessen stimmt die Faustregel naemlich nicht verlaesslich:
  // Bei 12,9 px mager war die Mono hier 19 % breiter als die Grotesk, bei
  // 54 px fett gleich breit, und eine kurze Antwort wie "Bonk" sogar schmaler.
  // Die Werte haengen an den tatsaechlich installierten Schriften, und die
  // sind auf einem Mac andere als auf dem Rechner, auf dem gemessen wurde.
  //
  // Es braucht die Regel aber auch nicht: umbrechen() und kuerzen() messen
  // beide zur Laufzeit mit der Schrift, die wirklich geladen ist. Der Umbruch
  // stellt sich also von selbst richtig ein, egal welche Mono der Browser
  // hergibt. Eine hier eingetragene Ausgleichszahl waere geraten und wuerde
  // auf der Haelfte der Geraete danebenliegen.
  const mono = cssWert('--mono') || 'monospace';
  const farbe = {
    grund: cssWert('--bg') || '#0a0b0f',
    karte: cssWert('--bg-1') || '#101218',
    balken: cssWert('--bg-3') || '#1d212d',
    linie: cssWert('--line') || '#262b39',
    text: cssWert('--text') || '#e7e9ee',
    dim: cssWert('--dim') || '#8b93a7',
    dimmer: cssWert('--dimmer') || '#5d657a',
    akzent: cssWert('--accent') || '#eceff5',
    // --accent-rgb stand hier, solange die Fuellung durchscheinendes Weiss war.
    // Sie ist jetzt deckend, und der Wert wurde sonst nirgends gebraucht.
    // Die Fuellung der Balken, von X abgemessen. Warum zwei Werte und nicht
    // einer mit Deckkraft: siehe --fuellung im Blatt.
    fuellung: cssWert('--fuellung') || '#343639',
    fuellungSpitze: cssWert('--fuellung-spitze') || '#2b5988',
  };

  // Erst rechnen, dann zeichnen: Die Höhe steht erst fest, wenn klar ist, über
  // wie viele Zeilen die Frage läuft.
  const mess = document.createElement('canvas').getContext('2d');
  mess.font = `700 54px ${mono}`;
  // Die Frage bekommt drei Zeilen. Passt sie nicht hinein, wird die Schrift
  // kleiner, bis sie es tut – und erst danach, wenn gar nichts mehr hilft,
  // abgeschnitten.
  //
  // Vorher stand hier nur .slice(0, 3), und das war die unangenehmste Sorte
  // Fehler: Die vierte Zeile fiel LAUTLOS weg. Im Formular stand die Frage
  // vollstaendig da, auf dem geposteten Bild hoerte sie mitten im Satz auf,
  // und gemerkt haette Ansem es erst draussen.
  //
  // Das Formular begrenzt inzwischen auf MAX_FRAGE Zeichen, und gemessen
  // passen die in drei Zeilen – aber "gemessen" heisst hier "bei 4000
  // Zufallssaetzen je Laenge kein einziger zu lang", nicht "unmoeglich". Der
  // Umbruch haengt nicht an der Zeichenzahl, sondern an den Wortgrenzen: Ein
  // einzelnes langes Wort am Zeilenende laesst eine halbe Zeile leer. Eine
  // Grenze, die diesen Fall mit Sicherheit ausschliesst, laege bei etwa 90
  // Zeichen, und das ist fuer eine Frage zu wenig.
  //
  // Also andersherum: Die Grenze bleibt grosszuegig, und die Karte gibt nach.
  //
  // Untergrenze 40 px, und die ist gegen die SCHRIFT gerechnet, nicht gegen
  // eine bestimmte: Gezeichnet wird in --mono, und was das ist, entscheidet das
  // Geraet – auf einem Mac SF Mono, anderswo Menlo, DejaVu, Consolas. Die bauen
  // verschieden breit. Bei 40 px passen MAX_FRAGE Zeichen selbst dann in drei
  // Zeilen, wenn die Schrift ein Fuenftel breiter baut als die, an der
  // gemessen wurde, und dabei noch Woerter bis 16 Zeichen am Zeilenende Platz
  // verschenken.
  let frageGroesse = 54;
  let frageZeilenRoh = umbrechen(mess, p.question, inhalt);
  while (frageZeilenRoh.length > 3 && frageGroesse > 40) {
    frageGroesse -= 2;
    mess.font = `700 ${frageGroesse}px ${mono}`;
    frageZeilenRoh = umbrechen(mess, p.question, inhalt);
  }
  const frageZeilen = frageZeilenRoh.slice(0, 3);
  // Und wenn selbst 40 px nicht reichen – ein Text, den weder das Formular noch
  // die Datenbank zulassen, den die Karte aber zeichnen koennte –, dann steht
  // wenigstens ein Auslassungszeichen da. Ein Satz, der mitten im Wort aufhoert,
  // sieht aus wie ein Fehler beim Tippen; drei Punkte sagen, dass gekuerzt
  // wurde.
  if (frageZeilenRoh.length > 3) frageZeilen[2] = `${frageZeilen[2]}…`;
  // Der Zeilenabstand geht mit: 66 zu 54 ist das Verhaeltnis der Vorlage.
  const frageZeile = Math.round(frageGroesse * 66 / 54);

  const luecke = 14;
  let optH = 82;
  // Der feste Anteil: Raender aussen, Kopf, Frage, Zahlenzeile – und unten
  // innerhalb der Karte ein Rest.
  //
  // Beim Bild zum Herunterladen traegt dieser Rest die Fusszeile. Beim
  // Kartenbild bleibt er leer, und zwar mit Absicht: X zeichnet den Titel der
  // Kachel als schwarzen Kasten unten links INS Bild. Er braucht eine Flaeche,
  // auf der er nichts verdeckt – waeren die Balken bis nach unten gewachsen,
  // laege er auf einer Antwort.
  const innenUnten = fuerKarte ? 78 : 106;
  const fest = m * 2 + 146 + frageZeilen.length * frageZeile + 54 + innenUnten;

  // Das Format hängt daran, wozu das Bild dient.
  //
  // Zum Herunterladen darf es wachsen: Wer es als Bild postet, sieht es ganz,
  // und zehn Antworten in 16:9 zu quetschen hieße, die Schrift unlesbar klein
  // zu setzen. Grenze ist 4:5, mehr zeigt X in der Zeitleiste nicht ungekürzt.
  //
  // Als Vorschaukarte gilt etwas anderes: Eine Linkkarte schneidet X auf rund
  // 1,91:1 zu, und zwar mittig. Ein höheres Bild verliert dabei oben und unten
  // je einen Streifen – und der Erste, der wegfällt, ist der Rahmen, den wir
  // gerade erst sichtbar gemacht haben. Deshalb wird die Karte von vornherein
  // in diesem Verhältnis gezeichnet, und wenn die Antworten nicht hineinpassen,
  // werden sie gekürzt statt das Bild zu strecken.
  const zielV = fuerKarte ? 1.91 : 16 / 9;
  const maxH = fuerKarte ? Math.round(B / 1.91) : Math.round(B * 5 / 4);
  const minH = Math.round(B / zielV);

  let zeigen = p.options;
  let ausgelassen = 0;
  if (fuerKarte) {
    // Wie viele Antworten passen in die feste Höhe? Mindestens zwei, sonst
    // wäre es keine Abstimmung mehr. Der Hinweis auf die ausgelassenen kostet
    // selbst eine Zeile, also erst rechnen, dann kürzen.
    const platz = maxH - fest;
    let passt = Math.max(2, Math.floor(platz / (optH + luecke)));
    if (passt < p.options.length) passt = Math.max(2, Math.floor((platz - 40) / (optH + luecke)));
    if (passt < p.options.length) {
      zeigen = p.options.slice(0, passt);
      ausgelassen = p.options.length - passt;
    }
  }

  const n = Math.max(1, zeigen.length);
  const hinweisH = ausgelassen ? 40 : 0;
  const H = Math.max(minH, Math.min(maxH, fest + hinweisH + n * (optH + luecke)));

  // Bleibt im Rahmen Platz übrig, wachsen die Balken hinein, statt unten ein
  // Loch zu lassen. Gedeckelt, weil ein 200 px hoher Balken für eine
  // dreiwortige Antwort albern aussieht.
  const frei = H - fest - hinweisH - n * (optH + luecke);
  if (frei > 0) optH = Math.min(132, optH + frei / n);
  const rest = Math.max(0, H - fest - hinweisH - n * (optH + luecke));

  const leinwand = document.createElement('canvas');
  leinwand.width = B * S;
  leinwand.height = H * S;
  const ctx = leinwand.getContext('2d');
  ctx.scale(S, S);
  ctx.textBaseline = 'alphabetic';

  // Das Bild ist deckend, nicht durchsichtig. Durchsichtig wäre die sauberere
  // Datei, aber sie überlebt den Weg nicht: X rechnet PNGs häufig in JPEG um,
  // und JPEG kennt keine Durchsichtigkeit – aus den freien Ecken würden dabei
  // schwarze. So sieht es überall gleich aus, egal was unterwegs mit der Datei
  // passiert.
  ctx.fillStyle = farbe.grund;
  ctx.fillRect(0, 0, B, H);

  // Alles ab hier liegt in der abgerundeten Karte – auch der Lichtschein und
  // die Balken laufen an den Ecken sauber mit der Rundung aus.
  const karteH = H - m * 2;
  ctx.save();
  rundesRechteck(ctx, m, m, B - m * 2, karteH, BILD_ECKE);
  ctx.clip();

  ctx.fillStyle = farbe.karte;
  ctx.fillRect(m, m, B - m * 2, karteH);

  // Hier lag ein sehr schwacher Lichtschein unten rechts, mit der Begruendung:
  // Ohne ihn sei die Flaeche vollkommen flach, und zwischen lauter anderen
  // dunklen Kacheln in der Zeitleiste verschwinde eine flache Flaeche.
  //
  // Das Problem stimmt, der Verlauf ist trotzdem raus – die Seite hat auch
  // keinen mehr, und eine Karte, die als einzige einen traegt, faellt aus der
  // Reihe. Die Aufgabe uebernimmt jetzt der Rand weiter unten: kraeftiger und
  // heller statt einer Haarlinie.
  //
  // Der Rand ist dafuer sogar das bessere Mittel. X rechnet PNGs haeufig in
  // JPEG um, und dabei kann ein feiner Flaechenunterschied in seiner Umgebung
  // untergehen. Ein Strich bleibt ein Strich.
  //
  // Nebeneffekt, gemessen: Das Bild zum Herunterladen wiegt 294 statt 1086 KB,
  // die Vorschaukarte 110 statt 358 KB. PNG packt Flaechen, aber keine weichen
  // Uebergaenge – die werden gerastert, und das Rastern war der teuerste Teil
  // der Datei. Genau daran lag es damals, dass X ein kaputtes Bild zeigte.

  let y = m + 46;

  // --- Kopf: die Marke ------------------------------------------------------
  // Dieselben zwei Balken wie im Logo, nur in Bildgröße nachgerechnet: Das
  // Original steht in einem viewBox-Ausschnitt von 42 auf 64 Einheiten.
  const logoH = 30;
  const e = logoH / 64;
  ctx.fillStyle = farbe.akzent;
  rundesRechteck(ctx, rand, y + 38 * e, 18 * e, 26 * e, 9 * e);
  ctx.fill();
  rundesRechteck(ctx, rand + 24 * e, y, 18 * e, 64 * e, 9 * e);
  ctx.fill();

  ctx.font = `700 26px ${mono}`;
  ctx.fillStyle = farbe.text;
  // letterSpacing gibt es nicht überall; ohne die Sperrung sieht der Schriftzug
  // nur etwas enger aus, das Bild bleibt richtig.
  try { ctx.letterSpacing = '3px'; } catch { /* egal */ }
  ctx.fillText('SIZED', rand + 42 * e + 12, y + 23);
  try { ctx.letterSpacing = '0px'; } catch { /* egal */ }

  ctx.font = `400 20px ${mono}`;
  ctx.fillStyle = farbe.dimmer;
  ctx.textAlign = 'right';
  ctx.fillText('sized.gg', B - rand, y + 23);
  ctx.textAlign = 'left';
  y += 92;

  // --- Die Frage ------------------------------------------------------------
  ctx.font = `700 ${frageGroesse}px ${mono}`;
  ctx.fillStyle = farbe.text;
  for (const zeile of frageZeilen) {
    ctx.fillText(kuerzen(ctx, zeile, inhalt), rand, y + Math.round(frageGroesse * 46 / 54));
    y += frageZeile;
  }

  // --- Die Zahlen darunter --------------------------------------------------
  ctx.font = `400 21px ${mono}`;
  ctx.fillStyle = farbe.dim;
  const gesamt = `${vollUsd(p.totalUsd)} in $${state.cfg.symbol}`;
  ctx.fillText(gesamt, rand, y + 26);

  if (p.closed) {
    const x = rand + ctx.measureText(gesamt).width + 20;
    ctx.font = `600 15px ${mono}`;
    const w = ctx.measureText('CLOSED').width + 18;
    ctx.fillStyle = farbe.balken;
    rundesRechteck(ctx, x, y + 8, w, 26, 5);
    ctx.fill();
    ctx.strokeStyle = farbe.linie;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = farbe.dim;
    ctx.fillText('CLOSED', x + 9, y + 26);
  }
  y += 54 + rest * .55;

  // --- Die Antworten --------------------------------------------------------
  //
  // Die Breite der gefüllten Fläche ist der ANTEIL am Gesamtbetrag, nicht ein
  // eigenes Maß: p.options[i].share kommt aus usd_i / totalUsd, und totalUsd
  // ist die Summe genau dieser Beträge. Die Anteile ergeben also zusammen 1,
  // und die gefüllten Stücke aneinandergelegt ergeben genau einen vollen
  // Balken. test-poll-bild.mjs rechnet das nach, damit es so bleibt.
  const fuehrt = fuehrenderAnteil(p);

  // Die breiteste Dollarzahl bestimmt, wie viel Platz die Antworten haben.
  // Ohne diese gemeinsame Spalte begänne der Text in jeder Zeile woanders.
  ctx.font = `700 36px ${mono}`;
  const geldBreite = zeigen.length
    ? Math.max(...zeigen.map((o) => ctx.measureText(vollUsd(o.usd)).width))
    : 0;

  // Und wie viel Platz bleibt dann fuer die Antwort selbst.
  const textBreite = inhalt - 50 - geldBreite - 36;

  // Die Antworten werden kleiner gesetzt, wenn die laengste sonst nicht passt –
  // dasselbe Zugestaendnis wie oben bei der Frage, und aus demselben Grund.
  //
  // Der Grund ist hier aber schaerfer, und er ist ein Fehler, den ich gemacht
  // habe: MAX_ANTWORT ist 60 Zeichen, und diese 60 sind gegen EINE Schrift
  // gemessen worden – die, die auf dem Rechner stand, auf dem gemessen wurde.
  // Gezeichnet wird die Karte aber in --mono, und was das ist, entscheidet das
  // Geraet: auf einem Mac SF Mono, anderswo Menlo, DejaVu, Consolas. Die bauen
  // unterschiedlich breit. Eine feste Zeichenzahl und eine gemessene Breite
  // koennen deshalb gar nicht dauerhaft uebereinstimmen – irgendwo passt es,
  // und woanders steht ploetzlich ein Auslassungszeichen hinter einem Text,
  // den das Formular ausdruecklich erlaubt hat.
  //
  // Also misst auch hier die Karte und nicht die Grenze. Die 60 Zeichen sagen
  // nur noch, wie lang eine Antwort sein DARF; ob sie in voller Groesse
  // dasteht, entscheidet die Messung.
  //
  // Untergrenze 21 px: Darunter steht die Antwort kleiner da als der Betrag
  // daneben, und dann sieht die Zeile aus, als sei die Zahl die Hauptsache.
  let optGroesse = 27;
  const passtAlles = (groesse) => {
    ctx.font = `650 ${groesse}px ${mono}`;
    return zeigen.every((o) => ctx.measureText(o.label).width <= textBreite);
  };
  while (optGroesse > 21 && !passtAlles(optGroesse)) optGroesse -= 1;

  let antwortenGekuerzt = 0;
  for (const o of zeigen) {
    const spitze = fuehrt !== null && o.share === fuehrt;

    // Die Zeile hat KEINE eigene Fläche, nur einen Umriss – wie auf der Seite,
    // wo .opt-bar seit dem Flachlegen des Tabs ebenfalls keine hat.
    //
    // Hier stand --bg-3 gefüllt, und das ging so lange gut, wie die Füllung
    // durchscheinendes Weiss darüber war: Beide waren blaustichig, der
    // Übergang las sich als eine Fläche in zwei Helligkeiten. Xs Grau ist
    // neutral. Neben --bg-3 sah der leere Teil dadurch aus wie ein zweiter,
    // blau angelaufener Balken hinter dem ersten – zwei Kästen statt eines
    // Balkens in einer Rinne.
    rundesRechteck(ctx, rand, y, inhalt, optH, 13);
    // Der führende Balken hatte hier einen zweiten, helleren Rahmen in 2 px.
    // Der ist weg, seit die Füllung farbig ist: Vorn zu liegen wird jetzt
    // durch das Blau gesagt, und zweimal dasselbe zu sagen macht es nicht
    // deutlicher, sondern unruhig. Ein Strich für alle Zeilen.
    ctx.strokeStyle = farbe.linie;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Einfarbig und mit harter Kante – auf der Seite läuft dieselbe Füllung
    // weich aus.
    //
    // Der Unterschied ist Absicht, nicht Nachlässigkeit. Auf der Seite ist der
    // Balken anklickbar und ändert sich beim Abstimmen; eine harte Kante, die
    // beim Klick durch ein Wort springt, liest sich dort als Fehler. Das Bild
    // ist starr. Eine Kante, die nicht wandert, wirkt gesetzt – und sie sagt
    // etwas, was der weiche Verlauf verschluckt: genau hier endet der Anteil.
    //
    // Der Antworttext liegt auch hier über dem Balken und wird von der Kante
    // gekreuzt. Die Füllung ist deckend statt durchscheinend, seit sie Xs
    // Werte hat; nachgemessen steht der Text auf beiden Seiten der Kante gut
    // lesbar da (10,0:1 auf dem Grau, 6,0:1 auf dem Blau, 16,2:1 daneben).
    //
    // Dieselben zwei Farben wie auf der Seite, aus demselben Blatt geholt –
    // sonst sieht das Bild, das nach draußen geht, anders aus als die Seite,
    // von der es stammt.
    const fuellB = Math.max(0, Math.min(1, o.share)) * inhalt;
    if (fuellB > 1) {
      ctx.save();
      rundesRechteck(ctx, rand, y, inhalt, optH, 13);
      ctx.clip();
      ctx.fillStyle = spitze ? farbe.fuellungSpitze : farbe.fuellung;
      ctx.fillRect(rand, y, fuellB, optH);
      ctx.restore();
    }

    // Der Betrag rechts, ALLEIN und mittig in der Zeile.
    //
    // An dieser Stelle standen nacheinander drei Dinge: die Stimmenzahl unter
    // dem Betrag, dann nichts, dann der Prozentsatz, jetzt wieder nichts. Der
    // Prozentsatz war ein Angebot und ist wieder herausgeflogen – er sagte
    // dasselbe wie die Balkenlaenge, nur eine Zeile lauter.
    //
    // Zurueckkommen darf davon nur der Anteil, nie die STIMMENZAHL: Sie liess
    // sich aufblasen, indem jemand sein Guthaben kurz vor Schluss auf viele
    // Wallets verteilt und mit jeder abstimmt. Betrag und Anteil koennen das
    // nicht, weil beide aus den Betraegen kommen und nicht aus einer Zaehlung.
    //
    // 13 ist keine gewaehlte Zahl: Der Betrag steht auf der Grundlinie, seine
    // Versalhoehe ist 26 px, die Haelfte davon liegt ueber der Mitte.
    const mitte = y + optH / 2;
    ctx.textAlign = 'right';
    ctx.font = `700 36px ${mono}`;
    ctx.fillStyle = spitze ? farbe.akzent : farbe.text;
    ctx.fillText(vollUsd(o.usd), B - rand - 26, mitte + 13);
    ctx.textAlign = 'left';

    // Die Antwort selbst. Bewusst OHNE den eigenen Haken: Das Bild geht nach
    // draußen, und wie der Absender abgestimmt hat, gehört nicht hinein.
    ctx.font = `${spitze ? '650' : '500'} ${optGroesse}px ${mono}`;
    ctx.fillStyle = farbe.text;
    const beschriftung = kuerzen(ctx, o.label, textBreite);
    if (beschriftung !== o.label) antwortenGekuerzt++;
    ctx.fillText(beschriftung, rand + 26, mitte + 10);

    y += optH + luecke;
  }

  // Weggelassene Antworten werden genannt, nicht verschwiegen. Eine Karte, die
  // stillschweigend die Hälfte zeigt, behauptet etwas über das Ergebnis.
  if (ausgelassen) {
    ctx.font = `400 20px ${mono}`;
    ctx.fillStyle = farbe.dimmer;
    ctx.fillText(`+ ${ausgelassen} more option${ausgelassen === 1 ? '' : 's'} on sized.gg`,
      rand, y + 22);
  }

  // --- Fuß ------------------------------------------------------------------
  //
  // Beim Kartenbild bleibt der Streifen unten LEER.
  //
  // X zeichnet den Titel der Kachel als schwarzen Kasten unten links ins Bild.
  // Weglassen geht nicht – ohne Titel baut X gar keine Kachel mehr, sondern
  // zeigt den nackten Link. Also bekommt der Kasten eine Fläche, auf der er
  // nichts verdeckt.
  //
  // Der Platz wird trotzdem freigehalten und nicht von den Balken gefüllt:
  // Sonst läge der Kasten auf einer Antwort.
  //
  // Im Bild zum Herunterladen steht die Zeile weiterhin – dort gibt es keinen
  // Kasten, und "sized.gg" gehört auf ein Bild, das gepostet wird.
  if (!fuerKarte) {
    ctx.font = `400 19px ${mono}`;
    ctx.fillStyle = farbe.dimmer;
    // Ohne "sized.gg": Das steht schon oben rechts. Zweimal dieselbe Adresse
    // auf einem Bild ist keine Betonung, sondern eine Wiederholung.
    ctx.fillText(p.closed
      ? 'This vote is closed'
      : `Hold $${state.cfg.symbol} to vote`, rand, H - m - 38);
  }

  ctx.restore();

  // Der Rand zum Schluss obendrauf. Er ist das Einzige, was die Rundung
  // wirklich zeigt: Karte und Grund unterscheiden sich nur um wenige
  // Helligkeitsstufen, und nach der Umrechnung durch X kann dieser Unterschied
  // fast verschwinden. Der Strich überlebt sie.
  //
  // Seit der Lichtschein weg ist, traegt er ausserdem allein die Aufgabe, die
  // Karte von der Zeitleiste abzusetzen. Deshalb --dimmer statt --line und
  // 3 px statt 1,5: Auf schwarzem Grund sieht auch die Haarlinie gut aus,
  // aber dort steht die Kachel spaeter nicht.
  ctx.strokeStyle = farbe.dimmer;
  ctx.lineWidth = 3;
  rundesRechteck(ctx, m, m, B - m * 2, karteH, BILD_ECKE);
  ctx.stroke();

  // Die tatsächlich gezeichnete Geometrie hängt am Bild.
  //
  // Das ist für den Test da, und zwar aus einem bestimmten Grund: Rechnet er
  // die Balkenbreiten selbst nach, prüft er seine eigene Kopie der Formel und
  // nicht das, was hier passiert ist. Genau so ist er schon einmal grün
  // geblieben, nachdem sich der Seitenrand geändert hatte. Ein paar Zahlen an
  // die Leinwand zu hängen kostet nichts und macht die Prüfung ehrlich.
  leinwand.geometrie = {
    inhalt,
    verhaeltnis: B / H,
    gezeigt: zeigen.length,
    ausgelassen,
    // Die beiden Stellen, an denen Text still verschwindet: eine Frage ueber
    // drei Zeilen und eine Antwort, an die kuerzen() drei Punkte gehaengt hat.
    // Sie stehen hier, damit MAX_FRAGE und MAX_ANTWORT gegen das GEZEICHNETE
    // Bild geprueft werden koennen und nicht gegen eine nachgerechnete Formel.
    frageZeilenRoh: frageZeilenRoh.length,
    frageGroesse,
    frageGekuerzt: frageZeilenRoh.length > 3,
    optGroesse,
    antwortenGekuerzt,
    fuellungen: zeigen.map((o) => Math.max(0, Math.min(1, o.share)) * inhalt),
  };

  return leinwand;
}

/**
 * Das Vorschaubild einer Abstimmung in die öffentliche Ablage legen.
 *
 * Der Grund, warum es überhaupt hochgeladen wird: Der Erste, der einen
 * geposteten Link öffnet, ist nicht der Leser, sondern Xs Crawler – und der
 * führt kein JavaScript aus. Was hier im Browser gezeichnet wird, sieht er
 * nie. Das Bild muss fertig unter einer Adresse liegen, bevor der Link
 * gepostet wird.
 *
 * WIRD GENAU EINMAL AUFGERUFEN: beim Anlegen der Abstimmung.
 *
 * Das ist eine Entscheidung, keine Nachlässigkeit. Die Linkkarte zeigt die
 * Abstimmung so, wie sie beim Start aussah – überall Null. Sie ist die
 * Einladung zum Abstimmen, kein Ergebnisbericht: Wer die aktuellen Zahlen
 * posten will, lädt das Bild mit dem Ladeknopf und hängt es als Bild an.
 *
 * Dass der Text der Karte dabei aktuell ist und das Bild nicht, ist bewusst
 * hingenommen. Auf X fällt es nicht auf – dort wird bei Linkkarten nur das
 * Bild gezeigt. In Slack oder Telegram steht darunter der aktuelle Stand und
 * widerspricht dem Bild; das ist der Preis dafür, dass die Karte sonst bei
 * jedem Teilen neu erzeugt werden müsste.
 *
 * Die einzige Ausnahme ist ergaenzeFehlendeKarten(): Abstimmungen von vor
 * diesem Mechanismus haben gar kein Bild, und ein Bild mit dem heutigen Stand
 * ist dort besser als die Ersatzkarte.
 *
 * Fehler werden bewusst nur ins Protokoll geschrieben. Das Hochladen hängt an
 * einer Handlung, die etwas anderes bezweckt – eine Abstimmung anlegen. Sie
 * deshalb scheitern zu lassen oder mit einer Meldung zu stören wäre falsch
 * herum: Die Abstimmung steht, nur ihre Karte fehlt.
 */
async function ladeOgBildHoch(p) {
  if (!state.me?.isAdmin || !state.db?.storage) return false;
  try {
    const leinwand = await zeichnePoll(p, { fuerKarte: true });
    const blob = await new Promise((r) => leinwand.toBlob(r, 'image/png'));
    if (!blob) return false;
    const { error } = await state.db.storage.from('og')
      .upload(kartenDatei(p.id), blob, {
        upsert: true,
        contentType: 'image/png',
        // Ein Jahr, unveraenderlich – und das ist keine Schaetzung: Der
        // Dateiname traegt die Fassungsnummer (poll-12-v9.png). Unter DIESEM
        // Namen aendert sich das Bild nie; aendert sich die Karte, steigt
        // KARTEN_VERSION und der Name ist ein anderer.
        //
        // Vorher standen hier 300 Sekunden. Danach holte jeder Abruf das Bild
        // wieder von der Quelle – auch der von X, wenn jemand den Link Stunden
        // spaeter noch einmal teilt. Fuenf Minuten Vorsicht fuer eine Datei,
        // die sich per Definition nicht aendert.
        cacheControl: '31536000, immutable',
      });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.warn('[og] preview image not uploaded:', e.message);
    return false;
  }
}

/**
 * Fehlende Vorschaukarten nachtragen.
 *
 * Läuft einmal beim Start, nur bei Ansem. Der Grund: Ein geteilter Link soll
 * eine Karte zeigen, ohne dass vorher jemand einen Knopf gedrückt hat –
 * Abstimmungen aus der Zeit vor diesem Mechanismus haben aber keine.
 *
 * Es wird EIN Verzeichnis-Aufruf gemacht und daraus gelesen, was schon da ist.
 * Die Alternative wäre, für jede Abstimmung einzeln nachzusehen; das wären bei
 * fünfzig Abstimmungen fünfzig Anfragen für eine Auskunft, die in einer Antwort
 * passt.
 *
 * Gedeckelt auf ein paar Stück pro Start. Jedes Bild ist rund 400 KB, und
 * fünfzig davon beim Öffnen der Seite hochzuladen wäre ein Missverhältnis –
 * die restlichen kommen beim nächsten Start dran oder beim Teilen.
 */
const MAX_KARTEN_PRO_START = 6;

async function ergaenzeFehlendeKarten() {
  if (!state.me?.isAdmin || !state.db?.storage || !state.polls?.length) return;
  try {
    const { data, error } = await state.db.storage.from('og').list('', { limit: 1000 });
    if (error) throw new Error(error.message);
    const vorhanden = new Set((data ?? []).map((d) => d.name));

    const fehlend = state.polls
      .filter((p) => !vorhanden.has(kartenDatei(p.id)))
      .slice(0, MAX_KARTEN_PRO_START);
    if (!fehlend.length) return;

    // Nacheinander, nicht gleichzeitig: Sechs Leinwände parallel zu zeichnen
    // lässt auf einem Telefon die Oberfläche stocken, und Eile ist hier keine.
    for (const p of fehlend) await ladeOgBildHoch(p);
    console.info(`[og] ${fehlend.length} Vorschaukarte(n) nachgetragen`);
  } catch (e) {
    console.warn('[og] cards not backfilled:', e.message);
  }
}

/**
 * Bild bauen und ausliefern.
 *
 * Zwei Wege, und der Grund für den zweiten ist iOS: Ein a[download] auf eine
 * blob-Adresse tut dort mal etwas und mal nichts. Das Systemmenü dagegen
 * funktioniert dort zuverlässig und ist für den eigentlichen Zweck ohnehin
 * besser – aus ihm heraus geht das Bild direkt nach X, ohne Umweg über die
 * Fotos.
 */
async function ladePollBild(id) {
  const p = state.polls.find((x) => x.id === Number(id));
  if (!p) return toast('That poll is not in the list anymore', true);

  if (!knopfBelegen('poll-image', id)) return;
  try {
    const leinwand = await zeichnePoll(p);
    const blob = await new Promise((r) => leinwand.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not build the image');

    const name = `sized-poll-${p.id}.png`;
    const datei = new File([blob], name, { type: 'image/png' });

    if (navigator.canShare?.({ files: [datei] }) && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ files: [datei] });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        // Alles andere: unten weiter mit dem Herunterladen.
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Nicht sofort: Manche Browser lesen die Adresse erst nach dem Klick aus.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    knopfAn('poll-image', id);
  } catch (e) {
    console.error('[poll] image failed:', e);
    toast(e.message || 'Could not build the image', true);
  } finally {
    knopfFreigeben('poll-image', id);
  }
}

function pollHtml(p) {
  // Ansem stimmt nicht mit: Er stellt die Frage, legt die Antworten fest und
  // schließt ab – zusätzlich das schwerste Gewicht im Raum einzubringen wäre
  // keine Abstimmung mehr. Die Datenbank weist seine Stimme ohnehin ab; hier
  // sehen die Möglichkeiten deshalb gar nicht erst anklickbar aus.
  const stimmberechtigt = !state.me.isAdmin;

  // Die führende Antwort steht blau und fetter da – dieselbe Auszeichnung wie
  // im Bild, das der Ladeknopf erzeugt, und aus derselben Rechnung. Erst nach
  // dem Schliessen: warum, steht bei fuehrenderAnteil().
  const fuehrt = fuehrenderAnteil(p);

  // Abstimmen mit der Tastatur.
  // -------------------------------------------------------------------------
  // Hier stand ein nacktes <div>. Damit war die zentrale Handlung der ganzen
  // Seite fuer eine Tastatur nicht erreichbar: Die gemessene Reihenfolge lief
  // Marke, Reiter, Abmelden, Link, Bild – und dann von vorn, ohne je eine
  // Antwort zu beruehren. Eine Vorlesestimme meldete die Zeilen als Text.
  //
  // Kein <button>, obwohl es naheliegt: Ein Knopf bringt eigene Innenabstaende,
  // eigene Schriftvererbung und in Safari eine eigene Mindesthoehe mit, und das
  // Blatt darum herum ist auf ein div gebaut. Ein role="button" mit tabindex
  // sagt derselben Vorlesestimme dasselbe, ohne das Aussehen anzufassen.
  //
  // aria-disabled statt disabled, weil ein div kein disabled kennt – und weil
  // eine geschlossene Abstimmung SICHTBAR bleiben soll, auch fuer den, der
  // sie sich vorlesen laesst.
  //
  // aria-pressed sagt, welche Antwort die eigene ist. Ohne das ist der Haken
  // nur ein Bild.
  const opts = p.options.map((o) => {
    const zu = p.closed || !stimmberechtigt;
    return `
    <div class="opt ${zu ? 'locked' : ''} ${p.myOptionId === o.id ? 'mine' : ''}${fuehrt !== null && o.share === fuehrt ? ' leads' : ''}"
         data-poll="${p.id}" data-option="${o.id}"
         role="button" tabindex="${zu ? -1 : 0}"
         aria-disabled="${zu}" aria-pressed="${p.myOptionId === o.id}">
      <div class="opt-bar">
        <div class="opt-fill" style="width:${(o.share * 100).toFixed(1)}%"></div>
        <div class="opt-text">
          <span class="opt-label">${esc(o.label)}${p.myOptionId === o.id
            // Das Bild ist fuer das Auge, der Satz fuer die Vorlesestimme. Vorher
            // stand hier ein ✓ als Buchstabe – das wurde als "Haken" mitgelesen
            // und sagte nicht, was es bedeutet.
            ? `${STIMME_SVG}<span class="nur-vorlesen"> — your vote</span>` : ''}</span>
          <span class="opt-num">
            <span class="held">${vollUsd(o.usd)}</span>
          </span>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<article class="poll" id="poll-${p.id}">
    <div class="poll-head">
      <h4>${esc(p.question)}</h4>
      <span class="poll-tools">
        <button class="icon-btn poll-share" data-share="${p.id}"
                title="Copy link to this poll" aria-label="Copy link to this poll">${LINK_SVG}</button>
        <button class="icon-btn poll-image" data-image="${p.id}"
                title="Download this poll as an image"
                aria-label="Download this poll as an image">${DOWNLOAD_SVG}</button>
        ${state.me.isAdmin ? `<button class="icon-btn poll-delete" data-delete="${p.id}"
                title="Delete this poll" aria-label="Delete this poll">${TRASH_SVG}</button>` : ''}
      </span>
    </div>
    <div class="poll-meta">
      <span>${vollUsd(p.totalUsd)} in $${esc(state.cfg.symbol)} total</span>
      ${!p.closed && p.closesAt ? fristZeile(p) : ''}
      ${p.closed ? '<span class="closed-tag">CLOSED</span>' : ''}
      ${state.me.isAdmin && !p.closed ? '<span class="dim">· you do not vote in your own polls</span>' : ''}
      ${state.me.isAdmin && !p.closed ? `<button class="btn btn-ghost btn-close-poll" data-poll="${p.id}">Close poll</button>` : ''}
    </div>
    ${opts}
  </article>`;
}

/**
 * Eine Abstimmung löschen. Nur Ansem.
 *
 * Zwei Tipper, nicht einer. Der erste macht aus dem Papierkorb ein Häkchen,
 * der zweite löscht. Kein Hinweis, der aufpoppt, keine Warnfarbe – das
 * Symbol selbst ist die Rückfrage, und die Antwort ist derselbe Knopf.
 *
 * Der Grund für die zwei Schritte bleibt: Es gibt kein Zurück. Die Stimmen
 * hängen per Fremdschlüssel an der Abstimmung und werden von der Datenbank
 * mitgelöscht; niemand kann sie wiederherstellen, und die Leute, die
 * abgestimmt haben, haben dafür Token gehalten. Der Knopf sitzt außerdem
 * direkt neben zwei harmlosen – Link kopieren und Bild laden – und in einer
 * Reihe gleich aussehender Symbole trifft man irgendwann daneben.
 *
 * Nach fünf Sekunden wird aus dem Häkchen wieder ein Papierkorb. Ohne das
 * bliebe ein scharfer Knopf im Blatt stehen, von dem niemand mehr weiß – und
 * der nächste beiläufige Tipper löscht.
 *
 * "Scharf" steht bei knopfAktiv und nicht am Knopf. Der Grund steht dort
 * ausführlich: Die Liste wird bei jeder fremden Stimme neu gebaut, und ein
 * Zustand am DOM-Knoten überlebt das nicht. Genau das war der Fehler, bei dem
 * der zweite Tipper manchmal nichts tat.
 */
async function loeschePoll(id) {
  const p = state.polls.find((x) => x.id === Number(id));
  if (!p) return toast('That poll is not in the list anymore', true);

  if (!knopfIstAn('poll-delete', id)) {
    knopfAn('poll-delete', id);
    return;
  }

  knopfAus('poll-delete', id);
  if (!knopfBelegen('poll-delete', id)) return;
  // Antworten und Stimmen hängen per "on delete cascade" daran und gehen
  // mit – das erledigt die Datenbank, nicht der Browser. Ein Löschen in drei
  // Schritten von hier aus könnte auf halber Strecke abbrechen und eine
  // Abstimmung ohne Antworten hinterlassen.
  const { error } = await state.db.from('polls').delete().eq('id', p.id);
  knopfFreigeben('poll-delete', id);

  // Nur der Fehlerfall meldet sich. Dass es geklappt hat, sieht man daran,
  // dass die Abstimmung weg ist – eine Meldung obendrauf sagt dasselbe noch
  // einmal. Dass es NICHT geklappt hat, sieht man dagegen nirgends: Die
  // Abstimmung stünde einfach weiter da, und das läse sich als klemmender
  // Knopf.
  if (error) return toast(error.message, true);

  // Das Vorschaubild hängt nicht per Fremdschlüssel an der Abstimmung, die
  // Datenbank räumt es also nicht mit weg. Es zu lassen wäre kein Beinbruch,
  // aber ein alter Link zeigte dann weiter eine gültig aussehende Karte für
  // etwas, das es nicht mehr gibt.
  // Alle Fassungen mitnehmen, nicht nur die aktuelle: Nach einem Versionswechsel
  // liegen die alten noch da, und ein Link auf eine geloeschte Abstimmung soll
  // keine gueltig aussehende Karte mehr finden.
  state.db.storage?.from('og')
    .remove(Array.from({ length: KARTEN_VERSION }, (_, i) => `poll-${p.id}-v${i + 1}.png`)
      .concat(`poll-${p.id}.png`))
    .catch((e) => console.warn('[og] preview image not deleted:', e.message));

  // Die anderen Browser holen sich das über Realtime; der eigene wartet nicht
  // darauf, damit der Knopf nicht ins Leere zu zeigen scheint.
  loadPolls().catch((e) => console.warn('[poll] reload after delete:', e.message));
}

async function vote(pollId, optionId) {
  // Doppelt: Der Klick kommt hier gar nicht mehr an, weil die Möglichkeiten
  // für ihn gesperrt sind – aber wer die Funktion anders erreicht, soll
  // dieselbe Antwort bekommen wie von der Datenbank.
  if (state.me.isAdmin) return toast('You cannot vote in your own polls', true);

  const { error } = await state.db.from('votes')
    .upsert({ poll_id: pollId, option_id: optionId, wallet: state.me.wallet },
      { onConflict: 'poll_id,wallet' });
  if (error) return toast(error.message, true);
  await loadPolls();
  toast('Vote counted');
}

/**
 * Die Antwortfelder und der Knopf darunter.
 *
 * Zwei ist die Untergrenze – mit einer Antwort wäre es keine Abstimmung mehr.
 *
 * Vier ist die Obergrenze, und die Zahl ist gemessen. Der Maßstab ist wieder
 * das Bild, das nach draußen geht, diesmal aber nicht sein Inhalt, sondern sein
 * FORMAT: X zeigt in der Zeitleiste ein Bild bis 16:9 ungeschnitten und
 * beschneidet alles Höhere oben und unten. Die Karte wächst mit jeder Antwort.
 * Gemessen (bei einzeiliger Frage; mehrzeilige Fragen drücken die Zahl weiter):
 *
 *        4 Antworten   1,78 – genau 16:9, nichts fällt weg
 *        5 Antworten   1,74 – ein schmaler Streifen
 *        6 Antworten   1,58
 *       10 Antworten   1,14 – fast quadratisch, ein gutes Stück ist weg
 *
 * Vier ist damit die letzte Zahl, bei der das gepostete Bild vollständig
 * ankommt. Dass X in seiner eigenen Umfrage genau vier erlaubt, ist derselbe
 * Grund und keine Nachahmung.
 *
 * Die kleine Linkvorschau (1,91:1) ist davon unberührt: Sie hat eine feste Höhe
 * und zeigt je nach Länge der Frage drei oder vier Antworten, den Rest nennt
 * sie als "+ N more options on sized.gg". Dieses Feld bleibt bestehen – es
 * greift jetzt nur noch bei einer dreizeiligen Frage.
 *
 * Die Datenbank kennt dieselbe Grenze (Migration 20260830020000_antwortzahl.sql).
 * Ein einfaches check reicht dafür nicht: Die Zahl der Antworten steht nicht in
 * der Zeile, die geprüft wird, sondern ergibt sich aus den anderen Zeilen. Also
 * ein Trigger, der zählt.
 *
 * ---------------------------------------------------------------------------
 * Warum es kein "− Option" mehr gibt
 *
 * Es gab einen zweiten Knopf, der die letzte Antwort wieder entfernte. Er ist
 * weg, und an seine Stelle tritt ein Wort im Platzhalter: Ab der dritten
 * Antwort steht dort "Option 3 (optional)".
 *
 * Das ist kein Verzicht, sondern die ehrlichere Auskunft. Ein leeres Feld war
 * schon immer keine Antwort – beim Anlegen fällt es durch den filter(Boolean)
 * heraus, ganz gleich ob es dasteht oder nicht. Der Minusknopf hat also etwas
 * aufgeräumt, das ohnehin folgenlos war, und dafür so ausgesehen, als müsste
 * man aufräumen. Wer eine Antwort doch nicht will, lässt das Feld einfach
 * leer.
 *
 * Was das Wort zusätzlich sagt und der Knopf nie gesagt hat: dass die ersten
 * beiden Felder eben NICHT optional sind. Vorher stand dort dreimal dasselbe
 * "Option N", und dass zwei davon Pflicht sind, erfuhr man erst aus der roten
 * Meldung beim Absenden.
 */
const MIN_OPTIONEN = 2;
const MAX_OPTIONEN = 4;

/**
 * Wie lang eine Frage und eine Antwort sein duerfen.
 *
 * Die beiden Zahlen sind NACHGEMESSEN und nicht gegriffen, und der Massstab ist
 * nicht das Formular, sondern das Bild, das nach draussen geht:
 *
 *   Die Frage steht auf der Karte fett und bekommt DREI Zeilen. Bei 54 px und
 *   1428 px Inhaltsbreite passen 43 Zeichen in eine Zeile, also 129 ueber drei
 *   – aber nur, wenn kein Wortumbruch Platz kostet. Er kostet welchen, und wie
 *   viel, haengt an den Woertern und nicht an der Zeichenzahl: Ein langes Wort
 *   am Zeilenende laesst eine halbe Zeile leer.
 *
 *   Gemessen (scripts/mess-frage-laenge.mjs, 4000 Zufallssaetze je Laenge, bei
 *   fester Schriftgroesse; "zu lang" heisst: braucht eine vierte Zeile):
 *
 *          Wortlaengen   englische Prosa   bis 13   bis 16   bis 20
 *          100 Zeichen                 0        0        0       28
 *          110 Zeichen                 6       23      185      551
 *          120 Zeichen               518     1160     1729     2356
 *
 *   Genommen sind 100: die groesste der geprueften Laengen, bei der auch mit
 *   ueberdurchschnittlich langen Woertern nichts umbricht.
 *
 *   Eine Antwort steht in einer Zeile neben ihrem Betrag. Bleibt sie zu lang,
 *   haengt kuerzen() ein Auslassungszeichen an. Gemessen passen 70 Zeichen
 *   selbst neben den breitesten Betrag ($12,345,678), 75 neben einen kleinen.
 *   Genommen sind 60.
 *
 * Warum ueberhaupt eine Grenze, wo die Karte doch nachgibt:
 * ---------------------------------------------------------------------------
 * zeichnePoll() verkleinert die Schrift, bis die Frage in drei Zeilen passt –
 * es geht hier also nicht mehr darum, dass Text verschwindet. Es geht um die
 * Groesse, in der er ankommt. Eine Frage, die die Karte auf 44 px druecken
 * wuerde, ist in der Zeitleiste zwischen anderen Beitraegen nicht mehr die
 * Ueberschrift, als die sie gedacht war.
 *
 * Die Datenbank kennt dieselben Werte (siehe die Migration
 * 20260830010000_laengen.sql). Sie ist die eigentliche Sperre; was hier steht,
 * sorgt nur dafuer, dass niemand erst tippt und dann eine Absage bekommt.
 */
const MAX_FRAGE = 100;
const MAX_ANTWORT = 60;

/**
 * Der Platzhalter einer Antwortzeile.
 *
 * Eine Funktion und keine Zeichenkette an drei Stellen: Die ersten beiden
 * Felder stehen im Blatt, alle weiteren entstehen hier, und das Zurücksetzen
 * nach dem Anlegen geht noch einmal darüber. Drei Orte für denselben Text
 * wären zwei Orte zu viel.
 *
 * Eckige Klammern und keine runden, und der Grund ist die Schrift:
 * ---------------------------------------------------------------------------
 * Die Seite ist durchgehend in Schreibmaschinenschrift gesetzt, und dort belegt
 * JEDES Zeichen dieselbe Zellenbreite. Eine runde Klammer ist ein schmales
 * Zeichen in einer breiten Zelle – gemessen 4 px Glyphe in 9 px Zelle. Aus
 * "(optional)" wird damit für das Auge "( optional )", obwohl im Text kein
 * einziges Leerzeichen steht. Eine eckige Klammer füllt ihre Zelle fast ganz
 * aus und sitzt deshalb von selbst eng am Wort.
 *
 * Hier lag eine Weile eine ganze Maschinerie dafür: eine zweite Beschriftung
 * aus echtem Markup über dem Feld, in der die runden Klammern eine eigene,
 * schmalere Zelle bekamen, samt Messwerkzeug gegen Xs Formular. Sie ist wieder
 * raus. Ein Zeichen zu tauschen tut dasselbe und kostet nichts.
 */
const optionPlatzhalter = (nr) =>
  nr > MIN_OPTIONEN ? `Option ${nr} [optional]` : `Option ${nr}`;

/**
 * Haengt einen Zeichenzaehler an ein Feld.
 *
 * Er steht IM Feld rechts, wie bei X. Sichtbar ist er nicht immer: solange man
 * darin tippt, und ausserdem, sobald es eng wird. Der zweite Fall ist der
 * wichtigere – wer einen langen Text hineinkopiert und wegklickt, soll sehen,
 * dass er an der Grenze steht, ohne noch einmal hineinzuklicken.
 *
 * Der Platz rechts wird IMMER freigehalten, auch wenn der Zaehler gerade nicht
 * dasteht. Sonst spraenge der Text unter dem Zeiger weg, sobald man das Feld
 * betritt. Die Breite kommt aus der laengsten Zahl, die dort je stehen kann –
 * "110 / 110" –, gerechnet in ch: In einer Schreibmaschinenschrift ist ein ch
 * genau eine Zelle, die Rechnung geht also auf.
 *
 * maxlength macht die eigentliche Arbeit; der Zaehler sagt nur, warum das
 * Tippen aufhoert. Ohne ihn waere es eine Tastatur, die stumm nicht mehr
 * reagiert.
 */
function zaehlerAnhaengen(feld, max) {
  const kasten = feld.closest('.zaehl-feld');
  const zaehler = kasten?.querySelector('.zaehler');
  if (!zaehler) return;
  feld.maxLength = max;
  const laengste = `${max} / ${max}`;
  feld.style.paddingRight = `calc(${laengste.length}ch + 1.4rem)`;
  const zeige = () => {
    const n = feld.value.length;
    zaehler.textContent = `${n} / ${max}`;
    // Knapp heisst: die letzten zehn Zeichen. Voll heisst: keins mehr.
    kasten.classList.toggle('ist-knapp', max - n <= 10);
    kasten.classList.toggle('ist-voll', n >= max);
  };
  feld.addEventListener('input', zeige);
  zeige();
}

function renderOptionKnoepfe() {
  $('#btn-add-option').hidden = $('#poll-options').children.length >= MAX_OPTIONEN;
}

/** Eine Antwortzeile: Feld plus Zaehler, wie die ersten beiden im Blatt. */
function optionFeld(nr) {
  const kasten = document.createElement('label');
  kasten.className = 'zaehl-feld';
  kasten.innerHTML = `<input class="poll-option" type="text"`
    + ` placeholder="${esc(optionPlatzhalter(nr))}">`
    + '<span class="zaehler" aria-hidden="true"></span>';
  zaehlerAnhaengen(kasten.querySelector('.poll-option'), MAX_ANTWORT);
  return kasten;
}

$('#btn-add-option').addEventListener('click', () => {
  const box = $('#poll-options');
  if (box.children.length >= MAX_OPTIONEN) return;
  const kasten = optionFeld(box.children.length + 1);
  box.appendChild(kasten);
  renderOptionKnoepfe();
  kasten.querySelector('.poll-option').focus();
});

renderOptionKnoepfe();
// Die beiden Felder, die schon im Blatt stehen, und die Frage darueber.
zaehlerAnhaengen($('#poll-question'), MAX_FRAGE);
for (const feld of $$('.poll-option')) zaehlerAnhaengen(feld, MAX_ANTWORT);

/**
 * Setzt den Anlegekasten auf den Zustand zurück, in dem er aufgeht.
 *
 * Frage leer, genau MIN_OPTIONEN leere Antwortfelder, Laufzeit auf der
 * Vorgabe. Also nicht nur "die Texte löschen": Wer vier Antworten aufgemacht
 * hat, findet beim nächsten Öffnen wieder zwei vor.
 *
 * Entfernt wird der KASTEN und nicht nur das Feld darin: An ihm hängt der
 * Zähler. Bliebe er stehen, stünde "0 / 60" ohne Feld darunter.
 *
 * Das input-Ereignis muss von Hand kommen. value zu setzen löst keins aus –
 * der Zähler daneben hörte sonst beim letzten getippten Stand auf und zeigte
 * "37 / 60" über einem leeren Feld.
 */
function pollFormularLeeren() {
  $$('#poll-options > .zaehl-feld').forEach((kasten, idx) => {
    if (idx >= MIN_OPTIONEN) { kasten.remove(); return; }
    const feld = kasten.querySelector('.poll-option');
    feld.value = '';
    feld.dispatchEvent(new Event('input'));
  });
  $('#poll-question').value = '';
  $('#poll-question').dispatchEvent(new Event('input'));
  renderOptionKnoepfe();
  setzeLaufzeit();
}

/**
 * Der Anlegekasten geht auf und wieder zu.
 *
 * Zugeklappt ist der Normalzustand, und zwar aus einem Grund, der beim Bauen
 * leicht untergeht: Ansem sieht diesen Kasten als Einziger, aber er sieht ihn
 * IMMER. Fünf Zeilen über der Liste, auch an den allermeisten Tagen, an denen
 * er gar keine Abstimmung anlegt. Auf dem Handy war damit der halbe Bildschirm
 * weg, bevor die erste Abstimmung anfing.
 *
 * Der Zustand steht als Klasse am Kasten und nicht in einer Variable: Dann
 * kann das Blatt ihn selbst auswerten, und es gibt keinen zweiten Ort, an dem
 * "offen" gespeichert wäre und mit dem ersten auseinanderlaufen könnte.
 *
 * ---------------------------------------------------------------------------
 * Zuklappen ist ein ABBRUCH und kein Wegräumen
 *
 * Hier stand das Zuklappen lange nur für "kleiner machen", und das Getippte
 * blieb liegen. Es kam beim nächsten Öffnen wieder hoch – ein halb
 * ausgefülltes Formular von vorgestern, dessen Frage man erst wieder lesen
 * muss, um zu wissen, ob man sie noch stellen will.
 *
 * Das Zurücksetzen steht deshalb HIER und nicht am Knopf: Es gibt sonst zwei
 * Wege zu, den Knopf und den nach dem Anlegen, und nur einer davon räumt auf.
 * Genau so laufen die beiden auseinander.
 *
 * Ein "Sicher?" gibt es bewusst nicht. Es stünde bei jedem Zuklappen im Weg,
 * auch bei den vielen, bei denen nichts drinsteht – und was verloren geht,
 * sind ein bis vier kurze Zeilen. Der Weg zurück ist, sie noch einmal zu
 * tippen, nicht ein zweiter Klick bei jedem Mal.
 */
function pollFormular(offen) {
  const kasten = $('#poll-admin');
  kasten.classList.toggle('offen', offen);
  $('#poll-admin-felder').hidden = !offen;
  $('#btn-poll-neu').setAttribute('aria-expanded', String(offen));
  // Der Sprung ins erste Feld nur beim Öffnen. Beim Schliessen wäre er ein
  // Sprung ins Nichts – und auf dem Handy risse er die Tastatur hoch.
  if (offen) { $('#poll-question').focus(); return; }
  // Die Laufzeitliste kann offen über dem Kasten stehen. Sie gehört zum
  // Formular und muss mit ihm verschwinden, sonst bleibt sie als Rest hängen.
  lzZu();
  pollFormularLeeren();
}

$('#btn-poll-neu').addEventListener('click', () =>
  pollFormular(!$('#poll-admin').classList.contains('offen')));

/**
 * Wie hoch der Anlegekasten gerade ist – als CSS-Variable am Polls-Tab.
 *
 * Gebraucht wird sie für genau eine Sache: Der Hinweis "No polls yet" soll in
 * der Mitte der SEITE stehen und nicht in der Mitte der Liste. Die beiden sind
 * dasselbe, solange über der Liste nichts steht – und fallen um gut hundert
 * Pixel auseinander, sobald Ansem den Kasten aufklappt. Ohne den Ausgleich
 * rutscht der Satz beim Aufklappen sichtbar nach unten.
 *
 * Ein ResizeObserver und kein Aufruf an den drei, vier Stellen, die die Höhe
 * ändern: Aufklappen, Zuklappen, eine Antwort mehr, eine weniger, ein Umbruch
 * beim Drehen des Geräts – das sind fünf Wege, und beim sechsten vergisst man
 * den Aufruf. Der Beobachter kennt nur einen Fall: Die Höhe hat sich geändert.
 *
 * Der Rand nach unten zählt mit: Zwischen Kasten und Liste steht 1rem, und der
 * schiebt genauso.
 */
function beobachteKopfHoehe() {
  const kasten = $('#poll-admin');
  const tab = $('#pane-polls');
  if (!kasten || !tab || typeof ResizeObserver === 'undefined') return;
  const melde = () => {
    const sichtbar = !kasten.hidden;
    const unten = parseFloat(getComputedStyle(kasten).marginBottom) || 0;
    tab.style.setProperty('--poll-kopf',
      `${sichtbar ? kasten.getBoundingClientRect().height + unten : 0}px`);
  };
  new ResizeObserver(melde).observe(kasten);
  melde();
}
beobachteKopfHoehe();

/**
 * Die Laufzeit im Anlegeformular: Tage, Stunden, Minuten.
 *
 * Vorher stand hier ein einziger Wert in Stunden mit einem Plus und einem
 * Minus daneben, und das war eine Reihe, durch die man sich tippte. Der Weg
 * von einem Tag auf drei waren 48 Tipper.
 *
 * Drei Listen sind nicht nur schneller, sie passen auch dazu, wie jemand über
 * eine Laufzeit nachdenkt: "drei Tage", "zwei Stunden" – nicht "72" oder "2".
 *
 * ---------------------------------------------------------------------------
 * Warum das kein <select> ist
 *
 * Es war eines, zwei Runden lang, und beide Gründe dagegen sind gemessen:
 *
 *   Der Fokusring. Chromium zählt ein <select> nach einem MAUSKLICK als
 *   :focus-visible – wie ein Textfeld, anders als ein Knopf. Die Regel
 *   :focus-visible:not(input):not(textarea) im Blatt greift damit, und um das
 *   Feld lag ein heller Ring, den niemand bestellt hatte. Gemessen:
 *   outline 2px solid nach einem Klick, ohne dass data-tastatur gesetzt war.
 *
 *   Die Klappe. Beim <select> zeichnet sie das Betriebssystem, und ihre Höhe
 *   folgt der Anzahl der Einträge: acht bei Days, vierundzwanzig bei Hours,
 *   sechzig bei Minutes. Drei verschieden hohe Klappen unter drei gleich
 *   aussehenden Kästen – und von hier aus daran kein Griff.
 *
 * Also selbst gebaut: ein <button> (nach einem Klick NICHT focus-visible) und
 * eine eigene Liste, die für alle drei dieselbe Höhe hat und scrollt.
 *
 * Was ein <select> geschenkt mitbringt, steht dafür weiter unten
 * ausgeschrieben: Pfeile, Pos1/Ende, Enter, Escape, Tippen schliesst. Halb
 * gebaut wäre schlimmer als gar nicht – wer eine Klappe aufmacht und dann mit
 * den Pfeilen ins Leere greift, sitzt fest.
 *
 * ---------------------------------------------------------------------------
 * Ohne Frist steht an der richtigen Stelle
 *
 * "Läuft, bis Ansem sie von Hand schliesst" hing vorher als Sonderfall UNTER
 * der kürzesten Laufzeit, weil es in einer Reihe irgendwo hin musste – der
 * Reihenfolge nach gehörte es ans obere Ende, dort war es aber unerreichbar.
 * Der Kommentar an dieser Stelle hat das offen als Kompromiss benannt.
 *
 * Mit drei Feldern gibt es den Kompromiss nicht mehr: Keine Dauer IST keine
 * Frist. Alles auf null heisst kein Ende, und weil das jemand auch versehentlich
 * einstellen kann, steht der Satz darunter, sobald es gilt.
 *
 * ---------------------------------------------------------------------------
 * Die Woche als Obergrenze
 *
 * Sieben Tage waren schon vorher das Maximum, und die Begründung gilt weiter:
 * Darüber ist es keine Abstimmung mehr. Neu ist, dass die Grenze aus drei
 * Feldern zusammen entsteht – 7 Tage plus 6 Stunden wären zu viel.
 *
 * Gelöst wird das mit einer einzigen Regel, dreimal angewendet: Ein Eintrag ist
 * abgeschaltet, wenn er ZUSAMMEN MIT DEN ANDEREN BEIDEN über eine Woche käme.
 * Steht Hours auf 6, ist die 7 bei Days grau. Steht Days auf 7, sind alle
 * Stunden ausser der Null grau.
 *
 * Der Gewinn ist nicht nur Symmetrie: So muss nie eine Zahl nachträglich
 * korrigiert werden. Eine Angabe, die sich nach dem Loslassen von selbst
 * ändert, ist das Unangenehmste, was ein Formular tun kann – man hat etwas
 * eingestellt und etwas anderes steht da. Hier kommt man erst gar nicht in den
 * Zustand hinein, und der Grund steht sichtbar daneben.
 */
const LZ_MAX_MINUTEN = 7 * 24 * 60;   // eine Woche
const LZ_FELDER = [
  { id: 'tage',    max: 7,  faktor: 1440 },
  { id: 'stunden', max: 23, faktor: 60 },
  { id: 'minuten', max: 59, faktor: 1 },
];
const LZ_VORGABE = { tage: 1, stunden: 0, minuten: 0 };

const lzWert = (id) => Number($(`#lz-${id}`).dataset.wert);

/** Die eingestellte Laufzeit in Minuten. 0 heisst: ohne Frist. */
const gewaehlteFristMinuten = () =>
  LZ_FELDER.reduce((summe, f) => summe + lzWert(f.id) * f.faktor, 0);

/**
 * Baut die Einträge einer Liste neu.
 *
 * Jedes Mal vollständig statt einzelne Einträge nachzuziehen: Eine Liste hat
 * höchstens sechzig Zeilen, das kostet nichts – und der Zustand "welcher ist
 * abgeschaltet" kann so nicht mit dem echten auseinanderlaufen.
 */
function lzListe(feld) {
  const knopf = $(`#lz-${feld.id}`);
  const liste = $(`#lz-liste-${feld.id}`);
  const wert = lzWert(feld.id);
  // Was die anderen beiden Felder zusammen schon belegen.
  const rest = LZ_FELDER.filter((f) => f !== feld)
    .reduce((summe, f) => summe + lzWert(f.id) * f.faktor, 0);

  liste.replaceChildren(...Array.from({ length: feld.max + 1 }, (_, i) => {
    const el = document.createElement('div');
    el.id = `lz-${feld.id}-${i}`;
    el.className = 'lz-eintrag';
    el.setAttribute('role', 'option');
    el.textContent = String(i);
    el.dataset.wert = String(i);
    const zuViel = rest + i * feld.faktor > LZ_MAX_MINUTEN;
    // aria-disabled und nicht disabled: Ein <div> kennt kein disabled, und
    // eine Vorlesestimme soll den Eintrag trotzdem nennen – "sieben, nicht
    // verfuegbar" sagt mehr als ein Eintrag, der einfach fehlt.
    if (zuViel) el.setAttribute('aria-disabled', 'true');
    el.setAttribute('aria-selected', String(i === wert));
    return el;
  }));
  knopf.querySelector('.lz-zahl').textContent = String(wert);
}

/** Bringt alle drei Listen und den Hinweis mit dem Zustand in Deckung. */
function renderLaufzeit() {
  for (const feld of LZ_FELDER) lzListe(feld);
  const ohne = gewaehlteFristMinuten() === 0;
  const hinweis = $('#lz-hinweis');
  hinweis.hidden = !ohne;
  hinweis.textContent = ohne ? 'No end — the poll runs until you close it.' : '';
}

/**
 * Setzt alle drei Felder auf einmal.
 *
 * Die Woche wird hier noch einmal durchgesetzt, obwohl die Klappen schon
 * verhindern, dass man sie ueberhaupt ueberschreiten kann. Der Grund ist die
 * Reihenfolge der Zusagen: "Eine Abstimmung laeuft hoechstens eine Woche" ist
 * eine Aussage ueber die LAUFZEIT, nicht ueber die Bedienung. Stuende sie nur
 * in der Oberflaeche, waere sie beim naechsten zweiten Aufrufer weg – und
 * genau das ist die Sorte Luecke, die niemand bemerkt, weil nichts kaputt
 * aussieht.
 *
 * Gekuerzt wird von unten: erst die Minuten, dann die Stunden. Wer sieben Tage
 * angibt, meint die sieben Tage; der Rest ist das, was zu viel war.
 */
function setzeLaufzeit(werte = LZ_VORGABE) {
  let uebrig = LZ_MAX_MINUTEN;
  for (const feld of LZ_FELDER) {
    const gewuenscht = Math.min(feld.max, Math.max(0, Math.round(werte[feld.id] ?? 0)));
    const passt = Math.min(gewuenscht, Math.floor(uebrig / feld.faktor));
    uebrig -= passt * feld.faktor;
    $(`#lz-${feld.id}`).dataset.wert = String(passt);
  }
  renderLaufzeit();
}

// ---------------------------------------------------------------------------
// Die Klappe
// ---------------------------------------------------------------------------

/** Welche Liste gerade offen ist – höchstens eine. */
let lzOffen = null;

function lzZu() {
  if (!lzOffen) return;
  $(`#lz-liste-${lzOffen}`).hidden = true;
  const knopf = $(`#lz-${lzOffen}`);
  knopf.setAttribute('aria-expanded', 'false');
  knopf.removeAttribute('aria-activedescendant');
  lzOffen = null;
}

function lzAuf(id) {
  if (lzOffen === id) return lzZu();
  lzZu();
  lzOffen = id;
  const liste = $(`#lz-liste-${id}`);
  const knopf = $(`#lz-${id}`);
  liste.hidden = false;
  knopf.setAttribute('aria-expanded', 'true');
  lzZeigeAuf(id, lzWert(id));
}

/**
 * Setzt die Marke auf einen Eintrag und rollt ihn ins Bild.
 *
 * Die Marke ist nicht die Auswahl: Sie ist das, worauf die Pfeiltasten gerade
 * zeigen. Erst Enter macht daraus einen Wert. Ohne diese Trennung könnte man
 * mit den Pfeilen nicht durch eine Liste laufen, ohne dabei zu wählen – und
 * jede Bewegung würde die anderen beiden Listen umbauen.
 */
function lzZeigeAuf(id, wert) {
  const liste = $(`#lz-liste-${id}`);
  const ziel = liste.querySelector(`[data-wert="${wert}"]`);
  if (!ziel) return;
  for (const e of liste.children) e.classList.toggle('ist-marke', e === ziel);
  $(`#lz-${id}`).setAttribute('aria-activedescendant', ziel.id);
  // Nur so weit rollen wie nötig – block: 'nearest' laesst die Liste stehen,
  // solange der Eintrag ohnehin zu sehen ist.
  ziel.scrollIntoView({ block: 'nearest' });
}

const lzMarke = (id) => {
  const el = $(`#lz-liste-${id}`).querySelector('.ist-marke');
  return el ? Number(el.dataset.wert) : lzWert(id);
};

/** Einen Wert übernehmen und schliessen. Abgeschaltete Einträge zählen nicht. */
function lzWaehle(id, wert) {
  const eintrag = $(`#lz-liste-${id}`).querySelector(`[data-wert="${wert}"]`);
  if (!eintrag || eintrag.getAttribute('aria-disabled') === 'true') return;
  $(`#lz-${id}`).dataset.wert = String(wert);
  lzZu();
  // Alle drei neu: Der neue Wert verschiebt, was in den anderen beiden noch
  // erlaubt ist.
  renderLaufzeit();
  $(`#lz-${id}`).focus();
}

/**
 * Der nächste WÄHLBARE Eintrag in eine Richtung.
 *
 * Abgeschaltete werden übersprungen statt angesteuert. Auf einem Eintrag zu
 * landen, den Enter dann nicht annimmt, wäre eine Sackgasse mitten in der
 * Liste – man drückt und nichts passiert.
 */
function lzNachbar(id, von, richtung) {
  const liste = $(`#lz-liste-${id}`);
  const alle = [...liste.children]
    .filter((e) => e.getAttribute('aria-disabled') !== 'true')
    .map((e) => Number(e.dataset.wert));
  if (!alle.length) return von;
  if (richtung === 'anfang') return alle[0];
  if (richtung === 'ende') return alle[alle.length - 1];
  const weiter = richtung > 0 ? alle.filter((w) => w > von) : alle.filter((w) => w < von);
  if (!weiter.length) return von;
  return richtung > 0 ? weiter[0] : weiter[weiter.length - 1];
}

for (const feld of LZ_FELDER) {
  const knopf = $(`#lz-${feld.id}`);
  const liste = $(`#lz-liste-${feld.id}`);

  knopf.addEventListener('click', () => lzAuf(feld.id));

  // Ein Klick auf einen Eintrag. Ueber die Liste und nicht ueber jeden Eintrag
  // einzeln: Die Eintraege werden bei jeder Aenderung neu gebaut, und
  // Zuhoerer, die man an neu gebaute Elemente haengt, vergisst man beim
  // naechsten Umbau.
  liste.addEventListener('click', (e) => {
    const eintrag = e.target.closest('[data-wert]');
    if (eintrag) lzWaehle(feld.id, Number(eintrag.dataset.wert));
  });
  // Die Marke folgt dem Zeiger, damit Maus und Tastatur nicht zwei
  // verschiedene "hier bin ich" zeigen.
  liste.addEventListener('mousemove', (e) => {
    const eintrag = e.target.closest('[data-wert]');
    if (eintrag && eintrag.getAttribute('aria-disabled') !== 'true') {
      lzZeigeAuf(feld.id, Number(eintrag.dataset.wert));
    }
  });

  // Die Tastatur. Das ist der Teil, den ein <select> geschenkt mitbrachte –
  // hier steht er ausgeschrieben, weil eine halb bediente Klappe schlimmer ist
  // als gar keine.
  knopf.addEventListener('keydown', (e) => {
    const offen = lzOffen === feld.id;
    const marke = lzMarke(feld.id);

    if (e.key === 'Escape') {
      if (offen) { e.preventDefault(); lzZu(); }
      return;
    }
    if (e.key === 'Tab') { lzZu(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (offen) lzWaehle(feld.id, marke); else lzAuf(feld.id);
      return;
    }
    const schritt = { ArrowDown: 1, ArrowUp: -1, Home: 'anfang', End: 'ende' }[e.key];
    if (schritt === undefined) return;
    e.preventDefault();
    if (!offen) { lzAuf(feld.id); return; }
    lzZeigeAuf(feld.id, lzNachbar(feld.id, marke, schritt));
  });
}

// Klick daneben schliesst. Auf dem Dokument und in der Blasenphase: Ein Klick
// auf einen anderen Knopf soll die alte Klappe schliessen UND den neuen
// oeffnen, und die Reihenfolge stimmt nur so herum.
document.addEventListener('click', (e) => {
  if (lzOffen && !e.target.closest(`#lz-liste-${lzOffen}`)
      && !e.target.closest(`#lz-${lzOffen}`)) lzZu();
});

setzeLaufzeit();

$('#btn-create-poll').addEventListener('click', async () => {
  const question = $('#poll-question').value.trim();
  const options = $$('.poll-option').map((i) => i.value.trim()).filter(Boolean);
  if (!question) return toast('Question is missing', true);
  if (options.length < MIN_OPTIONEN) {
    return toast(`At least ${MIN_OPTIONEN} options are required`, true);
  }

  // Die Frist wird HIER gerechnet, aus der Uhr des Geräts, und als fester
  // Zeitpunkt gespeichert – nicht als Dauer, die die Datenbank später
  // auslegen müsste. "Läuft 24h" heisst 24 Stunden ab dem Anlegen; ein
  // gespeicherter Zeitpunkt kann danach von nichts mehr verschoben werden.
  //
  // 0 heisst ausdrücklich null: eine Abstimmung ohne Frist, die nur von Hand
  // zugeht. Das war vor der Frist der einzige Fall, deshalb muss er weiter
  // erreichbar bleiben.
  const minuten = gewaehlteFristMinuten();
  const closes_at = minuten > 0
    ? new Date(Date.now() + minuten * 60_000).toISOString()
    : null;

  const { data, error } = await state.db.from('polls').insert({ question, closes_at })
    .select().single();
  if (error) return toast(error.message, true);

  const { error: optErr } = await state.db.from('poll_options')
    .insert(options.map((label, idx) => ({ poll_id: data.id, label, idx })));
  if (optErr) {
    await state.db.from('polls').delete().eq('id', data.id);
    return toast(optErr.message, true);
  }

  // Und wieder zu. Die Abstimmung steht ab jetzt in der Liste darunter – das
  // ist es, was Ansem nach dem Anlegen sehen will, nicht ein leeres Formular.
  //
  // Das Leeren steckt im Zuklappen: Hier stand es einmal ausgeschrieben, und
  // der Knopf, der den Kasten zuklappt, hatte seine eigene Fassung davon –
  // nämlich gar keine. Ein Formular, das sich auf ZWEI Wegen schliessen lässt
  // und nur auf einem aufräumt, räumt irgendwann auf keinem mehr auf.
  //
  // Auch die Laufzeit geht dabei zurück auf die Vorgabe. Sie stehen zu lassen
  // wäre die freundlichere Annahme – "er will wohl wieder 7 Tage" –, aber das
  // Formular sähe dann aus wie ein halb ausgefülltes: Frage leer, Antworten
  // leer, und eine Einstellung, die noch von der letzten Abstimmung stammt.
  pollFormular(false);
  await loadPolls();
  toast('Poll started');

  // Erst nach loadPolls(): Vorher gibt es die Abstimmung im Zustand noch
  // nicht, und das Bild braucht die fertigen Antworten samt Nullzahlen.
  //
  // Genau diese Nullzahlen sind der Punkt: So sieht die Karte aus, die später
  // unter jedem geteilten Link steht. Sie wird nie wieder überschrieben.
  const frisch = state.polls.find((x) => x.id === data.id);
  if (frisch) ladeOgBildHoch(frisch);
});

// ---------------------------------------------------------------------------
// DMs
// ---------------------------------------------------------------------------

async function loadDms() {
  $('#dm-user').hidden = state.me.isAdmin;
  $('#dm-admin').hidden = !state.me.isAdmin;

  // Die Schwelle kann Ansem jederzeit ändern. Wer den Tab öffnet, soll nicht
  // gegen einen Wert von vor einer Stunde geprüft werden und erst beim
  // Absenden erfahren, dass er zu niedrig war. Eine Zeile, eine Abfrage.
  await refreshDmMin();

  if (!state.me.isAdmin) {
    const rows = unwrap(await state.db.from('dms').select('*').order('id'));
    state.dmMessages = rows;
    pruefeDmAntworten(rows);
    // Bezog sich die offene Antwort auf etwas, das es nicht mehr gibt, muss
    // sie weg – sonst zeigt die Leiste auf eine gelöschte Nachricht.
    if (state.dmReplyTo && !rows.some((r) => r.id === state.dmReplyTo)) clearDmReply();
    const box = $('#dm-thread');
    box.innerHTML = rows.length
      ? dmListeHtml(rows)
      : '<div class="empty">No messages yet. Write to Ansem directly.</div>';
    scrollBottom(box);
    return;
  }

  renderDmMin();

  // Im Demomodus wird gar nicht geladen – siehe DEMO_DMS ganz oben.
  const threads = DEMO_DMS
    ? demoThreads(DEMO_DMS)
    : unwrap(await state.db.from('dm_threads').select('*').order('tokens', { ascending: false }));
  state.dmThreads = threads;
  pruefeVerbergen(threads);

  renderThreads();
}

/**
 * Kennt die Datenbank das Verbergen schon?
 *
 * Dasselbe Muster wie bei pruefeDmAntworten() daneben, und aus demselben
 * Grund: Das Blatt und app.js liegen auf einem Webspace, die Migration in
 * Supabase – die beiden werden von Hand hochgeladen und sind deshalb
 * zwangslaeufig manchmal ungleich alt. Fuer eine Weile laeuft eine neue
 * Oberflaeche auf einer alten Datenbank.
 *
 * Ohne diese Pruefung sah das so aus: Der Knopf "Hide" stand da, ein Druck
 * darauf brachte "Could not find the table 'public.dm_hidden' in the schema
 * cache" – eine Meldung aus dem Maschinenraum, mitten in der Oberflaeche, fuer
 * einen Knopf, den die Seite selbst angeboten hat.
 *
 * Erkannt wird es an der Spalte, die die neue Ansicht mitliefert. Fehlt sie,
 * ist die Migration noch nicht eingespielt, und der Knopf erscheint gar nicht
 * erst. Bei leerem Posteingang bleibt der letzte bekannte Stand stehen – die
 * Frage laesst sich dann nicht beantworten, und "nicht anbieten" ist die
 * sichere Antwort.
 */
function pruefeVerbergen(threads) {
  if (DEMO_DMS) { state.dmHideAvailable = true; return; }
  if (threads?.length) state.dmHideAvailable = 'hidden' in threads[0];
}

/**
 * Zeichnet den Posteingang aus state.dmThreads.
 *
 * Eigene Funktion, weil sie nicht nur beim Laden gebraucht wird: Öffnet Ansem
 * einen Faden, sind dessen Nachrichten damit gelesen, und die rote Zahl muss
 * sofort verschwinden. Vorher tat sie das erst beim nächsten vollständigen
 * Neuladen – man klickte also auf einen Faden und die Zahl blieb stehen, als
 * hätte der Klick nichts bewirkt.
 */
function renderThreads() {
  const alle = state.dmThreads ?? [];

  // Wer weniger hält als die Schwelle, taucht nicht mehr auf. Gelöscht wird
  // dabei nichts – senkt Ansem die Schwelle wieder, sind die Gespräche samt
  // Verlauf zurück. Die Leute selbst sehen ihren Faden weiterhin, können aber
  // nichts Neues schreiben; das entscheidet die Datenbank beim Einfügen, nicht
  // diese Ansicht.
  // Beim Tippen gilt schon die getippte Zahl, ohne Bestätigung.
  const min = Number(state.dmMinEntwurf ?? state.cfg.min_dm_usd ?? 0);
  const ueberSchwelle = min > 0 ? alle.filter((t) => Number(t.usd) >= min) : alle;

  // Hier stand eine Zeile, die zaehlte, wie viele Gespraeche die Schwelle
  // gerade ausblendet. Sie ist raus: Der Regler steht direkt darueber und sagt
  // dieselbe Sache besser. Wer "$1,000" liest, weiss, dass gefiltert wird – die
  // Zahl daneben war eine zweite Auskunft ueber dieselbe Einstellung, und sie
  // stand ausgerechnet ueber der Zeile, die eine ANDERE Auskunft gibt.

  // ---------------------------------------------------------------------
  // Von Hand verborgene Gespraeche
  //
  // Zwei Arten, aus der Liste zu verschwinden, und nur EINE bekommt eine
  // Zeile:
  //
  //   die SCHWELLE ist eine Regel, und sie steht als Zahl im Regler darueber.
  //   Wer sie senkt, sieht die Gespraeche wiederkommen – dafuer braucht es
  //   keinen Zaehler, der dasselbe noch einmal sagt.
  //
  //   VERBERGEN ist eine Entscheidung ueber genau eine Person, und sie ist
  //   nirgends sonst abzulesen. Sie bleibt, bis Ansem sie zuruecknimmt – auch
  //   wenn derjenige weiterschreibt. Ohne diese Zeile waere das eine
  //   Sackgasse: Er wuesste nicht mehr, dass es die Gespraeche gibt.
  //
  // Gezaehlt wird deshalb nur ueber der Schwelle. Wer ohnehin darunter liegt,
  // taucht auch ohne Verbergen nicht auf – ihn hier mitzuzaehlen hiesse, eine
  // Zahl zu nennen, die sich beim Senken der Schwelle von selbst aendert.
  const verborgene = state.dmHideAvailable
    ? ueberSchwelle.filter((t) => t.hidden) : [];
  // Der Schalter zeigt die verborgenen ANSTATT der anderen, nicht dazwischen.
  //
  // Zuerst standen sie gemischt in der Liste, gedaempft. Das las sich falsch:
  // Wer nachsieht, wen er weggenommen hat, sucht dann in vierzig Zeilen nach
  // dreien – und die Daempfung war die einzige Auskunft darueber, welche
  // gemeint sind. Umgeschaltet wird deshalb die ganze Liste; man ist entweder
  // im Posteingang oder in dem, was man weggeraeumt hat.
  // Kennt die Datenbank das Verbergen nicht, gibt es die Ansicht nicht. Das
  // ist der einzige Fall, in dem sie von selbst zugeht.
  if (state.zeigeVerborgene && !state.dmHideAvailable) state.zeigeVerborgene = false;

  const threads = state.zeigeVerborgene
    ? verborgene
    : ueberSchwelle.filter((t) => !t.hidden);

  // Die Zeile bleibt stehen, auch wenn nichts mehr verborgen ist – solange man
  // in dieser Ansicht steht. Sonst ist sie eine Sackgasse: Wer das letzte
  // Gespraech zurueckholt, sieht "Inbox is empty" und hat keinen Knopf mehr,
  // um in den echten Posteingang zurueckzukommen.
  //
  // Hier stand stattdessen ein Ruecksprung – bei null Verborgenen ging die
  // Ansicht von selbst zu. Der war schon deshalb wirkungslos, weil er UNTER
  // der Zeile stand, die die Liste zusammenstellt: gezeigt wurde noch die
  // leere, und erst der naechste Aufruf haette es gemerkt.
  //
  // Er waere aber auch dann falsch gewesen. Zurueckholen ist ein Klick auf
  // eine Zeile, und die ganze Liste unter der Hand auszutauschen, weil es die
  // letzte war, ist eine Bewegung, die man nicht ausgeloest hat. Wer fertig
  // ist, geht ueber denselben Knopf zurueck, ueber den er hergekommen ist.
  const vBox = $('#thread-versteckt');
  vBox.hidden = !state.dmHideAvailable
    || (verborgene.length === 0 && !state.zeigeVerborgene);
  if (!vBox.hidden) {
    // Der Text sagt, WAS man gerade sieht – nicht immer dasselbe. Im
    // Verborgen-Modus steht die Liste darunter fuer etwas anderes, und eine
    // Zeile, die das verschweigt, laesst einen den Posteingang fuer leer
    // halten.
    // Auch die 0 wird ausgeschrieben: "Showing 0 hidden conversations" ist
    // die Auskunft, die zur leeren Liste darunter gehoert.
    $('#thread-versteckt-zahl').textContent = state.zeigeVerborgene
      ? (verborgene.length === 1
        ? 'Showing 1 hidden conversation'
        : `Showing ${verborgene.length} hidden conversations`)
      : (verborgene.length === 1
        ? '1 conversation hidden by you'
        : `${verborgene.length} conversations hidden by you`);
    // Der Knopf sagt, was er TUT, nicht in welchem Zustand die Liste ist:
    // "Show" heisst, dass ein Druck sie zeigt. Ein Schalter, der den Zustand
    // benennt, liest sich in der Haelfte der Faelle als das Gegenteil.
    $('#btn-versteckt').textContent = state.zeigeVerborgene ? 'Back' : 'Show';
    $('#btn-versteckt').setAttribute('aria-expanded', String(Boolean(state.zeigeVerborgene)));
  }

  // Eine Zeile pro Gespräch: Kürzel, Vorschau, Betrag. Sortiert nach Bestand,
  // von oben nach unten – die Reihenfolge ist die einzige Ordnung, die es
  // braucht. Keine Abschnitte, kein farbiger Strich für das offene Gespräch:
  // Eine Auswahl ist nicht wichtig, sie ist nur ausgewählt. Dafür reicht eine
  // hellere Fläche.
  //
  // Ungeöffnete Gespräche liegen auf einer schwach blauen Fläche und ihre
  // Vorschau steht eine Stufe heller. Zwei Anzeichen für denselben Zustand,
  // aber beide leise – und keins davon ein eigenes Zeichen in der Zeile: Rote
  // Blase, Punkt und Strich waren durch, und alle drei behaupteten Dringlichkeit
  // statt bloß "noch nicht gelesen".
  //
  // Blau, weil Helligkeit schon vergeben ist: Die hellere Fläche bedeutet
  // "geöffnet". Wären beide Zustände Helligkeiten, wären sie verwechselbar –
  // so ist Farbe der eine, Helligkeit der andere.
  //
  // Deshalb steht die Regel im Stylesheet auch vor :hover und .is-active: alle
  // drei sind gleich spezifisch, die Reihenfolge entscheidet, und ein Gespräch,
  // das gerade offen ist, soll offen aussehen und nicht ungelesen.
  //
  // Hat Ansem zuletzt geschrieben, steht "You:" vor der Vorschau.
  //
  // Das war schon einmal da und wieder raus, mit der Begruendung: In einer
  // Liste aus Kuerzeln, Text und Betraegen ist es ein vierter Bestandteil, und
  // die Zeile wird davon unruhig. Das Argument war richtig – fuer die Zeile,
  // wie sie damals aussah. Inzwischen endet die Vorschau nach 16 Zeichen, und
  // rechts davon steht Luft; der Platz ist da.
  //
  // Und die Auskunft ist mehr wert, als sie damals schien: Ohne sie liest sich
  // die eigene letzte Antwort wie eine neue Nachricht des anderen. Bei
  // vierzig Gespraechen, von denen die meisten beantwortet sind, ist genau das
  // die haeufigste Zeile.
  //
  // Es steht als eigenes Element vor der Vorschau und nicht in ihrem Text: So
  // frisst es die 16 Zeichen nicht auf, und es kann eine eigene Farbe tragen.
  //
  // Einzeilig statt zweizeilig, weil bei fünfzig Gesprächen die Liste sonst
  // fünf Bildschirme lang ist.
  $('#thread-items').innerHTML = threads.length ? threads.map((t) => `
    <button class="thread ${Number(t.unread) > 0 ? 'is-unread' : ''} ${state.activeThread === t.wallet ? 'is-active' : ''} ${t.hidden ? 'ist-verborgen' : ''}"
            data-wallet="${esc(t.wallet)}" title="${esc(t.wallet)}">
      <span class="h t${toneOf(t.wallet)}">${esc(handleOf(t.wallet))}</span>
      ${t.last_from_admin ? '<span class="thread-du">You:</span>' : ''}
      <span class="thread-prev">${esc(t.preview)}</span>
      <span class="w">${kurzUsd(Number(t.usd))}</span>
    </button>`).join('')
    // Leer heisst hier zweierlei. In der Verborgen-Ansicht ist der Posteingang
    // NICHT leer – er steht nur gerade woanders, einen Knopf entfernt. Der
    // alte Satz behauptete an dieser Stelle das Gegenteil dessen, was die
    // Zeile darueber sagt.
    : (state.zeigeVerborgene
      ? '<div class="empty">Nothing hidden any more.</div>'
      : '<div class="empty">Inbox is empty.</div>');

  $$('#thread-items .thread').forEach((b) =>
    b.addEventListener('click', () => openThread(b.dataset.wallet, true)));
}

/**
 * Wessen Nachricht zitiert wird – als Kürzel.
 *
 * Nur zwei Beteiligte, also gibt es genau zwei Antworten: Ansem oder die
 * andere Seite. Wer "die andere Seite" ist, hängt davon ab, wer zusieht –
 * für Ansem der Faden, den er offen hat, für alle anderen sie selbst.
 */
const dmAutor = (q) => handleOf(q.from_admin
  ? state.cfg.admin_wallet
  : (state.me.isAdmin ? state.activeThread : state.me.wallet));

/**
 * Das Zitat über einer DM-Antwort.
 *
 * Ohne Namen: In einem Gespräch mit genau zwei Beteiligten sagt er nichts, was
 * man nicht ohnehin weiß, und nimmt dem eigentlichen Text die Breite.
 *
 * Es braucht keinen Nachladeweg: Ein Gespräch wird immer vollständig
 * geladen, die zitierte Nachricht liegt also bereits vor. Fehlt
 * sie doch, wurde sie gelöscht – und dann soll dort auch nichts stehen, was
 * sie wiederherstellt.
 */
function dmQuoteHtml(row) {
  if (!row.reply_to) return '';
  const q = state.dmMessages.find((x) => x.id === row.reply_to);
  if (!q) return `<span class="quote is-gone">Original message is gone</span>`;

  const text = q.body.length > 120 ? q.body.slice(0, 120) + '…' : q.body;
  return `<span class="dm-antwort-kopf" aria-hidden="true">↩ ${esc(dmAutor(q))}</span>
    <button class="quote" type="button" data-dm-goto="${q.id}">
      <span class="quote-body">${esc(text)}</span>
    </button>`;
}

/**
 * Baut den Verlauf mit Datumstrennern.
 *
 * Der Vergleich läuft über den Tagesbeginn, nicht über die Zeichenkette des
 * Datums: Eine Nachricht um 23:58 und die Antwort um 00:03 gehören zu
 * verschiedenen Tagen, obwohl nur fünf Minuten dazwischen liegen – genau
 * dafür ist der Trenner da.
 */
function dmListeHtml(rows) {
  let letzterTag = null;
  const out = [];
  for (const r of rows) {
    const tag = tagBeginn(new Date(r.created_at));
    if (tag !== letzterTag) {
      out.push(`<div class="day-sep"><span>${esc(tagLabel(r.created_at))}</span></div>`);
      letzterTag = tag;
    }
    out.push(dmHtml(r));
  }
  return out.join('');
}

/**
 * Eine DM.
 *
 * Das Zitat steht AUSSERHALB der Blase, darüber – so macht es X, und danach
 * ist dieser Teil gebaut. Der Unterschied ist nicht bloss Geschmack: In der
 * Blase musste sich das Zitat gegen deren Grund absetzen, und weil die eigene
 * Blase hell ist und die eingehende dunkel, brauchte es dafür zwei
 * Sonderregeln, die sich gegenseitig widersprachen. Darüber gestellt liegt es
 * für beide Seiten auf demselben Grund und kommt mit einer Regel aus.
 *
 * Die drei Teile stehen deshalb in einer eigenen Spalte (.dm-block): Kopfzeile,
 * Zitatblase, Nachricht. Der Antwortpfeil bleibt daneben.
 */
function dmHtml(row) {
  const mine = state.me.isAdmin ? row.from_admin : !row.from_admin;
  return `<div class="dm-row ${mine ? 'mine' : ''}" data-id="${row.id}">
      <div class="dm-block${row.reply_to ? ' has-quote' : ''}">
        ${dmQuoteHtml(row)}
        <div class="msg dm ${mine ? 'mine' : ''}">
          <span class="body">${mitLinks(row.body)}</span>
          <span class="meta"><span class="time">${fmtTime(row.created_at)}</span></span>
        </div>
      </div>
      <button class="reply-btn" type="button"
        data-dm-reply="${row.id}" title="Reply" aria-label="Reply">↩</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Antworten in DMs
// ---------------------------------------------------------------------------

/** Die beiden Gesprächsansichten – für Ansem die eine, für alle anderen die andere. */
const dmTeile = () => state.me.isAdmin
  ? { box: '#admin-thread', bar: '#admin-reply-bar', who: '#admin-reply-bar-who',
      text: '#admin-reply-bar-text', input: '#admin-dm-input', pane: '#dm-admin' }
  : { box: '#dm-thread', bar: '#dm-reply-bar', who: '#dm-reply-bar-who',
      text: '#dm-reply-bar-text', input: '#dm-input', pane: '#dm-user' };

function setDmReply(id) {
  const q = state.dmMessages.find((x) => x.id === id);
  if (!q || !state.dmRepliesAvailable) return;
  const t = dmTeile();
  state.dmReplyTo = id;
  // Kein Name, wie im Zitat: zwei Beteiligte, da sagt er nichts.
  $(t.text).textContent = q.body;
  $(t.bar).hidden = false;
  $(t.input).focus();
}

function clearDmReply() {
  state.dmReplyTo = null;
  $('#dm-reply-bar').hidden = true;
  $('#admin-reply-bar').hidden = true;
}

/** Springt zur zitierten Nachricht und lässt sie kurz aufleuchten. */
function gotoDm(id) {
  const zeile = $(`${dmTeile().box} .dm-row[data-id="${id}"]`);
  const blase = zeile?.querySelector('.msg');
  if (!blase) return;
  zeile.scrollIntoView({ block: 'center', behavior: 'smooth' });
  blase.classList.remove('flash');
  void blase.offsetWidth;
  blase.classList.add('flash');
}

/**
 * Ein Klickhandler für beide Gesprächsansichten.
 *
 * Am Schreibtisch erscheint der Pfeil beim Überfahren, auf dem Handy durch
 * Antippen der Nachricht. Wer gerade Text markiert hat, wollte
 * nicht antippen – sonst verschwände die Auswahl beim Loslassen sofort wieder.
 */
for (const sel of ['#dm-thread', '#admin-thread']) {
  $(sel).addEventListener('click', (e) => {
    const rep = e.target.closest?.('[data-dm-reply]');
    if (rep) { setDmReply(Number(rep.dataset.dmReply)); return; }

    const goto = e.target.closest?.('[data-dm-goto]');
    if (goto) { gotoDm(Number(goto.dataset.dmGoto)); return; }

    // Und sonst passiert beim Antippen NICHTS.
    // -----------------------------------------------------------------------
    // Hier schaltete ein Tipp die Zeile auf "aktiv" und liess damit den
    // Antwortpfeil erscheinen. Das war der Weg zur Antwort, bevor es das
    // Wischen gab, und ist seitdem einer zu viel: Ein Tipp auf eine Nachricht
    // ist die haeufigste Beruehrung ueberhaupt – beim Rollen, beim Zielen auf
    // etwas anderes, beim blossen Hinsehen –, und jedes Mal sprang ein Pfeil
    // ins Bild, den niemand gerufen hat.
    //
    // Geantwortet wird durch Wischen. Am Rechner erscheint der Pfeil beim
    // Ueberfahren mit der Maus (.dm-row:hover), das bleibt.
  });
}

// ---------------------------------------------------------------------------
// Am Finger: lange draufhalten und nach links wischen
// ---------------------------------------------------------------------------
//
// Vorher gab es auf dem Handy nur einen Weg zu einer Antwort: die Nachricht
// antippen, damit der Pfeil erscheint, dann den Pfeil treffen. Zwei Tipper auf
// ein Ziel von 44 px – und wer stattdessen lange draufhielt, bekam eine
// Textmarkierung und das Menue von iOS.
//
// Jetzt wie in den DMs bei X: nach rechts wischen antwortet direkt, der Pfeil
// taucht dabei auf, und am Anschlag brummt es einmal.
//
// Ein kleines Fenster beim langen Draufhalten ("Reply / Copy") gab es hier
// eine Runde lang und ist auf Wunsch wieder weg.
//
// Nur am Finger. Am Rechner bleibt alles, wie es war – dort gibt es Hover
// fuer den Pfeil und Markieren fuer den Text.

const WISCH_START_PX = 12;    // ab hier ist es ein Wisch und kein Zittern
// Der Weg war 64 px und ist auf 44 gekuerzt: So weit muss der Daumen gar nicht
// wandern, damit die Geste eindeutig ist, und die Blase verlaesst dabei ihren
// Platz nicht so weit, dass die Zeile unruhig wirkt.
const WISCH_MAX_PX = 44;      // so weit laesst sich die Blase ziehen
const WISCH_SCHWELLE_PX = 32; // ab hier zaehlt der Wisch als Antwort

/**
 * Der Zustand einer laufenden Beruehrung.
 *
 * Ein einziges Objekt und keins je Zeile: Es gibt genau einen Finger, der
 * gerade etwas tut. Zwei gleichzeitig sind kein Wisch, sondern ein Zoom – die
 * werden unten ausgeschlossen.
 */
let griff = null;


/** Die Blase zurueck an ihren Platz, egal wie der Wisch ausging. */
function wischZurueck(g) {
  if (!g?.block) return;
  g.zeile.classList.remove('wischt');
  g.block.style.transform = '';
  const pfeil = g.zeile.querySelector('.reply-btn');
  if (pfeil) pfeil.style.opacity = '';
}

for (const sel of ['#dm-thread', '#admin-thread']) {
  const box = $(sel);

  box.addEventListener('touchstart', (e) => {
    // Zwei Finger sind kein Wisch, sondern ein Zoom.
    if (e.touches.length !== 1) { wischZurueck(griff); griff = null; return; }
    const zeile = e.target.closest?.('.dm-row');
    if (!zeile) return;
    const id = Number(zeile.dataset.id);
    if (!id) return;

    const t = e.touches[0];
    griff = {
      zeile, id, block: zeile.querySelector('.dm-block'),
      x: t.clientX, y: t.clientY, zieht: false,
    };
  }, { passive: true });

  // passive: false, weil beim Wischen preventDefault gebraucht wird – sonst
  // rollt die Liste mit, waehrend die Blase am Finger haengt.
  box.addEventListener('touchmove', (e) => {
    if (!griff || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - griff.x;
    const dy = t.clientY - griff.y;

    if (!griff.zieht) {
      // Erst entscheiden, WAS das hier wird, und bis dahin nichts abfangen:
      // Ein senkrechter Wisch ist Rollen und muss weiter rollen duerfen. Der
      // Faktor 1.5 sorgt dafuer, dass ein schraeger Wisch als Rollen gilt –
      // im Zweifel gehoert die Bewegung der Liste, nicht uns.
      if (dx > WISCH_START_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        griff.zieht = true;
        griff.zeile.classList.add('wischt');
      } else if (Math.abs(dy) > WISCH_START_PX) {
        // Eindeutig senkrecht: Der Griff ist damit erledigt.
        wischZurueck(griff);
        griff = null;
        return;
      } else {
        return;
      }
    }

    e.preventDefault();
    // Nur nach rechts, und nur bis WISCH_MAX_PX. Ohne die Klammer liesse sich
    // die Blase ueber den Bildrand hinausziehen.
    const weg = Math.min(WISCH_MAX_PX, Math.max(0, dx));
    griff.block.style.transform = `translateX(${weg}px)`;
    const pfeil = griff.zeile.querySelector('.reply-btn');
    // Der Pfeil taucht mit dem Finger auf, nicht auf einen Schlag: So sieht
    // man vor dem Loslassen, dass die Geste erkannt wurde.
    if (pfeil) pfeil.style.opacity = String(Math.min(1, weg / WISCH_SCHWELLE_PX));

    // Am Anschlag einmal kurz brummen – und nur einmal, deshalb der Merker.
    // Das ist die Rueckmeldung, die der Daumen bekommt, wenn die Blase nicht
    // weiter geht: Ab hier ist die Antwort sicher, man kann loslassen.
    //
    // navigator.vibrate gibt es auf Android; Safari auf dem iPhone kennt es
    // NICHT und ignoriert den Aufruf stillschweigend. Dort bleibt es beim
    // sichtbaren Anschlag. Ein anderer Weg dafuer steht einer Webseite auf
    // iOS nicht offen.
    if (weg >= WISCH_MAX_PX && !griff.gebrummt) {
      griff.gebrummt = true;
      navigator.vibrate?.(8);
    }
  }, { passive: false });

  const losgelassen = () => {
    if (!griff) return;
    const g = griff;
    griff = null;
    if (!g.zieht) return;
    const weg = Math.abs(parseFloat(
      (g.block.style.transform.match(/-?[\d.]+/) ?? [0])[0]));
    wischZurueck(g);
    if (weg >= WISCH_SCHWELLE_PX) setDmReply(g.id);
  };
  box.addEventListener('touchend', losgelassen, { passive: true });
  box.addEventListener('touchcancel', () => { wischZurueck(griff); griff = null; }, { passive: true });

  // Nach einem Wisch folgt ein click. Der wuerde die Zeile umschalten, als
  // haette man sie angetippt. Deshalb wird er hier abgefangen, bevor der
  // Handler weiter unten ihn sieht (capture).
  box.addEventListener('click', (e) => {
    if (griff?.zieht) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

$$('.btn-cancel-dm-reply').forEach((b) => b.addEventListener('click', clearDmReply));
for (const sel of ['#dm-input', '#admin-dm-input']) {
  $(sel).addEventListener('keydown', (e) => { if (e.key === 'Escape') clearDmReply(); });
}

/**
 * Merkt sich, ob die Datenbank die Antwort-Spalte schon kennt.
 *
 * Liegt das Frontend vor der Migration, fehlt reply_to in den Zeilen. Dann
 * verschwindet der Antwortknopf, statt einen Bezug anzubieten, den das
 * Einfügen später ablehnt.
 */
function pruefeDmAntworten(rows) {
  if (rows.length) state.dmRepliesAvailable = 'reply_to' in rows[0];
  $('#dm-user').classList.toggle('no-replies', !state.dmRepliesAvailable);
  $('#dm-admin').classList.toggle('no-replies', !state.dmRepliesAvailable);
}

/**
 * Zeichnet Kopfzeile und Verlauf eines Gesprächs. Rein aus dem Speicher,
 * ohne Netz – damit ein Wechsel sofort sichtbar ist.
 */
function renderThread(wallet, rows) {
  state.dmMessages = rows;
  pruefeDmAntworten(rows);

  // Kein Betrag in dieser Leiste. Er steht in der Liste links, direkt in der
  // Zeile, aus der man das Gespräch geöffnet hat – ihn hier zu wiederholen
  // sagt nichts Neues und macht aus einer Kopfzeile eine zweite Anzeige.
  $('#thread-title').innerHTML =
    `<strong class="h t${toneOf(wallet)}">${esc(handleOf(wallet))}</strong>`
    + `<span class="addr dim">${esc(wallet)}</span>`;

  // Der Verbergen-Knopf sagt, was ein Druck TUT, und nicht, in welchem
  // Zustand das Gespraech ist: Bei einem verborgenen steht "Unhide".
  const verborgen = Boolean(state.dmThreads?.find((t) => t.wallet === wallet)?.hidden);
  const knopf = $('#btn-hide-thread');
  // Nicht anbieten, was die Datenbank noch nicht kann – siehe pruefeVerbergen().
  knopf.hidden = !state.dmHideAvailable;
  knopf.textContent = verborgen ? 'Unhide' : 'Hide';
  knopf.title = verborgen
    ? 'Put this conversation back in the inbox'
    : 'Take this conversation out of your inbox';

  const box = $('#admin-thread');
  box.innerHTML = dmListeHtml(rows);
  scrollBottom(box);
  $('#admin-dm-form').hidden = false;
  $$('#thread-items .thread').forEach((b) => b.classList.toggle('is-active', b.dataset.wallet === wallet));
}

/**
 * Öffnet ein Gespräch.
 *
 * Der Punkt hier ist die Reihenfolge. Vorher wurde zuerst die Netzantwort
 * abgewartet und erst danach etwas gezeichnet – jeder Klick auf einen Faden
 * kostete also eine volle Runde zum Server, bevor sich überhaupt etwas
 * bewegte. Beim Hin- und Herspringen zwischen zwei Gesprächen war das jedes
 * Mal dieselbe Wartezeit, obwohl die Daten längst dagewesen waren.
 *
 * Jetzt: Ist das Gespräch schon einmal geladen worden, wird es sofort aus dem
 * Speicher gezeichnet. Die frische Abfrage läuft danach im Hintergrund und
 * zeichnet nur nach, wenn sich wirklich etwas geändert hat – sonst würde die
 * Ansicht bei jedem Wechsel grundlos flackern und ans Ende springen.
 *
 * Beim ersten Öffnen eines Fadens bleibt eine Wartezeit; die ist unvermeidbar,
 * die Nachrichten sind noch nicht da. Danach nicht mehr.
 *
 * @param {boolean} reveal  Nur beim Antippen durch Ansem selbst. Beim
 *   Nachladen wegen einer eingehenden Nachricht darf sich das Gespräch nicht
 *   von allein über den Posteingang schieben – sonst springt ihm die Ansicht
 *   unter dem Daumen weg, während er die Liste durchgeht.
 */
async function openThread(wallet, reveal = false) {
  const gewechselt = state.activeThread !== wallet;
  state.activeThread = wallet;
  if (reveal) $('#dm-admin').classList.add('viewing');
  // Ein Bezug gilt immer nur innerhalb eines Gesprächs – die Datenbank lehnt
  // alles andere ab. Beim Wechsel also verwerfen statt mitschleppen.
  if (gewechselt) clearDmReply();

  const bekannt = state.dmCache.get(wallet);
  if (bekannt) renderThread(wallet, bekannt);

  // Gelesen markieren ist eine Nebensache und darf das Zeichnen nicht
  // aufhalten – deshalb ohne await. Der Punkt verschwindet trotzdem sofort;
  // markiereGelesen() setzt den Zaehler erst lokal und schickt danach.
  //
  // Es steht VOR dem Demo-Ausstieg darunter, und das ist keine Kosmetik: Stand
  // es dahinter, blieb der Punkt im Demomodus fuer immer stehen – man klickte
  // ein ungelesenes Gespraech an, las es, und die Liste behauptete weiter, da
  // sei etwas offen. Genau so ist es aufgefallen.
  markiereGelesen(wallet);

  // Im Demomodus gibt es die Gespraeche nicht – also auch nichts zu laden.
  // Ein paar erfundene Zeilen, damit der Verlauf nicht leer ist und der
  // Verbergen-Knopf ein Ziel hat.
  if (DEMO_DMS) {
    const zeile = state.dmThreads?.find((t) => t.wallet === wallet);

    // Die letzte Zeile ist die Vorschau, und sie kommt von dem, den die Liste
    // nennt. Hier stand fest verdrahtet Ansem mit "will look at it" – in jedem
    // Gespraech, auch in denen ohne "You:" davor, und die Vorschau lag eine
    // Zeile darueber. Die Liste sagte also das eine, das geoeffnete Gespraech
    // das andere, und beim Vergleichen zweier Entwuerfe der Liste haette man
    // sich auf beides berufen koennen.
    const duZuletzt = !!zeile?.last_from_admin;
    const zeit = (ms) => new Date(Date.now() - ms).toISOString();
    const rows = [
      { id: 1, wallet, from_admin: false, body: 'hey', created_at: zeit(9e6) },
      { id: 2, wallet, from_admin: duZuletzt ? false : true,
        body: duZuletzt ? 'can you look at this' : 'whats up', created_at: zeit(8e6) },
      { id: 3, wallet, from_admin: duZuletzt, body: zeile?.preview ?? 'gm',
        created_at: zeit(4e6) },
    ];
    state.dmCache.set(wallet, rows);
    renderThread(wallet, rows);
    return;
  }

  const { data, error } = await state.db.from('dms')
    .select('*').eq('wallet', wallet).order('id');
  if (error || !data) {
    if (!bekannt) toast(error?.message ?? 'Could not load the conversation', true);
    return;
  }
  state.dmCache.set(wallet, data);

  // Ein anderer Faden wurde inzwischen angetippt – dann gehört diese Antwort
  // nicht mehr auf den Bildschirm.
  if (state.activeThread !== wallet) return;

  // Nur neu zeichnen, wenn es wirklich etwas Neues gibt.
  if (!bekannt || !gleicheNachrichten(bekannt, data)) renderThread(wallet, data);
}

/** Flacher Vergleich: Kennungen und Textlänge genügen, um Änderungen zu sehen. */
function gleicheNachrichten(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].body !== b[i].body
        || a[i].reply_to !== b[i].reply_to) return false;
  }
  return true;
}

/**
 * Schließt das offene Gespräch.
 *
 * Wird gebraucht, wenn die Schwelle steigt und der gerade geöffnete Faden
 * dadurch aus dem Posteingang fällt: Ein Gespräch offen zu lassen, das in der
 * Liste nicht mehr steht, wäre ein Zustand, aus dem man nicht mehr
 * herausfindet.
 */
function closeThread() {
  state.activeThread = null;
  state.dmMessages = [];
  clearDmReply();
  $('#thread-title').innerHTML = '<span class="dim">Select a thread</span>';
  $('#admin-thread').innerHTML = '';
  $('#admin-dm-form').hidden = true;
  // Auch der Verbergen-Knopf geht weg: Ohne offenes Gespraech haette er kein
  // Ziel, und ein Knopf ohne Ziel liest sich als Defekt.
  $('#btn-hide-thread').hidden = true;
  $('#dm-admin').classList.remove('viewing');
}

/**
 * Hält fest, dass dieser Faden gelesen wurde – erst in der Ansicht, dann in
 * der Datenbank.
 *
 * Die Reihenfolge ist Absicht. Die blaue Fläche verschwindet in dem Moment, in
 * dem angetippt wird, nicht erst wenn der Server geantwortet hat: Beim
 * Durchgehen von fünfzig Gesprächen ist das der Unterschied zwischen einer
 * Liste, die mitgeht, und einer, die hinterherhinkt.
 *
 * Schlägt das Speichern fehl, wird die Markierung zurückgedreht. Das ist die
 * ehrlichere Anzeige: Beim nächsten Laden holt die Liste ihren Stand ohnehin
 * aus der Datenbank, und dort stünde das Gespräch dann wieder als ungelesen.
 * Ohne das Zurückdrehen sähe man einen Zustand, den nur dieser Browser kennt.
 *
 * Gemeldet wird der Fehlschlag nicht: Es gibt nichts, was Ansem daraufhin
 * anders machen würde, und der Faden ist trotzdem offen und lesbar.
 */
async function markiereGelesen(wallet) {
  const eintrag = state.dmThreads?.find((t) => t.wallet === wallet);
  const vorher = eintrag ? Number(eintrag.unread) : 0;
  if (eintrag && vorher > 0) {
    eintrag.unread = 0;
    renderThreads();
  }

  // Im Demomodus gibt es die Nachrichten nicht – der Vermerk waere ein update
  // auf fremde Zeilen. Die Anzeige oben ist schon gesetzt, mehr braucht es
  // hier nicht.
  if (DEMO_DMS) return;

  const { error } = await state.db.from('dms').update({ read_by_admin: true })
    .eq('wallet', wallet).eq('from_admin', false).eq('read_by_admin', false);

  if (error) {
    console.warn('[dms] read receipt failed:', error.message);
    if (eintrag && vorher > 0) {
      eintrag.unread = vorher;
      renderThreads();
    }
  }
}

// Zurück zum Posteingang (nur auf dem Handy sichtbar). Der Faden bleibt
// bewusst ausgewählt: Kommt eine Antwort herein, wird er im Hintergrund
// aktualisiert und ist beim nächsten Öffnen aktuell.
$('#btn-back-inbox').addEventListener('click', () => {
  $('#dm-admin').classList.remove('viewing');
});

/**
 * Ein Gespraech aus dem Posteingang nehmen – und zurueckholen.
 *
 * Was das NICHT tut, gehoert zur Erklaerung: Der andere merkt nichts. Er sieht
 * seinen Verlauf weiter, er kann weiter schreiben, seine Nachrichten werden
 * weiter gespeichert. Nur Ansems Liste zeigt ihn nicht mehr. Wer hier schreiben
 * darf, haelt dafuer einen Mindestbestand – gekauft ist damit das Recht zu
 * SCHREIBEN, nicht das Recht auf Antwort. Ihm nachtraeglich das Schreiben zu
 * nehmen waere etwas anderes.
 *
 * Und es bleibt verborgen, auch wenn er wieder schreibt: Die Liste ist nach
 * Bestand sortiert und nicht nach Zeit, es gibt also gar keine Bewegung, die
 * ein Gespraech zurueckbraechte. Das ist Absicht – man verbirgt jemanden, den
 * man nicht mehr lesen will.
 *
 * Zuerst die Datenbank, dann die Anzeige, und nicht umgekehrt: Die Zeile
 * verschwindet sonst sofort und kaeme beim naechsten Laden wieder, ohne dass
 * jemand wuesste warum. Ein Fehler wird gemeldet und die Liste bleibt, wie sie
 * war.
 */
async function verbergeThread(wallet, verbergen) {
  const zeile = state.dmThreads?.find((t) => t.wallet === wallet);
  if (!zeile) return;

  // Im Demomodus wird nichts geschrieben: Die Gespraeche gibt es nicht, und
  // ein insert wuerde eine Adresse in die echte Tabelle legen.
  if (!DEMO_DMS) {
    const { error } = verbergen
      ? await state.db.from('dm_hidden').insert({ wallet })
      : await state.db.from('dm_hidden').delete().eq('wallet', wallet);
    if (error) return toast(error.message, true);
  }

  zeile.hidden = verbergen;

  // Beim Verbergen das Gespraech schliessen: Es steht sonst offen daneben,
  // waehrend seine Zeile links gerade verschwunden ist – ein Bildschirm, der
  // zwei verschiedene Dinge behauptet.
  // Das offene Gespraech schliessen, wenn seine Zeile aus der gerade
  // gezeigten Liste faellt – sonst steht es offen daneben, waehrend es links
  // verschwunden ist. Im Verborgen-Modus ist das genau andersherum: Dort
  // faellt heraus, wer ZURUECKGEHOLT wird.
  const faelltRaus = state.zeigeVerborgene ? !verbergen : verbergen;
  if (faelltRaus && state.activeThread === wallet) closeThread();
  else if (state.activeThread === wallet) renderThread(wallet, state.dmMessages ?? []);

  renderThreads();
  toast(verbergen ? 'Hidden from your inbox' : 'Back in your inbox');
}

$('#btn-hide-thread').addEventListener('click', () => {
  const wallet = state.activeThread;
  if (!wallet) return;
  const verborgen = Boolean(state.dmThreads?.find((t) => t.wallet === wallet)?.hidden);
  verbergeThread(wallet, !verborgen);
});

// Der Schalter unter der Liste. Er ist bewusst KEIN Filter, den man setzt und
// vergisst: Beim naechsten Laden steht er wieder auf zu, weil "verborgen" der
// gemeinte Normalzustand ist. Wer sie dauerhaft sehen wollte, hat sie nicht
// verbergen wollen.
$('#btn-versteckt').addEventListener('click', () => {
  state.zeigeVerborgene = !state.zeigeVerborgene;
  renderThreads();
});

/**
 * Holt die aktuelle Schwelle nach. Schlägt es fehl – kein Netz, Spalte noch
 * nicht da – bleibt der zuletzt bekannte Wert stehen. Die verbindliche
 * Prüfung sitzt ohnehin in der Datenbank; hier geht es nur um die Anzeige.
 */
async function refreshDmMin() {
  try {
    const { data, error } = await state.db
      .from('app_config').select('min_dm_usd').eq('id', 1).single();
    if (error || !data) return;
    state.cfg.min_dm_usd = data.min_dm_usd;
    renderDmGate();
  } catch { /* Anzeige bleibt, wie sie war. */ }
}

/**
 * Die Untergrenze der DM-Schwelle.
 *
 * Ansem kann sie hoeher setzen, aber nicht darunter – und auch nicht auf null.
 * Der Posteingang laesst sich damit nicht mehr ganz oeffnen, und das ist die
 * Entscheidung: Er ist der teurere Kanal, eine DM landet nicht in einem Strom,
 * den man ueberfliegt, sondern bei einer einzelnen Person.
 *
 * Dieselbe Zahl steht in der Datenbank (Migration 20260831030000_dm_untergrenze),
 * und dort ist sie die eigentliche Sperre. Was hier steht, sorgt nur dafuer,
 * dass niemand erst tippt und dann eine Absage bekommt.
 */
const MIN_DM_SCHWELLE = 1000;

/**
 * Die Obergrenze, und zwar dieselbe Zahl in beide Richtungen gelesen: Sie ist
 * genau das, was in ein Feld mit MAX_STELLEN Stellen hineinpasst.
 *
 * Deshalb steht sie hier abgeleitet und nicht ausgeschrieben. Eine getippte
 * 9999999999 und eine Grenze von 9999999999 muessen zusammenfallen – sonst
 * gibt es eine Zahl, die das Feld annimmt und die Datenbank ablehnt, und das
 * ist der eine Fall, den es an dieser Stelle nicht geben darf.
 */
const MAX_DM_SCHWELLE = 10 ** MAX_STELLEN - 1;


function renderDmMin() {
  const box = $('#dm-min-box');
  const known = state.cfg.min_dm_usd !== undefined && state.cfg.min_dm_usd !== null;
  box.hidden = !known;
  if (!known) return;

  // Nie ein leeres Feld: Leer hiess frueher "keine Schwelle", und die gibt es
  // nicht mehr. Steht in der Datenbank noch eine 0 aus der Zeit davor, zeigt
  // das Feld die Untergrenze – denn das ist es, was beim naechsten Speichern
  // hineingeht.
  const min = Math.max(MIN_DM_SCHWELLE, Number(state.cfg.min_dm_usd));
  // Beim Tippen nicht dazwischenfunken.
  if (document.activeElement !== $('#dm-min-input')) {
    $('#dm-min-input').value = gruppiere(min);
  }
}

/**
 * Übernimmt die eingegebene Schwelle.
 *
 * Es gibt keinen Speichern-Knopf mehr. Ein einzelnes Zahlenfeld mit
 * Bestätigungsknopf ist ein Schritt, den man vergisst – und dann steht dort
 * eine Zahl, die gar nicht gilt. Übernommen wird beim Verlassen des Feldes
 * und bei Enter.
 *
 * Zwei Vorsichtsmaßnahmen, die dabei nötig werden:
 *
 *   * Nur bei tatsächlicher Änderung schreiben. Sonst löste jedes Anklicken
 *     und Wegklicken einen Schreibvorgang aus.
 *   * Bei ungültiger Eingabe den letzten gültigen Wert zurückschreiben. Ohne
 *     Knopf gibt es keinen Moment, in dem man einen Fehler noch korrigieren
 *     könnte – das Feld darf also nichts stehen lassen, was nicht gilt.
 */
let dmMinLaeuft = false;

/**
 * Ansems Regler für die DM-Schwelle.
 *
 * Kennt die Datenbank die Spalte noch nicht (Frontend liegt vor der
 * Migration), fehlt sie in app_config schlicht. Dann verschwindet das Feld,
 * statt einen Wert anzubieten, den niemand speichern kann.
 */
async function speichereDmMin() {
  const input = $('#dm-min-input');
  const bisher = Number(state.cfg.min_dm_usd ?? 0);

  // Zweite Sicherung neben nurZahlen(): fängt ab, was anders ins Feld kommt.
  const raw = saubereZahl(input.value);

  // Ein leeres Feld heisst die UNTERGRENZE, nicht null.
  //
  // Hier stand: leer heisst "keine Schwelle", also 0 – mit der Begruendung, wer
  // die Zahl loesche, wolle sie loswerden. Das galt, solange 0 ein erlaubter
  // Wert war. Er ist es nicht mehr; unter 1000 geht nichts. Damit ist "leer"
  // keine Aussage mehr, sondern ein unfertiger Zustand, und die einzige
  // ehrliche Antwort darauf ist der kleinste Wert, den es gibt.
  //
  // Auch alles UNTERHALB wird angehoben statt abgelehnt. Eine Absage waere
  // formal richtiger und praktisch schlechter: Man haette getippt, bekaeme eine
  // rote Meldung und muesste noch einmal tippen – fuer eine Zahl, die die Seite
  // selbst kennt. Die Datenbank lehnt trotzdem ab; sie ist die Sperre, das hier
  // ist die Hoeflichkeit davor.
  //
  // Ein alleinstehender Punkt ist ebenfalls keine Zahl und zaehlt wie leer.
  const getippt = Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : 0;
  // Nach oben deckelt schon saubereZahl(), indem die elfte Stelle nicht ins
  // Feld kommt. Das hier faengt den Weg daran vorbei ab – ein Wert, der per
  // Skript gesetzt wurde, ohne dass ein input-Ereignis lief.
  const usd = Math.min(MAX_DM_SCHWELLE, Math.max(MIN_DM_SCHWELLE, getippt));

  // Ab hier gilt wieder der gespeicherte Stand, nicht der Entwurf.
  state.dmMinEntwurf = null;

  if (usd === bisher || dmMinLaeuft) {
    // Auch hier die Untergrenze zeigen und nicht den alten Stand: Stuende in
    // der Datenbank noch eine 0 von frueher, saehe man sonst nach dem Loeschen
    // wieder eine 0 – also genau den Wert, den es nicht mehr geben soll.
    input.value = gruppiere(Math.max(MIN_DM_SCHWELLE, bisher));
    renderThreads();
    return;
  }

  dmMinLaeuft = true;
  try {
    const { data, error } = await state.db.rpc('set_min_dm_usd', { p_usd: usd });
    if (error) throw error;
    state.cfg.min_dm_usd = Number(data);
    renderDmMin();

    // Die neue Schwelle gilt sofort für den Posteingang. Fällt das gerade
    // offene Gespräch heraus, wird es geschlossen – sonst stünde eine Antwort
    // offen an jemanden, der in der Liste nicht mehr auftaucht.
    renderThreads();
    const offen = state.dmThreads?.find((t) => t.wallet === state.activeThread);
    if (offen && Number(offen.usd) < Number(data)) closeThread();
  } catch (err) {
    input.value = gruppiere(Math.max(MIN_DM_SCHWELLE, bisher));
    renderThreads();
    toast(err.message, true);
  } finally {
    dmMinLaeuft = false;
  }
}

/* Keine eigene Rückmeldung beim Speichern – und das ist kein Vergessen:
   Der Posteingang darunter folgt der Zahl schon beim Tippen. Wer die Schwelle
   erhöht, sieht Gespräche verschwinden. Eine zusätzliche Meldung würde nur
   bestätigen, was man gerade zugesehen hat. Fehler melden sich weiterhin. */

/**
 * Der Posteingang folgt der Zahl schon beim Tippen.
 *
 * Ohne Verzögerung: Es wird nur neu gezeichnet, was ohnehin im Speicher liegt.
 * Ein Filter, der dafür den Server fragen müsste, müsste warten, bis man mit
 * dem Tippen fertig ist – dieser nicht.
 *
 * Gespeichert wird davon nichts; das passiert erst beim Verlassen des Feldes.
 * Deshalb der eigene Entwurfswert: Ohne ihn wäre beim Rausklicken nicht mehr
 * erkennbar, ob sich gegenüber dem gespeicherten Stand etwas geändert hat.
 *
 * Ein leeres Feld heißt "keine Schwelle" und zeigt wieder alles. Sonst wäre
 * der Posteingang im Moment des Löschens leer, obwohl gerade keine Schwelle
 * gilt.
 */
$('#dm-min-input').addEventListener('input', () => {
  const raw = saubereZahl($('#dm-min-input').value);
  const usd = Number(raw);
  // Auch der Entwurf haelt die Untergrenze ein. Sonst zeigte der Posteingang
  // beim Tippen von "1", "10", "100" drei Zustaende, die es nicht geben kann –
  // und beim Loslassen spraenge er auf einen vierten.
  const getippt = (raw === '' || !Number.isFinite(usd)) ? 0 : usd;
  state.dmMinEntwurf = Math.max(MIN_DM_SCHWELLE, getippt);
  renderThreads();
});

$('#dm-min-input').addEventListener('blur', speichereDmMin);

$('#dm-min-input').addEventListener('keydown', (e) => {
  // Enter bestätigt: Das Feld gibt den Fokus ab, und genau daran hängt das
  // Speichern. Sonst bliebe der Zeiger blinkend stehen, als wäre noch etwas
  // offen.
  if (e.key === 'Enter') { e.preventDefault(); $('#dm-min-input').blur(); return; }

  // Escape verwirft und stellt den zuletzt gespeicherten Wert wieder her.
  if (e.key !== 'Escape') return;
  state.dmMinEntwurf = null;
  $('#dm-min-input').value =
    gruppiere(Math.max(MIN_DM_SCHWELLE, Number(state.cfg.min_dm_usd ?? 0)));
  renderThreads();
  $('#dm-min-input').blur();
});

$('#dm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#dm-input');
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  const zeile = { wallet: state.me.wallet, body };
  if (state.dmRepliesAvailable && state.dmReplyTo) zeile.reply_to = state.dmReplyTo;
  const { error } = await state.db.from('dms').insert(zeile);
  if (error) { toast(error.message, true); input.value = body; }
  else { clearDmReply(); loadDms(); }
});

$('#admin-dm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#admin-dm-input');
  const body = input.value.trim();
  if (!body || !state.activeThread) return;
  input.value = '';
  const zeile = { wallet: state.activeThread, from_admin: true, body };
  if (state.dmRepliesAvailable && state.dmReplyTo) zeile.reply_to = state.dmReplyTo;

  // Im Demomodus bleibt die Antwort im Speicher.
  //
  // Nicht nur, damit nichts in die Datenbank faellt: Ohne diesen Zweig
  // scheiterte das Absenden mit einer Fehlermeldung, und man saehe von der
  // Sache, um die es geht – wie sich das Antworten anfuehlt – gar nichts.
  //
  // Mitgefuehrt wird auch die Zeile im Posteingang: Vorschau, "You:" davor und
  // der Ungelesen-Zaehler auf null. Sonst behauptet die Liste weiter, der
  // andere habe zuletzt geschrieben – und das ist genau die Art Widerspruch,
  // an der man in einer Simulation die falschen Schluesse zieht.
  if (DEMO_DMS) {
    const wallet = state.activeThread;
    const rows = [...(state.dmCache.get(wallet) ?? [])];
    rows.push({
      id: (rows.at(-1)?.id ?? 0) + 1,
      wallet, from_admin: true, body,
      reply_to: zeile.reply_to ?? null,
      created_at: new Date().toISOString(),
    });
    state.dmCache.set(wallet, rows);

    const t = state.dmThreads?.find((x) => x.wallet === wallet);
    if (t) {
      t.preview = body;
      t.last_from_admin = true;
      t.unread = 0;
      t.total = Number(t.total ?? 0) + 1;
      t.last_at = new Date().toISOString();
    }

    clearDmReply();
    renderThread(wallet, rows);
    renderThreads();
    return;
  }

  const { error } = await state.db.from('dms').insert(zeile);
  if (error) { toast(error.message, true); input.value = body; }
  else {
    clearDmReply();
    // Der zwischengespeicherte Stand ist jetzt veraltet.
    state.dmCache.delete(state.activeThread);
    await openThread(state.activeThread);
    loadDms();
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Den Service Worker anmelden. Er macht die Seite ablegbar und fängt kurze
 * Funklöcher ab – nicht mehr. Scheitert er, läuft alles normal weiter.
 *
 * Auf dem eigenen Rechner ausdrücklich NICHT. Beim Entwickeln sitzt er sonst
 * zwischen Browser und Dateien, und ein Neuladen mit gedrückter Umschalttaste
 * kommt bei ihm gar nicht an: Der Worker holt die Dateien mit einem eigenen
 * fetch, und das umgeht den Zwischenspeicher des Browsers nicht mit. Man
 * ändert also etwas und sieht weiter die alte Seite, ohne dass etwas kaputt
 * wäre. Auf dem Startbildschirm liegt hier ohnehin niemand.
 *
 * Ein bereits angemeldeter Worker wird dabei aktiv abgemeldet und sein Speicher
 * geleert – sonst bliebe er von früheren Besuchen für immer aktiv.
 *
 * ?sw=1 schaltet ihn auch auf dem eigenen Rechner ein. Das ist kein Hintertürchen,
 * sondern eine Notwendigkeit: Ein Service Worker läuft nur in einem sicheren
 * Kontext, also über HTTPS oder eben auf localhost. Wer ihn prüfen will – der
 * Test tut das – hat gar keine andere Wahl, als ihn dort einzuschalten.
 */
const SW_ERZWUNGEN = new URLSearchParams(location.search).get('sw') === '1';
if ('serviceWorker' in navigator) {
  if (NUR_HIER && !SW_ERZWUNGEN) {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => (self.caches ? caches.keys() : []))
      .then((keys) => Promise.all([...keys].map((k) => caches.delete(k))))
      .catch(() => { /* Nichts abzumelden. */ });
  } else {
    navigator.serviceWorker.register('/sw.js')
      .catch((e) => console.warn('[pwa] service worker not registered:', e.message));
  }
}

// ---------------------------------------------------------------------------
// Vor dem Start: die Seite ist zu
// ---------------------------------------------------------------------------
//
// Ein Schalter fuer beides. app_config.open_to_public entscheidet in der
// Function, WER hereinkommt (siehe _shared/freischaltung.ts), und hier, WAS
// ein Besucher zu sehen bekommt. Eine Zeile SQL macht die Seite auf und wieder
// zu, ohne dass etwas hochgeladen wird:
//
//   update public.app_config set open_to_public = false where id = 1;   -- zu
//   update public.app_config set open_to_public = true  where id = 1;   -- auf
//
// Der Bildschirm ist eine FASSADE, keine Sperre. Wer ihn umgeht, steht vor dem
// Login und kommt dort keinen Schritt weiter – die Function laesst nur
// admin_wallet und test_wallet durch, und das entscheidet der Server. Deshalb
// darf der Knopf offen dastehen, und deshalb ist die naechste Entscheidung
// auch richtig herum:
//
// Faellt die Abfrage aus, wird NICHT ausgesperrt. Ein Netzfehler zeigte sonst
// ein "Launching soon", obwohl die Seite laengst offen ist – und das waere ein
// Fehler, den niemand meldet, weil er wie Absicht aussieht. Andersherum
// kostet es nichts: Wer dann am Login steht und nicht hereindarf, bekommt die
// Absage vom Server.
const TEAM_ZUGANG = 'size_team';

/** Hat jemand hier schon einmal auf "Team access" getippt? */
function teamFrei() {
  try { return localStorage.getItem(TEAM_ZUGANG) === '1'; } catch { return false; }
}

// Wie lange auf die Antwort gewartet wird, bevor die Seite als offen gilt.
//
// Dass es diese Zahl gibt, ist kein Feinschliff. Ohne sie haengt der ganze
// Start an einer einzigen Anfrage: Kommt keine Antwort – Funkloch, ein
// Hotel-WLAN mit Anmeldeseite davor, ein Ausfall bei Supabase –, wartet boot()
// unbegrenzt, und der Besucher sieht NIE etwas. Weder Login noch Vorhang, nur
// Schwarz.
//
// Gefunden hat das nicht ein Gedanke, sondern zwei Tests: In beiden zeigt die
// Adresse ins Leere, und in beiden blieb die Seite danach fuer immer leer.
// Genau derselbe Ablauf wie in einem Funkloch.
const ZU_ABFRAGE_MS = 2500;

async function seiteIstZu() {
  // Wer eine Sitzung hat oder den Knopf kennt, sieht den Bildschirm nicht.
  if (state.jwt || teamFrei()) return false;
  try {
    const db = state.db ?? makeClient();
    const frage = db.from('app_config').select('open_to_public').eq('id', 1).single()
      .then(({ data }) => data?.open_to_public === false);
    // Im Zweifel offen – die Begruendung steht ueber TEAM_ZUGANG.
    const geduld = new Promise((r) => setTimeout(() => r(false), ZU_ABFRAGE_MS));
    return await Promise.race([frage, geduld]);
  } catch {
    return false;
  }
}

function zeigeBald() {
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#soon').hidden = false;
}

$('#btn-team').addEventListener('click', () => {
  // Gemerkt, damit man beim Bauen nicht bei jedem Laden wieder tippen muss.
  try { localStorage.setItem(TEAM_ZUGANG, '1'); } catch { /* egal */ }
  $('#soon').hidden = true;
  zeigeLogin();
  maybeShowInstallStep();
});

(async function boot() {
  if (await seiteIstZu()) { zeigeBald(); return; }
  if (!state.jwt) { zeigeLogin(); maybeShowInstallStep(); return; }

  const payload = jwtPayload();
  const expMs = (payload?.exp ?? 0) * 1000;
  if (!expMs || expMs < Date.now()) {
    logout();
    return;
  }

  const issuedMs = (payload?.iat ?? 0) * 1000;
  const lifetime = expMs - issuedMs;
  if (lifetime > 0 && expMs - Date.now() < lifetime / 2) {
    try {
      const r = await callFunction('verify', { action: 'renew' }, true);
      state.jwt = r.token;
      schreib(TOKEN_KEY, r.token);
      state.me = r.profile;
    } catch (e) {
      // Bei 401 ist die Sitzung endgültig vorbei, sonst einfach weitermachen.
      if (/expired|too old|Not verified/i.test(e.message)) { logout(); return; }
      console.warn('[session] renewal failed, continuing:', e.message);
    }
  }

  try {
    await enterApp();
  } catch (e) {
    console.error('[start] failed:', e.message);
    if (/JWT|token|expired/i.test(e.message)) { logout(); return; }
    // Kein Rauswurf: Es kann genauso gut ein kurzer Ausfall sein.
    zeigeLogin();
    maybeShowInstallStep();
    $('#login-error').textContent =
      'Could not load. Check your connection and reload the page.';
    $('#login-error').hidden = false;
  }
})();
