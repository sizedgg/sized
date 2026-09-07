/**
 * Wallet-Verifikation per Zahlung.
 *
 *   POST { action: "challenge", wallet }      -> eindeutiger Betrag + Empfänger
 *   POST { action: "status", challengeId }    -> "pending" | "expired" | JWT
 *   POST { action: "mock-pay", challengeId }  -> nur wenn MOCK_CHAIN=1
 *
 * Warum ein Betrag mit Zufallsnachkommastellen und kein fester Preis:
 * Bei festem Betrag könnte jemand eine fremde Adresse eintragen, warten, bis
 * diese Person zufällig bezahlt, und deren Zahlung als eigenen Nachweis
 * einlösen. Der Nonce-Betrag ist dem Angreifer unbekannt, und jede Signatur
 * wird nur genau einmal akzeptiert.
 *
 * Warum jede Challenge ein Geheimnis trägt:
 * Der Nonce-Betrag allein reichte nicht. Wer eine Challenge für eine FREMDE
 * Adresse öffnete, bekam die Kennung – und createChallenge gab dieselbe
 * Challenge später dem echten Eigentümer weiter, damit ein Neuladen nicht
 * doppelt kostet. Der Eigentümer zahlte, und der Angreifer konnte mit
 * derselben Kennung das JWT abholen. Bei Ansems Adresse wäre das ein
 * Adminzugang gewesen, ohne dass Ansem etwas falsch gemacht hätte.
 *
 * Deshalb gehört eine Challenge jetzt dem, der sie geöffnet hat: Das
 * Geheimnis geht genau einmal heraus, in der Datenbank steht nur sein
 * SHA-256-Abdruck, und Status wie mock-pay verlangen es. Die ganze Kette
 * steht in 20260903020000_challenge_gehoert_dem_ersteller.sql.
 */
import { serviceClient, loadConfig, json, fail, CORS, MOCK, mayEnter } from '../_shared/common.ts';
import { isSolanaAddress } from '../_shared/base58.ts';
import { recentTreasuryPayments } from '../_shared/solana.ts';
import { signWalletJwt, verifyWalletJwt } from '../_shared/jwt.ts';
import { refreshWallet } from '../_shared/holdings.ts';

const CHALLENGE_TTL_MIN = Number(Deno.env.get('CHALLENGE_TTL_MIN') ?? 25);

// 90 Tage. Eine kurze Sitzung würde bedeuten, dass jemand für den Wiedereintritt
// erneut bezahlen muss – bei einer Seite, die man alle paar Tage öffnet, wäre das
// eine Zumutung.
const SESSION_TTL_HOURS = Number(Deno.env.get('SESSION_TTL_HOURS') ?? 24 * 90);

// Verlängern geht beliebig oft, aber nicht ewig: Ein Jahr nach der ersten
// Anmeldung ist Schluss, dann wird erneut verifiziert. Das begrenzt, wie lange
// ein abhandengekommenes Token nutzbar bleibt.
const MAX_SESSION_AGE_SEC = Number(Deno.env.get('MAX_SESSION_DAYS') ?? 365) * 86_400;
// Der Aufschlag, der eine Zahlung ihrer Anmeldung zuordnet.
//
// Er war einmal 1 bis 99.999 Lamports, also lamportgenau. Der Betrag sah dann
// so aus: 0.002043217 SOL – NEUN Nachkommastellen. In Phantom auf dem Handy
// lässt sich das nicht eintippen; das Feld nimmt weniger Stellen an und die
// letzte fällt weg. Der Betrag passt danach auf keine Challenge, das Geld ist
// überwiesen, und die Anmeldung scheitert ohne sichtbaren Grund.
//
// Jetzt in Schritten von 1.000 Lamports:
//
//   0.002001 … 0.002999 SOL   ->  SECHS Nachkommastellen
//
// Sechs Stellen nimmt jede Wallet-App an, und die Zahl ist von Hand
// abzutippen, ohne sich zu verzählen.
//
// Dass tausend Beträge genügen, liegt am Abgleich: scanTreasury vergleicht
// Betrag UND Absenderadresse. Eindeutig sein muss der Betrag deshalb nur
// innerhalb einer Wallet, und dort sind höchstens drei Challenges gleichzeitig
// offen. Die ausführliche Begründung steht in
// 20260904020000_betrag_weniger_stellen.sql.
const NONCE_SCHRITT = 1_000;   // Lamports je Schritt -> 6 Nachkommastellen
const NONCE_STUFEN = 999;      // 0.000001 bis 0.000999 SOL Aufschlag

