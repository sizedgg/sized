/**
 * Testet die Migration gegen eine echte Postgres-Instanz.
 *
 * Es geht dabei ausdrücklich nicht um "läuft das SQL durch", sondern um die
 * Frage: Was kann ein Nutzer, der direkt mit PostgREST spricht, fälschen?
 * Jeder Test simuliert deshalb einen Client mit gesetztem JWT-Claim.
 *
 *   PGURL=postgres://user@host/db node scripts/test-schema.mjs
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.env.PGURL || 'postgres://postgres@localhost/ansem_test';

const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
const WHALE = 'EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCWa';
const SHRIMP = 'CYRHXzKhGBdrJ9v5XtAyBRopaKVDh6DUoaqZdntvG19Z';
const DOLPHIN = 'H4vNq7Vs2vYzWzKq6rjs4pFTP8dMTr8XvBEEEmyxhbcs';
const GHOST = '9uKwLTUvR5T2wUyRUpwbxU3DKZQmsWyEqAJRP5vNiRSc';

let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
};

const client = new pg.Client(url);
await client.connect();

/** Führt Statements als "authenticated" mit gesetztem Wallet-Claim aus. */
async function asWallet(wallet, fn) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ role: 'authenticated', sub: wallet, wallet })]);
    await client.query('set local role authenticated');
    const out = await fn();
    await client.query('reset role');
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  }
}

/** Erwartet, dass die Operation scheitert. Gibt die Fehlermeldung zurück. */
async function expectFail(label, wallet, fn) {
  try {
    await asWallet(wallet, fn);
    check(label, false, 'wurde fälschlich erlaubt');
    return null;
  } catch (err) {
    check(label, true, err.message.split('\n')[0].slice(0, 80));
    return err;
  }
}

// ---------------------------------------------------------------------------

console.log('\n── Migration ──');
// Restlos abräumen, nicht Tabelle für Tabelle.
//
// Hier stand einmal eine von Hand gepflegte Liste: drop table dms, votes,
// poll_options, ... Und genau daran ist etwas vorbeigerutscht. Eine neue
// Tabelle (public.poll_totals) stand nicht auf der Liste, überlebte den
// Aufräumvorgang und liess "create table if not exists" in der Wanderung
// stillschweigend AUSSETZEN. Ergebnis: eine Tabelle ohne ihre Fremdschlüssel,
// und ein Test, der etwas anderes prüfte als das, was in der Wanderung steht.
//
// Diesmal ist es ein Befund geworden. Es hätte genauso gut andersherum
// ausgehen können – ein grüner Haken für eine Wanderung, die nie lief.
//
// Also: das ganze Schema weg und neu. Was die Wanderungen nicht selbst
// anlegen, gibt es danach nicht.
await client.query(`
  drop schema if exists app cascade;
  drop schema if exists public cascade;
  create schema public;
`);
for (const role of ['anon', 'authenticated', 'service_role']) {
  await client.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${role}') then
      create role ${role} nologin noinherit;
    end if;
  end $$;`);
}
await client.query(`grant ${'authenticated'} to current_user;`).catch(() => {});
await client.query(`grant anon, service_role to current_user;`).catch(() => {});

// Der Speicher-Teil von Supabase, so weit die Migration ihn braucht.
//
// Ohne das lief dieses Skript seit 20260827010000_og_bilder.sql ueberhaupt
// nicht mehr an: Die Migration legt einen Bucket an und haengt Regeln an
// storage.objects, und beides gibt es in einem nackten Postgres nicht. Der
// Abbruch kam in der ERSTEN Zeile, also sind auch alle Pruefungen darunter
// seitdem nie gelaufen – sie standen nur da.
await client.query(`
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now());
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.objects to anon, authenticated;
  grant insert, update, delete on storage.objects to authenticated;
`);

// Der Realtime-Teil von Supabase, so weit die Migrationen ihn brauchen.
//
// Dieselbe Geschichte wie beim Speicher darueber: 20260904010000_dm_broadcast
// haengt eine Zugangsregel an realtime.messages und ruft realtime.send() im
// Trigger auf. Beides gibt es in einem nackten Postgres nicht.
//
// realtime.send() schreibt hier nicht ins Nichts, sondern in eine Tabelle –
// so laesst sich nachher pruefen, WELCHE Stupse der Trigger wirklich
// losgeschickt hat. Eine Attrappe, die alles schluckt, wuerde nichts messen.
await client.query(`
  create schema if not exists realtime;
  create table if not exists realtime.messages (
    id bigint generated always as identity primary key,
    topic text not null, extension text not null,
    event text, payload jsonb, private boolean,
    inserted_at timestamptz not null default now());
  alter table realtime.messages enable row level security;

  create or replace function realtime.send(
    payload jsonb, event text, topic text, private boolean default true)
  returns void language sql as $rt$
    insert into realtime.messages (topic, extension, event, payload, private)
    values (topic, 'broadcast', event, payload, private);
  $rt$;

  -- Was Supabase im Rechte-Check als Kanalnamen einsetzt. Hier ueber eine
  -- Sitzungsvariable, damit der Test verschiedene Kanaele durchspielen kann.
  create or replace function realtime.topic() returns text
  language sql stable as $rt$
    select nullif(current_setting('realtime.topic', true), '')
  $rt$;

  grant usage on schema realtime to anon, authenticated;
  grant select, insert on realtime.messages to authenticated;
`);

const dir = path.join(root, 'supabase/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const migrations = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));

for (let i = 0; i < files.length; i++) await client.query(migrations[i]);
check(`${files.length} Migrationen laufen der Reihe nach durch`, true, files.join(', '));

// Zweiter Durchlauf: Migrationen müssen idempotent sein.
for (let i = 0; i < files.length; i++) await client.query(migrations[i]);
check('Migrationen sind idempotent (zweiter Lauf ohne Fehler)', true);

// --- Seed als "Service Role" (RLS wird hier bewusst umgangen) ---
await client.query(
  `update public.app_config set admin_wallet=$1, treasury=$2, ansem_mint=$3 where id=1`,
  [ADMIN, 'Trea5ury1111111111111111111111111111111111', 'An5emMint111111111111111111111111111111111']);
for (const [addr, amt, usd] of [[ADMIN, 1_434, 6.02], [WHALE, 903_302, 3_793.87],
                                [SHRIMP, 7_739, 32.5], [DOLPHIN, 120_400, 1_505.68]]) {
  await client.query(
    `insert into public.wallets (address, ui_amount, usd_value, price) values ($1,$2,$3,0.0042)
     on conflict (address) do update set ui_amount=excluded.ui_amount, usd_value=excluded.usd_value`,
    [addr, amt, usd]);
}

// ── messages: die Tabelle steht noch, die Oberflaeche nicht mehr ──
//
// Der Chat ist aus der App entfernt worden. Geloescht wurde in der Datenbank
// nichts: Tabelle, RLS-Regeln, Linksperre und Taktgrenze stehen unveraendert,
// und die Nachrichten liegen weiter da. Das war die Entscheidung – so bleibt
// alles umkehrbar.
//
// Deshalb laeuft dieser Abschnitt weiter: Er prueft, ob die Regeln noch das
// tun, was sie sollen, falls jemand die Tabelle wieder anfasst. Er prueft
// NICHT mehr etwas, das ein Nutzer gerade erreichen koennte – der Weg dorthin
// existiert in der Oberflaeche nicht.
console.log('\n── messages (Tabelle steht, Oberflaeche entfernt) ──');

// Seit 20260907010000 darf ein Client gar nicht mehr hineinschreiben.
// ---------------------------------------------------------------------------
// Der Grund steht in der Migration: Eine tote Tabelle mit offenen
// Schreibrechten ist eine Flaeche, auf der jemand unbegrenzt Zeilen ablegen
// kann, die niemand ansieht – und jede davon ging zusaetzlich als
// Realtime-Ereignis hinaus.
//
// Das wird hier zuerst geprueft, denn es ist der Zustand, mit dem die Seite
// live geht.
await expectFail('Ein Client kann nicht mehr in messages schreiben', WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`,
    [WHALE, 'geht nicht mehr']));

