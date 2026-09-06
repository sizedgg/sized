/**
 * Die Seite, die X unter einem geteilten Abstimmungslink liest.
 *
 * Zwei Dinge machen diese Function nötig, und beide sind nicht zu umgehen:
 *
 * 1. Die Raute reicht nicht. Bei "sized.gg/#poll-12" wird alles ab dem #
 *    niemals an einen Server geschickt – das ist keine Einstellung, das ist
 *    die Definition eines Fragments. Für X sähen alle Abstimmungen gleich
 *    aus, weil sie dieselbe Adresse hätten. Der Link muss deshalb
 *    "sized.gg/p/12" lauten, mit der Nummer im Pfad.
 *
 * 2. Xs Crawler führt kein JavaScript aus. Er lädt die Adresse, liest die
 *    Meta-Zeilen im Kopf und ist fertig. Die App zeichnet ihre Oberfläche
 *    aber erst im Browser – der Crawler sähe eine leere Seite. Also liefert
 *    diese Function ihm eine eigene, winzige Seite, in der nichts steht außer
 *    dem, was er braucht.
 *
 * Menschen bekommen diese Seite gar nicht erst: Sie werden mit einer echten
 * HTTP-Weiterleitung auf /#poll-12 geschickt, wo die App übernimmt. Warum das
 * nötig ist, steht unten am Crawler-Test.
 *
 * ---------------------------------------------------------------------------
 * BEWUSST OHNE IMPORTE AUS ../_shared/
 *
 * Alle anderen Functions hier teilen sich common.ts. Diese nicht, und das ist
 * kein Versehen: Sie muss sich als eine einzige Datei in den Editor des
 * Dashboards einfügen lassen, ohne dass man dafür einen CLI braucht. Der Preis
 * sind die zwanzig Zeilen unten, die es woanders schon gibt. Wer sie ändert,
 * muss dort mitziehen – dafür kann man sie ausrollen, ohne etwas zu
 * installieren.
 * ---------------------------------------------------------------------------
 *
 * Ausrollen über den CLI, falls vorhanden – OHNE JWT-Prüfung, der Crawler
 * bringt kein Token mit:
 *   supabase functions deploy og --no-verify-jwt
 *
 * Oder im Dashboard: Edge Functions → Deploy a new function → Name "og",
 * diesen Inhalt einfügen, den Haken bei "Verify JWT" abwählen.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Service-Role: umgeht RLS. Das ist hier richtig, weil der Crawler kein Token
// hat – und die Function gibt nur Dinge heraus, die ohnehin öffentlich sind:
// Frage, Stimmenzahl, Summe.
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Wohin die Karte zeigt und woher das Ersatzbild kommt. */
const SEITE = (Deno.env.get('SITE_URL') ?? 'https://sized.gg').replace(/\/+$/, '');

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Die Fassung des Kartenbilds.
 *
 * MUSS mit KARTEN_VERSION in public/app.js übereinstimmen. Dort wird die Datei
 * geschrieben, hier wird sie gesucht – laufen die beiden Zahlen auseinander,
 * zeigt jeder Link die Ersatzkarte.
 *
 * Hochgezählt wird sie, wenn sich das Aussehen der Karte ändert: Die Bilder
 * werden nur einmal geschrieben, eine neue Nummer ist also der einzige Weg,
 * bestehende Abstimmungen neu zeichnen zu lassen.
 */
const KARTEN_VERSION = 9;

/**
 * Die Seite für den Crawler.
 *
 * twitter:card = summary_large_image ist die Sorte, die das Bild groß über
 * dem Titel zeigt und als Ganzes anklickbar ist – genau das gewünschte
 * Aussehen. Ohne diese Zeile macht X eine kleine Kachel mit Vorschaubild
 * links daneben.
 *
 * og:image:width/height stehen dabei, damit X die Kachel schon vor dem Laden
 * des Bildes richtig einrichtet; fehlen sie, springt die Zeitleiste beim
 * Nachladen. Die Werte sind fest, weil das Kartenbild fest 1600 × 838 ist –
 * also 1,91:1, genau das Verhältnis, auf das X eine Linkkarte ohnehin
 * zuschneidet. Ein höheres Bild verlöre oben und unten je einen Streifen, und
 * als Erstes fiele der Rahmen weg.
 *
 * 1600 px und nicht 3200: PNG rastert den Lichtschein im Grund mit einem
 * Rauschen, das sich bei doppelter Auflösung vervierfacht – 1,5 MB gegen
 * 400 KB, ohne sichtbaren Unterschied. X zeigt eine Kachel ohnehin rund 600 px
 * breit an.
 */
