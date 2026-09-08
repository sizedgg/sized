/**
 * Tests the migrations against a real Postgres instance.
 *
 * The point is explicitly not "does the SQL run", but the question: what
 * can a user who talks to PostgREST directly forge? Every test therefore
 * simulates a client with a set JWT claim.
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

/** Runs statements as "authenticated" with a set wallet claim. */
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

/** Expects the operation to fail. Returns the error message. */
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
// Wipe everything, not table by table.
//
// There used to be a hand-maintained list here: drop table dms, votes,
// poll_options, ... And that's exactly where something slipped through. A
// new table (public.poll_totals) wasn't on the list, survived the cleanup,
// and let "create table if not exists" in the migration silently NO-OP.
// Result: a table without its foreign keys, and a test that was checking
// something other than what the migration actually says.
//
// This time it turned into a finding. It could just as easily have gone
// the other way - a green check for a migration that never ran.
//
// So: the whole schema gone and rebuilt. Whatever the migrations don't
// create themselves doesn't exist afterward.
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

// The storage part of Supabase, as far as the migration needs it.
//
// Without this, this script hasn't even started running since
// 20260827010000_og_bilder.sql: the migration creates a bucket and attaches
// policies to storage.objects, and neither exists in a bare Postgres. The
// failure hit on the FIRST line, so every check below it had also never run
// since then - they were just sitting there.
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

// The realtime part of Supabase, as far as the migrations need it.
//
// Same story as storage above: 20260904010000_dm_broadcast attaches an
// access policy to realtime.messages and calls realtime.send() from a
// trigger. Neither exists in a bare Postgres.
//
// realtime.send() here doesn't write into the void, it writes into a table -
// that way it's possible to check afterward WHICH pings the trigger actually
// sent out. A stub that swallows everything would measure nothing.
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

  -- What Supabase plugs in as the channel name in its permission check. Here
  -- it's a session variable, so the test can run through different channels.
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

// Second pass: migrations must be idempotent.
for (let i = 0; i < files.length; i++) await client.query(migrations[i]);
check('Migrationen sind idempotent (zweiter Lauf ohne Fehler)', true);

// --- Seed as "service role" (RLS is deliberately bypassed here) ---
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

// ── messages: the table is still there, the UI isn't ──
//
// Chat was removed from the app. Nothing was deleted in the database: the
// table, the RLS policies, the link block, and the rate limit are all
// unchanged, and the messages are still sitting there. That was the
// decision - this way everything stays reversible.
//
// So this section keeps running: it checks whether the rules still do what
// they're supposed to, in case someone touches the table again. It no
// longer checks anything a user could actually reach right now - the path
// there doesn't exist in the UI.
console.log('\n── messages (Tabelle steht, Oberflaeche entfernt) ──');

// Since 20260907010000, a client can no longer write into it at all.
// ---------------------------------------------------------------------------
// The reason is in the migration: a dead table with open write access is a
// surface where anyone can drop an unlimited number of rows that nobody
// looks at - and each one also went out as a realtime event on top.
//
// This is checked first here, because it's the state the site goes live
// with.
await expectFail('Ein Client kann nicht mehr in messages schreiben', WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`,
    [WHALE, 'geht nicht mehr']));

// And NOW grant the right back temporarily, to check the rules themselves.
// ---------------------------------------------------------------------------
// The link block, the rate limit, the server-side balance stamp: the rules
// are all still there, and they should still be correct - otherwise chat
// wouldn't be "reversibly removed", it would just be broken and nobody
// would know.
//
// Without this trick there would only be two options, and both are bad:
// delete the fifteen checks (then nobody notices anything if this ever gets
// turned back on), or leave the grant in place permanently (then the hole
// is back).
await client.query('grant insert, delete on public.messages to authenticated');
await client.query('drop policy if exists messages_insert on public.messages');
await client.query('drop policy if exists messages_admin_delete on public.messages');
await client.query(`create policy messages_insert on public.messages
  for insert to authenticated
  with check (app.jwt_wallet() is not null and wallet = app.jwt_wallet())`);
await client.query(`create policy messages_admin_delete on public.messages
  for delete to authenticated using (app.is_admin())`);

await asWallet(WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`, [WHALE, 'endlich. wait seit wochen.']));
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
// Ansem used to vote here too, and the numbers below counted his vote. Since
// 20260825060000_admin_does_not_vote.sql the database rejects it - he asks
// the question, sets the answers, and closes it out.
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

await expectFail('Für eine fremde Wallet castVote geht nicht', SHRIMP, () =>
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

/** Read directly as service role, without RLS. */
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

// The actual attack: getting the same balance to vote twice by forwarding
// it to a second wallet.
await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [live.id, live.options[1], DOLPHIN]));
const before = Number((await client.query(
  `select coalesce(sum(weight_usd),0) s from public.votes where poll_id=$1`, [live.id])).rows[0].s);

await setBalance(WHALE, 0, 0);                         // whale sends it all away
await setBalance(DOLPHIN, 572_051, 2_402.62);          // and it lands on the dolphin

check('Geleerte Wallet verliert ihre Stimme', (await weightOf(live.id, WHALE)) === null);
const after = Number((await client.query(
  `select coalesce(sum(weight_usd),0) s from public.votes where poll_id=$1`, [live.id])).rows[0].s);
check('Weiterschicken erzeugt kein zusätzliches Gewicht',
  Math.abs(after - 2402.62) < 0.01,
  `vorher $${before.toFixed(2)} (zwei Wallets), nachher $${after.toFixed(2)} (eine)`);

// Closed polls must not change retroactively.
const frozenBefore = Number((await weightOf(poll.id, SHRIMP)).u);
await setBalance(SHRIMP, 0, 0);
const frozenAfter = await weightOf(poll.id, SHRIMP);
check('Beendete Abstimmung bleibt eingefroren',
  frozenAfter !== null && Number(frozenAfter.u) === frozenBefore,
  `$${frozenBefore} bleibt $${frozenAfter?.u}`);

// Restore the starting state - the whale buys back in.
await setBalance(SHRIMP, 7_739, 32.5);
await setBalance(WHALE, 903_302, 3_793.87);
check('Zurückgekaufte Token bringen die gelöschte Stimme nicht zurück',
  (await weightOf(live.id, WHALE)) === null);

// ---------------------------------------------------------------------------
console.log('\n── Das Gewicht selbst schreiben ──');
//
// The checks above all take the intended path: vote, change your vote,
// change your balance. This is about the path beside it - a PATCH over
// PostgREST with the public anon key and one's own session.
//
// That worked up through migration 20260903010000. The stamping trigger was
// attached to "before insert or update OF option_id"; whoever left option_id
// alone and only wrote weight_usd never triggered it. A wallet with $32.50
// could set its own vote weight to $99,999,999, and poll_results reported it
// right along.
//
// It wouldn't have healed itself: sync_votes_with_balance only runs when the
// BALANCE changes. Whoever moves nothing after that keeps their number - on
// closed polls, forever.
const gewichtVon = async (pollId, wallet) => Number((await client.query(
  `select weight_usd u from public.votes where poll_id=$1 and wallet=$2`,
  [pollId, wallet])).rows[0]?.u);