// Und JETZT das Recht befristet zurueckgeben, um die Regeln selbst zu pruefen.
// ---------------------------------------------------------------------------
// Die Linksperre, die Taktgrenze, der serverseitige Bestandsstempel: Die
// Regeln stehen alle noch, und sie sollen weiter stimmen – sonst waere der
// Chat nicht "umkehrbar entfernt", sondern kaputt und niemand wuesste es.
//
// Ohne diesen Kunstgriff gaebe es nur zwei Moeglichkeiten, und beide sind
// schlecht: die fuenfzehn Pruefungen loeschen (dann faellt beim Zurueckdrehen
// niemandem etwas auf), oder das Recht dauerhaft lassen (dann ist das Loch
// wieder da).
await client.query('grant insert, delete on public.messages to authenticated');
await client.query('drop policy if exists messages_insert on public.messages');
await client.query('drop policy if exists messages_admin_delete on public.messages');
await client.query(`create policy messages_insert on public.messages
  for insert to authenticated
  with check (app.jwt_wallet() is not null and wallet = app.jwt_wallet())`);
await client.query(`create policy messages_admin_delete on public.messages
  for delete to authenticated using (app.is_admin())`);

await asWallet(WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`, [WHALE, 'endlich. warte seit wochen.']));
await asWallet(SHRIMP, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`, [SHRIMP, 'wen muss ich bestechen für ein airdrop']));
await asWallet(ADMIN, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`, [ADMIN, 'gm. neue polls kommen heute.']));

const stamped = await asWallet(WHALE, () =>
  client.query(`select wallet, snap_tokens, snap_usd from public.messages where wallet=$1`, [WHALE]));
check('Bestand wird serverseitig gestempelt',
  Number(stamped.rows[0].snap_usd) === 3793.87 && Number(stamped.rows[0].snap_tokens) === 903302,
  `${stamped.rows[0].snap_tokens} / $${stamped.rows[0].snap_usd}`);

const faked = await asWallet(SHRIMP, async () => {
  await client.query(
    `insert into public.messages (wallet, body, snap_tokens, snap_usd) values ($1,$2,$3,$4)`,
    [SHRIMP, 'ich bin ein whale, ehrlich', 999_999_999, 999_999_999]);
  return client.query(`select snap_usd from public.messages where body like 'ich bin ein whale%'`);
});
check('Selbst gesetzter Token-Wert wird überschrieben',
  Number(faked.rows[0].snap_usd) === 32.5, `$${faked.rows[0].snap_usd}`);

const spoofed = await asWallet(SHRIMP, async () => {
  await client.query(`insert into public.messages (wallet, body) values ($1,$2)`, [WHALE, 'gefälschter absender']);
  return client.query(`select wallet from public.messages where body='gefälschter absender'`);
});
check('Fremder Absender wird auf die eigene Wallet korrigiert',
  spoofed.rows[0].wallet === SHRIMP, spoofed.rows[0].wallet.slice(0, 3));

const feed = await asWallet(SHRIMP, () =>
  client.query(`select count(*)::int c from public.messages where snap_usd >= 1000`));
check('Filter nach $-Wert liefert nur Wale', feed.rows[0].c === 1, `${feed.rows[0].c} Nachricht(en)`);

console.log('\n── Abstimmungen ──');

await expectFail('Nicht-Admin kann keine Abstimmung anlegen', WHALE, () =>
  client.query(`insert into public.polls (question) values ('darf ich das?')`));

const poll = await asWallet(ADMIN, async () => {
  const p = await client.query(
    `insert into public.polls (question) values ($1) returning id`,
    ['Nächster Call: Memecoin-Basket oder Bluechips?']);
  const id = p.rows[0].id;
  const opts = await client.query(
    `insert into public.poll_options (poll_id, label, idx)
     values ($1,'Memecoin-Basket',0), ($1,'Bluechips',1), ($1,'Cash bleiben',2) returning id`, [id]);
  return { id, options: opts.rows.map((r) => r.id) };
});
check('Ansem legt Abstimmung an', poll.options.length === 3);

await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet, weight_usd, weight_tokens) values ($1,$2,$3,$4,$5)`,
  [poll.id, poll.options[0], WHALE, 500_000, 500_000]));
await asWallet(SHRIMP, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [poll.id, poll.options[1], SHRIMP]));
// Hier stimmte Ansem noch mit, und die Zahlen darunter rechneten mit seiner
// Stimme. Seit 20260825060000_admin_does_not_vote.sql weist die Datenbank sie
// ab – er stellt die Frage, legt die Antworten fest und schliesst ab.
await expectFail('Ansem stimmt in seiner eigenen Abstimmung nicht mit', ADMIN, () =>
  client.query(`insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
    [poll.id, poll.options[1], ADMIN]));

const results = await asWallet(WHALE, () => client.query(
  `select o.label, coalesce(r.usd,0) usd, coalesce(r.votes,0) votes
   from public.poll_options o
   left join public.poll_results r on r.option_id = o.id
   where o.poll_id = $1 order by o.idx`, [poll.id]));
const usd = results.rows.map((r) => Number(r.usd));
check('Stimmgewicht = $-Wert aus wallets, nicht vom Client',
  usd[0] === 3793.87, `$${usd[0]} statt der gesendeten $500.000`);
check('Ergebnis zeigt Stimmenzahl und $-Summe getrennt',
  usd[0] > usd[1] && Number(results.rows[1].votes) === 1,
  `Option A: 1 Stimme / $${usd[0]} · Option B: ${results.rows[1].votes} Stimme / $${usd[1]}`);

await asWallet(WHALE, () => client.query(
  `update public.votes set option_id=$1 where poll_id=$2 and wallet=$3`, [poll.options[2], poll.id, WHALE]));
const afterSwitch = await asWallet(WHALE, () => client.query(
  `select sum(votes)::int v from public.poll_results where poll_id=$1`, [poll.id]));
check('Umentscheiden erzeugt keine zweite Stimme', afterSwitch.rows[0].v === 2, `${afterSwitch.rows[0].v} Stimmen`);

await expectFail('Für eine fremde Wallet abstimmen geht nicht', SHRIMP, () =>
  client.query(`insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
    [poll.id, poll.options[0], WHALE]));

await expectFail('Wallet ohne Token hat kein Stimmrecht', GHOST, () =>
  client.query(`insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
    [poll.id, poll.options[0], GHOST]));

const otherPoll = await asWallet(ADMIN, async () => {
  const p = await client.query(`insert into public.polls (question) values ('Andere Frage') returning id`);
  const o = await client.query(
    `insert into public.poll_options (poll_id, label, idx) values ($1,'X',0) returning id`, [p.rows[0].id]);
  return o.rows[0].id;
});
await expectFail('Option aus einer anderen Abstimmung wird abgelehnt', DOLPHIN, () =>
  client.query(`insert into public.votes (poll_id, option_id, wallet) values ($1, $2, $3)`,
    [poll.id, otherPoll, DOLPHIN]));

await asWallet(ADMIN, () => client.query(`update public.polls set closed=true where id=$1`, [poll.id]));
await expectFail('Beendete Abstimmung nimmt keine Stimmen mehr', GHOST, () =>
  client.query(`insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
    [poll.id, poll.options[0], GHOST]));

console.log('\n── Stimmgewicht folgt dem Bestand ──');

/** Direkt als Service-Role gelesen, ohne RLS. */
const weightOf = async (pollId, wallet) => (await client.query(
  `select weight_tokens t, weight_usd u from public.votes where poll_id=$1 and wallet=$2`,
  [pollId, wallet])).rows[0] ?? null;

const setBalance = (wallet, tokens, usd) => client.query(
  `update public.wallets set ui_amount=$2, usd_value=$3, updated_at=now() where address=$1`,
  [wallet, tokens, usd]);

const live = await asWallet(ADMIN, async () => {
  const p = await client.query(
    `insert into public.polls (question) values ('Buyback oder Burn?') returning id`);
  const o = await client.query(
    `insert into public.poll_options (poll_id, label, idx)
     values ($1,'Buyback',0), ($1,'Burn',1) returning id`, [p.rows[0].id]);
  return { id: p.rows[0].id, options: o.rows.map((r) => r.id) };
});

await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [live.id, live.options[0], WHALE]));
check('Gewicht beim Abstimmen entspricht dem Bestand',
  Number((await weightOf(live.id, WHALE)).u) === 3793.87);

await setBalance(WHALE, 451_651, 1_896.94);
check('Verkauf der Hälfte halbiert das Stimmgewicht sofort',
  Number((await weightOf(live.id, WHALE)).u) === 1896.94,
  `$${(await weightOf(live.id, WHALE)).u}`);

