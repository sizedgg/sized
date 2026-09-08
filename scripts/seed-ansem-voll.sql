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
    values (adr, wert * 1000, wert, 0.012,
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
-- Nach Rang statt gewuerfelt: eine Kurve mit BODEN. Der groesste Halter hat
-- 600.000 Dollar, der fuenfhundertste genau 120.000, und dazwischen faellt
-- es schnell und laeuft dann flach aus.
--
--     1.   600.000        5.   237.000       18.   155.000
--     2.   376.000        8.   201.000       50.   133.000
--     3.   304.000       10.   179.000      100.    127.000
--     4.   262.000       14.   163.000      500.    120.000
--
-- Zwei Anforderungen stecken darin, und die zweite ist der Grund fuer den
-- Boden:
--
--   Jede sichtbare Zeile eine andere Zahl. Eine Liste, die "sortiert nach
--   Bestand" behauptet und dabei eine Zahl wiederholt, belegt das
--   Gegenteil - und genau so sah sie aus, als die Kurve flach auslief.
--
--   Der kleinste haelt 120.000. Ohne Boden liefe die Kurve gegen null, und
--   die untere Haelfte der Liste stuende bei ein paar hundert Dollar.
update public.wallets w
   set usd_value = round((120000 + 480000
         * (power(g.r, -0.9) - power(500, -0.9)) / (1 - power(500, -0.9)))::numeric, 2),
       -- Token = Dollar / Preis, und der Preis ist der des Mocks (0.012).
       --
       -- Vorher stand hier mal 1000 - eine andere Umrechnung als die, mit
       -- der sich der eine anmeldbare Halter beim Login neu berechnet. Der
       -- Posteingang sortiert nach TOKEN, nicht nach Dollar, und deshalb
       -- stand dieser Halter mit 252.000 Dollar unter Leuten mit 120.000:
       -- seine Zahl war in einer anderen Waehrung.
       ui_amount = round((120000 + 480000
         * (power(g.r, -0.9) - power(500, -0.9)) / (1 - power(500, -0.9)))::numeric / 0.012, 2)
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
  -- Vierzig verschiedene Nachrichten, und die Liste bekommt sie der Reihe
  -- nach statt zufaellig - siehe rang weiter unten.
  --
  -- Zwei Regeln, beide gepruefte (siehe den Block darunter):
  --
  --   Die ersten 16 Zeichen sind eindeutig. Mehr zeigt die Zeile im
  --   Posteingang nicht, und ein Posteingang, in dem viermal
  --   "can you look at t..." steht, sieht erfunden aus.
  --
  --   Mindestens 22 Zeichen. Kurze Zurufe - "gm", "ok", "wen poll" - fuellen
  --   die Zeile nicht aus, und eine Liste, in der die Haelfte der Zeilen
  --   nach drei Woertern aufhoert, sieht leer aus statt beschaeftigt.
  texte text[] := array[
    'good morning, first message here',
    'when is the next poll going up',
    'thanks for the answer earlier today',
    'quick one about the vesting schedule',
    'is the unlock linear or cliff based?',
    'any chance you do an AMA this month',
    'sent you the details on telegram',
    'will you cover the new listing on stream?',
    'holding since the first week, the tool is good',
    'what do you think about funding rates right now',
    'been waiting on this poll for two weeks haha',
    'is the treasury address the same as in the pinned post',
    'ok, understood. that clears it up',
    'voted, and I moved half my bag after',
    'can you look at the numbers on the last poll',
    'my vote disappeared after I sold, is that expected?',
    'does the weight update live or once a day',
    'great stream yesterday, the second half especially',
    'who runs this site, you or a team',
    'the card image shows an old number',
    'how long does a poll usually stay open',
    'asked twice already, sorry for the noise',
    'just here to say the sorting is smart',
    'can I change my vote later or is it final',
    'why is my handle only three characters',
    'dm threshold seems high for smaller wallets',
    'you should put the next one at 24 hours',
    'screenshot of the poll went around btw',
    'reading the docs now, one thing is unclear',
    'found a typo on the login screen',
    'no rush on this, whenever you have time',
    'second time asking about the AMA, sorry',
    'price feed looks stale on my side',
    'everything works on mobile now, nice work',
    'which wallet do I send from, phantom?',
    'i think the closed polls should stay visible',
    'up 3x since the first vote, thanks for that',
    'are you keeping the ticker or changing it',
    'long time lurker, first message here',
    'let me know if you want testers for this'
  ];
  -- Ansems Antworten. Auch sie stehen in der Liste, mit "You:" davor, also
  -- gelten dieselben zwei Regeln. Vierundzwanzig Stueck, damit sich in den
  -- ersten zwei Dutzend Zeilen keine wiederholt.
  antworten text[] := array[
    'will cover it in the next stream',
    'yes, that is the plan for now',
    'not yet, waiting on the numbers',
    'good question, short answer is no',
    'sending you something later today',
    'seen it, thanks for writing in',
    'that one is in the docs already',
    'fixed, thanks for flagging it',
    'next poll will answer that one',
    'same address as the pinned post',
    'it updates when the balance moves',
    'no team behind this, just me',
    'friday, if the numbers hold up',
    'you can change it until it closes',
    'appreciate it, means a lot',
    'I read everything here, even without replying',
    'put it in the poll and we will see',
    'checking now, give me an hour',
    'keeping the ticker, that is settled',
    'give me a day and I will look',
    'ask again after the unlock',
    'on it, should be done today',
    'screenshot it and send it over',
    'makes sense, changing it this week'
  ];
  n int;
  k int;
  saat bigint := 77771;
  gelesen boolean;
begin
  -- Die zwei Regeln von oben, nachgesehen statt geglaubt. Beide sind schon
  -- einmal gebrochen worden, und beide Male stand das Ergebnis im Bild,
  -- bevor es jemandem auffiel.
  for k in 1..array_length(texte, 1) loop
    if length(texte[k]) < 22 then
      raise exception 'Nachricht % ist mit % Zeichen zu kurz fuer eine Zeile: %',
        k, length(texte[k]), texte[k];
    end if;
    for n in 1..k - 1 loop
      if left(texte[k], 16) = left(texte[n], 16) then
        raise exception 'Nachricht % und % sehen in der Liste gleich aus: %',
          n, k, left(texte[k], 16);
      end if;
    end loop;
  end loop;
  for k in 1..array_length(antworten, 1) loop
    if length(antworten[k]) < 22 then
      raise exception 'Antwort % ist mit % Zeichen zu kurz: %',
        k, length(antworten[k]), antworten[k];
    end if;
    for n in 1..k - 1 loop
      if left(antworten[k], 16) = left(antworten[n], 16) then
        raise exception 'Antwort % und % sehen in der Liste gleich aus: %',
          n, k, left(antworten[k], 16);
      end if;
    end loop;
  end loop;

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

-- --- zwei Abstimmungen ------------------------------------------------------
-- Eine laufende mit Frist, eine geschlossene. Das sind die beiden Zustaende,
-- um die es in den Bildern geht: an der einen kann man noch etwas aendern, an
-- der anderen nichts mehr.
--
-- Eine dritte, laufend OHNE Frist, stand hier und ist weg. Sie kostete im
-- Bild eine ganze Karte fuer einen Unterschied, den man ihr nicht ansieht -
-- eine Zeile weniger in der Kopfzeile. Den Zustand pruefen die Tests, die
-- ihre Daten selbst mitbringen (scripts/test-poll-frist.mjs); ein Artikelbild
-- braucht ihn nicht.
--
-- created_at ist gesetzt und nicht dem Zufall ueberlassen: die Liste
-- sortiert danach, neueste zuerst, und ein Bild soll oben die laufende
-- Frage mit Frist zeigen und darunter die geschlossene. Bei drei Polls mit
-- derselben Einfuegezeit entscheidet sonst die Datenbank, und zwar bei
-- jedem Lauf neu.
insert into public.polls (question, closes_at, closed, created_at) values
  ('Which chain should I cover next?',
   now() + interval '5 hours 12 minutes', false, now() - interval '20 hours'),
  ('Change the ticker?', now() - interval '3 days', true, now() - interval '6 days');

insert into public.poll_options (poll_id, label, idx)
select p.id, o.label, o.idx from public.polls p
join (values
  ('Which chain should I cover next?', 'Solana', 1),
  ('Which chain should I cover next?', 'Hyperliquid', 2),
  ('Which chain should I cover next?', 'Base', 3),
  ('Which chain should I cover next?', 'Monad', 4),
  ('Change the ticker?', 'Keep $ANSEM', 1),
  ('Change the ticker?', 'Something shorter', 2),
  ('Change the ticker?', 'Put it to a second vote', 3),
  ('Change the ticker?', 'No opinion', 4)
) as o(frage, label, idx) on o.frage = p.question;

-- Die Stimmen.
--
-- Wer abstimmt, entscheidet ein Hash (siehe die Beteiligung unten). WAS
-- jemand waehlt, entschied frueher ebenfalls ein Hash - und das ging schief,
-- seit nur noch gut ein Dutzend Wallets je Frage abstimmen: bei sechzehn
-- Stimmen mit sehr verschiedenen Gewichten kam ein Ergebnis heraus, das
-- keine Ordnung hatte. Eine Antwort stand bei 0 Dollar, die zweite und die
-- dritte lagen ueber Kreuz, und der Balken darunter war laenger als der
-- darueber. Ein echtes Ergebnis darf so aussehen; ein Bild, das erklaeren
-- soll, was ein Balken misst, nicht.
--
-- Deshalb wird jetzt AUSGETEILT statt gewuerfelt: die Abstimmenden werden
-- nach Bestand sortiert, und wer mehr haelt, landet weiter oben in der Liste
-- der Antworten. Der Exponent verteilt sie ungleich auf die Antworten - die
-- erste bekommt die Haelfte, die letzte ein Achtel.
--
-- Beides zusammen, mehr Stimmen UND schwerere, muss sein: die Bestaende
-- liegen dicht beieinander (120.000 bis 600.000, die meisten unter 200.000),
-- also entscheidet vor allem die Zahl der Stimmen ueber die Laenge eines
-- Balkens. Mit nur schwereren Stimmen auf der ersten Antwort kam die
-- Rangfolge genau verkehrt herum heraus.
--
-- Das Ergebnis ist eine Rangfolge, die von oben nach unten faellt. Erfunden
-- ist sie so oder so; sie ist jetzt nur lesbar erfunden.
insert into public.votes (poll_id, option_id, wallet, weight_tokens, weight_usd, created_at)
select p.id, o.id, v.address, v.ui_amount, v.usd_value,
       case when p.closed then now() - interval '4 days' else now() - interval '1 hour' end
from public.polls p
join lateral (
  select w.address, w.ui_amount, w.usd_value,
         row_number() over (order by w.usd_value desc) as r,
         count(*) over () as n
    from public.wallets w
   where w.address <> 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw'
     and case when p.closed
              then ('x' || substr(md5(w.address || 'zu-teil'), 1, 4))::bit(16)::int % 1000 < 17
              else ('x' || substr(md5(w.address || 'teil'), 1, 4))::bit(16)::int % 1000 < 22
         end
) v on true
join lateral (
  select o.id from public.poll_options o
   where o.poll_id = p.id
     and o.idx = 1 + least(
       (select count(*) from public.poll_options x where x.poll_id = p.id) - 1,
       floor((select count(*) from public.poll_options x where x.poll_id = p.id)
             * power((v.r - 1)::numeric / v.n, case when p.closed then 1.7 else 2.0 end))::int)
   limit 1
) o on true;

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

-- Wie lang der laengste Balken geworden ist, schwarz auf weiss. Die Zahl
-- haengt an drei Stellen zugleich - der Bestandskurve, der Beteiligung und
-- der Zahl der Antworten je Frage -, und wer eine davon anfasst, soll sie
-- hier sehen und nicht erst im fertigen Bild.
--
-- Die Vorgabe, schwarz auf weiss: keine Abstimmung ueber zwei Millionen
-- Dollar Volumen. Sie haengt an drei Zahlen an drei verschiedenen Stellen -
-- der Bestandskurve, der Beteiligung und der Zahl der Antworten je Frage -,
-- und wer eine davon anfasst, soll es hier merken und nicht im fertigen
-- Bild.
do $$
declare
  groesste numeric;
  frage text;
  leer int;
  verdreht int;
begin
  -- Keine Antwort ohne Stimme, und die oberste ist die laengste. Beides ist
  -- eine Aussage ueber die SAAT und nicht ueber die Seite: eine echte
  -- Abstimmung darf eine leere Antwort haben und einen Sieger in der Mitte.
  -- Ein Bild, das erklaeren soll, was ein Balken misst, sollte es nicht.
  select count(*) into leer
    from public.poll_options o
    left join public.poll_totals t on t.option_id = o.id
   where coalesce(t.votes, 0) = 0;
  if leer > 0 then
    raise exception '% Antwort(en) ohne eine einzige Stimme - die Verteilung '
      'der Stimmen trifft nicht mehr jede Antwort.', leer;
  end if;

  select count(*) into verdreht from (
    select t.poll_id from public.poll_totals t
     join public.poll_options o on o.id = t.option_id
    group by t.poll_id
    having max(t.usd) <> max(t.usd) filter (where o.idx = 1)
  ) x;
  if verdreht > 0 then
    raise exception 'In % Abstimmung(en) ist nicht die erste Antwort die '
      'groesste - im Bild steht dann ein laengerer Balken unter einem '
      'kuerzeren.', verdreht;
  end if;

  select sum(usd), max(p.question) into groesste, frage
    from public.poll_totals t join public.polls p on p.id = t.poll_id
   group by t.poll_id order by sum(usd) desc limit 1;
  raise notice 'Groesstes Volumen: % Dollar (%)', round(groesste), frage;
  if groesste > 2000000 then
    raise exception 'Die Abstimmung "%" kommt auf % Dollar - ueber den zwei '
      'Millionen, die vorgegeben sind. Beteiligung senken.', frage, round(groesste);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Ein Halter, mit dem man sich tatsaechlich anmelden kann
-- --- der eine Halter, den es wirklich gibt ---------------------------------
--
-- Die 500 Adressen oben sind erfunden. Sie stehen in der Datenbank und sehen
-- in der Liste richtig aus, aber verify() weist sie ab: isSolanaAddress
-- verlangt base58, das zu genau 32 Bytes dekodiert, und das tun sie nicht.
-- Fuer den Posteingang reicht das, dort stehen nur die ersten drei Zeichen -
-- fuer eine Anmeldung nicht. Wer die Seite AUS DER SICHT eines Halters sehen
-- will, kommt mit keiner von ihnen hinein.
--
-- Diese hier ist echtes base58 mit 32 Bytes und steht fest, damit sie nicht
-- bei jedem Lauf wechselt: sha256('sized-artikel-halter-14').
--
-- Die 14 ist gesucht und nicht gewaehlt. Der lokale Stapel erfindet den
-- Bestand einer Wallet aus sha256 der ADRESSE (mockAmount in
-- scripts/dev-stack.mjs) und ueberschreibt beim Anmelden, was hier steht -
-- die Zahlen hier muessen also mit dem uebereinstimmen, was er gleich daraus
-- macht, sonst zeigt die Liste einen anderen Betrag als die Kopfzeile.
-- Gesucht wurde eine Adresse in der obersten Stufe (21 Mio. Token): mal dem
-- Mock-Preis von 0.012 sind das 252.089 Dollar, und damit steht dieser
-- Halter mitten in der Liste statt unter allen anderen.
insert into public.wallets (address, ui_amount, usd_value, price, updated_at, first_seen, priced_at)
values ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', 21007410, 252088.92, 0.012, now(), now() - interval '73 days', now())
on conflict (address) do update
  set ui_amount = excluded.ui_amount, usd_value = excluded.usd_value, price = excluded.price;

-- Sein Gespraech mit Ansem, von Hand geschrieben.
--
-- Es steht in ZWEI Bildern: in Ansems Posteingang als das geoeffnete
-- Gespraech, und in der Nutzeransicht als der ganze Verlauf. Beide Bilder
-- zeigen also dieselben sechs Nachrichten von zwei Seiten - das war vorher
-- nicht so, dort standen zwei verschiedene Gespraeche nebeneinander, und wer
-- die Bilder nacheinander liest, stolpert darueber.
--
-- Die 500 gewuerfelten Gespraeche taugen dafuer nicht: sie sind fuer die
-- LISTE gemacht, eine Zeile, sechzehn Zeichen. Aufgeklappt stehen dort vier
-- Saetze untereinander, die nichts miteinander zu tun haben.
--
-- Und es erklaert nebenbei, worum sich die ganze Seite dreht: das Gewicht
-- folgt dem Bestand, bis die Abstimmung schliesst.
alter table public.dms disable trigger all;
insert into public.dms (wallet, from_admin, body, snap_tokens, snap_usd, read_by_admin, created_at)
values
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'voted on the chain poll. how long does it stay open?',
   21007410, 252088.92, true, now() - interval '3 days'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', true,
   'closes tonight. the header counts it down.',
   0, 0, true, now() - interval '3 days' + interval '90 minutes'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'if I sell half my bag after voting, does my vote shrink or stay?',
   21007410, 252088.92, true, now() - interval '2 days'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', true,
   'it shrinks. the number follows the balance until the poll closes.',
   0, 0, true, now() - interval '2 days' + interval '2 hours'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', false,
   'makes sense. that is why the closed ones freeze then',
   21007410, 252088.92, true, now() - interval '28 hours'),
  ('6KyCMM97hXDFsGEfKoxgWtP1FEn3L9uoxAFMkpcmvoUR', true,
   'exactly. after that nothing moves.',
   0, 0, true, now() - interval '27 hours');
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

commit;

select (select count(*) from public.wallets) as wallets,
       (select count(*) from public.dms) as nachrichten,
       (select count(distinct wallet) from public.dms) as gespraeche,
       (select count(*) from public.dms where not read_by_admin) as ungelesen,
       (select count(*) from public.polls) as polls,
       (select count(*) from public.votes) as stimmen;
