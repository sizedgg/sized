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
    -- Der Bestand wird hier nur belegt, nicht entschieden - die Kurve steht
    -- eine Handbreit weiter unten und wird nach Rang vergeben. Zwei Stellen,
    -- die beide Betraege setzen, waeren eine zu viel.
    wert := 0;
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

-- --- die Bestaende ----------------------------------------------------------
--
-- Nach Rang statt gewuerfelt, und nach einer Zipf-Kurve: der r-groesste
-- Halter hat 160.000 / r^0.82 Dollar.
--
--     1.   160.000        6.   36.000       14.   18.400
--     2.    90.600        8.   28.000       18.   15.000
--     3.    66.000       10.   24.000      100.    3.700
--     4.    51.000       12.   21.000      500.    1.000
--
-- Der Grund ist die SPALTE im Posteingang. Vorher stand dort zwanzigmal
-- untereinander "$10K" - die Verteilung war zwar schief, aber ihr oberes
-- Ende lag so flach, dass die ersten fuenfzig Zeilen auf dieselbe gerundete
-- Zahl fielen. Eine Liste, die "sortiert nach Bestand" behauptet und dabei
-- zwanzigmal dieselbe Zahl zeigt, belegt das Gegenteil.
--
-- Der Exponent ist aus genau dieser Anforderung gerechnet und nicht
-- geschaetzt: oben ueber 150.000, in der achtzehnten Zeile - der letzten,
-- die auf ein Bild passt - 15.000. Das ist 0.82.
--
-- Der Schwanz laeuft danach flach bis knapp ueber 1.000 aus, also bleiben
-- alle 500 ueber der Schwelle und der Posteingang ist voll. Die Summe aller
-- Bestaende liegt bei rund 1,8 Millionen - das ist die Zahl, an der die
-- Abstimmungen haengen, siehe die Beteiligung weiter unten.
update public.wallets w
   set usd_value = round((160000.0 * power(g.r, -0.82))::numeric, 2),
       ui_amount = round((160000.0 * power(g.r, -0.82) * 1000)::numeric, 2)
  from (select address, row_number() over (order by md5(address)) as r
          from public.wallets
         where address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw') g
 where w.address = g.address;

-- --- the messages -----------------------------------------------------------
do $$
declare
  w record;
  -- Vierzig verschiedene Nachrichten, und die Liste bekommt sie der Reihe
  -- nach statt zufaellig - siehe rang weiter unten.
  --
  -- Der Massstab ist nicht der Satz, sondern seine ersten 16 Zeichen: mehr
  -- zeigt die Zeile im Posteingang nicht. Zwei Saetze, die verschieden
  -- enden und gleich anfangen, stehen dort als dieselbe Zeile - und ein
  -- Posteingang, in dem viermal "can you look at t..." steht, sieht
  -- erfunden aus, weil er es dann auch ist.
  texte text[] := array[
    'gm',
    'wen poll',
    'thanks for the answer earlier',
    'quick one about the vesting schedule',
    'is the unlock linear or cliff based?',
    'any chance you do an AMA this month',
    'sent you the details on telegram',
    'will you cover the new listing on stream?',
    'holding since the first week, the tool is good',
    'what do you think about funding rates right now',
    'been waiting on this poll for two weeks haha',
    'is the treasury address the same as in the pinned post',
    'ok, understood',
    'voted, and I moved half my bag after',
    'can you look at the numbers on the last poll',
    'my vote disappeared after I sold, is that expected?',
    'does the weight update live or once a day',
    'great stream yesterday',
    'who runs this site, you or a team',
    'the card image shows an old number',
    'how long does a poll stay open',
    'asked twice already, sorry',
    'just here to say the sorting is smart',
    'can I change my vote later',
    'why is my handle only three characters',
    'dm threshold seems high for smaller wallets',
    'you should put the next one at 24h',
    'screenshot of the poll went around btw',
    'reading the docs now, one thing is unclear',
    'found a typo on the login screen',
    'no rush, whenever you have time',
    'second time asking about the AMA',
    'price feed looks stale on my side',
    'everything works on mobile now, nice',
    'which wallet do I send from, phantom?',
    'i think the closed polls should stay visible',
    'up 3x since the first vote, thanks',
    'are you keeping the ticker',
    'long time lurker, first message',
    'let me know if you want testers'
  ];
  -- Ansems Antworten. Auch sie stehen in der Liste, mit "You:" davor, also
  -- gilt dieselbe Regel fuer die ersten 16 Zeichen. Vierundzwanzig Stueck,
  -- damit sich in den ersten zwei Dutzend Zeilen keine wiederholt.
  antworten text[] := array[
    'will cover it in the next stream',
    'yes',
    'not yet, waiting on the numbers',
    'good question, short answer is no',
    'sending you something later today',
    'seen it, thanks',
    'that one is in the docs',
    'fixed, thanks for flagging',
    'next poll will answer that',
    'same address as the pinned post',
    'it updates when the balance moves',
    'no team, just me',
    'friday, if the numbers hold',
    'you can change it until it closes',
    'appreciate it',
    'I read everything here, even without replying',
    'put it in the poll',
    'checking now',
    'keeping the ticker',
    'give me a day',
    'ask again after the unlock',
    'on it',
    'screenshot it and send it over',
    'makes sense, changing it'
  ];
  n int;
  k int;
  saat bigint := 77771;
  gelesen boolean;
begin
  -- rang: der Platz in der Liste, die Ansem sieht - sortiert nach Bestand,
  -- der groesste zuerst. Die LETZTE Nachricht eines Gespraechs wird danach
  -- vergeben und nicht gewuerfelt: nur die letzte steht im Posteingang, und
  -- nur dort faellt eine Wiederholung auf. So sind die oberen vierzig
  -- Zeilen verschieden, ohne dass irgendwo eine Zufallszahl "meistens"
  -- verschieden sein muss.
  for w in select address, ui_amount, usd_value,
                  row_number() over (order by ui_amount desc, address) as rang
           from public.wallets
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
              case when k = n
                   then texte[1 + ((w.rang - 1) % array_length(texte, 1))::int]
                   else texte[1 + (saat % array_length(texte, 1))] end,
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
                antworten[1 + ((w.rang - 1) % array_length(antworten, 1))::int],
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
  and w.address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw'
  -- Nicht alle stimmen ab. Das ist keine Kosmetik, sondern die Bedingung
  -- dafuer, dass auf keinem Balken mehr als eine Million steht.
  --
  -- Die Rechnung: alle 500 Halter zusammen haben rund 1,8 Millionen. Bei
  -- der Frage mit ZWEI Antworten faellt davon knapp die Haelfte auf einen
  -- Balken - bei voller Beteiligung waren das 1,11 Millionen. Mit dieser
  -- Quote bleibt der laengste Balken darunter; nachgerechnet wird es unten,
  -- und wenn es nicht stimmt, bricht die Saat ab statt ein Bild zu liefern.
  and ('x' || substr(md5(w.address || 'teil'), 1, 2))::bit(8)::int % 100 < 62;

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

-- Die Grenze, die diese Saat einzuhalten hat: auf keinem Balken steht mehr
-- als eine Million. Sie haengt an drei Zahlen, die an drei verschiedenen
-- Stellen stehen - der Obergrenze der Bestaende, der Beteiligung und der
-- Zahl der Antworten je Frage. Wer eine davon anfasst, merkt es hier und
-- nicht erst im fertigen Bild.
do $$
declare
  groesster numeric;
begin
  select max(usd) into groesster from public.poll_totals;
  if groesster > 1000000 then
    raise exception 'Der laengste Balken steht bei % Dollar - ueber einer Million. '
      'Beteiligung in den Stimmen senken oder die Bestandskurve flacher machen.',
      round(groesster);
  end if;
end $$;

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
-- nicht bei jedem Lauf wechselt: sha256('sized-artikel-halter-12').
--
-- Die 12 ist nicht willkuerlich. Der lokale Stapel erfindet den Bestand einer
-- Wallet aus sha256 der Adresse (mockAmount in scripts/dev-stack.mjs) und
-- ueberschreibt beim Anmelden, was hier eingetragen ist. Die erste gueltige
-- Adresse landete auf 540 Dollar - unter min_dm_usd, also mit gesperrter
-- Antwortzeile und "Hold at least $1,000" darunter. Gesucht wurde deshalb
-- eine, die in der Stufe landet, die zur neuen Obergrenze passt:
-- 2.409.958 Token, rund 10.100 Dollar - also am oberen Ende der Halter,
-- aber nicht ausserhalb ihrer Groessenordnung. Die Zahlen hier stimmen mit dem ueberein, was der Stapel gleich
-- daraus macht - sonst zeigte die Liste einen anderen Betrag als der Kopf.
insert into public.wallets (address, ui_amount, usd_value, price, updated_at, first_seen, priced_at)
values ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', 2409958.0, 10122.0, 0.0042, now(), now() - interval '73 days', now())
on conflict (address) do update
  set ui_amount = excluded.ui_amount, usd_value = excluded.usd_value, price = excluded.price;

alter table public.dms disable trigger all;
insert into public.dms (wallet, from_admin, body, snap_tokens, snap_usd, read_by_admin, created_at)
values
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'gm — been holding since the first week. is the unlock linear or cliff based?',
   2409958.0, 10122.0, true, now() - interval '6 days'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', true,
   'linear, starts at the end of the month. nothing unlocks before that.',
   0, 0, true, now() - interval '6 days' + interval '4 hours'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'appreciate it. that was the one thing the docs never said clearly',
   2409958.0, 10122.0, true, now() - interval '6 days' + interval '5 hours'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'will you cover the new listing on stream?',
   2409958.0, 10122.0, true, now() - interval '4 days'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', true,
   'probably friday. put it in the poll if you want it sooner.',
   0, 0, true, now() - interval '4 days' + interval '90 minutes'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'done, added it. thanks',
   2409958.0, 10122.0, true, now() - interval '4 days' + interval '2 hours'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'one more — are the weekly numbers the same snapshot the cards use?',
   2409958.0, 10122.0, true, now() - interval '2 days'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', true,
   'same one. the card prints the timestamp, so you can tell which snapshot it was.',
   0, 0, true, now() - interval '2 days' + interval '40 minutes'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'perfect, that answers it',
   2409958.0, 10122.0, true, now() - interval '2 days' + interval '55 minutes'),
  ('37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa', false,
   'voted on the ticker one. keeping it.',
   2409958.0, 10122.0, false, now() - interval '5 hours');