// Der eigentliche Angriff: dasselbe Guthaben zweimal abstimmen lassen,
// indem man es an eine zweite Wallet weiterschickt.
await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [live.id, live.options[1], DOLPHIN]));
const before = Number((await client.query(
  `select coalesce(sum(weight_usd),0) s from public.votes where poll_id=$1`, [live.id])).rows[0].s);

await setBalance(WHALE, 0, 0);                         // Wal schickt alles weg
await setBalance(DOLPHIN, 572_051, 2_402.62);          // und es kommt beim Delfin an

check('Geleerte Wallet verliert ihre Stimme', (await weightOf(live.id, WHALE)) === null);
const after = Number((await client.query(
  `select coalesce(sum(weight_usd),0) s from public.votes where poll_id=$1`, [live.id])).rows[0].s);
check('Weiterschicken erzeugt kein zusätzliches Gewicht',
  Math.abs(after - 2402.62) < 0.01,
  `vorher $${before.toFixed(2)} (zwei Wallets), nachher $${after.toFixed(2)} (eine)`);

// Beendete Abstimmungen dürfen sich nicht rückwirkend ändern.
const frozenBefore = Number((await weightOf(poll.id, SHRIMP)).u);
await setBalance(SHRIMP, 0, 0);
const frozenAfter = await weightOf(poll.id, SHRIMP);
check('Beendete Abstimmung bleibt eingefroren',
  frozenAfter !== null && Number(frozenAfter.u) === frozenBefore,
  `$${frozenBefore} bleibt $${frozenAfter?.u}`);

// Ausgangszustand wiederherstellen – der Wal kauft zurück.
await setBalance(SHRIMP, 7_739, 32.5);
await setBalance(WHALE, 903_302, 3_793.87);
check('Zurückgekaufte Token bringen die gelöschte Stimme nicht zurück',
  (await weightOf(live.id, WHALE)) === null);

// ---------------------------------------------------------------------------
console.log('\n── Das Gewicht selbst schreiben ──');
//
// Die Prüfungen darüber gehen alle den vorgesehenen Weg: abstimmen, umstimmen,
// Bestand ändern. Hier geht es um den Weg daneben – ein PATCH über PostgREST
// mit dem öffentlichen anon-Key und der eigenen Sitzung.
//
// Das ging bis Migration 20260903010000. Der Stempel-Trigger hing an
// "before insert or update OF option_id"; wer option_id in Ruhe ließ und nur
// weight_usd schrieb, löste ihn nicht aus. Eine Wallet mit $32,50 konnte sich
// $99.999.999 Stimmgewicht eintragen, und poll_results meldete es weiter.
//
// Von selbst geheilt hätte es sich nicht: sync_votes_with_balance läuft nur,
// wenn sich der BESTAND ändert. Wer danach nichts mehr bewegt, behält seine
// Zahl – bei geschlossenen Abstimmungen für immer.
const gewichtVon = async (pollId, wallet) => Number((await client.query(
  `select weight_usd u from public.votes where poll_id=$1 and wallet=$2`,
  [pollId, wallet])).rows[0]?.u);

await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)
   on conflict (poll_id, wallet) do update set option_id = excluded.option_id`,
  [live.id, live.options[0], DOLPHIN]));
const ehrlich = await gewichtVon(live.id, DOLPHIN);

// Kein expectFail: Ein mitgeschickter Wert wird ÜBERSCHRIEBEN, nicht
// abgelehnt. Absichtlich so – ein PostgREST-Client schickt beim upsert ganze
// Zeilen mit, und eine Absage träfe auch den ehrlichen Fall.
await asWallet(DOLPHIN, () => client.query(
  `update public.votes set weight_usd = 99999999, weight_tokens = 24000000000
    where poll_id=$1 and wallet=$2`, [live.id, DOLPHIN]));
check('Ein selbst geschriebenes Gewicht wird überschrieben',
  (await gewichtVon(live.id, DOLPHIN)) === ehrlich,
  `$${ehrlich} bleibt $${await gewichtVon(live.id, DOLPHIN)}`);

// Die Gegenprobe, dass hier überhaupt etwas geprüft wird: Die ehrliche Zahl
// darf nicht zufällig auch die gefälschte sein.
check('Vorprobe: die ehrliche Zahl ist eine andere', ehrlich > 0 && ehrlich < 99999999,
  `$${ehrlich}`);

await expectFail('Eine Stimme lässt sich nicht in eine andere Abstimmung hängen',
  DOLPHIN, () => client.query(
    `update public.votes set poll_id=$1 where poll_id=$2 and wallet=$3`,
    [poll.id, live.id, DOLPHIN]));

// Der eindeutige Schlüssel (poll_id, wallet) fängt das NICHT – er verhindert
// Doppelte, keine Umzüge. Und die fremde Wallet fängt schon die Regel weg.
await expectFail('Und nicht auf eine andere Wallet',
  DOLPHIN, () => client.query(
    `update public.votes set wallet=$1 where poll_id=$2 and wallet=$3`,
    [GHOST, live.id, DOLPHIN]));

// Der schlimmere der beiden Fälle: Bei einer geschlossenen Abstimmung gilt das
// Ergebnis als endgültig. Es stand aber in einer Zeile, die ihr Eigentümer
// weiter anfassen durfte.
const beendetVorher = await gewichtVon(poll.id, SHRIMP);
await expectFail('Eine geschlossene Abstimmung nimmt gar keine Änderung mehr an',
  SHRIMP, () => client.query(
    `update public.votes set weight_usd = 555000000 where poll_id=$1 and wallet=$2`,
    [poll.id, SHRIMP]));
check('Ihr Ergebnis steht danach unverändert da',
  (await gewichtVon(poll.id, SHRIMP)) === beendetVorher,
  `$${beendetVorher}`);

// Und der ehrliche Weg muss weiter gehen – eine Sperre, die auch das Richtige
// abweist, ist keine Lösung, sondern der nächste Fehlerbericht.
await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)
   on conflict (poll_id, wallet)
   do update set poll_id = excluded.poll_id, option_id = excluded.option_id,
                 wallet = excluded.wallet`,
  [live.id, live.options[1], DOLPHIN]));
check('Die Antwort zu wechseln geht weiter – genau wie die App es tut',
  Number((await client.query(
    `select option_id o from public.votes where poll_id=$1 and wallet=$2`,
    [live.id, DOLPHIN])).rows[0].o) === Number(live.options[1]));

await setBalance(DOLPHIN, 200_000, 840.00);
check('Und ein geänderter Bestand zieht die offene Stimme weiter nach',
  (await gewichtVon(live.id, DOLPHIN)) === 840,
  `$${await gewichtVon(live.id, DOLPHIN)}`);
// Ueber der DM-Schwelle von $1000: Der Delfin schreibt weiter unten eine DM,
// und die Schwelle ist seit 20260831020000 kein Dollar mehr, sondern tausend.
await setBalance(DOLPHIN, 120_400, 1_505.68);

console.log('\n── Links ──');

const linkCases = [
  ['check this https://scam-site.com', true],
  ['t.me/pumpgroup', true],
  ['join discord.gg/abc', true],
  ['scam[.]com', true],
  ['scam (dot) com now', true],
  ['scam DOT com', true],
  ['www.foo.bar', true],
  ['HTTPS://LOUD.XYZ', true],
  ['gm', false],
  ['price is $1.25 rn', false],
  ['up 20.5% today', false],
  ['z.b so nicht', false],
  ['i think 0.001 sol is fine', false],
];
let linkOk = 0;
for (const [text, shouldBlock] of linkCases) {
  const r = await client.query('select app.contains_link($1) as hit', [text]);
  const hit = r.rows[0].hit;
  if (hit === shouldBlock) linkOk++;
  else console.log(`      ! "${text}" -> erkannt: ${hit}, erwartet: ${shouldBlock}`);
}
check('Linkerkennung trifft in allen Fällen richtig', linkOk === linkCases.length,
  `${linkOk}/${linkCases.length}`);

