/**
 * Webhook für Token-Transfers (Helius).
 *
 * Solana meldet von sich aus nichts. Damit eine Stimme zeitnah verschwindet,
 * wenn jemand seine Token wegschickt, braucht es eine Push-Quelle: Helius
 * ruft diese Function bei jedem Transfer des $ANSEM-Mints auf, wir lesen die
 * betroffenen Wallets neu ein, und der Datenbank-Trigger zieht die Stimmen in
 * offenen Abstimmungen nach.
 *
 * Einrichtung im Helius-Dashboard:
 *   Webhook Type   : Enhanced
 *   Transaction Type: TRANSFER, SWAP  (oder "Any")
 *   Account Address: die Mint-Adresse von $ANSEM
 *   Webhook URL    : https://<projekt>.supabase.co/functions/v1/holdings-webhook
 *   Auth Header    : derselbe Wert wie das Secret WEBHOOK_SECRET
 *
 * Der Cron-Lauf von `refresh-holdings` bleibt trotzdem nötig: Er ist das Netz
 * für alles, was der Webhook verpasst (Ausfall, Kursänderung ohne Transfer).
 *
 * WICHTIG: Der Webhook legt keine neuen Wallets an, er frischt nur bekannte
 * auf. Helius meldet jede Bewegung des Mints, also auch die von Tausenden
 * Adressen, die diese Seite nie besuchen werden. Wer hier eine Zeile bekommt,
 * hat sich verifiziert – niemand sonst. Siehe die Begründung unten am Filter.
 */
import { serviceClient, loadConfig, json, fail, CORS } from '../_shared/common.ts';
import { isSolanaAddress } from '../_shared/base58.ts';
import { refreshWallet } from '../_shared/holdings.ts';

const MAX_WALLETS_PER_CALL = 60;

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);

  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret) return fail('WEBHOOK_SECRET is not set', 503);
  const presented = req.headers.get('authorization') ?? '';
  if (presented !== secret && presented !== `Bearer ${secret}`) return fail('Not allowed', 403);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail('Invalid body');
  }

  try {
    const cfg = await loadConfig(db);
    if (!cfg.ansem_mint) return fail('Token mint is not configured', 503);

    const wallets = extractWallets(payload, cfg.ansem_mint);
    if (!wallets.length) return json({ updated: 0, note: 'no token transfer in payload' });

    // Nur Adressen anfassen, die die Tabelle schon kennt.
    //
    // Das ist die wichtigste Zeile dieser Function. refreshWallet() schreibt
    // per Upsert – ohne diesen Filter legt der Webhook für JEDE Adresse, die
    // den Token je bewegt hat, eine Zeile an. Damit war `wallets` kein
    // Verzeichnis der Mitglieder mehr, sondern eines des gesamten Tokens:
    // 27.477 Zeilen, von denen zwei jemandem gehoerten, der die Seite
    // benutzt.
    //
    // Das kostet nicht nur Platz. Der Kurs-Takt schreibt jede Minute jede
    // dieser Zeilen neu, und der Nachlese-Job arbeitet sich in
    // Hunderterschritten ewig durch dieselbe Liste. Beides waechst dann mit
    // der Beliebtheit des Tokens statt mit der Zahl der Nutzer – die
    // Datenbank kann also unter Last geraten, ohne dass ein einziger Mensch
    // die Seite besucht hat.
    //
    // Neue Adressen kommen weiterhin herein, nur an der richtigen Stelle:
    // beim Verifizieren. Wer bezahlt hat, steht in der Tabelle, und ab dann
    // meldet der Webhook seine Bewegungen.
    const { data: bekannt, error: leseFehler } = await db
      .from('wallets').select('address').in('address', wallets);
    if (leseFehler) throw new Error(`known wallets lookup failed: ${leseFehler.message}`);

    const zuHolen = new Set((bekannt ?? []).map((w) => w.address));
    const relevant = wallets.filter((w) => zuHolen.has(w));
    if (!relevant.length) {
      return json({ updated: 0, seen: wallets.length, note: 'no known wallet in payload' });
    }

    let updated = 0;
    for (const wallet of relevant.slice(0, MAX_WALLETS_PER_CALL)) {
      try { await refreshWallet(db, wallet, cfg.ansem_mint); updated++; }
      catch (err) { console.warn('[webhook] ', wallet, err); }
    }
    return json({ updated, seen: wallets.length, known: relevant.length });
  } catch (err) {
    console.error('[holdings-webhook]', err);
    return fail(err instanceof Error ? err.message : 'Internal error', 500);
  }
});

/**
 * Sammelt alle Wallet-Adressen, deren $ANSEM-Bestand sich geändert haben
 * könnte – Sender und Empfänger, plus Konten aus der Bilanzänderung.
 */
function extractWallets(payload: unknown, mint: string): string[] {
  const events = Array.isArray(payload) ? payload : [payload];
  const found = new Set<string>();

  for (const ev of events) {
    const e = ev as Record<string, any>;

    for (const t of e?.tokenTransfers ?? []) {
      if (t?.mint !== mint) continue;
      for (const a of [t.fromUserAccount, t.toUserAccount]) {
        if (isSolanaAddress(a)) found.add(a);
      }
    }

    for (const acc of e?.accountData ?? []) {
      for (const ch of acc?.tokenBalanceChanges ?? []) {
        if (ch?.mint !== mint) continue;
        if (isSolanaAddress(ch.userAccount)) found.add(ch.userAccount);
      }
    }
  }

  return [...found];
}