await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)
   on conflict (poll_id, wallet) do update set option_id = excluded.option_id`,
  [live.id, live.options[0], DOLPHIN]));
const ehrlich = await gewichtVon(live.id, DOLPHIN);

// No expectFail: a value sent along gets OVERWRITTEN, not rejected.
// Deliberately so - a PostgREST client sends whole rows on an upsert, and a
// rejection would also hit the honest case.
await asWallet(DOLPHIN, () => client.query(
  `update public.votes set weight_usd = 99999999, weight_tokens = 24000000000
    where poll_id=$1 and wallet=$2`, [live.id, DOLPHIN]));
check('Ein selbst geschriebenes Gewicht wird überschrieben',
  (await gewichtVon(live.id, DOLPHIN)) === ehrlich,
  `$${ehrlich} bleibt $${await gewichtVon(live.id, DOLPHIN)}`);

// The control check that anything is even being verified here: the honest
// number must not accidentally also be the forged one.
check('Vorprobe: die ehrliche Zahl ist eine andere', ehrlich > 0 && ehrlich < 99999999,
  `$${ehrlich}`);

await expectFail('Eine Stimme lässt sich nicht in eine andere Abstimmung hängen',
  DOLPHIN, () => client.query(
    `update public.votes set poll_id=$1 where poll_id=$2 and wallet=$3`,
    [poll.id, live.id, DOLPHIN]));

// The unique key (poll_id, wallet) does NOT catch this - it prevents
// duplicates, not moves. And a foreign wallet is already caught by the
// policy.
await expectFail('Und nicht auf eine andere Wallet',
  DOLPHIN, () => client.query(
    `update public.votes set wallet=$1 where poll_id=$2 and wallet=$3`,
    [GHOST, live.id, DOLPHIN]));

// The worse of the two cases: on a closed poll, the result counts as final.
// But it lived in a row its owner was still allowed to touch.
const beendetVorher = await gewichtVon(poll.id, SHRIMP);
await expectFail('Eine geschlossene Abstimmung nimmt gar keine Änderung mehr an',
  SHRIMP, () => client.query(
    `update public.votes set weight_usd = 555000000 where poll_id=$1 and wallet=$2`,
    [poll.id, SHRIMP]));
check('Ihr Ergebnis steht danach unverändert da',
  (await gewichtVon(poll.id, SHRIMP)) === beendetVorher,
  `$${beendetVorher}`);

// And the honest path still has to keep working - a lock that also rejects
// the legitimate case isn't a fix, it's the next bug report.
await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)
   on conflict (poll_id, wallet)
   do update set poll_id = excluded.poll_id, option_id = excluded.option_id,
                 wallet = excluded.wallet`,
  [live.id, live.options[1], DOLPHIN]));
check('Die Antwort zu wechseln geht next – genau wie die App es tut',
  Number((await client.query(
    `select option_id o from public.votes where poll_id=$1 and wallet=$2`,
    [live.id, DOLPHIN])).rows[0].o) === Number(live.options[1]));

await setBalance(DOLPHIN, 200_000, 840.00);
check('Und ein geänderter Bestand zieht die offene Stimme next nach',
  (await gewichtVon(live.id, DOLPHIN)) === 840,
  `$${await gewichtVon(live.id, DOLPHIN)}`);
// Above the $1000 DM threshold: the dolphin writes a DM further down, and
// since 20260831020000 the threshold is no longer a dollar, it's a
// thousand.
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
// Remove it again, so the DM tests below start from a clean state.
await client.query(`delete from public.dms where body like 'hier der link%'`);

console.log('\n── DMs ──');

await asWallet(WHALE, () => client.query(
  `insert into public.dms (wallet, body) values ($1,$2)`, [WHALE, 'Interesse an einem OTC-Block?']));
// The shrimp holds $32.50. Since 20260831020000_dm_schwelle_1000.sql that's
// no longer enough - this used to be a plain insert, back when the
// threshold still sat at one dollar. The dolphin takes its place.
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

// The shrimp used to be here, and the test passed - but on the wrong basis:
// it holds $32.50, and the $1000 DM threshold rejected it before the
// from_admin rule ever got a chance to fire. A green check that said
// nothing about the lock it was supposed to be testing.
//
// The dolphin sits above the threshold. And the error message gets checked
// too: it has to come from the RLS policy, not from the minimum balance.
const alsAnsem = await expectFail('Niemand kann sich als Ansem ausgeben', DOLPHIN, () =>
  client.query(`insert into public.dms (wallet, from_admin, body) values ($1, true, $2)`,
    [WHALE, 'hier spricht ansem, schick mir sol']));
check('Und zwar an der richtigen Regel, nicht am Mindestbestand',
  /row-level security/i.test(alsAnsem?.message ?? ''),
  (alsAnsem?.message ?? '').split('\n')[0].slice(0, 70));

await asWallet(ADMIN, () => client.query(
  `insert into public.dms (wallet, from_admin, body) values ($1, true, $2)`,
  [WHALE, 'write mir auf tg, gleicher handle.']));
const reply = await asWallet(WHALE, () => client.query(
  `select count(*)::int c from public.dms where from_admin`));
check('Antwort von Ansem landet im Thread des Nutzers', reply.rows[0].c === 1);

console.log('\n── Rate-Limits ──');

// Six messages go through, the seventh within the same minute doesn't.
let sent = 0;
try {
  for (let i = 0; i < 9; i++) {
    await asWallet(DOLPHIN, () => client.query(
      `insert into public.messages (wallet, body) values ($1, $2)`, [DOLPHIN, `spam ${i}`]));
    sent++;
  }
} catch { /* expected */ }
check('messages bremst nach 6 Nachrichten pro Minute', sent === 6, `${sent} durchgelassen`);