await client.query('delete from public.messages where wallet=$1', [WHALE]);
await expectFail('Link in messages wird abgelehnt', WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, 'ape here https://rug.xyz')`, [WHALE]));

await asWallet(ADMIN, () => client.query(
  `insert into public.messages (wallet, body) values ($1, 'offiziell: https://ansem.example.com')`, [ADMIN]));
check('Ansem darf Links posten', true);

await asWallet(WHALE, () => client.query(
  `insert into public.dms (wallet, body) values ($1, 'hier der link: https://meine-seite.com')`, [WHALE]));
check('In DMs sind Links weiterhin erlaubt', true);
// Wieder entfernen, damit die DM-Tests unten von einem sauberen Stand ausgehen.
await client.query(`delete from public.dms where body like 'hier der link%'`);

console.log('\n── DMs ──');

await asWallet(WHALE, () => client.query(
  `insert into public.dms (wallet, body) values ($1,$2)`, [WHALE, 'Interesse an einem OTC-Block?']));
// Der Shrimp haelt $32,50. Seit 20260831020000_dm_schwelle_1000.sql sind das
// zu wenig – hier stand frueher ein glatter insert, weil die Schwelle damals
// noch bei einem Dollar lag. Der Delfin uebernimmt seinen Platz.
await expectFail('Unter der Schwelle kommt keine DM durch', SHRIMP, () =>
  client.query(`insert into public.dms (wallet, body) values ($1,$2)`,
    [SHRIMP, 'bruder bitte ein airdrop']));
await asWallet(DOLPHIN, () => client.query(
  `insert into public.dms (wallet, body) values ($1,$2)`, [DOLPHIN, 'bruder bitte ein airdrop']));

const mine = await asWallet(WHALE, () => client.query(`select wallet from public.dms`));
check('Nutzer sieht ausschließlich den eigenen Thread',
  mine.rows.length === 1 && mine.rows[0].wallet === WHALE, `${mine.rows.length} Zeile(n)`);

const inbox = await asWallet(ADMIN, () => client.query(
  `select wallet, tokens, unread, preview from public.dm_threads order by tokens desc`));
check('Ansem sieht alle Threads', inbox.rows.length === 2);
check('Posteingang nach Token-Bestand sortiert',
  inbox.rows[0].wallet === WHALE && Number(inbox.rows[0].tokens) > Number(inbox.rows[1].tokens),
  inbox.rows.map((r) => `${r.wallet.slice(0, 3)}:${Math.round(r.tokens)}`).join(' > '));
check('Ungelesen-Zähler stimmt', Number(inbox.rows[0].unread) === 1);

const fremdeThreads = await asWallet(DOLPHIN, () => client.query(`select wallet from public.dm_threads`));
check('dm_threads verrät Nicht-Admins keine fremden Threads',
  fremdeThreads.rows.length === 1 && fremdeThreads.rows[0].wallet === DOLPHIN);

// Der Shrimp stand hier, und der Test bestand – aber am falschen Netz: Er
// haelt $32,50, und die DM-Schwelle von $1000 hat ihn abgewiesen, bevor die
// Regel ueber from_admin ueberhaupt drankam. Ein gruener Haken, der ueber die
// Sperre, um die es geht, gar nichts sagte.
//
// Der Delfin liegt ueber der Schwelle. Und die Meldung wird mitgeprueft: Sie
// muss aus der RLS-Regel kommen, nicht aus dem Mindestbestand.
const alsAnsem = await expectFail('Niemand kann sich als Ansem ausgeben', DOLPHIN, () =>
  client.query(`insert into public.dms (wallet, from_admin, body) values ($1, true, $2)`,
    [WHALE, 'hier spricht ansem, schick mir sol']));
check('Und zwar an der richtigen Regel, nicht am Mindestbestand',
  /row-level security/i.test(alsAnsem?.message ?? ''),
  (alsAnsem?.message ?? '').split('\n')[0].slice(0, 70));

await asWallet(ADMIN, () => client.query(
  `insert into public.dms (wallet, from_admin, body) values ($1, true, $2)`,
  [WHALE, 'schreib mir auf tg, gleicher handle.']));
const reply = await asWallet(WHALE, () => client.query(
  `select count(*)::int c from public.dms where from_admin`));
check('Antwort von Ansem landet im Thread des Nutzers', reply.rows[0].c === 1);

console.log('\n── Rate-Limits ──');

// Sechs Nachrichten gehen durch, die siebte innerhalb derselben Minute nicht.
let sent = 0;
try {
  for (let i = 0; i < 9; i++) {
    await asWallet(DOLPHIN, () => client.query(
      `insert into public.messages (wallet, body) values ($1, $2)`, [DOLPHIN, `spam ${i}`]));
    sent++;
  }
} catch { /* erwartet */ }
check('messages bremst nach 6 Nachrichten pro Minute', sent === 6, `${sent} durchgelassen`);

await expectFail('Die siebte Nachricht wird abgelehnt', DOLPHIN, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, 'noch eine')`, [DOLPHIN]));

// --- Wiederholungen sind wieder erlaubt ---
//
// Hier stand eine Sperre gegen dieselbe Nachricht zweimal hintereinander.
// 20260827020000_doppelte_erlauben_link_hinweis.sql hat sie entfernt: In einem
// Chat sagt man Dinge zweimal, weil die erste Nachricht untergegangen ist. Der
// Spamschutz sitzt bei der Taktgrenze, nicht beim Wortlaut.
//
// Die Pruefungen darunter behaupteten das Gegenteil und sind seitdem falsch.
// Sie stehen jetzt andersherum da – die Sperre darf nicht zurueckkommen, ohne
// dass es hier auffaellt.
await client.query(`delete from public.messages where wallet=$1`, [GHOST]);
await client.query(
  `insert into public.wallets (address, ui_amount, usd_value, price) values ($1, 5000, 21, 0.0042)
   on conflict (address) do update set ui_amount=5000, usd_value=21`, [GHOST]);

const wiederholt = [];
for (const text of ['wen muss ich bestechen', 'wen muss ich bestechen',
                    '  WEN   muss ich   bestechen  ']) {
  try {
    await asWallet(GHOST, () => client.query(
      `insert into public.messages (wallet, body) values ($1, $2)`, [GHOST, text]));
    wiederholt.push('durch');
  } catch (e) { wiederholt.push(`blockiert (${e.message.slice(0, 40)})`); }
}
check('Dieselbe Nachricht darf zweimal hintereinander kommen',
  wiederholt.every((w) => w === 'durch'), wiederholt.join(' · '));

// Ansem ist ausgenommen – er soll nicht gebremst werden.
let adminSent = 0;
try {
  for (let i = 0; i < 15; i++) {
    await asWallet(ADMIN, () => client.query(
      `insert into public.messages (wallet, body) values ($1, $2)`, [ADMIN, `ansem ${i}`]));
    adminSent++;
  }
} catch { /* sollte nicht passieren */ }
check('Ansem wird nicht gebremst', adminSent === 15, `${adminSent} durchgelassen`);

// Das befristete Recht wieder einziehen – ab hier gilt wieder der Zustand,
// mit dem die Seite live geht. Ohne diese Zeilen prueften alle folgenden
// Abschnitte gegen eine Datenbank, die es so nicht gibt.
await client.query('drop policy if exists messages_insert on public.messages');
await client.query('drop policy if exists messages_admin_delete on public.messages');
await client.query('revoke insert, delete on public.messages from authenticated');
await expectFail('Gegenprobe: danach ist messages wieder dicht', WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`,
    [WHALE, 'und jetzt nicht mehr']));

// GHOST haelt aus den Taktgrenzen-Tests darueber 5.000 Token / $21 – zu wenig
// fuer eine DM, seit die Schwelle bei $1000 liegt. Ohne diese Zeile misst der
// Test unten nicht die Taktgrenze, sondern den Mindestbestand, und meldet
// "0 durchgelassen" statt 5.
await client.query(
  `update public.wallets set ui_amount = 400000, usd_value = 1680 where address = $1`,
  [GHOST]);

let dmSent = 0;
try {
  for (let i = 0; i < 7; i++) {
    await asWallet(GHOST, () => client.query(
      `insert into public.dms (wallet, body) values ($1, $2)`, [GHOST, `dm ${i}`]));
    dmSent++;
  }
} catch { /* erwartet */ }
check('DMs bremsen nach 5 pro Minute', dmSent === 5, `${dmSent} durchgelassen`);

await asWallet(ADMIN, () => client.query(
  `insert into public.dms (wallet, from_admin, body) values ($1, true, 'antwort')`, [GHOST]));
check('Ansems Antworten unterliegen keinem Limit', true);

const pending = await client.query('select public.pending_challenge_count() c');
check('pending_challenge_count liefert eine Zahl', Number.isInteger(pending.rows[0].c),
  `${pending.rows[0].c} offen`);

await expectFail('pending_challenge_count ist nicht für Clients', WHALE, () =>
  client.query('select public.pending_challenge_count()'));

console.log('\n── Interne Tabellen ──');

await expectFail('challenges sind für Clients unsichtbar', WHALE, () =>
  client.query(`select * from public.challenges`));
await expectFail('seen_txs sind für Clients unsichtbar', WHALE, () =>
  client.query(`select * from public.seen_txs`));
await expectFail('Niemand kann sich selbst eine Challenge ausstellen', WHALE, () =>
  client.query(`insert into public.challenges (wallet, lamports, expires_at)
                values ($1, 2000001, now() + interval '1 hour')`, [WHALE]));
await expectFail('wallets_to_refresh ist nicht für Clients', WHALE, () =>
  client.query(`select * from public.wallets_to_refresh(0, 10, true)`));

const wRead = await asWallet(SHRIMP, () => client.query(`select count(*)::int c from public.wallets`));
check('Bestände sind lesbar (für die Anzeige im Posteingang)', wRead.rows[0].c >= 4, `${wRead.rows[0].c} Wallets`);

await expectFail('Bestand lässt sich nicht selbst hochschreiben', SHRIMP, () =>
  client.query(`update public.wallets set usd_value = 10000000 where address=$1`, [SHRIMP]));

const inOneHour = new Date(Date.now() + 3_600_000);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at) values ($1, 2000123, $2)`,
  [WHALE, inOneHour]);
