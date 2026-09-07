/**
 * Tests the state machine that decides which realtime channels a browser
 * currently holds open.
 *
 * Why a dedicated test for this: a bug here is invisible. The page looks
 * completely normal, but the poll channel doesn't come back after a tab
 * switch - and the user wonders why the numbers stopped moving. That is
 * exactly the kind of thing that's hard to notice in the browser and easy
 * to measure here.
 *
 * app.js is loaded as source for this, the two real imports are replaced
 * with stubs and a minimal DOM is laid underneath.
 *
 *   node scripts/test-realtime-switching.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// DOM stub: just enough for app.js to get through on load
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
  // Empty but present: renderOptionButtons() counts the children of the
  // options field. Without this line, loading already fails.
  children: [],
  // A real class list instead of a stub: several states of the interface
  // hang off it (locked, no options, active). A contains function that
  // always returns false would let every check on it fail silently.
  classList: (() => {
    const set = new Set();
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      toggle: (c, an) => (an ?? !set.has(c)) ? set.add(c) : set.delete(c),
    };
  })(),
  // Remember listeners instead of discarding them. Something once slipped
  // past exactly this: during cleanup the threshold field's input
  // listener vanished, and no check noticed, because the stub swallowed
  // addEventListener silently. With __fire it's now possible to check
  // whether a field reacts at all.
  __hoerer: {},
  addEventListener(typ, fn) { (this.__hoerer[typ] ??= []).push(fn); },
  // Remember attributes, so it's possible to check what was set - for
  // instance the aria-label, which carries the unread DM count now that
  // the tab itself only shows a dot.
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
  // Both ways of attaching a child, and both are needed: optionZeile()
  // uses append(), setzeOptionenZurueck() uses replaceChildren(). If
  // either is missing, LOADING the module already fails - and then this
  // test reports nothing at all instead of "failed".
  append() {},
  replaceChildren() {},
  // The character counter searches upward from its field for the box it
  // sits in. The stub knows no ancestry; it just returns some element.
  // That's enough: what's tested here is switching between channels, not
  // the counter - it has its own test. But without this line, LOADING the
  // module already fails, and then this test reports nothing at all
  // instead of "failed".
  closest: () => makeEl('panel'),
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
// Without location, loading the module already fails: the admin preview
// reads the address bar on startup. Deliberately a value WITHOUT
// ?preview=admin - the tests are meant to check the normal case, not the
// preview.
globalThis.location = { search: '', hostname: 'sized.gg', href: 'https://sized.gg/' };
globalThis.window = { addEventListener() {}, location: globalThis.location };
// app.js attaches its keydown listener to the global namespace, not to
// document. Without this line, LOADING the module already fails - and the
// whole test aborts without a single finding reported.
globalThis.addEventListener = (ev, fn) => { (listeners[ev] ??= []).push(fn); };
globalThis.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = String(v); },
  removeItem(k) { delete this._v[k]; },
};
// navigator already exists in Node and is read-only - only extend it.
if (!globalThis.navigator.clipboard) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async () => {} }, configurable: true,
  });
}
globalThis.fetch = async () => { throw new Error('kein Netz im Test'); };

const fire = (ev) => (listeners[ev] ?? []).forEach((fn) => fn());

// ---------------------------------------------------------------------------
// Supabase stub: remembers which channels are open
// ---------------------------------------------------------------------------

const open = new Set();
const byTopic = new Map();          // so the test can trigger status messages
const optionen = new Map();         // channel name -> channel()'s second argument
const bindungen = new Map();        // channel name -> list of .on() calls
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
// Load app.js, replace imports, hand out internal state
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
  VOTE_CADENCE_MS,
  dmsNachziehen,
  PREVIEW_ADMIN,
  DEMO_DMS,
  demoThreads,
  demoPolls,
  dmHtml,
  dmQuoteHtml,
  checkDmAnswers,
  renderThreads,
  markiereGelesen,
  shortUsd,
  cleanNumber,
  gruppiere,
  tagLabel,
  dmListeHtml,
  speichereDmMin,
  renderDmMin,
  MIN_DM_THRESHOLD,
  MAX_DM_THRESHOLD,
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

const { state, syncRealtime, selectTab, unsubscribeAll, VOTE_CADENCE_MS, dmsNachziehen, dmHtml, dmQuoteHtml, checkDmAnswers, renderThreads, markiereGelesen, shortUsd, cleanNumber, gruppiere, tagLabel, dmListeHtml, speichereDmMin, renderDmMin, MIN_DM_THRESHOLD, MAX_DM_THRESHOLD, MAX_STELLEN, STRICH_BLEIBT, STRICH_MAX, STRICH_MIN } = globalThis.__test;
state.db = fakeDb;
// Since the broadcast rework, the DM channel is named after one's own
// wallet. Without a logged-in user it wouldn't exist at all - see
// wantedChannels().
const NUTZER = 'H4v7xKq111111111111111111111111111111111111';
state.me = { wallet: NUTZER, isAdmin: false };
const DM_KANAL = `dm:${NUTZER}`;

// ---------------------------------------------------------------------------
// Checks
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
check('Seite wieder sichtbar: die Abstimmungen kommen back', ['hub:polls', DM_KANAL]);

// Exactly the bug that would otherwise go unnoticed: calling it multiple
// times must not open a second channel and must not choke off an existing one.
const before = [...open].sort().join(',');
syncRealtime();
syncRealtime();
check('Mehrfaches Synchronisieren aendert nichts', before.split(','));

// ---------------------------------------------------------------------------
// Fallback: if the live connection doesn't come together, the page has to
// poll itself - and stop doing so as soon as it's back.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The vote tick
//
// Votes are NO LONGER delivered. The line .on(... table: 'votes') used to
// exist, and it was the most expensive thing on the whole site: Supabase
// counts deliveries individually, one vote to 500 browsers is 500
// messages. On a fresh poll that was about 8,300 per second against a
// quota of 500 to 2,500.
//
// Instead the open polls tab polls for the numbers itself. That means a
// clock now hangs off the channel, and it has to run for EXACTLY as long
// as the channel does - if it keeps running, a backgrounded browser polls
// forever; if it doesn't run, the bars sit still and nobody sees an error.
// ---------------------------------------------------------------------------

console.log('\nDer Stimmen-Takt running genau so lange wie der Kanal\n');

const cadenceRunning = () => state.stimmenTakt !== null && state.stimmenTakt !== undefined;
function checkCadence(label, erwartet) {
  const ok = cadenceRunning() === erwartet;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}`);
  if (!ok) console.log(`         erwartet: ${erwartet ? 'running' : 'steht'}\n         bekommen: ${cadenceRunning() ? 'running' : 'steht'}`);
}

// The line itself must not come back -- it's the whole reason for this.
// Comments don't count here: right above that spot it's DESCRIBED what
// used to be there, including the line verbatim. Without this filter the
// test would fail because of its own justification.
const appSrc = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const ohneKommentar = appSrc.split('\n')
  .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n');
check2('Kein Browser hoert mehr auf einzelne Stimmen',
  !/table:\s*'votes'/.test(ohneKommentar));
check2('Neue und beendete Abstimmungen bleiben live',
  /table:\s*'polls'/.test(appSrc) && /table:\s*'poll_options'/.test(appSrc));
// And the database has to say the same thing, otherwise realtime keeps
// processing votes out of the WAL even though nobody's listening.
const wanderung = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260903040000_votes_nicht_mehr_live.sql'), 'utf8');
check2('public.votes ist aus der Realtime-Veroeffentlichung genommen',
  /drop table public\.votes/.test(wanderung));

selectTab('polls');
checkCadence('Polls-Tab offen -> der Takt running', true);
check2('Und zwar langsamer als die alte Sammelfrist von 400 ms',
  VOTE_CADENCE_MS >= 3000);

selectTab('dms');
checkCadence('DM-Tab -> der Takt steht', false);

selectTab('polls');
checkCadence('Zurueck zu den Abstimmungen -> er running wieder', true);

document.visibilityState = 'hidden';
fire('visibilitychange');
checkCadence('Seite im Hintergrund -> er steht', false);

document.visibilityState = 'visible';
fire('visibilitychange');
checkCadence('Seite wieder sichtbar -> er running', true);

// Syncing twice must not start a second clock -- otherwise the browser
// polls twice as often, and the old clock can never be stopped again.
const clockBefore = state.stimmenTakt;
syncRealtime();
syncRealtime();
check2('Mehrfaches Synchronisieren startet keine zweite Uhr',
  state.stimmenTakt === clockBefore);

// Whoever votes themselves must not have to wait for the next tick --
// otherwise their own click feels ineffective for five seconds.
check2('Wer selbst abstimmt, wartet nicht auf den Takt',
  /await loadPolls\(\);\s*\n\s*toast\('Vote counted'\)/.test(appSrc));

// -------------------------------------------------------------------------
// DMs: a nudge on a private channel instead of a broadcast to everyone
//
// This is where the last expensive spot hung. postgres_changes checks
// permissions INDIVIDUALLY per listener and change -- one DM to Ansem
// with 3,000 open pages is 3,000 checks, processed single-threaded. Now a
// trigger sends a nudge to exactly two channels.
//
// Measured against the stub, not the source: HOW the channel was actually
// opened.
// -------------------------------------------------------------------------
check2('Kein Browser hoert mehr auf einzelne DM-Zeilen',
  !/table:\s*'dms'/.test(ohneKommentar));
check2('Der DM-Kanal heisst nach der eigenen Wallet',
  open.has(DM_KANAL), [...open].join(', '));
// private: true is not optional -- without it Supabase doesn't even check
// the access rule and the channel is open to anyone.
check2('Und er ist als privat geoeffnet',
  optionen.get(DM_KANAL)?.config?.private === true,
  JSON.stringify(optionen.get(DM_KANAL) ?? null));
check2('Er lauscht auf einen Broadcast, nicht auf Tabellenaenderungen',
  (bindungen.get(DM_KANAL) ?? []).every((b) => b.art === 'broadcast')
    && (bindungen.get(DM_KANAL) ?? []).some((b) => b.filter?.event === 'dm'),
  (bindungen.get(DM_KANAL) ?? []).map((b) => b.art).join(', ') || '(keine)');
check2('Und sie sammeln next nur short',
  /reloadSoon\('dms', dmsNachziehen\)/.test(ohneKommentar)
    && /function reloadSoon\(key, fn, delay = 400\)/.test(ohneKommentar));

// -------------------------------------------------------------------------
// A nudge only ever arrives ONCE
//
// The vote tick polls again every 5 seconds; if a fetch fails there, the
// next one catches up. There is no such safety net for DMs. So if the
// reload happens to fall into a brief outage -- measured on 2026-09-04
// while resizing the database: net::ERR_FAILED -- the message would be
// silently lost.
//
// Tested here with a loadDms() that fails the first few times.
// -------------------------------------------------------------------------
{
  const gemerkteDb = state.db;
  state.activeThread = null;

  // Without state.db, loadDms fails -- exactly the "no response" case.
  state.db = null;
  const t0 = Date.now();
  const didFail = await dmsNachziehen(3);
  const elapsed = Date.now() - t0;

  check2('Scheitert das Nachladen, wird nicht still aufgegeben',
    didFail === false);
  // 0.6 + 1.2 seconds between three attempts.
  check2('Sondern mehrfach nachgefasst, mit wachsendem Abstand',
    elapsed >= 1700, `${elapsed} ms fuer 3 Versuche`);

  // Control check: if it succeeds, there must NOT be a wait. Without this
  // line, the check above would also pass for a function that always waits.
  //
  // For this, a database stub whose chain actually resolves: loadDms()
  // first fetches app_config (.select().eq().single()) and then the
  // messages (.select().order()).
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
  const fast = Date.now() - t1;
  check2('Gegenprobe: klappt es beim ersten Mal, wird nicht gewartet',
    geklappt === true && fast < 300, `${fast} ms`);

  state.db = gemerkteDb;
}

// Ansem listens on a different channel: an inbox for ALL threads. If he
// had the same one as a user, he'd only get his own -- and would never
// notice that someone wrote to him.
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

// Without a logged-in user, no DM channel may open at all -- otherwise it
// would be called "dm:undefined", get rejected, and the page would report an error.
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
checkPoll('Solange alles running, wird nicht nachgefragt', []);

// If the connection breaks, polls need NO second clock: the tick polls
// anyway. A "Live updates unavailable" message would even be wrong here
// -- the votes keep coming in.
byTopic.get('hub:polls').cb('CHANNEL_ERROR', new Error('429'));
checkPoll('Abstimmungs-Kanal abgelehnt -> keine zweite Uhr daneben', []);
checkCadence('Der Takt running dabei unveraendert next', true);

byTopic.get(DM_KANAL).cb('TIMED_OUT');
checkPoll('Der DM-Kanal dagegen wird nachgefragt', ['dms']);

byTopic.get(DM_KANAL).cb('SUBSCRIBED');
checkPoll('DMs wieder verbunden -> Nachfragen hoert auf', []);

selectTab('dms');
checkCadence('Wechsel weg von den Abstimmungen stoppt den Takt', false);

document.visibilityState = 'hidden';
fire('visibilitychange');
checkPoll('Seite im Hintergrund: gar keine Nachfragerei', []);

document.visibilityState = 'visible';
fire('visibilitychange');
selectTab('polls');
unsubscribeAll();
check('Abmelden schliesst alles', []);
checkPoll('Abmelden beendet auch das Nachfragen', []);
checkCadence('Und stoppt den Takt', false);

state.cfg.symbol = 'ANSEM';
state.cfg.admin_wallet = 'AnsemWalletAddress11111111111111111111111111';

// ---------------------------------------------------------------------------
// The short amount: never more than three digits
// ---------------------------------------------------------------------------
// The amount column in the inbox depends on this. If an amount were wider
// even once, everything in that row would shift - and that alignment is
// exactly the reason the function exists.

const shortSamples = [
  [0, '$0'], [-5, '$0'], [NaN, '$0'],
  [0.04, '<$1'], [0.42, '<$1'],
  [1, '$1'], [3, '$3'], [50, '$50'], [201, '$201'], [999, '$999'],
  // Rounding up across the thousands boundary: 999.6 is not "$1000".
  [999.6, '$1K'],
  // Between 1,000 and 10,000, NO decimal place.
  //
  // "$1.4K" and "$9.9K" used to be here. That spot looked like an exact
  // figure and wasn't one: behind "$8.8K" is something between 8,750 and
  // 8,849. It claimed a precision the number doesn't have, and precisely
  // where the amounts sit close together.
  [1000, '$1K'], [1412, '$1K'], [3444, '$3K'], [8820, '$9K'], [9940, '$10K'],
  // And the boundary in between, both sides:
  [1499, '$1K'], [1500, '$2K'], [9499, '$9K'], [9500, '$10K'],
  // From here on the decimal place drops away anyway, or it would be four
  // digits. So the transition is seamless: $9K, $10K, $12K.
  [9990, '$10K'], [10400, '$10K'], [12400, '$12K'],
  [31500, '$32K'], [99900, '$100K'], [781420, '$781K'],
  // And here the next boundary: 999,960 rounded up is 1000K - i.e. 1M.
  [999960, '$1.0M'],
  // At millions the decimal place stays: between "$1M" and "$2M" read a
  // whole million, and there it carries real information.
  [1240000, '$1.2M'], [12400000, '$12M'], [124000000, '$124M'],
  [1.24e9, '$1.2B'], [1.24e12, '$1.2T'],
];
for (const [roh, erwartet] of shortSamples) {
  const ist = shortUsd(roh);
  check2(`shortUsd(${roh}) = ${erwartet}`, ist === erwartet);
  if (ist !== erwartet) console.log(`         bekommen: ${ist}`);
}
// The actual guarantee: never more than five characters, dollar sign included.
const tooWide = [];
for (let e = -2; e <= 13; e++) {
  for (const f of [1, 1.4, 3.44, 7.81, 9.99]) {
    const s = shortUsd(f * 10 ** e);
    if (s.length > 5) tooWide.push(`${f}e${e} -> ${s}`);
  }
}
check2('Kein Betrag wird breiter als fuenf Zeichen', tooWide.length === 0);
if (tooWide.length) console.log(`         ${tooWide.slice(0, 5).join(', ')}`);

// ---------------------------------------------------------------------------
// Three sections used to be here, dropped along with the chat:
//
//   "Display and filter"    - msgHtml(), passesFilter(), toMessage(). The
//                             amount column next to a chat row and the
//                             question of whether Ansem falls out of the
//                             filter.
//   "Write access in chat"  - renderChatGate() against min_chat_usd.
//   "Replies and quotes"    - msgHtml() with a quote, even when the
//                             original fell out of the filter.
//
// Of the three guarantees, one still holds, and it's checked below: a
// quote must still be there even when the original is no longer around.
// In DMs the path there is different - a conversation is always loaded in
// full, there is no filter something could fall out of.
//
// Write access itself is not left unchecked: renderDmGate() hangs off
// min_dm_usd and appears further below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Replies in DMs
// ---------------------------------------------------------------------------

state.me = { wallet: 'Km9xxx', handle: 'Km9', usd: 500, isAdmin: true };
state.cfg.symbol = 'ANSEM';

const dmQuestion = { id: 8, wallet: 'bH2yyy', from_admin: false, reply_to: null,
                  body: 'Is the unlock linear or cliff based?', created_at: '2026-08-25T12:00:00Z' };
const dmAnswer = { id: 9, wallet: 'bH2yyy', from_admin: true, reply_to: 8,
                    body: 'Cliff, then linear.', created_at: '2026-08-25T12:01:00Z' };
state.dmMessages = [dmQuestion, dmAnswer];
checkDmAnswers(state.dmMessages);

check2('DM-Spalte erkannt', state.dmRepliesAvailable === true);
check2('DM traegt einen Antwortknopf', dmHtml(dmQuestion).includes('data-dm-reply="8"'));
// The bubble still carries .msg - the class comes from the chat, and quote,
// reply arrow and the flash all hang off it. Removing it here takes all three away.
check2('DM traegt weiterhin .msg', dmHtml(dmQuestion).includes('class="msg dm'));
// The arrow sits next to the bubble, not inside it - otherwise it would
// push the text on appearing.
const parts = dmHtml(dmQuestion);
check2('Antwortpfeil steht ausserhalb der Blase',
  parts.indexOf('</div>') < parts.indexOf('reply-btn'));
check2('Zeile umschliesst Blase und Pfeil', parts.startsWith('<div class="dm-row'));
check2('Zitat ohne Namen', !dmQuoteHtml(dmAnswer).includes('class="h'));
check2('DM hat Zeit im meta-Feld', dmHtml(dmQuestion).includes('<span class="meta"'));
check2('DM ohne Namensspalte', !dmHtml(dmQuestion).includes('class="who"'));
check2('Antwort bekommt has-quote', dmHtml(dmAnswer).includes('has-quote'));
check2('DM-Antwort zeigt das Zitat', dmQuoteHtml(dmAnswer).includes('Is the unlock linear'));
check2('Zitat springt zur Ursprungsnachricht', dmQuoteHtml(dmAnswer).includes('data-dm-goto="8"'));
check2('Ohne Bezug kein Zitat', dmQuoteHtml(dmQuestion) === '');

// Deleted original: a notice instead of restored text
state.dmMessages = [dmAnswer];
check2('Geloeschtes Original wird benannt', dmQuoteHtml(dmAnswer).includes('is-gone'));

// If the database doesn't know the column, the button disappears via a class
checkDmAnswers([{ id: 1, wallet: 'a', from_admin: false, body: 'x', created_at: 'y' }]);
check2('Ohne Spalte keine Antworten', state.dmRepliesAvailable === false);
check2('Ohne Spalte wird der Bereich markiert',
  el('#dm-admin').classList.contains('no-replies'));
state.dmMessages = [dmQuestion, dmAnswer];
checkDmAnswers(state.dmMessages);

// ---------------------------------------------------------------------------
// Date separators in conversations
// ---------------------------------------------------------------------------
// A thread runs across days. Without a separator there's only a time, and
// "09:12" doesn't say whether that was this morning or three weeks ago.

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

// The comparison has to run over the start of the day, not the gap:
// 23:58 and 00:03 are five minutes apart and are two different days.
state.me = { wallet: 'Km9xxx', handle: 'Km9', usd: 500, isAdmin: true };
const g = (id, iso, body) => ({ id, wallet: 'bH2yyy', from_admin: false, reply_to: null,
  body, created_at: iso });
const late = new Date(heute); late.setDate(late.getDate() - 3); late.setHours(23, 58, 0, 0);
const early = new Date(late); early.setDate(early.getDate() + 1); early.setHours(0, 3, 0, 0);
state.dmMessages = [g(1, late.toISOString(), 'a'), g(2, early.toISOString(), 'b')];
const verlauf = dmListeHtml(state.dmMessages);
check2('Mitternacht trennt zwei Tage',
  (verlauf.match(/day-sep/g) || []).length === 2);

state.dmMessages = [g(1, tagVor(0), 'a'), g(2, tagVor(0), 'b'), g(3, tagVor(0), 'c')];
check2('Ein Tag, ein Trenner',
  (dmListeHtml(state.dmMessages).match(/day-sep/g) || []).length === 1);
check2('Trenner steht vor der Nachricht',
  dmListeHtml(state.dmMessages).indexOf('day-sep') < dmListeHtml(state.dmMessages).indexOf('dm-row'));

// ---------------------------------------------------------------------------
// Number fields only accept numbers
// ---------------------------------------------------------------------------
// Both fields are type="text", because a number field shows the tiny
// up/down arrows. That means the browser checks nothing anymore - this
// happens here instead.

check2('Buchstaben fallen raus', cleanNumber('12ab3') === '123');
check2('Sonderzeichen fallen raus', cleanNumber('1$2 %3!') === '123');
// Commas are the thousands separator in this field and are set by the
// display - they get dropped again on read.
check2('Tausendertrennzeichen faellt beim Lesen weg', cleanNumber('1,000') === '1000');
check2('Nur ein Dezimaltrennzeichen', cleanNumber('1.2.3') === '1.23');

// --- Grouping: from four digits on ---
check2('Drei Stellen bleiben ungruppiert', gruppiere('999') === '999');
check2('Vier Stellen werden gruppiert', gruppiere('1000') === '1,000');
check2('Fuenf Stellen', gruppiere('12480') === '12,480');
check2('Sechs Stellen', gruppiere('100000') === '100,000');
check2('Sieben Stellen', gruppiere('1200000') === '1,200,000');
check2('Nachkommastellen bleiben ungruppiert', gruppiere('1234.5678') === '1,234.5678');
check2('Leeres bleibt empty beim Gruppieren', gruppiere('') === '');
check2('Fuehrender Punkt uebersteht', gruppiere('.5') === '.5');
// Round-trip must give the same result - otherwise display and value
// would eventually disagree.
check2('Gruppieren und wieder lesen ergibt das Original',
  cleanNumber(gruppiere('1234567.89')) === '1234567.89');
check2('Minus faellt raus', cleanNumber('-5') === '5');
check2('Leeres bleibt empty', cleanNumber('') === '');
check2('Reiner Text ergibt nichts', cleanNumber('abc') === '');
check2('Fuehrendes Trennzeichen bleibt', cleanNumber('.5') === '.5');
check2('Sauberes bleibt unveraendert', cleanNumber('10000') === '10000');

// --- How long the number may get ---
// Ten digits before the decimal point, after that none more get through.
// Checked against MAX_STELLEN and not against the literal 10: if the
// limit shifts, this should move with it - it would only be wrong once
// the field and the database know different numbers, and that's exactly
// what the section further below checks.
const zehn = '1'.repeat(MAX_STELLEN);
check2('Volle Laenge bleibt stehen', cleanNumber(zehn) === zehn);
check2('Eine Stelle mehr faellt weg', cleanNumber(`${zehn}9`) === zehn);
check2('Und auch viele mehr', cleanNumber(`${zehn}999999`) === zehn);
// Decimal places don't count toward it - they don't make the number bigger.
check2('Nachkommastellen bleiben von der Grenze unberuehrt',
  cleanNumber(`${zehn}.55`) === `${zehn}.55`,
  cleanNumber(`${zehn}.55`));
check2('Auch bei abgeschnittener Zahl bleibt das Komma-Ende erhalten',
  cleanNumber(`${zehn}99.5`) === `${zehn}.5`);
// And the boundary is exactly the largest allowed value - not a number
// off by one next to it. A field that accepts 9999999999 while the limit
// sat at 1000000000 would be the one discrepancy that must not exist here.
check2('Die Obergrenze ist die groesste Zahl, die ins Feld passt',
  MAX_DM_THRESHOLD === Number(zehn.replace(/1/g, '9')), String(MAX_DM_THRESHOLD));

// ---------------------------------------------------------------------------
// Inbox follows the DM threshold
// ---------------------------------------------------------------------------
// Whoever holds less than the threshold doesn't show up.
// What matters is that nothing gets deleted - lowering it brings
// everyone back.

state.dmThreads = [
  { wallet: 'aaa', usd: 31500, preview: 'big', tokens: 1, unread: 2, last_from_admin: false },
  { wallet: 'bbb', usd: 12,    preview: 'knapp drueber', tokens: 1, unread: 0, last_from_admin: true },
  { wallet: 'ccc', usd: 3,     preview: 'zu klein', tokens: 1, unread: 0, last_from_admin: false },
];

state.cfg.min_dm_usd = 0;
renderThreads();
check2('Ohne Schwelle alle Gespraeche', el('#thread-items').innerHTML.includes('ccc'));
// A check on #thread-hidden used to be here - the line that counted how
// many conversations the threshold hides. It's gone: the slider sits
// right above it and says the same thing. What remains is the effect
// itself, and that's checked further below.

// If Ansem wrote last, "You:" shows before the preview.
//
// The opposite used to be the case here, and the reasoning was: in a list
// made of handles, text and amounts, the addition is a fourth element,
// and the row gets crowded by it. That was true for the row as it was
// back then - the preview now ends after 16 characters and there's room
// to its right.
//
// And the information is worth more than it seemed back then: without
// it, one's own last reply reads like a new message from the other
// person. Across forty conversations, most of them answered, that's the
// most common row.
//
// BOTH cases are checked. A rule that always or never sets the addition
// would only pass half the check - and the more common row is precisely
// the one without it.
{
  const line = (wallet) => {
    const m = new RegExp(
      `<button class="thread[^"]*"[^>]*data-wallet="${wallet}"[\\s\\S]*?</button>`)
      .exec(el('#thread-items').innerHTML);
    return m ? m[0] : '';
  };
  // bbb: last_from_admin true, ccc: false - see the fixture above.
  check2('Nach Ansems Antwort steht "You:" davor', line('bbb').includes('>You:<'));
  check2('Nach einer fremden Nachricht nicht', !line('ccc').includes('You:'));
  // As its own element and not in the preview text: otherwise it would
  // eat into the preview's 16 characters and get truncated along with it.
  check2('Und es steht ausserhalb der Vorschau',
    line('bbb').includes('<span class="thread-du">You:</span>')
    && !line('bbb').includes('thread-prev">You:'));

  // And the previews all end at the same spot - with "You:" in front or
  // without. That only works via the rendered width; the rule in the
  // sheet computes with ch and rem, and only the browser can say whether
  // the math works out.
  //
  // That's checked in its own script with a real browser
  // (test-dm-verbergen.mjs). All that's checked here is that the
  // calculation exists at all: whoever removes the second width frays the
  // edge again.
  const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  check2('Die Zeile mit "You:" bekommt eine eigene, kuerzere Vorschaubreite',
    /\.thread-du \+ \.thread-prev \{[^}]*max-width: calc\(var\(--vorschau\)/s.test(css));
}

// --- Unopened conversations ---
// Exactly the rows with an open counter carry the class, no others.
const lines = () => [...el('#thread-items').innerHTML.matchAll(
  /<button class="thread ([^"]*)"[\s\S]*?data-wallet="([^"]+)"/g)]
  .map(([, klassen, wallet]) => ({ wallet, unread: klassen.includes('is-unread') }));

check2('Ungelesenes Gespraech traegt is-unread',
  lines().find((z) => z.wallet === 'aaa').unread === true);
check2('Gelesenes Gespraech traegt es nicht',
  lines().every((z) => z.wallet === 'aaa' || !z.unread));

renderThreads();

state.cfg.min_dm_usd = 10;
renderThreads();
const liste = el('#thread-items').innerHTML;
check2('Zu kleiner Bestand faellt raus', !liste.includes('ccc'));
check2('Knapp darueber bleibt', liste.includes('bbb'));
// Lowering it brings everything back - nothing was deleted.
state.cfg.min_dm_usd = 0;
renderThreads();
check2('Senken bringt die Gespraeche back', el('#thread-items').innerHTML.includes('ccc'));

// While typing, the draft already applies, before anything is saved.
// Deliberately through the real field and its input event, not by
// setting state.dmMinEntwurf directly: it was exactly this listener that
// once vanished during cleanup, and a test against the state alone
// wouldn't have noticed.
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

// An empty field no longer means "no threshold", but the floor. Checked
// against MIN_DM_THRESHOLD and not against 1000: if the number moves, this
// test should move with it - it would only be wrong once clearing it
// leads below the floor again.
el('#dm-min-input').value = '';
el('#dm-min-input').__fire('input');
check2('Leeres Feld faellt auf die Untergrenze',
  Number(state.dmMinEntwurf) === MIN_DM_THRESHOLD);

// A typed number below it too. This is the real point: while typing "1",
// "10", "100", the inbox must not show three states that don't exist once
// you let go.
el('#dm-min-input').value = '100';
el('#dm-min-input').__fire('input');
check2('Zu kleine Eingabe wird im Entwurf angehoben',
  Number(state.dmMinEntwurf) === MIN_DM_THRESHOLD);
renderThreads();
check2('Unter der Untergrenze bleibt niemand Kleines stehen',
  !el('#thread-items').innerHTML.includes('ccc'));
check2('Ueber der Untergrenze bleibt das grosse Gespraech',
  el('#thread-items').innerHTML.includes('aaa'));
state.dmMinEntwurf = null;

// ---------------------------------------------------------------------------
// The floor: nothing under $1,000
// ---------------------------------------------------------------------------
// The inbox can no longer be opened all the way. The opposite used to be
// the case here - an empty field meant 0, i.e. off, with the reasoning:
// whoever deletes the number wants to get rid of it.
//
// That held as long as 0 was an allowed value. It was also the most
// dangerous spot in the whole interface: whoever selected the number and
// deleted it in order to type a new one, then clicked away, had opened
// the inbox for everyone - without a step that looked like it.
//
// Raised instead of rejected, and ONLY here in the form: whoever is
// currently typing shouldn't get a red error for a number the page
// itself already knows about. The database, by contrast, rejects it
// (migration 20260831030000) - that's the actual lock, this here is the
// politeness in front of it.
const echteDb = state.db;
let gesendet = null;
state.db = { rpc: async (name, args) => { gesendet = { name, args }; return { data: args.p_usd, error: null }; } };

state.cfg.min_dm_usd = 25;
el('#dm-min-input').value = '';
await speichereDmMin();
check2('Leeres Feld speichert die Untergrenze',
  gesendet?.args?.p_usd === MIN_DM_THRESHOLD, JSON.stringify(gesendet));
check2('Gespeichert ist danach die Untergrenze',
  Number(state.cfg.min_dm_usd) === MIN_DM_THRESHOLD);
// And the field doesn't sit empty. That was exactly the follow-up
// question: whoever deletes everything should see the 1,000, not an
// empty box you can't tell the current value from.
check2('Nach dem Loeschen steht die Zahl wieder im Feld',
  el('#dm-min-input').value === gruppiere(MIN_DM_THRESHOLD),
  el('#dm-min-input').value);

// A lone period is not a number either - and falls back to the same value.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '.';
await speichereDmMin();
check2('Alleinstehender Punkt speichert die Untergrenze',
  gesendet?.args?.p_usd === MIN_DM_THRESHOLD);

// A typed number below the limit gets raised, not rejected.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '500';
await speichereDmMin();
check2('Zu kleine Zahl wird angehoben statt abgelehnt',
  gesendet?.args?.p_usd === MIN_DM_THRESHOLD, JSON.stringify(gesendet));
check2('Angehoben heisst auch: kein Fehler, sondern die Zahl im Feld',
  el('#dm-min-input').value === gruppiere(MIN_DM_THRESHOLD),
  el('#dm-min-input').value);

// Above it, what was typed stays typed.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '5,000';
await speichereDmMin();
check2('Ueber der Grenze bleibt die Eingabe stehen',
  gesendet?.args?.p_usd === 5000, JSON.stringify(gesendet));

// Even the largest number that fits in the field passes through
// unchanged - it's allowed, not merely tolerated at the edge.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = gruppiere(String(MAX_DM_THRESHOLD));
await speichereDmMin();
check2('Die volle Laenge wird gespeichert, nicht gedeckelt',
  gesendet?.args?.p_usd === MAX_DM_THRESHOLD, JSON.stringify(gesendet));

// Too many digits don't get through in the first place - cleanNumber cuts them off.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = '99,999,999,999,999';
await speichereDmMin();
check2('Zu lange Zahlen werden auf die volle Laenge gekuerzt',
  gesendet?.args?.p_usd === MAX_DM_THRESHOLD, JSON.stringify(gesendet));

// The one path on which the number still gets too big: decimal places
// don't count toward the length, and 9999999999.99 is larger than
// 9999999999. Without the cap on save, exactly this value would go to the
// database - which would reject it, even though the field let it be typed.
gesendet = null;
state.cfg.min_dm_usd = 25000;
el('#dm-min-input').value = `${gruppiere(String(MAX_DM_THRESHOLD))}.99`;
await speichereDmMin();
check2('Nachkommastellen heben die Zahl nicht ueber die Grenze',
  gesendet?.args?.p_usd === MAX_DM_THRESHOLD, JSON.stringify(gesendet));

// The floor is already the saved value: clearing then changes nothing and
// must not write anything either.
gesendet = null;
state.cfg.min_dm_usd = MIN_DM_THRESHOLD;
el('#dm-min-input').value = '';
await speichereDmMin();
check2('Loeschen auf dem Mindestwert schreibt nichts', gesendet === null);
check2('Und das Feld zeigt trotzdem die Zahl',
  el('#dm-min-input').value === gruppiere(MIN_DM_THRESHOLD),
  el('#dm-min-input').value);

// Unchanged means: don't write at all.
gesendet = null;
state.cfg.min_dm_usd = 10000;
el('#dm-min-input').value = '10,000';
await speichereDmMin();
check2('Ohne Aenderung wird nichts written', gesendet === null);

state.db = echteDb;
state.cfg.min_dm_usd = 0;

// The database holds the same number - otherwise the form here would be
// polite about a value that the lock behind it rejects.
const lowerBoundSql = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260831030000_dm_untergrenze.sql'), 'utf8');
check2('Migration lehnt unterhalb derselben Zahl ab',
  new RegExp(`p_usd\\s*<\\s*${MIN_DM_THRESHOLD}\\b`).test(lowerBoundSql));
check2('Migration hebt bestehende Zeilen auf dieselbe Zahl',
  new RegExp(`min_dm_usd\\s*=\\s*${MIN_DM_THRESHOLD}\\b`).test(lowerBoundSql));
// And the same at the upper end. That's the number that can drift apart
// without it being noticed: the field accepts ten digits, the database
// used to reject anything from seven digits on. Anyone who then typed
// 5,000,000,000 got a red error for a number the page itself had let them type.
check2('Migration erlaubt genau bis zur Obergrenze des Feldes',
  new RegExp(`p_usd\\s*>\\s*${MAX_DM_THRESHOLD}\\b`).test(lowerBoundSql));

// ---------------------------------------------------------------------------
// The scroll thumb in the inbox
// ---------------------------------------------------------------------------
// It is always drawn and only colored in while scrolling - a custom-styled
// scrollbar otherwise sits there permanently in Chrome, and the fading
// out you know from the operating system belongs to the overlaid bar that
// has no fixed pixel width.
//
// This is carried by a class that gets set and removed again here. If the
// listener drops out, you see nothing: the thumb would simply stay
// invisible always, and the list would look like before - just with no
// indication at all of where you stand. This exact kind of loss has
// already once hidden itself at the threshold field.
{
  const liste = el('#thread-items');
  const strich = el('#thread-strich');
  // The stub has no dimensions - set here so the calculation can be
  // checked: a 209 px track.
  strich.style = {};
  liste.clientHeight = 209;
  liste.scrollHeight = 1463;

  const hoch = () => parseFloat(strich.style.height);
  const peek = () => parseFloat(strich.style.top);

  check2('Die Liste hoert aufs Rollen', liste.__hat('scroll'));

  liste.classList.remove('rollt');
  liste.scrollTop = 0;
  liste.__fire('scroll');
  check2('Beim Rollen traegt sie die Klasse', liste.classList.contains('rollt'));

  // --- How long it gets ---
  // Proportional to the share, but with a cap and a floor. The share
  // alone would be a strip across half the track for eight conversations,
  // and without a floor a mere dot on very long lists that gets lost
  // while scrolling.
  check2('Bei einer langen Liste ist sie short',
    hoch() === Math.round(209 * 209 / 1463), `${hoch()} px`);

  // A short list, just barely longer than the box: without a cap that
  // would be nearly 200 px.
  liste.scrollHeight = 240;
  liste.scrollTop = 0;
  liste.__fire('scroll');
  check2('Bei einer kurzen Liste bleibt der Deckel',
    hoch() === STRICH_MAX, `${hoch()} px statt ${Math.round(209 * 209 / 240)}`);

  // A very long list: without a floor that would be 3 px.
  liste.scrollHeight = 14000;
  liste.__fire('scroll');
  check2('Bei einer sehr langen Liste haelt der Boden',
    hoch() === STRICH_MIN, `${hoch()} px statt ${Math.round(209 * 209 / 14000)}`);

  liste.scrollHeight = 1463;
  liste.scrollTop = 0;
  liste.__fire('scroll');

  // --- Where it sits ---
  check2('Ganz peek steht sie ganz peek', peek() === 0, strich.style.top);

  liste.scrollTop = liste.scrollHeight - liste.clientHeight;
  liste.__fire('scroll');
  check2('Ganz bottom steht sie ganz bottom',
    peek() === 209 - hoch(), `${strich.style.top} bei ${hoch()} px Marke`);

  liste.scrollTop = (liste.scrollHeight - liste.clientHeight) / 2;
  liste.__fire('scroll');
  check2('Und in der Mitte in der Mitte',
    peek() === Math.round((209 - hoch()) / 2), strich.style.top);

  // The mark never drops out at the bottom - it would otherwise, if the
  // height came from the previous calculation and the position from the new one.
  for (const gesamt of [240, 800, 1463, 14000]) {
    liste.scrollHeight = gesamt;
    liste.scrollTop = gesamt - liste.clientHeight;
    liste.__fire('scroll');
    if (peek() + hoch() > 209) {
      check2(`Marke bleibt im Kasten (${gesamt} px Liste)`, false,
        `${peek()} + ${hoch()} > 209`);
    }
  }
  check2('Marke bleibt bei jeder Listenlaenge im Kasten', true);
  liste.scrollHeight = 1463;

  // Nothing to scroll: then there's also no position to be standing at.
  liste.scrollHeight = liste.clientHeight;
  liste.scrollTop = 0;
  liste.__fire('scroll');
  check2('Ohne Rollweg bleibt sie weg', !liste.classList.contains('rollt'));
  liste.scrollHeight = 1463;
  liste.__fire('scroll');

  // And it fades out again. The wait uses the number from app.js, not one
  // copied out here: otherwise, after a change to it, this would check
  // against the old span and produce a failure that isn't one.
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT + 120));
  check2('Danach ist sie wieder weg', !liste.classList.contains('rollt'));

  // A follow-up scroll extends it instead of switching it off in between:
  // whoever keeps their finger moving shouldn't lose the thumb.
  liste.__fire('scroll');
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT * 0.6));
  liste.__fire('scroll');
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT * 0.6));
  check2('Nachschieben haelt den Strich', liste.classList.contains('rollt'));
  await new Promise((r) => setTimeout(r, STRICH_BLEIBT + 120));
  check2('Und danach geht er doch', !liste.classList.contains('rollt'));
}

// ---------------------------------------------------------------------------
// Marking as read: the view first, then the database
// ---------------------------------------------------------------------------
// While going through many conversations, the blue marker must not
// disappear only once the server has answered. If saving fails, it has to
// come back - otherwise the list shows a state that only this browser knows.

// A counter that records the chain .from().update().eq().eq().eq() and
// resolves at the end. The fakeDb proxy doesn't work here: it returns a
// function for every property, including 'error'.
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
  { wallet: 'aaa', usd: 31500, preview: 'big', tokens: 1, unread: 2 },
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

// Failure: the counter comes back, nothing gets reported.
state.dmThreads.find((t) => t.wallet === 'aaa').unread = 2;
const bad = dmDbStub({ message: 'kein Netz' });
state.db = bad.db;
await markiereGelesen('aaa');
check2('Nach Fehlschlag steht der Zaehler wieder',
  Number(state.dmThreads.find((t) => t.wallet === 'aaa').unread) === 2);
check2('Nach Fehlschlag ist die Flaeche wieder blau',
  el('#thread-items').innerHTML.includes('is-unread'));

// A conversation already marked read doesn't redraw the list, but writes
// anyway - the query just then matches no row.
const nochmal = dmDbStub(null);
state.db = nochmal.db;
await markiereGelesen('bbb');
check2('Gelesenes Gespraech schreibt trotzdem', nochmal.zaehler() === 1);
check2('Gelesenes Gespraech bleibt bei null',
  Number(state.dmThreads.find((t) => t.wallet === 'bbb').unread) === 0);

// A conversation the list doesn't even know must not trip anything up.
const unbekannt = dmDbStub(null);
state.db = unbekannt.db;
await markiereGelesen('gibtsnicht');
check2('Unbekanntes Gespraech schreibt ohne Fehler', unbekannt.zaehler() === 1);

// ---------------------------------------------------------------------------
// The dot disappears on opening, not after the server responds
// ---------------------------------------------------------------------------
// This broke once, and invisibly: demo mode exited openThread() BEFORE
// markiereGelesen() got its turn. You clicked an unread conversation,
// read it, and the list kept claiming something was still open.
//
// That's why the ORDER inside openThread() is checked here - that the
// mark-as-read sits before every exit point - and the effect: the counter
// is zero immediately, without waiting on the database.
{
  const source = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const bodyText = source.slice(source.indexOf('async function openThread'),
    source.indexOf('\n}', source.indexOf('async function openThread')));
  check2('markiereGelesen steht vor jedem return in openThread',
    bodyText.indexOf('markiereGelesen(wallet)') < bodyText.indexOf('return;'));

  // The opened demo conversation has to say the same thing as the row before it.
  //
  // Here the last message used to be hard-wired to Ansem with "will look
  // at it" - in EVERY conversation, even the ones showing without "You:"
  // in the list. The preview sat one line above it, so it wasn't the last
  // message at all.
  //
  // What's checked is the connection itself: the last of the three lines
  // carries the preview text, and its sender comes from the same field
  // the list takes its "You:" from. A hardcoded value at either spot
  // stands out this way.
  check2('Die last Demo-Nachricht ist die Vorschau, vom Absender der Liste',
    /from_admin: youLatest, body: line\?\.preview/.test(bodyText));
  check2('Und youLatest kommt aus last_from_admin',
    /const youLatest = !!line\?\.last_from_admin/.test(bodyText));

  // And the effect, through the real function: the server is held up,
  // the counter still has to already be zero.
  state.dmThreads = [{ wallet: 'zzz', usd: 100, tokens: 1, unread: 3, preview: 'x', last_from_admin: false }];
  let resolve;
  state.db = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({
    eq: () => new Promise((r) => { resolve = () => r({ error: null }); }) }) }) }) }) };
  const running = markiereGelesen('zzz');
  check2('Der Zaehler ist sofort null, vor der Antwort des Servers',
    Number(state.dmThreads[0].unread) === 0, String(state.dmThreads[0].unread));
  renderThreads();
  check2('Und die Zeile traegt is-unread nicht mehr',
    !el('#thread-items').innerHTML.includes('is-unread'));
  resolve();
  await running;
  state.db = echteDb;
}

state.db = echteDb;

// ---------------------------------------------------------------------------
// Admin preview: only on the operator's own machine
// ---------------------------------------------------------------------------
// The actual lock against foreign admin rights sits in the database. But
// an interface that shows Ansem's inbox on the real site would still be
// wrong - that's why this checks that the parameter has no effect there.
// Load the module fresh each time, because the value is read at startup.
const { PREVIEW_ADMIN: jetzt } = globalThis.__test;
check2('Ohne Parameter keine Vorschau', jetzt === false);

async function ladeMit(search, hostname) {
  globalThis.location = { search, hostname, href: `https://${hostname}/${search}` };
  globalThis.window.location = globalThis.location;
  // The file name has to differ per call: Node caches loaded modules, a
  // second import of the same path doesn't run again - and both values
  // are read at startup.
  const second = path.join(root,
    `.test-app-${hostname.replace(/\W/g, '')}-${search.replace(/\W/g, '')}.mjs`);
  fs.writeFileSync(second, src);
  try {
    await import('file://' + second);
    return {
      preview: globalThis.__test.PREVIEW_ADMIN,
      demo: globalThis.__test.DEMO_DMS,
      demoThreads: globalThis.__test.demoThreads,
      demoPolls: globalThis.__test.demoPolls,
    };
  } finally { fs.unlinkSync(second); }
}

check2('Vorschau greift auf localhost',
  (await ladeMit('?preview=admin', 'localhost')).preview === true);
check2('Vorschau greift NICHT auf der echten Seite',
  (await ladeMit('?preview=admin', 'sized.gg')).preview === false);
// ---------------------------------------------------------------------------
// Demo mode: the same lock, and for a sharper reason
// ---------------------------------------------------------------------------
// ?demo=40 fills the inbox with invented conversations. On the real site
// that wouldn't be a preview, it would be a lie: forty conversations that
// don't exist, with balances nobody holds. And because nothing gets
// loaded in demo mode, you wouldn't see the real ones anymore either.
//
// So both are checked - that it applies here AND that it doesn't apply
// there. Only together is it a meaningful statement.
{
  const daheim = await ladeMit('?demo=40', 'localhost');
  check2('Demomodus greift auf localhost', daheim.demo === 40);
  const draussen = await ladeMit('?demo=40', 'sized.gg');
  check2('Demomodus greift NICHT auf der echten Seite', draussen.demo === 0);
  const sub = await ladeMit('?demo=40', 'evil.localhost.example.com');
  check2('Und auch nicht auf einer Unterdomain', sub.demo === 0);
  // Without a number, forty; with a number, that number - and capped, so
  // a typo doesn't build fifty thousand rows.
  check2('Ohne Zahl sind es vierzig',
    (await ladeMit('?demo', 'localhost')).demo === 40);
  check2('Mit Zahl die Zahl',
    (await ladeMit('?demo=7', 'localhost')).demo === 7);
  check2('Nach peek gedeckelt',
    (await ladeMit('?demo=999999', 'localhost')).demo === 500);

  // The yellow bar belongs to the admin preview, not to demo mode.
  // ---------------------------------------------------------------------
  // In demo mode there used to be a notice there about the invented data.
  // It's gone, because it sat across the bottom edge in every screenshot
  // and every recording - and only whoever typed ?demo= themselves ever
  // saw it anyway.
  //
  // What's checked is the condition in the source, not the image: the bar
  // gets set at startup, and reconstructing the startup here would mean
  // reconstructing half the app. What matters is that DEMO_DMS no longer
  // appears in the condition and PREVIEW_ADMIN does.
  {
    const line = /flagge\.hidden = ([^;]+);/.exec(src);
    check2('Der Balken hangs noch an der Adminvorschau',
      !!line && line[1].includes('PREVIEW_ADMIN'), line?.[1]);
    check2('Und nicht mehr am Demomodus',
      !!line && !line[1].includes('DEMO_DMS'), line?.[1]);
    // A check on the check itself: if the pattern above matched nothing,
    // both checks would silently pass upward. So it has to match something.
    check2('Gegenprobe: die Zeile wurde ueberhaupt gefunden', !!line);
    // And the text must not come back through some other path either.
    check2('Kein Demotext, der den Balken doch wieder fuellt',
      !/flagge\.textContent/.test(src));
  }

  // Invented data has to follow the same rules as real data.
  //
  // One rule was wrong here: last_from_admin was rolled at random,
  // independent of the unread counter. That put rows on screen with
  // "You:" AND a blue dot at the same time - a state that cannot exist.
  // Unread counts messages FROM THE OTHER PERSON that Ansem hasn't seen
  // yet; to reply he has to open the conversation, and that marks it as read.
  //
  // The damage wouldn't have been the wrong dataset itself, but what gets
  // decided from it: you test the interface against a case it never sees,
  // and in doing so miss how it actually looks in reality.
  const construct = daheim.demoThreads;
  const erfunden = construct(200);
  check2('Erfundene Gespraeche: keins hat "You:" und offene Nachrichten zugleich',
    erfunden.every((t) => !(t.last_from_admin && Number(t.unread) > 0)),
    `${erfunden.filter((t) => t.last_from_admin && Number(t.unread) > 0).length} Widersprueche`);
  // And the control check: both cases have to occur at all, otherwise the
  // rule would only pass because there's nothing to check.
  check2('Es gibt beide Faelle im Datensatz',
    erfunden.some((t) => t.last_from_admin) && erfunden.some((t) => Number(t.unread) > 0));

  // The same rule one level down: whoever wrote the last message also
  // decides how it sounds. Drawing from one shared pool produced "You:
  // wen poll" - Ansem asking himself when the next poll is.
  //
  // What's checked is that the two sets of texts don't overlap. This
  // works without needing the lists themselves: if they were the same
  // sentences again, some would inevitably show up in both across 200 conversations.
  const vonAnsem = new Set(erfunden.filter((t) => t.last_from_admin).map((t) => t.preview));
  const vonNutzern = new Set(erfunden.filter((t) => !t.last_from_admin).map((t) => t.preview));
  check2('Ansem und die Nutzer schreiben nicht dieselben Saetze',
    [...vonAnsem].every((s) => !vonNutzern.has(s)),
    [...vonAnsem].filter((s) => vonNutzern.has(s)).join(' | '));
  check2('Und beide Mengen sind ueberhaupt gefuellt',
    vonAnsem.size > 1 && vonNutzern.size > 1, `${vonAnsem.size} / ${vonNutzern.size}`);
}

// ---------------------------------------------------------------------------
// What else demo mode fakes
// ---------------------------------------------------------------------------
// Not just conversations: three polls too, and their own options. Both
// belong here, because otherwise you'd be looking at the inbox on a page
// whose other half is empty - and because a reply field that throws an
// error on submit hides exactly what you wanted to see.
{
  const { demoPolls: construct } = await ladeMit('?demo=8', 'localhost');
  const polls = construct();

  check2('Der Demomodus liefert drei Abstimmungen', polls.length === 3);

  // Different orders of magnitude, and that's the point: with three polls
  // of the same size, every version of the row looks fine.
  const stellen = polls.map((p) => String(Math.round(p.totalUsd)).length);
  check2('Mit sehr verschiedenen Summen',
    new Set(stellen).size === 3, polls.map((p) => Math.round(p.totalUsd)).join(' / '));

  // And three different states - they look different from each other.
  check2('Und drei verschiedenen Zustaenden',
    polls.filter((p) => p.closed).length === 1
    && polls.filter((p) => !p.closed && p.closesAt).length === 1
    && polls.filter((p) => !p.closed && !p.closesAt).length === 1);

  // The shares carry the bar width. If they don't add up to exactly one,
  // the card in the simulation would differ from the one in production.
  for (const p of polls) {
    const summe = p.options.reduce((a, o) => a + o.share, 0);
    if (Math.abs(summe - 1) > 0.001) {
      check2(`Anteile von "${p.question}" ergeben eins`, false, String(summe));
    }
    const amounts = p.options.reduce((a, o) => a + o.usd, 0);
    if (Math.abs(amounts - p.totalUsd) > 0.01) {
      check2(`Summe von "${p.question}" stimmt`, false, `${amounts} gegen ${p.totalUsd}`);
    }
  }
  check2('Anteile und Summen stimmen in allen dreien', true);
}

// The reply in demo mode stays in memory. What's checked is the ORDER in
// the source: the demo branch has to sit BEFORE the insert and end with a
// return. If it sits after it, the reply still falls into the database -
// and you wouldn't see that in the simulation, because everything looks
// the same there.
//
// A measurement would be nicer. It doesn't work here: the listener hangs
// off the form, and a second module import hangs a second one right next
// to it - then the old branch would run along on submit too. As a source
// check this is more honest than a measurement that measures something else.
{
  const source = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const block = source.slice(source.indexOf("$('#admin-dm-form').addEventListener"));
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
