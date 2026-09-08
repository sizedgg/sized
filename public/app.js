// ---------------------------------------------------------------------------
// SIZED - Frontend.
//
// After verification the browser talks to Supabase directly (PostgREST +
// Realtime). What it's allowed to do is decided entirely by RLS - nothing
// here is secured that isn't also secured in the database.
// ---------------------------------------------------------------------------

import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TOKEN_KEY = 'ansem_jwt';

/**
 * The login in progress, so a reload can resume it.
 *
 * This holds the challenge secret - the proof that this login belongs to
 * ME. The edge function hands it out exactly once and afterward knows only
 * its hash.
 *
 * Without this line, the lock in verify would be a step backward instead of
 * an improvement: it used to look up an open challenge by wallet and hand
 * it to whoever typed in the same address - that's exactly what the
 * takeover hinged on. Now it only resumes for whoever sends back their
 * secret. Anyone who loses it on reload would get a second challenge with a
 * second amount and pay twice.
 *
 * localStorage and not sessionStorage: someone who switches to a wallet app
 * on their phone and comes back may land in a new tab, depending on the
 * browser.
 */
const CHALLENGE_KEY = 'ansem_challenge';

const rememberChallenge = (c) => {
  try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify(c)); } catch { /* private mode */ }
};
const forgetChallenge = () => {
  try { localStorage.removeItem(CHALLENGE_KEY); } catch { /* doesn't matter */ }
};
const rememberedChallenge = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CHALLENGE_KEY) || 'null');
    // Don't even send back an expired one - verify would create a new one
    // anyway, but this way the case stays visible here instead of there.
    return c && new Date(c.expiresAt).getTime() > Date.now() ? c : null;
  } catch { return null; }
};

/**
 * Track whether the keyboard or the mouse is currently driving input.
 *
 * The reason: a text field shouldn't light up on click. Whoever clicks into
 * it already knows where they clicked - the outline tells them nothing new
 * and would reappear on every DM typed.
 *
 * Tabbing is the opposite case: there, the outline is the only information
 * about where you are, and a poll box can have ten identical-looking fields
 * stacked on top of each other.
 *
 * Why this can't be done in CSS, even though :focus-visible exists for it:
 * on buttons, :focus-visible cleanly separates mouse and keyboard; on text
 * fields it does NOT. The browser rule says a field you can type into always
 * counts as "visibly focused" - even after a mouse click. Measured in
 * Chromium: button after click is false, text field after click is true.
 * Without these few lines, there would be no way to make that distinction
 * for fields at all.
 *
 * Only the Tab key counts, not every key: someone typing in a field is
 * using the keyboard but not navigating - no outline should appear for
 * that.
 */
addEventListener('keydown', (e) => {
  if (e.key === 'Tab') document.documentElement.dataset.tastatur = '';
}, true);
addEventListener('pointerdown', () => {
  delete document.documentElement.dataset.tastatur;
}, true);

/**
 * Look at Ansem's view without changing anything in the database.
 *
 * Call it with ?preview=admin - and only on your own machine. The lock to
 * localhost isn't incidental: without it, any visitor to the real site
 * could append the parameter and see Ansem's inbox UI.
 *
 * It is explicitly the VIEW only. Whoever actually has admin rights is
 * listed in app_config.admin_wallet, and the database checks that on every
 * access. Creating a poll, reading someone else's DMs, or setting the DM
 * threshold all fail in this preview - with exactly the error message a
 * stranger would get. That's the correct behavior, not a gap: if the UI
 * here could be talked into writing, the real check would be in the wrong
 * place.
 */
const NUR_HIER = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);

const PREVIEW_ADMIN =
  new URLSearchParams(location.search).get('preview') === 'admin' && NUR_HIER;

/**
 * A full inbox to look at - made up, not loaded.
 *
 * Call it with ?demo=40 - and like the preview above, only on your own
 * machine.
 *
 * The reason: almost every question about this inbox only shows up at forty
 * rows, not at four. Does the threshold line stay put while scrolling? Does
 * an unread conversation still stand out among the others? How does a
 * column of forty amounts read? With real data, the answer would be: not
 * until Ansem has forty people.
 *
 * IMPORTANT: in this mode NOTHING is loaded and NOTHING is written. The
 * conversations don't exist. Clicking "Hide" only changes the display - the
 * database never sees it. That rules out test data ending up in a
 * production database while trying things out.
 *
 * The number is freely chosen (?demo=200 works too); without a number it's
 * 40.
 */
const DEMO_DMS = (() => {
  if (!NUR_HIER) return 0;
  const p = new URLSearchParams(location.search).get('demo');
  if (p === null) return 0;
  return Math.min(500, Math.max(1, Number(p) || 40));
})();

/**
 * The made-up conversations.
 *
 * A fixed seed instead of Math.random(): two calls to the same address
 * should produce the same picture. Otherwise, switching back and forth
 * between two versions of the sheet compares two different data sets, and
 * you mistake the difference for an effect of the change.
 */
function demoThreads(n) {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let saat = 20260831;
  const zufall = () => (saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648;
  // Two lists, not one. The preview is the last message, and it has a
  // sender - if "You:" is in front of it, Ansem wrote it. Drawing from one
  // shared pool produced "You: wen poll" - Ansem asking himself about a
  // poll.
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
    // Amounts across the whole range, from seven digits down to below any
    // threshold - the edges are what you actually want to see.
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
    // Who wrote last is tied to the unread counter and can't be rolled
    // independently. That was wrong here, and it showed in the picture:
    // conversations with "You:" AND a blue dot.
    //
    // That state can't exist. Unread counts messages FROM THE OTHER PERSON
    // that Ansem hasn't seen yet - and to reply, he has to open the
    // conversation, which marks it read. If he wrote last, nothing is open
    // anymore.
    //
    // Made-up data has to follow the same rules as real data, or you end up
    // testing the UI against a case it never sees - and miss how it looks
    // in the real one.
    ...t,
    last_from_admin: t.unread === 0 && zufall() < 0.45,
  })).map((t) => ({
    // The text only now: it depends on who wrote last, and that's settled
    // one line earlier.
    ...t,
    preview: t.last_from_admin
      ? VON_ANSEM[Math.floor(zufall() * VON_ANSEM.length)]
      : VON_NUTZERN[Math.floor(zufall() * VON_NUTZERN.length)],
  })).sort((a, b) => b.usd - a.usd);
}

/* Storage that doesn't take the page down when there isn't any.
   ---------------------------------------------------------------------------
   localStorage isn't "sometimes empty" - it's sometimes FORBIDDEN: Safari
   with "block all cookies", Brave with strict shields, several in-app
   browsers throw a SecurityError on the mere access.

   The access used to sit bare in the line below, at top module level - so
   the error hit before anything had been drawn, and the visitor saw a black
   screen. No login, no message, and reloading never helped. It hit exactly
   the people opening a link from X or Telegram.

   Empty storage, on the other hand, is harmless: you're just not logged in.
   That's why read() catches the error and returns null, and write()
   swallows it. What's lost is staying logged in across visits - not the
   page. */
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } };
const removeKey = (k) => { try { localStorage.removeItem(k); } catch { /* blocked */ } };

const state = {
  jwt: read(TOKEN_KEY) || null,
  db: null,
  me: null,
  // min_chat_usd still lives in the database but isn't read here anymore:
  // chat is gone, and the column just stays so nothing has to be dropped.
  cfg: { symbol: 'ANSEM', admin_wallet: null, treasury: null, min_dm_usd: 0 },
  dmMessages: [],
  dmReplyTo: null,
  dmRepliesAvailable: true,
  // Conversations already opened, by address. So a second click on a
  // thread shows something right away instead of only after the network
  // reply.
  dmCache: new Map(),
  // What Ansem is currently typing, before it's saved. The inbox already
  // follows this number; it's only saved when the field loses focus.
  // Kept separate from cfg.min_dm_usd, otherwise there'd be no way to tell
  // whether anything actually changed compared to the saved value.
  dmMinEntwurf: null,
  // Is the inbox currently showing the manually hidden conversations?
  // Only for this session - gone again on the next load, since that's the
  // normal state.
  zeigeVerborgene: false,
  // Does the database even know about hiding yet? See checkHiding().
  dmHideAvailable: false,
  polls: [],
  dmThreads: [],
  activeThread: null,
  challenge: null,
  poller: null,      // polls whether the payment has arrived (3s/10s/30s)
  clock: null,         // writes the remaining time on the payment screen, once a second
  activeTab: 'polls',
  channels: {},
  reloadTimers: {},
  fallback: {},
  stimmenTakt: null,   // polls the vote counts instead of receiving them pushed
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// Numbers deliberately in en-US format: "$1,325" is unambiguous, "$1.325"
// reads like a euro amount with decimal places.
const nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const nfFull = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const fmtUsd = (n) => (!n ? '$0' : n < 1 ? '$' + n.toFixed(2) : '$' + (n >= 10_000 ? nfCompact.format(n) : nfFull.format(n)));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/* Written out in full instead of abbreviated - for the polls, and for the
   image the download button generates.

   fmtUsd abbreviates from 10,000 up ("$482.9K"), because in the inbox the
   amount sits in a narrow column next to the handle; there, brevity counts.
   In a poll it stands alone at the end of a line and has room, and there
   "$482,900" is the more defensible figure: it's the number someone can
   actually argue with. */
const nfGanz = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fullUsd = (n) => '$' + nfGanz.format(Math.round(Number(n) || 0));

/* With thousands separators: "38100" reads as a string of digits you have
   to count along - "38,100" doesn't. */
const wholeNumber = (n) => nfGanz.format(Number(n) || 0);

/**
 * The amount next to a row in the inbox - short enough to fit a narrow
 * column.
 *
 * Rule: never more than three digits. Under a thousand, the whole number;
 * above that, abbreviated with K, M, or B. There's a decimal place only as
 * long as the leading digit stays single:
 *
 *      1,412 -> $1.4K        31,500 -> $32K
 *      3,444 -> $3.4K       781,420 -> $781K
 *        999 -> $999      1,240,000 -> $1.2M
 *
 * That makes the longest case five characters wide. That's exactly what
 * makes the column possible where the amounts line up underneath each
 * other: it can be narrow and still never overflow.
 *
 * Round first, then pick the unit. The other way around, 999,960 would
 * round up to "1000K" - four digits, and the column would blow out. Via
 * toPrecision(3) it becomes 1,000,000 and thus "$1.0M".
 *
 * Under a dollar it shows "<$1" instead of "$0.42": two decimal places
 * would be the one case that falls outside the column, and being accurate
 * to the cent serves nobody anyway for a balance measured in cents.
 *
 * fmtUsd() still exists alongside this and keeps being used wherever there
 * is room and the exact number matters: in the header, in the lockout
 * messages, and in the count of how many conversations the inbox is
 * currently hiding.
 *
 * The ROWS of the inbox use shortUsd instead. They originally used fmtUsd,
 * which only abbreviates from 10,000 up - so "$9,800" and "$214K" sat
 * stacked in the same narrow column. Two different notations for the same
 * thing in one list, and the longer one landed on the smaller amounts.
 *
 * Between 1,000 and 10,000 there's no decimal place: "$9K" instead of
 * "$8.8K". The reasoning is with the line itself - short version: that
 * digit claims a precision the number doesn't have.
 */
const TIERS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function shortUsd(n) {
  const number = Number(n);
  if (!Number.isFinite(number) || number <= 0) return '$0';
  if (number < 1) return '<$1';
  const gerundet = Number(number.toPrecision(3));
  for (const [ab, short] of TIERS) {
    if (gerundet < ab) continue;
    const wert = gerundet / ab;
    // Between 1,000 and 10,000, NO decimal place: "$9K", not "$8.8K".
    //
    // The reason isn't space, it's honesty. "$8.8K" looks like a precise
    // figure and isn't one - behind it is something between 8,750 and
    // 8,849. That digit claims a precision the number doesn't have, and it
    // does so exactly where the amounts sit close together and get
    // compared.
    //
    // "$9K" says the same thing and claims nothing. Anyone who wants the
    // exact amount opens the conversation.
    //
    // Only this one tier: at millions the decimal place stays, because
    // there a million sits between "$1M" and "$2M" - there it carries real
    // information.
    //
    // Rounding here comes from the RAW VALUE, not from gerundet: the
    // toPrecision(3) above exists so that 999,960 doesn't become "1000K" -
    // but it does turn 1,499 into 1,500, and Math.round() of that into
    // "$2K". Rounding twice rounds up twice. From the raw value it's "$1K",
    // and that's the correct answer.
    if (short === 'K' && wert < 9.95) return '$' + Math.round(number / ab) + short;
    return '$' + (wert < 9.95 ? wert.toFixed(1) : String(Math.round(wert))) + short;
  }
  return '$' + Math.round(gerundet);
}

/**
 * Date separator in conversations.
 *
 * A DM thread runs over days or weeks. Without a separator there's just a
 * timestamp, and "09:12" doesn't say whether that was this morning or three
 * weeks ago.
 *
 * "Today" and "Yesterday" instead of a date for the last two days: that's
 * the information you're actually after, and you don't have to work out
 * what weekday today is first. The year is only shown when it isn't the
 * current one - otherwise it repeats in every separator.
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

/* kurzAdresse() used to be here: your own address as "EMwU...QLxP", four
   characters, ellipsis, four characters. It replaced the handle in the top
   right, on the argument that the question there isn't "who am I" but
   "which wallet am I here as".

   It's gone again, function and all: the top right now shows the three
   characters in your own color again - the same identifier as in the DMs
   and the inbox. An abbreviation with no caller could have stayed here; it
   just looked like it was needed.

/**
 * Hue for a username.
 *
 * Three characters aren't enough to reliably tell people apart: with a few
 * hundred members, some are bound to share the same handle. A fixed color
 * per wallet gives the name a second feature without making it longer -
 * two "7xK"s side by side then still look different.
 *
 * Two decisions behind this:
 *
 *   * It's computed from the full address, not the three characters.
 *     Otherwise the look-alikes would end up with the same color, of all
 *     people.
 *   * The accent color isn't in the pool. It belongs to Ansem alone - that
 *     way it always means "that's him", and no participant can randomly
 *     end up in his color. That leaves four tones, which is enough to tell
 *     people apart.
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
 * Text with clickable left.
 *
 * The order here is the security property, not a detail: the text is SPLIT
 * APART and each piece is escaped individually. The obvious approach -
 * escape first, then run a regex over the result - is risky, because
 * escaping itself inserts characters (& becomes &amp;) that the regex would
 * then have to take apart again. Get that wrong and you open a hole that
 * lets foreign HTML into the page.
 *
 * Only http:// and https:// and www. - deliberately NOT a bare domain like
 * "sized.gg". The filter in the database knows a list of TLDs and is
 * allowed to be generous, because it only rejects. Here, the same
 * generosity would turn "1.25" and "z.b" into left. Rejecting is cheap;
 * offering a wrong link is not.
 *
 * For www., https:// is prepended. Without a scheme the browser would read
 * the address as a relative path and land on sized.gg/www.example.com.
 *
 * The scheme is therefore ALWAYS http or https - "javascript:" can't occur
 * here, because the pattern never matches it in the first place.
 *
 * rel and referrerpolicy aren't cosmetic:
 *   * noopener - without it, the opened page can reach back through
 *                window.opener and, say, redirect this one to a lookalike
 *                page while the user is reading in the other tab.
 *   * noreferrer, no-referrer - the target site doesn't learn where the
 *                click came from. In a room whose membership costs money,
 *                even the origin is information.
 *   * nofollow  - no incentive to use this as a link farm.
 */
const LINK_MUSTER = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function withLinks(text) {
  const roh = String(text ?? '');
  let out = '';
  let latest = 0;

  for (const treffer of roh.matchAll(LINK_MUSTER)) {
    const start = treffer.index;
    let url = treffer[0];

    // Trailing punctuation belongs to the sentence, not the address:
    // "check out https://sized.gg." doesn't end with a period in the URL.
    // A closing parenthesis stays only if there's a matching opening one -
    // Wikipedia addresses contain those.
    let tail = '';
    for (;;) {
      const lastChar = url.slice(-1);
      // Parentheses are counted, not guessed: one closing paren too many
      // belongs to the sentence, a balanced one belongs to the address.
      // "(https://en.wikipedia.org/wiki/Foo_(bar))" ends with the address
      // "..._(bar)" and a parenthesis that closes the sentence.
      const zuViele = lastChar === ')'
        && (url.split(')').length - 1) > (url.split('(').length - 1);
      if ('.,;:!?'.includes(lastChar) || zuViele) {
        tail = lastChar + tail;
        url = url.slice(0, -1);
        continue;
      }
      break;
    }
    if (!url) continue;

    const ziel = /^www\./i.test(url) ? 'https://' + url : url;
    out += esc(roh.slice(latest, start));
    out += `<a href="${esc(ziel)}" target="_blank"`
      + ` rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">${esc(url)}</a>`;
    out += esc(tail);
    latest = start + treffer[0].length;
  }

  out += esc(roh.slice(latest));
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
// Edge functions
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
 * Important: pass the token through `accessToken`, not as a fixed header.
 *
 * A header in `global.headers` only applies to REST calls. The realtime
 * connection would keep running with the anon key, and since our RLS
 * policies only let `authenticated` read, not a single event would arrive
 * there - messages would only show up after a reload. `accessToken` applies
 * to both and is re-fetched on every connection.
 */
function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: async () => state.jwt,
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

/** Throws with a readable message instead of the raw PostgREST object. */
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Database error');
  return data;
}

// ---------------------------------------------------------------------------
// Login via payment verification
// ---------------------------------------------------------------------------

// Enter in the address field does the same thing as the button.
// ---------------------------------------------------------------------------
// The field isn't inside any <form>, so there was nothing to submit - and
// without a listener, Enter did nothing at all. On a phone this is the
// worst possible place for that: you type the address, hit the "Go" key on
// the keyboard, nothing happens, and at that moment the button is sitting
// behind the on-screen keyboard. This is the first thing every new user
// does.
//
// No wrapping it in a <form> after the fact: a form without an action
// reloads the page on Enter if the JavaScript ever fails to run - and then
// the typed-in address is gone. A listener does exactly the one thing it's
// supposed to.
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
  // disabled AND the class: one blocks the second click, the other shows
  // that something is happening. There used to be only the first - but a
  // faded button looks broken, not busy.
  btn.disabled = true;
  btn.classList.add('laedt');
  try {
    // Resume our own still-running login for the same address - otherwise
    // verify rolls a second amount, and whoever already paid pays again.
    const next = rememberedChallenge();
    const c = await callFunction('verify', {
      action: 'challenge',
      wallet,
      ...(next?.wallet === wallet
        ? { challengeId: next.challengeId, secret: next.secret }
        : {}),
    });
    state.challenge = c;
    rememberChallenge(c);
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
  // Cancel means cancel: the next login starts fresh. The old challenge
  // expires on its own.
  forgetChallenge();
  $('#step-pay').hidden = true;
  $('#step-address').hidden = false;
});

/**
 * Copy with a visible confirmation.
 *
 * navigator.clipboard only exists over HTTPS and not in every embedded
 * browser (Twitter's, for instance). The second path, through a hidden
 * field, works everywhere - and if even that fails, the text is at least
 * selected so it can be copied by hand. There's a payment riding on this;
 * dismissing with no result would be the worst outcome.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the second path */ }

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

// How long the outline stays lit after copying.
//
// First 1800, then 900, now 1500 - and the number was decided on the
// device, not at a desk. 1800 looked like a state instead of a response;
// 900 was too short to even notice once the outline was toned down to a
// subtle glow. Whoever copies an address is usually already looking at
// their wallet app by that point.
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

  // Last resort: select it so the user can copy it themselves.
  //
  // The class first: otherwise the row isn't even selectable (see .pay-row
  // in styles.css - a blue block next to "Copied ✓" would be a second
  // response to the same tap). Without this line, the message below would
  // be pointing at nothing.
  b.classList.add('zum-markieren');
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* then it just doesn't select */ }
  toast('Could not copy automatically - the text is selected for you', true);
}));

// ---------------------------------------------------------------------------
// Start screen
//
// On a phone, the login is preceded by a prompt to add the page to the home
// screen. The reason is concrete: browsers clear out stored sessions after
// a long stretch without a visit - and logging in again here costs a real
// payment. From the home screen, that doesn't happen.
//
// It's a prompt, not a gate. Dismissing it lets you continue and you're not
// asked again: embedded browsers (Twitter, Telegram) can't add to the home
// screen at all, and stopping those people every time would be pure
// harassment.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The keyboard no longer pushes the whole view up
// ---------------------------------------------------------------------------
//
// Found on-device: typing a DM on a phone pushes everything up out of the
// picture - the header, the tabs, the top edge of the frame.
//
// Why iOS does this is explained in full in styles.css at --sicht. Short
// version: the page is 100dvh tall, and dvh knows nothing about the
// keyboard. The bottom half of the page ends up covered, the input field
// sits underneath it - so iOS pushes everything up on its own. The only way
// to stop it is to remove the reason for it: if the page is only as tall as
// what's actually visible, there's nothing to push.
//
// visualViewport is the part of the window that's actually visible - no
// keyboard, no browser chrome. That's exactly the number needed here.
//
// ---------------------------------------------------------------------------
// Why a threshold, and not just always the visible height
//
// visualViewport.height also changes when Safari's address bar slides in
// and out while scrolling - dozens of times per swipe, by a few pixels. If
// the page height tracked that, the whole sheet would twitch on every
// scroll. That's exactly what 100dvh is for, and the browser does it more
// smoothly than we could.
//
// A keyboard, on the other hand, takes up a third of the screen. 120px
// reliably separates the two: less is a toolbar, more is a keyboard.
const TASTATUR_AB_PX = 120;

function tastaturBeobachten() {
  const vv = window.visualViewport;
  // Older browsers don't have this. Then it just falls back to the old
  // behavior - not pretty, but not broken either.
  if (!vv) return;


  const track = () => {
    const verdeckt = window.innerHeight - vv.height;
    if (verdeckt > TASTATUR_AB_PX) {
      document.documentElement.style.setProperty('--sicht', `${vv.height}px`);
      // --versatz is the half that was missing on the first attempt.
      // -----------------------------------------------------------------
      // Height alone isn't enough. iOS does two things when the keyboard
      // comes up: it shrinks the visible viewport AND it SHIFTS it upward
      // over the page, so the input field ends up inside it. The second
      // part isn't scrolling - the page itself stays put, it's the
      // viewport that moves. That's also why window.scrollTo(0, 0) didn't
      // help here: there's nothing to scroll, the page is overflow:
      // hidden.
      //
      // How far it shifted is in visualViewport.offsetTop. And because the
      // page stays put while the viewport moves, the view has to shift by
      // EXACTLY the same amount so it lines back up under the viewport.
      // That's the offset.
      //
      // Only .app is shifted, not the login screen: there the card is
      // SUPPOSED to move out of the way (see styles.css).
      document.documentElement.style.setProperty('--versatz', `${vv.offsetTop}px`);
    } else {
      // Keyboard down again: remove the properties entirely, don't set
      // them to a value. Only that way does the fallback in the sheet
      // (100dvh) apply again, and it follows the browser's toolbars on its
      // own.
      document.documentElement.style.removeProperty('--sicht');
      document.documentElement.style.removeProperty('--versatz');
    }
  };

  vv.addEventListener('resize', track);
  // Also on scroll: iOS sometimes shifts the visible viewport without
  // changing its height - then no resize fires, but the view is still
  // left misaligned.
  vv.addEventListener('scroll', track);
  track();
}
tastaturBeobachten();

/* ---------------------------------------------------------------------------
   Measurement overlay: ?measurer=1
   ---------------------------------------------------------------------------
   A small box that shows what the browser is currently reporting and what
   the sheet does with it. It exists because a bug was reported that no
   reproduction here reproduces - the form gets squashed on the device, not
   in any rebuild of it. Instead of guessing which value is at fault, the
   device shows it directly.

   Deliberately NOT restricted to localhost, unlike ?demo= and ?preview=:
   the bug happens on the phone, and the phone can't reach the dev
   machine's localhost. It also shows nothing confidential - just numbers
   about the window it's running in. Anyone who doesn't know the URL
   parameter never sees it.

   pointer-events: none, so it doesn't intercept anything: a measuring
   device that disturbs the measurement is measuring itself. */
const MEASURE_SWITCH = 'size_mess';