await expectFail('Die siebte Nachricht wird abgelehnt', DOLPHIN, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, 'noch eine')`, [DOLPHIN]));

// --- Repeats are allowed again ---
//
// There used to be a block against the same message twice in a row.
// 20260827020000_doppelte_erlauben_link_hinweis.sql removed it: in a chat,
// people say things twice because the first message got lost in the noise.
// Spam protection lives in the rate limit, not in the wording.
//
// The checks below used to claim the opposite and were wrong ever since.
// They now stand the other way around - the block must not come back
// without this catching it.
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

// Ansem is exempt - he shouldn't be rate-limited.
let adminSent = 0;
try {
  for (let i = 0; i < 15; i++) {
    await asWallet(ADMIN, () => client.query(
      `insert into public.messages (wallet, body) values ($1, $2)`, [ADMIN, `ansem ${i}`]));
    adminSent++;
  }
} catch { /* shouldn't happen */ }
check('Ansem wird nicht gebremst', adminSent === 15, `${adminSent} durchgelassen`);

// Revoke the temporary grant again - from here on, the state matches what
// the site goes live with again. Without these lines, every section below
// would be testing against a database that doesn't actually exist.
await client.query('drop policy if exists messages_insert on public.messages');
await client.query('drop policy if exists messages_admin_delete on public.messages');
await client.query('revoke insert, delete on public.messages from authenticated');
await expectFail('Gegenprobe: danach ist messages wieder dicht', WHALE, () =>
  client.query(`insert into public.messages (wallet, body) values ($1, $2)`,
    [WHALE, 'und jetzt nicht mehr']));

// GHOST holds 5,000 tokens / $21 from the rate-limit tests above - not
// enough for a DM now that the threshold sits at $1000. Without this line
// the test below wouldn't measure the rate limit, it would measure the
// minimum balance, and report "0 durchgelassen" instead of 5.
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
} catch { /* expected */ }
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
// The amount is UNIQUE PER WALLET, not globally.
//
// It used to be global, and that cost decimal places: to have enough
// distinct amounts, the surcharge went all the way down to the lamport -
// 0.002043217 SOL, nine digits. On Phantom on a phone that can't be typed
// in, the last digit gets dropped, and the payment matches no challenge.
// The money is gone and nobody sees why.
//
// The amount doesn't even need to be globally unique: scanTreasury also
// matches the SENDER ADDRESS. A payment from someone else would come from a
// different wallet and wouldn't match for that reason alone.
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

// ── Limits for question, answer, and answer count ──────────────────────────
//
// The numbers exist twice: in the form (app.js) and here. The form is the
// courtesy - it tells you while typing where the cutoff is. The lock is the
// database, because PostgREST accepts any insert that gets past the row
// policies. Whoever bypasses the browser ends up here.
//
// Why the numbers are 100, 60, and 4 is explained in the migrations and in
// test-poll-bild.mjs: all three are measured against the card that goes
// out publicly. Here it's only checked that the database REALLY enforces
// them.
// ── Challenges belong to their creator ──────────────────────────────────────
//
// The rest of the lock lives in verify (secret, fingerprint, ownership
// check) and is checked by test-anmeldung-uebernahme.mjs. This is about
// what only the database can enforce.
console.log('\n── Challenges ──');

const openChallenge = (wallet, lamports) => client.query(
  `insert into public.challenges (wallet, lamports, expires_at, secret_hash)
   values ($1, $2, now() + interval '20 minutes', $3)`,
  [wallet, lamports, 'a'.repeat(64)]);

const CH = 'CHALLENGExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
await client.query(`delete from public.challenges where wallet = $1`, [CH]);
for (let i = 0; i < 3; i++) await openChallenge(CH, 9_100_000 + i);
check('Drei offene Challenges je Wallet gehen durch', true);

// Without an upper bound, someone could open thousands for a FOREIGN address
// and occupy the amounts - the unique index makes each one exclusive, and
// there are only 100,000. That wouldn't be a takeover anymore, but it would
// be a locked door for the rightful owner.
let vierte = null;
try { await openChallenge(CH, 9_100_009); }
catch (e) { vierte = e.message; }
check('Die vierte wird abgewiesen', vierte !== null, (vierte ?? '').slice(0, 60));

// Expired ones don't count - otherwise a wallet would end up permanently
// locked out after an hour of trying things.
await client.query(
  `update public.challenges set expires_at = now() - interval '1 minute' where wallet = $1`, [CH]);
await openChallenge(CH, 9_100_010);
check('Abgelaufene zählen nicht mit', true);

// And the legacy rows: open challenges without a fingerprint are expired
// after the migration. There's no way to tell from them whether they belong
// to an attacker.
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
const MAX_QUESTION = grenzeAus('MAX_QUESTION');
const MAX_ANSWER = grenzeAus('MAX_ANSWER');
const MAX_OPTIONEN = grenzeAus('MAX_OPTIONEN');

const passes = async (sql, werte) => {
  try { await client.query(sql, werte); return true; } catch { return false; }
};

// Right at the limit it has to work, one character over it must not. Check
// both sides, otherwise the test would also pass a database that accepts
// nothing at all.
const fr = await client.query(
  `insert into public.polls (question) values ($1) returning id`, ['x'.repeat(MAX_QUESTION)]);
check(`Eine Frage mit genau ${MAX_QUESTION} Zeichen wird angenommen`, fr.rows.length === 1);
check(`Eine mit ${MAX_QUESTION + 1} nicht`,
  !await passes(`insert into public.polls (question) values ($1)`, ['x'.repeat(MAX_QUESTION + 1)]));

const pollId = fr.rows[0].id;
check(`Eine Antwort mit genau ${MAX_ANSWER} Zeichen wird angenommen`,
  await passes(`insert into public.poll_options (poll_id, label, idx) values ($1, $2, 0)`,
    [pollId, 'y'.repeat(MAX_ANSWER)]));
check(`Eine mit ${MAX_ANSWER + 1} nicht`,
  !await passes(`insert into public.poll_options (poll_id, label, idx) values ($1, $2, 1)`,
    [pollId, 'y'.repeat(MAX_ANSWER + 1)]));

// The app creates ALL answers in a single insert - the trigger therefore
// runs per statement. Check both paths: all at once, and one pushed in
// afterward.
const alleAufEinmal = await client.query(
  `insert into public.polls (question) values ('Alle auf einmal') returning id`);
check(`${MAX_OPTIONEN} Antworten in EINEM insert gehen durch`,
  await passes(
    `insert into public.poll_options (poll_id, label, idx)
     select $1, 'A'||g, g from generate_series(1, $2) g`, [alleAufEinmal.rows[0].id, MAX_OPTIONEN]));
check(`Eine ${MAX_OPTIONEN + 1}. nachgeschoben wird abgewiesen`,
  !await passes(`insert into public.poll_options (poll_id, label, idx) values ($1, 'zuviel', 99)`,
    [alleAufEinmal.rows[0].id]));

const zuVieleAufEinmal = await client.query(
  `insert into public.polls (question) values ('Zu viele auf einmal') returning id`);
check(`Und ${MAX_OPTIONEN + 1} in EINEM insert auch`,
  !await passes(
    `insert into public.poll_options (poll_id, label, idx)
     select $1, 'A'||g, g from generate_series(1, $2) g`,
    [zuVieleAufEinmal.rows[0].id, MAX_OPTIONEN + 1]));
// And a rejected insert must not leave anything behind.
const restlos = await client.query(
  `select count(*)::int c from public.poll_options where poll_id = $1`, [zuVieleAufEinmal.rows[0].id]);
check('Der abgewiesene insert lässt keine halbe Abstimmung zurück',
  restlos.rows[0].c === 0, `${restlos.rows[0].c} Antworten übrig`);

// The case that nearly went wrong while building this trigger: an old poll
// with more answers must not block NEW polls. A count over the whole table
// would have done exactly that.
await client.query(`alter table public.poll_options disable trigger trg_poll_options_anzahl`);
const alt = await client.query(
  `insert into public.polls (question) values ('Alt und zu big') returning id`);
await client.query(
  `insert into public.poll_options (poll_id, label, idx)
   select $1, 'Alt '||g, g from generate_series(1, $2) g`, [alt.rows[0].id, MAX_OPTIONEN + 3]);
await client.query(`alter table public.poll_options enable trigger trg_poll_options_anzahl`);
const newDespiteOld = await client.query(
  `insert into public.polls (question) values ('Neu neben alt') returning id`);
check('Eine bestehende zu große Abstimmung blockiert neue nicht',
  await passes(
    `insert into public.poll_options (poll_id, label, idx)
     select $1, 'Neu '||g, g from generate_series(1, 2) g`, [newDespiteOld.rows[0].id]));


// ---------------------------------------------------------------------------
console.log('\n── Die Summen laufen nicht auseinander ──');
// ---------------------------------------------------------------------------
//
// public.poll_totals is kept up to date on WRITE, instead of being computed
// on read. That's why a fetch costs 0.03 ms instead of 55 - and at the same
// time the risk: a running total can drift from the rows it was built from.
// If that happens, you don't see it. The bars are just wrong, and nobody
// notices, because there's no second number to compare against.
//
// So here's one: after EVERY operation, the running total gets checked
// against a freshly computed one. If it's off, the trigger is broken.

/** Compares public.poll_totals against a freshly computed sum. */
async function sumVotes(label) {
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

// A dedicated poll, so the checks above stay untouched.
const sumPoll = await client.query(
  `insert into public.polls (question) values ('Summenprobe') returning id`);
const sumP = sumPoll.rows[0].id;
const sumOpts = await client.query(
  `insert into public.poll_options (poll_id, label, idx)
   values ($1,'A',0), ($1,'B',1) returning id`, [sumP]);
const [optA, optB] = sumOpts.rows.map((r) => r.id);

await sumVotes('Vor der ersten Stimme sind beide empty');

// 1. Voting
await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [sumP, optA, WHALE]));
await asWallet(DOLPHIN, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
  [sumP, optA, DOLPHIN]));
await sumVotes('Nach zwei Stimmen auf dieselbe Antwort');

const nachZwei = await client.query(
  `select votes, usd from public.poll_totals where option_id=$1`, [optA]);
check('Und die Summe ist nicht nur konsistent, sondern richtig',
  Number(nachZwei.rows[0].votes) === 2
    && Math.abs(Number(nachZwei.rows[0].usd) - (3793.87 + 1505.68)) < 0.01,
  `${nachZwei.rows[0].votes} Stimmen, $${nachZwei.rows[0].usd}`);

// 2. Changing one's mind - the vote moves to the other answer. This is
//    exactly where the old row has to be subtracted AND the new one added;
//    whoever only adds ends up counting the whale twice forever.
await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)
   on conflict (poll_id, wallet) do update set option_id = excluded.option_id`,
  [sumP, optB, WHALE]));
