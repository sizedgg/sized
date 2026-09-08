-- ============================================================================
-- A full inbox for a look at Ansem's side: 500 conversations, 3 polls
--
-- FOR THE LOCAL TEST DATABASE ONLY. It writes 500 wallets and roughly 1,500
-- messages, and it switches triggers off to do so - neither belongs anywhere
-- near the real project. scripts/testdaten-loeschen.sql is the way back.
--
-- Why the triggers come off: `dms` carries a minimum-balance check and a
-- rate limit. Both are correct and both would reject this seed - the rate
-- limit above all, because it exists precisely to stop 1,500 messages
-- arriving in one second. Switching them off is honest here and would be
-- dishonest in a test: a test that disables the rule it is testing measures
-- nothing.
--
-- The numbers are deliberately awkward, not pretty:
--   * amounts from under a dollar to seven digits, so the column has to
--     cope with "<$1" next to "$1,973,402"
--   * long messages, short ones, and a few with no spaces
--   * about one in five conversations unread
--   * two pairs share their first three characters, which is what the four
--     name colours are for
--
--   psql "$PGURL" -f scripts/seed-ansem-voll.sql
-- ============================================================================

begin;

alter table public.dms disable trigger all;
alter table public.wallets disable trigger all;
-- votes carries guard_vote(), which rejects a vote in a closed poll - and
-- rightly so. The closed poll here needs its result to exist, so its votes
-- are written past the guard. Same reasoning as for dms above: switching a
-- rule off to seed is honest, switching it off in a test is not.
alter table public.votes disable trigger all;
alter table public.polls disable trigger all;
alter table public.poll_options disable trigger all;

delete from public.dms;
delete from public.dm_hidden;
delete from public.votes;
delete from public.poll_options;
delete from public.poll_totals;
delete from public.polls;
delete from public.wallets where address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

-- --- 500 wallets ------------------------------------------------------------
-- The address is built from a seeded generator so the run is repeatable: the
-- same picture twice, otherwise comparing two versions is guesswork.
do $$
declare
  b58 text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  adr text;
  i int;
  j int;
  saat bigint := 20260908;
  wert numeric;
begin
  for i in 1..500 loop
    adr := '';
    for j in 1..44 loop
      saat := (saat * 1103515245 + 12345) % 2147483648;
      adr := adr || substr(b58, 1 + (saat % 58)::int, 1);
    end loop;
    -- A long tail: many small holders, a few large ones. floor to a power
    -- keeps the distribution lopsided the way a real one is.
    saat := (saat * 1103515245 + 12345) % 2147483648;
    wert := round((power((saat % 10000) / 10000.0, 3.2) * 2000000 + 0.4)::numeric, 4);
    insert into public.wallets (address, ui_amount, usd_value, price, updated_at, first_seen)
    values (adr, wert * 1000, wert, 0.001,
            now() - (i || ' minutes')::interval,
            now() - (i || ' hours')::interval);
  end loop;
end $$;

-- Two pairs that share their first three characters. That is the case the
-- name colours exist for, and without it the inbox never shows it.
update public.wallets set address = 'Km9' || substr(address, 4)
  where address in (select address from public.wallets order by address limit 2);
update public.wallets set address = '7xK' || substr(address, 4)
  where address in (select address from public.wallets order by address desc limit 2);

-- --- the messages -----------------------------------------------------------
do $$
declare
  w record;
  texte text[] := array[
    'gm',
    'wen poll',
    'thanks for the reply',
    'quick one about the vesting schedule',
    'I sold half my bag last week and now I am not sure that was right',
    'Is the unlock linear or cliff based? I have been trying to work this out from the docs and cannot tell',
    'any chance you do an AMA this month',
    'appreciate the answer earlier',
    'sent you the details',
    'will you cover the new listing on stream',
    'checking',
    'holding since the first week, just wanted to say the tool is good',
    'whatsthetickerforthenewoneiseeeverywhere',
    'can you look at this',
    'what do you think about the funding rates right now',
    'been waiting on this poll for two weeks haha',
    'is the treasury address the same one as in the pinned post',
    'ok'
  ];
  antworten text[] := array[
    'will cover it in the next stream',
    'yes',
    'not yet - waiting on the numbers',
    'good question, short answer is no',
    'sending you something later today',
    'seen it, thanks'
  ];
  n int;
  k int;
  saat bigint := 77771;
  gelesen boolean;
