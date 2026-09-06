// ============================================================================
// verify – EIGENSTÄNDIGE FASSUNG FÜR DEN DASHBOARD-EDITOR
//
// ACHTUNG: Diese Datei wird NICHT von Hand bearbeitet. Sie entsteht aus
// supabase/functions/verify/index.ts und den Dateien unter _shared/ durch
//
//     node scripts/verify-eigenstaendig.mjs
//
// Wer hier etwas ändert, verliert es beim nächsten Lauf – und schlimmer: Die
// Fassung im Dashboard und die im Projekt sagen dann Verschiedenes, ohne dass
// man es einer von beiden ansieht.
//
// Erzeugt am 2026-09-04
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// aus _shared/base58.ts
// ---------------------------------------------------------------------------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Dekodiert Base58 zu Bytes. Wirft bei ungültigen Zeichen. */
function decodeBase58(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = MAP.get(ch);
    if (value === undefined) throw new Error(`Ungültiges Base58-Zeichen: ${ch}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Der Akkumulator startet mit einer 0; überzählige Nullbytes am oberen Ende
  // gehören nicht zum Wert und müssen weg, bevor die echten führenden
  // Nullbytes (jedes '1' im Input) ergänzt werden.
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
  for (let k = 0; k < input.length && input[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/** Kodiert Bytes als Base58. */
function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // Führende Nullbytes zählen und aus der Umrechnung heraushalten – sie werden
  // am Ende als '1' ergänzt und würden sonst eine überzählige Stelle erzeugen.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/**
 * Prüft, ob ein String eine gültige Solana-Adresse ist: Base58 und exakt
 * 32 Byte. Das schließt Tippfehler und injizierte Werte zuverlässig aus.
 */
function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// aus _shared/freischaltung.ts
// ---------------------------------------------------------------------------
/**
 * Das Tor vor der Freischaltung.
 *
 * Eine eigene Datei ohne Importe, und das mit Absicht: common.ts zieht den
 * Supabase-Client aus jsr: nach und laesst sich deshalb aus Node heraus gar
 * nicht laden. Eine Regel, die nur im Betrieb existiert, kann kein Test
 * anfassen – und diese hier ist die eine, die zwischen "niemand kommt herein"
 * und "alle kommen herein" steht.
 */

interface TorConfig {
  admin_wallet: string | null;
  test_wallet?: string | null;
  /**
   * Fehlt die Spalte, steht hier undefined – und das ist ein eigener Fall,
   * siehe mayEnter(). Deshalb optional und nicht einfach boolean.
   */
  open_to_public?: boolean | null;
}

/**
 * Darf diese Wallet ueberhaupt herein?
 *
 * Vor der Freischaltung nur Ansems eigene – der Rest bekommt eine Absage,
 * BEVOR ein Betrag genannt wird. Das ist hier keine Feinheit, sondern der
 * ganze Punkt: Die Anmeldung besteht aus einer Ueberweisung. Wer erst zahlt
 * und dann abgewiesen wird, hat Geld fuer nichts geschickt. Die Absage muss
 * also am Anfang stehen, nicht am Ende.
 *
 * Als eigene Funktion und nicht als zwei Zeilen an zwei Stellen: Sie wird an
 * beiden Toren gebraucht (neue Anmeldung und Verlaengerung einer alten
 * Sitzung), und eine Regel, die an einem der beiden fehlt, faellt niemandem
 * auf – sie sieht ja aus wie geschlossen.
 *
 * Zwei Adressen kommen durch, nicht eine: admin_wallet und test_wallet. Der
 * Grund ist keine Bequemlichkeit, sondern dass sich die Seite von den beiden
 * Seiten VERSCHIEDEN verhaelt – Ansem sieht einen Posteingang, ein Nutzer
 * eine Schwelle. Nur mit Ansems Wallet zu pruefen hiesse, die Haelfte nie zu
 * sehen, die alle anderen sehen.
 *
 * Genau EINE Testadresse, kein Feld mit mehreren. Eine Liste waere die
 * Stelle, an der am Ende jemand steht, den man vergessen hat auszutragen; ein
 * einzelnes Feld sieht man beim Draufschauen.
 */
function mayEnter(cfg: TorConfig, wallet: string | null): boolean {
  // Zu ist die Seite nur, wenn es AUSDRUECKLICH dort steht. Fehlt die Spalte,
  // ist offen.
  //
  // Hier stand die andere Richtung, mit dem Argument: Im Zweifel lieber
  // niemanden hereinlassen. Das war richtig, solange die Seite vor dem Start
  // dichtgehalten werden sollte – ein Deployment ohne die Migration hat dann
  // eben zugesperrt statt aufgemacht.
  //
  // Nach dem Start dreht sich der schlimmere Fall um. Dann ist die Function
  // seit Monaten im Einsatz, jemand rollt sie aus einem ganz anderen Grund neu
  // aus, die Spalte fehlt in dieser Datenbank – und die Seite ist zu, ohne
  // dass jemand das wollte oder gleich merkt.
  //
  // Ein Fallstrick, der auf ein VERGESSEN reagiert, ist schlechter als einer,
  // der auf eine ENTSCHEIDUNG reagiert. Zusperren ist jetzt eine Handlung:
  //   update public.app_config set open_to_public = false where id = 1;
  if (cfg.open_to_public !== false) return true;

  if (cfg.admin_wallet && wallet === cfg.admin_wallet) return true;
  return Boolean(cfg.test_wallet) && wallet === cfg.test_wallet;
}

// ---------------------------------------------------------------------------
// aus _shared/common.ts
// ---------------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

/** Client mit Service-Role – umgeht RLS, darf also nur serverseitig laufen. */
function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

interface AppConfig {
  admin_wallet: string | null;
  treasury: string | null;
  ansem_mint: string | null;
  symbol: string;
  base_lamports: number;
  open_to_public: boolean;
  test_wallet: string | null;
}

async function loadConfig(db: SupabaseClient): Promise<AppConfig> {
  const { data, error } = await db.from('app_config').select('*').eq('id', 1).single();
  if (error) throw new Error(`Cannot read configuration: ${error.message}`);
  return data as AppConfig;
}

const MOCK = (Deno.env.get('MOCK_CHAIN') ?? '') === '1';

// ---------------------------------------------------------------------------
// aus _shared/jwt.ts
// ---------------------------------------------------------------------------
/**
 * Minimales HS256-JWT, signiert mit dem Supabase-JWT-Secret.
 *
 * Damit akzeptieren PostgREST und Realtime das Token wie ein reguläres
 * Supabase-Auth-Token – nur dass die Identität hier nicht E-Mail oder OAuth
 * ist, sondern die per Zahlung nachgewiesene Wallet im Claim "wallet".
 */

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface WalletClaims {
  wallet: string;
  isAdmin: boolean;
  ttlSeconds: number;
  /**
   * Zeitpunkt der ersten Anmeldung (Unix-Sekunden). Bleibt über alle
   * Verlängerungen hinweg gleich und begrenzt so, wie lange eine Wallet ohne
   * neue Zahlung im Umlauf bleiben kann.
   */
  origIat?: number;
}

async function signWalletJwt(secret: string, claims: WalletClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    // Von Supabase erwartete Felder
    aud: 'authenticated',
    role: 'authenticated',
    sub: claims.wallet,
    iat: now,
    exp: now + claims.ttlSeconds,
    // Eigene Felder – `wallet` wird in den RLS-Policies ausgewertet
    wallet: claims.wallet,
    is_admin: claims.isAdmin,
    oiat: claims.origIat ?? now,
    app_metadata: { provider: 'solana-payment' },
  };

  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

const fromB64url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/**
 * Prüft Signatur und Ablauf und gibt die Wallet zurück – oder null.
 * Nie den Payload ohne diese Prüfung verwenden: er ist nur Base64, nicht
 * verschlüsselt, und lässt sich sonst beliebig fälschen.
 */
async function verifyWalletJwt(
  secret: string,
  token: string,
): Promise<{ wallet: string; isAdmin: boolean; origIat: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC', key, fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.wallet !== 'string' || !payload.wallet) return null;
    return {
      wallet: payload.wallet,
      isAdmin: payload.is_admin === true,
      origIat: Number(payload.oiat) || Number(payload.iat) || 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// aus _shared/solana.ts
// ---------------------------------------------------------------------------
/**
 * Solana-Zugriff per reinem JSON-RPC über fetch – bewusst ohne @solana/web3.js,
 * damit die Edge Function klein und kaltstartschnell bleibt.
 *
 * Gebraucht wird dreierlei: Zahlungen an die Treasury, der Token-Bestand einer
 * Wallet und der Kurs.
 */

const RPC_URL = Deno.env.get('SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com';

let rpcId = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result as T;
}

// ---------------------------------------------------------------------------
// Zahlungen an die Treasury
// ---------------------------------------------------------------------------

interface TreasuryPayment {
  signature: string;
  slot: number;
  sender: string;
  lamports: number;
}

interface SignatureInfo { signature: string; slot: number; err: unknown }

/**
 * Wie viele Detailabfragen ein einzelner Scan höchstens macht – und wie viele
 * davon gleichzeitig laufen.
 *
 * Die Signaturliste ist EIN billiger Aufruf, egal ob für 40 oder 200 Einträge.
 * Teuer ist danach `getTransaction`, einmal pro Signatur. Deshalb darf das
 * Fenster breit sein, solange bekannte Signaturen vorher wegfallen – aber ein
 * Kaltstart (noch nichts bekannt) hätte sonst 200 Abfragen am Stück, seriell
 * über 20 Sekunden, und die Funktion läuft vorher in ihr Zeitlimit.
 *
 * Also: höchstens DETAILS_PRO_SCAN pro Lauf, neueste zuerst, GLEICHZEITIG
 * parallel. Was nicht mehr hineinpasst, kommt beim nächsten Lauf 5 Sekunden
 * später dran – die Challenge lebt 25 Minuten, das reicht vielfach.
 */
const DETAILS_PRO_SCAN = 60;
const GLEICHZEITIG = 4;

/**
 * Liest die letzten Transaktionen der Treasury-Adresse und gibt alle einfachen
 * SOL-Transfers *an* diese Adresse zurück.
 *
 * `aussieben` bekommt die komplette Signaturliste und gibt zurück, welche davon
 * noch unbekannt sind – VOR der teuren Detailabfrage. Ohne diesen Schritt holt
 * jeder Lauf dieselben `limit` Transaktionen wieder vom RPC, obwohl längst
 * verbucht.
 */
async function recentTreasuryPayments(
  treasury: string,
  limit = 200,
  aussieben: (sigs: string[]) => Promise<string[]> | string[] = (s) => s,
): Promise<TreasuryPayment[]> {
  const sigs = await rpc<SignatureInfo[]>('getSignaturesForAddress', [treasury, { limit }]);
  const brauchbar = sigs.filter((s) => !s.err);

  // Neueste zuerst – so kommt eine Zahlung von gerade eben auch dann dran,
  // wenn davor ein Berg alter Signaturen liegt.
  const offen = new Set(await aussieben(brauchbar.map((s) => s.signature)));
  const wanted = brauchbar.filter((s) => offen.has(s.signature)).slice(0, DETAILS_PRO_SCAN);

  const einzeln = async (s: SignatureInfo): Promise<TreasuryPayment | null> => {
    let tx: any;
    try {
      tx = await rpc('getTransaction', [
        s.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ]);
    } catch {
      // Nicht verbuchen heisst nicht verloren: die Signatur bleibt unbekannt
      // und der nächste Lauf versucht es erneut.
      return null;
    }
    if (!tx || tx.meta?.err) return null;

    const instructions = [
      ...(tx.transaction?.message?.instructions ?? []),
      ...((tx.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions ?? [])),
    ];

    for (const ix of instructions) {
      if (ix?.program !== 'system') continue;
      if (ix?.parsed?.type !== 'transfer') continue;
      const info = ix.parsed.info;
      if (info?.destination !== treasury) continue;
      return {
        signature: s.signature,
        slot: tx.slot ?? s.slot,
        sender: info.source,
        lamports: Number(info.lamports),
      }; // ein Transfer pro Transaktion genügt
    }
    return null;
  };

  const out: TreasuryPayment[] = [];
  for (let i = 0; i < wanted.length; i += GLEICHZEITIG) {
    const stapel = await Promise.all(wanted.slice(i, i + GLEICHZEITIG).map(einzeln));
    for (const p of stapel) if (p) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token-Bestand
// ---------------------------------------------------------------------------

/**
 * Summiert alle Token-Accounts einer Wallet für einen Mint.
 *
 * Nur nach `mint` filtern. Die RPC akzeptiert genau eines von `mint` ODER
 * `programId` – beides zusammen wird abgelehnt. Der Mint-Filter gilt
 * unabhängig davon, ob der Token unter dem klassischen Token-Programm oder
 * unter Token-2022 läuft, deckt also beides ab.
 *
 * Fehler werden bewusst NICHT verschluckt: Ein abgefangener RPC-Fehler sähe
 * hier aus wie ein Bestand von null und würde still jedes Stimmgewicht, jeden
 * Chat-Filter und die DM-Sortierung auf null setzen. Lieber laut scheitern.
 */
async function tokenBalance(owner: string, mint: string): Promise<number> {
  // commitment: 'confirmed' ist hier wichtig. Ohne Angabe antwortet die RPC
  // mit 'finalized', und das hinkt gut ein Dutzend Sekunden hinterher. Wer
  // gerade Token gekauft hat, sieht sie in seiner Wallet und im Explorer
  // längst, hier aber noch nicht – das sieht nach einem Fehler aus.
  //
  // Für Zahlungen an die Treasury wäre das die falsche Wahl: Dort geht es um
  // Geld, und eine bestätigte, aber noch nicht endgültige Transaktion kann in
  // seltenen Fällen wieder verschwinden. Ein Bestand ist unkritisch – er wird
  // ohnehin laufend neu gelesen und beim nächsten Mal korrigiert.
  const res = await rpc<{ value?: any[] }>('getTokenAccountsByOwner', [
    owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);

  let total = 0;
  for (const acc of res?.value ?? []) {
    total += Number(acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Preis
// ---------------------------------------------------------------------------

async function fetchJson(url: string, timeoutMs = 6000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** USD-Preis eines Tokens, Jupiter zuerst, DexScreener als Rückfall. */
async function tokenPrice(mint: string): Promise<number> {
  try {
    const data = await fetchJson(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
    const p = Number(data?.[mint]?.usdPrice);
    if (p > 0) return p;
  } catch { /* weiter zum Fallback */ }

  try {
    const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const pairs = (data?.pairs ?? []).filter((p: any) => p.priceUsd);
    pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const p = Number(pairs[0]?.priceUsd);
    if (p > 0) return p;
  } catch { /* Preis unbekannt */ }

  return 0;
}

// ---------------------------------------------------------------------------
// aus _shared/holdings.ts
// ---------------------------------------------------------------------------
/** Deterministischer Fake-Bestand für den Mock-Modus. */
async function mockAmount(wallet: string): Promise<number> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wallet)),
  );
  const tiers = [0, 1_200, 15_000, 48_000, 120_000, 310_000, 900_000, 2_400_000, 7_500_000, 21_000_000];
  return tiers[hash[0] % 10] + (((hash[1] << 8) | hash[2]) % 997) * 13;
}

/**
 * Holt Bestand und Preis frisch von der Chain und schreibt sie nach `wallets`.
 * Nur diese Funktion (Service-Role) darf die Tabelle schreiben – deshalb kann
 * kein Client sein eigenes Gewicht manipulieren.
 */
async function refreshWallet(
  db: SupabaseClient,
  wallet: string,
  mint: string,
  /**
   * Bereits bekannter Kurs. Ohne diesen Parameter holt jede einzelne Wallet
   * ihren eigenen – bei einem Stapellauf über 200 Wallets wären das 200
   * Abfragen desselben Werts an dieselbe Preisquelle, die einen im Zweifel
   * dafür aussperrt. Der Kurs ist für alle gleich, also holt der Aufrufer ihn
   * einmal und reicht ihn durch.
   */
  knownPrice?: number,
): Promise<{ uiAmount: number; usdValue: number; price: number }> {
  const holePreis = async () =>
    knownPrice !== undefined && knownPrice > 0 ? knownPrice : await tokenPrice(mint);

  const [uiAmount, price] = MOCK
    ? [await mockAmount(wallet), knownPrice ?? 0.0042]
    : await Promise.all([tokenBalance(wallet, mint), holePreis()]);

  const usdValue = uiAmount * price;

  const { error } = await db.from('wallets').upsert({
    address: wallet,
    ui_amount: uiAmount,
    usd_value: usdValue,
    price,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'address' });
  if (error) throw new Error(`wallets update failed: ${error.message}`);

  return { uiAmount, usdValue, price };
}

// ---------------------------------------------------------------------------
// aus verify/index.ts
// ---------------------------------------------------------------------------
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





const CHALLENGE_TTL_MIN = Number(Deno.env.get('CHALLENGE_TTL_MIN') ?? 25);

// 90 Tage. Eine kurze Sitzung würde bedeuten, dass jemand für den Wiedereintritt
// erneut bezahlen muss – bei einem Chat, den man alle paar Tage öffnet, wäre das
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

  if (!MOCK) await scanTreasury(cfg.treasury!);

  // Ohne das passende Geheimnis gibt es hier nichts – auch nicht mit der
  // richtigen Kennung. Das ist die Zeile, an der die Übernahme hing: Sie las
  // die Challenge früher allein über die id.
  //
  // Dieselbe Absage für "gibt es nicht" und "Geheimnis falsch": Sonst wäre die
  // Antwort ein Orakel dafür, welche Kennungen existieren.
  const c = await challengeMitGeheimnis(id, geheimnis);
  if (!c) return fail('Unknown request', 404);

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