await sumVotes('Nach einem Wechsel der Antwort');
const nachWechsel = await client.query(
  `select option_id, votes from public.poll_totals where poll_id=$1 order by option_id`, [sumP]);
check('Der Wechsel zählt nicht doppelt',
  nachWechsel.rows.every((r) => Number(r.votes) === 1),
  nachWechsel.rows.map((r) => r.votes).join(' / '));

// 3. The balance changes -> app.sync_votes_with_balance rewrites the
//    weights of open votes. The total has to move along with it.
await client.query(
  `update public.wallets set ui_amount = 500000, usd_value = 2000 where address = $1`, [WHALE]);
await sumVotes('Nachdem sich ein Bestand geändert hat');
const afterInventory = await client.query(
  `select usd from public.poll_totals where option_id=$1`, [optB]);
check('Und sie trägt den neuen Betrag, nicht den alten',
  Math.abs(Number(afterInventory.rows[0].usd) - 2000) < 0.01, `$${afterInventory.rows[0].usd}`);

// 4. The balance drops to zero -> the vote gets deleted. Whoever holds
//    nothing anymore weighs nothing - and must no longer show up in the
//    total either.
await client.query(
  `update public.wallets set ui_amount = 0, usd_value = 0 where address = $1`, [WHALE]);
await sumVotes('Nachdem eine Stimme wegen Bestand 0 gelöscht wurde');
const nachNull = await client.query(
  `select votes, usd from public.poll_totals where option_id=$1`, [optB]);
check('Die gelöschte Stimme ist aus der Summe verschwunden',
  Number(nachNull.rows[0].votes) === 0 && Number(nachNull.rows[0].usd) === 0,
  `${nachNull.rows[0].votes} Stimmen, $${nachNull.rows[0].usd}`);

// 5. Control check on the control check: the comparison above actually has
//    to REPORT a deviation. Without this line, sumVotes() might only
//    be checking that two empty sets are equal.
await client.query(`update public.poll_totals set votes = votes + 7 where option_id = $1`, [optA]);
const vorherFehler = failures;
const stilleAusgabe = console.log;
console.log = () => {};                     // der absichtliche Fehlschlag gehört nicht ins Protokoll
await sumVotes('(absichtlich verbogen)');
console.log = stilleAusgabe;
const wasHit = failures === vorherFehler + 1;
failures = vorherFehler;                    // und er zählt auch nicht
check('Gegenprobe: eine von Hand verbogene Summe wird bemerkt', wasHit)
await client.query(`select app.poll_totals_neu_aufbauen()`);
await sumVotes('Und der Neuaufbau bringt sie zurück in Deckung');

// 6. Deleting the poll -> the total rows have to go with it, otherwise they
//    just keep growing forever.
await client.query(`delete from public.polls where id = $1`, [sumP]);
const reste = await client.query(
  `select count(*)::int n from public.poll_totals where poll_id = $1`, [sumP]);
check('Mit der Abstimmung verschwinden auch ihre Summenzeilen',
  reste.rows[0].n === 0, `${reste.rows[0].n} übrig`);
await sumVotes('Und danach stimmt alles wieder');

// And all of this is only worth something if the browser actually reads
// these numbers.
const viewSource = await client.query(
  `select pg_get_viewdef('public.poll_results'::regclass) as def`);
check('public.poll_results liest aus der Summentabelle, nicht mehr aus votes',
  /poll_totals/.test(viewSource.rows[0].def) && !/\bvotes\b\s+v\b/.test(viewSource.rows[0].def),
  viewSource.rows[0].def.replace(/\s+/g, ' ').slice(0, 70));

await expectFail('Und niemand kann die Summen von aussen verbiegen', WHALE, () =>
  client.query(`update public.poll_totals set usd = 99999999`));


// ---------------------------------------------------------------------------
console.log('\n── DM-Stups: wer bekommt ihn, und wer darf zuhören ──');
// ---------------------------------------------------------------------------
//
// Until just now, the most expensive path on the whole site ran over
// postgres_changes: on every DM, Supabase checks permissions INDIVIDUALLY
// for every listener. One message to Ansem with 3,000 open pages meant
// 3,000 checks, single-threaded.
//
// Now a trigger sends a ping to exactly two channels. Two things have to
// hold for that, and neither would be obvious if it broke:
//   1. the ping goes to the RIGHT two channels
//   2. it carries NO content
//   3. strangers must not be able to enter the channel

// DOLPHIN and not WHALE: WHALE's balance was set to 0 further up, so it now
// falls below the DM threshold. This exact kind of quiet side effect has
// already once made a check pass here for the wrong reason.
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

// The most important point: even if the access policy below were ever
// wrong, no message text may leak out through this path.
const contents = JSON.stringify(stupse.rows.map((r) => r.payload));
check('Kein Stups trägt den Nachrichtentext',
  !contents.includes('Stups-Probe'), contents.slice(0, 90));