/* Tapping the empty area of the header five times toggles the overlay on
   and off.
   ---------------------------------------------------------------------------
   This used to be wired to the logo - a mistake: the logo is a link to the
   X account. The first tap already navigated away, and the other four
   never happened.

   Now it's wired to the header itself, and touches that land on a link or
   button don't count. On a phone the header wraps: logo on the left,
   avatar on the right, roughly 220px between them that do nothing. Right
   into that gap.

   The workaround via the URL (?measurer=1) isn't enough on its own: the bug
   happens on the home-screen app, and there IS no address bar there - the
   app always starts at the start_url from the manifest. A switch you can
   only flip in Safari doesn't measure the exact case in question. (Storage
   doesn't help either: iOS keeps a home-screen app's storage separate from
   Safari's.)

   Five touches within two seconds on an area that otherwise does nothing:
   nobody does that by accident, and whoever does it on purpose sees
   numbers about their own window. Nothing more than that. */
(function measureSwitch() {
  const header = document.querySelector('.topbar');
  if (!header) return;
  let zaehler = 0;
  let last = 0;
  header.addEventListener('click', (e) => {
    // Whoever hits the link or a button wanted the link or the button.
    if (e.target.closest('a, button, input')) { zaehler = 0; return; }
    const jetzt = Date.now();
    zaehler = jetzt - last < 2000 ? zaehler + 1 : 1;
    last = jetzt;
    if (zaehler < 5) return;
    zaehler = 0;
    try {
      const an = localStorage.getItem(MEASURE_SWITCH) === '1';
      localStorage.setItem(MEASURE_SWITCH, an ? '0' : '1');
    } catch {}
    location.reload();
  });
})();

const measureOn = (() => {
  if (new URLSearchParams(location.search).get('measurer') === '1') return true;
  try { return localStorage.getItem(MEASURE_SWITCH) === '1'; } catch { return false; }
})();

if (measureOn) {
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;'
    + 'margin:0;padding:6px 8px;border-radius:6px;pointer-events:none;'
    + 'background:rgba(0,0,0,.82);color:#9fe8b0;font:11px/1.35 ui-monospace,monospace;'
    + 'white-space:pre;max-width:calc(100vw - 12px);border:1px solid #2a2f3a';
  document.body.appendChild(panel);

  const box = (s) => {
    const e = document.querySelector(s);
    if (!e) return 'fehlt';
    const r = e.getBoundingClientRect();
    return `${Math.round(r.top)}..${Math.round(r.bottom)} h=${Math.round(r.height)}`;
  };
  const stil = (n) => getComputedStyle(document.documentElement)
    .getPropertyValue(n).trim() || '(empty)';

  const show = () => {
    const vv = window.visualViewport;
    const admin = document.querySelector('#poll-admin');
    panel.textContent = [
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
      // Don't call isStandalone(): the function is defined further down
      // and isn't initialized here yet - calling it would throw an error,
      // and in the one tool that's supposed to find errors, of all places.
      `standalone   ${window.matchMedia?.('(display-mode: standalone)').matches
        || window.navigator?.standalone === true}`,
    ].filter(Boolean).join('\n');
  };

  show();
  window.visualViewport?.addEventListener('resize', show);
  window.visualViewport?.addEventListener('scroll', show);
  window.addEventListener('resize', show);
  document.addEventListener('focusin', () => setTimeout(show, 350));
  document.addEventListener('click', () => setTimeout(show, 350));
  setInterval(show, 500);
}

const INSTALL_SKIPPED = 'size_install_skipped';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  window.navigator?.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '');
/* A phone is recognized by touch, not by width.
   ---------------------------------------------------------------------------
   This used to be (max-width: 760px). But an iPhone 14 in landscape is
   844px wide, a Pro Max 932 - opening the link in landscape counted as a
   desktop, and the prompt to add to the home screen was never shown.

   That's more expensive than it sounds: that exact prompt is what protects
   against iOS clearing the session after a few days. Once it's gone, the
   next login costs another payment.

   (hover: none) and (pointer: coarse) together: the first one alone also
   matches TVs, the second one alone also matches touchscreen desktops.
   Both together mean a device you hold in your hand. */
const isPhone = () =>
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

// Chrome offers to add to home screen on its own - we intercept that offer
// and only trigger it once the user taps our button.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('#btn-install').hidden = false;
});

/**
 * Show the login screen.
 *
 * In the markup it starts hidden, same as the app. Only startup decides
 * what's shown, and shows exactly one of the two - otherwise the login
 * would flash briefly on every load, even for people already signed in.
 */
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

/** The counterpart - here too, exactly one of the two is shown. */
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}


function maybeShowInstallStep() {
  if (state.jwt) return;                      // anyone already signed in isn't held up
  if (!isPhone() || isStandalone()) return;
  try { if (localStorage.getItem(INSTALL_SKIPPED)) return; } catch { /* doesn't matter */ }

  // iOS has no button for this - only the instructions remain there.
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
  try { localStorage.setItem(INSTALL_SKIPPED, '1'); } catch { /* doesn't matter */ }
  leaveInstallStep();
});

$('#btn-install').addEventListener('click', async () => {
  if (!deferredInstall) { leaveInstallStep(); return; }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  $('#btn-install').hidden = true;
  // Stay put on acceptance: the user should verify from the home-screen
  // version, not here in the browser.
  if (outcome !== 'accepted') leaveInstallStep();
});

window.addEventListener('appinstalled', () => {
  // Don't jump ahead automatically: verification should happen from the
  // home-screen version, otherwise the session ends up back in the browser.
  const lede = $('#step-install .lede');
  if (lede) lede.textContent = 'Added. Open SIZED from your home screen and verify there.';
  $('#btn-install').hidden = true;
});

/**
 * Poll whether the payment has arrived - with a growing interval.
 *
 * A fixed four-second beat across the whole 25-minute window would be up to
 * 375 function calls for a single login, each backed by an RPC scan. The
 * payment almost always arrives within the first minute, so polling is
 * tight there and thins out afterward: same felt speed, roughly a tenth of
 * the calls.
 */
function pollDelay(elapsedMs) {
  if (elapsedMs < 60_000) return 3_000;
  if (elapsedMs < 300_000) return 10_000;
  return 30_000;
}

/**
 * The clock on the payment screen.
 *
 * It has NOTHING to do with polling, and that's exactly where the bug was:
 * the remaining time used to only get rewritten when a response came back.
 * Because the interval between requests grows (3s, 10s, 30s), the display
 * jumped along with it - by three seconds at first, by thirty after five
 * minutes. You're waiting on a transfer and watching a clock that stutters;
 * that looks broken, and at that moment trust is the only thing the page
 * has to offer.
 *
 * Why not setInterval(..., 1000): browsers don't hold 1000ms exactly, they
 * only guarantee AT LEAST 1000. Those few milliseconds of delay add up,
 * drift against the real second boundary - and eventually a number gets
 * skipped: 24:59, 24:58, 24:56. Same bug, just smaller.
 *
 * Instead, each next call is scheduled for the next second boundary
 * (left % 1000), plus a 20ms safety margin so it doesn't land just before
 * it and write the same number twice. The value itself is always computed
 * from deadline and Date.now(), never counted up: someone who backgrounds
 * the tab, where browsers throttle timers, sees the correct time
 * immediately on return, not the accumulated drift.
 */
const restText = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')} left`;

function startClock(deadline) {
  const draw = () => {
    const left = Math.max(0, deadline - Date.now());
    $('#pay-timer').textContent = restText(left);
    if (left <= 0) return;
    state.clock = setTimeout(draw, (left % 1000) + 20);
  };
  draw();
}

function startPolling() {
  stopPolling();
  const id = state.challenge.challengeId;
  const geheimnis = state.challenge.secret;
  const deadline = new Date(state.challenge.expiresAt).getTime();
  const startedAt = Date.now();

  startClock(deadline);

  const tick = async () => {
    const left = Math.max(0, deadline - Date.now());

    try {
      const r = await callFunction('verify', {
        action: 'status', challengeId: id, secret: geheimnis,
      });
      if (r.status === 'verified') {
        stopPolling();
        forgetChallenge();
        state.jwt = r.token;
        write(TOKEN_KEY, r.token);
        state.me = r.profile;
        await enterApp();
        return;
      }
      if (r.status === 'expired') {
        stopPolling();
        forgetChallenge();
        $('#pay-error').textContent = 'This request expired. Start over to get a new amount.';
        $('#pay-error').hidden = false;
        return;
      }
    } catch { /* next attempt */ }

    if (left <= 0) { stopPolling(); return; }
    state.poller = setTimeout(tick, pollDelay(Date.now() - startedAt));
  };

  tick();
}

/**
 * One switch for both timers, not two.
 *
 * They're two completely different things - the polling and the clock -
 * but they always end together: on confirmed payment, on expiry, on
 * logout. Two switches would be two places to forget one of them, and the
 * forgotten clock would keep running invisibly, writing into a field
 * nobody's looking at anymore.
 */
const stopPolling = () => {
  if (state.poller) clearTimeout(state.poller);
  if (state.clock) clearTimeout(state.clock);
  state.poller = null;
  state.clock = null;
};

function logout() {
  removeKey(TOKEN_KEY);
  unsubscribeAll();
  stopHoldingsTick();
  clearInterval(fristT);
  fristT = null;
  state.dmCache.clear();

  // Was der oder die Vorige gesehen hat, bleibt nicht stehen.
  //
  // Vorher wurden nur Token, Kanaele und der Zwischenspeicher der Gespraeche
  // geleert - state.polls, die Faeden, das offene Gespraech und der
  // gezeichnete Inhalt blieben. Meldet sich auf demselben Geraet eine zweite
  // Wallet an, zeigt enterApp die Seite, BEVOR die neuen Daten da sind: die
  // neue Person sieht dann fuer einen Moment die Abstimmungen der vorigen,
  // samt deren Haken auf der eigenen Antwort, und im DM-Reiter deren
  // Nachrichten.
  //
  // Die Uhr fuer die Fristen gehoert auch dazu: sie lief nach dem Abmelden
  // weiter, fand alle 30 Sekunden state.polls vor, rief loadPolls und lief
  // dort in einen Fehler, den ein .catch verschluckt - fuer immer.
  state.polls = [];
  state.dmThreads = [];
  state.dmMessages = [];
  state.activeThread = null;
  state.dmMinEntwurf = null;
  state.zeigeVerborgene = false;
  for (const id of ['#poll-list', '#thread-items', '#admin-thread', '#dm-thread']) {
    const kasten = $(id);
    if (kasten) kasten.innerHTML = '';
  }
  const titel = $('#thread-title');
  if (titel) titel.textContent = 'Select a thread';

  state.jwt = null; state.me = null; state.db = null;
  showLogin();
  $('#step-pay').hidden = true;
  $('#step-address').hidden = false;
}
$('#btn-logout').addEventListener('click', logout);

// ---------------------------------------------------------------------------
// App startup
// ---------------------------------------------------------------------------