// Der Betrag ist EINDEUTIG JE WALLET, nicht global.
//
// Global war er es einmal, und das kostete Nachkommastellen: Um genug
// verschiedene Beträge zu haben, ging der Aufschlag bis auf das Lamport
// hinunter – 0.002043217 SOL, neun Stellen. In Phantom auf dem Handy lässt
// sich das nicht eintippen, die letzte Stelle fällt weg, und die Zahlung
// passt auf keine Challenge. Das Geld ist weg und niemand sieht warum.
//
// Global eindeutig muss der Betrag auch gar nicht sein: scanTreasury gleicht
// zusätzlich die ABSENDERADRESSE ab. Eine fremde Zahlung käme aus einer
// fremden Wallet und passt schon deshalb nicht.
let dupFremd = true;
try {
  await client.query(
    `insert into public.challenges (wallet, lamports, expires_at) values ($1, 2000123, $2)`,
    [SHRIMP, inOneHour]);
} catch { dupFremd = false; }
check('Zwei VERSCHIEDENE Wallets dürfen denselben Betrag offen haben', dupFremd);

let dupSelbe = false;
try {
  await client.query(
    `insert into public.challenges (wallet, lamports, expires_at) values ($1, 2000123, $2)`,
    [WHALE, inOneHour]);
} catch { dupSelbe = true; }
check('DIESELBE Wallet aber nicht zweimal denselben', dupSelbe);
await client.query(`delete from public.challenges where wallet=$1 and lamports=2000123`, [SHRIMP]);

await client.query(`update public.challenges set status='used' where lamports=2000123`);
let freedAgain = true;
try {
  await client.query(
    `insert into public.challenges (wallet, lamports, expires_at) values ($1, 2000123, $2)`,
    [SHRIMP, inOneHour]);
} catch { freedAgain = false; }
check('Betrag wird wieder frei, sobald die Challenge erledigt ist', freedAgain);

let dupSig = false;
await client.query(
  `insert into public.seen_txs (signature, sender, lamports) values ('sig-1', $1, 2000123)`, [WHALE]);
try {
  await client.query(
    `insert into public.seen_txs (signature, sender, lamports) values ('sig-1', $1, 2000123)`, [SHRIMP]);
} catch { dupSig = true; }
check('Eine Transaktionssignatur kann nur einmal verbucht werden', dupSig);

const refreshList = await client.query(`select * from public.wallets_to_refresh(0, 100, true)`);
check('wallets_to_refresh liefert nur Wallets mit offener Stimme',
  refreshList.rows.length > 0 && refreshList.rows.every((r) => r.address === DOLPHIN),
  refreshList.rows.map((r) => r.address.slice(0, 3)).join(', '));

// ── Grenzen für Frage, Antwort und Antwortzahl ─────────────────────────────
//
// Die Zahlen stehen doppelt: im Formular (app.js) und hier. Das Formular ist
// die Höflichkeit – es sagt beim Tippen, wo Schluss ist. Die Sperre ist die
// Datenbank, denn PostgREST nimmt jeden insert an, der durch die Zeilenregeln
// kommt. Wer den Browser umgeht, landet hier.
//
// Warum die Zahlen 100, 60 und 4 sind, steht in den Migrationen und in
// test-poll-bild.mjs: Alle drei sind an der Karte gemessen, die nach draußen
// geht. Hier wird nur geprüft, dass die Datenbank sie WIRKLICH durchsetzt.
// ── Challenges gehoeren ihrem Ersteller ────────────────────────────────────
//
// Der Rest der Sperre steht in verify (Geheimnis, Abdruck, Eigentumspruefung)
// und wird von test-anmeldung-uebernahme.mjs geprueft. Hier geht es um das,
// was nur die Datenbank durchsetzen kann.
console.log('\n── Challenges ──');

const offeneChallenge = (wallet, lamports) => client.query(
  `insert into public.challenges (wallet, lamports, expires_at, secret_hash)
   values ($1, $2, now() + interval '20 minutes', $3)`,
  [wallet, lamports, 'a'.repeat(64)]);

const CH = 'CHALLENGExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
await client.query(`delete from public.challenges where wallet = $1`, [CH]);
for (let i = 0; i < 3; i++) await offeneChallenge(CH, 9_100_000 + i);
check('Drei offene Challenges je Wallet gehen durch', true);

// Ohne Obergrenze koennte jemand fuer eine FREMDE Adresse tausende oeffnen und
// die Betraege besetzen – der eindeutige Index macht jeden exklusiv, und es
// gibt nur 100.000. Das waere keine Uebernahme mehr, aber eine verschlossene
// Tuer fuer den Richtigen.
let vierte = null;
try { await offeneChallenge(CH, 9_100_009); }
catch (e) { vierte = e.message; }
check('Die vierte wird abgewiesen', vierte !== null, (vierte ?? '').slice(0, 60));

// Abgelaufene zaehlen nicht mit – sonst waere die Wallet nach einer Stunde
// Herumprobieren dauerhaft gesperrt.
await client.query(
  `update public.challenges set expires_at = now() - interval '1 minute' where wallet = $1`, [CH]);
await offeneChallenge(CH, 9_100_010);
check('Abgelaufene zählen nicht mit', true);