alter table public.dms enable trigger all;


-- Die Schwelle bleibt bei 1.000, und der Versuch, sie mitzuskalieren, ist
-- hier gestanden und wieder verschwunden.
--
-- Die Ueberlegung war: bei einer Obergrenze von 10.000 sind 1.000 Dollar die
-- obere Haelfte, also filtert die Liste haerter als vorher. Also runter auf
-- 250. Das FILTERT auch tatsaechlich - aber app.js hat mit MIN_DM_THRESHOLD
-- eine harte Untergrenze von 1.000, und das Feld im Posteingang zeigt
-- deshalb weiter "1.000", egal was in der Tabelle steht. Ergebnis waeren
-- Gespraeche ab 250 Dollar unter einer Beschriftung, die 1.000 behauptet -
-- ein Widerspruch, den man einem Artikelbild ansieht.
--
-- Bei 1.000 bleiben rund die Haelfte der 500 Wallets uebrig. Das reicht fuer
-- eine volle Liste und stimmt mit dem ueberein, was daneben steht.

-- --- das eine Gespraech, das im Artikelbild offen steht -------------------
--
-- Die 500 gewuerfelten Gespraeche sind fuer die LISTE gemacht: eine Zeile,
-- sechzehn Zeichen, mehr sieht man von ihnen nie. Aufgeklappt taugen sie
-- nicht - dort stehen vier Saetze untereinander, die nichts miteinander zu
-- tun haben, und das faellt sofort auf.
--
-- Also eines von Hand: vier Nachrichten, ein Hin und Her, und es erklaert
-- nebenbei genau das, worum sich die Seite dreht - das Gewicht folgt dem
-- Bestand, bis die Abstimmung schliesst.
--
-- Der Bestand wird nicht gesetzt, sondern gerechnet: knapp unter den
-- neuntgroessten. Damit steht das Gespraech mitten in der sichtbaren Liste
-- statt ganz oben - eine feste Zahl waere nach jeder Aenderung an der
-- Verteilung wieder woanders.
insert into public.wallets (address, ui_amount, usd_value, price, updated_at, first_seen, priced_at)
select 'Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs', t.ui_amount - 1, (t.ui_amount - 1) / 1000.0, 0.001,
       now(), now() - interval '61 days', now()
  from (select ui_amount from public.wallets order by ui_amount desc offset 8 limit 1) t