check('Und auch keine Beträge',
  !/snap_usd|snap_tokens|"usd"/.test(contents));

// ---------------------------------------------------------------------------
// The access policy: who may enter which channel?
// ---------------------------------------------------------------------------
// Supabase's own docs show `using (true)` as an example. With that, any
// logged-in user could enter dm:<someone-elses-address> and learn WHEN that
// person writes to Ansem - no content, but an activity profile.

/** May `wallet` enter channel `topic`? Asks the real policy. */
async function canEnter(wallet, topic) {
  return asWallet(wallet, async () => {
    await client.query(`select set_config('realtime.topic', $1, true)`, [topic]);
    const { rows } = await client.query(`select count(*)::int n from realtime.messages`);
    return rows[0].n > 0;
  });
}

check('Der Eigentümer darf seinen eigenen Thread hören',
  await canEnter(DOLPHIN, `dm:${DOLPHIN}`));
check('Ein Fremder darf ihn NICHT hören',
  !(await canEnter(WHALE, `dm:${DOLPHIN}`)));
check('Ansem darf den Posteingang hören',
  await canEnter(ADMIN, 'dm:admin'));
check('Ein normaler Nutzer NICHT',
  !(await canEnter(DOLPHIN, 'dm:admin')));
// Control check on the control check: if nothing were visible at all, every
// denial above would be trivially correct for free.
check('Gegenprobe: es gibt überhaupt etwas zu sehen',
  await canEnter(ADMIN, 'dm:admin'));

// And the policy only applies to broadcasts, not to everything in the
// table.
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

// Nobody may send directly: no insert policy = no faked ringing at Ansem's
// end and no pushing other people's browsers around.
// The insert grant is explicitly GIVEN in the stub. So what's blocking here
// is the missing insert policy, not a missing GRANT - otherwise this line
// would be testing something other than what it claims to.
await expectFail('Niemand kann selbst einen Stups losschicken', DOLPHIN, () =>
  client.query(
    `insert into realtime.messages (topic, extension, event, payload, private)
     values ('dm:admin', 'broadcast', 'dm', '{}'::jsonb, true)`));

// Control check on the access policy.
//
// Supabase's own docs show `using (true)` as an example. If the policy were
// built that way, the four checks above would still all pass - meaning they
// would be checking nothing. So deliberately break it once and see whether
// it gets caught.
await client.query(`
  alter policy dm_stups_empfangen on realtime.messages using (true)`);
const allowedThrough = await canEnter(WHALE, `dm:${DOLPHIN}`);
await client.query(`
  alter policy dm_stups_empfangen on realtime.messages using (
    extension = 'broadcast'
    and ((select realtime.topic()) = 'dm:' || app.jwt_wallet()
         or ((select realtime.topic()) = 'dm:admin' and app.is_admin())))`);
check('Gegenprobe: mit der laschen Regel aus der Doku käme ein Fremder durch',
  allowedThrough);
check('Und mit unserer wieder nicht',
  !(await canEnter(WHALE, `dm:${DOLPHIN}`)));

// public.dms must no longer be listed in the publication - otherwise the
// expensive half would keep running along happily and this whole rework
// would be pointless.
const wanderungDm = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260904010000_dm_broadcast.sql'), 'utf8');
check('public.dms verlässt die Realtime-Veröffentlichung',
  /drop table public\.dms/.test(wanderungDm));

// ── What got hardened before launch ─────────────────────────────────────────
//
// Four holes, none of them found by any of the 22 rows above. The reason is
// the same for all of them: those rows check whether the rules do what
// they're supposed to. This was about rules that didn't exist at all - and
// nobody measures what isn't there.
console.log('\n── Haertung vor dem Start ──');

// 1. created_at belongs to the database
// ---------------------------------------------------------------------------
// The attack wasn't forging a message, it was evading the COUNTING: both
// anti-spam limits count by time, and whoever sends their own created_at
// falls outside every window.
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

// And the effect that actually matters: with a forged date, the rate limit
// still has to apply. Without the trigger, all ten would go through here.
let ausVergangenheit = 0;
try {
  for (let i = 0; i < 10; i++) {
    await asWallet(WHALE, () => client.query(
      `insert into public.dms (wallet, body, created_at) values ($1, $2, '1990-01-01')`,
      [WHALE, `alt ${i}`]));
    ausVergangenheit++;
  }
} catch { /* the rate limit kicks in - that's exactly the point */ }
check('Die Taktgrenze greift auch bei gefaelschtem created_at',
  ausVergangenheit < 10, `${ausVergangenheit} von 10 durchgelassen`);