// Und der Altbestand: offene Challenges ohne Abdruck sind nach der Migration
// abgelaufen. Man sieht ihnen nicht an, ob sie einem Angreifer gehoeren.
await client.query(`delete from public.challenges where wallet = $1`, [CH]);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at)
   values ($1, 9200000, now() + interval '20 minutes')`, [CH]);
const ohneAbdruck = await client.query(
  `select secret_hash from public.challenges where wallet = $1`, [CH]);
check('Eine neue Challenge OHNE Abdruck ist möglich – die Spalte ist optional',
  ohneAbdruck.rows[0].secret_hash === null,
  'verify setzt ihn immer; die Spalte bleibt nullable für den Altbestand');

console.log('\n── Längen und Anzahl ──');

const grenzeAus = (name) => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const m = new RegExp(`const ${name} = (\\d+);`).exec(app);
  if (!m) throw new Error(`${name} nicht in app.js gefunden`);
  return Number(m[1]);
};
const MAX_FRAGE = grenzeAus('MAX_FRAGE');
const MAX_ANTWORT = grenzeAus('MAX_ANTWORT');
const MAX_OPTIONEN = grenzeAus('MAX_OPTIONEN');

const gehtDurch = async (sql, werte) => {
  try { await client.query(sql, werte); return true; } catch { return false; }
};

// Genau auf der Grenze muss es gehen, ein Zeichen darüber nicht. Beide Seiten
// prüfen, sonst bestünde der Test auch eine Datenbank, die gar nichts annimmt.
const fr = await client.query(
  `insert into public.polls (question) values ($1) returning id`, ['x'.repeat(MAX_FRAGE)]);
check(`Eine Frage mit genau ${MAX_FRAGE} Zeichen wird angenommen`, fr.rows.length === 1);
check(`Eine mit ${MAX_FRAGE + 1} nicht`,
  !await gehtDurch(`insert into public.polls (question) values ($1)`, ['x'.repeat(MAX_FRAGE + 1)]));

const pollId = fr.rows[0].id;
check(`Eine Antwort mit genau ${MAX_ANTWORT} Zeichen wird angenommen`,
  await gehtDurch(`insert into public.poll_options (poll_id, label, idx) values ($1, $2, 0)`,
    [pollId, 'y'.repeat(MAX_ANTWORT)]));
check(`Eine mit ${MAX_ANTWORT + 1} nicht`,
  !await gehtDurch(`insert into public.poll_options (poll_id, label, idx) values ($1, $2, 1)`,
    [pollId, 'y'.repeat(MAX_ANTWORT + 1)]));

// Die App legt ALLE Antworten in einem einzigen insert an – der Trigger läuft
// deshalb pro Anweisung. Beide Wege prüfen: alle auf einmal, und eine zu viel
// nachgeschoben.
const alleAufEinmal = await client.query(
  `insert into public.polls (question) values ('Alle auf einmal') returning id`);
check(`${MAX_OPTIONEN} Antworten in EINEM insert gehen durch`,
  await gehtDurch(
    `insert into public.poll_options (poll_id, label, idx)
     select $1, 'A'||g, g from generate_series(1, $2) g`, [alleAufEinmal.rows[0].id, MAX_OPTIONEN]));
check(`Eine ${MAX_OPTIONEN + 1}. nachgeschoben wird abgewiesen`,
  !await gehtDurch(`insert into public.poll_options (poll_id, label, idx) values ($1, 'zuviel', 99)`,
    [alleAufEinmal.rows[0].id]));

const zuVieleAufEinmal = await client.query(
  `insert into public.polls (question) values ('Zu viele auf einmal') returning id`);
check(`Und ${MAX_OPTIONEN + 1} in EINEM insert auch`,
  !await gehtDurch(
    `insert into public.poll_options (poll_id, label, idx)
     select $1, 'A'||g, g from generate_series(1, $2) g`,
    [zuVieleAufEinmal.rows[0].id, MAX_OPTIONEN + 1]));
// Und der abgewiesene insert darf nichts zurücklassen.
const restlos = await client.query(
  `select count(*)::int c from public.poll_options where poll_id = $1`, [zuVieleAufEinmal.rows[0].id]);
check('Der abgewiesene insert lässt keine halbe Abstimmung zurück',
  restlos.rows[0].c === 0, `${restlos.rows[0].c} Antworten übrig`);

// Der Fall, der beim Bauen des Triggers fast schiefgegangen wäre: Eine alte
// Abstimmung mit mehr Antworten darf NEUE Abstimmungen nicht blockieren. Eine
// Zählung über die ganze Tabelle hätte genau das getan.
await client.query(`alter table public.poll_options disable trigger trg_poll_options_anzahl`);
const alt = await client.query(
  `insert into public.polls (question) values ('Alt und zu gross') returning id`);
await client.query(
  `insert into public.poll_options (poll_id, label, idx)
   select $1, 'Alt '||g, g from generate_series(1, $2) g`, [alt.rows[0].id, MAX_OPTIONEN + 3]);
await client.query(`alter table public.poll_options enable trigger trg_poll_options_anzahl`);
const neuTrotzAlt = await client.query(
  `insert into public.polls (question) values ('Neu neben alt') returning id`);
check('Eine bestehende zu große Abstimmung blockiert neue nicht',
  await gehtDurch(
    `insert into public.poll_options (poll_id, label, idx)
     select $1, 'Neu '||g, g from generate_series(1, 2) g`, [neuTrotzAlt.rows[0].id]));


// ---------------------------------------------------------------------------
console.log('\n── Die Summen laufen nicht auseinander ──');
// ---------------------------------------------------------------------------
//
// public.poll_totals wird beim SCHREIBEN fortgeschrieben, statt beim Lesen
// gebildet zu werden. Das ist der Grund, warum ein Abruf 0,03 statt 55 ms
// kostet – und zugleich die Gefahr: Eine fortgeschriebene Summe kann von den
// Zeilen abweichen, aus denen sie entstand. Passiert das, sieht man es nicht.
// Die Balken stehen einfach falsch, und niemand merkt es, weil es keine
// zweite Zahl gibt, gegen die man vergleichen könnte.
//
// Also gibt es hier eine: Nach JEDER Operation wird die mitgeführte Summe
// gegen eine frisch gebildete gestellt. Weicht sie ab, ist der Trigger kaputt.

/** Vergleicht public.poll_totals mit einer frisch gebildeten Summe. */
async function summenStimmen(label) {
  const { rows } = await client.query(`
    select coalesce(t.option_id, f.option_id) as option_id,
           coalesce(t.votes, 0) as t_votes, coalesce(f.votes, 0) as f_votes,
           coalesce(t.usd, 0)   as t_usd,   coalesce(f.usd, 0)   as f_usd
      from public.poll_totals t
      full outer join (
        select option_id, count(*) as votes, sum(weight_usd) as usd
          from public.votes group by option_id
      ) f on f.option_id = t.option_id
     where coalesce(t.votes, 0) <> coalesce(f.votes, 0)
        or coalesce(t.usd, 0)   <> coalesce(f.usd, 0)`);
  check(label, rows.length === 0,
    rows.length ? `${rows.length} Zeile(n) weichen ab: ${JSON.stringify(rows[0])}` : '');
}

// Eine eigene Abstimmung, damit die Prüfungen oben unberührt bleiben.
const sumPoll = await client.query(
  `insert into public.polls (question) values ('Summenprobe') returning id`);
const sumP = sumPoll.rows[0].id;
const sumOpts = await client.query(
  `insert into public.poll_options (poll_id, label, idx)
   values ($1,'A',0), ($1,'B',1) returning id`, [sumP]);
const [optA, optB] = sumOpts.rows.map((r) => r.id);

await summenStimmen('Vor der ersten Stimme sind beide leer');

// 1. Abstimmen
await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [sumP, optA, WHALE]));
await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [sumP, optA, DOLPHIN]));
await summenStimmen('Nach zwei Stimmen auf dieselbe Antwort');

const nachZwei = await client.query(
  `select votes, usd from public.poll_totals where option_id=$1`, [optA]);
check('Und die Summe ist nicht nur konsistent, sondern richtig',
  Number(nachZwei.rows[0].votes) === 2
    && Math.abs(Number(nachZwei.rows[0].usd) - (3793.87 + 1505.68)) < 0.01,
  `${nachZwei.rows[0].votes} Stimmen, $${nachZwei.rows[0].usd}`);

// 2. Meinung ändern – die Stimme wandert auf die andere Antwort. Genau hier
//    muss die alte Zeile abgezogen UND die neue addiert werden; wer nur
//    addiert, zählt den Wal für immer doppelt.
await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)
   on conflict (poll_id, wallet) do update set option_id = excluded.option_id`,
  [sumP, optB, WHALE]));
await summenStimmen('Nach einem Wechsel der Antwort');
const nachWechsel = await client.query(
  `select option_id, votes from public.poll_totals where poll_id=$1 order by option_id`, [sumP]);
check('Der Wechsel zählt nicht doppelt',
  nachWechsel.rows.every((r) => Number(r.votes) === 1),
  nachWechsel.rows.map((r) => r.votes).join(' / '));

// 3. Der Bestand ändert sich -> app.sync_votes_with_balance schreibt die
//    Gewichte offener Stimmen neu. Die Summe muss mitwandern.
await client.query(
  `update public.wallets set ui_amount = 500000, usd_value = 2000 where address = $1`, [WHALE]);
await summenStimmen('Nachdem sich ein Bestand geändert hat');
const nachBestand = await client.query(
  `select usd from public.poll_totals where option_id=$1`, [optB]);
check('Und sie trägt den neuen Betrag, nicht den alten',
  Math.abs(Number(nachBestand.rows[0].usd) - 2000) < 0.01, `$${nachBestand.rows[0].usd}`);

// 4. Der Bestand fällt auf null -> die Stimme wird gelöscht. Wer nichts mehr
//    hält, wiegt nichts mehr – und darf auch nicht mehr in der Summe stehen.
await client.query(
  `update public.wallets set ui_amount = 0, usd_value = 0 where address = $1`, [WHALE]);