const db = serviceClient();

let lastScan = 0;

// ---------------------------------------------------------------------------
// Das Geheimnis einer Challenge
// ---------------------------------------------------------------------------

/** 32 zufällige Bytes als Hex – die einzige Ausgabe, danach nur der Abdruck. */
function neuesGeheimnis(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function abdruck(geheimnis: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(geheimnis));
  return [...new Uint8Array(h)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Vergleicht zwei Hex-Abdrücke in fester Zeit.
 *
 * Bei einem Abdruck ist ein früher Abbruch kaum auszunutzen – aber der
 * Unterschied kostet hier nichts, und ein Vergleich mit === an genau der
 * Stelle, an der über eine Anmeldung entschieden wird, ist die Sorte Detail,
 * die man später nicht mehr nachträgt.
 */
function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Holt eine Challenge, aber nur mit dem passenden Geheimnis.
 *
 * Gibt null zurück, wenn es die Challenge nicht gibt, das Geheimnis nicht
 * stimmt – oder wenn sie noch aus der Zeit ohne Geheimnis stammt und offen
 * ist. Beides beantwortet dieselbe Absage, damit die Antwort nicht verrät,
 * welche Kennungen es gibt.
 */
async function challengeMitGeheimnis(id: unknown, geheimnis: unknown) {
  if (typeof id !== 'string' || id.length < 10) return null;
  if (typeof geheimnis !== 'string' || geheimnis.length < 32) return null;

  const { data: c } = await db.from('challenges').select('*').eq('id', id).maybeSingle();
  if (!c) return null;

  // Altbestand: Die Migration hat offene Challenges ohne Abdruck auf
  // 'expired' gesetzt. Eine BEZAHLTE ohne Abdruck darf noch einmal
  // eingelöst werden – dort ist Geld geflossen, bevor es das Geheimnis gab.
  if (!c.secret_hash) return c.status === 'paid' ? c : null;

  return gleich(await abdruck(geheimnis), c.secret_hash) ? c : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request body');
  }

  try {
    const cfg = await loadConfig(db);
    switch (body.action) {
      case 'challenge': return await createChallenge(cfg, body.wallet, body.challengeId, body.secret);
      case 'status':    return await checkStatus(cfg, body.challengeId, body.secret);
      case 'renew':     return await renewSession(cfg, req);
      case 'mock-pay':  return await mockPay(body.challengeId, body.secret);
      default:          return fail('Unknown action');
    }
  } catch (err) {
    console.error('[verify]', err);
    return fail(err instanceof Error ? err.message : 'Internal error', 500);
  }
});

// ---------------------------------------------------------------------------

async function createChallenge(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  wallet: unknown,
  weiterId: unknown,
  weiterGeheimnis: unknown,
) {
  if (!isSolanaAddress(wallet)) return fail('Not a valid Solana address');

  // Vor der Freischaltung wird hier abgebrochen – und zwar VOR der Zeile
  // darunter, die einen Betrag nennt. Wer die Absage bekommt, hat nichts
  // geschickt und kann auch nichts schicken: Ohne Challenge gibt es keinen
  // Betrag, auf den die Treasury horcht.
  if (!mayEnter(cfg, wallet)) {
    return fail('Not open yet - check back at launch.', 403);
  }

  if (!cfg.treasury) return fail('Verification address is not configured', 503);

  // Eine offene Challenge fortsetzen, damit ein Neuladen nicht doppelt kostet.
  //
  // Hier wurde früher NUR nach der Wallet gesucht: "gibt es für diese Adresse
  // etwas Offenes, dann nimm das". Genau das gab die Challenge eines Fremden an
  // den echten Eigentümer weiter – siehe den Kopf dieser Datei. Fortgesetzt
  // wird jetzt nur, wer sein eigenes Geheimnis vorlegt.
  if (weiterId) {
    const c = await challengeMitGeheimnis(weiterId, weiterGeheimnis);
    if (c && c.wallet === wallet && c.status === 'pending'
        && new Date(c.expires_at).getTime() > Date.now()) {
      return challengeResponse(cfg, c, String(weiterGeheimnis));
    }
    // Passt es nicht, wird eine neue angelegt. Keine Absage: Der häufigste
    // Grund ist eine abgelaufene Challenge im localStorage, und dafür soll
    // niemand eine Fehlermeldung sehen.
  }

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MIN * 60_000).toISOString();
  const geheimnis = neuesGeheimnis();
  const secret_hash = await abdruck(geheimnis);

  // Der Unique-Index auf offenen Beträgen lehnt Kollisionen ab – neu würfeln.
  for (let attempt = 0; attempt < 20; attempt++) {
    const lamports = Number(cfg.base_lamports)
      + (1 + Math.floor(Math.random() * NONCE_STUFEN)) * NONCE_SCHRITT;
    const { data, error } = await db.from('challenges')
      .insert({ wallet, lamports, expires_at: expiresAt, secret_hash })
      .select().single();
    if (!error) return challengeResponse(cfg, data, geheimnis);
    // P0001: die Obergrenze offener Challenges je Wallet aus der Migration.
    // Sie ist keine Kollision, die man wegwürfeln kann – hier ist Schluss.
    if (error.code === 'P0001') return fail(error.message, 429);
    if (error.code !== '23505') throw new Error(error.message);
  }
  return fail('No free verification amount right now - please try again in a moment', 503);
}

