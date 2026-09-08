/**
 * The page X reads when someone shares a poll link.
 *
 * Two things make this function necessary, and neither can be worked
 * around:
 *
 * 1. The hash isn't enough. With "sized.gg/#poll-12", everything from the #
 *    onward is never sent to a server - that's not a setting, that's the
 *    definition of a fragment. To X, every poll would look the same,
 *    because they'd all have the same address. The link therefore has to
 *    read "sized.gg/p/12", with the number in the path.
 *
 * 2. X's crawler doesn't run JavaScript. It loads the address, reads the
 *    meta tags in the head, and it's done. But the app only draws its UI
 *    in the browser - the crawler would see an empty page. So this
 *    function serves it its own, tiny page that contains nothing but what
 *    it needs.
 *
 * Humans never get this page at all: they're sent on with a real HTTP
 * redirect to /#poll-12, where the app takes over. Why that's necessary is
 * explained below, at the crawler check.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY WITHOUT IMPORTS FROM ../_shared/
 *
 * Every other function here shares common.ts. This one doesn't, and that's
 * not an oversight: it has to be pastable as a single file into the
 * dashboard's editor, without needing a CLI for that. The price is the
 * twenty lines below that already exist elsewhere. Whoever changes them has
 * to keep both in sync - in exchange, this can be deployed without
 * installing anything.
 * ---------------------------------------------------------------------------
 *
 * Deploy via the CLI if available - WITHOUT JWT verification, the crawler
 * doesn't carry a token:
 *   supabase functions deploy og --no-verify-jwt
 *
 * Or in the dashboard: Edge Functions -> Deploy a new function -> name
 * "og", paste this content, uncheck "Verify JWT".
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Service role: bypasses RLS. That's correct here, because the crawler has
// no token - and the function only ever hands out things that are public
// anyway: question, vote count, total.
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Where the card left to, and where the fallback image comes from. */
const PAGE = (Deno.env.get('SITE_URL') ?? 'https://sized.gg').replace(/\/+$/, '');

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * The version of the card image.
 *
 * MUST match CARD_VERSION in public/app.js. That's where the file gets
 * written, this is where it gets looked up - if the two numbers drift
 * apart, every link shows the fallback card.
 *
 * It gets bumped when the card's appearance changes: images are written
 * only once, so a new number is the only way to make existing polls redraw
 * their card.
 */
const CARD_VERSION = 10;

/**
 * The page for the crawler.
 *
 * twitter:card = summary_large_image is the kind that shows the image
 * large above the title and makes the whole thing clickable - exactly the
 * look wanted here. Without this line X builds a small tile with a
 * thumbnail next to it instead.
 *
 * og:image:width/height are included so X can lay out the tile correctly
 * before the image even loads; without them the timeline jumps when it
 * loads in. The values are fixed because the card image is a fixed
 * 1600 x 838 - i.e. 1.91:1, exactly the ratio X crops a link card to
 * anyway. A taller image would lose a strip top and bottom, and the frame
 * would be the first thing to go.
 *
 * 1600 px and not 3200: PNG rasterizes the glow in the background with
 * noise that quadruples at double the resolution - 1.5 MB versus 400 KB,
 * with no visible difference. X displays a tile at around 600 px wide
 * anyway.
 */
/*
 * The title MUST be present.
 *
 * Tried leaving it out once - since the new tile layout, X draws it as a
 * black box in the bottom left INTO the image, where it covers the card's
 * footer. But without a title, X doesn't build a tile at all, it just
 * shows the bare link. The title is mandatory, not decoration.
 *
 * The box is instead accounted for in the image: the card image leaves a
 * strip free at the bottom (see drawPoll, fuerKarte). The box lands
 * there on empty ground and covers nothing.
 */
