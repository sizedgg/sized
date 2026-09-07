/**
 * Images of the UI at real phone sizes - without a backend.
 *
 * Otherwise the app needs a paid verification, a database, and Realtime
 * just to show anything at all. None of that is needed for the question
 * "does this look and work well on a phone?": the same HTML structure
 * that app.js produces is inserted here and then photographed.
 *
 * Two things are also measured that are easy to miss in images:
 *   * horizontal overflow (the page can be scrolled sideways)
 *   * tap targets that are too small (thumbs need ~44 px)
 *
 *   node scripts/preview-mobile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// ---------------------------------------------------------------------------
// The polls come VERBATIM from app.js
// ---------------------------------------------------------------------------
//
// A hand-written imitation used to stand here: "191 votes", a blue bar on
// an OPEN poll, a column of vote counts. None of that still existed in
// the app at that point - the percentage figures were removed, so was
// the vote count, and blue only appears once a poll has closed.
//
// So we would have been looking at images of a UI that doesn't exist and
// making decisions based on it. That's why pollHtml() is now cut out of
// app.js character for character and run here.
const appJsSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const cutApp = (von, bis) => {
  const a = appJsSource.indexOf(von);
  const b = appJsSource.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJsSource.slice(a, b);
};
const POLL_CODE = [
  cutApp('const esc = (s) =>', '\n\n'),
  cutApp('const nfGanz =', 'const wholeNumber'),
  cutApp('const wholeNumber =', '\n'),
  cutApp('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;'),
  cutApp('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;'),
  cutApp('const BALD_MS =', 'let fristT = null;'),
  cutApp('const leadingShare =', '\nasync function drawPoll'),
  cutApp('function pollHtml(p) {', 'async function deletePoll(id) {'),
].join('\n');

// The same shape loadPolls() builds from the database.
const POLL_DATEN = [
  { id: 1, closed: false, myOptionId: 1, totalUsd: 781420,
    closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
    question: 'Should we open the token gate to smaller holders?',
    options: [
      { id: 1, label: 'Ship it this week', usd: 482900, share: 0.618 },
      { id: 2, label: 'Wait for the audit', usd: 210400, share: 0.269 },
      { id: 3, label: 'Do neither and keep building quietly', usd: 88120, share: 0.113 },
    ] },
  { id: 2, closed: true, myOptionId: null, totalUsd: 310000, closesAt: null,
    question: 'Next AMA time?',
    options: [
      { id: 4, label: 'Friday 8pm ET', usd: 220100, share: 0.71 },
      { id: 5, label: 'Sunday 2pm ET', usd: 89900, share: 0.29 },
    ] },
];


const outDir = path.join(root, 'preview');
fs.mkdirSync(outDir, { recursive: true });

// Real devices, deliberately including a small old phone: whoever works
// fine on that works fine everywhere.
//
// Color trial: with ACCENT=#eceff5 only the desktop is rendered, but with
// the accent color swapped out and a prefix on the filename. That way a
// color decision can be made on the finished image instead of on a color
// swatch - and the normal preview images don't get overwritten in the
// process.
//
//   ACCENT='#eceff5' ACCENT_NAME=weiss node scripts/preview-mobile.mjs
const ACCENT = process.env.ACCENT || null;
const ACCENT_NAME = process.env.ACCENT_NAME || 'accent';
// Free-form trial: arbitrary CSS layered on top, otherwise the same
// mechanism as ACCENT. That way an alternative can be compared on the
// finished image without touching the stylesheet and having to revert
// it again.
//
//   PROBE_CSS='.msg .body { color: var(--dim); }' PROBE_NAME=heller \
//     node scripts/preview-mobile.mjs
const PROBE_CSS = process.env.PROBE_CSS || null;
const PROBE_NAME = process.env.PROBE_NAME || 'probe';

const ALL_DEVICES = [
  { name: 'iphone-se', width: 375, height: 667, dpr: 2 },
  { name: 'iphone-15', width: 393, height: 852, dpr: 3 },
  { name: 'pixel-8', width: 412, height: 915, dpr: 2.6 },
  { name: 'ipad-mini', width: 744, height: 1133, dpr: 2 },
  // Desktop belongs in the lineup too: changes made for the phone must
  // not break the two-column view there.
  { name: 'desktop', width: 1280, height: 900, dpr: 1 },
];

const DEVICES = (ACCENT || PROBE_CSS)
  ? ALL_DEVICES.filter((g) => g.name === 'desktop')
  : ALL_DEVICES;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// app.js is deliberately NOT loaded - it would call Supabase right away.
// gateText() verbatim from app.js - not typed out by hand.
//
// The gate message used to sit here as a string literal in the script,
// and when the sentence in app.js got shorter, the preview kept showing
// the old version. A preview that shows something different from the
// page is worse than none: you look at it, decide it's fine, and the
// page says something else.
const gateTextSource = (() => {
  const a = appJsSource.indexOf('function gateText(min, was) {');
  const b = appJsSource.indexOf('\n}', a);
  if (a < 0 || b < 0) throw new Error('gateText steht nicht mehr so in app.js');
  return appJsSource.slice(a, b + 2);
})();

const server = http.createServer((req, res) => {
  const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const abs = path.join(root, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(path.join(root, 'public')) || !fs.existsSync(abs)) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  // app.js is deliberately replaced with an empty file: this preview
  // sets its own states via fixtures, and the real app would otherwise
  // try to log in and load data.
  //
  // The price is that NO JavaScript errors can show up here - the app
  // isn't actually running. test-pwa.mjs is responsible for that, since
  // it loads the page for real.
  if (file === '/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* im Vorschaumodus aus */');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Sample content - as realistic as possible, including the unpleasant