async function enterApp() {
  state.db = makeClient();

  state.cfg = unwrap(await state.db.from('app_config').select('*').eq('id', 1).single());
  if (!state.me) state.me = await loadMe();

  // Whoever arrives via a shared poll link is headed for a SPECIFIC poll -
  // not just the list.
  const zielPoll = /^#poll-\d+$/.test(location.hash);

  $('#dm-min-unit').textContent = 'in $' + state.cfg.symbol;

  // In the normal case the app becomes visible right away: the page builds
  // itself in front of your eyes, and that's better than a second of
  // black.
  //
  // With a poll link, it's the other way around. There, what would be
  // visible is: empty poll list, then it snaps full. So the app stays
  // hidden until the polls have loaded - see below.
  if (!zielPoll) showApp();
  $('#poll-admin').hidden = !state.me.isAdmin;
  // Clearly visible, so nobody mistakes the preview for real admin rights.
  // The bar says WHY the page isn't currently telling the truth: you're
  // seeing Ansem's UI but have none of his permissions, and every attempt
  // to save gets rejected. Without the sentence, that reads as a bug.
  //
  // In demo mode there's NOTHING there anymore. The bar used to be shown
  // there too, and that was reasonable at the time - but it's only
  // reachable on localhost in the first place, so only whoever typed the
  // URL themselves ever sees it. They know they went to ?demo=. What paid
  // for the reminder instead was every screenshot: a yellow bar across the
  // bottom edge, in every image and every recording.
  //
  // The protection against accidental test data doesn't depend on this
  // bar - it depends on nothing being loaded and nothing being written in
  // demo mode at all, see DEMO_DMS above. The bar only announced that.
  const flagge = $('#preview-flag');
  flagge.hidden = !PREVIEW_ADMIN;
  // Closing it is a click, not a setting: it goes away for this view and is
  // back on the next load. See the note at .preview-flag in styles.css for
  // why it can be closed at all.
  $('#btn-hide-flag')?.addEventListener('click', () => { flagge.hidden = true; });
  renderMe();

  // Pick the tab before loading: otherwise the call at the end would
  // overwrite a tab switch the user already made while loading was in
  // progress. sync/catchUp off: both sections get loaded right after this
  // anyway.
  //
  // Polls has been the starting point since chat was removed - and so it's
  // already the right tab for the poll-link case too. The call stays in
  // place regardless: it sets state.activeTab, and that decides what this
  // browser listens for over realtime.
  selectTab('polls', { sync: false });
  syncRealtime({ catchUp: false });
  startHoldingsTick();

  // allSettled, not all.
  //
  // It used to be that a single failing section aborted the whole startup
  // - and because the caller then shows the login screen, that looked to
  // the user like being kicked out. On a site where a new login costs real
  // money, that's about the worst possible response to a minor failure.
  //
  // Anyone with a valid token now reaches the app in every case. Whatever
  // couldn't load gets reported and stays empty.
  const results = await Promise.allSettled([loadPolls(), loadDms()]);
  const failed = results.map((r) => r.reason).filter(Boolean);
  if (failed.length) {
    for (const err of failed) console.error('[start] section failed to load:', err.message);
    toast(failed[0].message || 'Some parts could not be loaded', true);
  }

  // Only now, after the polls are in the markup: before this, the jump
  // target wouldn't exist yet. If there's no hash in the URL, nothing
  // happens here.
  //
  // ohneRollen, because nobody has seen the list yet at this point: a
  // smooth scroll from the top would be movement with no starting point to
  // move from.
  springeZuPollAusUrl({ ohneRollen: zielPoll });

  // Only now show it - with the right poll already in the picture.
  if (zielPoll) showApp();

  // No await: backfilling preview cards must not hold up startup. It only
  // affects Ansem, and only polls that don't have one yet.
  addMissingCards();
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

/** Raw data from the token - unverified, only for display and time math. */
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
// Holdings tick
// ---------------------------------------------------------------------------

/**
 * Refreshes the $ amount for every visible address once a minute.
 *
 * Two things about this are deliberate:
 *
 * 1. The tick is tied to the clock, not to load time. With a plain
 *    setInterval started after load, the amounts would jump at a different
 *    moment for every visitor - two people sitting next to each other
 *    would see different numbers for a few seconds. Aligned to the top of
 *    the minute, everything changes for everyone at the same instant. The
 *    same holds server-side: a single run per minute applies one price to
 *    all wallets there.
 *
 * 2. It only looks the value up, it doesn't compute it. Whatever arrives
 *    here was written by the database; the browser has no influence over
 *    which amount ends up next to a name.
 */
const TICK_MS = 60_000;
let tickTimer = null;

function startHoldingsTick() {
  stopHoldingsTick();
  // Wait until the next full minute, then tick once a minute.
  const untilFull = TICK_MS - (Date.now() % TICK_MS);
  tickTimer = setTimeout(function tick() {
    refreshLiveHoldings();
    tickTimer = setTimeout(tick, TICK_MS);
  }, untilFull);
}

function stopHoldingsTick() {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
}

/**
 * Refreshes just your own holdings.
 *
 * Before chat was removed, this was a batch lookup for EVERY currently
 * visible address - an amount sat next to every message, and all of them
 * had to refresh on the same tick. What's left of that is exactly one
 * address: your own.
 *
 * The amounts in the inbox don't come from here - they come from the
 * dm_threads view and load together with it. Looking them up again here
 * every minute would create a second source of truth for the same number.
 *
 * Why your own is still refreshed at all: it drives the DM write lock and
 * the amount in the top right. Someone who buys more tokens shouldn't have
 * to reload to unlock writing - there's no refresh button anymore.
 */
async function refreshLiveHoldings() {
  if (!state.db || document.hidden || !state.me?.wallet) return;

  // For Ansem there's nothing to refresh: his number isn't shown anywhere
  // anymore, and he never runs into a threshold - renderDmGate() bails out
  // early for isAdmin. A query every minute for a value nobody reads is
  // exactly the kind of work you only notice once you go looking for it.
  if (state.me.isAdmin) return;

  let line;
  try {
    const { data, error } = await state.db
      .from('wallets').select('usd_value').eq('address', state.me.wallet).maybeSingle();
    if (error || !data) return;
    line = data;
  } catch { return; }

  const meins = Number(line.usd_value);
  if (Number.isFinite(meins) && meins !== Number(state.me.usd)) {
    state.me.usd = meins;
    renderMe();
  }
}

/**
 * Write permission for DMs to Ansem.
 *
 * The inbox is the expensive channel: one specific person reads it,
 * instead of it just drifting past in a stream. Ansem sets the value
 * himself (see below).
 *
 * For him there's nothing to lock here; he sees the inbox view anyway, not
 * this input field.
 */
function renderDmGate() {
  const min = Number(state.cfg.min_dm_usd ?? 0);
  const allowed = state.me.isAdmin || min <= 0 || Number(state.me.usd ?? 0) >= min;

  $('#dm-form').classList.toggle('locked', !allowed);
  // Whoever can't write doesn't need a reply button either.
  $('#dm-user').classList.toggle('no-write', !allowed);
  $('#dm-gate').hidden = allowed;
  if (!allowed) clearDmReply();
  if (!allowed) {
    $('#dm-gate-text').innerHTML = gateText(min, 'to message Ansem');
  }
}

/**
 * The text in the lockout notice.
 *
 * Takes the reason as an argument even though there's only one left since
 * chat was removed. That stays as it is: the separation between "how much"
 * and "for what" is the reason this sentence won't need to be rewritten for
 * the next channel.
 *
 * There used to be a second sentence here: "You hold $102." It's gone, and
 * not just for taste. Anyone who sees this notice at all already has their
 * own holdings shown in the top right of the header - the same number from
 * the same source, a couple of inches above. Saying the same thing twice
 * doesn't make it clearer, it just turns the second spot into one that can
 * eventually drift out of sync with the first.
 *
 * And that sentence was the less friendly half of the notice: "here's how
 * much you need" is information, "here's how little you have" is a
 * judgment. Whatever's missing, everyone works out for themselves anyway.
 */
function gateText(min, was) {
  return `Hold at least <strong>${esc(fmtUsd(min))}</strong> in $${esc(state.cfg.symbol)} ${esc(was)}.`;
}

function renderMe() {
  const holdings = $('#me-holdings');

  // The top right shows two different things:
  //
  //   Ansem         his profile picture. Hover the pointer over it and a
  //                 tooltip next to it says which account he's signed in
  //                 as - there's no address shown for him, and a picture
  //                 doesn't say that on its own.
  //   everyone else their three characters, in their own color - exactly
  //                 as they appear in the DMs and the inbox.
  //
  // For a while this used to show the shortened address (EMwU...QLxP) in
  // the color of the amount next to it, on the argument that the question
  // in the top right isn't "who am I" but "which wallet am I here as".
  //
  // The argument is correct, it just didn't justify the change: the three
  // characters ARE your name on this site - next to every message of
  // yours, in the quote, in the inbox. Showing something different in the
  // top right meant seeing yourself under two names. And the color carries
  // that information along with it: it's computed from the full address,
  // so it's different for every wallet.
  //
  // Both are <span> elements, not buttons. There's nothing to press here:
  // the tooltip comes with the pointer and leaves with it, the stylesheet
  // handles that on its own. For a while there was a <button> here with
  // click listeners, an outside-click handler, and an Escape key - all for
  // a box that shows itself. A button that does nothing on click also
  // reads as broken.
  //
  // The handle stays in the document for Ansem even though the stylesheet
  // hides it: a screen reader needs a name, and a picture isn't one to it.
  // It gets the tooltip via aria-describedby, even though it isn't
  // visible - a box that only the pointer brings up would otherwise not
  // exist for it at all.
  $('#me-handle').outerHTML = state.me.isAdmin
    ? `<span id="me-handle" class="handle h admin-name" aria-describedby="me-info"
        ><span class="kuerzel">${esc(state.me.handle)}</span></span>`
    : `<span id="me-handle" class="handle h t${toneOf(state.me.wallet)}"
        >${esc(state.me.handle)}</span>`;

  // "DM" for everyone else, "DMs" only for Ansem - and that's not
  // cosmetic, it's the truth about the tab: a regular user has exactly ONE
  // conversation, the one with Ansem. There's no list for them to arrive
  // at, just a history. Behind it, Ansem sees an inbox with everyone.
  //
  // A class is toggled, not the text: the "s" is its own element in the
  // markup and just gets made invisible. That keeps its space reserved, so
  // "Polls" next to it doesn't shift.
  //
  // Setting textContent here again would remove the element and bring the
  // shift back - then the tabs would sit 4.5px apart for Ansem versus a
  // regular user.
  $('[data-tab="dms"]').classList.toggle('zeigt-s', Boolean(state.me.isAdmin));

  // Your own holdings sit in the top right - for everyone except Ansem.
  //
  // For them it's the number everything hinges on: it decides whether they
  // can write, and it sits next to every one of their messages. Seeing it
  // up top tells them where they stand.
  //
  // For Ansem it doesn't answer a question. He never runs into a
  // threshold, his holdings don't change anything he can do - and of all
  // places, it would sit above an inbox where every row already carries an
  // amount. Right there, one more number stops being information and
  // becomes something you read along and discard again.
  holdings.hidden = Boolean(state.me.isAdmin);
  if (!state.me.isAdmin) holdings.textContent = fmtUsd(state.me.usd);
  renderDmGate();
}

/* This used to be where the listeners for the tooltip next to Ansem's
 * profile picture lived: one click to open and close it, a second on the
 * document to dismiss it, plus the Escape key.
 *
 * All three are gone. The tooltip appears as long as the pointer sits on
 * the picture and disappears as soon as it moves off - that's a single
 * rule in the stylesheet (see .me-info) and needs no line here.
 */

/* This used to be where the refresh button with its spinning icon lived.
 *
 * It's gone because it did nothing that doesn't already happen anyway:
 *
 *   - The Helius webhook reports every movement of the $ANSEM mint and
 *     re-reads the affected wallets immediately.
 *   - The refresh-holdings cron run is the safety net underneath, even for
 *     price changes with no transfer involved.
 *   - refreshLiveHoldings() pulls the stored value into the open page
 *     every minute, with nobody needing to press anything.
 *
 * What disappeared along with it is worth saying: the button was the only
 * way to trigger an on-chain lookup BY HAND. Someone who just bought more
 * now waits on the webhook or the cron instead of pressing it themselves.
 * As long as both are running, that's a matter of seconds; if both go
 * down, nobody notices anymore, because there's no longer a button that
 * visibly does nothing.
 *
 * The refresh-holdings edge function still exists - it's exactly what the
 * cron calls.
 */


// ---------------------------------------------------------------------------
// Realtime
//
// Supabase bills realtime per recipient: one vote across 1,000 listening
// browsers is 1,000 billed messages. So every browser only listens to what
// it's actually displaying right now:
//
//   * Page in the background (other tab, phone locked) -> nothing at all.
//     supabase-js drops the WebSocket connection as soon as the last
//     channel is gone; that also drops the user out of the concurrent
//     connection count.
//   * The polls channel only while the polls tab is open.
//   * DMs keep listening as long as the page is visible: tiny volume, but
//     the user should see Ansem's reply right away, no matter where they
//     currently are.
//
// On reconnect, the relevant section reloads fresh once, so nothing is
// missed that happened during the gap.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fallback layer
//
// If the live connection doesn't come together - connection quota
// exhausted, an outage at Supabase, a corporate network blocking
// WebSockets - the page must not just go quiet. That's exactly what would
// otherwise happen: logging in, loading history, and writing all go
// through a different path and keep working. Only new messages would never
// arrive, with no indication at all.
//
// So in that case the page polls for itself. A three-second delay is
// barely noticed by anyone; a dead-looking poll is noticed by everyone.
// Polling also doesn't count as a realtime message, so it costs nothing
// extra.
// ---------------------------------------------------------------------------

const FALLBACK_MS = 3000;
// Und wie weit er sich bremst, wenn die Verbindung wegbleibt.
//
// Vorher lief der Notlauf fuer immer alle drei Sekunden weiter - zwei
// Abfragen je Runde, also rund vierzig in der Minute, aus JEDEM offenen
// Fenster. Das ist genau dann der Fall, wenn Realtime ohnehin klemmt: bei
// einer Stoerung, aufgebrauchtem Kontingent, einem Netz, das WebSockets
// blockiert. Dann faellt die Seite also mit der Tuer ins Haus.
//
// Also verdoppelt sich der Abstand bis zu einer Minute. Die erste Minute
// bleibt schnell - eine Stoerung von zehn Sekunden merkt so niemand -, und
// eine, die eine Stunde dauert, kostet danach 60 statt 1200 Abfragen.
const FALLBACK_MAX_MS = 60_000;

function startFallback(name) {
  // Channels we closed ourselves shouldn't be polled.
  if (!state.channels[name] || state.fallback[name]) return;
  // Polls already poll on a tick regardless of whether the connection is
  // up - a second timer next to that would just be a duplicate query, and
  // the "Live updates unavailable" message would be flat-out wrong: votes
  // keep arriving either way. If the connection drops, the only thing
  // delayed is when a NEW poll shows up, and the tick picks that up within
  // 5 seconds too.
  if (name === 'polls') return;
  console.warn(`[realtime] ${name}: no live connection, polling every ${FALLBACK_MS} ms`);
  if (!Object.keys(state.fallback).length) {
    toast('Live updates unavailable - refreshing every few seconds');
  }
  let abstand = FALLBACK_MS;
  const runde = () => {
    CATCH_UP[name]().catch(() => { /* try again next tick */ });
    abstand = Math.min(abstand * 2, FALLBACK_MAX_MS);
    state.fallback[name] = setTimeout(runde, abstand);
  };
  state.fallback[name] = setTimeout(runde, abstand);
}

function stopFallback(name) {
  if (!state.fallback[name]) return;
  clearTimeout(state.fallback[name]);
  delete state.fallback[name];
}

const logStatus = (name) => (status, err) => {
  if (status === 'SUBSCRIBED') {
    console.info(`[realtime] ${name} verbunden`);
    // Back online: reload once to close the gap, then stop polling.
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
 * Coalesce several events in quick succession into one reload. Without
 * this, every single vote would trigger its own query in every open
 * browser - during a live poll that would be a flood of requests.
 */
function reloadSoon(key, fn, delay = 400) {
  clearTimeout(state.reloadTimers[key]);
  // Mit .catch: fn ist loadPolls oder dmsNachziehen, und beide werfen ueber
  // unwrap(), sobald PostgREST einen Fehler meldet. Aus einem Netzhaenger
  // wurde so eine unbehandelte Zusage - hier, wo niemand mehr zuhoert, weil
  // der Aufruf aus einem Zeitgeber kommt.
  state.reloadTimers[key] = setTimeout(() => {
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch((e) => console.warn(`[${key}]`, e.message));
    } catch (e) { console.warn(`[${key}]`, e.message); }
  }, delay);
}

// ---------------------------------------------------------------------------
// Votes aren't pushed, they're polled
//
// There used to be a third line here: `.on(... table: 'votes', refresh)`.
// It meant: Supabase, report EVERY vote cast to EVERY open browser.
//
// Supabase counts those reports individually - one change delivered to 500
// listeners is 500 messages, not one. And because `votes_read` in the
// database is `using (true)`, every listener is authorized, none get
// dropped.
//
// Here's the math: Ansem posts a poll, 500 people are there and vote
// within half a minute. That's roughly 17 votes per second times 500
// browsers - about 8,300 messages per second. The quota, depending on
// plan, is 500 or 2,500. Above that Supabase closes the channels with "Too
// many messages per second", everyone rejoins at once and runs straight
// into the next limit. In precisely the minute the whole thing was built
// for.
//
// But a vote count is a counter, not an event. Nobody needs to know to the
// tenth of a second that a stranger just voted - the bars are shifting
// constantly anyway. So the polls tab polls on its own instead, as long as
// it's open. 8,300 messages per second becomes 500 divided by 5, i.e. 100
// perfectly ordinary queries - which don't count against any realtime
// quota.
//
// What stays live: a NEW or CLOSED poll. That happens a few times a day
// and should feel instant.
//
// Whoever votes themselves waits on nothing: vote() reloads directly.
//
// To match this, public.votes has been removed from the realtime
// publication (migration 20260903040000_votes_nicht_mehr_live.sql).
// Anyone who ever puts the line above back in has to re-add the table
// there too - otherwise nothing arrives, with no error at all.
// ---------------------------------------------------------------------------

const VOTE_CADENCE_MS = 5000;

/**
 * Reload the DMs after a nudge - and not give up on the first failure.
 *
 * This used to be just `await loadDms()`, with no safeguard at all. The
 * difference showed up while watching the console: during a database
 * resize and during a load test, queries failed with `net::ERR_FAILED` -
 * the response never came back at all. If a moment like that landed on
 * exactly the nudge, it was lost silently, and the message only showed up
 * once something else happened to trigger a reload. For a DM Ansem doesn't
 * see because of that, this is more than a cosmetic issue.
 *
 * Three attempts with a growing delay (0.6s / 1.2s) cover exactly the case
 * at hand: a brief hiccup. A longer outage is caught by the fallback layer
 * anyway, which kicks in as soon as the channel itself reports an error.
 *
 * The poll tick doesn't need this - it polls again every 5 seconds
 * regardless. A nudge only arrives once.
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
  // Give up, but don't stay silent: the next tab switch, the next time the
  // page becomes visible, and the next nudge will reload anyway.
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
  // DMs: a nudge on its own channel, not a broadcast to everyone
  //
  // This used to be `.on('postgres_changes', ... table: 'dms')`. With that
  // kind of channel, Supabase checks permissions INDIVIDUALLY, for every
  // listener, on every change - one DM to Ansem with 3,000 open pages is
  // 3,000 permission checks. And that runs single-threaded, so a bigger
  // server doesn't help.
  //
  // Now a database trigger sends a nudge to exactly two channels: the
  // sender's own thread and Ansem's inbox. Two deliveries instead of three
  // thousand checks, and permissions get checked once, on join.
  //
  // The nudge carries NO content - just "something happened in your
  // thread." Reading afterward still goes through the database as always,
  // where public.dms's RLS applies. So even a misconfigured channel would
  // give away nothing except the fact that a message exists.
  //
  // private: true is not optional. Without it, Supabase never checks the
  // access rule at all, and the channel would be open to anyone.
  //
  // Associated migration: 20260904010000_dm_broadcast.sql. Anyone who ever
  // reverts these lines back to postgres_changes has to re-add public.dms
  // to the publication there too - otherwise nothing arrives, silently.
  // -------------------------------------------------------------------------
  dms: () => {
    const nachladen = () => reloadSoon('dms', dmsNachziehen);
    // Ansem listens on one inbox for all threads; a regular user only on
    // their own. Two different channel names, the same handling.
    const thema = state.me.isAdmin ? 'dm:admin' : `dm:${state.me.wallet}`;
    return state.db
      .channel(thema, { config: { private: true } })
      .on('broadcast', { event: 'dm' }, nachladen);
  },
};

/** What this browser should currently be listening to. */
function wantedChannels() {
  if (document.visibilityState === 'hidden') return [];
  const wanted = [];
  // Since the rework, the DM channel is named after your own wallet
  // (dm:<address>), or dm:admin. Without a signed-in user that would be a
  // channel named "dm:undefined" - the access rule would reject it, and
  // the page would report a problem where there isn't one.
  if (state.me?.wallet) wanted.push('dms');
  if (state.activeTab === 'polls') wanted.push('polls');
  return wanted;
}

/** Reload to close the gap that opened up while away. */
const CATCH_UP = { polls: () => loadPolls(), dms: () => loadDms() };

/**
 * The tick on which the open polls tab polls for vote counts.
 *
 * Runs for exactly as long as the 'polls' channel does - so only while the
 * tab is actually open and the page is visible. A backgrounded browser
 * polls nothing.
 */
function cadenceOn() {
  if (state.stimmenTakt) return;
  state.stimmenTakt = setInterval(() => {
    loadPolls().catch((e) => console.warn('[poll] tick:', e.message));
  }, VOTE_CADENCE_MS);
}

function cadenceOff() {
  clearInterval(state.stimmenTakt);
  state.stimmenTakt = null;
}

/**
 * Brings the open channels in line with the desired state. Safe to call as
 * often as needed - whatever's already running is left untouched.
 */
function syncRealtime({ catchUp = true } = {}) {
  if (!state.db) return;
  const wanted = new Set(wantedChannels());

  for (const [name, channel] of Object.entries(state.channels)) {
    if (wanted.has(name)) continue;
    // Deregister first, then close: otherwise supabase-js reports the
    // close while the channel still counts as wanted, and the fallback
    // layer would kick in for something we shut down ourselves.
    delete state.channels[name];
    stopFallback(name);
    if (name === 'polls') cadenceOff();
    state.db.removeChannel(channel);
  }

  for (const name of wanted) {
    if (state.channels[name]) continue;
    state.channels[name] = CHANNELS[name]().subscribe(logStatus(name));
    if (name === 'polls') cadenceOn();
    if (catchUp) CATCH_UP[name]().catch(() => { /* next attempt on the next switch */ });
  }
}

function unsubscribeAll() {
  cadenceOff();
  for (const name of Object.keys(state.fallback)) stopFallback(name);
  for (const channel of Object.values(state.channels)) state.db?.removeChannel(channel);
  state.channels = {};
  for (const t of Object.values(state.reloadTimers)) clearTimeout(t);
  state.reloadTimers = {};
}

document.addEventListener('visibilitychange', () => {
  syncRealtime();
  // A backgrounded tab polls nothing. On return, refresh once immediately
  // instead of showing stale amounts until the next full minute.
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
  // The tab switch also decides what this browser listens to.
  if (sync) syncRealtime();
}
const scrollBottom = (el) => { el.scrollTop = el.scrollHeight; };

// ---------------------------------------------------------------------------
// Numeric fields
//
// This used to also hold chat's amount filter, up until chat was removed.
// The three helpers below stayed, because they never had anything to do
// with chat: they belong to an input field where a sum of money gets
// typed. One of those still exists - Ansem's threshold for DMs.
// ---------------------------------------------------------------------------

/**
 * Restricts a field to a number only.
 *
 * The field is deliberately type="text": a number field brings up the tiny
 * up/down arrows in every browser, and those aren't hittable on a phone.
 * The price for that is that the browser no longer validates input either.
 * That's why it happens here instead.
 *
 * Digits and a single period as the decimal separator are allowed. Commas
 * are dropped: in this field they're the thousands separator and are added
 * by the display itself, see gruppiere().
 *
 * Before the period, it stops at MAX_STELLEN. Further digits simply don't
 * appear - the same behavior a maxlength field would have. Except
 * maxlength can't be used here: the browser counts characters, and this
 * file adds the separators itself. A limit of 13 would be correct while
 * typing and wrong on paste, because pasted text doesn't have the commas
 * yet.
 *
 * Decimal places aren't counted. They don't make the number bigger, and
 * it's saved rounded to two anyway.
 */
const MAX_STELLEN = 10;

function cleanNumber(text) {
  let out = '';
  let separator = false;
  let stellen = 0;
  for (const c of String(text)) {
    if (c >= '0' && c <= '9') {
      if (separator) { out += c; continue; }
      if (stellen >= MAX_STELLEN) continue;
      stellen += 1;
      out += c;
      continue;
    }
    if (c === '.' && !separator) { out += '.'; separator = true; }
  }
  return out;
}

/**
 * Adds thousands separators.
 *
 * Starting at what size? Four digits, i.e. from 1,000 up - and not out of
 * taste: that's exactly where the amount in the inbox switches too. A row
 * shows "$1,325", and someone who types "1325" into the threshold field
 * should see the same number, not have to guess whether they typed one
 * extra zero. Grouping from five digits up would be typographically
 * defensible, but inconsistent with that.
 *
 * A comma, not a period, even though that looks unfamiliar to a German
 * keyboard: the site is entirely in English, and "$1.325" reads like an
 * amount with decimal places - wrong by exactly a factor of a thousand.
 * The same reasoning already appears at nfFull further up.
 *
 * Only the part before the period gets grouped. Decimal places get no
 * separators, or 0.12345 would turn into "0.123,45".
 */
function gruppiere(roh) {
  const text = String(roh);
  if (text === '') return '';
  const dot = text.indexOf('.');
  const ganz = dot === -1 ? text : text.slice(0, dot);
  const rest = dot === -1 ? '' : text.slice(dot);
  return ganz.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
}

/**
 * Attaches validation and grouping to a field.
 *
 * Tracking the caret is necessary: if you just replace the field content,
 * the browser moves the caret to the end. Someone typing in the middle of
 * a number would then end up behind the last digit instead of where they
 * were.
 *
 * Only digits and the period are counted here, not the separators: those
 * shift constantly while typing - one more digit turns "999" into "9,999",
 * and everything after it moves over by one position. The caret belongs
 * behind the same digit as before, not at the same character offset.
 */
function onlyNumbers(input) {
  input.addEventListener('input', () => {
    const vorher = input.value;
    const pos = input.selectionStart ?? vorher.length;
    const charBefore = cleanNumber(vorher.slice(0, pos)).length;

    const nachher = gruppiere(cleanNumber(vorher));
    if (nachher === vorher) return;
    input.value = nachher;

    let i = 0;
    let counted = 0;
    while (i < nachher.length && counted < charBefore) {
      if (nachher[i] !== ',') counted++;
      i++;
    }
    try { input.setSelectionRange(i, i); } catch { /* not possible everywhere */ }
  });
}

onlyNumbers($('#dm-min-input'));

/**
 * The mark on the right of the inbox: shows up while scrolling, says where
 * you are, and goes away again.
 *
 * It isn't the browser's own scrollbar, it's a separate little box - why
 * is explained in styles.css at #thread-strich. The core of it: the
 * browser's scrollbar is always as long as the visible share of the
 * whole. With three conversations it fills almost the entire track. This
 * mark instead is ALWAYS the same small size and says exactly one thing:
 * where you are.
 *
 * It's only computed while scrolling, and that's enough: the mark is only
 * ever visible then anyway. If the list grows or the window height
 * changes while it's invisible, it's correct again on its own the next
 * time you scroll - so no observer is needed to keep re-measuring in the
 * meantime.
 *
 * 700ms isn't a measured value, it's the span within which one gesture of
 * the hand still counts as one: someone dragging with their finger
 * shouldn't lose the mark partway through.
 */
const STRICH_BLEIBT = 700;
/**
 * How long the mark is.
 *
 * The base rule is the share of the visible against the whole - the same
 * thing a scrollbar does anyway: a long list gets a short mark, a short
 * list a long one. That's the information a fixed size can't give.
 *
 * Except at the edges. Without a ceiling, the mark would fill almost the
 * whole track with eight conversations and stop being a mark at all,
 * becoming a stripe instead; without a floor it would shrink to a dot on
 * very long lists, one you'd lose track of while scrolling.
 */
const STRICH_MAX = 64;
const STRICH_MIN = 24;
{
  const liste = $('#thread-items');
  const strich = $('#thread-strich');
  let weg;

  const assign = () => {
    const rollweg = liste.scrollHeight - liste.clientHeight;
    // Nothing to scroll: then there's also no position to be at.
    if (rollweg <= 0) { liste.classList.remove('rollt'); return; }

    const anteil = liste.clientHeight / liste.scrollHeight;
    // Keep reusing our own computed value instead of reading offsetHeight
    // back: the browser doesn't recompute layout until the next frame, and
    // the position depends on exactly this height.
    const hoch = Math.round(
      Math.min(STRICH_MAX, Math.max(STRICH_MIN, liste.clientHeight * anteil)));
    strich.style.height = `${hoch}px`;

    const wo = Math.min(1, Math.max(0, liste.scrollTop / rollweg));
    strich.style.top = `${Math.round(wo * (liste.clientHeight - hoch))}px`;
    liste.classList.add('rollt');
  };

  liste.addEventListener('scroll', () => {
    assign();
    clearTimeout(weg);
    weg = setTimeout(() => liste.classList.remove('rollt'), STRICH_BLEIBT);
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

/**
 * Three made-up polls for demo mode.
 *
 * Deliberately with very different sums: 2.4M, 184K, 912 dollars. That's
 * exactly what decides whether the numbers in the row still fit side by
 * side and whether shortUsd() rounds sensibly - with three polls of the
 * same order of magnitude, every version looks fine.
 *
 * And three different states, because they look different: one with a
 * deadline (the row turns gold under an hour left), one without, one
 * closed.
 *
 * The shape is exactly what loadPolls() otherwise builds from the
 * database - otherwise this would be testing a UI that doesn't actually
 * exist like this.
 */
function demoPolls() {
  const inStunden = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const construct = (id, question, closesAt, closed, paare) => {
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
    construct(9003, 'Where should I stream next?', inStunden(3), false, [
      ['Twitch', 1_640_000], ['X', 620_000], ['Both, alternating', 148_000],
    ]),
    construct(9002, 'Should we do a weekly AMA?', null, false, [
      ['Yes, every Friday', 121_000], ['No, keep it spontaneous', 63_000],
    ]),
    construct(9001, 'Change the ticker?', inStunden(-26), true, [
      ['Keep $ANSEM', 640], ['Something shorter', 180],
      ['Put it to a second vote', 62], ['No opinion', 30],
    ]),
  ];
}

async function loadPolls() {
  // Nothing is loaded in demo mode - see DEMO_DMS way up top.
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
        // Only for the bar width, never shown as a number.
        share: totalUsd > 0 ? totals[i] / totalUsd : 0,
      })),
    };
  });
  renderPolls();
}

/**
 * How much time a poll has left, as text.
 *
 * It's ROUNDED DOWN, and that's a decision, not a convenience. At 2 hours
 * 59 minutes this reads "2h". Whoever reads that believes they have less
 * time than they actually do - and is wrong in the harmless direction.
 * Rounded up it would say "3h", and someone would show up five minutes
 * late because the page promised them time that wasn't there.
 *
 * Two units, never three: "2d 4h" says everything you need for a
 * decision. Nobody reads "2d 4h 17m" all the way through, and the minutes
 * are meaningless anyway with two days left.
 *
 * No number at all under a minute: a count of seconds in a list that
 * refreshes every 30 seconds would be wrong most of the time.
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
// The row turns gold under an hour left. An hour, not five minutes: the
// threshold is meant to land on the point where voting still changes
// something. Setting it at five minutes would color the row exactly at the
// moment it stops being useful to anyone.
const BALD_MS = 60 * 60 * 1000;
const deadlineLine = (p) =>
  `<span class="frist-rest${new Date(p.closesAt) - Date.now() < BALD_MS ? ' is-bald' : ''}"`
  + `>· ${esc(fristText(p.closesAt))}</span>`;

/**
 * The ticker that keeps the remaining time up to date.
 *
 * It only rewrites the text node, instead of rebuilding the list. An
 * innerHTML every 30 seconds would reset the bar animation, knock the
 * mouse pointer off the answer it's currently sitting on, and lose the
 * scroll position - for a number that changed by one minute.
 *
 * It only reloads in the one case where something else genuinely changes:
 * when a poll has just closed. Then it actually has to be rebuilt, because
 * its answers are locked from now on. Without that it would stay
 * clickable, and the click would come back as a red error from the
 * database - the rule is correctly enforced there, but the user would see
 * what looks like a bug where a deadline had simply passed.
 *
 * 30 seconds, not 60: with a one-minute tick, the previous minute would
 * stay on screen for a full minute.
 */
let fristT = null;
function deadlineCadence() {
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
 * How to recognize a button in the list again once it's been rebuilt.
 *
 * The nodes themselves are different afterward; the combination of class
 * and poll number stays the same. This is needed to preserve keyboard
 * focus: list.innerHTML throws it onto <body>, and whoever just tabbed
 * their way to the delete button ends up pressing Enter into nothing. This
 * is the same "sometimes it doesn't work" - just for keyboard users.
 */
const buttonTrait = (el) => {
  if (!el || !el.dataset) return null;
  for (const [klasse, rolle] of Object.entries(BUTTON_ROLES)) {
    if (el.classList.contains(klasse)) return `.${klasse}[data-${rolle.field}="${el.dataset[rolle.field]}"]`;
  }
  // Die Antwortzeilen gehoeren auch dazu.
  //
  // Sie stehen nicht in BUTTON_ROLES - dort geht es um Knoepfe mit zwei
  // Zustaenden -, sind aber mit tabindex="0" und role="button" genauso mit
  // der Tastatur erreichbar. Und sie sind das WICHTIGSTE Ziel in der Liste:
  // hier wird abgestimmt. Ohne diese Zeile verlor jeder, der sich zu einer
  // Antwort getabbt hatte, den Fokus beim naechsten Neuaufbau - und der
  // kommt bei jeder fremden Stimme, im Notlauf alle paar Sekunden. Man
  // drueckt dann Enter ins Leere.
  if (el.classList.contains('opt') && el.dataset.poll && el.dataset.option) {
    return `.opt[data-poll="${el.dataset.poll}"][data-option="${el.dataset.option}"]`;
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
  // Remember what has focus before the rebuild - but only if it's in this
  // list. If it's in a field of the create box, the rebuild never touched
  // it, and it definitely shouldn't be moved.
  const fokusWar = list.contains(document.activeElement)
    ? buttonTrait(document.activeElement) : null;

  list.innerHTML = state.polls.map(pollHtml).join('');
  // In the same pass as the rebuild: between these two lines, no frame can
  // reach the screen where an armed delete button looks harmless again -
  // and no click can slip in between.
  paintButtons(list);
  if (fokusWar) $(fokusWar, list)?.focus({ preventScroll: true });

  $$('.opt', list).forEach((el) => {
    const castVote = () => {
      if (!el.classList.contains('locked')) {
        vote(Number(el.dataset.poll), Number(el.dataset.option));
      }
    };
    el.addEventListener('click', castVote);
    // Enter and space - that's what a button does, and role="button"
    // promises exactly that. An element that presents itself as a button
    // and then listens to no key at all is worse than an honest div.
    //
    // preventDefault on space, or the page underneath would scroll while
    // the vote is being cast.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      castVote();
    });
  });
  $$('.btn-close-poll', list).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await state.db.from('polls').update({ closed: true }).eq('id', b.dataset.poll);
    if (error) toast(error.message, true); else loadPolls();
  }));
  $$('.poll-share', list).forEach((b) =>
    b.addEventListener('click', () => sharePoll(b.dataset.share)));
  $$('.poll-image', list).forEach((b) =>
    b.addEventListener('click', () => ladePollBild(b.dataset.image)));
  $$('.poll-delete', list).forEach((b) =>
    b.addEventListener('click', () => deletePoll(b.dataset.delete)));
  deadlineCadence();
}

/* A chain link, not a share arrow. The arrow promises the device's system
   share menu - but that only exists on a phone. On desktop the link ends
   up in the clipboard, and the chain link is the more honest icon for
   that. */
const LINK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>
  </svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 12.5l5 5 10-11"/>
  </svg>`;

/* The checkmark on the answer you voted for yourself - a circle with a
   check inside it, like on X.

   There used to be a bare checkmark character after the text. That
   character came from the font, looked different on every device, and sat
   in the sentence as a letter - bold and round on a Mac, thin and angular
   on Windows. As an SVG it's the same image everywhere and takes its color
   from the text above it.

   The circle isn't decoration: a bare checkmark means "done" everywhere
   else on the site (link copied, delete confirmed). The circle turns this
   one into a marker on a thing instead of feedback on an action. */
const VOTE_SVG = `<svg class="opt-haken" viewBox="0 0 24 24" width="15" height="15"
    aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M8.2 12.3l2.7 2.7 4.9-5.5"/>
  </svg>`;

const DOWNLOAD_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3.5v11"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/>
    <path d="M4.5 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>
  </svg>`;

/* A trash can, not an X. The X means "close" in too many other places, and
   a poll can also be closed - that's a different button with a different
   consequence. */