function page(opts: { id: number; titel: string; beschreibung: string; bild: string }) {
  const ziel = `${PAGE}/#poll-${opts.id}`;
  return `<!doctype html>
<html long="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.titel)} · SIZED</title>
<link rel="canonical" href="${esc(`${PAGE}/p/${opts.id}`)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="SIZED">
<meta property="og:url" content="${esc(`${PAGE}/p/${opts.id}`)}">
<meta property="og:title" content="${esc(opts.titel)}">
<meta property="og:description" content="${esc(opts.beschreibung)}">
<meta property="og:image" content="${esc(opts.bild)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1600">
<meta property="og:image:height" content="838">
<meta property="og:image:alt" content="${esc(opts.titel)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@sizedgg">
<meta name="twitter:title" content="${esc(opts.titel)}">
<meta name="twitter:description" content="${esc(opts.beschreibung)}">
<meta name="twitter:image" content="${esc(opts.bild)}">

<!-- For humans: straight on into the app. The crawler doesn't follow
     this, it's already read everything it needs above. The noscript
     refresh is the fallback for JavaScript being disabled. -->
<noscript><meta http-equiv="refresh" content="0; url=${esc(ziel)}"></noscript>
<script>location.replace(${JSON.stringify(ziel)});</script>
<style>
  body { margin:0; background:#0a0b0f; color:#5d657a; font:15px/1.5 system-ui, sans-serif;
         display:grid; place-items:center; height:100vh; }
</style>
</head>
<body><p>Opening ${esc(opts.titel)} on sized.gg&hellip;</p></body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // The path arrives as /og/p/12 (Supabase prepends the function name).
  // Through the Netlify proxy, /p/12 lands right here.
  const treffer = /\/p\/(\d+)/.exec(url.pathname);

  const header = {
    'content-type': 'text/html; charset=utf-8',
    // Five minutes at the edge, so a burst of clicks after a post doesn't
    // hit the database every single time. Not longer than that: if Ansem
    // changes the question, the card shouldn't keep showing the old one
    // for days.
    'cache-control': 'public, max-age=60, s-maxage=300',
  };

  if (!treffer) {
    return new Response(
      `<!doctype html><meta http-equiv="refresh" content="0; url=${PAGE}/">`,
      { status: 302, headers: { ...header, location: `${PAGE}/` } },
    );
  }

  const id = Number(treffer[1]);
  const ersatz = `${PAGE}/og-karte.png`;
  const ziel = `${PAGE}/#poll-${id}`;

  // Humans get a real redirect, crawlers get the page with the meta tags.
  //
  // The reason is Netlify. The page gets proxied through sized.gg/p/12,
  // and Netlify defangs HTML that comes from a foreign server: it serves
  // it as text/plain with "default-src 'none'; sandbox". That's
  // intentional and can't be turned off - otherwise anyone who points a
  // redirect at their domain could run foreign HTML there.
  //
  // For the crawler that doesn't matter, it reads the text and finds the
  // meta tags regardless. For a browser it's fatal: it shows source code
  // instead of a page, and the embedded location.replace never runs.
  //
  // A redirect has no content to defang. It passes through unchanged.
  //
  // What's detected is the crawler, not the browser - when in doubt, we
  // redirect.
  //
  // Both mistakes are possible, but they cost different things. If we
  // mistake a browser for a crawler, a human sees source code - broken. If
  // we mistake a crawler for a browser, it follows the redirect, lands on
  // the app and reads its generic meta tags: it then shows the SIZED card
  // instead of the poll. Ugly, but not broken.
  //
  // So the decision falls this way round: only whoever identifies as a bot
  // gets HTML. No browser carries "bot" in its name; Discordbot and its
  // like do.
  //
  // curl is deliberately NOT on the list - to check the meta tags:
  //   curl -sI -A Twitterbot https://sized.gg/p/16
  const ua = req.headers.get('user-agent') ?? '';
  const istCrawler = /bot|crawler|spider|preview|facebookexternalhit|slack|discord|telegram|whatsapp|embedly|quora|pinterest|vkshare|skype|applebot|bluesky|mastodon|twitter|linkedin|iframely|validator/i
    .test(ua);

  if (!istCrawler) {
    return new Response(null, {
      status: 302,
      headers: {
        location: ziel,
        // Cache briefly, but not for long: should the detection ever be
        // wrong, an error shouldn't linger for days.
        'cache-control': 'public, max-age=60',
      },
    });
  }

  // The image check only needs the number, and that's already in the
  // address. So it's fired off here and only picked up much further down.
  //
  // It used to sit at the end and wait on things it doesn't need: first
  // poll and config, then the numbers, then the image. Four round trips in
  // a row, even though the fourth doesn't depend on the first three. For a
  // human that wouldn't matter - here X's crawler is waiting on it, and
  // during that time it decides whether to build a tile or leave the bare
  // link standing.
  //
  // Costs one wasted request in the rare case: if the poll has been
  // deleted, the image check was for nothing. A HEAD request against a
  // public bucket is cheaper than a wait for everyone else.
  const bildAdresse = `${Deno.env.get('SUPABASE_URL')}`
    + `/storage/v1/object/public/og/poll-${id}-v${CARD_VERSION}.png`;
  // Number 0 is the cron job's warm-up call, every two minutes. Excluding
  // it here doesn't save time - nobody cares about timing on a warm-up
  // call - it saves the log: otherwise there'd be 21,000 warnings a month
  // about an image that was never supposed to exist, and real warnings
  // would get lost in them.
  const bildProbe = id > 0
    ? fetch(bildAdresse, { method: 'HEAD' })
        .then((r) => {
          if (!r.ok) console.warn(`[og] Kein Bild für Abstimmung ${id} (${r.status})`);
          return r.ok;
        })
        .catch((e) => {
          console.warn(`[og] Bild für Abstimmung ${id} nicht prüfbar:`, e);
          return false;
        })
    : Promise.resolve(false);

  try {
    // All three queries at once, not two and then one.
    //
    // The numbers used to depend on the option ids from the first query
    // (`in (...)`) and therefore had to wait. They don't have to: the
    // poll_results view carries poll_id itself, and that's already in the
    // address. Two round trips in sequence become one - and it's exactly
    // during this time that X's crawler decides whether to build a tile or
    // leave the bare link standing.
    const [{ data: poll }, { data: cfg }, { data: ergebnisse }] = await Promise.all([
      db.from('polls').select('id, question, closed, closes_at')
        .eq('id', id).maybeSingle(),
      db.from('app_config').select('symbol').eq('id', 1).maybeSingle(),
      db.from('poll_results').select('votes, usd').eq('poll_id', id),
    ]);

    const symbol = cfg?.symbol ?? 'ANSEM';

    if (!poll) {
      // Deleted, or never existed. No error page: whoever clicks the link
      // should land in the app and get the honest message there, instead
      // of standing here in a dead end.
      return new Response(page({
        id,
        titel: 'This poll is gone',
        beschreibung: `Community votes weighted by $${symbol} holdings.`,
        bild: ersatz,
      }), { status: 200, headers: header });
    }

    const stimmen = (ergebnisse ?? []).reduce((a, r) => a + Number(r.votes ?? 0), 0);
    const usd = (ergebnisse ?? []).reduce((a, r) => a + Number(r.usd ?? 0), 0);
    const zu = poll.closed || (poll.closes_at && new Date(poll.closes_at) < new Date());

    // No more "N votes", just the amount.
    //
    // The vote count was the one figure that was cheap to fake: splitting
    // 100k across ten wallets doesn't change the amount, but turns one
    // vote into ten. The amount, by contrast, is tied to the holding -
    // the same tokens can't count twice.
    //
    // It's still counted here regardless: it decides whether anyone has
    // voted at all yet, and that's a different sentence.
    const beschreibung = stimmen === 0
      ? `Hold $${symbol} to vote. Your weight is your balance.`
      : `$${nf.format(Math.round(usd))} in $${symbol}` + (zu ? ' · closed' : '');

    // The image lives in the public bucket and is put there by Ansem's
    // browser: when the poll is created, and again when he downloads it.
    // The name is fixed so the address is predictable - X caches it for
    // days anyway, so a changing name would bring nothing but cold caches.
    //
    // It's still checked whether it's really there: polls from before this
    // function existed don't have one, and a tile with a broken image icon
    // looks like the whole site is down. The check was fired off way up
    // top; here it's just picked up, having long been in flight.
    // The image check is awaited - but not indefinitely.
    //
    // It's a courtesy toward old polls without a card. If storage happens
    // to be slow, it would be the opposite of that: the crawler would hang
    // on a question whose answer is almost always "yes".
    //
    // So after 400 ms, "yes" is assumed. The mistake costs a tile with a
    // broken image icon on an old poll; waiting costs the tile on every
    // single one.
    const bildDa = await Promise.race([
      bildProbe,
      new Promise<boolean>((r) => setTimeout(() => r(true), 400)),
    ]);
    const bild = bildDa ? bildAdresse : ersatz;

    return new Response(page({ id, titel: poll.question, beschreibung, bild }),
      { status: 200, headers: header });
  } catch (err) {
    console.error('[og] Abstimmung nicht lesbar:', err);
    // A valid page even on error: a 500 would show up on X as a broken
    // link, even though the poll itself is fine.
    return new Response(page({
      id,
      titel: 'SIZED',
      beschreibung: 'Community votes weighted by holdings.',
      bild: ersatz,
    }), { status: 200, headers: header });
  }
});