// cases: very long words, large numbers, many messages.
// ---------------------------------------------------------------------------

const FIXTURE = `
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  // For everyone except Ansem, the three characters sit top right in
  // their own color - the same identifier as in the DMs. Exactly the
  // shape renderMe() builds.
  document.querySelector('#me-handle').outerHTML =
    '<span id="me-handle" class="handle h t0">7xK</span>';
  document.querySelector('#me-holdings').textContent = '$5,208';
  document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';

  // The polls from the real pollHtml() - see POLL_CODE above.
  const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false, usd: 3 } };
  ${POLL_CODE}
  document.querySelector('#poll-list').innerHTML =
    ${JSON.stringify(POLL_DATEN)}.map(pollHtml).join('');

  const dms = [
    ['sep', 'Aug 21', ''],
    ['', 'Hey Ansem, quick question about the vesting schedule', '14:01'],
    ['mine', 'What about it', '14:03'],
    ['sep', 'Today', ''],
    ['', 'Is the unlock linear or cliff based? I have been trying to work this out from the docs and cannot tell', '14:04'],
  ];
  document.querySelector('#dm-thread').innerHTML = dms.map(([cls, b, t]) =>
    cls === 'sep'
      ? \`<div class="day-sep"><span>\${b}</span></div>\`
      : \`<div class="dm-row \${cls}" data-id="1"><div class="msg dm \${cls}"><span class="body">\${b}</span>
         <span class="meta"><span class="time">\${t}</span></span></div>
         <button class="reply-btn" type="button" data-dm-reply="1">\u21A9</button></div>\`).join('');
`;