// 2. Expired challenges free up their amount
// ---------------------------------------------------------------------------
// Otherwise a foreign address could be locked out: 999 possible amounts,
// three open challenges at once, 25 minutes lifetime - after a good six
// days every number is taken and the owner can no longer get in.
// Die zwei Stunden sind kein Zierwert: die Aufraeumung wartet den Nachlauf
// von einer Stunde ab (20260908030000). Mit genau einer Stunde stand dieser
// Test auf der Kante und haette bei jeder Aenderung des Nachlaufs anders
// geantwortet, ohne dass etwas kaputt ist.
await client.query(`delete from public.challenges`);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at, status)
   values ($1, 2000123, now() - interval '2 hours', 'pending')`, [SHRIMP]);
// The second insert carries the SAME amount. It has to go through - and if
// it doesn't, that is exactly the finding, not a crash: without the
// cleanup, the unique index would reject it, and then the test should
// report that, instead of stopping dead here and never reaching the three
// sections after it.
let secondChallenge = true;
try {
  await client.query(
    `insert into public.challenges (wallet, lamports, expires_at, status)
     values ($1, 2000123, now() + interval '20 minutes', 'pending')`, [SHRIMP]);
} catch { secondChallenge = false; }
check('Der Betrag einer abgelaufenen Challenge ist wieder zu haben',
  secondChallenge, secondChallenge ? '' : 'Unique-Index weist ihn ab');
// The second row carries the SAME amount as the first. That its insert went
// through above is the proof: without the cleanup, the unique index on
// (wallet, lamports) where status = 'pending' would have rejected it.
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

// Und die Gegenrichtung, die wichtigere: eine Zeile IM NACHLAUF darf das
// Aufraeumen nicht anfassen.
//
// Der Fall, um den es geht: jemand sendet, die Bestaetigung haengt, er
// drueckt neu. Setzte das Aufraeumen dabei seine alte Zeile auf 'expired',
// findet die spaete Zahlung nichts mehr - die Zuordnung in verify sucht
// 'pending'. Das Geld waere weg, und von aussen kein Grund zu sehen.
await client.query(`delete from public.challenges`);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at, status)
   values ($1, 2000456, now() - interval '10 minutes', 'pending')`, [SHRIMP]);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at, status)
   values ($1, 2000457, now() + interval '20 minutes', 'pending')`, [SHRIMP]);
const imNachlauf = await client.query(
  `select status from public.challenges where wallet = $1 and lamports = 2000456`, [SHRIMP]);
check('Eine Zeile im Nachlauf bleibt offen, wenn eine neue entsteht',
  imNachlauf.rows[0].status === 'pending', imNachlauf.rows[0].status);
// Gegenprobe: dieselbe Zeile, nur zwei Stunden alt, wird sehr wohl geraeumt.
// Ohne sie waere ein Aufraeumen, das gar nichts mehr tut, oben genauso gruen.
await client.query(
  `update public.challenges set expires_at = now() - interval '2 hours'
    where wallet = $1 and lamports = 2000456`, [SHRIMP]);
await client.query(
  `insert into public.challenges (wallet, lamports, expires_at, status)
   values ($1, 2000458, now() + interval '20 minutes', 'pending')`, [SHRIMP]);
const nachZweiStunden = await client.query(
  `select status from public.challenges where wallet = $1 and lamports = 2000456`, [SHRIMP]);
check('Gegenprobe: nach zwei Stunden wird sie geräumt',
  nachZweiStunden.rows[0].status === 'expired', nachZweiStunden.rows[0].status);
await client.query(`delete from public.challenges`);

// 3. Reading requires a wallet claim
// ---------------------------------------------------------------------------
// A token with role: authenticated but WITHOUT a wallet claim is exactly
// what Supabase's own sign-in flows issue - "Anonymous sign-ins" is enough.
// With that, the entire wallets table used to be readable before this fix.
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
  check(`Ohne wallet-Claim ist ${name} empty`, (await ohneClaim(sql)) === 0);
}
// Control check: WITH a claim the same query reads just fine - otherwise
// the tables could just have been emptied and the test would still look
// green.
const mitClaim = await asWallet(WHALE, () =>
  client.query('select address from public.wallets limit 5'));
check('Gegenprobe: mit wallet-Claim sind sie es nicht',
  mitClaim.rows.length > 0, `${mitClaim.rows.length} Zeilen`);

// 4. read_by_admin belongs to the server
// ---------------------------------------------------------------------------
// A user could submit their own DM already marked as read. No data leak -
// but Ansem decides who to reply to based on that counter.
await client.query(`delete from public.dms where wallet = $1`, [DOLPHIN]);
await client.query(`update public.wallets set usd_value = 5000 where address = $1`, [DOLPHIN]);
await asWallet(DOLPHIN, () => client.query(
  `insert into public.dms (wallet, body, read_by_admin) values ($1, $2, true)`,
  [DOLPHIN, 'schon gelesen, angeblich']));
const gelesen = await client.query(
  `select read_by_admin from public.dms where body = 'schon gelesen, angeblich'`);
check('read_by_admin laesst sich nicht vom Client setzen',
  gelesen.rows[0].read_by_admin === false, String(gelesen.rows[0].read_by_admin));


console.log('\n── Eine laufende Abstimmung aendert ihren Wortlaut nicht ──');

// The case: "A or B?" gets thirty votes, then the question changes to
// "C or D?". The votes stay in place and now answer something else.
//
// This isn't an RLS hole - Ansem IS allowed to change polls, he needs to be
// able to close them and set deadlines. This is about one single column,
// and that's exactly what triggers are for instead of policies.
//
// On the choice of role: everything here runs as ADMIN, because only he can
// write at all. Whoever isn't admin already fails at the policy level -
// that's covered further up and isn't repeated here.
await client.query('delete from public.polls');
await client.query(`update public.wallets set ui_amount = 400000, usd_value = 5000
                    where address = $1`, [WHALE]);

const withVote = (await asWallet(ADMIN, async () => {
  const p = await client.query(
    `insert into public.polls (question) values ('A oder B?') returning id`);
  await client.query(
    `insert into public.poll_options (poll_id, label, idx)
     values ($1,'A',0), ($1,'B',1)`, [p.rows[0].id]);
  return p;
})).rows[0].id;
const withoutVote = (await asWallet(ADMIN, async () => {
  const p = await client.query(
    `insert into public.polls (question) values ('Noch keine Stimme?') returning id`);
  await client.query(
    `insert into public.poll_options (poll_id, label, idx)
     values ($1,'X',0), ($1,'Y',1)`, [p.rows[0].id]);
  return p;
})).rows[0].id;

const optIds = (await client.query(
  `select id from public.poll_options where poll_id = $1 order by idx`, [withVote]))
  .rows.map((r) => r.id);
await asWallet(WHALE, () => client.query(
  `insert into public.votes (poll_id, option_id, wallet) values ($1, $2, $3)`,
  [withVote, optIds[0], WHALE]));

// --- locked from the first vote onward ---
await expectFail('Frage nicht mehr aenderbar', ADMIN, () => client.query(
  `update public.polls set question = 'C oder D?' where id = $1`, [withVote]));
await expectFail('Antwortmoeglichkeit nicht mehr umbenennbar', ADMIN, () => client.query(
  `update public.poll_options set label = 'C' where id = $1`, [optIds[0]]));
await expectFail('Antwortmoeglichkeit nicht mehr loeschbar', ADMIN, () => client.query(
  `delete from public.poll_options where id = $1`, [optIds[1]]));
await expectFail('Antwortmoeglichkeit nicht mehr nachschiebbar', ADMIN, () => client.query(
  `insert into public.poll_options (poll_id, label, idx) values ($1,'C',2)`, [withVote]));

// --- what MUST keep working ---
// The half that's easy to break while adding a lock, without noticing:
// closing a running poll is the normal case.
await asWallet(ADMIN, () => client.query(
  `update public.polls set closed = true where id = $1`, [withVote]));
check('Schliessen bleibt erlaubt',
  (await client.query(`select closed from public.polls where id = $1`, [withVote]))
    .rows[0].closed === true);

await asWallet(ADMIN, () => client.query(
  `update public.polls set closes_at = now() + interval '1 day' where id = $1`,
  [withVote]));
check('Frist setzen bleibt erlaubt',
  (await client.query(`select closes_at from public.polls where id = $1`, [withVote]))
    .rows[0].closes_at !== null);

// A form often sends every field along, including the unchanged ones. If
// that fails, Ansem can no longer close a running poll - the same damage as
// the lock itself, just from the other direction.
await asWallet(ADMIN, () => client.query(
  `update public.polls set question = 'A oder B?', closed = true where id = $1`,
  [withVote]));
check('Frage unveraendert mitschreiben bleibt erlaubt',
  (await client.query(`select question from public.polls where id = $1`, [withVote]))
    .rows[0].question === 'A oder B?');

await asWallet(ADMIN, () => client.query(
  `update public.poll_options set idx = 5 where id = $1`, [optIds[0]]));
check('Reihenfolge aendern bleibt erlaubt',
  (await client.query(`select idx from public.poll_options where id = $1`, [optIds[0]]))
    .rows[0].idx === 5);

// --- without a vote, everything stays open ---
await asWallet(ADMIN, () => client.query(
  `update public.polls set question = 'Ganz andere Frage?' where id = $1`, [withoutVote]));
check('Ohne Stimme ist die Frage frei aenderbar',
  (await client.query(`select question from public.polls where id = $1`, [withoutVote]))
    .rows[0].question === 'Ganz andere Frage?');
await asWallet(ADMIN, () => client.query(
  `insert into public.poll_options (poll_id, label, idx) values ($1,'W',9)`, [withoutVote]));
check('Ohne Stimme laesst sich eine Antwortmoeglichkeit nachschieben',
  (await client.query(`select count(*)::int n from public.poll_options where poll_id = $1`,
    [withoutVote])).rows[0].n === 3);

// --- discarding the whole poll stays allowed ---
// The foreign key clears out options and votes along with it, and the
// delete trigger on poll_options fires too in the process. If it can't tell
// "option gone, poll stays" from "everything gone", a poll with votes
// becomes undeletable - and a wrongly worded question then stays stuck
// forever.
await asWallet(ADMIN, () => client.query(
  `delete from public.polls where id = $1`, [withVote]));
const nichtsMehrDa = await client.query(
  `select (select count(*) from public.polls where id = $1)::int p,
          (select count(*) from public.poll_options where poll_id = $1)::int o,
          (select count(*) from public.votes where poll_id = $1)::int v`, [withVote]);
check('Die ganze Abstimmung samt Stimmen loeschen bleibt erlaubt',
  nichtsMehrDa.rows[0].p === 0 && nichtsMehrDa.rows[0].o === 0
    && nichtsMehrDa.rows[0].v === 0,
  `polls ${nichtsMehrDa.rows[0].p}, options ${nichtsMehrDa.rows[0].o}, `
    + `votes ${nichtsMehrDa.rows[0].v}`);

// --- control check ---
// Without the triggers, all four locks have to go through. Otherwise the
// block above would be measuring something else - a policy, say - and
// would stay green even if this migration were simply removed.
{
  const p = (await asWallet(ADMIN, async () => {
    const q = await client.query(
      `insert into public.polls (question) values ('Gegenprobe?') returning id`);
    await client.query(
      `insert into public.poll_options (poll_id, label, idx) values ($1,'A',0)`,
      [q.rows[0].id]);
    return q;
  })).rows[0].id;
  const o = (await client.query(
    `select id from public.poll_options where poll_id = $1`, [p])).rows[0].id;
  await asWallet(WHALE, () => client.query(
    `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
    [p, o, WHALE]));

  for (const t of ['trg_polls_frage_fest']) {
    await client.query(`drop trigger ${t} on public.polls`);
  }
  for (const t of ['trg_optionen_label_fest', 'trg_optionen_nicht_loeschen',
                   'trg_optionen_nicht_nachschieben']) {
    await client.query(`drop trigger ${t} on public.poll_options`);
  }

  let durch = 0;
  for (const sql of [
    [`update public.polls set question = 'Umgedeutet?' where id = $1`, [p]],
    [`update public.poll_options set label = 'C' where id = $1`, [o]],
    [`insert into public.poll_options (poll_id, label, idx) values ($1,'C',2)`, [p]],
    [`delete from public.poll_options where id = $1`, [o]],
  ]) {
    try { await asWallet(ADMIN, () => client.query(sql[0], sql[1])); durch += 1; }
    catch { /* doesn't count as having gone through */ }
  }
  check('Gegenprobe: ohne die Trigger geht alle vier wieder durch', durch === 4,
    `${durch} von 4`);
  const umgedeutet = await client.query(
    `select question from public.polls where id = $1`, [p]);
  check('Gegenprobe: die Frage liess sich tatsaechlich umschreiben',
    umgedeutet.rows[0]?.question === 'Umgedeutet?', umgedeutet.rows[0]?.question);

  // Restore it, so a later block doesn't end up working against a
  // half-disarmed database.
  await client.query(fs.readFileSync(
    path.join(root, 'supabase/migrations/20260907020000_abstimmung_nach_erster_stimme.sql'),
    'utf8'));

  // And a fresh vote before checking again.
  //
  // The first attempt at this got it wrong: the control check above deletes
  // the only answer option, and the foreign key takes the vote with it.
  // After that the poll has no vote left - so the trigger was completely
  // right to allow changing the question, and the test cried "broken". A
  // test that destroys the precondition of its own claim says nothing about
  // what it's supposedly checking.
  const fresh = (await asWallet(ADMIN, () => client.query(
    `insert into public.poll_options (poll_id, label, idx) values ($1,'D',3) returning id`,
    [p]))).rows[0].id;
  await asWallet(WHALE, () => client.query(
    `insert into public.votes (poll_id, option_id, wallet) values ($1,$2,$3)`,
    [p, fresh, WHALE]));
  check('Vorbedingung: die Abstimmung hat wieder eine Stimme',
    (await client.query(`select count(*)::int n from public.votes where poll_id = $1`, [p]))
      .rows[0].n === 1);
  await expectFail('Nach dem Wiedereinspielen sperrt der Trigger erneut', ADMIN,
    () => client.query(`update public.polls set question = 'Nochmal?' where id = $1`, [p]));
}