begin
  for w in select address, ui_amount, usd_value from public.wallets
           where address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw'
           order by address loop
    saat := (saat * 1103515245 + 12345) % 2147483648;
    n := 1 + (saat % 5)::int;
    saat := (saat * 1103515245 + 12345) % 2147483648;
    gelesen := (saat % 5) <> 0;          -- about one in five stays unread
    for k in 1..n loop
      saat := (saat * 1103515245 + 12345) % 2147483648;
      insert into public.dms (wallet, from_admin, body, snap_tokens, snap_usd,
                              read_by_admin, created_at)
      values (w.address, false,
              texte[1 + (saat % array_length(texte, 1))],
              w.ui_amount, w.usd_value,
              gelesen,
              -- Aufsteigend innerhalb eines Gespraechs.
              --
              -- Vorher stand hier (saat % 20000), also fuer jede Nachricht
              -- eine zufaellige Zeit - und die Liste zeigt sie in der
              -- Reihenfolge, in der sie eingefuegt wurden. In den Bildern
              -- stand dann "Today" ueber "Yesterday" und "Aug 30" darunter.
              -- Der App war das nicht anzulasten, aber ansehen konnte man
              -- das keinem.
              --
              -- (n - k) zaehlt rueckwaerts: die erste Nachricht ist die
              -- aelteste. Die Streuung bleibt unter einem Tag (300 bis 900
              -- Minuten), damit sie die Reihenfolge nicht umwirft.
              now() - (((n - k) * 1440 + 300 + (saat % 600)) || ' minutes')::interval);
      -- Ansem answers in roughly every third conversation, and only on the
      -- ones already read - an unread thread with an answer under it would
      -- be a state that cannot occur.
      if gelesen and (saat % 3) = 0 and k = n then
        saat := (saat * 1103515245 + 12345) % 2147483648;
        insert into public.dms (wallet, from_admin, body, snap_tokens, snap_usd,
                                read_by_admin, created_at)
        values (w.address, true,
                antworten[1 + (saat % array_length(antworten, 1))],
                w.ui_amount, w.usd_value, true,
                -- Die Antwort kommt zuletzt, also hoechstens 250 Minuten
                -- zurueck - immer weniger als die 300, die die letzte
                -- Nachricht des Halters mindestens alt ist.
                now() - ((saat % 250) || ' minutes')::interval);
      end if;
    end loop;
  end loop;
end $$;

-- --- three polls ------------------------------------------------------------
-- One running with a deadline, one running without, one closed. Those are the
-- three states the list can show, and a preview with three identical polls
-- would say nothing about any of them.
insert into public.polls (question, closes_at, closed) values
  ('What should the next stream focus on?', now() + interval '2 hours 59 minutes', false),
  ('Should we do a weekly AMA?', null, false),
  ('Change the ticker?', now() - interval '3 days', true);

insert into public.poll_options (poll_id, label, idx)
select p.id, o.label, o.idx from public.polls p
join (values
  ('What should the next stream focus on?', 'Majors only — BTC, SOL, ETH', 1),
  ('What should the next stream focus on?', 'Alt rotations and new listings', 2),
  ('What should the next stream focus on?', 'On-chain flows and whale tracking', 3),
  ('What should the next stream focus on?', 'Open Q&A with holders', 4),
  ('Should we do a weekly AMA?', 'Yes, every Friday', 1),
  ('Should we do a weekly AMA?', 'No, keep it spontaneous', 2),
  ('Change the ticker?', 'Keep $ANSEM', 1),
  ('Change the ticker?', 'Something shorter', 2),
  ('Change the ticker?', 'Put it to a second vote', 3),
  ('Change the ticker?', 'No opinion', 4)
) as o(frage, label, idx) on o.frage = p.question;

-- Votes: one per wallet in each running poll, a third of them in the closed
-- one. Two things shape the bars, and both are deliberate: the CHOICE is
-- skewed toward the upper answers (a uniform pick would give four bars of
-- the same length and say nothing), and the WEIGHT is the balance, so the
-- same lopsided distribution as the inbox column drives the widths.
--
-- One option per poll, not two. The first attempt took the two
-- lowest-hashing options across all polls, which happily picked both from
-- the same poll - and votes carries a unique key on (poll_id, wallet),
-- exactly as it should.
insert into public.votes (poll_id, option_id, wallet, weight_tokens, weight_usd, created_at)
select p.id, o.id, w.address, w.ui_amount, w.usd_value, now() - interval '1 hour'
from public.wallets w
cross join public.polls p
join lateral (
  select o.id from public.poll_options o
  where o.poll_id = p.id
    and o.idx = 1 + floor(
      power((('x' || substr(md5(w.address || p.id::text), 1, 6))::bit(24)::int % 1000) / 1000.0, 1.8)
      * (select count(*) from public.poll_options x where x.poll_id = p.id)
    )::int
  limit 1
) o on true
where p.question <> 'Change the ticker?'
  and w.address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

