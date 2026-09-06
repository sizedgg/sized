/**
 * Prüft die Zustandsmaschine, die entscheidet, welche Realtime-Kanäle ein
 * Browser gerade offen hält.
 *
 * Warum eigens dafür ein Test: Ein Fehler hier ist unsichtbar. Die Seite sieht
 * völlig normal aus, aber der Abstimmungs-Kanal kommt nach einem Tabwechsel
 * nicht zurück – und der Nutzer wundert sich, warum sich die Zahlen nicht mehr
 * bewegen. Genau das lässt sich im Browser nur schwer bemerken und hier leicht
 * messen.
 *
 * app.js wird dafür im Quelltext geladen, die beiden echten Importe werden
 * durch Attrappen ersetzt und ein minimales DOM daruntergelegt.
 *
 *   node scripts/test-realtime-switching.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// DOM-Attrappe: gerade genug, damit app.js beim Laden durchläuft
// ---------------------------------------------------------------------------

const elements = new Map();
const makeEl = (sel) => ({
  sel,
  hidden: false,
  disabled: false,
  value: '',
  textContent: '',
  innerHTML: '',
  dataset: {},
  scrollTop: 0,
  scrollHeight: 0,
  // Leer, aber vorhanden: renderOptionKnoepfe() zaehlt die Kinder des
  // Optionsfelds. Ohne diese Zeile scheitert schon das Laden.
  children: [],
  // Echte Klassenliste statt Attrappe: Mehrere Zustaende der Oberflaeche
  // haengen daran (gesperrt, keine Antworten, aktiv). Eine contains-Funktion,
  // die immer false liefert, laesst jede Pruefung darauf still durchfallen.
  classList: (() => {
    const set = new Set();
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      toggle: (c, an) => (an ?? !set.has(c)) ? set.add(c) : set.delete(c),
    };
  })(),
  // Zuhoerer merken statt verwerfen. Genau daran ist einmal etwas
  // vorbeigerutscht: Beim Aufraeumen verschwand der input-Zuhoerer des
  // Schwellenfelds, und keine Pruefung merkte es, weil die Attrappe
  // addEventListener stillschweigend geschluckt hat. Mit __fire laesst sich
  // jetzt pruefen, ob ein Feld ueberhaupt reagiert.
  __hoerer: {},
  addEventListener(typ, fn) { (this.__hoerer[typ] ??= []).push(fn); },
  // Attribute merken, damit sich pruefen laesst, was gesetzt wurde – etwa das
  // aria-label, in dem die Anzahl ungelesener DMs steht, seit am Reiter nur
  // noch ein Punkt erscheint.
  __attr: {},
  setAttribute(name, wert) { this.__attr[name] = String(wert); },
  getAttribute(name) { return this.__attr[name] ?? null; },
  __fire(typ, ev = {}) { (this.__hoerer[typ] ?? []).forEach((fn) => fn.call(this, ev)); },
  __hat(typ) { return (this.__hoerer[typ] ?? []).length > 0; },
  querySelector: () => makeEl('child'),
  querySelectorAll: () => [],
  focus() {},
  remove() {},
  insertAdjacentHTML() {},
  appendChild() {},
  // Beide Wege, ein Kind anzuhaengen, und beide werden gebraucht: optionZeile()
  // benutzt append(), setzeOptionenZurueck() replaceChildren(). Fehlt einer,
  // scheitert schon das LADEN des Moduls – und dann meldet dieser Test gar
  // nichts mehr, statt "fehlgeschlagen".
  append() {},
  replaceChildren() {},
  // Der Zeichenzaehler sucht von seinem Feld aus nach oben den Kasten, in dem
  // er sitzt. Die Attrappe kennt keine Verwandtschaft; sie liefert einfach ein
  // Element zurueck. Das genuegt: Geprueft wird hier das Umschalten zwischen
  // den Kanaelen, nicht der Zaehler – der hat seinen eigenen Test. Fehlt die
  // Zeile aber, scheitert schon das LADEN des Moduls, und dann meldet dieser
  // Test gar nichts mehr statt "fehlgeschlagen".
  closest: () => makeEl('kasten'),
  style: {},
});
const el = (sel) => {
  if (!elements.has(sel)) elements.set(sel, makeEl(sel));
  return elements.get(sel);
};

const listeners = {};
globalThis.document = {
  visibilityState: 'visible',
  querySelector: el,
  querySelectorAll: () => [],
  addEventListener: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
  createElement: () => makeEl('created'),
  body: makeEl('body'),
};
// Ohne location scheitert schon das Laden des Moduls: Die Adminvorschau liest
// beim Start die Adresszeile aus. Bewusst ein Wert OHNE ?preview=admin – die
// Tests sollen den normalen Fall pruefen, nicht die Vorschau.
globalThis.location = { search: '', hostname: 'sized.gg', href: 'https://sized.gg/' };
globalThis.window = { addEventListener() {}, location: globalThis.location };
// app.js haengt seinen keydown-Zuhoerer an den globalen Namensraum, nicht an
// document. Ohne diese Zeile scheitert schon das LADEN des Moduls – und der
// ganze Test faellt aus, ohne dass ein einziger Befund gemeldet wird.
globalThis.addEventListener = (ev, fn) => { (listeners[ev] ??= []).push(fn); };
globalThis.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = String(v); },
  removeItem(k) { delete this._v[k]; },
};
// navigator existiert in Node bereits und ist schreibgeschützt – nur ergänzen.
if (!globalThis.navigator.clipboard) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async () => {} }, configurable: true,
  });
}
globalThis.fetch = async () => { throw new Error('kein Netz im Test'); };

const fire = (ev) => (listeners[ev] ?? []).forEach((fn) => fn());

// ---------------------------------------------------------------------------
// Supabase-Attrappe: merkt sich, welche Kanäle offen sind
// ---------------------------------------------------------------------------

const open = new Set();
const byTopic = new Map();          // damit der Test Statusmeldungen ausloesen kann
const optionen = new Map();         // Kanalname -> zweites Argument von channel()
const bindungen = new Map();        // Kanalname -> Liste der .on()-Aufrufe
const fakeDb = {
  channel(topic, opts) {
    optionen.set(topic, opts);
    bindungen.set(topic, []);
    const ch = {
      topic,
      on(art, filter) { bindungen.get(topic).push({ art, filter }); return ch; },
      subscribe(cb) { open.add(topic); ch.cb = cb; byTopic.set(topic, ch); return ch; },
    };
    return ch;
  },
  removeChannel(ch) { open.delete(ch.topic); },
  from() {
    const q = new Proxy({}, {
      get: (_t, prop) => (prop === 'then'
        ? undefined
        : () => (prop === 'single' || prop === 'maybeSingle' ? Promise.resolve({ data: null, error: null }) : q)),
    });
    return q;
  },
};

// ---------------------------------------------------------------------------
// app.js laden, Importe ersetzen, internen Zustand herausreichen
// ---------------------------------------------------------------------------

const src = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8')
  .replace(/^import .*$/gm, '')
  .concat(`
globalThis.__test = {
  state,
  syncRealtime,
  selectTab,
  unsubscribeAll,
  stopFallback,
  STIMMEN_TAKT_MS,
  dmsNachziehen,
  PREVIEW_ADMIN,
  DEMO_DMS,
  demoThreads,
  demoPolls,
  dmHtml,
  dmQuoteHtml,
  pruefeDmAntworten,
  renderThreads,
  markiereGelesen,
  kurzUsd,
  saubereZahl,
  gruppiere,
  tagLabel,
  dmListeHtml,
  speichereDmMin,
  renderDmMin,
  MIN_DM_SCHWELLE,
  MAX_DM_SCHWELLE,
  MAX_STELLEN,
  STRICH_BLEIBT,
  STRICH_MAX,
  STRICH_MIN,
};
`);

const mod = path.join(root, '.test-app.mjs');
fs.writeFileSync(mod, src);
try {
  await import('file://' + mod);
} finally {
  fs.unlinkSync(mod);
}

const { state, syncRealtime, selectTab, unsubscribeAll, STIMMEN_TAKT_MS, dmsNachziehen, dmHtml, dmQuoteHtml, pruefeDmAntworten, renderThreads, markiereGelesen, kurzUsd, saubereZahl, gruppiere, tagLabel, dmListeHtml, speichereDmMin, renderDmMin, MIN_DM_SCHWELLE, MAX_DM_SCHWELLE, MAX_STELLEN, STRICH_BLEIBT, STRICH_MAX, STRICH_MIN } = globalThis.__test;
state.db = fakeDb;
// Der DM-Kanal heisst seit dem Broadcast-Umbau nach der eigenen Wallet. Ohne
// angemeldeten Nutzer gaebe es ihn gar nicht – siehe wantedChannels().
const NUTZER = 'H4v7xKq111111111111111111111111111111111111';
state.me = { wallet: NUTZER, isAdmin: false };
const DM_KANAL = `dm:${NUTZER}`;

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------

let failed = 0;
function check(label, expected) {
  const got = [...open].sort().join(', ') || '(keine)';
  const want = [...expected].sort().join(', ') || '(keine)';
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}`);
  if (!ok) console.log(`         erwartet: ${want}\n         bekommen: ${got}`);
}

function check2(label, cond) {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FEHL'}  ${label}`);
}

console.log('\nRealtime-Kanäle je nach Tab und Sichtbarkeit\n');

selectTab('polls');
check('Abstimmungs-Tab offen', ['hub:polls', DM_KANAL]);

selectTab('dms');
check('DM-Tab schliesst den Abstimmungs-Kanal', [DM_KANAL]);

selectTab('polls');
check('Zurueck zu den Abstimmungen abonniert wieder', ['hub:polls', DM_KANAL]);

document.visibilityState = 'hidden';
fire('visibilitychange');
check('Seite im Hintergrund: alle Kanaele zu', []);

document.visibilityState = 'visible';
fire('visibilitychange');
check('Seite wieder sichtbar: die Abstimmungen kommen zurueck', ['hub:polls', DM_KANAL]);

// Genau der Fehler, der sonst unbemerkt bliebe: mehrfaches Aufrufen darf
// keinen zweiten Kanal aufmachen und keinen bestehenden abwuergen.
const before = [...open].sort().join(',');
syncRealtime();
syncRealtime();
check('Mehrfaches Synchronisieren aendert nichts', before.split(','));

// ---------------------------------------------------------------------------
// Rueckfallebene: kommt die Live-Leitung nicht zustande, muss die Seite
// selbst nachfragen – und damit aufhoeren, sobald sie wieder da ist.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Der Stimmen-Takt
//
// Stimmen werden NICHT mehr zugestellt. Die Zeile .on(... table: 'votes')
// gab es einmal, und sie war der teuerste Griff der ganzen Seite: Supabase
// zaehlt Zustellungen einzeln, eine Stimme an 500 Browser sind 500
// Nachrichten. Bei einer frischen Abstimmung waren das rund 8.300 pro
// Sekunde gegen ein Kontingent von 500 bis 2.500.
//
// Stattdessen fragt der offene Polls-Tab die Zahlen selbst nach. Damit haengt
// an dem Kanal jetzt eine Uhr, und die muss GENAU so lange laufen wie er --
// laeuft sie weiter, fragt ein Browser im Hintergrund ewig nach; laeuft sie
// nicht, stehen die Balken still und niemand sieht einen Fehler.
// ---------------------------------------------------------------------------

console.log('\nDer Stimmen-Takt laeuft genau so lange wie der Kanal\n');

const taktLaeuft = () => state.stimmenTakt !== null && state.stimmenTakt !== undefined;
function checkTakt(label, erwartet) {
  const ok = taktLaeuft() === erwartet;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}`);
  if (!ok) console.log(`         erwartet: ${erwartet ? 'laeuft' : 'steht'}\n         bekommen: ${taktLaeuft() ? 'laeuft' : 'steht'}`);
}

// Die Zeile selbst darf nicht zurueckkommen -- sie ist der ganze Grund.
// Kommentare zaehlen dabei nicht: Direkt ueber der Stelle STEHT beschrieben,
// was dort einmal stand, samt der Zeile im Wortlaut. Ohne diesen Filter
// schluege der Test wegen seiner eigenen Begruendung fehl.
const appSrc = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const ohneKommentar = appSrc.split('\n')
  .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n');
check2('Kein Browser hoert mehr auf einzelne Stimmen',
  !/table:\s*'votes'/.test(ohneKommentar));
check2('Neue und beendete Abstimmungen bleiben live',
  /table:\s*'polls'/.test(appSrc) && /table:\s*'poll_options'/.test(appSrc));
// Und die Datenbank muss dasselbe sagen, sonst arbeitet Realtime die Stimmen
// weiter aus dem WAL ab, obwohl niemand zuhoert.
const wanderung = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260903040000_votes_nicht_mehr_live.sql'), 'utf8');
check2('public.votes ist aus der Realtime-Veroeffentlichung genommen',
  /drop table public\.votes/.test(wanderung));

selectTab('polls');
checkTakt('Polls-Tab offen -> der Takt laeuft', true);
check2('Und zwar langsamer als die alte Sammelfrist von 400 ms',
  STIMMEN_TAKT_MS >= 3000);

selectTab('dms');
checkTakt('DM-Tab -> der Takt steht', false);

selectTab('polls');
checkTakt('Zurueck zu den Abstimmungen -> er laeuft wieder', true);

document.visibilityState = 'hidden';
fire('visibilitychange');
checkTakt('Seite im Hintergrund -> er steht', false);

document.visibilityState = 'visible';
fire('visibilitychange');
checkTakt('Seite wieder sichtbar -> er laeuft', true);

// Zweimal synchronisieren darf keine zweite Uhr starten -- sonst fragt der
// Browser doppelt so oft nach, und die alte Uhr laesst sich nie mehr stoppen.
const uhrVorher = state.stimmenTakt;
syncRealtime();
syncRealtime();
check2('Mehrfaches Synchronisieren startet keine zweite Uhr',
  state.stimmenTakt === uhrVorher);

// Wer selbst abstimmt, darf nicht bis zum naechsten Takt warten -- sonst
// fuehlt sich der eigene Klick fuenf Sekunden lang wirkungslos an.
check2('Wer selbst abstimmt, wartet nicht auf den Takt',
  /await loadPolls\(\);\s*\n\s*toast\('Vote counted'\)/.test(appSrc));

// -------------------------------------------------------------------------
// DMs: Stups auf einem privaten Kanal statt Meldung an alle
//
// Hier hing die letzte teure Stelle. postgres_changes prueft die Rechte
// EINZELN je Zuhoerer und Aenderung -- eine DM an Ansem bei 3.000 offenen
// Seiten sind 3.000 Pruefungen, einfaedig abgearbeitet. Jetzt schickt ein
// Trigger einen Stups an genau zwei Kanaele.
//
// Gemessen wird an der Attrappe, nicht am Quelltext: WIE der Kanal wirklich
// geoeffnet wurde.
// -------------------------------------------------------------------------
check2('Kein Browser hoert mehr auf einzelne DM-Zeilen',
  !/table:\s*'dms'/.test(ohneKommentar));
check2('Der DM-Kanal heisst nach der eigenen Wallet',
  open.has(DM_KANAL), [...open].join(', '));
// private: true ist nicht optional -- ohne das prueft Supabase die
// Zugangsregel gar nicht erst und der Kanal steht jedem offen.
check2('Und er ist als privat geoeffnet',
  optionen.get(DM_KANAL)?.config?.private === true,
  JSON.stringify(optionen.get(DM_KANAL) ?? null));
check2('Er lauscht auf einen Broadcast, nicht auf Tabellenaenderungen',
  (bindungen.get(DM_KANAL) ?? []).every((b) => b.art === 'broadcast')
    && (bindungen.get(DM_KANAL) ?? []).some((b) => b.filter?.event === 'dm'),
  (bindungen.get(DM_KANAL) ?? []).map((b) => b.art).join(', ') || '(keine)');
check2('Und sie sammeln weiter nur kurz',
  /reloadSoon\('dms', dmsNachziehen\)/.test(ohneKommentar)
    && /function reloadSoon\(key, fn, delay = 400\)/.test(ohneKommentar));

// -------------------------------------------------------------------------
// Ein Stups kommt nur EINMAL
//
// Der Abstimmungs-Takt fragt alle 5 Sekunden erneut nach; wenn dort eine
// Abfrage scheitert, holt die naechste es nach. Bei den DMs gibt es dieses
// Netz nicht. Faellt das Nachladen also in eine kurze Stoerung -- gemessen am
// 4.9.2026 beim Umstellen der Datenbankgroesse: net::ERR_FAILED --, ginge die
// Nachricht still verloren.
//
// Geprueft wird hier mit einem loadDms(), das die ersten Male scheitert.
// -------------------------------------------------------------------------
{
  const gemerkteDb = state.db;
  state.activeThread = null;

  // Ohne state.db scheitert loadDms -- genau der Fall "keine Antwort".
  state.db = null;
  const t0 = Date.now();
  const gescheitert = await dmsNachziehen(3);
  const gedauert = Date.now() - t0;

  check2('Scheitert das Nachladen, wird nicht still aufgegeben',
    gescheitert === false);
  // 0,6 + 1,2 Sekunden zwischen drei Versuchen.
  check2('Sondern mehrfach nachgefasst, mit wachsendem Abstand',
    gedauert >= 1700, `${gedauert} ms fuer 3 Versuche`);

  // Gegenprobe: Klappt es, darf NICHT gewartet werden. Ohne diese Zeile waere
  // die Pruefung oben auch fuer eine Funktion gruen, die immer wartet.
  //
  // Dafuer eine Datenbank-Attrappe, deren Kette wirklich aufloest: loadDms()
  // holt erst app_config (.select().eq().single()) und dann die Nachrichten
  // (.select().order()).
  state.db = {
    from: () => {
      const q = {
        select: () => q, order: () => q, eq: () => q, limit: () => q,
        single: async () => ({ data: { min_dm_usd: 1000 }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (auf) => Promise.resolve({ data: [], error: null }).then(auf),
      };
      return q;
    },
  };
  const t1 = Date.now();
  const geklappt = await dmsNachziehen(3);
  const schnell = Date.now() - t1;
  check2('Gegenprobe: klappt es beim ersten Mal, wird nicht gewartet',
    geklappt === true && schnell < 300, `${schnell} ms`);

  state.db = gemerkteDb;
}

// Ansem hoert an einem anderen Kanal: einem Posteingang fuer ALLE Threads.
// Haette er denselben wie ein Nutzer, bekaeme er nur seinen eigenen -- und
// merkte nie, dass ihm jemand geschrieben hat.
{
  unsubscribeAll();
  const alsNutzer = [...open];
  state.me = { wallet: NUTZER, isAdmin: true };
  syncRealtime({ catchUp: false });
  check2('Ansem hoert stattdessen an dm:admin',
    open.has('dm:admin'), [...open].join(', '));
  check2('Und nicht zusaetzlich am Kanal eines Nutzers',
    !open.has(DM_KANAL), [...open].join(', '));
  check2('Auch seiner ist privat',
    optionen.get('dm:admin')?.config?.private === true);
  unsubscribeAll();
  state.me = { wallet: NUTZER, isAdmin: false };
  syncRealtime({ catchUp: false });
  void alsNutzer;
}

// Ohne angemeldeten Nutzer darf gar kein DM-Kanal aufgehen -- sonst hiesse er
// "dm:undefined", wuerde abgewiesen, und die Seite meldete eine Stoerung.
{
  unsubscribeAll();
  const gemerkt = state.me;
  state.me = null;
  syncRealtime({ catchUp: false });
  check2('Ohne Anmeldung gibt es keinen DM-Kanal',
    ![...open].some((t) => t.startsWith('dm:')), [...open].join(', ') || '(keine)');
  state.me = gemerkt;
  unsubscribeAll();
  syncRealtime({ catchUp: false });
}

console.log('\nRueckfall auf Nachfragen, wenn die Live-Leitung fehlt\n');

const polling = () => Object.keys(state.fallback).sort().join(', ') || '(keins)';
function checkPoll(label, expected) {
  const got = polling();
  const want = [...expected].sort().join(', ') || '(keins)';
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}`);
  if (!ok) console.log(`         erwartet: ${want}\n         bekommen: ${got}`);
}

selectTab('polls');
checkPoll('Solange alles laeuft, wird nicht nachgefragt', []);

// Bricht die Leitung, braucht es fuer die Abstimmungen KEINE zweite Uhr: Der
// Takt fragt ohnehin nach. Eine Meldung "Live updates unavailable" waere hier
// sogar falsch -- die Stimmen kommen weiter an.
byTopic.get('hub:polls').cb('CHANNEL_ERROR', new Error('429'));
checkPoll('Abstimmungs-Kanal abgelehnt -> keine zweite Uhr daneben', []);
checkTakt('Der Takt laeuft dabei unveraendert weiter', true);

byTopic.get(DM_KANAL).cb('TIMED_OUT');
checkPoll('Der DM-Kanal dagegen wird nachgefragt', ['dms']);

byTopic.get(DM_KANAL).cb('SUBSCRIBED');
checkPoll('DMs wieder verbunden -> Nachfragen hoert auf', []);

selectTab('dms');
checkTakt('Wechsel weg von den Abstimmungen stoppt den Takt', false);

document.visibilityState = 'hidden';
fire('visibilitychange');
checkPoll('Seite im Hintergrund: gar keine Nachfragerei', []);

document.visibilityState = 'visible';
fire('visibilitychange');
selectTab('polls');
unsubscribeAll();
check('Abmelden schliesst alles', []);
checkPoll('Abmelden beendet auch das Nachfragen', []);
checkTakt('Und stoppt den Takt', false);

state.cfg.symbol = 'ANSEM';
state.cfg.admin_wallet = 'AnsemWalletAddress11111111111111111111111111';

// ---------------------------------------------------------------------------
// Der kurze Betrag: nie mehr als drei Ziffernstellen
// ---------------------------------------------------------------------------
// Daran haengt die Betragsspalte im Posteingang. Waere ein Betrag auch nur
// einmal breiter, verschoebe sich in dieser Zeile alles – und genau die
// Ausrichtung ist der Grund, warum es die Funktion gibt.

const kurzProben = [
  [0, '$0'], [-5, '$0'], [NaN, '$0'],
  [0.04, '<$1'], [0.42, '<$1'],
  [1, '$1'], [3, '$3'], [50, '$50'], [201, '$201'], [999, '$999'],
  // Aufrunden ueber die Tausendergrenze: 999,6 sind nicht "$1000".
  [999.6, '$1K'],
  // Zwischen 1.000 und 10.000 KEINE Nachkommastelle.
  //
  // Hier standen "$1.4K" und "$9.9K". Die Stelle sah nach einer genauen Angabe
  // aus und war keine: Hinter "$8.8K" steht irgendetwas zwischen 8.750 und
  // 8.849. Sie behauptete eine Genauigkeit, die die Zahl nicht hat, und
  // ausgerechnet dort, wo die Betraege dicht beieinanderliegen.
  [1000, '$1K'], [1412, '$1K'], [3444, '$3K'], [8820, '$9K'], [9940, '$10K'],
  // Und die Grenze dazwischen, beide Seiten:
  [1499, '$1K'], [1500, '$2K'], [9499, '$9K'], [9500, '$10K'],
  // Ab hier faellt die Nachkommastelle ohnehin weg, sonst waeren es vier
  // Stellen. Der Uebergang ist damit nahtlos: $9K, $10K, $12K.
  [9990, '$10K'], [10400, '$10K'], [12400, '$12K'],
  [31500, '$32K'], [99900, '$100K'], [781420, '$781K'],
  // Und hier die naechste Grenze: 999.960 aufgerundet sind 1000K – also 1 M.
  [999960, '$1.0M'],
  // Bei Millionen bleibt die Nachkommastelle: Zwischen "$1M" und "$2M" liegt
  // eine Million, dort traegt sie eine echte Auskunft.
  [1240000, '$1.2M'], [12400000, '$12M'], [124000000, '$124M'],
  [1.24e9, '$1.2B'], [1.24e12, '$1.2T'],
];
for (const [roh, erwartet] of kurzProben) {
  const ist = kurzUsd(roh);
  check2(`kurzUsd(${roh}) = ${erwartet}`, ist === erwartet);
  if (ist !== erwartet) console.log(`         bekommen: ${ist}`);
}
// Die eigentliche Zusage: nie mehr als fuenf Zeichen, Dollarzeichen inbegriffen.
const zuBreit = [];
for (let e = -2; e <= 13; e++) {
  for (const f of [1, 1.4, 3.44, 7.81, 9.99]) {
    const s = kurzUsd(f * 10 ** e);
    if (s.length > 5) zuBreit.push(`${f}e${e} -> ${s}`);
  }
}
check2('Kein Betrag wird breiter als fuenf Zeichen', zuBreit.length === 0);
if (zuBreit.length) console.log(`         ${zuBreit.slice(0, 5).join(', ')}`);

// ---------------------------------------------------------------------------
// Hier standen drei Abschnitte, die mit dem Chat weggefallen sind:
//
//   "Anzeige und Filter"    – msgHtml(), passesFilter(), toMessage(). Die
//                             Betragsspalte neben einer Chatzeile und die
//                             Frage, ob Ansem aus dem Filter faellt.
//   "Schreibrecht im Chat"  – renderChatGate() gegen min_chat_usd.
//   "Antworten und Zitate"  – msgHtml() mit Zitat, auch wenn das Original aus
//                             dem Filter gefallen ist.
//
// Von den drei Zusagen gilt eine weiter, und sie wird unten geprueft: Ein
// Zitat muss auch dann dastehen, wenn das Original nicht mehr da ist. In den
// DMs ist der Weg dorthin ein anderer – ein Gespraech wird immer vollstaendig
// geladen, es gibt keinen Filter, aus dem etwas fallen koennte.
//
// Das Schreibrecht selbst ist nicht ungeprueft: renderDmGate() haengt an
// min_dm_usd und steht weiter unten.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Antworten in DMs
// ---------------------------------------------------------------------------

state.me = { wallet: 'Km9xxx', handle: 'Km9', usd: 500, isAdmin: true };
state.cfg.symbol = 'ANSEM';

const dmFrage = { id: 8, wallet: 'bH2yyy', from_admin: false, reply_to: null,
                  body: 'Is the unlock linear or cliff based?', created_at: '2026-08-25T12:00:00Z' };
const dmAntwort = { id: 9, wallet: 'bH2yyy', from_admin: true, reply_to: 8,
                    body: 'Cliff, then linear.', created_at: '2026-08-25T12:01:00Z' };
state.dmMessages = [dmFrage, dmAntwort];
pruefeDmAntworten(state.dmMessages);

check2('DM-Spalte erkannt', state.dmRepliesAvailable === true);
check2('DM traegt einen Antwortknopf', dmHtml(dmFrage).includes('data-dm-reply="8"'));
// Die Blase traegt weiter .msg – die Klasse stammt aus dem Chat, und an ihr
// haengen Zitat, Antwortpfeil und Aufleuchten. Wer sie hier wegnimmt, nimmt
// alle drei mit.
check2('DM traegt weiterhin .msg', dmHtml(dmFrage).includes('class="msg dm'));
// Der Pfeil steht neben der Blase, nicht darin – sonst schoebe er beim
// Erscheinen den Text.
const teile = dmHtml(dmFrage);
check2('Antwortpfeil steht ausserhalb der Blase',
  teile.indexOf('</div>') < teile.indexOf('reply-btn'));
check2('Zeile umschliesst Blase und Pfeil', teile.startsWith('<div class="dm-row'));
check2('Zitat ohne Namen', !dmQuoteHtml(dmAntwort).includes('class="h'));
check2('DM hat Zeit im meta-Feld', dmHtml(dmFrage).includes('<span class="meta"'));
check2('DM ohne Namensspalte', !dmHtml(dmFrage).includes('class="who"'));
check2('Antwort bekommt has-quote', dmHtml(dmAntwort).includes('has-quote'));
check2('DM-Antwort zeigt das Zitat', dmQuoteHtml(dmAntwort).includes('Is the unlock linear'));
check2('Zitat springt zur Ursprungsnachricht', dmQuoteHtml(dmAntwort).includes('data-dm-goto="8"'));
check2('Ohne Bezug kein Zitat', dmQuoteHtml(dmFrage) === '');

// Geloeschtes Original: Hinweis statt wiederhergestelltem Text
state.dmMessages = [dmAntwort];
check2('Geloeschtes Original wird benannt', dmQuoteHtml(dmAntwort).includes('is-gone'));

// Kennt die Datenbank die Spalte nicht, verschwindet der Knopf per Klasse
pruefeDmAntworten([{ id: 1, wallet: 'a', from_admin: false, body: 'x', created_at: 'y' }]);
check2('Ohne Spalte keine Antworten', state.dmRepliesAvailable === false);
check2('Ohne Spalte wird der Bereich markiert',
  el('#dm-admin').classList.contains('no-replies'));
state.dmMessages = [dmFrage, dmAntwort];
pruefeDmAntworten(state.dmMessages);

// ---------------------------------------------------------------------------
// Datumstrenner in Gespraechen
// ---------------------------------------------------------------------------
// Ein Faden laeuft ueber Tage. Ohne Trenner steht dort nur eine Uhrzeit, und
// "09:12" sagt nicht, ob das heute frueh war oder vor drei Wochen.

const heute = new Date();
const tagVor = (n) => {
  const d = new Date(heute);
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

check2('Heute heisst Today', tagLabel(tagVor(0)) === 'Today');
check2('Gestern heisst Yesterday', tagLabel(tagVor(1)) === 'Yesterday');
check2('Vorgestern zeigt ein Datum',
  !['Today','Yesterday'].includes(tagLabel(tagVor(2))));
check2('Aelteres Jahr traegt die Jahreszahl',
  /\d{4}/.test(tagLabel('2021-03-14T12:00:00Z')));
check2('Dieses Jahr ohne Jahreszahl', !/\d{4}/.test(tagLabel(tagVor(40))));

// Der Vergleich muss ueber den Tagesbeginn laufen, nicht ueber den Abstand:
// 23:58 und 00:03 liegen fuenf Minuten auseinander und sind zwei Tage.
state.me = { wallet: 'Km9xxx', handle: 'Km9', usd: 500, isAdmin: true };
const g = (id, iso, body) => ({ id, wallet: 'bH2yyy', from_admin: false, reply_to: null,
  body, created_at: iso });
const spaet = new Date(heute); spaet.setDate(spaet.getDate() - 3); spaet.setHours(23, 58, 0, 0);
const frueh = new Date(spaet); frueh.setDate(frueh.getDate() + 1); frueh.setHours(0, 3, 0, 0);
state.dmMessages = [g(1, spaet.toISOString(), 'a'), g(2, frueh.toISOString(), 'b')];
const verlauf = dmListeHtml(state.dmMessages);
check2('Mitternacht trennt zwei Tage',
  (verlauf.match(/day-sep/g) || []).length === 2);

state.dmMessages = [g(1, tagVor(0), 'a'), g(2, tagVor(0), 'b'), g(3, tagVor(0), 'c')];
check2('Ein Tag, ein Trenner',
  (dmListeHtml(state.dmMessages).match(/day-sep/g) || []).length === 1);
check2('Trenner steht vor der Nachricht',
  dmListeHtml(state.dmMessages).indexOf('day-sep') < dmListeHtml(state.dmMessages).indexOf('dm-row'));

// ---------------------------------------------------------------------------
// Zahlenfelder nehmen nur Zahlen
// ---------------------------------------------------------------------------
// Beide Felder sind type="text", weil ein Zahlenfeld die winzigen Auf-/Ab-
// Pfeile einblendet. Damit prueft der Browser nichts mehr – das passiert hier.

check2('Buchstaben fallen raus', saubereZahl('12ab3') === '123');
check2('Sonderzeichen fallen raus', saubereZahl('1$2 %3!') === '123');
// Kommas sind in diesem Feld das Tausendertrennzeichen und werden von der
// Anzeige gesetzt – beim Auslesen fallen sie weg.
check2('Tausendertrennzeichen faellt beim Lesen weg', saubereZahl('1,000') === '1000');
check2('Nur ein Dezimaltrennzeichen', saubereZahl('1.2.3') === '1.23');

// --- Gruppierung: ab vier Stellen ---
check2('Drei Stellen bleiben ungruppiert', gruppiere('999') === '999');
check2('Vier Stellen werden gruppiert', gruppiere('1000') === '1,000');
check2('Fuenf Stellen', gruppiere('12480') === '12,480');
check2('Sechs Stellen', gruppiere('100000') === '100,000');
check2('Sieben Stellen', gruppiere('1200000') === '1,200,000');
check2('Nachkommastellen bleiben ungruppiert', gruppiere('1234.5678') === '1,234.5678');
check2('Leeres bleibt leer beim Gruppieren', gruppiere('') === '');
check2('Fuehrender Punkt uebersteht', gruppiere('.5') === '.5');
// Hin und zurueck muss dasselbe ergeben – sonst waeren Anzeige und Wert
// irgendwann verschiedener Meinung.
check2('Gruppieren und wieder lesen ergibt das Original',
  saubereZahl(gruppiere('1234567.89')) === '1234567.89');
check2('Minus faellt raus', saubereZahl('-5') === '5');
check2('Leeres bleibt leer', saubereZahl('') === '');
check2('Reiner Text ergibt nichts', saubereZahl('abc') === '');
check2('Fuehrendes Trennzeichen bleibt', saubereZahl('.5') === '.5');
check2('Sauberes bleibt unveraendert', saubereZahl('10000') === '10000');

// --- Wie lang die Zahl werden darf ---
// Zehn Stellen vor dem Punkt, danach kommt keine mehr durch. Geprueft wird
// gegen MAX_STELLEN und nicht gegen die 10: Verschiebt sich die Grenze, soll
// das hier mitgehen – falsch waere erst, wenn Feld und Datenbank verschiedene
// Zahlen kennen, und genau das prueft der Abschnitt weiter unten.
const zehn = '1'.repeat(MAX_STELLEN);
check2('Volle Laenge bleibt stehen', saubereZahl(zehn) === zehn);
check2('Eine Stelle mehr faellt weg', saubereZahl(`${zehn}9`) === zehn);
check2('Und auch viele mehr', saubereZahl(`${zehn}999999`) === zehn);
// Nachkommastellen zaehlen nicht mit – sie machen die Zahl nicht groesser.
check2('Nachkommastellen bleiben von der Grenze unberuehrt',
  saubereZahl(`${zehn}.55`) === `${zehn}.55`,
  saubereZahl(`${zehn}.55`));
check2('Auch bei abgeschnittener Zahl bleibt das Komma-Ende erhalten',
  saubereZahl(`${zehn}99.5`) === `${zehn}.5`);
// Und die Grenze ist genau der groesste erlaubte Wert – nicht eine Zahl
// daneben. Ein Feld, das 9999999999 annimmt, waehrend die Grenze bei
// 1000000000 laege, waere die eine Stelle, die es hier nicht geben darf.
check2('Die Obergrenze ist die groesste Zahl, die ins Feld passt',
  MAX_DM_SCHWELLE === Number(zehn.replace(/1/g, '9')), String(MAX_DM_SCHWELLE));

// ---------------------------------------------------------------------------
// Posteingang folgt der DM-Schwelle
// ---------------------------------------------------------------------------
// Wer weniger haelt als die Schwelle, taucht nicht auf.
// Wichtig ist, dass nichts geloescht wird – beim Senken sind alle wieder da.

state.dmThreads = [
  { wallet: 'aaa', usd: 31500, preview: 'gross', tokens: 1, unread: 2, last_from_admin: false },
  { wallet: 'bbb', usd: 12,    preview: 'knapp drueber', tokens: 1, unread: 0, last_from_admin: true },
  { wallet: 'ccc', usd: 3,     preview: 'zu klein', tokens: 1, unread: 0, last_from_admin: false },
];

state.cfg.min_dm_usd = 0;
renderThreads();
check2('Ohne Schwelle alle Gespraeche', el('#thread-items').innerHTML.includes('ccc'));
// Hier stand eine Pruefung auf #thread-hidden – die Zeile, die zaehlte, wie
// viele Gespraeche die Schwelle ausblendet. Sie ist raus: Der Regler steht
// direkt darueber und sagt dieselbe Sache. Was bleibt, ist die Wirkung selbst,
// und die wird weiter unten geprueft.

// Hat Ansem zuletzt geschrieben, steht "You:" vor der Vorschau.
//
// Hier stand das Gegenteil, und die Begruendung war: In einer Liste aus
// Kuerzeln, Text und Betraegen ist der Zusatz ein vierter Bestandteil, und die
// Zeile wird davon unruhig. Das galt fuer die Zeile, wie sie damals war –
// inzwischen endet die Vorschau nach 16 Zeichen und rechts davon ist Luft.
//
// Und die Auskunft ist mehr wert, als sie damals schien: Ohne sie liest sich
// die eigene letzte Antwort wie eine neue Nachricht des anderen. Bei vierzig
// Gespraechen, von denen die meisten beantwortet sind, ist das die haeufigste
// Zeile.
//
// Geprueft werden BEIDE Faelle. Eine Regel, die den Zusatz immer oder nie
// setzt, bestuende die halbe Pruefung – und die haeufigere Zeile ist
// ausgerechnet die ohne.
{
  const zeile = (wallet) => {
    const m = new RegExp(
      `<button class="thread[^"]*"[^>]*data-wallet="${wallet}"[\\s\\S]*?</button>`)
      .exec(el('#thread-items').innerHTML);
    return m ? m[0] : '';
  };
  // bbb: last_from_admin true, ccc: false – siehe die Fixture oben.
  check2('Nach Ansems Antwort steht "You:" davor', zeile('bbb').includes('>You:<'));
  check2('Nach einer fremden Nachricht nicht', !zeile('ccc').includes('You:'));
  // Als eigenes Element und nicht im Vorschautext: Sonst frisst es von den
  // 16 Zeichen, die die Vorschau hat, und wuerde selbst mitgekuerzt.
  check2('Und es steht ausserhalb der Vorschau',
    zeile('bbb').includes('<span class="thread-du">You:</span>')
    && !zeile('bbb').includes('thread-prev">You:'));

  // Und die Vorschauen enden alle an derselben Stelle – mit "You:" davor wie
  // ohne. Das geht nur ueber die gerenderte Breite; die Regel im Blatt rechnet
  // mit ch und rem, und ob die Rechnung aufgeht, sagt erst der Browser.
  //
  // Geprueft wird das in einem eigenen Skript mit echtem Browser
  // (test-dm-verbergen.mjs). Hier steht nur, dass die Rechnung ueberhaupt da
  // ist: Wer die zweite Breite entfernt, franst die Kante wieder aus.
  const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  check2('Die Zeile mit "You:" bekommt eine eigene, kuerzere Vorschaubreite',
    /\.thread-du \+ \.thread-prev \{[^}]*max-width: calc\(var\(--vorschau\)/s.test(css));
}

// --- Ungeoeffnete Gespraeche ---
// Genau die Zeilen mit offenem Zaehler tragen die Klasse, keine andere.
const zeilen = () => [...el('#thread-items').innerHTML.matchAll(
  /<button class="thread ([^"]*)"[\s\S]*?data-wallet="([^"]+)"/g)]
  .map(([, klassen, wallet]) => ({ wallet, unread: klassen.includes('is-unread') }));

check2('Ungelesenes Gespraech traegt is-unread',
  zeilen().find((z) => z.wallet === 'aaa').unread === true);
check2('Gelesenes Gespraech traegt es nicht',
  zeilen().every((z) => z.wallet === 'aaa' || !z.unread));

renderThreads();

state.cfg.min_dm_usd = 10;
renderThreads();
const liste = el('#thread-items').innerHTML;
check2('Zu kleiner Bestand faellt raus', !liste.includes('ccc'));
check2('Knapp darueber bleibt', liste.includes('bbb'));
// Senken bringt alles zurueck – nichts wurde geloescht.
state.cfg.min_dm_usd = 0;
renderThreads();
check2('Senken bringt die Gespraeche zurueck', el('#thread-items').innerHTML.includes('ccc'));

// Beim Tippen gilt schon der Entwurf, bevor irgendetwas gespeichert wurde.
// Bewusst ueber das echte Feld und sein input-Ereignis, nicht durch Setzen von
// state.dmMinEntwurf: Genau dieser Zuhoerer ist einmal beim Aufraeumen
// verschwunden, und ein Test auf den Zustand allein haette das nicht gemerkt.
check2('Schwellenfeld hoert auf Eingaben', el('#dm-min-input').__hat('input'));

state.cfg.min_dm_usd = 0;
state.dmMinEntwurf = null;
el('#dm-min-input').value = '20000';
el('#dm-min-input').__fire('input');
check2('Tippen filtert sofort, ohne Speichern', Number(state.dmMinEntwurf) === 20000);
renderThreads();
check2('Entwurf filtert sofort', !el('#thread-items').innerHTML.includes('bbb'));
check2('Entwurf laesst Grosse stehen', el('#thread-items').innerHTML.includes('aaa'));
check2('Gespeicherter Wert bleibt unberuehrt', Number(state.cfg.min_dm_usd) === 0);

// Ein leeres Feld heisst nicht mehr "keine Schwelle", sondern die
// Untergrenze. Geprueft wird gegen MIN_DM_SCHWELLE und nicht gegen 1000:
// Wandert die Zahl, soll dieser Test mitwandern – falsch waere erst, wenn
// das Loeschen wieder unter die Grenze fuehrt.
el('#dm-min-input').value = '';
el('#dm-min-input').__fire('input');
check2('Leeres Feld faellt auf die Untergrenze',
  Number(state.dmMinEntwurf) === MIN_DM_SCHWELLE);

// Auch eine getippte Zahl darunter. Das ist der eigentliche Punkt: Beim
// Tippen von "1", "10", "100" darf der Posteingang nicht drei Zustaende
// zeigen, die es nach dem Loslassen nicht gibt.
el('#dm-min-input').value = '100';
el('#dm-min-input').__fire('input');
check2('Zu kleine Eingabe wird im Entwurf angehoben',
  Number(state.dmMinEntwurf) === MIN_DM_SCHWELLE);
renderThreads();
check2('Unter der Untergrenze bleibt niemand Kleines stehen',
  !el('#thread-items').innerHTML.includes('ccc'));
check2('Ueber der Untergrenze bleibt das grosse Gespraech',
  el('#thread-items').innerHTML.includes('aaa'));
state.dmMinEntwurf = null;

// ---------------------------------------------------------------------------
// Die Untergrenze: nichts unter $1.000
// ---------------------------------------------------------------------------
// Der Posteingang laesst sich nicht mehr ganz oeffnen. Hier stand das
// Gegenteil – ein leeres Feld hiess 0, also aus, mit der Begruendung: Wer die
// Zahl loescht, will sie loswerden.
//
// Das galt, solange 0 ein erlaubter Wert war. Und es war ausserdem die
// gefaehrlichste Stelle der ganzen Oberflaeche: Wer die Zahl markierte und
// loeschte, um eine neue zu tippen, und dann wegklickte, hatte den
// Posteingang fuer alle geoeffnet – ohne einen Schritt, der danach aussah.
//
// Angehoben statt abgelehnt, und zwar NUR hier im Formular: Wer gerade tippt,
// soll keine rote Meldung fuer eine Zahl bekommen, die die Seite selbst kennt.
// Die Datenbank lehnt dagegen ab (Migration 20260831030000) – sie ist die
// Sperre, das hier ist die Hoeflichkeit davor.
const echteDb = state.db;
let gesendet = null;
state.db = { rpc: async (name, args) => { gesendet = { name, args }; return { data: args.p_usd, error: null }; } };

state.cfg.min_dm_usd = 25;
el('#dm-min-input').value = '';
await speichereDmMin();
check2('Leeres Feld speichert die Untergrenze',
  gesendet?.args?.p_usd === MIN_DM_SCHWELLE, JSON.stringify(gesendet));
check2('Gespeichert ist danach die Untergrenze',
  Number(state.cfg.min_dm_usd) === MIN_DM_SCHWELLE);
// Und das Feld steht nicht leer da. Genau das war die Rueckfrage: Wer alles
// loescht, soll die 1.000 sehen und nicht einen leeren Kasten, dem man nicht
// ansieht, was gilt.
check2('Nach dem Loeschen steht die Zahl wieder im Feld',
  el('#dm-min-input').value === gruppiere(MIN_DM_SCHWELLE),
  el('#dm-min-input').value);

// Nur ein Punkt ist auch keine Zahl – und faellt auf dasselbe zurueck.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '.';
await speichereDmMin();
check2('Alleinstehender Punkt speichert die Untergrenze',
  gesendet?.args?.p_usd === MIN_DM_SCHWELLE);

// Eine getippte Zahl unter der Grenze wird angehoben, nicht abgelehnt.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '500';
await speichereDmMin();
check2('Zu kleine Zahl wird angehoben statt abgelehnt',
  gesendet?.args?.p_usd === MIN_DM_SCHWELLE, JSON.stringify(gesendet));
check2('Angehoben heisst auch: kein Fehler, sondern die Zahl im Feld',
  el('#dm-min-input').value === gruppiere(MIN_DM_SCHWELLE),
  el('#dm-min-input').value);

// Darueber bleibt getippt, was getippt wurde.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '5,000';
await speichereDmMin();
check2('Ueber der Grenze bleibt die Eingabe stehen',
  gesendet?.args?.p_usd === 5000, JSON.stringify(gesendet));

// Auch die groesste Zahl, die ins Feld passt, geht unveraendert durch – sie
// ist erlaubt, nicht gerade noch geduldet.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = gruppiere(String(MAX_DM_SCHWELLE));
await speichereDmMin();
check2('Die volle Laenge wird gespeichert, nicht gedeckelt',
  gesendet?.args?.p_usd === MAX_DM_SCHWELLE, JSON.stringify(gesendet));

// Zu viele Stellen kommen gar nicht erst durch – saubereZahl schneidet ab.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '99,999,999,999,999';
await speichereDmMin();
check2('Zu lange Zahlen werden auf die volle Laenge gekuerzt',
  gesendet?.args?.p_usd === MAX_DM_SCHWELLE, JSON.stringify(gesendet));

// Der eine Weg, auf dem die Zahl trotzdem zu gross wird: Nachkommastellen
// zaehlen nicht mit, und 9999999999.99 ist groesser als 9999999999. Ohne den
// Deckel im Speichern ginge genau dieser Wert an die Datenbank – die ihn
// ablehnen wuerde, obwohl das Feld ihn hat tippen lassen.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = `${gruppiere(String(MAX_DM_SCHWELLE))}.99`;
await speichereDmMin();
check2('Nachkommastellen heben die Zahl nicht ueber die Grenze',
  gesendet?.args?.p_usd === MAX_DM_SCHWELLE, JSON.stringify(gesendet));

// Die Untergrenze ist bereits der gespeicherte Stand: Loeschen aendert dann
// nichts und darf auch nichts schreiben.
gesendet = null;
state.cfg.min_dm_usd = MIN_DM_SCHWELLE;
el('#dm-min-input').value = '';
await speichereDmMin();
check2('Loeschen auf dem Mindestwert schreibt nichts', gesendet === null);
check2('Und das Feld zeigt trotzdem die Zahl',
  el('#dm-min-input').value === gruppiere(MIN_DM_SCHWELLE),
  el('#dm-min-input').value);

// Unveraendert heisst: gar nicht schreiben.
gesendet = null;
state.cfg.min_dm_usd = 10000;
el('#dm-min-input').value = '10,000';
await speichereDmMin();
check2('Ohne Aenderung wird nichts geschrieben', gesendet === null);

state.db = echteDb;
state.cfg.min_dm_usd = 0;

// Die Datenbank haelt dieselbe Zahl – sonst waere das Formular hier
// hoeflich zu einem Wert, den die Sperre dahinter ablehnt.
const untergrenzeSql = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260831030000_dm_untergrenze.sql'), 'utf8');
check2('Migration lehnt unterhalb derselben Zahl ab',
  new RegExp(`p_usd\\s*<\\s*${MIN_DM_SCHWELLE}\\b`).test(untergrenzeSql));
check2('Migration hebt bestehende Zeilen auf dieselbe Zahl',
  new RegExp(`min_dm_usd\\s*=\\s*${MIN_DM_SCHWELLE}\\b`).test(untergrenzeSql));
// Und dasselbe am oberen Ende. Das ist die Zahl, die auseinanderlaufen kann,
// ohne dass es auffaellt: Das Feld nimmt zehn Stellen an, die Datenbank
// lehnte bis eben ab sieben ab. Wer dann 5.000.000.000 tippte, bekam eine
// rote Meldung fuer eine Zahl, die die Seite selbst hatte tippen lassen.
check2('Migration erlaubt genau bis zur Obergrenze des Feldes',
  new RegExp(`p_usd\\s*>\\s*${MAX_DM_SCHWELLE}\\b`).test(untergrenzeSql));

// ---------------------------------------------------------------------------
// Der Rollstrich im Posteingang
// ---------------------------------------------------------------------------
// Er ist immer gezeichnet und nur beim Rollen eingefaerbt – eine selbst
// gestaltete Rollleiste steht in Chrome sonst dauerhaft da, und das
// Verschwinden, das man vom Betriebssystem kennt, gehoert zur ueberlagerten
// Leiste, die keine Pixelbreite kennt.
//
// Getragen wird das von einer Klasse, die hier gesetzt und wieder
// weggenommen wird. Faellt der Zuhoerer weg, sieht man nichts: Der Strich
// bliebe schlicht immer unsichtbar, und die Liste saehe aus wie vorher – nur
// ohne jede Anzeige, wo man steht. Genau diese Sorte Verlust hat sich hier
// schon einmal am Schwellenfeld versteckt.
{
  const liste = el('#thread-items');
  const strich = el('#thread-strich');
  // Die Attrappe hat keine Masse – hier gesetzt, damit sich die Rechnung
  // pruefen laesst: 209 px Bahn.
  strich.style = {};
  liste.clientHeight = 209;
  liste.scrollHeight = 1463;

  const hoch = () => parseFloat(strich.style.height);
  const oben = () => parseFloat(strich.style.top);

  check2('Die Liste hoert aufs Rollen', liste.__hat('scroll'));

  liste.classList.remove('rollt');
  liste.scrollTop = 0;
  liste.__fire('scroll');
  check2('Beim Rollen traegt sie die Klasse', liste.classList.contains('rollt'));

  // --- Wie lang sie wird ---
  // Nach Anteil, aber mit Deckel und Boden. Der Anteil allein waere bei acht
  // Gespraechen ein Streifen ueber die halbe Bahn, ohne Boden bei sehr langen
  // Listen ein Punkt, den man beim Rollen verliert.
  check2('Bei einer langen Liste ist sie kurz',
    hoch() === Math.round(209 * 209 / 1463), `${hoch()} px`);

  // Kurze Liste, gerade eben laenger als der Kasten: ohne Deckel waeren das
  // fast 200 px.
  liste.scrollHeight = 240;
  liste.scrollTop = 0;
  liste.__fire('scroll');
  check2('Bei einer kurzen Liste bleibt der Deckel',
    hoch() === STRICH_MAX, `${hoch()} px statt ${Math.round(209 * 209 / 240)}`);

  // Sehr lange Liste: ohne Boden waeren das 3 px.
  liste.scrollHeight = 14000;
  liste.__fire('scroll');
  check2('Bei einer sehr langen Liste haelt der Boden',
    hoch() === STRICH_MIN, `${hoch()} px statt ${Math.round(209 * 209 / 14000)}`);

  liste.scrollHeight = 1463;
  liste.scrollTop = 0;
  liste.__fire('scroll');

  // --- Wo sie steht ---
  check2('Ganz oben steht sie ganz oben', oben() === 0, strich.style.top);

  liste.scrollTop = liste.scrollHeight - liste.clientHeight;
  liste.__fire('scroll');
  check2('Ganz unten steht sie ganz unten',
    oben() === 209 - hoch(), `${strich.style.top} bei ${hoch()} px Marke`);

  liste.scrollTop = (liste.scrollHeight - liste.clientHeight) / 2;
  liste.__fire('scroll');
  check2('Und in der Mitte in der Mitte',
    oben() === Math.round((209 - hoch()) / 2), strich.style.top);

  // Die Marke faellt nie unten heraus – das waere sie sonst, wenn die Hoehe
  // aus der vorigen Rechnung stammte und die Lage aus der neuen.
  for (const gesamt of [240, 800, 1463, 14000]) {
    liste.scrollHeight = gesamt;
    liste.scrollTop = gesamt - liste.clientHeight;
    liste.__fire('scroll');
    if (oben() + hoch() > 209) {
      check2(`Marke bleibt im Kasten (${gesamt} px Liste)`, false,
        `${oben()} + ${hoch()} > 209`);
    }
  }
  check2('Marke bleibt bei jeder Listenlaenge im Kasten', true);
  liste.scrollHeight = 1463;

  // Nichts zu rollen: dann gibt es auch keine Stelle, an der man stuende.
  liste.scrollHeight = liste.clientHeight;
  liste.scrollTop = 0;
  liste.__fire('scroll');
  check2('Ohne Rollweg bleibt sie weg', !liste.classList.contains('rollt'));
  liste.scrollHeight = 1463;
  liste.__fire('scroll');

  // Und sie geht wieder. Gewartet wird ueber die Zahl aus app.js, nicht ueber
  // eine hier abgeschriebene: Sonst prueft man nach einer Aenderung an ihr
  // gegen die alte Spanne und bekommt einen Fehlschlag, der keiner ist.
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT + 120));
  check2('Danach ist sie wieder weg', !liste.classList.contains('rollt'));

  // Nachschieben verlaengert, statt zwischendurch abzuschalten: Wer mit dem
  // Finger nachsetzt, soll den Strich nicht verlieren.
  liste.__fire('scroll');
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT * 0.6));
  liste.__fire('scroll');
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT * 0.6));
  check2('Nachschieben haelt den Strich', liste.classList.contains('rollt'));
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT + 120));
  check2('Und danach geht er doch', !liste.classList.contains('rollt'));
}

// ---------------------------------------------------------------------------
// Gelesen markieren: erst die Ansicht, dann die Datenbank
// ---------------------------------------------------------------------------
// Beim Durchgehen vieler Gespraeche darf die blaue Flaeche nicht erst
// verschwinden, wenn der Server geantwortet hat. Schlaegt das Speichern fehl,
// muss sie zurueckkommen – sonst zeigt die Liste einen Stand, den nur dieser
// Browser kennt.

// Ein Zaehler, der die Kette .from().update().eq().eq().eq() mitschreibt und
// am Ende auflaesst. Der fakeDb-Proxy taugt hier nicht: Er liefert fuer jede
// Eigenschaft eine Funktion, also auch fuer 'error'.
function dmDbStub(fehler) {
  let aufgerufen = 0;
  const kette = {
    update() { return kette; },
    eq() { return kette; },
    then(aufloesen) { aufgerufen++; aufloesen({ error: fehler }); },
  };
  return { db: { from: () => kette }, zaehler: () => aufgerufen };
}

state.cfg.min_dm_usd = 0;
state.dmThreads = [
  { wallet: 'aaa', usd: 31500, preview: 'gross', tokens: 1, unread: 2 },
  { wallet: 'bbb', usd: 12, preview: 'klein', tokens: 1, unread: 0 },
];

const gut = dmDbStub(null);
state.db = gut.db;
await markiereGelesen('aaa');
check2('Gelesen markieren schreibt in die Datenbank', gut.zaehler() === 1);
check2('Zaehler steht danach auf null',
  Number(state.dmThreads.find((t) => t.wallet === 'aaa').unread) === 0);
check2('Blaue Flaeche ist weg',
  !el('#thread-items').innerHTML.includes('is-unread'));

// Fehlschlag: Der Zaehler kommt zurueck, gemeldet wird nichts.
state.dmThreads.find((t) => t.wallet === 'aaa').unread = 2;
const schlecht = dmDbStub({ message: 'kein Netz' });
state.db = schlecht.db;
await markiereGelesen('aaa');
check2('Nach Fehlschlag steht der Zaehler wieder',
  Number(state.dmThreads.find((t) => t.wallet === 'aaa').unread) === 2);
check2('Nach Fehlschlag ist die Flaeche wieder blau',
  el('#thread-items').innerHTML.includes('is-unread'));

// Ein bereits gelesenes Gespraech zeichnet die Liste nicht neu, schreibt aber
// trotzdem – die Abfrage trifft dann einfach keine Zeile.
const nochmal = dmDbStub(null);
state.db = nochmal.db;
await markiereGelesen('bbb');
check2('Gelesenes Gespraech schreibt trotzdem', nochmal.zaehler() === 1);
check2('Gelesenes Gespraech bleibt bei null',
  Number(state.dmThreads.find((t) => t.wallet === 'bbb').unread) === 0);

// Ein Gespraech, das die Liste gar nicht kennt, darf nicht stolpern.
const unbekannt = dmDbStub(null);
state.db = unbekannt.db;
await markiereGelesen('gibtsnicht');
check2('Unbekanntes Gespraech schreibt ohne Fehler', unbekannt.zaehler() === 1);

// ---------------------------------------------------------------------------
// Der Punkt verschwindet beim Oeffnen, nicht nach der Antwort des Servers
// ---------------------------------------------------------------------------
// Das ist einmal kaputtgegangen, und zwar unsichtbar: Der Demomodus stieg aus
// openThread() aus, BEVOR markiereGelesen() drankam. Man klickte ein
// ungelesenes Gespraech an, las es, und die Liste behauptete weiter, da sei
// etwas offen.
//
// Geprueft wird deshalb die REIHENFOLGE in openThread() – dass der Vermerk vor
// jedem Ausstieg steht – und die Wirkung: Der Zaehler ist sofort null, ohne auf
// die Datenbank zu warten.
{
  const quelle = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const koerper = quelle.slice(quelle.indexOf('async function openThread'),
    quelle.indexOf('\n}', quelle.indexOf('async function openThread')));
  check2('markiereGelesen steht vor jedem return in openThread',
    koerper.indexOf('markiereGelesen(wallet)') < koerper.indexOf('return;'));

  // Das geoeffnete Demogespraech muss dasselbe sagen wie die Zeile davor.
  //
  // Hier stand als letzte Nachricht fest verdrahtet Ansem mit "will look at
  // it" – in JEDEM Gespraech, auch in denen, die in der Liste ohne "You:"
  // stehen. Die Vorschau lag eine Zeile darueber, war also gar nicht die
  // letzte Nachricht.
  //
  // Geprueft wird die Verbindung selbst: Die letzte der drei Zeilen traegt den
  // Vorschautext, und ihr Absender kommt aus derselben Angabe, aus der die
  // Liste ihr "You:" nimmt. Ein fester Wert an einer der beiden Stellen faellt
  // damit auf.
  check2('Die letzte Demo-Nachricht ist die Vorschau, vom Absender der Liste',
    /from_admin: duZuletzt, body: zeile\?\.preview/.test(koerper));
  check2('Und duZuletzt kommt aus last_from_admin',
    /const duZuletzt = !!zeile\?\.last_from_admin/.test(koerper));

  // Und die Wirkung, ueber die echte Funktion: Der Server wird aufgehalten,
  // der Zaehler muss trotzdem schon null sein.
  state.dmThreads = [{ wallet: 'zzz', usd: 100, tokens: 1, unread: 3, preview: 'x', last_from_admin: false }];
  let loesen;
  state.db = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({
    eq: () => new Promise((r) => { loesen = () => r({ error: null }); }) }) }) }) }) };
  const laeuft = markiereGelesen('zzz');
  check2('Der Zaehler ist sofort null, vor der Antwort des Servers',
    Number(state.dmThreads[0].unread) === 0, String(state.dmThreads[0].unread));
  renderThreads();
  check2('Und die Zeile traegt is-unread nicht mehr',
    !el('#thread-items').innerHTML.includes('is-unread'));
  loesen();
  await laeuft;
  state.db = echteDb;
}

state.db = echteDb;

// ---------------------------------------------------------------------------
// Adminvorschau: nur auf dem eigenen Rechner
// ---------------------------------------------------------------------------
// Die eigentliche Sperre gegen fremde Adminrechte sitzt in der Datenbank. Aber
// eine Oberflaeche, die auf der echten Seite Ansems Posteingang zeigt, waere
// trotzdem falsch – deshalb wird hier geprueft, dass der Parameter dort nichts
// bewirkt. Modul jeweils frisch laden, weil der Wert beim Start gelesen wird.
const { PREVIEW_ADMIN: jetzt } = globalThis.__test;
check2('Ohne Parameter keine Vorschau', jetzt === false);

async function ladeMit(search, hostname) {
  globalThis.location = { search, hostname, href: `https://${hostname}/${search}` };
  globalThis.window.location = globalThis.location;
  // Der Dateiname muss je Aufruf verschieden sein: Node legt geladene Module
  // ab, ein zweiter Import desselben Pfades laeuft nicht noch einmal – und
  // beide Werte werden beim Start gelesen.
  const zweit = path.join(root,
    `.test-app-${hostname.replace(/\W/g, '')}-${search.replace(/\W/g, '')}.mjs`);
  fs.writeFileSync(zweit, src);
  try {
    await import('file://' + zweit);
    return {
      preview: globalThis.__test.PREVIEW_ADMIN,
      demo: globalThis.__test.DEMO_DMS,
      demoThreads: globalThis.__test.demoThreads,
      demoPolls: globalThis.__test.demoPolls,
    };
  } finally { fs.unlinkSync(zweit); }
}

check2('Vorschau greift auf localhost',
  (await ladeMit('?preview=admin', 'localhost')).preview === true);
check2('Vorschau greift NICHT auf der echten Seite',
  (await ladeMit('?preview=admin', 'sized.gg')).preview === false);
// ---------------------------------------------------------------------------
// Der Demomodus: dieselbe Sperre, und aus einem schaerferen Grund
// ---------------------------------------------------------------------------
// ?demo=40 fuellt den Posteingang mit erfundenen Gespraechen. Auf der echten
// Seite waere das keine Vorschau, sondern eine Luege: vierzig Unterhaltungen,
// die es nicht gibt, mit Betraegen, die niemand haelt. Und weil im Demomodus
// nichts geladen wird, saehe man auch die echten nicht mehr.
//
// Geprueft wird deshalb beides – dass er hier greift UND dass er dort nicht
// greift. Nur zusammen ist es eine Aussage.
{
  const daheim = await ladeMit('?demo=40', 'localhost');
  check2('Demomodus greift auf localhost', daheim.demo === 40);
  const draussen = await ladeMit('?demo=40', 'sized.gg');
  check2('Demomodus greift NICHT auf der echten Seite', draussen.demo === 0);
  const sub = await ladeMit('?demo=40', 'evil.localhost.example.com');
  check2('Und auch nicht auf einer Unterdomain', sub.demo === 0);
  // Ohne Zahl vierzig, mit Zahl die Zahl – und gedeckelt, damit ein Vertipper
  // nicht fuenfzigtausend Zeilen baut.
  check2('Ohne Zahl sind es vierzig',
    (await ladeMit('?demo', 'localhost')).demo === 40);
  check2('Mit Zahl die Zahl',
    (await ladeMit('?demo=7', 'localhost')).demo === 7);
  check2('Nach oben gedeckelt',
    (await ladeMit('?demo=999999', 'localhost')).demo === 500);

  // Der gelbe Balken gehoert der Adminvorschau, nicht dem Demomodus.
  // ---------------------------------------------------------------------
  // Im Demomodus stand dort einmal ein Hinweis auf die erfundenen Daten. Er
  // ist raus, weil er in jedem Bildschirmfoto und jedem Mitschnitt quer ueber
  // dem unteren Rand lag – und ihn ohnehin nur sieht, wer ?demo= selbst
  // getippt hat.
  //
  // Geprueft wird die Bedingung im Quelltext, nicht das Bild: Der Balken wird
  // beim Start gesetzt, und den Start hier nachzustellen hiesse, die halbe
  // App nachzustellen. Was zaehlt, ist, dass DEMO_DMS in der Bedingung nicht
  // mehr vorkommt und PREVIEW_ADMIN schon.
  {
    const zeile = /flagge\.hidden = ([^;]+);/.exec(src);
    check2('Der Balken haengt noch an der Adminvorschau',
      !!zeile && zeile[1].includes('PREVIEW_ADMIN'), zeile?.[1]);
    check2('Und nicht mehr am Demomodus',
      !!zeile && !zeile[1].includes('DEMO_DMS'), zeile?.[1]);
    // Gegenprobe zur Pruefung selbst: Traefe der Ausdruck oben nichts, waeren
    // beide Zeilen still durchgefallen-nach-oben. Also muss er etwas treffen.
    check2('Gegenprobe: die Zeile wurde ueberhaupt gefunden', !!zeile);
    // Und der Text darf auch nicht auf einem anderen Weg zurueckkommen.
    check2('Kein Demotext, der den Balken doch wieder fuellt',
      !/flagge\.textContent/.test(src));
  }

  // Erfundene Daten muessen dieselben Regeln einhalten wie echte.
  //
  // Hier war eine falsch: last_from_admin wurde frei gewuerfelt, unabhaengig
  // vom Ungelesen-Zaehler. Im Bild standen dann Zeilen mit "You:" UND blauem
  // Punkt – ein Zustand, den es nicht geben kann. Ungelesen zaehlt Nachrichten
  // DES ANDEREN, die Ansem noch nicht gesehen hat; um zu antworten, muss er
  // das Gespraech oeffnen, und das vermerkt sie als gelesen.
  //
  // Der Schaden waere nicht der falsche Datensatz gewesen, sondern was man
  // daran entscheidet: Man prueft die Oberflaeche gegen einen Fall, den sie
  // nie sieht, und uebersieht dafuer, wie sie im echten aussieht.
  const bauen = daheim.demoThreads;
  const erfunden = bauen(200);
  check2('Erfundene Gespraeche: keins hat "You:" und offene Nachrichten zugleich',
    erfunden.every((t) => !(t.last_from_admin && Number(t.unread) > 0)),
    `${erfunden.filter((t) => t.last_from_admin && Number(t.unread) > 0).length} Widersprueche`);
  // Und die Gegenprobe: Beide Faelle muessen ueberhaupt vorkommen, sonst
  // bestuende die Regel nur, weil es nichts zu pruefen gibt.
  check2('Es gibt beide Faelle im Datensatz',
    erfunden.some((t) => t.last_from_admin) && erfunden.some((t) => Number(t.unread) > 0));

  // Dieselbe Regel eine Ebene tiefer: Wer die letzte Nachricht geschrieben
  // hat, entscheidet auch, wie sie klingt. Aus einem gemeinsamen Topf kam
  // "You: wen poll" – Ansem, der sich selbst nach einer Umfrage fragt.
  //
  // Geprueft wird, dass die beiden Textmengen sich nicht ueberschneiden. Das
  // kommt ohne die Listen selbst aus: Waeren es wieder dieselben Saetze,
  // taeuchten bei 200 Gespraechen zwangslaeufig welche in beiden auf.
  const vonAnsem = new Set(erfunden.filter((t) => t.last_from_admin).map((t) => t.preview));
  const vonNutzern = new Set(erfunden.filter((t) => !t.last_from_admin).map((t) => t.preview));
  check2('Ansem und die Nutzer schreiben nicht dieselben Saetze',
    [...vonAnsem].every((s) => !vonNutzern.has(s)),
    [...vonAnsem].filter((s) => vonNutzern.has(s)).join(' | '));
  check2('Und beide Mengen sind ueberhaupt gefuellt',
    vonAnsem.size > 1 && vonNutzern.size > 1, `${vonAnsem.size} / ${vonNutzern.size}`);
}

// ---------------------------------------------------------------------------
// Was der Demomodus sonst noch faelscht
// ---------------------------------------------------------------------------
// Nicht nur Gespraeche: auch drei Abstimmungen und die eigenen Antworten.
// Beides gehoert dazu, weil man den Posteingang sonst in einer Seite ansieht,
// deren andere Haelfte leer ist – und weil ein Antwortfeld, das beim Absenden
// eine Fehlermeldung wirft, genau das verbirgt, was man sehen wollte.
{
  const { demoPolls: bauen } = await ladeMit('?demo=8', 'localhost');
  const polls = bauen();

  check2('Der Demomodus liefert drei Abstimmungen', polls.length === 3);

  // Verschiedene Groessenordnungen, und das ist der Zweck: Bei drei
  // Abstimmungen derselben Groesse sieht jede Fassung der Zeile gut aus.
  const stellen = polls.map((p) => String(Math.round(p.totalUsd)).length);
  check2('Mit sehr verschiedenen Summen',
    new Set(stellen).size === 3, polls.map((p) => Math.round(p.totalUsd)).join(' / '));

  // Und drei verschiedene Zustaende – sie sehen verschieden aus.
  check2('Und drei verschiedenen Zustaenden',
    polls.filter((p) => p.closed).length === 1
    && polls.filter((p) => !p.closed && p.closesAt).length === 1
    && polls.filter((p) => !p.closed && !p.closesAt).length === 1);

  // Die Anteile tragen die Balkenbreite. Ergaeben sie nicht genau eins, waere
  // die Karte in der Simulation eine andere als im Betrieb.
  for (const p of polls) {
    const summe = p.options.reduce((a, o) => a + o.share, 0);
    if (Math.abs(summe - 1) > 0.001) {
      check2(`Anteile von "${p.question}" ergeben eins`, false, String(summe));
    }
    const betraege = p.options.reduce((a, o) => a + o.usd, 0);
    if (Math.abs(betraege - p.totalUsd) > 0.01) {
      check2(`Summe von "${p.question}" stimmt`, false, `${betraege} gegen ${p.totalUsd}`);
    }
  }
  check2('Anteile und Summen stimmen in allen dreien', true);
}

// Die Antwort im Demomodus bleibt im Speicher. Geprueft wird die REIHENFOLGE
// im Quelltext: Der Demozweig muss VOR dem insert stehen und mit return
// enden. Steht er dahinter, faellt die Antwort trotzdem in die Datenbank –
// und das saehe man in der Simulation nicht, weil dort alles gleich aussieht.
//
// Eine Messung waere schoener. Sie geht hier nicht: Der Zuhoerer haengt am
// Formular, und ein zweiter Modulimport haengt einen zweiten daneben – dann
// liefe beim Absenden auch der alte Zweig mit. Das ist als Quelltextpruefung
// ehrlicher als eine Messung, die etwas anderes misst.
{
  const quelle = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const block = quelle.slice(quelle.indexOf("$('#admin-dm-form').addEventListener"));
  const demo = block.indexOf('if (DEMO_DMS) {');
  const insert = block.indexOf("from('dms').insert");
  check2('Der Demozweig steht vor dem Schreiben in die Datenbank',
    demo > 0 && insert > 0 && demo < insert);
  check2('Und er steigt aus, statt weiterzulaufen',
    /renderThreads\(\);\s*\n\s*return;/.test(block.slice(demo, insert)));
}

check2('Vorschau greift NICHT auf einer Unterdomain',
  (await ladeMit('?preview=admin', 'localhost.angreifer.example')).preview === false);

console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen\n` : '\nAlle Pruefungen bestanden\n');
process.exit(failed ? 1 : 0);