/**
 * Das Geheimnis geht GENAU HIER heraus und sonst nirgends. In der Datenbank
 * steht nur sein Abdruck; wer es verliert, fängt neu an.
 */
function challengeResponse(
  cfg: Awaited<ReturnType<typeof loadConfig>>, c: any, geheimnis: string,
) {
  return json({
    challengeId: c.id,
    secret: geheimnis,
    wallet: c.wallet,
    treasury: cfg.treasury,
    lamports: Number(c.lamports),
    sol: Number(c.lamports) / 1e9,
    expiresAt: c.expires_at,
    mock: MOCK,
  });
}

// ---------------------------------------------------------------------------

async function checkStatus(
  cfg: Awaited<ReturnType<typeof loadConfig>>, id: unknown, geheimnis: unknown,
) {
  if (typeof id !== 'string' || id.length < 10) return fail('Invalid challengeId');

  // Erst das Geheimnis, dann die Chain.
  // -------------------------------------------------------------------------
  // Ohne das passende Geheimnis gibt es hier nichts – auch nicht mit der
  // richtigen Kennung. Das ist die Zeile, an der die Übernahme hing: Sie las
  // die Challenge früher allein über die id.
  //
  // Dieselbe Absage für "gibt es nicht" und "Geheimnis falsch": Sonst wäre die
  // Antwort ein Orakel dafür, welche Kennungen existieren.
  //
  // Die Reihenfolge ist der zweite Punkt, und sie war falsch herum. Der
  // Treasury-Scan stand VOR dieser Prüfung – ein POST mit erfundener Kennung
  // löste ihn also aus, ohne dass der Absender irgendetwas nachweisen musste.
  // Ein Scan sind bis zu sechzig getTransaction-Aufrufe beim RPC-Anbieter, und
  // die kosten Geld und Kontingent. Ein Skript mit billigen HTTP-Anfragen
  // konnte damit die Anmeldung für alle lahmlegen.
  //
  // Für den rechtmässigen Aufrufer ändert die Reihenfolge nichts: Er hat sein
  // Geheimnis, er kommt eine Zeile später am Scan an.
  const c = await challengeMitGeheimnis(id, geheimnis);
  if (!c) return fail('Unknown request', 404);

  // Erst jetzt auf die Chain schauen – und nur, wenn diese Challenge
  // ueberhaupt noch auf eine Zahlung wartet. Bei 'paid', 'used' oder
  // 'expired' gibt es nichts mehr zu finden.
  if (!MOCK && c.status === 'pending') await scanTreasury(cfg.treasury!);

  // Nach dem Scan neu lesen: Er kann genau diese Challenge auf 'paid' gesetzt
  // haben, und die Zeile in der Hand ist dann veraltet.
  if (!MOCK && c.status === 'pending') {
    const frisch = await challengeMitGeheimnis(id, geheimnis);
    if (frisch) Object.assign(c, frisch);
  }

  if (c.status === 'pending' && new Date(c.expires_at).getTime() < Date.now()) {
    await db.from('challenges').update({ status: 'expired' }).eq('id', id);
    return json({ status: 'expired' });
  }
  if (c.status !== 'paid') return json({ status: c.status });

  // Genau einmal einlösbar: nur wer den Statuswechsel gewinnt, bekommt das JWT.
  const { data: claimed } = await db.from('challenges')
    .update({ status: 'used' }).eq('id', id).eq('status', 'paid').select().maybeSingle();
  if (!claimed) return json({ status: 'used' });

  // Der Bestandsabruf darf den Login nicht scheitern lassen: Die Challenge ist
  // schon eingelöst, ein Fehler hier würde die Zahlung wertlos machen. Der
  // Cron-Lauf holt den Bestand ohnehin nach.
  let holdings = { uiAmount: 0, usdValue: 0, price: 0 };
  try {
    holdings = await refreshWallet(db, c.wallet, cfg.ansem_mint ?? '');
  } catch (err) {
    console.error('[verify] Bestandsabruf fehlgeschlagen für', c.wallet, err);
    const { data: known } = await db.from('wallets')
      .select('ui_amount, usd_value').eq('address', c.wallet).maybeSingle();
    if (known) holdings = { uiAmount: Number(known.ui_amount), usdValue: Number(known.usd_value), price: 0 };
  }

  const isAdmin = Boolean(cfg.admin_wallet) && c.wallet === cfg.admin_wallet;

  const token = await signWalletJwt(Deno.env.get('APP_JWT_SECRET')!, {
    wallet: c.wallet,
    isAdmin,
    ttlSeconds: SESSION_TTL_HOURS * 3600,
  });

  return json({
    status: 'verified',
    token,
    expiresAt: Date.now() + SESSION_TTL_HOURS * 3_600_000,
    txSig: c.tx_sig,
    profile: {
      wallet: c.wallet,
      handle: c.wallet.slice(0, 3),
      tokens: holdings.uiAmount,
      usd: holdings.usdValue,
      isAdmin,
    },
  });
}