insert into public.votes (poll_id, option_id, wallet, weight_tokens, weight_usd, created_at)
select p.id, o.id, w.address, w.ui_amount, w.usd_value, now() - interval '4 days'
from public.wallets w
cross join public.polls p
join lateral (
  select o.id from public.poll_options o
  where o.poll_id = p.id
    and o.idx = 1 + floor(
      power((('x' || substr(md5(w.address || 'zu'), 1, 6))::bit(24)::int % 1000) / 1000.0, 2.4)
      * (select count(*) from public.poll_options x where x.poll_id = p.id)
    )::int
  limit 1
) o on true
where p.question = 'Change the ticker?'
  and w.address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw'
  and ('x' || substr(md5(w.address), 1, 2))::bit(8)::int % 3 = 0;

alter table public.poll_options enable trigger all;
alter table public.polls enable trigger all;
alter table public.votes enable trigger all;
alter table public.wallets enable trigger all;
alter table public.dms enable trigger all;

-- poll_totals is filled by a trigger that has just been switched off. It is
-- what the poll list reads its bar widths from, so it gets recomputed here
-- by hand - otherwise every poll would show four empty bars.
insert into public.poll_totals (poll_id, option_id, votes, usd)
select v.poll_id, v.option_id, count(*), sum(v.weight_usd)
from public.votes v group by v.poll_id, v.option_id;

-- ---------------------------------------------------------------------------
-- Ein Halter, mit dem man sich tatsaechlich anmelden kann
-- ---------------------------------------------------------------------------
--
-- Die 500 Adressen oben sind erfunden. Sie stehen in der Datenbank und sehen
-- in der Liste richtig aus, aber verify() weist sie ab: isSolanaAddress
-- verlangt base58, das zu genau 32 Bytes dekodiert, und das tun sie nicht.
-- Fuer den Posteingang reicht das, dort stehen nur die ersten drei Zeichen -
-- fuer eine Anmeldung nicht. Wer die Seite AUS DER SICHT eines Halters sehen
-- will, kommt mit keiner von ihnen hinein.
--
-- Diese Adresse ist echtes base58 mit 32 Bytes und steht fest, damit sie
-- nicht bei jedem Lauf wechselt: sha256('sized-artikel-halter-14').
--
-- Die 14 ist nicht willkuerlich. Der lokale Stapel erfindet den Bestand einer
-- Wallet aus sha256 der Adresse (mockAmount in scripts/dev-stack.mjs) und
-- ueberschreibt beim Anmelden, was hier eingetragen ist. Die erste gueltige
-- Adresse landete auf 540 Dollar - unter min_dm_usd, also mit gesperrter
-- Antwortzeile und "Hold at least $1,000" darunter. Gesucht wurde deshalb
-- eine, die in der obersten Stufe landet: 21.007.410 Token, rund 88.000
-- Dollar. Die Zahlen hier stimmen mit dem ueberein, was der Stapel gleich
-- daraus macht - sonst zeigte die Liste einen anderen Betrag als der Kopf.
insert into public.wallets (address, ui_amount, usd_value, price, updated_at, first_seen, priced_at)
values ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', 21007410.0, 88231.0, 0.0042, now(), now() - interval '73 days', now())
on conflict (address) do update
  set ui_amount = excluded.ui_amount, usd_value = excluded.usd_value, price = excluded.price;

alter table public.dms disable trigger all;
insert into public.dms (wallet, from_admin, body, snap_tokens, snap_usd, read_by_admin, created_at)
values
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'gm — been holding since the first week. is the unlock linear or cliff based?',
   21007410.0, 88231.0, true, now() - interval '6 days'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', true,
   'linear, starts at the end of the month. nothing unlocks before that.',
   0, 0, true, now() - interval '6 days' + interval '4 hours'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'appreciate it. that was the one thing the docs never said clearly',
   21007410.0, 88231.0, true, now() - interval '6 days' + interval '5 hours'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'will you cover the new listing on stream?',
   21007410.0, 88231.0, true, now() - interval '4 days'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', true,
   'probably friday. put it in the poll if you want it sooner.',
   0, 0, true, now() - interval '4 days' + interval '90 minutes'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'done, added it. thanks',
   21007410.0, 88231.0, true, now() - interval '4 days' + interval '2 hours'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'one more — are the weekly numbers the same snapshot the cards use?',
   21007410.0, 88231.0, true, now() - interval '2 days'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', true,
   'same one. the card prints the timestamp, so you can tell which snapshot it was.',
   0, 0, true, now() - interval '2 days' + interval '40 minutes'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'perfect, that answers it',
   21007410.0, 88231.0, true, now() - interval '2 days' + interval '55 minutes'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'voted on the ticker one. keeping it.',
   21007410.0, 88231.0, false, now() - interval '5 hours');
alter table public.dms enable trigger all;


commit;

select (select count(*) from public.wallets) as wallets,
       (select count(*) from public.dms) as nachrichten,
       (select count(distinct wallet) from public.dms) as gespraeche,
       (select count(*) from public.dms where not read_by_admin) as ungelesen,
       (select count(*) from public.polls) as polls,
       (select count(*) from public.votes) as stimmen;