const ADMIN_FIXTURE = `
  document.querySelector('#dm-user').hidden = true;
  document.querySelector('#dm-admin').hidden = false;
  document.querySelector('#poll-admin').hidden = false;
  // A third answer field, so "[optional]" also shows up in the image -
  // the first two are required and don't carry it.
  document.querySelector('#poll-options').insertAdjacentHTML('beforeend',
    '<input class="poll-option" type="text" placeholder="Option 3 [optional]">');
  // Ansem also sees the delete button in every poll. The second one gets
  // it armed, so both states appear in the image.
  document.querySelectorAll('.poll-tools').forEach((w, i) => {
    w.insertAdjacentHTML('beforeend',
      '<button class="icon-btn poll-delete" title="Delete this poll">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.5h5v2"/>'
      + '<path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>'
      + '<path d="M10.5 10v6"/><path d="M13.5 10v6"/></svg></button>');
    // For the second one, the checkmark already stands in for the trash
    // can - that way the image shows both states side by side.
    if (i === 1) w.querySelector('.poll-delete').innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
      + 'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M4.5 12.5l5 5 10-11"/></svg>';
  });

  // Ansem's header: in place of the address, his avatar sits there
  // (the stylesheet applies that via .admin-name), the amount next to it
  // like everyone else.
  // His avatar for him, everyone else's own address for them. The hint
  // next to it needs a cursor and is therefore never visible on a
  // phone - a screen reader gets it via aria-describedby.
  document.querySelector('#me-handle').outerHTML =
    '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
    + '<span class="kuerzel">4bo</span></span>';
  document.querySelector('#me-holdings').textContent = '$14,204,880';
  // Only Ansem sees "DMs" - for everyone else the "s" stays invisible.
  document.querySelector('[data-tab="dms"]').classList.add('zeigt-s');

  const threads = [
    ['zQ4', 0, '$31,500', 'I sold half my bag last week and…', 0],
    ['bH2', 1, '$8,820', 'Is the unlock linear or cliff based?', 0],
    ['Km9', 3, '$1,302', 'will cover it in the next poll', 1],
    ['Km9', 2, '$3', 'checking', 1],
  ];
  document.querySelector('#thread-items').innerHTML = threads.map(([h, tone, w, p, u]) =>
    \`<button class="thread \${u ? 'is-unread' : ''} \${h === 'bH2' ? 'is-active' : ''}">
      <span class="h t\${tone}">\${h}</span>
      <span class="thread-prev">\${p}</span>
      <span class="w">\${w}</span>
    </button>\`).join('');
  document.querySelector('#thread-title').innerHTML =
    '<strong class="h t1">bH2</strong>' +
    '<span class="addr dim">bH2kQ9vX1mNpL4rT7wYzA3cF6hJ8dS2gB5nM0qE</span>';
  document.querySelector('#admin-thread').innerHTML =
    document.querySelector('#dm-thread').innerHTML;
  // A reply with a quote, the way it looks after the DM-reply migration.
  document.querySelector('#admin-thread').insertAdjacentHTML('beforeend', \`
    <div class="dm-row mine is-active" data-id="9">
      <div class="msg dm mine has-quote">
        <button class="quote" type="button" data-dm-goto="8">
          <span class="quote-body">Is the unlock linear or cliff based?</span>
        </button>
        <span class="body">Cliff, then linear over 18 months.</span>
        <span class="meta"><span class="time">14:06</span></span>
      </div>
      <button class="reply-btn" type="button" data-dm-reply="9">\u21A9</button>
    </div>\`);
  document.querySelector('#admin-reply-bar').hidden = false;
  document.querySelector('#admin-reply-bar-text').textContent = 'Is the unlock linear or cliff based?';
  document.querySelector('#admin-dm-form').hidden = false;
  // Ansem's control for the DM threshold. In real operation, renderDmMin
  // shows it as soon as the column exists in app_config.
  document.querySelector('#dm-min-box').hidden = false;
  document.querySelector('#dm-min-input').value = '10';
  document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';
`;

// ---------------------------------------------------------------------------
// Measurements that are easy to miss on an image
// ---------------------------------------------------------------------------