/*
 * Der Titel MUSS drinstehen.
 *
 * Einmal probiert, ihn wegzulassen – X zeichnet ihn seit der neuen
 * Kachelgestaltung als schwarzen Kasten unten links INS Bild, wo er die
 * Fusszeile der Karte verdeckt. Ohne Titel baut X aber gar keine Kachel mehr,
 * sondern zeigt den nackten Link. Der Titel ist Pflicht, nicht Zierde.
 *
 * Der Kasten ist stattdessen im Bild geloest: Das Kartenbild laesst unten
 * einen Streifen frei (siehe zeichnePoll, fuerKarte). Der Kasten landet dort
 * auf leerem Grund und verdeckt nichts.
 */
function seite(opts: { id: number; titel: string; beschreibung: string; bild: string }) {
  const ziel = `${SEITE}/#poll-${opts.id}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.titel)} · SIZED</title>
<link rel="canonical" href="${esc(`${SEITE}/p/${opts.id}`)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="SIZED">
<meta property="og:url" content="${esc(`${SEITE}/p/${opts.id}`)}">
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

<!-- Für Menschen: sofort weiter in die App. Der Crawler folgt dem nicht,
     er hat oben schon alles gelesen, was er braucht. Das noscript-Refresh
     ist der Rückfall für abgeschaltetes JavaScript. -->
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

  // Der Pfad kommt als /og/p/12 an (Supabase hängt den Funktionsnamen davor).
  // Über den Netlify-Proxy landet /p/12 genau hier.
  const treffer = /\/p\/(\d+)/.exec(url.pathname);

  const kopf = {
    'content-type': 'text/html; charset=utf-8',
    // Fünf Minuten am Rand, damit ein Schwall von Klicks nach einem Post nicht
    // jedes Mal die Datenbank fragt. Länger nicht: Ändert Ansem die Frage,
    // soll die Karte nicht tagelang die alte zeigen.
    'cache-control': 'public, max-age=60, s-maxage=300',
  };

  if (!treffer) {
    return new Response(
      `<!doctype html><meta http-equiv="refresh" content="0; url=${SEITE}/">`,
      { status: 302, headers: { ...kopf, location: `${SEITE}/` } },
    );
  }

  const id = Number(treffer[1]);
  const ersatz = `${SEITE}/og-karte.png`;
  const ziel = `${SEITE}/#poll-${id}`;

  // Menschen bekommen eine echte Weiterleitung, Crawler die Seite mit den
  // Meta-Zeilen.
  //
  // Der Grund ist Netlify. Die Seite wird über sized.gg/p/12 durchgereicht,
  // und Netlify entschaerft HTML, das von einem fremden Server kommt: Es
  // liefert es als text/plain mit "default-src 'none'; sandbox" aus. Das ist
  // Absicht und nicht abzustellen – sonst koennte jeder, der eine
  // Weiterleitung auf seine Domain legt, dort fremdes HTML ausfuehren lassen.
  //
  // Fuer den Crawler ist das egal, er liest den Text und findet die Meta-Zeilen
  // trotzdem. Fuer einen Browser ist es fatal: Er zeigt Quelltext statt einer
  // Seite, und das eingebettete location.replace laeuft nie.
  //
  // Eine Weiterleitung hat keinen Inhalt, den man entschaerfen koennte. Sie
  // geht unveraendert durch.
  //
  // Erkannt wird der Crawler, nicht der Browser – im Zweifel wird
  // weitergeleitet.
  //
  // Beide Irrtuemer sind moeglich, aber sie kosten Unterschiedliches. Halten
  // wir einen Browser faelschlich fuer einen Crawler, sieht ein Mensch
  // Quelltext – kaputt. Halten wir einen Crawler faelschlich fuer einen
  // Browser, folgt er der Weiterleitung, landet auf der App und liest deren
  // allgemeine Meta-Zeilen: Er zeigt dann die SIZED-Karte statt der
  // Abstimmung. Unschoen, aber nicht kaputt.
  //
  // Deshalb faellt die Entscheidung so herum: Nur wer sich als Bot zu erkennen
  // gibt, bekommt HTML. Kein Browser traegt "bot" im Namen; Discordbot und
  // Konsorten schon.
  //
  // curl steht bewusst NICHT auf der Liste – zum Pruefen der Meta-Zeilen:
  //   curl -sI -A Twitterbot https://sized.gg/p/16
  const ua = req.headers.get('user-agent') ?? '';
  const istCrawler = /bot|crawler|spider|preview|facebookexternalhit|slack|discord|telegram|whatsapp|embedly|quora|pinterest|vkshare|skype|applebot|bluesky|mastodon|twitter|linkedin|iframely|validator/i
    .test(ua);

  if (!istCrawler) {
    return new Response(null, {
      status: 302,
      headers: {
        location: ziel,
        // Kurz zwischenspeichern, aber nicht lange: Sollte die Erkennung
        // einmal danebenliegen, soll ein Fehler nicht tagelang haengen.
        'cache-control': 'public, max-age=60',
      },
    });
  }

  // Die Bildprüfung braucht nur die Nummer, und die steht schon in der
  // Adresse. Sie wird deshalb hier losgeschickt und erst ganz unten abgeholt.
  //
  // Vorher stand sie am Ende und wartete auf Dinge, von denen sie nichts
  // braucht: erst Abstimmung und Konfiguration, dann die Zahlen, dann das
  // Bild. Vier Wege nacheinander, obwohl der vierte vom ersten bis dritten
  // nicht abhängt. Für einen Menschen wäre das gleichgültig – hier wartet
  // Xs Crawler darauf, und der entscheidet in dieser Zeit, ob er eine Kachel
  // baut oder den nackten Link stehen lässt.
  //
  // Kostet im seltenen Fall eine überflüssige Anfrage: Wenn die Abstimmung
  // gelöscht ist, war die Bildprüfung umsonst. Eine HEAD-Anfrage auf einen
  // öffentlichen Eimer ist billiger als eine Wartezeit für alle anderen.
  const bildAdresse = `${Deno.env.get('SUPABASE_URL')}`
    + `/storage/v1/object/public/og/poll-${id}-v${KARTEN_VERSION}.png`;
  // Nummer 0 ist der Aufwaermruf des Cronjobs, alle zwei Minuten. Ihn hier
  // auszunehmen spart nicht die Zeit – die interessiert bei einem Aufwaermruf
  // niemanden –, sondern das Protokoll: Sonst stuenden dort 21.000
  // Warnungen im Monat ueber ein Bild, das es nie geben sollte, und echte
  // Warnungen gingen darin unter.
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
    // Alle drei Abfragen gleichzeitig, nicht zwei und danach eine.
    //
    // Die Zahlen hingen vorher an den Options-Nummern aus der ersten Abfrage
    // (`in (...)`) und mussten deshalb warten. Sie muessen es nicht: Die Sicht
    // poll_results traegt poll_id selbst, und die steht schon in der Adresse.
    // Aus zwei Wegen nacheinander wird einer – und genau in dieser Zeit
    // entscheidet Xs Crawler, ob er eine Kachel baut oder den nackten Link
    // stehen laesst.
    const [{ data: poll }, { data: cfg }, { data: ergebnisse }] = await Promise.all([
      db.from('polls').select('id, question, closed, closes_at')
        .eq('id', id).maybeSingle(),
      db.from('app_config').select('symbol').eq('id', 1).maybeSingle(),
      db.from('poll_results').select('votes, usd').eq('poll_id', id),
    ]);

    const symbol = cfg?.symbol ?? 'ANSEM';

    if (!poll) {
      // Gelöscht oder nie dagewesen. Keine Fehlerseite: Wer den Link
      // anklickt, soll in der App landen und dort die ehrliche Meldung
      // bekommen, statt hier in einer Sackgasse zu stehen.
      return new Response(seite({
        id,
        titel: 'This poll is gone',
        beschreibung: `Community votes weighted by $${symbol} holdings.`,
        bild: ersatz,
      }), { status: 200, headers: kopf });
    }

    const stimmen = (ergebnisse ?? []).reduce((a, r) => a + Number(r.votes ?? 0), 0);
    const usd = (ergebnisse ?? []).reduce((a, r) => a + Number(r.usd ?? 0), 0);
    const zu = poll.closed || (poll.closes_at && new Date(poll.closes_at) < new Date());

    // Kein "N votes" mehr, nur der Betrag.
    //
    // Die Stimmenzahl war die einzige Angabe, die sich billig faelschen liess:
    // Wer 100k auf zehn Wallets verteilt, aendert am Betrag nichts, macht aus
    // einer Stimme aber zehn. Der Betrag ist dagegen an den Bestand gebunden –
    // dieselben Token koennen nicht zweimal zaehlen.
    //
    // Gezaehlt wird sie hier trotzdem noch: Sie entscheidet, ob ueberhaupt
    // schon jemand abgestimmt hat, und das ist ein anderer Satz.
    const beschreibung = stimmen === 0
      ? `Hold $${symbol} to vote. Your weight is your balance.`
      : `$${nf.format(Math.round(usd))} in $${symbol}` + (zu ? ' · closed' : '');

    // Das Bild liegt im öffentlichen Eimer und wird von Ansems Browser dorthin
    // gelegt: beim Anlegen der Abstimmung und noch einmal, wenn er es
    // herunterlädt. Der Name ist fest, damit die Adresse vorhersagbar ist –
    // X merkt sie sich ohnehin tagelang, ein wechselnder Name brächte also
    // nichts als kalte Zwischenspeicher.
    //
    // Nachgesehen wird trotzdem, ob es wirklich da ist: Abstimmungen aus der
    // Zeit vor dieser Function haben keins, und eine Kachel mit kaputtem
    // Bildsymbol sieht aus, als sei die ganze Seite hin. Losgeschickt wurde
    // die Prüfung ganz oben; hier wird nur noch abgeholt, was längst
    // unterwegs war.
    // Auf die Bildpruefung wird gewartet – aber nicht unbegrenzt.
    //
    // Sie ist eine Hoeflichkeit gegenueber alten Abstimmungen ohne Karte. Ist
    // der Speicher gerade langsam, waere sie das Gegenteil davon: Der Crawler
    // haengt an einer Frage, deren Antwort in aller Regel "ja" lautet.
    //
    // Nach 400 ms wird deshalb "ja" angenommen. Der Irrtum kostet eine Kachel
    // mit kaputtem Bildsymbol bei einer alten Abstimmung; das Warten kostet
    // die Kachel bei jeder.
    const bildDa = await Promise.race([
      bildProbe,
      new Promise<boolean>((r) => setTimeout(() => r(true), 400)),
    ]);
    const bild = bildDa ? bildAdresse : ersatz;

    return new Response(seite({ id, titel: poll.question, beschreibung, bild }),
      { status: 200, headers: kopf });
  } catch (err) {
    console.error('[og] Abstimmung nicht lesbar:', err);
    // Auch im Fehlerfall eine gültige Seite: Ein 500 würde auf X als kaputter
    // Link erscheinen, obwohl die Abstimmung selbst in Ordnung ist.
    return new Response(seite({
      id,
      titel: 'SIZED',
      beschreibung: 'Community votes weighted by holdings.',
      bild: ersatz,
    }), { status: 200, headers: kopf });
  }
});