console.log('\n── Was vor dem Start dazugekommen ist ──');
{
  // Betraege koennen nicht negativ sein. Ein negatives Gewicht wuerde von
  // einem Balken ABZIEHEN - die Zeile davor zeigt, dass die Tabelle vorher
  // beliebige Zahlen genommen haette.
  //
  // Und zwar als BESITZER der Tabelle, nicht als angemeldeter Nutzer. Der
  // erste Versuch lief ueber asWallet und meldete brav "wird abgewiesen" -
  // die Meldung war aber "permission denied for table wallets", also das
  // Schreibrecht und nicht die neue Regel. Gruen, und gemessen hat es
  // nichts.
  const verboten = async (label, sql) => {
    try {
      await client.query(sql);
      check(label, false, 'wurde faelschlich angenommen');
      await client.query(`delete from public.wallets where address = 'negativ-test'`);
    } catch (err) {
      check(label, /wallets_betraege_nicht_negativ/.test(err.message),
        err.message.split('\n')[0].slice(0, 80));
    }
  };
  await verboten('Ein negativer Bestand wird abgewiesen',
    `insert into public.wallets (address, ui_amount, usd_value, price)
     values ('negativ-test', -1, 0, 0)`);
  await verboten('Ein negativer Dollarwert auch',
    `insert into public.wallets (address, ui_amount, usd_value, price)
     values ('negativ-test', 0, -5, 0)`);
  // Gegenprobe: dieselbe Zeile mit erlaubten Zahlen geht durch.
  await client.query(
    `insert into public.wallets (address, ui_amount, usd_value, price)
     values ('negativ-test', 1, 1, 1)`);
  check('Gegenprobe: mit erlaubten Zahlen nimmt die Tabelle die Zeile',
    (await client.query(`select count(*)::int n from public.wallets where address = 'negativ-test'`))
      .rows[0].n === 1);
  await client.query(`delete from public.wallets where address = 'negativ-test'`);

  // Die Uhr fuer den Ketten-Scan steht in der Datenbank und nicht im
  // Speicher einer einzelnen Instanz.
  const spalte = await client.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='app_config' and column_name='last_scan_at'`);
  check('app_config traegt die gemeinsame Scan-Uhr', spalte.rowCount === 1);

  // Zwei gleichzeitige Instanzen: nur eine darf die Uhr weiterstellen.
  await client.query(`update public.app_config set last_scan_at = now() - interval '10 seconds' where id = 1`);
  const takt = async () => (await client.query(
    `update public.app_config set last_scan_at = now()
      where id = 1 and last_scan_at < now() - interval '5 seconds' returning id`)).rowCount;
  const ersterLauf = await takt();
  const zweiterLauf = await takt();
  check('Der erste Aufruf darf scannen', ersterLauf === 1);
  check('Der zweite innerhalb der Sperrzeit nicht', zweiterLauf === 0);

  // Der Index, auf dem die Minutenuhr laeuft.
  const idx = await client.query(
    `select indexname from pg_indexes where tablename = 'wallets' and indexdef like '%updated_at%'`);
  check('Es gibt einen Index auf wallets.updated_at', idx.rowCount >= 1);

  // Die Adminpruefung in dms_read steht als Unterausdruck - sonst laeuft sie
  // je Zeile statt je Abfrage.
  const regel = await client.query(
    `select qual from pg_policies where tablename = 'dms' and policyname = 'dms_read'`);
  check('dms_read rechnet die Adminpruefung einmal aus',
    /SELECT app\.is_admin\(\)/i.test(regel.rows[0].qual ?? ''), regel.rows[0].qual?.slice(0, 90));

  // Und die Regel sagt weiterhin dasselbe: eigener Faden oder Ansem.
  const dmA = (await asWallet(ADMIN, () => client.query(
    `select count(*)::int n from public.dms`))).rows[0].n;
  const dmW = (await asWallet(WHALE, () => client.query(
    `select count(*)::int n from public.dms where wallet <> $1`, [WHALE]))).rows[0].n;
  check('Ansem sieht alle Nachrichten', dmA > 0);
  check('Ein Halter sieht keine fremde', dmW === 0);
}

console.log('\n── Das taegliche Aufraeumen ──');
{
  // Was hier zaehlt, ist nicht die Menge der geloeschten Zeilen, sondern die
  // Grenze: alles, was noch eingeloest werden koennte, muss stehen bleiben.
  // Eine Aufraeumfunktion, die zu viel mitnimmt, nimmt Leuten ihre bezahlte
  // Anmeldung weg - und das faellt erst auf, wenn sich jemand beschwert.
  await client.query(`delete from public.challenges`);
  await client.query(`delete from public.seen_txs`);

  const lege = (id, status, tageAlt, ablaufTage) => client.query(
    `insert into public.challenges (id, wallet, lamports, status, created_at, expires_at)
     values ($1, 'AufraeumTest', $2, $3,
             now() - make_interval(days => $4::int),
             now() - make_interval(days => $5::int))`,
    [id, 2_000_000 + Number(String(id).slice(-4).replace(/\D/g, '') || 1), status, tageAlt, ablaufTage]);

  const A = '11111111-0000-0000-0000-000000000001';
  const B = '11111111-0000-0000-0000-000000000002';
  const C = '11111111-0000-0000-0000-000000000003';
  const D = '11111111-0000-0000-0000-000000000004';
  const E = '11111111-0000-0000-0000-000000000005';
  await lege(A, 'used', 40, 40);      // alt und verbraucht -> weg
  await lege(B, 'expired', 40, 40);   // alt und abgelaufen -> weg
  await lege(C, 'paid', 2, 2);        // bezahlt, aber JUNG -> bleibt
  // Offen und erst vor einer halben Stunde abgelaufen: der Nachlauf von einer
  // Stunde in verify/index.ts koennte diese Zahlung noch zuordnen.
  await client.query(
    `insert into public.challenges (id, wallet, lamports, status, created_at, expires_at)
     values ($1, 'AufraeumTest', 2009999, 'pending',
             now() - interval '1 hour', now() - interval '30 minutes')`, [E]);
  // D kommt ZULETZT, und das ist keine Kosmetik: jedes Anlegen loest den
  // Trigger app.raeume_abgelaufene_challenges() aus, und der setzt lange
  // abgelaufene offene Zeilen derselben Wallet auf 'expired'. Stand D vorher,
  // war es beim Zaehlen nicht mehr offen, und die Zeile darunter haette den
  // zweiten Topf nie geprueft.
  await lege(D, 'pending', 40, 40);   // offen, lange abgelaufen -> weg

  await client.query(
    `insert into public.seen_txs (signature, slot, sender, lamports, seen_at)
     values ('sig-alt', 1, 'x', 1, now() - interval '40 days'),
            ('sig-neu', 2, 'x', 1, now() - interval '2 days')`);

  const bericht = await client.query(`select * from app.aufraeumen(30)`);
  const uebrig = async (id) => (await client.query(
    `select count(*)::int n from public.challenges where id = $1`, [id])).rows[0].n;

  check('Eine verbrauchte Challenge von vor 40 Tagen ist weg', (await uebrig(A)) === 0);
  check('Eine abgelaufene von vor 40 Tagen auch', (await uebrig(B)) === 0);
  check('Eine BEZAHLTE von vorgestern bleibt stehen', (await uebrig(C)) === 1);
  check('Eine offene, die vor 40 Tagen ablief, ist weg', (await uebrig(D)) === 0);
  check('Eine offene, die vor einer halben Stunde ablief, bleibt – der Nachlauf',
    (await uebrig(E)) === 1);

  const sigs = (await client.query(`select signature from public.seen_txs order by signature`))
    .rows.map((r) => r.signature);
  check('Eine Unterschrift von vor 40 Tagen ist weg', !sigs.includes('sig-alt'));
  check('Eine von vorgestern steht noch da', sigs.includes('sig-neu'), sigs.join(', '));

  // Die Funktion sagt auch, was sie getan hat - sonst laesst sich im Zeitplan
  // nicht erkennen, ob sie ueberhaupt laeuft.
  const zeilen = Object.fromEntries(bericht.rows.map((r) => [r.tabelle, Number(r.geloescht)]));
  check('Sie berichtet über beide Tabellen',
    zeilen.challenges === 2 && zeilen.challenges_offen === 1 && zeilen.seen_txs === 1,
    JSON.stringify(zeilen));

  // Gegenprobe: ein zweiter Lauf loescht nichts mehr. Ohne diese Zeile waere
  // eine Funktion, die einfach alles wegnimmt, oben genauso gruen.
  const zweimal = await client.query(`select * from app.aufraeumen(30)`);
  check('Ein zweiter Lauf löscht nichts mehr',
    zweimal.rows.every((r) => Number(r.geloescht) === 0),
    JSON.stringify(zweimal.rows));
  check('Und die jungen Zeilen stehen danach immer noch da',
    (await uebrig(C)) === 1 && (await uebrig(E)) === 1);

  // Kein anon, kein authenticated.
  const rechte = await client.query(
    `select has_function_privilege('anon', 'app.aufraeumen(int)', 'execute') as anon,
            has_function_privilege('authenticated', 'app.aufraeumen(int)', 'execute') as auth`);
  check('Aufrufen darf sie niemand von aussen',
    rechte.rows[0].anon === false && rechte.rows[0].auth === false);

  await client.query(`delete from public.challenges where wallet = 'AufraeumTest'`);
  await client.query(`delete from public.seen_txs`);
}

console.log(`\n${failures === 0 ? '✅ Alle Prüfungen bestanden' : `❌ ${failures} Prüfung(en) fehlgeschlagen`}\n`);
await client.end();
process.exit(failures === 0 ? 0 : 1);