const AUDIT = `((istHandy) => {
  const problems = [];

  // 1. Horizontal overflow: the page must not be scrollable sideways.
  //    On a phone this is the most conspicuous bug there is.
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > de.clientWidth + 1 || r.left < -1;
    }).slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect();
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
        + (el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
        + \` [\${Math.round(r.left)}..\${Math.round(r.right)}]\`;
    });
    problems.push({
      kind: 'ueberlauf',
      detail: \`Seite \${de.scrollWidth}px wide bei \${de.clientWidth}px Fenster\`,
      culprits: wide,
    });
  }

  // Tap targets and minimum font sizes are phone rules. Different ones
  // apply on desktop with a mouse, and measuring against them there just
  // creates noise.
  if (!istHandy) return problems;

  // 2. Tap targets. Apple and Google both name around 44 px as the
  //    minimum size.
  //
  // What's measured isn't the box, but what the thumb actually hits.
  // That's not the same thing: an absolutely positioned ::before with a
  // negative inset enlarges the hit area without touching the layout -
  // exactly what you want for a button that sits on the same line as a
  // heading and therefore can't grow. Reading only
  // getBoundingClientRect() reports the button as too small even though
  // it's comfortable to hit.
  //
  // document.elementFromPoint resolves a pseudo-element to its element,
  // so probing above and below the center reveals the real height.
  const MIN = 44;
  const small = [];
  const trifft = (el, x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t));
  };
  for (const el of document.querySelectorAll('button, a, input, [role=button]')) {
    if (el.closest('[hidden]') || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Whatever isn't clickable isn't a tap target either. Applies to
    // buttons that only become active on hover or tap.
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (r.height >= MIN - 0.5) continue;

    // Probe outward from the center, up and down, at most to MIN - nobody
    // needs to know more, and the step would otherwise cost time on
    // every page.
    const mx = Math.round(r.left + r.width / 2);
    const my = Math.round(r.top + r.height / 2);
    let peek = 0;
    let bottom = 0;
    while (peek < MIN && trifft(el, mx, my - peek - 1)) peek += 1;
    while (bottom < MIN && trifft(el, mx, my + bottom + 1)) bottom += 1;
    const treffer = peek + bottom + 1;
    if (treffer < MIN - 0.5) {
      small.push({
        el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
            + (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
        text: (el.textContent || el.placeholder || '').trim().slice(0, 24),
        h: Math.round(r.height),
        treffer,
      });
    }
  }
  if (small.length) problems.push({ kind: 'tippziel', detail: \`\${small.length} under \${MIN}px\`, culprits: small });

  // 3. Font sizes under 11px are barely readable on a phone. Secondary
  //    details like timestamps may stay small - body text may not.
  const tiny = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent.trim() || el.children.length) continue;
    // Don't count invisible elements - otherwise every screen would
    // report the font sizes of the hidden login and the list becomes
    // worthless.
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) tiny.add(\`\${el.className || el.tagName.toLowerCase()} (\${fs.toFixed(1)}px)\`);
  }
  if (tiny.size) problems.push({ kind: 'font', detail: \`\${tiny.size} Stellen under 11px\`, culprits: [...tiny].slice(0, 8) });

  return problems;
})`;

// ---------------------------------------------------------------------------