const TRASH_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 6.5h16"/><path d="M9.5 6.5V4.5h5v2"/>
    <path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>
    <path d="M10.5 10v6"/><path d="M13.5 10v6"/>
  </svg>`;

// ---------------------------------------------------------------------------
// The transient state of a poll's three buttons
// ---------------------------------------------------------------------------
//
// All three show a checkmark for a while: the delete button until the
// second tap arrives, link and image as a receipt. This state used to
// live ON THE BUTTON itself - as btn._scharf and btn._t on the DOM node.
//
// That's exactly where the bug Ansem saw came from:
//
//   renderPolls() completely rebuilds the list with list.innerHTML. Every
//   button in it is afterward a DIFFERENT node - without _scharf, showing
//   a trash can instead of the checkmark. The old node isn't attached
//   anywhere anymore and its timer fires into nothing.
//
//   A rebuild happens on every vote from anyone: realtime reports the
//   change to votes, reloadSoon waits 400ms and reloads. But one to two
//   seconds pass between "trash can tapped" and "checkmark tapped".
//
//   So: Ansem taps the trash can, someone votes, the checkmark jumps back
//   to a trash can - and his second tap just arms it again instead of
//   deleting. Nothing happens, and it works the next time. "Sometimes."
//
// That's why the state now lives HERE, not on the node: keyed by an
// identifier that survives a list rebuild. After every rebuild, the
// buttons get repainted into their state - in the same pass that builds
// the list, so no frame in between ever shows the checkmark missing.
//
// Why not just pause reloading while armed: then the numbers would sit
// frozen for five seconds, every single time something is deleted. The
// rebuild isn't the problem - state riding along on something that's
// supposed to survive the rebuild is the problem.
const BUTTON_ROLES = {
  'poll-delete': {
    field: 'delete', duration: 5000, ruhe: () => TRASH_SVG,
    ruheTitel: 'Delete this poll', aktivTitel: 'Tap again to delete',
  },
  'poll-share': { field: 'share', duration: 1800, ruhe: () => LINK_SVG, klasse: 'is-copied' },
  'poll-image': { field: 'image', duration: 1800, ruhe: () => DOWNLOAD_SVG, klasse: 'is-copied' },
};

/** Identifier -> timer that turns it back off. */
const buttonActive = new Map();

/**
 * Identifiers of things currently in progress: the delete itself, building
 * the image.
 *
 * This too used to live on the node - as btn.disabled, set before the wait
 * and cleared afterward. If the list gets rebuilt in the meantime, the new
 * button is enabled again, and a second click triggers the same thing a
 * second time.
 */
const buttonRunning = new Set();

/**
 * Paints the buttons to match their state.
 *
 * The knopf-aktiv class on the node is the memory for "this is what it
 * currently looks like". If it already matches the state, the display is
 * left untouched - otherwise every call would rewrite innerHTML even when
 * the right thing is already there. A freshly built button never has the
 * class, so an armed one turns back into a checkmark on its own.
 *
 * The default target is the whole document, not #poll-list. renderPolls
 * explicitly passes in its freshly built list; every other caller just
 * means "paint whatever's there" - and must not depend on which container
 * the buttons currently happen to be in.
 */
function paintButtons(wurzel = document) {
  if (!wurzel) return;
  for (const [klasse, rolle] of Object.entries(BUTTON_ROLES)) {
    for (const btn of $$(`.${klasse}`, wurzel)) {
      const kennung = `${klasse}:${btn.dataset[rolle.field]}`;
      btn.disabled = buttonRunning.has(kennung);
      const aktiv = buttonActive.has(kennung);
      if (btn.classList.contains('knopf-aktiv') === aktiv) continue;
      btn.classList.toggle('knopf-aktiv', aktiv);
      btn.innerHTML = aktiv ? CHECK_SVG : rolle.ruhe();
      if (rolle.klasse) btn.classList.toggle(rolle.klasse, aktiv);
      const titel = aktiv ? rolle.aktivTitel : rolle.ruheTitel;
      // Only where one exists: link and image show their receipt through
      // the tooltip, not through label text that would shift alongside.
      if (titel) { btn.title = titel; btn.setAttribute('aria-label', titel); }
    }
  }
}

const buttonIsOn = (klasse, id) => buttonActive.has(`${klasse}:${id}`);

function buttonOff(klasse, id) {
  clearTimeout(buttonActive.get(`${klasse}:${id}`));
  buttonActive.delete(`${klasse}:${id}`);
  paintButtons();
}

function buttonOn(klasse, id) {
  clearTimeout(buttonActive.get(`${klasse}:${id}`));
  buttonActive.set(`${klasse}:${id}`,
    setTimeout(() => buttonOff(klasse, id), BUTTON_ROLES[klasse].duration));
  paintButtons();
}

/** Locks a button while its action is in progress. Returns false if it's
 *  already in progress - then the click is a second one and is dropped. */
function buttonClaim(klasse, id) {
  const kennung = `${klasse}:${id}`;
  if (buttonRunning.has(kennung)) return false;
  buttonRunning.add(kennung);
  paintButtons();
  return true;
}

function buttonRelease(klasse, id) {
  buttonRunning.delete(`${klasse}:${id}`);
  paintButtons();
}

/**
 * The address of a single poll.
 *
 * As a path, /p/12, not a hash.
 *
 * The reason is X. Everything after the # is never sent to a server -
 * that's not a setting, it's the definition of a fragment. So for the
 * crawler that builds the preview card, every poll would look identical,
 * because they'd all have the same address. With the number in the path,
 * it can tell them apart, and /p/12 redirects to a small page that hands
 * it the question, the numbers, and an image (supabase/functions/og).
 *
 * Whoever opens the link in a browser gets forwarded from there straight
 * to /#poll-12 - so the old form still works, it just doesn't appear in
 * shared left anymore.
 *
 * search is deliberately left off - that's where parameters live that are
 * none of the recipient's business.
 */
const pollLink = (id) => `${location.origin}/p/${id}`;

/**
 * Share a link.
 *
 * On a phone the system menu, otherwise the clipboard. What matters is
 * what happens on failure: copyText() already tries two paths, and if both
 * fail, the URL shows up in the toast - so it can at least be read off.
 * Here, a button that does nothing and says nothing is the worst outcome,
 * because people assume it's broken and keep pressing it.
 */
async function sharePoll(id) {
  const url = pollLink(id);
  const pollQuestion = state.polls.find((p) => p.id === Number(id))?.question ?? 'Poll';

  // Copy, not share.
  //
  // There used to be a call to navigator.share here: on a phone that
  // popped up the system menu with WhatsApp, Mail, and the rest. That's an
  // extra step for something people mostly just want in the clipboard
  // anyway - and the button carries a chain-link icon, not a share icon.
  // So it already promises a link, not a menu.
  //
  // pollQuestion isn't needed anymore since then; it only appeared in the menu's
  // title.
  void pollQuestion;

  if (await copyText(url)) {
    buttonOn('poll-share', id);
    toast('Link copied');
    return;
  }
  toast(url, true);
}

/**
 * Open a shared link.
 *
 * On the first visit the recipient is almost never signed in yet - they
 * see the login. The hash stays in the URL the whole time, so the jump
 * kicks in on its own after signing in. That's also why it's never removed
 * afterward: reloading the page should land on the same poll again.
 */
function springeZuPollAusUrl({ ohneRollen = false } = {}) {
  const treffer = /^#poll-(\d+)$/.exec(location.hash);
  if (!treffer) return;
  const id = Number(treffer[1]);

  selectTab('polls');
  const el = document.getElementById(`poll-${id}`);
  if (!el) {
    // Only the last 50 get loaded. An older or deleted poll is simply
    // missing - that needs to be said, or the link looks broken.
    toast('That poll is not in the list anymore', true);
    return;
  }
  el.scrollIntoView({ block: 'center', behavior: ohneRollen ? 'auto' : 'smooth' });
  // Restart it in case the same poll gets opened twice in a row: without
  // removing the class first, the animation won't play a second time.
  el.classList.remove('is-linked');
  void el.offsetWidth;
  el.classList.add('is-linked');
}

window.addEventListener('hashchange', () => {
  if (!$('#app').hidden) springeZuPollAusUrl();
});

// ---------------------------------------------------------------------------
// A poll's image
//
// Drawn, not photographed. A screenshot of the card would have meant
// pulling in a third-party library (html2canvas and friends), and it would
// have captured whatever happened to be on screen at that moment: the
// pointer sitting on a bar, your own checkmark, the edge of a card cut off
// by the viewport, the width of whichever phone.
//
// Instead, a separate image at a fixed size is built here. "Clean"
// concretely means: no buttons, no vote checkmark of your own, no traces
// of interacting with it - just the question, the answers, and the
// numbers.
//
// Colors are read from the stylesheet instead of being written down again
// here. Otherwise the image would silently drift away from the site on the
// next color change - and that has already happened once in this
// project's history, when green was hardcoded in six different places.
// ---------------------------------------------------------------------------

const cssWert = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* When a shared image was taken: "08 SEP 2026 · 15:26 UTC".

   Built by hand rather than through Intl, and that is the unusual choice, so
   the reasons: the parts have to line up in a monospace column, the month
   has to be three letters in capitals in every locale (Intl gives "Sept."
   here and "Sep" there, and in German "Sep" with a full stop), and the whole
   string has to be identical for everyone who looks at the same picture.
   Intl formats for the READER; a timestamp burned into an image is not read
   by the person who made it.

   UTC for the same reason. The file gets posted, and the zone it was made in
   is nobody else's zone. */
const MONATE_KURZ = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const zeitstempel = (d = new Date()) => {
  const zwei = (x) => String(x).padStart(2, '0');
  return `${zwei(d.getUTCDate())} ${MONATE_KURZ[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    + ` · ${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())} UTC`;
};


/* roundRect only exists from Safari 16.4 onward. Someone with an older
   iPhone should get an image with square-cornered bars, not a broken one. */
function roundedRect(ctx, x, y, w, h, r) {
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
 * Wraps text into lines that fit within maxW. Returns the lines.
 *
 * Wrapping happens at spaces - and, IF IT HAS TO, in the middle of a word.
 *
 * That second part was missing, and it was a real bug with a visible
 * result: this used to be `|| !line`, meaning "a word too wide on its own
 * still goes entirely on its own line." That line ended up too long, and
 * whatever came after it got cut off by truncate() at draw time.
 *
 * With ordinary sentences this never shows up. It became visible on a
 * question with not a single space in it - "abshridmajabshridmaj..." for
 * over 100 characters. To this function that was ONE word, so ONE line,
 * so two-thirds of the text gone, even though the card has three lines for
 * this and the shrink-to-fit was standing by: both only kick in from the
 * fourth line on, and there was only one.
 *
 * This is the kind of bug a limit in the form doesn't catch - 100
 * characters were allowed and still didn't show up. And the random test
 * sentences used to check that limit all happened to contain spaces.
 */
function umbrechen(ctx, text, maxW) {
  const worte = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const wort of worte) {
    const versuch = line ? `${line} ${wort}` : wort;
    if (ctx.measureText(versuch).width <= maxW) {
      line = versuch;
      continue;
    }
    if (line) { lines.push(line); line = ''; }
    // If the word doesn't fit even on its own, it gets broken up -
    // character by character, as far as it goes each time.
    let rest = wort;
    while (ctx.measureText(rest).width > maxW) {
      let n = rest.length;
      while (n > 1 && ctx.measureText(rest.slice(0, n)).width > maxW) n -= 1;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** A single word too wide on its own gets hard-truncated. */
function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

/**
 * Draws the poll and returns the canvas.
 *
 * The image IS the card - there's no background around it. Outside the
 * rounded corners the canvas stays transparent, so the PNG carries an
 * alpha channel.
 *
 * The size targets 16:9 as a fixed base. The reason isn't aesthetics: X
 * shows a single image in the timeline at full size up to 16:9, and crops
 * anything taller at the top and bottom. But squeezing a poll with ten
 * answers into a 16:9 frame would mean setting the text at an unreadably
 * small size - so the image is allowed to grow, but only up to 4:5. That's
 * the tallest ratio X still shows uncropped.
 */
const IMAGE_WIDTH = 1600;   // points; the canvas is twice as large
const BILD_SKALA = 2;
/* The corners in the image, the same three names the stylesheet carries -
   see the block at --radius in styles.css. Zero: the card is right-angled
   like the page. The logo mark keeps its rounding, because it is a mark and
   not a box. */
/* Every weight drawPoll() sets on the canvas. Kept next to the corner
   constants because it belongs to the same thing: what the image is made of.
   If a font line in drawPoll ever asks for a weight that is not in here, the
   card is drawn in the fallback for that one line and nothing says so -
   scripts/test-schrift.mjs compares the two lists for exactly that reason. */
const KARTEN_SCHNITTE = ['400', '500', '600', '700'];
const BILD_ECKE = 0;
const BALKEN_ECKE = 0;   /* an answer bar */
const SCHILD_ECKE = 0;   /* the CLOSED tag */

/**
 * The version of the card image. BUMP THIS when the look changes.
 *
 * The reason: the card is written exactly once, when the poll is created,
 * and never overwritten - that's deliberate, so a shared link always shows
 * the same invite. The price was that a change to the look never reaches
 * existing polls: they keep their old card, forever.
 *
 * The number sits in the filename. Bump it, and the next time Ansem
 * starts the app, addMissingCards() looks for poll-<id>-v<new>.png,
 * finds nothing, and redraws everything. No manual cleanup, nothing left
 * behind by accident.
 *
 * WARNING: the same number appears in supabase/functions/og/index.ts. Both
 * have to match, or the card points at a file that doesn't exist, and the
 * link gets the fallback card instead.
 */
const CARD_VERSION = 13;

/** The card image's filename in storage - defined in one place, not three. */
const cardFile = (id) => `poll-${id}-v${CARD_VERSION}.png`;

/**
 * The share of the leading answer - or null if none gets highlighted.
 *
 * Highlighting only happens once the poll is CLOSED. While it's running,
 * the bar lengths already show where things stand; a blue fill on top of
 * that would turn it into an announcement. And an announcement about a
 * mid-poll standing is an invitation: someone arriving undecided who sees
 * that one answer is "the" answer is more likely to vote for it. The
 * ranking can flip up to the last minute - especially in this poll, since
 * a single large holder can flip it.
 *
 * Once closed, the blue is exactly right, though: at that point it's no
 * longer a hint, it's the result.
 *
 * ONE place for both representations - the list in the app and the image
 * that goes out into the world. If they drifted apart, a shared image
 * would show a winner the page next to it doesn't recognize - and nobody
 * would notice, because each one looks correct on its own.
 *
 * On a tie, both carry the highlight, and with zero votes, neither does:
 * without totalUsd, the largest share would be 0, and every answer would
 * have that.
 */
const leadingShare = (p) =>
  (p.closed && p.totalUsd > 0) ? Math.max(...p.options.map((o) => o.share), 0) : null;

async function drawPoll(p, { fuerKarte = false } = {}) {
  // The card is drawn at 1x resolution, the downloadable image at 2x.
  //
  // The reason is file size, and here that's not a minor concern: the
  // faint glow in the background is a gradient, and PNG rasterizes
  // gradients with noise that quadruples at double resolution. The same
  // image weighs 1.5MB at 3200px and 136KB at 1600px - eleven times less,
  // with no visible difference. X displays a timeline tile at roughly
  // 600px wide anyway; 1600 is already two and a half times that.
  // Without this wait, the first call measures against the fallback font
  // and the text ends up too wide or too narrow in the image afterward.
  //
  // ready alone is NOT enough since the page ships its own font. It resolves
  // when every font the browser has already started loading has settled - and
  // a weight nothing on the page happens to be showing was never started.
  // The 600 cut is exactly that case: it is used here for the CLOSED tag and
  // almost nowhere else, so on a page without a closed poll it would still be
  // unloaded when this runs. A canvas does not trigger a font load either; it
  // silently draws the fallback. So every cut the card uses is requested
  // explicitly first, THEN we wait.
  //
  // A canvas does not care about the size in the load() call - the weight is
  // what selects the file - so one size for all of them is enough.
  try {
    const familie = getComputedStyle(document.documentElement)
      .getPropertyValue('--mono').trim() || 'monospace';
    await Promise.all(KARTEN_SCHNITTE.map((g) =>
      document.fonts.load(`${g} 40px ${familie}`)));
    await document.fonts?.ready;
  } catch { /* proceed unwaited then */ }

  const S = fuerKarte ? 1 : BILD_SKALA;
  const B = IMAGE_WIDTH;
  // The card sits inset from the page's background color. Without this
  // margin, the rounding would sit exactly on the image edge and be
  // invisible - a rounded rectangle only reads as one once something else
  // sits next to it.
  // Same margin all the way around. That's why the free space for X's
  // title box sits INSIDE the card, not below it - see innerBottom.
  const m = 34;
  const margin = m + 52;
  const content = B - margin * 2;

  // A font that matches the site. The card used to be the only surface
  // still in the grotesque - the one that goes out into the world, of all
  // things.
  //
  // The sizes stay unchanged, and that's a deliberate decision against the
  // obvious "mono runs wider, so set it smaller." Measured, the rule of
  // thumb doesn't actually hold reliably: at a light 12.9px, mono here was
  // 19% wider than the grotesque; at a bold 54px they came out the same
  // width, and a short answer like "Bonk" was even narrower in mono. The
  // numbers depend on the fonts actually installed, and those are
  // different on a Mac than on the machine they were measured on.
  //
  // And the rule isn't needed anyway: umbrechen() and truncate() both
  // measure at runtime against whichever font is actually loaded. So the
  // wrapping settles itself correctly no matter which mono the browser
  // hands over. A compensation number hardcoded here would be a guess, and
  // it would be wrong on half the devices.
  const mono = cssWert('--mono') || 'monospace';
  // Read once, drawn once, handed to the dialog once - see leinwand.stempel.
  const stempelText = zeitstempel();
  const color = {
    grund: cssWert('--bg') || '#f5f2ec',
    card: cssWert('--bg-1') || '#fbfaf7',
    balken: cssWert('--bg-3') || '#e8e4da',
    linie: cssWert('--line') || '#e0dbd0',
    text: cssWert('--text') || '#16150f',
    dim: cssWert('--dim') || '#6b6558',
    dimmer: cssWert('--dimmer') || '#8b8474',
    akzent: cssWert('--accent') || '#1f4e7a',
    // --accent-rgb used to be here, back when the fill was translucent
    // white. It's opaque now, and the value wasn't needed anywhere else.
    // The bar fill, measured off X. Why two values instead of one with an
    // opacity: see --fuellung in the stylesheet.
    fuellung: cssWert('--fuellung') || '#ded8c8',
    fuellungSpitze: cssWert('--fuellung-spitze') || '#ccdcef',
    // The mark has its own name since it stopped being the accent. Without
    // this line the card kept drawing the logo in --accent and the shared
    // image quietly disagreed with the site it came from.
    marke: cssWert('--marke') || '#24598c',
  };

  // Compute before drawing: the height isn't settled until it's clear how
  // many lines the question runs to.
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = `700 54px ${mono}`;
  // The question gets three lines. If it doesn't fit, the font shrinks
  // until it does - and only after that, once nothing else helps, does it
  // get truncated.
  //
  // This used to be just .slice(0, 3), and that was the nastiest kind of
  // bug: the fourth line disappeared SILENTLY. The form showed the full
  // question, the posted image cut off mid-sentence, and Ansem would only
  // have found out once it was already out there.
  //
  // The form now caps input at MAX_QUESTION characters, and measured, that
  // fits in three lines - but "measured" here means "not one out of 4,000
  // random test sentences per length came out too long," not
  // "impossible." Wrapping doesn't depend on character count, it depends
  // on word boundaries: one single long word at the end of a line leaves
  // half a line empty. A limit that ruled this case out with certainty
  // would sit around 90 characters, and that's too few for a question.
  //
  // So it's handled the other way around: the limit stays generous, and
  // the card gives way instead.
  //
  // The floor is 40px, and that's computed against the FONT, not against a
  // specific one: drawing happens in --mono, and what that resolves to is
  // up to the device - SF Mono on a Mac, Menlo, DejaVu, or Consolas
  // elsewhere. Those render at different widths. At 40px, MAX_QUESTION
  // characters still fit in three lines even if the font renders a fifth
  // wider than the one measurements were taken against, while still
  // wasting space on words up to 16 characters long at line ends.
  let questionSize = 54;
  let questionLinesRaw = umbrechen(measurer, p.question, content);
  while (questionLinesRaw.length > 3 && questionSize > 40) {
    questionSize -= 2;
    measurer.font = `700 ${questionSize}px ${mono}`;
    questionLinesRaw = umbrechen(measurer, p.question, content);
  }
  const questionLines = questionLinesRaw.slice(0, 3);
  // And if even 40px isn't enough - text that neither the form nor the
  // database would allow, but that the card could still be asked to
  // draw - at least an ellipsis shows up. A sentence that stops mid-word
  // looks like a typing mistake; three dots say it was truncated on
  // purpose.
  if (questionLinesRaw.length > 3) questionLines[2] = `${questionLines[2]}…`;
  // The line height scales with it: 66 to 54 is the ratio from the
  // original design.
  const questionLine = Math.round(questionSize * 66 / 54);

  const gap = 14;
  let optH = 82;
  // The fixed portion: outer margins, header, question, the number line -
  // and, inside the card at the bottom, some leftover space.
  //
  // For the downloadable image, that leftover space carries the footer.
  // For the card image it stays empty, deliberately: X draws the tile's
  // title as a black box in the bottom left, INTO the image. It needs a
  // surface where it isn't covering anything - if the bars had grown all
  // the way to the bottom, it would sit on top of an answer.
  const innerBottom = fuerKarte ? 78 : 106;
  const fest = m * 2 + 146 + questionLines.length * questionLine + 54 + innerBottom;

  // The aspect ratio depends on what the image is for.
  //
  // For downloading it's allowed to grow: whoever posts it as an image
  // sees it in full, and squeezing ten answers into 16:9 would mean
  // setting the text unreadably small. The limit is 4:5; X doesn't show
  // anything taller uncropped in the timeline.
  //
  // For the preview card, something different applies: X crops a link
  // card to roughly 1.91:1, centered. A taller image loses a strip off the
  // top and bottom in that crop - and the first thing to go is the border
  // we just made visible. So the card is drawn in this ratio from the
  // start, and if the answers don't fit, they get truncated instead of
  // stretching the image.
  const zielV = fuerKarte ? 1.91 : 16 / 9;
  const maxH = fuerKarte ? Math.round(B / 1.91) : Math.round(B * 5 / 4);
  const minH = Math.round(B / zielV);

  let show = p.options;
  let ausgelassen = 0;
  if (fuerKarte) {
    // How many answers fit in the fixed height? At least two, or it
    // wouldn't be a poll anymore. The note about the omitted ones costs a
    // line of its own, so compute first, then truncate.
    const platz = maxH - fest;
    let passt = Math.max(2, Math.floor(platz / (optH + gap)));
    if (passt < p.options.length) passt = Math.max(2, Math.floor((platz - 40) / (optH + gap)));
    if (passt < p.options.length) {
      show = p.options.slice(0, passt);
      ausgelassen = p.options.length - passt;
    }
  }

  const n = Math.max(1, show.length);
  const hinweisH = ausgelassen ? 40 : 0;
  const H = Math.max(minH, Math.min(maxH, fest + hinweisH + n * (optH + gap)));

  // If there's leftover space in the frame, the bars grow into it instead
  // of leaving a gap at the bottom. Capped, because a 200px-tall bar for a
  // three-word answer looks ridiculous.
  const frei = H - fest - hinweisH - n * (optH + gap);
  if (frei > 0) optH = Math.min(132, optH + frei / n);
  const rest = Math.max(0, H - fest - hinweisH - n * (optH + gap));

  const leinwand = document.createElement('canvas');
  leinwand.width = B * S;
  leinwand.height = H * S;
  const ctx = leinwand.getContext('2d');
  ctx.scale(S, S);
  ctx.textBaseline = 'alphabetic';

  // The image is opaque, not transparent. Transparent would be the
  // cleaner file, but it doesn't survive the trip: X often re-encodes PNGs
  // as JPEG, and JPEG has no concept of transparency - the free corners
  // would turn black in the process. This way it looks the same everywhere,
  // no matter what happens to the file along the way.
  ctx.fillStyle = color.grund;
  ctx.fillRect(0, 0, B, H);

  // Everything from here on sits inside the rounded card - the glow and
  // the bars both cleanly follow the rounding at the corners too.
  const cardH = H - m * 2;
  ctx.save();
  roundedRect(ctx, m, m, B - m * 2, cardH, BILD_ECKE);
  ctx.clip();

  ctx.fillStyle = color.card;
  ctx.fillRect(m, m, B - m * 2, cardH);

  // A very faint glow used to sit in the bottom right here, with the
  // reasoning: without it the surface is completely flat, and a flat
  // surface disappears among all the other dark tiles in the timeline.
  //
  // The problem is real, but the gradient is gone anyway - the site
  // doesn't have one anymore either, and a card that's the only thing
  // still carrying one would stand out from the rest. The border further
  // down now does that job instead: bolder and brighter than a hairline.
  //
  // The border is actually the better tool for this too. X often
  // re-encodes PNGs as JPEG, and a subtle difference in a flat area can
  // get lost against its surroundings in that process. A line stays a
  // line.
  //
  // Side effect, measured: the downloadable image weighs 294 instead of
  // 1086KB, the preview card 110 instead of 358KB. PNG compresses flat
  // areas well but not soft transitions - those get rasterized with noise,
  // and that rasterization was the most expensive part of the file. This
  // was exactly what caused X to show a broken image, back then.

  let y = m + 46;

  // --- Header: the logo -----------------------------------------------------
  // The same two bars as in the logo, just recomputed at image scale: the
  // original sits in a viewBox of 42 by 64 units.
  const logoH = 30;
  const e = logoH / 64;
  ctx.fillStyle = color.marke;
  roundedRect(ctx, margin, y + 38 * e, 18 * e, 26 * e, 9 * e);
  ctx.fill();
  roundedRect(ctx, margin + 24 * e, y, 18 * e, 64 * e, 9 * e);
  ctx.fill();

  ctx.font = `700 26px ${mono}`;
  ctx.fillStyle = color.text;
  // letterSpacing isn't supported everywhere; without the tracking, the
  // logotype just looks a bit tighter, the image stays correct either way.
  try { ctx.letterSpacing = '3px'; } catch { /* doesn't matter */ }
  ctx.fillText('SIZED', margin + 42 * e + 12, y + 23);
  try { ctx.letterSpacing = '0px'; } catch { /* doesn't matter */ }

  ctx.font = `400 20px ${mono}`;
  ctx.fillStyle = color.dimmer;
  ctx.textAlign = 'right';
  ctx.fillText('sized.gg', B - margin, y + 23);
  ctx.textAlign = 'left';
  y += 92;

  // --- Die Frage ------------------------------------------------------------
  ctx.font = `700 ${questionSize}px ${mono}`;
  ctx.fillStyle = color.text;
  for (const line of questionLines) {
    ctx.fillText(truncate(ctx, line, content), margin, y + Math.round(questionSize * 46 / 54));
    y += questionLine;
  }

  // --- Die Zahlen darunter --------------------------------------------------
  ctx.font = `400 21px ${mono}`;
  ctx.fillStyle = color.dim;
  const gesamt = `${fullUsd(p.totalUsd)} in $${state.cfg.symbol}`;
  ctx.fillText(gesamt, margin, y + 26);

  if (p.closed) {
    const x = margin + ctx.measureText(gesamt).width + 20;
    ctx.font = `600 15px ${mono}`;
    const w = ctx.measureText('CLOSED').width + 18;
    ctx.fillStyle = color.balken;
    roundedRect(ctx, x, y + 8, w, 26, SCHILD_ECKE);
    ctx.fill();
    ctx.strokeStyle = color.linie;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color.dim;
    ctx.fillText('CLOSED', x + 9, y + 26);
  }
  y += 54 + rest * .55;

  // --- The answers ------------------------------------------------------------
  //
  // The width of the filled area is the SHARE of the total amount, not a
  // measurement of its own: p.options[i].share comes from usd_i /
  // totalUsd, and totalUsd is the sum of exactly those amounts. So the
  // shares add up to 1, and the filled segments placed side by side add up
  // to exactly one full bar. test-poll-bild.mjs checks that this holds, to
  // keep it that way.
  const leads = leadingShare(p);

  // The widest dollar amount decides how much room the answers get.
  // Without this shared column, the text would start at a different
  // position on every line.
  ctx.font = `700 36px ${mono}`;
  const moneyWidth = show.length
    ? Math.max(...show.map((o) => ctx.measureText(fullUsd(o.usd)).width))
    : 0;

  // And how much room is left over for the answer text itself.
  const textWidth = content - 50 - moneyWidth - 36;

  // Answers are set smaller if the longest one wouldn't fit otherwise -
  // the same concession made above for the question, for the same reason.
  //
  // But the reason here is sharper, and it's a mistake I made: MAX_ANSWER
  // is 60 characters, and those 60 were measured against ONE font - the
  // one that happened to be on the machine measurements were taken on. But
  // the card is drawn in --mono, and what that resolves to is up to the
  // device: SF Mono on a Mac, Menlo, DejaVu, or Consolas elsewhere. Those
  // render at different widths. A fixed character count and a measured
  // width can therefore never stay in agreement for good - it fits
  // somewhere, and elsewhere an ellipsis suddenly shows up after text the
  // form explicitly allowed.
  //
  // So here too, the card measures instead of trusting the limit. The 60
  // characters now only say how long an answer is ALLOWED to be; whether
  // it shows up at full size is decided by measurement.
  //
  // Floor of 21px: below that the answer text sits smaller than the amount
  // next to it, and the row starts looking like the number is the main
  // point.
  let optSize = 27;
  // Measured at the weight the labels are actually drawn in. It used to be
  // 650 because the winning row was the heaviest and therefore the widest
  // case; every row is 500 now. In a monospace the advance width does not
  // depend on the weight at all, so this changes no number today - but it
  // does if --mono ever falls through to a proportional default, which has
  // happened here before.
  const passtAlles = (groesse) => {
    ctx.font = `500 ${groesse}px ${mono}`;
    return show.every((o) => ctx.measureText(o.label).width <= textWidth);
  };
  while (optSize > 21 && !passtAlles(optSize)) optSize -= 1;

  let answersTruncated = 0;
  for (const o of show) {
    const spitze = leads !== null && o.share === leads;

    // The row has NO fill of its own, just an outline - same as on the
    // site, where .opt-bar has had none either since the tab was flattened.
    //
    // This used to be filled with --bg-3, and that worked fine as long as
    // the fill on top was translucent white: both had a blue cast, so the
    // transition read as one surface in two brightness levels. X's gray is
    // neutral. Next to --bg-3, the empty part then looked like a second,
    // blue-tinted bar sitting behind the first - two boxes instead of one
    // bar in a track.
    roundedRect(ctx, margin, y, content, optH, BALKEN_ECKE);
    // The leading bar used to have a second, brighter 2px border here.
    // That's gone since the fill became a color: being in the lead is now
    // communicated by the blue, and saying the same thing twice doesn't
    // make it clearer, it makes it noisy. One stroke for every row.
    ctx.strokeStyle = color.linie;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Solid color with a hard edge - on the site the same fill fades out
    // softly.
    //
    // The difference is deliberate, not an oversight. On the site the bar
    // is clickable and changes as people vote; a hard edge jumping through
    // a word on click reads as a bug there. The image is static. An edge
    // that doesn't move reads as settled - and it says something the soft
    // gradient swallows: the share ends exactly here.
    //
    // The answer text sits over the bar here too and gets crossed by the
    // edge. The fill is opaque instead of translucent since it took on X's
    // color values; measured, the text stays readable on both sides of the
    // edge (10.0:1 on the gray, 6.0:1 on the blue, 16.2:1 next to it).
    //
    // Same two colors as on the site, pulled from the same stylesheet -
    // otherwise the image that goes out into the world would look
    // different from the site it came from.
    const fillB = Math.max(0, Math.min(1, o.share)) * content;
    if (fillB > 1) {
      ctx.save();
      roundedRect(ctx, margin, y, content, optH, BALKEN_ECKE);
      ctx.clip();
      ctx.fillStyle = spitze ? color.fuellungSpitze : color.fuellung;
      ctx.fillRect(margin, y, fillB, optH);
      ctx.restore();
    }

    // The amount on the right, ALONE and centered on the row.
    //
    // Three different things have occupied this spot, one after another:
    // the vote count under the amount, then nothing, then the percentage,
    // now nothing again. The percentage was tried and got pulled again -
    // it said the same thing as the bar length, just one line louder.
    //
    // Only the share is allowed to come back from that list, never the
    // VOTE COUNT: it could be inflated by someone splitting their balance
    // across many wallets right before closing and voting with each one.
    // Amount and share can't be gamed that way, because both come from the
    // dollar amounts, not from a count.
    //
    // 13 isn't an arbitrary number: the amount sits on the baseline, its
    // cap height is 26px, half of that sits above the center.
    const center = y + optH / 2;
    ctx.textAlign = 'right';
    ctx.font = `700 36px ${mono}`;
    // Every amount in the same colour, the leading one included. It used to
    // take the accent here, and the site did the same until it was taken out
    // there: the bar underneath already says which answer is winning, and a
    // second colour on the figure says it once more in a way that competes
    // with the bar instead of adding to it. The card has to agree with the
    // page it came from.
    ctx.fillStyle = color.text;
    ctx.fillText(fullUsd(o.usd), B - margin - 26, center + 13);
    ctx.textAlign = 'left';

    // The answer text itself. Deliberately WITHOUT your own checkmark: the
    // image goes out into the world, and how the sender voted doesn't
    // belong in it.
    // One weight for every answer, the winning one included. The site
    // dropped the bolder winning line (see .opt.leads in styles.css) and the
    // card has to agree with the page it came from - a shared image that
    // sets the winner in a heavier cut than the site does is the same class
    // of drift as the logo colour was.
    ctx.font = `500 ${optSize}px ${mono}`;
    ctx.fillStyle = color.text;
    const caption = truncate(ctx, o.label, textWidth);
    if (caption !== o.label) answersTruncated++;
    ctx.fillText(caption, margin + 26, center + 10);

    y += optH + gap;
  }

  // Omitted answers are named, not hidden. A card that silently shows half
  // the answers implies something about the result.
  if (ausgelassen) {
    ctx.font = `400 20px ${mono}`;
    ctx.fillStyle = color.dimmer;
    ctx.fillText(`+ ${ausgelassen} more option${ausgelassen === 1 ? '' : 's'} on sized.gg`,
      margin, y + 22);
  }

  // --- Footer -----------------------------------------------------------------
  //
  // For the card image, the strip at the bottom stays EMPTY.
  //
  // X draws the tile's title as a black box in the bottom left, into the
  // image. It can't be left out - without a title X doesn't build a tile
  // at all, but shows the bare link instead. So the box gets a surface
  // where it isn't covering anything.
  //
  // The space is kept clear regardless, not filled by the bars: otherwise
  // the box would sit on top of an answer.
  //
  // In the downloadable image, the line still appears - there's no box
  // there, and "sized.gg" belongs on an image that gets posted.
  if (!fuerKarte) {
    ctx.font = `400 19px ${mono}`;
    ctx.fillStyle = color.dimmer;
    // Without "sized.gg": that's already in the top right. The same
    // address twice on one image isn't emphasis, it's repetition.
    ctx.fillText(p.closed
      ? 'This vote is closed'
      : `Hold $${state.cfg.symbol} to vote`, margin, H - m - 38);

    // When this picture was taken.
    //
    // The numbers on a poll keep moving - a balance changes and every bar
    // changes with it. An image does not, so an undated image is a claim
    // about "now" that stays a claim about "now" forever. The date is what
    // turns it back into a snapshot.
    //
    // Bottom RIGHT, opposite the status line rather than under it: the two
    // sat a few pixels apart in the first draft and read as one wrapped
    // sentence. Right-aligned they are two facts in two corners.
    //
    // UTC and not the local zone: the file gets posted, and whoever reads it
    // is not in the same zone as whoever made it.
    ctx.textAlign = 'right';
    ctx.fillText(stempelText, B - margin, H - m - 38);
    ctx.textAlign = 'left';
  }

  ctx.restore();

  // The border goes on last, on top. It's the only thing that actually
  // shows the rounding: card and background differ by only a few
  // brightness steps, and after X's re-encoding that difference can nearly
  // disappear. The stroke survives it.
  //
  // Since the glow is gone, it also carries the entire job of setting the
  // card apart from the timeline on its own. Hence --dimmer instead of
  // --line, and 3px instead of 1.5: the hairline looks fine too on a black
  // background, but that's not where the tile ends up living.
  ctx.strokeStyle = color.dimmer;
  ctx.lineWidth = 3;
  roundedRect(ctx, m, m, B - m * 2, cardH, BILD_ECKE);
  ctx.stroke();

  // The geometry actually drawn hangs off the image.
  //
  // This exists for the test, for a specific reason: if the test
  // recomputed the bar widths itself, it would be checking its own copy of
  // the formula, not what actually happened here. That's exactly how it
  // once stayed green after the page margin had changed. Attaching a few
  // numbers to the canvas costs nothing and keeps the check honest.
  // The dialog in front of the download prints the same timestamp under the
  // preview. It reads it from HERE rather than calling Date() again - two
  // clocks read a second apart give two different answers, and the sentence
  // next to it says the card and the line belong together.
  leinwand.stempel = stempelText;

  leinwand.geometrie = {
    content,
    ratio: B / H,
    gezeigt: show.length,
    ausgelassen,
    // The two places where text silently disappears: a question spanning
    // three lines, and an answer that truncate() appended three dots to.
    // They're recorded here so MAX_QUESTION and MAX_ANSWER can be checked
    // against the DRAWN image, not against a recomputed formula.
    questionLinesRaw: questionLinesRaw.length,
    questionSize,
    frageGekuerzt: questionLinesRaw.length > 3,
    optSize,
    answersTruncated,
    fuellungen: show.map((o) => Math.max(0, Math.min(1, o.share)) * content),
  };

  return leinwand;
}

/**
 * Puts a poll's preview image into public storage.
 *
 * Why it gets uploaded at all: the first one to open a posted link isn't
 * the reader, it's X's crawler - and it doesn't run JavaScript. Whatever
 * gets drawn here in the browser, it never sees. The image has to sit
 * ready at a URL before the link gets posted.
 *
 * CALLED EXACTLY ONCE: when the poll is created.
 *
 * That's a decision, not an oversight. The link card shows the poll the
 * way it looked at launch - zero everywhere. It's the invitation to vote,
 * not a results report: whoever wants to post the current numbers
 * downloads the image with the download button and attaches it as a
 * picture.
 *
 * That the card's text stays current while the image doesn't is accepted
 * on purpose. On X it goes unnoticed - link cards there only show the
 * image. In Slack or Telegram the current state appears below it and
 * contradicts the image; that's the price for not having to regenerate the
 * card on every single share.
 *
 * The only exception is addMissingCards(): polls from before this
 * mechanism existed have no image at all, and an image with today's
 * numbers is better there than the fallback card.
 *
 * Errors are deliberately only logged. The upload hangs off an action
 * meant to do something else - create a poll. Letting that action fail, or
 * interrupting it with an error message, would be backward: the poll
 * exists, only its card is missing.
 */
async function ladeOgBildHoch(p) {
  if (!state.me?.isAdmin || !state.db?.storage) return false;
  try {
    const leinwand = await drawPoll(p, { fuerKarte: true });
    const blob = await new Promise((r) => leinwand.toBlob(r, 'image/png'));
    if (!blob) return false;
    const { error } = await state.db.storage.from('og')
      .upload(cardFile(p.id), blob, {
        upsert: true,
        contentType: 'image/png',
        // One year, immutable - and that isn't a guess: the filename
        // carries the version number (poll-12-v9.png). Under THIS name the
        // image never changes; if the card design changes, CARD_VERSION
        // goes up and the name is a different one.
        //
        // This used to say 300 seconds. After that, every request
        // fetched the image from the source again - X's included, if
        // someone shared the link again hours later. Five minutes of
        // caution for a file that by definition never changes.
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
 * Backfill missing preview cards.
 *
 * Runs once at startup, only for Ansem. The reason: a shared link should
 * show a card without anyone having pressed a button first - but polls
 * from before this mechanism existed don't have one.
 *
 * ONE directory listing call is made, and what already exists is read from
 * that. The alternative would be checking each poll individually; with
 * fifty polls that's fifty requests for information that fits in one
 * response.
 *
 * Capped at a handful per startup. Each image is roughly 400KB, and
 * uploading fifty of them when the page opens would be disproportionate -
 * the rest get picked up on the next startup, or when shared.
 */
const MAX_CARDS_PER_START = 6;

async function addMissingCards() {
  if (!state.me?.isAdmin || !state.db?.storage || !state.polls?.length) return;
  try {
    const { data, error } = await state.db.storage.from('og').list('', { limit: 1000 });
    if (error) throw new Error(error.message);
    const vorhanden = new Set((data ?? []).map((d) => d.name));

    const fehlend = state.polls
      .filter((p) => !vorhanden.has(cardFile(p.id)))
      .slice(0, MAX_CARDS_PER_START);
    if (!fehlend.length) return;

    // One at a time, not all at once: drawing six canvases in parallel
    // makes the UI stutter on a phone, and there's no rush here.
    for (const p of fehlend) await ladeOgBildHoch(p);
    console.info(`[og] ${fehlend.length} Vorschaukarte(n) nachgetragen`);
  } catch (e) {
    console.warn('[og] cards not backfilled:', e.message);
  }
}

/**
 * Hand a blob to the browser as a file.
 *
 * Pulled out of ladePollBild because there are now two places that save the
 * same image: the phone, where the share sheet was declined, and the button
 * inside the dialog. Two copies of six lines is how they drift.
 */
function speichereBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not immediately: some browsers only read the URL after the click.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The look at the card before it is saved. Desktop only.
 *
 * Why this exists at all: on a phone the image goes through navigator.share,
 * and the system sheet shows it before it goes anywhere. On the desktop
 * nothing was shown - a file appeared in Downloads and whether it said what
 * you wanted it to say you found out afterwards, in Finder.
 *
 * What it holds while open is in ZUSTAND rather than in closures, because
 * the listeners are registered ONCE at startup and not per opening. Adding
 * them on each open is how a dialog ends up downloading three files after
 * the third time it is opened.
 */
const DIALOG = {
  blob: null,
  name: '',
  pollId: null,
  ausloeser: null,   // the button that opened it - focus goes back there
  bildUrl: null,
};

function teilenDialogZu() {
  const kasten = $('#bild-dialog');
  if (!kasten || kasten.hidden) return;
  kasten.hidden = true;
  // The <img> keeps the URL alive as long as it points at it, so clear the
  // src BEFORE revoking - otherwise the browser holds a reference to
  // something that no longer exists and Chrome logs it as a broken image.
  const bild = $('#bild-dialog-bild');
  if (bild) bild.removeAttribute('src');
  if (DIALOG.bildUrl) URL.revokeObjectURL(DIALOG.bildUrl);
  DIALOG.bildUrl = null;
  DIALOG.blob = null;
  // Back where it came from. Without this the focus lands on <body> and the
  // next Tab starts again at the top of the page - for anyone navigating by
  // keyboard the dialog would cost them their place in the list.
  const zurueck = DIALOG.ausloeser;
  DIALOG.ausloeser = null;
  if (zurueck?.isConnected) zurueck.focus();
}

function teilenDialogAuf({ blob, name, stempel, pollId, ausloeser }) {
  const kasten = $('#bild-dialog');
  // No dialog in the document (the test pages build a reduced one): then the
  // download is what it always was, rather than nothing at all.
  if (!kasten) { speichereBlob(blob, name); return false; }

  DIALOG.blob = blob;
  DIALOG.name = name;
  DIALOG.pollId = pollId;
  DIALOG.ausloeser = ausloeser ?? null;
  DIALOG.bildUrl = URL.createObjectURL(blob);

  $('#bild-dialog-bild').src = DIALOG.bildUrl;
  $('#bild-dialog-stempel').textContent = stempel || '';
  kasten.hidden = false;
  $('#bild-dialog-laden')?.focus();
  return true;
}

/** Registered once. See the note at DIALOG. */
function teilenDialogVerdrahten() {
  const kasten = $('#bild-dialog');
  if (!kasten) return;

  $('#bild-dialog-zu')?.addEventListener('click', teilenDialogZu);

  // The ground closes, the card does not. Checking the target IS the ground
  // and not merely containing it: a click that starts on the card and ends
  // outside it (selecting the timestamp, say) would otherwise close the
  // dialog mid-drag.
  kasten.addEventListener('mousedown', (e) => {
    if (e.target === kasten) teilenDialogZu();
  });

  $('#bild-dialog-laden')?.addEventListener('click', () => {
    if (!DIALOG.blob) return;
    speichereBlob(DIALOG.blob, DIALOG.name);
    // The check mark belongs on the poll's own button, and only now: opening
    // a preview is not the same as having saved something.
    if (DIALOG.pollId != null) buttonOn('poll-image', DIALOG.pollId);
    teilenDialogZu();
  });

  document.addEventListener('keydown', (e) => {
    if (kasten.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); teilenDialogZu(); return; }
    if (e.key !== 'Tab') return;
    // Keep Tab inside. Two controls, so this is a cycle rather than a
    // general focus trap - and written from the actual element list, so a
    // third control added later is picked up without touching this.
    const ziele = [...kasten.querySelectorAll('button')].filter((b) => !b.disabled);
    if (!ziele.length) return;
    const erst = ziele[0];
    const letzt = ziele[ziele.length - 1];
    if (e.shiftKey && document.activeElement === erst) { e.preventDefault(); letzt.focus(); }
    else if (!e.shiftKey && document.activeElement === letzt) { e.preventDefault(); erst.focus(); }
  });
}

/**
 * Build the image and deliver it.
 *
 * Three paths now, and each has a reason:
 *
 *   phone     navigator.share. iOS is why: an a[download] to a blob URL
 *             sometimes does something there and sometimes does nothing.
 *             The share menu works reliably and fits the purpose better
 *             anyway - the image goes straight to X, with no detour
 *             through Photos.
 *   desktop   the dialog above. Saving a file the person has not seen is
 *             the thing that was wrong here.
 *   neither   the plain download, for a page without the dialog markup.
 */
async function ladePollBild(id) {
  const p = state.polls.find((x) => x.id === Number(id));
  if (!p) return toast('That poll is not in the list anymore', true);

  if (!buttonClaim('poll-image', id)) return;
  try {
    const leinwand = await drawPoll(p);
    const blob = await new Promise((r) => leinwand.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not build the image');

    const name = `sized-poll-${p.id}.png`;
    const file = new File([blob], name, { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        // Anything else: fall through to the dialog below.
      }
    }

    // Everything that is not the system sheet goes through the dialog.
    //
    // This started out as "desktop gets the dialog, phone does not", and that
    // was one distinction too many. The dialog exists because saving a file
    // nobody has looked at is the thing being fixed - so the question is not
    // what KIND of device this is, it is whether the person has already seen
    // the picture. The share sheet shows it; nothing else does. A phone whose
    // browser cannot share is in exactly the same position as a desktop, and
    // the first version of this quietly saved the file there without a word.
    //
    // No check mark yet either: the dialog holds the blob and its own button
    // saves it. Opening a preview is not the same as having saved something.
    const offen = teilenDialogAuf({
      blob, name, stempel: leinwand.stempel, pollId: Number(id),
      ausloeser: $(`.poll-image[data-image="${id}"]`),
    });
    // Only when there is no dialog in the document at all - the reduced pages
    // the tests build. Then the download is what it always was.
    if (!offen) buttonOn('poll-image', id);
  } catch (e) {
    console.error('[poll] image failed:', e);
    toast(e.message || 'Could not build the image', true);
  } finally {
    buttonRelease('poll-image', id);
  }
}

function pollHtml(p) {
  // Ansem doesn't vote: he asks the question, sets the answers, and closes
  // the poll - adding the heaviest holder in the room on top of that would
  // stop this from being a poll at all. The database rejects his vote
  // anyway; here the options are made to not even look clickable to begin
  // with.
  const eligibleToVote = !state.me.isAdmin;

  // The leading answer takes the blue fill - the same treatment as in the
  // image the download button generates, and from the same computation. It
  // used to be drawn bolder as well; that is gone, see .opt.leads in
  // styles.css. Only after closing: why, is explained at leadingShare().
  const leads = leadingShare(p);

  // Voting with the keyboard.
  // -------------------------------------------------------------------------
  // This used to be a bare <div>. That made the central action of the
  // whole site unreachable by keyboard: the measured tab order went logo,
  // tabs, log out, link, image - and then back to the start, never
  // touching a single answer. A screen reader announced the rows as plain
  // text.
  //
  // Not a <button>, even though that seems obvious: a button brings its
  // own padding, its own font inheritance, and in Safari its own minimum
  // height, and the surrounding stylesheet is built around a div. A
  // role="button" with tabindex tells the same screen reader the same
  // thing, without touching the appearance.
  //
  // aria-disabled instead of disabled, because a div has no concept of
  // disabled - and because a closed poll should stay VISIBLE, including to
  // someone having it read aloud.
  //
  // aria-pressed says which answer is your own. Without it, the checkmark
  // is just a picture.
  const opts = p.options.map((o) => {
    const zu = p.closed || !eligibleToVote;
    return `
    <div class="opt ${zu ? 'locked' : ''} ${p.myOptionId === o.id ? 'mine' : ''}${leads !== null && o.share === leads ? ' leads' : ''}"
         data-poll="${p.id}" data-option="${o.id}"
         role="button" tabindex="${zu ? -1 : 0}"
         aria-disabled="${zu}" aria-pressed="${p.myOptionId === o.id}">
      <div class="opt-bar">
        <div class="opt-fill" style="width:${(o.share * 100).toFixed(1)}%"></div>
        <div class="opt-text">
          <span class="opt-label">${esc(o.label)}${p.myOptionId === o.id
            // The icon is for the eye, the sentence is for the screen
            // reader. This used to be a ✓ character - it got read aloud as
            // "check mark" and didn't say what it meant.
            ? `${VOTE_SVG}<span class="nur-vorlesen"> — your vote</span>` : ''}</span>
          <span class="opt-num">
            <span class="held">${fullUsd(o.usd)}</span>
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
      <span>${fullUsd(p.totalUsd)} in $${esc(state.cfg.symbol)} total</span>
      ${!p.closed && p.closesAt ? deadlineLine(p) : ''}
      ${p.closed ? '<span class="closed-tag">CLOSED</span>' : ''}
      ${state.me.isAdmin && !p.closed ? '<span class="dim">· you do not vote in your own polls</span>' : ''}
      ${state.me.isAdmin && !p.closed ? `<button class="btn btn-ghost btn-close-poll" data-poll="${p.id}">Close poll</button>` : ''}
    </div>
    ${opts}
  </article>`;
}

/**
 * Delete a poll. Ansem only.
 *
 * Two taps, not one. The first turns the trash can into a checkmark, the
 * second deletes. No popup warning, no warning color - the icon itself is
 * the confirmation prompt, and the answer is the same button.
 *
 * The reason for the two steps still holds: there's no undo. Votes hang
 * off the poll by foreign key and get deleted along with it by the
 * database; nobody can restore them, and the people who voted held tokens
 * to do so. The button also sits right next to two harmless ones - copy
 * link and download image - and in a row of similar-looking icons, you
 * eventually miss.
 *
 * After five seconds the checkmark turns back into a trash can. Without
 * that, an armed button would just sit there in the app, forgotten by
 * everyone - and the next casual tap deletes.
 *
 * "Armed" lives in buttonActive, not on the button. The reason is explained
 * in detail there: the list gets rebuilt on every vote from anyone, and
 * state on the DOM node doesn't survive that. That's exactly the bug
 * behind the second tap sometimes doing nothing.
 */
async function deletePoll(id) {
  const p = state.polls.find((x) => x.id === Number(id));
  if (!p) return toast('That poll is not in the list anymore', true);

  if (!buttonIsOn('poll-delete', id)) {
    buttonOn('poll-delete', id);
    return;
  }

  buttonOff('poll-delete', id);
  if (!buttonClaim('poll-delete', id)) return;
  // Answers and votes hang off it via "on delete cascade" and get removed
  // along with it - the database handles that, not the browser. Deleting
  // in three steps from here could abort halfway through and leave behind
  // a poll with no answers.
  const { error } = await state.db.from('polls').delete().eq('id', p.id);
  buttonRelease('poll-delete', id);

  // Only the failure case announces itself. That it worked is visible
  // from the poll being gone - a message on top would just say the same
  // thing twice. That it did NOT work, on the other hand, is invisible
  // anywhere else: the poll would simply still be sitting there, and that
  // reads as a stuck button.
  if (error) return toast(error.message, true);

  // The preview image doesn't hang off the poll by foreign key, so the
  // database doesn't clean it up along with it. Leaving it wouldn't be a
  // disaster, but an old link would then keep showing a card that looks
  // valid for something that no longer exists.
  // Take every version along, not just the current one: after a version
  // bump, the old ones are still sitting there, and a link to a deleted
  // poll shouldn't find a card that still looks valid.
  state.db.storage?.from('og')
    .remove(Array.from({ length: CARD_VERSION }, (_, i) => `poll-${p.id}-v${i + 1}.png`)
      .concat(`poll-${p.id}.png`))
    .catch((e) => console.warn('[og] preview image not deleted:', e.message));

  // Other browsers pick this up via realtime; our own doesn't wait for
  // that, so the button doesn't seem to point at nothing.
  loadPolls().catch((e) => console.warn('[poll] reload after delete:', e.message));
}

async function vote(pollId, optionId) {
  // Belt and suspenders: the click never even reaches here, because the
  // options are locked against it - but whoever reaches this function some
  // other way should get the same answer the database would give.
  if (state.me.isAdmin) return toast('You cannot vote in your own polls', true);

  const { error } = await state.db.from('votes')
    .upsert({ poll_id: pollId, option_id: optionId, wallet: state.me.wallet },
      { onConflict: 'poll_id,wallet' });
  if (error) return toast(error.message, true);
  await loadPolls();
  toast('Vote counted');
}

/**
 * The answer fields and the button below them.
 *
 * Two is the floor - with one answer it wouldn't be a poll anymore.
 *
 * Four is the ceiling, and that number is measured. The yardstick is again
 * the image that goes out into the world, but this time not its content,
 * its ASPECT RATIO: X shows an image in the timeline uncropped up to 16:9
 * and crops anything taller at the top and bottom. The card grows with
 * every answer. Measured (with a single-line question; multi-line
 * questions push the number down further):
 *
 *        4 answers   1.78 - exactly 16:9, nothing gets cropped
 *        5 answers   1.74 - a narrow strip
 *        6 answers   1.58
 *       10 answers   1.14 - nearly square, a good chunk is gone
 *
 * Four is therefore the last number at which the posted image arrives
 * intact. That X allows exactly four in its own native polls is the same
 * reason, not imitation.
 *
 * The small link preview (1.91:1) is unaffected by this: it has a fixed
 * height and shows three or four answers depending on how long the
 * question is, naming the rest as "+ N more options on sized.gg". That
 * fallback stays in place - it now only kicks in for a three-line
 * question.
 *
 * The database enforces the same limit (migration
 * 20260830020000_antwortzahl.sql). A simple check constraint isn't enough
 * for this: the answer count isn't stored in the row being checked, it
 * results from the other rows. So it's a trigger that counts.
 *
 * ---------------------------------------------------------------------------
 * Why there's no "- Option" button anymore
 *
 * There used to be a second button that removed the last answer again.
 * It's gone, and a word in the placeholder takes its place: from the
 * third answer on, it reads "Option 3 [optional]".
 *
 * This isn't giving something up, it's the more honest information. An
 * empty field was never an answer to begin with - when the poll is
 * created it gets dropped by filter(Boolean) regardless of whether it's
 * there or not. So the minus button was cleaning up something that had no
 * consequences either way, while looking like cleanup was required.
 * Whoever doesn't want an answer just leaves the field empty.
 *
 * What the word additionally says, and the button never did, is that the
 * first two fields are NOT optional. It used to say the same "Option N"
 * three times, and that two of those were required only showed up in the
 * red error message on submit.
 */
const MIN_OPTIONEN = 2;
const MAX_OPTIONEN = 4;

/**
 * How long a question and an answer are allowed to be.
 *
 * Both numbers are MEASURED, not picked, and the yardstick isn't the
 * form - it's the image that goes out into the world:
 *
 *   The question sits on the card in bold and gets THREE lines. At 54px
 *   and a content width of 1428px, 43 characters fit on one line, so 129
 *   across three - but only if no word wrap wastes space. It does waste
 *   some, and how much depends on the words, not the character count: one
 *   long word at the end of a line leaves half a line empty.
 *
 *   Measured (scripts/mess-frage-laenge.mjs, 4,000 random test sentences
 *   per length, at a fixed font size; "too long" means: needs a fourth
 *   line):
 *
 *          word lengths   English prose   up to 13   up to 16   up to 20
 *          100 characters              0          0          0        28
 *          110 characters              6         23        185       551
 *          120 characters            518       1160       1729      2356
 *
 *   100 was chosen: the largest of the tested lengths at which nothing
 *   wraps even with above-average-length words.
 *
 *   An answer sits on one line next to its dollar amount. If it's still
 *   too long, truncate() appends an ellipsis. Measured, 70 characters fit
 *   even next to the widest amount ($12,345,678), 75 next to a small one.
 *   60 was chosen.
 *
 * Why have a limit at all, when the card gives way anyway:
 * ---------------------------------------------------------------------------
 * drawPoll() shrinks the font until the question fits in three lines -
 * so this isn't about text disappearing anymore. It's about the size it
 * arrives at. A question that would force the card down to 44px isn't the
 * headline it was meant to be anymore, sitting in the timeline between
 * other posts.
 *
 * The database enforces the same values (see migration
 * 20260830010000_laengen.sql). That's the real gate; what's here only
 * makes sure nobody types first and gets a rejection after.
 */
const MAX_QUESTION = 100;
const MAX_ANSWER = 60;

/**
 * The placeholder for an answer row.
 *
 * A function, not a string repeated in three places: the first two fields
 * sit in the markup, every field after that gets created here, and
 * resetting after poll creation runs over it once more too. Three places
 * for the same text would be two too many.
 *
 * Square brackets, not round ones, and the reason is the font:
 * ---------------------------------------------------------------------------
 * The site is set entirely in a monospace font, where EVERY character
 * occupies the same cell width. A round parenthesis is a narrow glyph in a
 * wide cell - measured at a 4px glyph in a 9px cell. That turns
 * "(optional)" into what reads to the eye as "( optional )", even though
 * there isn't a single space in the actual text. A square bracket fills
 * its cell almost completely and so sits tight against the word on its
 * own.
 *
 * There used to be a whole apparatus for this: a second label made of real
 * markup laid over the field, where the parentheses got their own,
 * narrower cell, plus a measuring tool run against X's form. It's gone
 * now. Swapping one character does the same thing and costs nothing.
 */
const optionPlaceholder = (nr) =>
  nr > MIN_OPTIONEN ? `Option ${nr} [optional]` : `Option ${nr}`;

/**
 * Attaches a character counter to a field.
 *
 * It sits INSIDE the field, on the right, like on X. It isn't always
 * visible: it shows while typing in the field, and also once space gets
 * tight. The second case is the important one - someone who pastes in a
 * long text and clicks away should see that they're at the limit without
 * having to click back in.
 *
 * The space on the right is ALWAYS reserved, even when the counter isn't
 * currently showing. Otherwise the text under the cursor would jump as
 * soon as you enter the field. The width comes from the longest number
 * that could ever appear there - "110 / 110" - computed in ch: in a
 * monospace font, one ch is exactly one cell, so the math works out
 * exactly.
 *
 * maxlength does the actual work; the counter just explains why typing
 * stops. Without it, it would look like a keyboard that silently stopped
 * responding.
 */
function appendCounter(field, max) {
  const panel = field.closest('.zaehl-feld');
  const zaehler = panel?.querySelector('.zaehler');
  if (!zaehler) return;
  field.maxLength = max;
  const longest = `${max} / ${max}`;
  field.style.paddingRight = `calc(${longest.length}ch + 1.4rem)`;
  const reveal = () => {
    const n = field.value.length;
    zaehler.textContent = `${n} / ${max}`;
    // Close means: the last ten characters. Full means: none left.
    panel.classList.toggle('ist-knapp', max - n <= 10);
    panel.classList.toggle('ist-voll', n >= max);
  };
  field.addEventListener('input', reveal);
  reveal();
}

function renderOptionButtons() {
  $('#btn-add-option').hidden = $('#poll-options').children.length >= MAX_OPTIONEN;
}

/** An answer row: field plus counter, same as the first two in the markup. */
function optionField(nr) {
  const panel = document.createElement('label');
  panel.className = 'zaehl-feld';
  panel.innerHTML = `<input class="poll-option" type="text"`
    + ` placeholder="${esc(optionPlaceholder(nr))}">`
    + '<span class="zaehler" aria-hidden="true"></span>';
  appendCounter(panel.querySelector('.poll-option'), MAX_ANSWER);
  return panel;
}

$('#btn-add-option').addEventListener('click', () => {
  const box = $('#poll-options');
  if (box.children.length >= MAX_OPTIONEN) return;
  const panel = optionField(box.children.length + 1);
  box.appendChild(panel);
  renderOptionButtons();
  panel.querySelector('.poll-option').focus();
});

renderOptionButtons();
// The two fields already in the markup, plus the question field above them.
appendCounter($('#poll-question'), MAX_QUESTION);
for (const field of $$('.poll-option')) appendCounter(field, MAX_ANSWER);

/**
 * Resets the create box to the state it opens in.
 *
 * Question empty, exactly MIN_OPTIONEN empty answer fields, duration back
 * to the default. So not just "clear the text": whoever opened up four
 * answer fields finds two again the next time they open it.
 *
 * The BOX gets removed, not just the field inside it: the counter hangs
 * off the box. Leave it in place and "0 / 60" would sit there with no
 * field underneath it.
 *
 * The input event has to be dispatched by hand. Setting value doesn't
 * trigger one - the counter next to it would otherwise stay stuck at the
 * last typed count and show "37 / 60" over an empty field.
 */
function pollFormClear() {
  $$('#poll-options > .zaehl-feld').forEach((panel, idx) => {
    if (idx >= MIN_OPTIONEN) { panel.remove(); return; }
    const field = panel.querySelector('.poll-option');
    field.value = '';
    field.dispatchEvent(new Event('input'));
  });
  $('#poll-question').value = '';
  $('#poll-question').dispatchEvent(new Event('input'));
  renderOptionButtons();
  setTerm();
}

/**
 * The create box opens and closes.
 *
 * Closed is the default state, for a reason that's easy to lose sight of
 * while building this: Ansem is the only one who sees this box, but he
 * sees it ALWAYS. Five lines above the list, even on the vast majority of
 * days when he isn't creating a poll at all. On a phone that meant half
 * the screen was gone before the first poll even started.
 *
 * The state lives as a class on the box, not in a variable: that way the
 * stylesheet can react to it directly, and there's no second place where
 * "open" gets stored that could drift out of sync with the first.
 *
 * ---------------------------------------------------------------------------
 * Closing is a CANCEL, not a tidy-up
 *
 * For a long time, closing here just meant "make it smaller," and
 * whatever had been typed stayed in place. It came back up the next time
 * it opened - a half-filled-out form from two days ago, whose question
 * you have to read again just to figure out whether you still want to ask
 * it.
 *
 * That's why the reset lives HERE and not on the button: otherwise there
 * are two paths in, the button and the one after creating a poll, and only
 * one of them would clean up. That's exactly how the two would drift
 * apart.
 *
 * There's deliberately no "Are you sure?" It would get in the way on
 * every close, including the many where nothing has been typed at all -
 * and what's lost is one to four short lines. Getting it back means typing
 * it again, not clicking through a confirmation every single time.
 */
function pollFormular(offen) {
  const panel = $('#poll-admin');
  panel.classList.toggle('offen', offen);
  $('#poll-admin-felder').hidden = !offen;
  $('#btn-poll-neu').setAttribute('aria-expanded', String(offen));
  // Jump focus into the first field only on opening. On closing it would
  // be a jump into nothing - and on a phone it would pop the keyboard up.
  if (offen) { $('#poll-question').focus(); return; }
  // The duration dropdown can be sitting open above the box. It belongs to
  // the form and has to disappear with it, or it's left stranded.
  lzZu();
  pollFormClear();
}

$('#btn-poll-neu').addEventListener('click', () =>
  pollFormular(!$('#poll-admin').classList.contains('offen')));

/**
 * How tall the create box currently is - as a CSS variable on the polls
 * tab.
 *
 * Needed for exactly one thing: the "No polls yet" message should sit in
 * the middle of the PAGE, not the middle of the list. The two are the same
 * as long as nothing sits above the list - and drift apart by a good
 * hundred pixels as soon as Ansem opens the box. Without this
 * compensation, the message visibly slides down when it opens.
 *
 * A ResizeObserver, not a call added at the three or four places that
 * change the height: opening, closing, one more answer, one fewer, a line
 * wrap on device rotation - that's five paths, and the sixth one is where
 * you forget to add the call. The observer only knows one case: the height
 * changed.
 *
 * The bottom margin counts too: there's 1rem between the box and the
 * list, and it pushes the same way.
 */
function observeHeaderHeight() {
  const panel = $('#poll-admin');
  const tab = $('#pane-polls');
  if (!panel || !tab || typeof ResizeObserver === 'undefined') return;
  const melde = () => {
    const sichtbar = !panel.hidden;
    const bottom = parseFloat(getComputedStyle(panel).marginBottom) || 0;
    tab.style.setProperty('--poll-kopf',
      `${sichtbar ? panel.getBoundingClientRect().height + bottom : 0}px`);
  };
  new ResizeObserver(melde).observe(panel);
  melde();
}
observeHeaderHeight();
// Once, at startup - see the note at DIALOG.
teilenDialogVerdrahten();

/**
 * The duration in the create form: days, hours, minutes.
 *
 * This used to be a single value in hours, with a plus and a minus next
 * to it, and that was a row you had to tap your way through. Getting from
 * one day to three took 48 taps.
 *
 * Three lists aren't just faster, they also match how someone actually
 * thinks about a duration: "three days", "two hours" - not "72" or "2".
 *
 * ---------------------------------------------------------------------------
 * Why this isn't a <select>
 *
 * It was one, for two rounds, and both reasons against it are measured:
 *
 *   The focus ring. Chromium counts a <select> as :focus-visible after a
 *   MOUSE CLICK - like a text field, unlike a button. That triggers the
 *   :focus-visible:not(input):not(textarea) rule in the stylesheet, and
 *   the field ended up with a bright ring nobody asked for. Measured:
 *   outline 2px solid after a click, with data-tastatur not set.
 *
 *   The dropdown. For a <select>, the operating system draws it, and its
 *   height follows the number of entries: eight for Days, twenty-four for
 *   Hours, sixty for Minutes. Three differently-sized dropdowns under
 *   three identical-looking boxes - and no way to control that from here.
 *
 * So it's hand-built instead: a <button> (NOT focus-visible after a
 * click) and a custom list that has the same height for all three and
 * scrolls.
 *
 * What a <select> gives you for free is written out below instead:
 * arrows, Home/End, Enter, Escape, typing closes it. Half-built would be
 * worse than not built at all - opening a dropdown and then reaching into
 * nothing with the arrow keys leaves you stuck.
 *
 * ---------------------------------------------------------------------------
 * No deadline sits in the right place
 *
 * "Runs until Ansem closes it by hand" used to hang as a special case
 * BELOW the shortest duration, because it had to go somewhere in a single
 * row - by rank it belonged at the top end, but that spot was
 * unreachable. The comment at that spot openly named it a compromise.
 *
 * With three fields, that compromise is gone: no duration IS no deadline.
 * Everything at zero means no end, and because someone could set that by
 * accident too, the sentence about it shows up right below as soon as it
 * applies.
 *
 * ---------------------------------------------------------------------------
 * A week as the ceiling
 *
 * Seven days was already the maximum before, and the reasoning still
 * holds: beyond that it stops being a poll. What's new is that the limit
 * now comes from three fields combined - 7 days plus 6 hours would be too
 * much.
 *
 * That's solved with a single rule, applied three times: an entry is
 * disabled if it, TOGETHER WITH THE OTHER TWO, would come to more than a
 * week. If Hours is set to 6, the 7 in Days is grayed out. If Days is set
 * to 7, every hour except zero is grayed out.
 *
 * The payoff isn't just symmetry: this way a number never needs correcting
 * after the fact. A value that changes itself after you let go is the
 * most unpleasant thing a form can do - you set one thing and a different
 * one is sitting there. Here you never even get into that state, and the
 * reason for it is visible right next to it.
 */
const LZ_MAX_MINUTEN = 7 * 24 * 60;   // one week
const TERM_FIELDS = [
  { id: 'tage',    max: 7,  faktor: 1440 },
  { id: 'stunden', max: 23, faktor: 60 },
  { id: 'minuten', max: 59, faktor: 1 },
];
const LZ_VORGABE = { tage: 1, stunden: 0, minuten: 0 };

const lzWert = (id) => Number($(`#lz-${id}`).dataset.wert);

/** The chosen duration in minutes. 0 means: no deadline. */
const chosenDeadlineMinutes = () =>
  TERM_FIELDS.reduce((summe, f) => summe + lzWert(f.id) * f.faktor, 0);

/**
 * Rebuilds a list's entries.
 *
 * Fully rebuilt every time instead of patching individual entries: a list
 * has at most sixty rows, that costs nothing - and this way the "which one
 * is disabled" state can never drift out of sync with the real one.
 */
function lzListe(field) {
  const button = $(`#lz-${field.id}`);
  const liste = $(`#lz-liste-${field.id}`);
  const wert = lzWert(field.id);
  // What the other two fields already account for combined.
  const rest = TERM_FIELDS.filter((f) => f !== field)
    .reduce((summe, f) => summe + lzWert(f.id) * f.faktor, 0);

  liste.replaceChildren(...Array.from({ length: field.max + 1 }, (_, i) => {
    const el = document.createElement('div');
    el.id = `lz-${field.id}-${i}`;
    el.className = 'lz-eintrag';
    el.setAttribute('role', 'option');
    el.textContent = String(i);
    el.dataset.wert = String(i);
    const zuViel = rest + i * field.faktor > LZ_MAX_MINUTEN;
    // aria-disabled, not disabled: a <div> has no concept of disabled, and
    // a screen reader should still announce the entry - "seven, not
    // available" says more than an entry that's simply missing.
    if (zuViel) el.setAttribute('aria-disabled', 'true');
    el.setAttribute('aria-selected', String(i === wert));
    return el;
  }));
  button.querySelector('.lz-zahl').textContent = String(wert);
}

/** Brings all three lists and the notice in line with the current state. */
function renderLaufzeit() {
  for (const field of TERM_FIELDS) lzListe(field);
  const ohne = chosenDeadlineMinutes() === 0;
  const hinweis = $('#lz-hinweis');
  hinweis.hidden = !ohne;
  hinweis.textContent = ohne ? 'No end — the poll runs until you close it.' : '';
}

/**
 * Sets all three fields at once.
 *
 * The one-week limit gets enforced again here, even though the dropdowns
 * already prevent exceeding it in the first place. The reason is the order
 * of guarantees: "a poll runs at most one week" is a statement about the
 * DURATION, not about the UI. If it only lived in the UI, it would be gone
 * the next time something else calls this - and that's exactly the kind
 * of gap nobody notices, because nothing looks broken.
 *
 * Trimmed from the bottom up: minutes first, then hours. Someone who sets
 * seven days means those seven days; the rest is whatever was too much.
 */
function setTerm(werte = LZ_VORGABE) {
  let remaining = LZ_MAX_MINUTEN;
  for (const field of TERM_FIELDS) {
    const desired = Math.min(field.max, Math.max(0, Math.round(werte[field.id] ?? 0)));
    const passt = Math.min(desired, Math.floor(remaining / field.faktor));
    remaining -= passt * field.faktor;
    $(`#lz-${field.id}`).dataset.wert = String(passt);
  }
  renderLaufzeit();
}

// ---------------------------------------------------------------------------
// The dropdown
// ---------------------------------------------------------------------------

/** Which list is currently open - at most one. */
let lzOffen = null;

function lzZu() {
  if (!lzOffen) return;
  $(`#lz-liste-${lzOffen}`).hidden = true;
  const button = $(`#lz-${lzOffen}`);
  button.setAttribute('aria-expanded', 'false');
  button.removeAttribute('aria-activedescendant');
  lzOffen = null;
}

function lzAuf(id) {
  if (lzOffen === id) return lzZu();
  lzZu();
  lzOffen = id;
  const liste = $(`#lz-liste-${id}`);
  const button = $(`#lz-${id}`);
  liste.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  lzZeigeAuf(id, lzWert(id));
}

/**
 * Sets the highlight on an entry and scrolls it into view.
 *
 * The highlight isn't the selection: it's what the arrow keys currently
 * point at. Only Enter turns it into a value. Without that separation, you
 * couldn't move through a list with the arrows without also selecting -
 * and every move would rebuild the other two lists.
 */
function lzZeigeAuf(id, wert) {
  const liste = $(`#lz-liste-${id}`);
  const ziel = liste.querySelector(`[data-wert="${wert}"]`);
  if (!ziel) return;
  for (const e of liste.children) e.classList.toggle('ist-marke', e === ziel);
  $(`#lz-${id}`).setAttribute('aria-activedescendant', ziel.id);
  // Only scroll as far as needed - block: 'nearest' leaves the list alone
  // whenever the entry is already visible.
  ziel.scrollIntoView({ block: 'nearest' });
}

const termMarker = (id) => {
  const el = $(`#lz-liste-${id}`).querySelector('.ist-marke');
  return el ? Number(el.dataset.wert) : lzWert(id);
};

/** Commits a value and closes. Disabled entries don't count. */
function termChoose(id, wert) {
  const eintrag = $(`#lz-liste-${id}`).querySelector(`[data-wert="${wert}"]`);
  if (!eintrag || eintrag.getAttribute('aria-disabled') === 'true') return;
  $(`#lz-${id}`).dataset.wert = String(wert);
  lzZu();
  // All three, rebuilt: the new value shifts what's still allowed in the
  // other two.
  renderLaufzeit();
  $(`#lz-${id}`).focus();
}

/**
 * The next SELECTABLE entry in a given direction.
 *
 * Disabled entries are skipped over, not landed on. Landing on an entry
 * that Enter then refuses would be a dead end in the middle of the list -
 * you press it and nothing happens.
 */
function lzNachbar(id, von, richtung) {
  const liste = $(`#lz-liste-${id}`);
  const alle = [...liste.children]
    .filter((e) => e.getAttribute('aria-disabled') !== 'true')
    .map((e) => Number(e.dataset.wert));
  if (!alle.length) return von;
  if (richtung === 'anfang') return alle[0];
  if (richtung === 'ende') return alle[alle.length - 1];
  const next = richtung > 0 ? alle.filter((w) => w > von) : alle.filter((w) => w < von);
  if (!next.length) return von;
  return richtung > 0 ? next[0] : next[next.length - 1];
}

for (const field of TERM_FIELDS) {
  const button = $(`#lz-${field.id}`);
  const liste = $(`#lz-liste-${field.id}`);

  button.addEventListener('click', () => lzAuf(field.id));

  // A click on an entry. Attached to the list, not to each entry
  // individually: entries get rebuilt on every change, and listeners
  // attached to freshly built elements get forgotten on the next rebuild.
  liste.addEventListener('click', (e) => {
    const eintrag = e.target.closest('[data-wert]');
    if (eintrag) termChoose(field.id, Number(eintrag.dataset.wert));
  });
  // The highlight follows the pointer, so mouse and keyboard don't show
  // two different "here I am"s.
  liste.addEventListener('mousemove', (e) => {
    const eintrag = e.target.closest('[data-wert]');
    if (eintrag && eintrag.getAttribute('aria-disabled') !== 'true') {
      lzZeigeAuf(field.id, Number(eintrag.dataset.wert));
    }
  });

  // The keyboard. This is the part a <select> gave you for free - written
  // out here in full, because a half-working dropdown is worse than none
  // at all.
  button.addEventListener('keydown', (e) => {
    const offen = lzOffen === field.id;
    const marker = termMarker(field.id);

    if (e.key === 'Escape') {
      if (offen) { e.preventDefault(); lzZu(); }
      return;
    }
    if (e.key === 'Tab') { lzZu(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (offen) termChoose(field.id, marker); else lzAuf(field.id);
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1, Home: 'anfang', End: 'ende' }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    if (!offen) { lzAuf(field.id); return; }
    lzZeigeAuf(field.id, lzNachbar(field.id, marker, step));
  });
}

// A click elsewhere closes it. On the document, in the bubble phase: a
// click on a different button should close the old dropdown AND open the
// new one, and that order only comes out right this way.
document.addEventListener('click', (e) => {
  if (lzOffen && !e.target.closest(`#lz-liste-${lzOffen}`)
      && !e.target.closest(`#lz-${lzOffen}`)) lzZu();
});

setTerm();

$('#btn-create-poll').addEventListener('click', async () => {
  const question = $('#poll-question').value.trim();
  const options = $$('.poll-option').map((i) => i.value.trim()).filter(Boolean);
  if (!question) return toast('Question is missing', true);
  if (options.length < MIN_OPTIONEN) {
    return toast(`At least ${MIN_OPTIONEN} options are required`, true);
  }

  // The deadline is computed HERE, from the device's clock, and saved as
  // a fixed point in time - not as a duration the database would have to
  // interpret later. "Runs 24h" means 24 hours from creation; a stored
  // timestamp can't be shifted by anything after that.
  //
  // 0 explicitly means null: a poll with no deadline that only closes by
  // hand. That was the only case before deadlines existed, so it has to
  // stay reachable.
  const minuten = chosenDeadlineMinutes();
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

  // And close again. The poll is now in the list below - that's what
  // Ansem wants to see after creating it, not an empty form.
  //
  // The reset lives inside the close: this used to be written out
  // separately here, and the button that closes the box had its own
  // version of it - namely none at all. A form that can be closed TWO
  // different ways, and only cleans up on one of them, eventually stops
  // cleaning up on either.
  //
  // The duration also resets to the default here. Leaving it as is would
  // be the friendlier assumption - "he probably wants 7 days again" - but
  // then the form would look half filled-out: question empty, answers
  // empty, and one setting still carried over from the last poll.
  pollFormular(false);
  await loadPolls();
  toast('Poll started');

  // Only after loadPolls(): before that, the poll doesn't exist yet in
  // state, and the image needs the finished answers, zero counts included.
  //
  // Those zero counts are exactly the point: this is what the card will
  // look like everywhere a shared link points to it. It never gets
  // overwritten again.
  const fresh = state.polls.find((x) => x.id === data.id);
  if (fresh) ladeOgBildHoch(fresh);
});

// ---------------------------------------------------------------------------
// DMs
// ---------------------------------------------------------------------------

async function loadDms() {
  $('#dm-user').hidden = state.me.isAdmin;
  $('#dm-admin').hidden = !state.me.isAdmin;

  // Ansem can change the threshold at any time. Whoever opens the tab
  // shouldn't be checked against a value from an hour ago and only find
  // out on submit that it was too low. One line, one query.
  await refreshDmMin();

  if (!state.me.isAdmin) {
    const rows = unwrap(await state.db.from('dms').select('*').order('id'));
    state.dmMessages = rows;
    checkDmAnswers(rows);
    // If the open reply referenced something that no longer exists, it
    // has to go - otherwise the reply bar would point at a deleted
    // message.
    if (state.dmReplyTo && !rows.some((r) => r.id === state.dmReplyTo)) clearDmReply();
    const box = $('#dm-thread');
    box.innerHTML = rows.length
      ? dmListeHtml(rows)
      : '<div class="empty">No messages yet. Write to Ansem directly.</div>';
    scrollBottom(box);
    return;
  }

  renderDmMin();

  // Nothing gets loaded in demo mode at all - see DEMO_DMS way up top.
  const threads = DEMO_DMS
    ? demoThreads(DEMO_DMS)
    : unwrap(await state.db.from('dm_threads').select('*').order('tokens', { ascending: false }));
  state.dmThreads = threads;
  checkHiding(threads);

  renderThreads();
}

/**
 * Does the database already know about hiding?
 *
 * The same pattern as checkDmAnswers() nearby, and for the same reason:
 * the markup and app.js live on a web host, the migration lives in
 * Supabase - the two get uploaded by hand and are therefore bound to be
 * out of sync in age sometimes. For a while, a newer UI runs against an
 * older database.
 *
 * Without this check, it looked like this: the "Hide" button was there, a
 * press on it produced "Could not find the table 'public.dm_hidden' in the
 * schema cache" - a message from the machine room, in the middle of the
 * UI, for a button the site itself offered.
 *
 * It's detected by the column the new view includes. If it's missing, the
 * migration hasn't been applied yet, and the button never shows up in the
 * first place. With an empty inbox, the last known state is kept - the
 * question can't be answered then, and "don't offer it" is the safe
 * answer.
 */
function checkHiding(threads) {
  if (DEMO_DMS) { state.dmHideAvailable = true; return; }
  if (threads?.length) state.dmHideAvailable = 'hidden' in threads[0];
}

/**
 * Renders the inbox from state.dmThreads.
 *
 * A function of its own, because it's needed for more than just loading:
 * when Ansem opens a thread, its messages are now read, and the red
 * counter has to disappear immediately. Before, it only did that on the
 * next full reload - so you'd click a thread and the count would just sit
 * there, as if the click had done nothing.
 */
function renderThreads() {
  const alle = state.dmThreads ?? [];

  // Anyone holding less than the threshold no longer shows up. Nothing
  // gets deleted in the process - if Ansem lowers the threshold again, the
  // conversations come back, history and all. The people themselves still
  // see their own thread, but can't write anything new; the database
  // decides that on insert, not this view.
  // While typing, the typed number already applies, with no need to
  // confirm it.
  const min = Number(state.dmMinEntwurf ?? state.cfg.min_dm_usd ?? 0);
  const overThreshold = min > 0 ? alle.filter((t) => Number(t.usd) >= min) : alle;

  // There used to be a line here counting how many conversations the
  // threshold is currently hiding. It's gone: the slider sits right above
  // and says the same thing better. Anyone reading "$1,000" knows
  // filtering is happening - the number next to it was a second piece of
  // information about the same setting, and it sat, of all places, above
  // the line that gives a DIFFERENT piece of information.

  // ---------------------------------------------------------------------
  // Manually hidden conversations
  //
  // Two ways to disappear from the list, and only ONE gets a status line:
  //
  //   the THRESHOLD is a rule, and it's shown as a number on the slider
  //   above. Lower it, and the conversations come back - that doesn't
  //   need a counter that says the same thing a second time.
  //
  //   HIDING is a decision about exactly one person, and it isn't visible
  //   anywhere else. It stays until Ansem reverses it - even if that
  //   person keeps writing. Without this line that would be a dead end:
  //   he'd have no way to know the conversations still exist.
  //
  // That's why only conversations above the threshold get counted here.
  // Whoever's already below it doesn't show up regardless of hiding -
  // counting them here would mean quoting a number that changes on its
  // own the moment the threshold is lowered.
  const verborgene = state.dmHideAvailable
    ? overThreshold.filter((t) => t.hidden) : [];
  // The toggle shows the hidden ones INSTEAD of the others, not mixed in
  // between.
  //
  // At first they sat mixed into the list, dimmed. That read wrong:
  // checking who you hid meant hunting for three rows among forty - and
  // the dimming was the only clue for which ones were meant. So the whole
  // list toggles instead; you're either in the inbox or in what you set
  // aside.
  // If the database doesn't know about hiding, this view doesn't exist.
  // That's the only case where it closes on its own.
  if (state.zeigeVerborgene && !state.dmHideAvailable) state.zeigeVerborgene = false;

  const threads = state.zeigeVerborgene
    ? verborgene
    : overThreshold.filter((t) => !t.hidden);

  // The status row stays visible even once nothing is hidden anymore, as
  // long as you're standing in this view. Otherwise it's a dead end:
  // whoever brings back the last conversation sees "Inbox is empty" with
  // no button left to get back to the real inbox.
  //
  // There used to be an automatic jump back here instead - at zero hidden,
  // the view closed itself. That was already pointless because it sat
  // BELOW the line that assembles the list: the empty version was still
  // what got shown, and only the next call would have caught it.
  //
  // But it would have been the wrong move regardless. Bringing something
  // back is a click on a row, and swapping out the whole list underneath
  // that click just because it was the last one is a movement nobody
  // triggered. Whoever's done leaves through the same button they came in
  // through.
  const vBox = $('#thread-versteckt');
  vBox.hidden = !state.dmHideAvailable
    || (verborgene.length === 0 && !state.zeigeVerborgene);
  if (!vBox.hidden) {
    // The text says WHAT you're currently looking at - it isn't always
    // the same thing. In hidden mode, the list below means something
    // different, and a line that stays silent about that would leave you
    // thinking the inbox is empty.
    // Even zero gets spelled out: "Showing 0 hidden conversations" is the
    // information that matches the empty list below it.
    $('#thread-versteckt-zahl').textContent = state.zeigeVerborgene
      ? (verborgene.length === 1
        ? 'Showing 1 hidden conversation'
        : `Showing ${verborgene.length} hidden conversations`)
      : (verborgene.length === 1
        ? '1 conversation hidden by you'
        : `${verborgene.length} conversations hidden by you`);
    // The button says what it DOES, not what state the list is in: "Show"
    // means pressing it will show them. A toggle that names the state
    // reads as the opposite of what it does in half the cases.
    $('#btn-versteckt').textContent = state.zeigeVerborgene ? 'Back' : 'Show';
    $('#btn-versteckt').setAttribute('aria-expanded', String(Boolean(state.zeigeVerborgene)));
  }

  // One row per conversation: handle, preview, amount. Sorted by holdings,
  // top to bottom - that ordering is the only structure needed here. No
  // sections, no colored bar for the open conversation: a selection isn't
  // important, it's just selected. A brighter background is enough for
  // that.
  //
  // Unopened conversations sit on a faintly blue background, and their
  // preview text is one step brighter. Two signals for the same state, but
  // both quiet - and neither one is its own separate mark in the row: a
  // red badge, a dot, and a bar were all tried, and all three claimed
  // urgency instead of just "not read yet".
  //
  // Blue, because brightness is already spoken for: the brighter
  // background means "currently open". If both states were expressed as
  // brightness, they'd be confusable - this way color carries one, and
  // brightness carries the other.
  //
  // That's also why the rule in the stylesheet sits before :hover and
  // .is-active: all three are equally specific, so order decides, and a
  // conversation that's currently open should look open, not unread.
  //
  // "You:" appears before the preview if Ansem wrote last.
  //
  // This was here once, got removed, and came back. The reasoning for
  // removing it: in a list of handles, text, and amounts, it's a fourth
  // element, and it makes the row noisy. That argument was correct - for
  // the row as it looked back then. Since then, the preview cuts off at 16
  // characters, leaving open space to its right; the room is there now.
  //
  // And the information is worth more than it seemed back then: without
  // it, your own last reply reads like a new message from the other
  // person. With forty conversations, most of them already answered,
  // that's exactly the most common row.
  //
  // It sits as its own element before the preview, not inside its text:
  // that way it doesn't eat into the 16 characters, and it can carry a
  // color of its own.
  //
  // Single-line instead of two, because with fifty conversations the list
  // would otherwise run five screens long.
  $('#thread-items').innerHTML = threads.length ? threads.map((t) => `
    <button class="thread ${Number(t.unread) > 0 ? 'is-unread' : ''} ${state.activeThread === t.wallet ? 'is-active' : ''} ${t.hidden ? 'ist-verborgen' : ''}"
            data-wallet="${esc(t.wallet)}" title="${esc(t.wallet)}">
      <span class="h t${toneOf(t.wallet)}">${esc(handleOf(t.wallet))}</span>
      ${t.last_from_admin ? '<span class="thread-du">You:</span>' : ''}
      <span class="thread-prev">${esc(t.preview)}</span>
      <span class="w">${shortUsd(Number(t.usd))}</span>
    </button>`).join('')
    // "Empty" means two different things here. In the hidden view, the
    // inbox is NOT empty - it's just currently sitting somewhere else, one
    // button away. The old sentence used to claim the opposite of what the
    // line above it says.
    : (state.zeigeVerborgene
      ? '<div class="empty">Nothing hidden any more.</div>'
      : '<div class="empty">Inbox is empty.</div>');

  $$('#thread-items .thread').forEach((b) =>
    b.addEventListener('click', () => openThread(b.dataset.wallet, true)));
}

/**
 * Whose message is being quoted - as a handle.
 *
 * Only two participants, so there are exactly two possible answers: Ansem
 * or the other side. Who "the other side" is depends on who's looking -
 * for Ansem it's the thread he currently has open, for everyone else it's
 * themselves.
 */
const dmAutor = (q) => handleOf(q.from_admin
  ? state.cfg.admin_wallet
  : (state.me.isAdmin ? state.activeThread : state.me.wallet));

/**
 * The quote above a DM reply.
 *
 * With no name: in a conversation with exactly two participants, a name
 * says nothing you don't already know, and it takes width away from the
 * actual text.
 *
 * It needs no separate loading path: a conversation always loads in full,
 * so the quoted message is already available. If it's still missing, it
 * was deleted - and in that case nothing should be shown here that
 * pretends to restore it.
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
 * Builds the conversation history with date separators.
 *
 * The comparison runs on the start of the day, not on the date's string
 * form: a message at 23:58 and the reply at 00:03 belong to different
 * days, even though only five minutes separate them - that's exactly what
 * the separator is for.
 */
function dmListeHtml(rows) {
  let lastDay = null;
  const out = [];
  for (const r of rows) {
    const tag = tagBeginn(new Date(r.created_at));
    if (tag !== lastDay) {
      out.push(`<div class="day-sep"><span>${esc(tagLabel(r.created_at))}</span></div>`);
      lastDay = tag;
    }
    out.push(dmHtml(r));
  }
  return out.join('');
}

/**
 * A single DM.
 *
 * The quote sits OUTSIDE the bubble, above it - that's how X does it, and
 * this part is built to match. The difference isn't just taste: inside the
 * bubble, the quote had to stand out against the bubble's background, and
 * because your own bubble is light and an incoming one is dark, that took
 * two special-case rules that contradicted each other. Placed above the
 * bubble, it sits on the same background on both sides and needs just one
 * rule.
 *
 * That's why the three parts sit in their own column (.dm-block): header,
 * quote bubble, message. The reply arrow stays next to it.
 */
function dmHtml(row) {
  const mine = state.me.isAdmin ? row.from_admin : !row.from_admin;
  return `<div class="dm-row ${mine ? 'mine' : ''}" data-id="${row.id}">
      <div class="dm-block${row.reply_to ? ' has-quote' : ''}">
        ${dmQuoteHtml(row)}
        <div class="msg dm ${mine ? 'mine' : ''}">
          <span class="body">${withLinks(row.body)}</span>
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

/** The two conversation views - one for Ansem, the other for everyone else. */
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
  // No name, same as in the quote: two participants, a name says nothing.
  $(t.text).textContent = q.body;
  $(t.bar).hidden = false;
  $(t.input).focus();
}

function clearDmReply() {
  state.dmReplyTo = null;
  $('#dm-reply-bar').hidden = true;
  $('#admin-reply-bar').hidden = true;
}

/** Jumps to the quoted message and makes it flash briefly. */
function gotoDm(id) {
  const line = $(`${dmTeile().box} .dm-row[data-id="${id}"]`);
  const bubble = line?.querySelector('.msg');
  if (!bubble) return;
  line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  bubble.classList.remove('flash');
  void bubble.offsetWidth;
  bubble.classList.add('flash');
}

/**
 * A click handler for both conversation views.
 *
 * On desktop, the arrow appears on hover; on a phone, by tapping the
 * message. Whoever just selected text didn't mean to tap - otherwise the
 * selection would disappear again the instant you let go.
 */
for (const sel of ['#dm-thread', '#admin-thread']) {
  $(sel).addEventListener('click', (e) => {
    const rep = e.target.closest?.('[data-dm-reply]');
    if (rep) { setDmReply(Number(rep.dataset.dmReply)); return; }

    const goto = e.target.closest?.('[data-dm-goto]');
    if (goto) { gotoDm(Number(goto.dataset.dmGoto)); return; }

    // Otherwise, tapping does NOTHING.
    // -----------------------------------------------------------------------
    // A tap here used to switch the row to "active" and make the reply
    // arrow appear. That was the way to reply before swiping existed, and
    // it's been one too many ever since: tapping a message is the single
    // most common touch there is - while scrolling, while aiming at
    // something else, while just looking at it - and every time, an arrow
    // popped into view that nobody asked for.
    //
    // Replying happens by swiping now. On desktop the arrow still appears
    // on mouse hover (.dm-row:hover), that stays.
  });
}

// ---------------------------------------------------------------------------
// By touch: long-press and swipe left
// ---------------------------------------------------------------------------
//
// There used to be only one way to reply on a phone: tap the message so
// the arrow appears, then hit the arrow. Two taps on a 44px target - and
// whoever long-pressed instead got a text selection and iOS's context
// menu.
//
// Now, like in X's DMs: swiping right replies directly, the arrow appears
// along the way, and there's a single haptic buzz at the limit.
//
// A small popup on long-press ("Reply / Copy") existed here for a while
// and was removed again on request.
//
// Touch only. On desktop everything stays as it was - there, hover shows
// the arrow and selection works on the text.

const SWIPE_START_PX = 12;    // beyond this it's a swipe, not a jitter
// This distance used to be 64px and was cut to 44: the thumb doesn't need
// to travel that far for the gesture to be unambiguous, and the bubble
// doesn't leave its spot by so much that the row looks jumpy.
const SWIPE_MAX_PX = 44;      // how far the bubble can be dragged
const SWIPE_THRESHOLD_PX = 32; // beyond this the swipe counts as a reply

/**
 * The state of an in-progress touch.
 *
 * A single object, not one per row: there's exactly one finger doing
 * something at any moment. Two at once isn't a swipe, it's a pinch zoom -
 * that case is excluded below.
 */
let griff = null;


/** Puts the bubble back in place, no matter how the swipe ended. */
function swipeBack(g) {
  if (!g?.block) return;
  g.line.classList.remove('wischt');
  g.block.style.transform = '';
  const pfeil = g.line.querySelector('.reply-btn');
  if (pfeil) pfeil.style.opacity = '';
}

for (const sel of ['#dm-thread', '#admin-thread']) {
  const box = $(sel);

  box.addEventListener('touchstart', (e) => {
    // Two fingers isn't a swipe, it's a pinch zoom.
    if (e.touches.length !== 1) { swipeBack(griff); griff = null; return; }
    const line = e.target.closest?.('.dm-row');
    if (!line) return;
    const id = Number(line.dataset.id);
    if (!id) return;

    const t = e.touches[0];
    griff = {
      line, id, block: line.querySelector('.dm-block'),
      x: t.clientX, y: t.clientY, zieht: false,
    };
  }, { passive: true });

  // passive: false, because preventDefault is needed while swiping -
  // otherwise the list scrolls along while the bubble is stuck to the
  // finger.
  box.addEventListener('touchmove', (e) => {
    if (!griff || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - griff.x;
    const dy = t.clientY - griff.y;

    if (!griff.zieht) {
      // Decide WHAT this gesture is first, and intercept nothing until
      // then: a vertical swipe is scrolling and has to keep scrolling.
      // The 1.5 factor makes a diagonal swipe count as scrolling - when in
      // doubt, the movement belongs to the list, not to us.
      if (dx > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        griff.zieht = true;
        griff.line.classList.add('wischt');
      } else if (Math.abs(dy) > SWIPE_START_PX) {
        // Unambiguously vertical: this touch is done as far as we're
        // concerned.
        swipeBack(griff);
        griff = null;
        return;
      } else {
        return;
      }
    }

    e.preventDefault();
    // Only to the right, and only up to SWIPE_MAX_PX. Without this clamp,
    // the bubble could be dragged past the edge of the screen.
    const weg = Math.min(SWIPE_MAX_PX, Math.max(0, dx));
    griff.block.style.transform = `translateX(${weg}px)`;
    const pfeil = griff.line.querySelector('.reply-btn');
    // The arrow fades in along with the finger, not all at once: this
    // lets you see the gesture was recognized before you let go.
    if (pfeil) pfeil.style.opacity = String(Math.min(1, weg / SWIPE_THRESHOLD_PX));

    // A single short buzz at the limit - and only once, hence the flag.
    // This is the feedback the thumb gets when the bubble stops moving:
    // from here on the reply is locked in, you can let go.
    //
    // navigator.vibrate exists on Android; Safari on iPhone does NOT know
    // it and silently ignores the call. There, it stays at the visible
    // stop. There's no other way to do this available to a website on
    // iOS.
    if (weg >= SWIPE_MAX_PX && !griff.gebrummt) {
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
    swipeBack(g);
    if (weg >= SWIPE_THRESHOLD_PX) setDmReply(g.id);
  };
  box.addEventListener('touchend', losgelassen, { passive: true });
  box.addEventListener('touchcancel', () => { swipeBack(griff); griff = null; }, { passive: true });

  // A click follows every swipe. That click would toggle the row as if it
  // had been tapped. So it's intercepted here, before the handler further
  // down sees it (capture).
  box.addEventListener('click', (e) => {
    if (griff?.zieht) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

$$('.btn-cancel-dm-reply').forEach((b) => b.addEventListener('click', clearDmReply));
for (const sel of ['#dm-input', '#admin-dm-input']) {
  $(sel).addEventListener('keydown', (e) => { if (e.key === 'Escape') clearDmReply(); });
}

/**
 * Tracks whether the database already knows about the reply column.
 *
 * If the frontend is ahead of the migration, reply_to is missing from the
 * rows. In that case, the reply button disappears instead of offering a
 * reference that the insert would later reject.
 */
function checkDmAnswers(rows) {
  if (rows.length) state.dmRepliesAvailable = 'reply_to' in rows[0];
  $('#dm-user').classList.toggle('no-replies', !state.dmRepliesAvailable);
  $('#dm-admin').classList.toggle('no-replies', !state.dmRepliesAvailable);
}

/**
 * Renders a conversation's header and history. Purely from memory, no
 * network - so switching is visible immediately.
 */
function renderThread(wallet, rows) {
  state.dmMessages = rows;
  checkDmAnswers(rows);

  // No amount in this header. It's already in the list on the left,
  // right in the row the conversation was opened from - repeating it here
  // says nothing new and turns a header into a second display of it.
  $('#thread-title').innerHTML =
    `<strong class="h t${toneOf(wallet)}">${esc(handleOf(wallet))}</strong>`
    + `<span class="addr dim">${esc(wallet)}</span>`;

  // The hide button says what pressing it DOES, not what state the
  // conversation is in: for a hidden one it reads "Unhide".
  const verborgen = Boolean(state.dmThreads?.find((t) => t.wallet === wallet)?.hidden);
  const button = $('#btn-hide-thread');
  // Don't offer what the database can't do yet - see checkHiding().
  button.hidden = !state.dmHideAvailable;
  button.textContent = verborgen ? 'Unhide' : 'Hide';
  button.title = verborgen
    ? 'Put this conversation back in the inbox'
    : 'Take this conversation out of your inbox';

  const box = $('#admin-thread');
  box.innerHTML = dmListeHtml(rows);
  scrollBottom(box);
  $('#admin-dm-form').hidden = false;
  $$('#thread-items .thread').forEach((b) => b.classList.toggle('is-active', b.dataset.wallet === wallet));
}

/**
 * Opens a conversation.
 *
 * The point here is the order of operations. It used to wait for the
 * network response first and only draw something afterward - so every
 * click on a thread cost a full round trip to the server before anything
 * even moved. Jumping back and forth between two conversations meant
 * paying that same wait every time, even though the data had been sitting
 * there the whole while.
 *
 * Now: if the conversation has been loaded before, it's drawn immediately
 * from memory. The fresh query runs in the background afterward and only
 * redraws if something has actually changed - otherwise the view would
 * flicker and jump to the bottom for no reason on every switch.
 *
 * Opening a thread for the first time still has a wait; that's
 * unavoidable, the messages simply aren't there yet. Not after that,
 * though.
 *
 * @param {boolean} reveal  Only on a tap by Ansem himself. When reloading
 *   because of an incoming message, the conversation must not slide over
 *   the inbox on its own - otherwise the view would jump out from under
 *   his thumb while he's going through the list.
 */
async function openThread(wallet, reveal = false) {
  const gewechselt = state.activeThread !== wallet;
  state.activeThread = wallet;
  if (reveal) $('#dm-admin').classList.add('viewing');
  // A reply reference only ever applies within one conversation - the
  // database rejects anything else. So it gets dropped on switching
  // instead of carried along.
  if (gewechselt) clearDmReply();

  const bekannt = state.dmCache.get(wallet);
  if (bekannt) renderThread(wallet, bekannt);

  // Marking as read is a side concern and must not hold up drawing -
  // that's why it runs without await. The dot still disappears
  // immediately; markiereGelesen() updates the counter locally first and
  // sends afterward.
  //
  // It sits BEFORE the demo-mode early return below, and that's not
  // cosmetic: if it sat after it, the dot would stay stuck forever in
  // demo mode - you'd click an unread conversation, read it, and the list
  // would keep claiming something was still open. That's exactly how this
  // was noticed.
  markiereGelesen(wallet).catch((e) => console.warn('[dm] gelesen:', e.message));

  // In demo mode the conversations don't exist - so there's nothing to
  // load either. A few made-up rows so the history isn't empty and the
  // hide button has something to act on.
  if (DEMO_DMS) {
    const line = state.dmThreads?.find((t) => t.wallet === wallet);

    // The last row is the preview, and it comes from whoever the list
    // names. This used to be hardcoded to Ansem with "will look at it" -
    // in every conversation, including the ones without "You:" in front,
    // while the preview sat one row up. So the list said one thing, the
    // opened conversation said another, and comparing two drafts of the
    // list could have cited either one as evidence.
    const youLatest = !!line?.last_from_admin;
    const zeit = (ms) => new Date(Date.now() - ms).toISOString();
    const rows = [
      { id: 1, wallet, from_admin: false, body: 'hey', created_at: zeit(9e6) },
      { id: 2, wallet, from_admin: youLatest ? false : true,
        body: youLatest ? 'can you look at this' : 'whats up', created_at: zeit(8e6) },
      { id: 3, wallet, from_admin: youLatest, body: line?.preview ?? 'gm',
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

  // A different thread got tapped in the meantime - then this response no
  // longer belongs on screen.
  if (state.activeThread !== wallet) return;

  // Only redraw if there's actually something new.
  if (!bekannt || !sameMessages(bekannt, data)) renderThread(wallet, data);
}

/** Shallow comparison: ids and text length are enough to detect changes. */
function sameMessages(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].body !== b[i].body
        || a[i].reply_to !== b[i].reply_to) return false;
  }
  return true;
}

/**
 * Closes the open conversation.
 *
 * Needed when the threshold rises and the currently open thread drops out
 * of the inbox as a result: leaving a conversation open that's no longer
 * in the list would be a state there's no way back out of.
 */
function closeThread() {
  state.activeThread = null;
  state.dmMessages = [];
  clearDmReply();
  $('#thread-title').innerHTML = '<span class="dim">Select a thread</span>';
  $('#admin-thread').innerHTML = '';
  $('#admin-dm-form').hidden = true;
  // The hide button goes away too: with no open conversation it would
  // have nothing to act on, and a button with nothing to act on reads as
  // broken.
  $('#btn-hide-thread').hidden = true;
  $('#dm-admin').classList.remove('viewing');
}

/**
 * Records that this thread was read - in the view first, then in the
 * database.
 *
 * The order is deliberate. The blue background disappears the instant the
 * tap happens, not once the server has responded: going through fifty
 * conversations, that's the difference between a list that keeps up and
 * one that lags behind.
 *
 * If saving fails, the mark gets reverted. That's the more honest display:
 * the next load pulls the list's state from the database anyway, and
 * there the conversation would show as unread again. Without reverting
 * it, you'd be looking at a state only this browser knows about.
 *
 * The failure isn't reported: there's nothing Ansem would do differently
 * because of it, and the thread is still open and readable regardless.
 */
async function markiereGelesen(wallet) {
  const eintrag = state.dmThreads?.find((t) => t.wallet === wallet);
  const vorher = eintrag ? Number(eintrag.unread) : 0;
  if (eintrag && vorher > 0) {
    eintrag.unread = 0;
    renderThreads();
  }

  // In demo mode the messages don't exist - marking them would be an
  // update against rows that aren't ours. The display above is already
  // set, nothing more is needed here.
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

// Back to the inbox (visible on a phone only). The thread stays selected
// on purpose: if a reply comes in, it gets updated in the background and
// is current the next time it's opened.
$('#btn-back-inbox').addEventListener('click', () => {
  $('#dm-admin').classList.remove('viewing');
});

/**
 * Takes a conversation out of the inbox - and brings it back.
 *
 * What this does NOT do is part of the explanation: the other person
 * notices nothing. They keep seeing their own history, they can keep
 * writing, their messages keep being saved. Only Ansem's list stops
 * showing them. Whoever is allowed to write here holds a minimum balance
 * for it - what that buys is the right to WRITE, not a right to a reply.
 * Taking away their ability to write on top of this would be a different
 * thing entirely.
 *
 * And it stays hidden even if they write again: the list is sorted by
 * holdings, not by time, so there's no movement at all that would bring a
 * conversation back on its own. That's deliberate - you hide someone you
 * don't want to read anymore.
 *
 * The database first, then the display, not the other way around:
 * otherwise the row would disappear immediately and come back on the next
 * load, with nobody knowing why. A failure gets reported and the list
 * stays as it was.
 */
async function hideThread(wallet, verbergen) {
  const line = state.dmThreads?.find((t) => t.wallet === wallet);
  if (!line) return;

  // Nothing gets written in demo mode: the conversations don't exist, and
  // an insert would put an address into the real table.
  if (!DEMO_DMS) {
    const { error } = verbergen
      ? await state.db.from('dm_hidden').insert({ wallet })
      : await state.db.from('dm_hidden').delete().eq('wallet', wallet);
    if (error) return toast(error.message, true);
  }

  line.hidden = verbergen;

  // Close the conversation when hiding it: otherwise it would sit open
  // right next to a row that has just disappeared on the left - one
  // screen claiming two contradictory things.
  // Close the open conversation whenever its row drops out of the
  // currently shown list - otherwise it stays open while it's vanished on
  // the left. In hidden mode this runs exactly the other way around:
  // there, whoever gets BROUGHT BACK is the one that drops out.
  const dropsOut = state.zeigeVerborgene ? !verbergen : verbergen;
  if (dropsOut && state.activeThread === wallet) closeThread();
  else if (state.activeThread === wallet) renderThread(wallet, state.dmMessages ?? []);

  renderThreads();
  toast(verbergen ? 'Hidden from your inbox' : 'Back in your inbox');
}

$('#btn-hide-thread').addEventListener('click', () => {
  const wallet = state.activeThread;
  if (!wallet) return;
  const verborgen = Boolean(state.dmThreads?.find((t) => t.wallet === wallet)?.hidden);
  hideThread(wallet, !verborgen);
});

// The toggle under the list. It's deliberately NOT a filter you set and
// forget: the next load resets it to closed, because "hidden" is the
// intended normal state. Whoever wanted to see them permanently didn't
// really want to hide them.
$('#btn-versteckt').addEventListener('click', () => {
  state.zeigeVerborgene = !state.zeigeVerborgene;
  renderThreads();
});

/**
 * Refreshes the current threshold. If it fails - no network, column not
 * there yet - the last known value stays in place. The binding check
 * lives in the database anyway; this is only about the display.
 */
async function refreshDmMin() {
  try {
    const { data, error } = await state.db
      .from('app_config').select('min_dm_usd').eq('id', 1).single();
    if (error || !data) return;
    state.cfg.min_dm_usd = data.min_dm_usd;
    renderDmGate();
  } catch { /* display stays as it was. */ }
}

/**
 * The floor on the DM threshold.
 *
 * Ansem can set it higher, but not lower - and not to zero either. That
 * means the inbox can no longer be opened up completely, and that's the
 * intent: it's the more expensive channel, a DM doesn't land in a stream
 * you skim, it lands with one specific person.
 *
 * The same number lives in the database (migration
 * 20260831030000_dm_untergrenze), and there it's the actual enforcement.
 * What's here only makes sure nobody types first and gets a rejection
 * after.
 */
const MIN_DM_THRESHOLD = 1000;

/**
 * The ceiling, and it's the same number read in both directions: it's
 * exactly what fits in a field with MAX_STELLEN digits.
 *
 * That's why it's derived here instead of written out. A typed
 * 9999999999 and a limit of 9999999999 have to coincide - otherwise
 * there's a number the field accepts and the database rejects, and that's
 * the one case that must not exist at this point.
 */
const MAX_DM_THRESHOLD = 10 ** MAX_STELLEN - 1;


function renderDmMin() {
  const box = $('#dm-min-box');
  const known = state.cfg.min_dm_usd !== undefined && state.cfg.min_dm_usd !== null;
  box.hidden = !known;
  if (!known) return;

  // Never an empty field: empty used to mean "no threshold", and that no
  // longer exists. If the database still has a leftover 0 from before,
  // the field shows the floor value - because that's what will actually
  // get saved next.
  const min = Math.max(MIN_DM_THRESHOLD, Number(state.cfg.min_dm_usd));
  // Don't interfere while typing.
  if (document.activeElement !== $('#dm-min-input')) {
    $('#dm-min-input').value = gruppiere(min);
  }
}

/**
 * Commits the entered threshold.
 *
 * There's no save button anymore. A single number field with a confirm
 * button is a step people forget - and then a number sits there that
 * doesn't actually apply. It commits when the field loses focus and on
 * Enter.
 *
 * Two safeguards become necessary as a result:
 *
 *   * Only write on an actual change. Otherwise every click in and click
 *     away would trigger a write.
 *   * On invalid input, write back the last valid value. With no button
 *     there's no moment left to correct a mistake - so the field must
 *     never be left showing something invalid.
 */
let dmMinRunning = false;

/**
 * Ansem's slider for the DM threshold.
 *
 * If the database doesn't know the column yet (frontend is ahead of the
 * migration), it's simply missing from app_config. Then the field
 * disappears, instead of offering a value nobody can save.
 */
async function speichereDmMin() {
  const input = $('#dm-min-input');
  const bisher = Number(state.cfg.min_dm_usd ?? 0);

  // A second safeguard alongside onlyNumbers(): catches whatever gets into
  // the field some other way.
  const raw = cleanNumber(input.value);

  // An empty field means the FLOOR value, not null.
  //
  // This used to say: empty means "no threshold", i.e. 0 - on the
  // reasoning that whoever deletes the number wants to get rid of it. That
  // held as long as 0 was an allowed value. It isn't anymore; nothing
  // under 1000 is allowed. So "empty" is no longer a statement, it's an
  // unfinished state, and the only honest answer to that is the smallest
  // value that exists.
  //
  // Everything BELOW the floor also gets raised instead of rejected. A
  // rejection would be more correct on paper and worse in practice: you'd
  // have typed something, gotten a red error, and had to type it again -
  // for a number the page already knows about. The database still rejects
  // it regardless; it's the actual gate, this is just the courtesy in
  // front of it.
  //
  // A bare period is also not a number and counts as empty.
  const getippt = Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : 0;
  // The ceiling is already enforced by cleanNumber(), since the eleventh
  // digit never makes it into the field. This catches the path around
  // that - a value set by script, with no input event ever firing.
  const usd = Math.min(MAX_DM_THRESHOLD, Math.max(MIN_DM_THRESHOLD, getippt));

  // From here on, the saved value applies again, not the draft.
  state.dmMinEntwurf = null;

  if (usd === bisher || dmMinRunning) {
    // Show the floor value here too, not the old saved value: if the
    // database still had a leftover 0 from before, you'd otherwise see a
    // 0 again after clearing - exactly the value that's not supposed to
    // exist anymore.
    input.value = gruppiere(Math.max(MIN_DM_THRESHOLD, bisher));
    renderThreads();
    return;
  }

  dmMinRunning = true;
  try {
    const { data, error } = await state.db.rpc('set_min_dm_usd', { p_usd: usd });
    if (error) throw error;
    state.cfg.min_dm_usd = Number(data);
    renderDmMin();

    // The new threshold applies to the inbox immediately. If the
    // currently open conversation drops out, it gets closed - otherwise
    // a reply would sit open to someone who no longer appears in the
    // list.
    renderThreads();
    const offen = state.dmThreads?.find((t) => t.wallet === state.activeThread);
    if (offen && Number(offen.usd) < Number(data)) closeThread();
  } catch (err) {
    input.value = gruppiere(Math.max(MIN_DM_THRESHOLD, bisher));
    renderThreads();
    toast(err.message, true);
  } finally {
    dmMinRunning = false;
  }
}

/* No dedicated confirmation on save - and that's not an oversight: the
   inbox below already follows the number as you type. Whoever raises the
   threshold watches conversations disappear. An extra message would just
   confirm what you already just watched happen. Errors still get
   reported. */

/**
 * The inbox follows the number as you type.
 *
 * With no delay: only what's already in memory gets redrawn. A filter
 * that had to ask the server for this would have to wait until you're
 * done typing - this one doesn't.
 *
 * None of this gets saved; that only happens when the field loses focus.
 * That's why there's a separate draft value: without it, clicking away
 * would leave no way to tell whether anything actually changed compared
 * to the saved state.
 *
 * An empty field means "no threshold" and shows everything again.
 * Otherwise the inbox would go empty the moment you clear it, even though
 * no threshold is actually in effect at that point.
 */
$('#dm-min-input').addEventListener('input', () => {
  const raw = cleanNumber($('#dm-min-input').value);
  const usd = Number(raw);
  // The draft also enforces the floor. Otherwise, typing "1", "10", "100"
  // would make the inbox show three states that can't actually exist -
  // and then jump to a fourth one once you let go.
  const getippt = (raw === '' || !Number.isFinite(usd)) ? 0 : usd;
  state.dmMinEntwurf = Math.max(MIN_DM_THRESHOLD, getippt);
  renderThreads();
});

$('#dm-min-input').addEventListener('blur', speichereDmMin);

$('#dm-min-input').addEventListener('keydown', (e) => {
  // Enter confirms: the field loses focus, and saving is tied to exactly
  // that. Otherwise the cursor would keep blinking there, as if something
  // were still open.
  if (e.key === 'Enter') { e.preventDefault(); $('#dm-min-input').blur(); return; }

  // Escape discards and restores the last saved value.
  if (e.key !== 'Escape') return;
  state.dmMinEntwurf = null;
  $('#dm-min-input').value =
    gruppiere(Math.max(MIN_DM_THRESHOLD, Number(state.cfg.min_dm_usd ?? 0)));
  renderThreads();
  $('#dm-min-input').blur();
});

$('#dm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#dm-input');
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  const line = { wallet: state.me.wallet, body };
  if (state.dmRepliesAvailable && state.dmReplyTo) line.reply_to = state.dmReplyTo;
  const { error } = await state.db.from('dms').insert(line);
  if (error) { toast(error.message, true); input.value = body; }
  // Fehler hier sind nicht schlimm - die Nachricht ist geschrieben, das
  // Nachladen holt der naechste Stups. Ohne .catch bleibt aber eine
  // unbehandelte Zusage stehen.
  else { clearDmReply(); loadDms().catch((e) => console.warn('[dm] Nachladen:', e.message)); }
});

$('#admin-dm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#admin-dm-input');
  const body = input.value.trim();
  if (!body || !state.activeThread) return;
  input.value = '';
  const line = { wallet: state.activeThread, from_admin: true, body };
  if (state.dmRepliesAvailable && state.dmReplyTo) line.reply_to = state.dmReplyTo;

  // In demo mode the reply stays in memory.
  //
  // Not just so nothing ends up in the database: without this branch,
  // submitting would fail with an error message, and you'd see nothing at
  // all of the thing this is actually about - what replying feels like.
  //
  // The inbox row gets updated along with it too: preview, "You:" in
  // front, and the unread counter at zero. Otherwise the list would keep
  // claiming the other person wrote last - and that's exactly the kind of
  // contradiction that leads to the wrong conclusions in a simulation.
  if (DEMO_DMS) {
    const wallet = state.activeThread;
    const rows = [...(state.dmCache.get(wallet) ?? [])];
    rows.push({
      id: (rows.at(-1)?.id ?? 0) + 1,
      wallet, from_admin: true, body,
      reply_to: line.reply_to ?? null,
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

  const { error } = await state.db.from('dms').insert(line);
  if (error) { toast(error.message, true); input.value = body; }
  else {
    clearDmReply();
    // The cached state is now stale.
    state.dmCache.delete(state.activeThread);
    await openThread(state.activeThread);
    loadDms().catch((e) => console.warn('[dm] Nachladen:', e.message));
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Registers the service worker. It makes the site installable and covers
 * brief connectivity gaps - nothing more. If it fails, everything else
 * keeps working normally.
 *
 * Explicitly NOT on your own machine. While developing, it would otherwise
 * sit between the browser and the files, and a reload with Shift held down
 * never reaches it: the worker fetches files with its own fetch, which
 * doesn't bypass the browser cache along with it. So you'd change
 * something and keep seeing the old page, with nothing actually broken.
 * And nobody has this added to a home screen here anyway.
 *
 * An already-registered worker gets actively unregistered here, with its
 * storage cleared - otherwise it would stay active forever from an earlier
 * visit.
 *
 * ?sw=1 turns it on even on your own machine. That's not a backdoor, it's
 * a necessity: a service worker only runs in a secure context, meaning
 * HTTPS or localhost. Whoever needs to test it - the test suite does - has
 * no choice but to turn it on there.
 */
const SW_ERZWUNGEN = new URLSearchParams(location.search).get('sw') === '1';
if ('serviceWorker' in navigator) {
  if (NUR_HIER && !SW_ERZWUNGEN) {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => (self.caches ? caches.keys() : []))
      .then((keys) => Promise.all([...keys].map((k) => caches.delete(k))))
      .catch(() => { /* Nothing to unregister. */ });
  } else {
    navigator.serviceWorker.register('/sw.js')
      .catch((e) => console.warn('[pwa] service worker not registered:', e.message));
  }
}

// ---------------------------------------------------------------------------
// Before startup: the site is closed
// ---------------------------------------------------------------------------
//
// One switch, two effects. app_config.open_to_public decides, in the edge
// function, WHO gets in (see _shared/freischaltung.ts), and here, WHAT a
// visitor gets to see. One line of SQL opens or closes the site, with
// nothing to upload:
//
//   update public.app_config set open_to_public = false where id = 1;   -- close
//   update public.app_config set open_to_public = true  where id = 1;   -- open
//
// This screen is a FACADE, not a lock. Whoever bypasses it lands on the
// login and gets no further than that - the function only lets
// admin_wallet and test_wallet through, and the server decides that. So
// the button is allowed to sit there openly, and that's also why the next
// decision goes the right way:
//
// If the query fails, access is NOT blocked. A network error would
// otherwise show "Launching soon" even though the site has long been
// open - and that's the kind of bug nobody reports, because it looks
// intentional. Going the other way costs nothing: whoever then reaches
// the login and isn't allowed in gets rejected by the server instead.
const TEAM_ZUGANG = 'size_team';

/** Has anyone here ever tapped "Team access"? */
function teamFrei() {
  try { return localStorage.getItem(TEAM_ZUGANG) === '1'; } catch { return false; }
}

// How long to wait for the response before treating the site as open.
//
// The existence of this number isn't polish. Without it, the entire
// startup hangs off a single request: if no response comes back - a dead
// zone, a hotel wifi with a login page in front of it, an outage at
// Supabase - boot() would wait forever, and the visitor would NEVER see
// anything. No login, no curtain, just black.
//
// This wasn't found by thinking about it, it was found by two test runs:
// in both, the URL pointed at nothing, and in both, the site stayed empty
// forever afterward. The exact same sequence as a dead zone.
const TO_QUERY_MS = 2500;

async function pageIsClosed() {
  // Whoever has a session, or knows the button, never sees this screen.
  if (state.jwt || teamFrei()) return false;
  try {
    const db = state.db ?? makeClient();
    const pollQuestion = db.from('app_config').select('open_to_public').eq('id', 1).single()
      .then(({ data }) => data?.open_to_public === false);
    // Open when in doubt - the reasoning is above TEAM_ZUGANG.
    const geduld = new Promise((r) => setTimeout(() => r(false), TO_QUERY_MS));
    return await Promise.race([pollQuestion, geduld]);
  } catch {
    return false;
  }
}

function showSoon() {
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#soon').hidden = false;
}

$('#btn-team').addEventListener('click', () => {
  // Remembered, so you don't have to type it again on every load while
  // building.
  try { localStorage.setItem(TEAM_ZUGANG, '1'); } catch { /* doesn't matter */ }
  $('#soon').hidden = true;
  showLogin();
  maybeShowInstallStep();
});

(async function boot() {
  if (await pageIsClosed()) { showSoon(); return; }
  if (!state.jwt) { showLogin(); maybeShowInstallStep(); return; }

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
      write(TOKEN_KEY, r.token);
      state.me = r.profile;
    } catch (e) {
      // On a 401 the session is definitively over; otherwise just carry on.
      if (/expired|too old|Not verified/i.test(e.message)) { logout(); return; }
      console.warn('[session] renewal failed, continuing:', e.message);
    }
  }

  try {
    await enterApp();
  } catch (e) {
    console.error('[start] failed:', e.message);
    if (/JWT|token|expired/i.test(e.message)) { logout(); return; }
    // No forced logout: this could just as easily be a brief outage.
    showLogin();
    maybeShowInstallStep();
    $('#login-error').textContent =
      'Could not load. Check your connection and reload the page.';
    $('#login-error').hidden = false;
  }
})();