await summenStimmen('Nachdem eine Stimme wegen Bestand 0 gelöscht wurde');
const nachNull = await client.query(
  `select votes, usd from public.poll_totals where option_id=$1`, [optB]);
check('Die gelöschte Stimme ist aus der Summe verschwunden',
  Number(nachNull.rows[0].votes) === 0 && Number(nachNull.rows[0].usd) === 0,
  `${nachNull.rows[0].votes} Stimmen, $${nachNull.rows[0].usd}`);

// 5. Gegenprobe zur Gegenprobe: Der Vergleich oben muss eine Abweichung auch
//    WIRKLICH melden. Ohne diese Zeile prüfte summenStimmen() womöglich nur,
//    dass zwei leere Mengen gleich sind.
await client.query(`update public.poll_totals set votes = votes + 7 where option_id = $1`, [optA]);
const vorherFehler = failures;
const stilleAusgabe = console.log;
console.log = () => {};                     // der absichtliche Fehlschlag gehört nicht ins Protokoll
await summenStimmen('(absichtlich verbogen)');
console.log = stilleAusgabe;
const hatAngeschlagen = failures === vorherFehler + 1;
failures = vorherFehler;                    // und er zählt auch nicht
check('Gegenprobe: eine von Hand verbogene Summe wird bemerkt', hatAngeschlagen)
await client.query(`select app.poll_totals_neu_aufbauen()`);
await summenStimmen('Und der Neuaufbau bringt sie zurück in Deckung');

// 6. Die Abstimmung löschen -> die Summenzeilen müssen mitgehen, sonst wachsen
//    sie ewig weiter.
await client.query(`delete from public.polls where id = $1`, [sumP]);
const reste = await client.query(
  `select count(*)::int n from public.poll_totals where poll_id = $1`, [sumP]);
check('Mit der Abstimmung verschwinden auch ihre Summenzeilen',
  reste.rows[0].n === 0, `${reste.rows[0].n} übrig`);
await summenStimmen('Und danach stimmt alles wieder');

// Und das Ganze ist nur etwas wert, wenn der Browser diese Zahlen auch liest.
const sichtQuelle = await client.query(
  `select pg_get_viewdef('public.poll_results'::regclass) as def`);
check('public.poll_results liest aus der Summentabelle, nicht mehr aus votes',
  /poll_totals/.test(sichtQuelle.rows[0].def) && !/\bvotes\b\s+v\b/.test(sichtQuelle.rows[0].def),
  sichtQuelle.rows[0].def.replace(/\s+/g, ' ').slice(0, 70));

await expectFail('Und niemand kann die Summen von aussen verbiegen', WHALE, () =>
  client.query(`update public.poll_totals set usd = 99999999`));


// ---------------------------------------------------------------------------
console.log('\n── DM-Stups: wer bekommt ihn, und wer darf zuhören ──');
// ---------------------------------------------------------------------------
//
// Der teuerste Pfad der ganzen Seite lief bis eben über postgres_changes: Bei
// jeder DM prüft Supabase die Rechte EINZELN für jeden Zuhörer. Eine Nachricht
// an Ansem bei 3.000 offenen Seiten waren 3.000 Prüfungen, einfädig.
//
// Jetzt schickt ein Trigger einen Stups an genau zwei Kanäle. Zwei Dinge
// müssen dafür stimmen, und beide fallen sonst nicht auf:
//   1. der Stups geht an die RICHTIGEN zwei Kanäle
//   2. er trägt KEINEN Inhalt
//   3. fremde dürfen den Kanal nicht betreten

// DOLPHIN und nicht WHALE: WHALEs Bestand wurde weiter oben auf 0 gesetzt,
// er faellt seitdem durch die DM-Schwelle. Genau so ein stiller Seiteneffekt
// hat hier schon einmal eine Pruefung aus dem falschen Grund gruen gemacht.
await client.query(`delete from realtime.messages`);
await asWallet(DOLPHIN, () => client.query(
  `insert into public.dms (wallet, body) values ($1, 'Stups-Probe')`, [DOLPHIN]));

const stupse = await client.query(
  `select topic, event, payload, private, extension from realtime.messages order by topic`);

check('Eine DM löst genau zwei Stupse aus, nicht mehr',
  stupse.rows.length === 2, `${stupse.rows.length}`);
check('Einer an den Thread des Absenders',
  stupse.rows.some((r) => r.topic === `dm:${DOLPHIN}`),
  stupse.rows.map((r) => r.topic).join(', '));
check('Einer an Ansems Posteingang',
  stupse.rows.some((r) => r.topic === 'dm:admin'));
check('Beide als privater Broadcast',
  stupse.rows.every((r) => r.private === true && r.extension === 'broadcast'));

// Der wichtigste Punkt: Selbst wenn die Zugangsregel unten je falsch wäre,
// darf über diesen Weg kein Nachrichtentext abfliessen.
const inhalte = JSON.stringify(stupse.rows.map((r) => r.payload));
check('Kein Stups trägt den Nachrichtentext',
  !inhalte.includes('Stups-Probe'), inhalte.slice(0, 90));
check('Und auch keine Beträge',
  !/snap_usd|snap_tokens|"usd"/.test(inhalte));

// ---------------------------------------------------------------------------
// Die Zugangsregel: Wer darf welchen Kanal betreten?
// ---------------------------------------------------------------------------
// Die Supabase-Doku zeigt als Beispiel `using (true)`. Damit könnte jeder
// Angemeldete dm:<fremde-adresse> betreten und mitbekommen, WANN diese Person
// mit Ansem schreibt – kein Inhalt, aber ein Bewegungsprofil.

/** Darf `wallet` den Kanal `topic` betreten? Fragt die echte Regel. */
async function darfBetreten(wallet, topic) {
  return asWallet(wallet, async () => {
    await client.query(`select set_config('realtime.topic', $1, true)`, [topic]);
    const { rows } = await client.query(`select count(*)::int n from realtime.messages`);
    return rows[0].n > 0;
  });
}

check('Der Eigentümer darf seinen eigenen Thread hören',
  await darfBetreten(DOLPHIN, `dm:${DOLPHIN}`));
check('Ein Fremder darf ihn NICHT hören',
  !(await darfBetreten(WHALE, `dm:${DOLPHIN}`)));
check('Ansem darf den Posteingang hören',
  await darfBetreten(ADMIN, 'dm:admin'));
check('Ein normaler Nutzer NICHT',
  !(await darfBetreten(DOLPHIN, 'dm:admin')));
// Gegenprobe zur Gegenprobe: Wenn gar nichts sichtbar waere, waeren alle
// Verneinungen oben gratis richtig.
check('Gegenprobe: es gibt überhaupt etwas zu sehen',
  await darfBetreten(ADMIN, 'dm:admin'));

// Und die Regel gilt nur fuer Broadcasts, nicht fuer alles in der Tabelle.
await client.query(
  `insert into realtime.messages (topic, extension, event, payload, private)
   values ($1, 'presence', 'x', '{}'::jsonb, true)`, [`dm:${DOLPHIN}`]);
const nurBroadcast = await asWallet(DOLPHIN, async () => {
  await client.query(`select set_config('realtime.topic', $1, true)`, [`dm:${DOLPHIN}`]);
  const { rows } = await client.query(
    `select extension, count(*)::int n from realtime.messages group by extension`);
  return rows;
});
check('Und sie lässt nur Broadcasts durch, nichts anderes',
  nurBroadcast.every((r) => r.extension === 'broadcast'),
  nurBroadcast.map((r) => `${r.extension}:${r.n}`).join(', '));

// Niemand darf selbst senden: keine insert-Regel = kein vorgetäuschtes
// Klingeln bei Ansem und kein Antreiben fremder Browser.
// Das Recht zum Einfuegen ist in der Attrappe ausdruecklich ERTEILT. Was hier
// blockiert, ist also die fehlende insert-Regel und nicht ein fehlendes
// GRANT – sonst pruefte diese Zeile etwas anderes, als sie behauptet.
await expectFail('Niemand kann selbst einen Stups losschicken', DOLPHIN, () =>
  client.query(
    `insert into realtime.messages (topic, extension, event, payload, private)
     values ('dm:admin', 'broadcast', 'dm', '{}'::jsonb, true)`));