/**
 * Wie weit der Scan zurückblickt.
 *
 * Das war 40 – und 40 ist die Zahl, bei der bei einem Start mit vielen
 * gleichzeitigen Anmeldungen echtes Geld verloren geht: Landen zwischen zwei
 * Scans mehr als 40 Zahlungen an der Treasury, fallen die ältesten aus dem
 * Fenster und werden NIE gesehen. Die Challenge läuft nach 25 Minuten ab, das
 * SOL ist überwiesen, und niemand kommt herein.
 *
 * 200 kostet fast nichts, weil die Signaturliste ein einziger RPC-Aufruf ist
 * und bekannte Signaturen davor aussortiert werden.
 */
const TREASURY_FENSTER = 200;

/**
 * Liest die letzten Treasury-Transaktionen und bucht passende Zahlungen auf
 * offene Challenges. Höchstens alle 5 Sekunden, damit paralleles Polling
 * vieler Nutzer das RPC-Limit nicht sprengt.
 */
async function scanTreasury(treasury: string) {
  if (Date.now() - lastScan < 5_000) return;
  lastScan = Date.now();

  const { count } = await db.from('challenges')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending').gt('expires_at', new Date().toISOString());
  if (!count) return; // nichts offen -> kein RPC-Call

  // Die zuletzt verbuchten Signaturen, EINMAL geholt und als Sieb an den Scan
  // gegeben: damit fällt alles Bekannte weg, bevor der RPC pro Signatur eine
  // Detailabfrage bekommt. Vorher lief das Sieb erst danach – jeder Lauf holte
  // also alle 40 Transaktionen erneut, im Sekundentakt, ohne Ergebnis.
  //
  // 600 Zeilen decken das 200er-Fenster mit Reserve ab: Eine Signatur aus dem
  // Fenster, die wir schon kennen, kann nur dann aus diesen 600 herausfallen,
  // wenn seither über 600 Zahlungen eingingen – dann wäre sie längst nicht mehr
  // im Fenster. Und selbst wenn das Sieb einmal durchlässt, bleibt der
  // Primärschlüssel auf seen_txs.signature die eigentliche Sperre gegen
  // Doppelbuchung: Das Sieb spart Arbeit, es garantiert nichts.
  const { data: letzte } = await db.from('seen_txs')
    .select('signature').order('seen_at', { ascending: false }).limit(600);
  const verbucht = new Set((letzte ?? []).map((k) => k.signature));

  const payments = await recentTreasuryPayments(
    treasury,
    TREASURY_FENSTER,
    (sigs) => sigs.filter((s) => !verbucht.has(s)),
  );
  if (!payments.length) return;

  for (const p of payments) {
    // Zuerst festschreiben, dass diese Signatur verbraucht ist. Schlägt das
    // fehl, hat ein paralleler Lauf sie schon – dann nicht doppelt buchen.
    const { error: insErr } = await db.from('seen_txs').insert({
      signature: p.signature, slot: p.slot, sender: p.sender, lamports: p.lamports,
    });
    if (insErr) continue;

    const { data: matched } = await db.from('challenges')
      .update({ status: 'paid', tx_sig: p.signature })
      .eq('status', 'pending')
      .eq('wallet', p.sender)
      .eq('lamports', p.lamports)
      .gt('expires_at', new Date().toISOString())
      .select('id').maybeSingle();

    if (matched) {
      console.log(`[verify] Zahlung bestätigt: ${p.sender.slice(0, 6)}… ${p.signature.slice(0, 10)}…`);
    }
  }
}