on conflict (address) do update
  set ui_amount = excluded.ui_amount, usd_value = excluded.usd_value, price = excluded.price;

alter table public.dms disable trigger all;
insert into public.dms (wallet, from_admin, body, snap_tokens, snap_usd, read_by_admin, created_at)
select v.wallet, v.from_admin, v.body, v.snap_tokens, v.snap_usd, v.gelesen, v.wann
  from public.wallets w
  cross join lateral (values
    ('Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs'::text, false,
     'if I sell half my bag after voting, does my vote shrink or stay?',
     w.ui_amount, w.usd_value, true, now() - interval '2 days'),
    ('Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs', true,
     'it shrinks. the number follows the balance until the poll closes.',
     0::numeric, 0::numeric, true, now() - interval '2 days' + interval '2 hours'),
    ('Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs', false,
     'makes sense. that is why the closed ones freeze then',
     w.ui_amount, w.usd_value, true, now() - interval '28 hours'),
    ('Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs', true,
     'exactly. after that nothing moves.',
     0::numeric, 0::numeric, true, now() - interval '27 hours')
  ) as v(wallet, from_admin, body, snap_tokens, snap_usd, gelesen, wann)
 where w.address = 'Dw3oiLHQ9Ho79eMV1CFpNXsNFt9Z7BgidLwrsH25qwUs';
alter table public.dms enable trigger all;


commit;

select (select count(*) from public.wallets) as wallets,
       (select count(*) from public.dms) as nachrichten,
       (select count(distinct wallet) from public.dms) as gespraeche,
       (select count(*) from public.dms where not read_by_admin) as ungelesen,
       (select count(*) from public.polls) as polls,
       (select count(*) from public.votes) as stimmen;