// Gegenprobe zur Zugangsregel.
//
// Die Supabase-Doku zeigt als Beispiel `using (true)`. Waere die Regel so
// gebaut, muessten die vier Pruefungen oben trotzdem gruen sein – dann
// pruefen sie nichts. Also einmal absichtlich falsch machen und nachsehen,
// ob es auffaellt.
await client.query(`
  alter policy dm_stups_empfangen on realtime.messages using (true)`);
const laschDurch = await darfBetreten(WHALE, `dm:${DOLPHIN}`);
await client.query(`
  alter policy dm_stups_empfangen on realtime.messages using (
    extension = 'broadcast'
    and ((select realtime.topic()) = 'dm:' || app.jwt_wallet()
         or ((select realtime.topic()) = 'dm:admin' and app.is_admin())))`);
check('Gegenprobe: mit der laschen Regel aus der Doku käme ein Fremder durch',
  laschDurch);
check('Und mit unserer wieder nicht',
  !(await darfBetreten(WHALE, `dm:${DOLPHIN}`)));

// public.dms darf nicht mehr in der Veroeffentlichung stehen – sonst liefe
// die teure Haelfte munter weiter und der Umbau waere umsonst.
const wanderungDm = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260904010000_dm_broadcast.sql'), 'utf8');
check('public.dms verlässt die Realtime-Veröffentlichung',
  /drop table public\.dms/.test(wanderungDm));

// ── Was vor dem Start gehaertet wurde ──────────────────────────────────────
//
// Vier Loecher, keines davon von einer der 22 Reihen gefunden. Der Grund ist
// derselbe bei allen: Die Reihen pruefen, ob die Regeln tun, was sie sollen.
// Hier ging es um Regeln, die es gar nicht gab – und was es nicht gibt, misst
// auch keiner.
console.log('\n── Haertung vor dem Start ──');

// 1. created_at gehoert der Datenbank
// ---------------------------------------------------------------------------
// Der Angriff war nicht, eine Nachricht zu faelschen, sondern die ZAEHLUNG zu
// umgehen: Beide Sperren gegen Spam zaehlen nach Zeit, und wer created_at
// selbst mitschickt, steht in keinem Fenster.
await client.query(`update public.wallets set ui_amount = 400000, usd_value = 5000
                    where address = $1`, [WHALE]);
await asWallet(WHALE, () => client.query(
  `insert into public.dms (wallet, body, created_at) values ($1, $2, '1990-01-01')`,
  [WHALE, 'aus der vergangenheit']));
const gestempelt = await client.query(
  `select created_at from public.dms where body = 'aus der vergangenheit'`);
check('created_at kommt vom Server, nicht vom Client',
  new Date(gestempelt.rows[0].created_at).getFullYear() >= 2020,
  String(gestempelt.rows[0].created_at));

// Und die Wirkung, um die es geht: Mit gefaelschtem Datum muss die Taktgrenze
// trotzdem greifen. Ohne den Trigger liefen hier alle zehn durch.
let ausVergangenheit = 0;
try {
  for (let i = 0; i < 10; i++) {
    await asWallet(WHALE, () => client.query(
      `insert into public.dms (wallet, body, created_at) values ($1, $2, '1990-01-01')`,
      [WHALE, `alt ${i}`]));
    ausVergangenheit++;
  }
} catch { /* die Taktgrenze greift – genau das ist der Punkt */ }
check('Die Taktgrenze greift auch bei gefaelschtem created_at',
  ausVergangenheit < 10, `${ausVergangenheit} von 10 durchgelassen`);

// 2. Abgelaufene Challenges geben ihren Betrag frei
// ---------------------------------------------------------------------------
// Sonst laesst sich eine fremde Adresse aussperren: 999 moegliche Betraege,
// drei offene Challenges gleichzeitig, 25 Minuten Laufzeit – nach gut sechs
// Tagen ist jede Zahl belegt und der Besitzer kommt nicht mehr herein.
await client.query(`delete from public.challenges`);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at, status)
   values ($1, 2000123, now() - interval '1 hour', 'pending')`, [SHRIMP]);
// Der zweite insert traegt DENSELBEN Betrag. Er muss durchgehen – und wenn
// nicht, ist genau das der Befund und kein Absturz: Ohne das Aufraeumen weist
// der Unique-Index ihn ab, und dann darf der Test das melden, statt hier
// stehenzubleiben und die drei Abschnitte danach gar nicht erst zu erreichen.
let zweiteChallenge = true;
try {
  await client.query(
    `insert into public.challenges (wallet, lamports, expires_at, status)
     values ($1, 2000123, now() + interval '20 minutes', 'pending')`, [SHRIMP]);
} catch { zweiteChallenge = false; }
check('Der Betrag einer abgelaufenen Challenge ist wieder zu haben',
  zweiteChallenge, zweiteChallenge ? '' : 'Unique-Index weist ihn ab');
// Die zweite Zeile traegt DENSELBEN Betrag wie die erste. Dass ihr insert
// oben durchgelaufen ist, ist der Beweis: Ohne das Aufraeumen haette der
// Unique-Index auf (wallet, lamports) where status = 'pending' sie abgewiesen.
const frei = await client.query(
  `select status, count(*)::int n from public.challenges where wallet = $1
   group by status order by status`, [SHRIMP]);
const zaehler = Object.fromEntries(frei.rows.map((r) => [r.status, r.n]));
check('Derselbe Betrag ist nach Ablauf wieder zu haben',
  zaehler.pending === 1 && zaehler.expired === 1,
  frei.rows.map((r) => `${r.status}:${r.n}`).join(' '));
const abgelaufen = await client.query(
  `select count(*)::int n from public.challenges
   where wallet = $1 and status = 'expired'`, [SHRIMP]);
check('Die abgelaufene Zeile steht auf expired, nicht mehr auf pending',
  abgelaufen.rows[0].n === 1, `${abgelaufen.rows[0].n} aufgeraeumt`);

// 3. Lesen setzt einen wallet-Claim voraus
// ---------------------------------------------------------------------------
// Ein Token mit role: authenticated aber OHNE wallet-Claim ist genau das, was
// Supabases eigene Anmeldewege ausstellen – "Anonymous sign-ins" reicht. Damit
// war vorher die komplette Wallet-Tabelle zu lesen.
async function ohneClaim(sql) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`);
    await client.query('set local role authenticated');
    const r = await client.query(sql);
    return r.rows.length;
  } finally { await client.query('rollback'); }
}
for (const [name, sql] of [
  ['wallets', 'select address from public.wallets limit 5'],
  ['polls', 'select id from public.polls limit 5'],
  ['votes', 'select id from public.votes limit 5'],
  ['poll_totals', 'select poll_id from public.poll_totals limit 5'],
]) {
  check(`Ohne wallet-Claim ist ${name} leer`, (await ohneClaim(sql)) === 0);
}
// Gegenprobe: MIT Claim liest dieselbe Abfrage sehr wohl – sonst haette ich
// die Tabellen nur leergeraeumt und der Test saehe trotzdem gruen aus.
const mitClaim = await asWallet(WHALE, () =>
  client.query('select address from public.wallets limit 5'));
check('Gegenprobe: mit wallet-Claim sind sie es nicht',
  mitClaim.rows.length > 0, `${mitClaim.rows.length} Zeilen`);

// 4. read_by_admin gehoert dem Server
// ---------------------------------------------------------------------------
// Ein Nutzer konnte seine DM als gelesen einliefern. Kein Datenabfluss – aber
// Ansem entscheidet nach diesem Zaehler, wem er antwortet.
await client.query(`delete from public.dms where wallet = $1`, [DOLPHIN]);
await client.query(`update public.wallets set usd_value = 5000 where address = $1`, [DOLPHIN]);
await asWallet(DOLPHIN, () => client.query(
  `insert into public.dms (wallet, body, read_by_admin) values ($1, $2, true)`,
  [DOLPHIN, 'schon gelesen, angeblich']));
const gelesen = await client.query(
  `select read_by_admin from public.dms where body = 'schon gelesen, angeblich'`);
check('read_by_admin laesst sich nicht vom Client setzen',
  gelesen.rows[0].read_by_admin === false, String(gelesen.rows[0].read_by_admin));

console.log(`\n${failures === 0 ? '✅ Alle Prüfungen bestanden' : `❌ ${failures} Prüfung(en) fehlgeschlagen`}\n`);
await client.end();
process.exit(failures === 0 ? 0 : 1);