/**
 * Verlängert eine noch gültige Sitzung, ohne neue Zahlung.
 *
 * Wer die App regelmäßig öffnet, bleibt damit dauerhaft angemeldet. Bezahlt
 * wird nur einmal – und wieder, wenn jemand ein Jahr lang nicht vorbeischaut
 * oder sein Token abgelaufen ist.
 */
async function renewSession(cfg: Awaited<ReturnType<typeof loadConfig>>, req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail('Not verified', 401);

  const secret = Deno.env.get('APP_JWT_SECRET')!;
  const claims = await verifyWalletJwt(secret, auth.slice(7).trim());
  if (!claims) return fail('Session expired - please verify again', 401);

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.origIat && nowSec - claims.origIat > MAX_SESSION_AGE_SEC) {
    return fail('Session too old - please verify again', 401);
  }

  // Adminrechte werden frisch aus der Konfiguration gelesen, nicht aus dem
  // alten Token: Wechselt Ansems Wallet, verliert das alte Token die Rechte.
  const isAdmin = Boolean(cfg.admin_wallet) && claims.wallet === cfg.admin_wallet;

  // Dasselbe Tor auch hier. Sonst behielte jede Sitzung, die vor dem
  // Zusperren ausgestellt wurde, ihren Zugang auf unbestimmte Zeit – die
  // Verlaengerung laeuft von selbst und fragt sonst niemanden mehr.
  if (!mayEnter(cfg, claims.wallet)) {
    return fail('Not open yet - check back at launch.', 403);
  }

  const token = await signWalletJwt(secret, {
    wallet: claims.wallet,
    isAdmin,
    ttlSeconds: SESSION_TTL_HOURS * 3600,
    origIat: claims.origIat || nowSec,
  });

  const { data: known } = await db.from('wallets')
    .select('ui_amount, usd_value').eq('address', claims.wallet).maybeSingle();

  return json({
    status: 'verified',
    token,
    expiresAt: Date.now() + SESSION_TTL_HOURS * 3_600_000,
    profile: {
      wallet: claims.wallet,
      handle: claims.wallet.slice(0, 3),
      tokens: Number(known?.ui_amount ?? 0),
      usd: Number(known?.usd_value ?? 0),
      isAdmin,
    },
  });
}

async function mockPay(id: unknown, geheimnis: unknown) {
  if (!MOCK) return fail('Not available', 404);
  // Auch hier das Geheimnis: MOCK_CHAIN ist eine Umgebungsvariable, und eine
  // Umgebungsvariable steht irgendwann versehentlich auf 1. Dann soll die
  // Abkürzung wenigstens nicht auch noch für fremde Challenges gelten.
  const c = await challengeMitGeheimnis(id, geheimnis);
  if (!c) return fail('No open request', 400);
  const { data } = await db.from('challenges')
    .update({ status: 'paid', tx_sig: `mock-${crypto.randomUUID()}` })
    .eq('id', c.id).eq('status', 'pending').select().maybeSingle();
  return data ? json({ ok: true }) : fail('No open request', 400);
}
