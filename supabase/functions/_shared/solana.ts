/**
 * Solana-Zugriff per reinem JSON-RPC über fetch – bewusst ohne @solana/web3.js,
 * damit die Edge Function klein und kaltstartschnell bleibt.
 *
 * Gebraucht wird dreierlei: Zahlungen an die Treasury, der Token-Bestand einer
 * Wallet und der Kurs.
 */

export const RPC_URL = Deno.env.get('SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com';

let rpcId = 0;

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
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

export interface TreasuryPayment {
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
export async function recentTreasuryPayments(
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
export async function tokenBalance(owner: string, mint: string): Promise<number> {
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
export async function tokenPrice(mint: string): Promise<number> {
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