// The preinstalled Chromium lives at a fixed location; otherwise
// Playwright looks for a version that doesn't exist here.
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
let issues = 0;

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.width < 700,
    hasTouch: d.width < 700,
  });
  const page = await ctx.newPage();

  const views = [
    ['login', ''],
    ['install-ios', ''],
    ['install-android', ''],
    ['polls', FIXTURE + `document.querySelector('#pane-polls').hidden = false;`],
    ['dms', FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;`],
    // Not holding enough to message Ansem.
    ['dms-gated', FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;
       document.querySelector('#dm-form').classList.add('locked');
       document.querySelector('#dm-gate').hidden = false;
       // esc and state already come from FIXTURE - only what's missing goes here.
       ${gateTextSource}
       const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
       document.querySelector('#dm-gate-text').innerHTML =
         gateText(10, 'to message Ansem');`],
    ['polls-ansem', FIXTURE + ADMIN_FIXTURE + `document.querySelector('#pane-polls').hidden = false;`],
    // The expanded creation box. It earns its own image since the
    // duration fields moved into it: three select fields side by side
    // are the tightest spot on the whole page at 375 px, and collapsed
    // you don't see any of that.
    ['polls-ansem-offen', FIXTURE + ADMIN_FIXTURE + `
       document.querySelector('#pane-polls').hidden = false;
       document.querySelector('#poll-admin').classList.add('offen');
       document.querySelector('#poll-admin-felder').hidden = false;`],
    ['dms-ansem-inbox', FIXTURE + ADMIN_FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;`],
    // The open thread: on a phone it replaces the list, on desktop it
    // sits next to it. Both states belong in the image.
    ['dms-ansem-thread', FIXTURE + ADMIN_FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;
       document.querySelector('#dm-admin').classList.add('viewing');`],
  ];

  for (const [view, fixture] of views) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });

    // The accent color is only overridden, not changed in the
    // stylesheet - the trial shouldn't leave anything behind. Ansem's
    // name gets gold in the process: today it's tied to the accent, and
    // with a neutral accent the most eye-catching element would turn
    // into ordinary text. Gold is already reserved for him in the color
    // comment anyway.
    if (ACCENT) {
      // Also set --accent-rgb, otherwise every semi-transparent spot
      // would stay green: your own DM bubble, the flash highlight, the
      // poll bar.
      const channels = ACCENT.replace('#', '').match(/../g)
        .map((h) => parseInt(h, 16)).join(', ');
      await page.addStyleTag({ content:
        `:root { --accent: ${ACCENT}; --accent-rgb: ${channels}; }\n` +
        `.admin-name { color: var(--accent); }` });
    }
    if (PROBE_CSS) await page.addStyleTag({ content: PROBE_CSS });
    if (view.startsWith('install-')) {
      await page.evaluate(`
        document.querySelector('#step-address').hidden = true;
        document.querySelector('#step-install').hidden = false;
        document.querySelector('#ios-steps').hidden = ${view === 'install-android'};
        document.querySelector('#btn-install').hidden = ${view === 'install-ios'};
      `);
    } else if (view === 'login') {
      // The payment step is the screen where people really get stuck.
      await page.evaluate(`
        document.querySelector('#step-address').hidden = true;
        document.querySelector('#step-pay').hidden = false;
        document.querySelector('#pay-amount').textContent = '0.020847 SOL';
        document.querySelector('#pay-treasury').textContent = 'AnsQ7vX1mNpL4rT7wYzA3cF6hJ8dS2gB5nM0qE9Kv';
        document.querySelector('#pay-timer').textContent = '24:12 left';
      `);
    } else {
      await page.evaluate(fixture);
    }
    await page.waitForTimeout(120);

    const file = path.join(outDir,
      ACCENT ? `farbprobe-${ACCENT_NAME}-${view}.png`
      : PROBE_CSS ? `probe-${PROBE_NAME}-${view}.png`
      : `${d.name}-${view}.png`);
    await page.screenshot({ path: file });

    const problems = await page.evaluate(`${AUDIT}(${d.width < 900})`);
    if (problems.length) {
      issues += problems.length;
      console.log(`\n  ${d.name} / ${view}`);
      for (const p of problems) {
        console.log(`    ${p.kind}: ${p.detail}`);
        for (const c of p.culprits) {
          console.log(`      - ${typeof c === 'string' ? c
            : `${c.el} "${c.text}" ${c.h}px`
              // If the hit area is larger than the box, both belong in
              // the report: otherwise you'd look for the bug in the
              // layout when it's actually in the hit area (or the other
              // way around).
              + (c.treffer !== undefined && c.treffer !== c.h
                ? ` (Trefferflaeche ${c.treffer}px)` : '')}`);
        }
      }
    }
  }
  await ctx.close();
}

await browser.close();
server.close();

console.log(issues
  ? `\n  ${issues} Befund(e). Bilder in preview/\n`
  : '\n  Keine Befunde. Bilder in preview/\n');
