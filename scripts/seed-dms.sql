-- ============================================================================
-- Testdaten: 50 Wallets, 85 Nachrichten an Ansem
--
-- Zum Einfügen im SQL-Editor des Supabase-Projekts. Alles läuft in EINER
-- Transaktion: Geht etwas schief, bleibt gar nichts zurück.
--
-- Drei Dinge, die beim Einfügen zu beachten waren:
--
--   * Die Trigger auf `dms` laufen auch hier. Einer davon prüft den
--     Mindestbestand – und da eine Testwallet bewusst darunter liegt, würde
--     ihre Nachricht abgewiesen. Die Schwelle wird deshalb kurz auf 0 gesetzt
--     und am Ende auf ihren alten Wert zurückgestellt. Gemerkt wird der alte
--     Wert in einer Sitzungsvariablen statt in einer temporären Tabelle: Der
--     SQL-Editor von Supabase warnt bei jedem CREATE TABLE, dass die neue
--     Tabelle keine RLS hat. Bei einer temporären Tabelle ist das gegenstandslos
--     – sie existiert nur für diese eine Transaktion und ist für keinen Client
--     erreichbar –, aber eine Warnung, die man wegklicken muss, ist eine
--     Warnung zu viel.
--   * Die Bestände werden aus dem zuletzt bekannten Kurs zurückgerechnet.
--     Sonst würde der nächste Kurs-Takt sie neu ausrechnen und alle Beträge
--     auf einen Schlag verschieben.
--   * Zwei Paare teilen sich dieselben drei Zeichen (Km9 und 7xK). Genau
--     dafür gibt es die Namensfarben – im Posteingang sieht man daran, dass
--     es zwei verschiedene Leute sind.
--
-- Wieder loswerden: scripts/seed-dms-cleanup.sql
-- ============================================================================

begin;

-- Alten Wert merken, dann Schwelle aussetzen.
select set_config('sized.schwelle_vorher',
                  (select min_dm_usd::text from public.app_config where id = 1),
                  true);

update public.app_config set min_dm_usd = 0 where id = 1;

-- Wallets. usd_value ist der Zielwert, ui_amount wird daraus mit dem aktuell
-- gespeicherten Kurs zurückgerechnet.
with kurs as (
  select coalesce(
    (select price from public.wallets where price > 0 order by updated_at desc limit 1),
    0.0042) as p
)
insert into public.wallets (address, ui_amount, usd_value, price, updated_at)
select v.addr, (v.usd / kurs.p)::numeric(38, 9), v.usd::numeric(20, 4), kurs.p, now()
from (values
    ('9xYmc2wPNjtr4L2ULmyNoxmbLCmB3bzvZQCUg7FJuw2r', 1240000),
    ('997j11G8AX8JXvUc9b8uG7o9FFM7PdbMEHwQDakguqPc', 486000),
    ('EMZnrfLeNT5gkRgGcWxuJgZg5uS1xHs4Ho37jupEZYBe', 312500),
    ('M4gkqJ3J5cmfNsoKWUEaBk2EkjGUUvkFg7cU6yUZWkKr', 208000),
    ('nh6dq6VSXAFv7LpsTQcQM4yi8mkNJekdWN4hT95WafBA', 154000),
    ('rryw4S8wNeLao1g35Sg2sXADjZ5kstwcgfwtSPZpBrCo', 98700),
    ('8CWE9RU6KnnZssZZLtew8dVUadn98YVqqpRXCkCLncQB', 76400),
    ('7KnncmmWVK8CYzKP6QBLdDRsswgrZHyQ66e4A1bUZcAo', 61200),
    ('DyUdKV2v8BUFNHvtLoFPMgSBRuUxvh8wfRfkWHAzCZ2F', 54800),
    ('qy1tMyv9x54waKDZYhzqBjEbVDeTHbe6rSzWZyavTx7L', 43900),
    ('oD8cmMrUkNmqhjTQkg7hecAdVby6ix95RLfVnhNKbBk9', 38200),
    ('PLam8HCvwnDpReV8QinRv99jR9NhKQLmVwK72XM4ota2', 31500),
    ('Km9pdGjUDrGJj9DXYUcmmxiSjM57Fm7ucXAFgZCfvJEv', 27800),
    ('ii77gTPNUwuBbNx5jS4CHmaMtFvcQH3wNd2UqtvP8xPD', 24100),
    ('rNd5sMwWyijBs35boDuhkoRwZhDExK5UKdiGPnM3aWDt', 21600),
    ('1tHhhBAEArSiRAvddaUVMWZEQqgArzgqckQ52AsdZA2F', 18900),
    ('jpR8wD5EjEX2RwdcpPtUiCqqckHSECPwKNiLrfWseEG8', 16400),
    ('4Wm4ryZNCWctzVs1y9kNRXh9kbaAs8VddHwxJ5RR3hBN', 14700),
    ('uhA18Anqnn15jRedRDpMxKuYZsjkyDsPFzVW7p7vNGR9', 12800),
    ('sqDpRdqmiappmtB7vxdHKaA3nKdJwPchfCwKrqPvzX4q', 11300),
    ('7xK7V4dK5sZ4YaTBKVHVFCmwk7SLPR3fsK8WR8o42Gj6', 9840),
    ('ciGPvrrzsoUi1sSu5X4bZcSsPRqdDy3dWRJRbZ5SoiQP', 8820),
    ('sAcEoXEBsofRfsYNzd877VTwTsEx29KNsURJdAHVvJXj', 7650),
    ('ikYBLbDDNq8sqNhZ1ceu4N9JFdH6ZPqnsMXcZNxBnLsP', 6930),
    ('hBiui7KP7Kkg15i8XEQAyMdhA4AviM42Yv5fsAbhr9vp', 6110),
    ('QL1QxipJM4dUww8Af9h2FT3hkXQS6u9u6fgoztgchDjX', 5480),
    ('m94qHYv3f9DQHLTgi65CDdJzLozDnhDm9SphwAnVzcDy', 4920),
    ('k3fr1ubGNg5Y1VQLHDAzRexmKPcW8Mjc1o2YEZXj34qc', 4310),
    ('qRY7sBRQMKaGLWmDMMnTQCLS7UreETd9BaKqJfvJTNzh', 3870),
    ('tcZfowuY6ukenAf4VTu58BZPAJ56hE329ogGDoaiPZQ5', 3444),
    ('cnsgaGD2v8M8wTNYerzGRX4rUD7f8zcvo5qNBrX5eQoU', 2980),
    ('m5LxUhbzomwdQ6XCDBYB76VYMBjKnhezyAqKCnHoLmdD', 2610),
    ('5adq8oCLA9MTD7723eqxGyxth26WjM2pVcUUPJUEykZD', 2140),
    ('Km9aTVBCiMNULzPh1mikyPppHh3kNFySKHr598F676u4', 1870),
    ('qx45WPTxThrVov4keYibfnTHRZbVMv8Es75epL75TVpy', 1520),
    ('jq4eF652BVaFY1AsBdYJfaLqP8owJY2NtuoZHwjJ7tfy', 1302),
    ('2yrhKykLvzP3eP2U8HdZmPPhnAbq633WQC7tU5j6sCb3', 1140),
    ('onwkGsCSdouQvkDxjJFd6bsospQpNArNWUTuWrvVazYu', 980),
    ('Y3ZuX643M7rxxMYe9Dce36DiLzVA5QdhH5LLGb5XVMFQ', 860),
    ('xFzXkFsNP28HXSRs4hN5P4cXjv7LD7mqqnVu3wv4X1p6', 740),
    ('qrvGXGvFDtF2mU6Cqb5RdTLjGAHN4YLJnzua8jH9wUcc', 610),
    ('7xKCn5ULamVHapkfb8eySAQXzWYNm6xyjYy1oxkZYYeK', 520),
    ('ME9Xrgqbh7JPAHdPhrMUSAHcsMii2o5wPJJtby3c3rdF', 430),
    ('xjFhqEDynhUNBpSXQJD8wy6qCs7yKUTRToyNM7nkK6V7', 318),
    ('8SN9N9v55BjVjzzvVPVjpL6kZSLMbws87XzownBkTmfH', 260),
    ('8GERqsRpmmRoADKTHym5GNiQkSuazZ6n1Y4CVx2aHNC4', 201),
    ('XhxVT6TJ17hocirL2gE4XsyHaT2R94VTGkNQgi47YEs7', 148),
    ('F2b9YgMzUVXxtJHfsPsmjtq62NndvEWoAVKbsh3T8Bj5', 96),
    ('tkY8MJfY79q6Wt22RkUPbR2k4WpMrAfq4HmnuXg737yY', 42),
    ('Ry1DTdX75A94p79eZEo5k74diRi27i1apduUtz72RBZc', 7)
  ) as v(addr, usd), kurs
on conflict (address) do update
  set ui_amount = excluded.ui_amount,
      usd_value = excluded.usd_value,
      price     = excluded.price,
      updated_at = now();

insert into public.dms (wallet, from_admin, body, created_at, read_by_admin) values
  ('9xYmc2wPNjtr4L2ULmyNoxmbLCmB3bzvZQCUg7FJuw2r', false, 'gm ansem, quick question about the unlock schedule', now() - interval '9 days' + interval '540 minutes', false),
  ('9xYmc2wPNjtr4L2ULmyNoxmbLCmB3bzvZQCUg7FJuw2r', true, 'cliff, then linear over 18 months', now() - interval '9 days' + interval '547 minutes', true),
  ('9xYmc2wPNjtr4L2ULmyNoxmbLCmB3bzvZQCUg7FJuw2r', false, 'is the vesting linear or cliff based? cant find it in the docs', now() - interval '9 days' + interval '629 minutes', false),
  ('9xYmc2wPNjtr4L2ULmyNoxmbLCmB3bzvZQCUg7FJuw2r', false, 'sent you the deck last week, did it arrive', now() - interval '9 days' + interval '718 minutes', false),
  ('997j11G8AX8JXvUc9b8uG7o9FFM7PdbMEHwQDakguqPc', false, 'wen next poll ser', now() - interval '9 days' + interval '973 minutes', true),
  ('EMZnrfLeNT5gkRgGcWxuJgZg5uS1xHs4Ho37jupEZYBe', false, 'can you check the discord invite, it looks off', now() - interval '9 days' + interval '746 minutes', true),
  ('M4gkqJ3J5cmfNsoKWUEaBk2EkjGUUvkFg7cU6yUZWkKr', false, 'what happens to my vote if i move wallets', now() - interval '9 days' + interval '1179 minutes', true),
  ('M4gkqJ3J5cmfNsoKWUEaBk2EkjGUUvkFg7cU6yUZWkKr', false, 'how do i verify a second wallet', now() - interval '9 days' + interval '548 minutes', true),
  ('nh6dq6VSXAFv7LpsTQcQM4yi8mkNJekdWN4hT95WafBA', false, 'any chance of a mobile app later', now() - interval '9 days' + interval '952 minutes', false),
  ('rryw4S8wNeLao1g35Sg2sXADjZ5kstwcgfwtSPZpBrCo', false, 'when is the next AMA', now() - interval '9 days' + interval '665 minutes', true),
  ('rryw4S8wNeLao1g35Sg2sXADjZ5kstwcgfwtSPZpBrCo', true, 'noted, thanks for flagging', now() - interval '9 days' + interval '672 minutes', true),
  ('8CWE9RU6KnnZssZZLtew8dVUadn98YVqqpRXCkCLncQB', false, 'can you add more poll options next time', now() - interval '8 days' + interval '1098 minutes', true),
  ('8CWE9RU6KnnZssZZLtew8dVUadn98YVqqpRXCkCLncQB', false, 'long time listener first time caller', now() - interval '8 days' + interval '1187 minutes', true),
  ('7KnncmmWVK8CYzKP6QBLdDRsswgrZHyQ66e4A1bUZcAo', false, 'sent from a new wallet, ignore the old one', now() - interval '8 days' + interval '871 minutes', true),
  ('DyUdKV2v8BUFNHvtLoFPMgSBRuUxvh8wfRfkWHAzCZ2F', false, 'the reply feature is nice, was missing that', now() - interval '8 days' + interval '644 minutes', false),
  ('qy1tMyv9x54waKDZYhzqBjEbVDeTHbe6rSzWZyavTx7L', false, 'sent you the deck last week, did it arrive', now() - interval '8 days' + interval '1077 minutes', true),
  ('qy1tMyv9x54waKDZYhzqBjEbVDeTHbe6rSzWZyavTx7L', false, 'wen next poll ser', now() - interval '8 days' + interval '1106 minutes', true),
  ('oD8cmMrUkNmqhjTQkg7hecAdVby6ix95RLfVnhNKbBk9', false, 'ok thanks that clears it up', now() - interval '8 days' + interval '790 minutes', true),
  ('oD8cmMrUkNmqhjTQkg7hecAdVby6ix95RLfVnhNKbBk9', true, 'yes', now() - interval '8 days' + interval '797 minutes', true),
  ('PLam8HCvwnDpReV8QinRv99jR9NhKQLmVwK72XM4ota2', false, 'is there a plan for the remaining supply', now() - interval '8 days' + interval '563 minutes', true),
  ('PLam8HCvwnDpReV8QinRv99jR9NhKQLmVwK72XM4ota2', false, 'what happens to my vote if i move wallets', now() - interval '8 days' + interval '652 minutes', true),
  ('PLam8HCvwnDpReV8QinRv99jR9NhKQLmVwK72XM4ota2', false, 'how do i verify a second wallet', now() - interval '8 days' + interval '681 minutes', true),
  ('Km9pdGjUDrGJj9DXYUcmmxiSjM57Fm7ucXAFgZCfvJEv', false, 'the chat filter is great, can we get one for polls too', now() - interval '7 days' + interval '996 minutes', false),
  ('Km9pdGjUDrGJj9DXYUcmmxiSjM57Fm7ucXAFgZCfvJEv', false, 'any chance of a mobile app later', now() - interval '7 days' + interval '1025 minutes', false),
  ('ii77gTPNUwuBbNx5jS4CHmaMtFvcQH3wNd2UqtvP8xPD', false, 'just bought more, holding', now() - interval '7 days' + interval '769 minutes', true),
  ('rNd5sMwWyijBs35boDuhkoRwZhDExK5UKdiGPnM3aWDt', false, 'i got logged out on my phone, is that normal', now() - interval '7 days' + interval '1142 minutes', true),
  ('1tHhhBAEArSiRAvddaUVMWZEQqgArzgqckQ52AsdZA2F', false, 'does the $ value update live or on refresh', now() - interval '7 days' + interval '915 minutes', true),
  ('1tHhhBAEArSiRAvddaUVMWZEQqgArzgqckQ52AsdZA2F', true, 'will cover it in the next poll', now() - interval '7 days' + interval '922 minutes', true),
  ('1tHhhBAEArSiRAvddaUVMWZEQqgArzgqckQ52AsdZA2F', false, 'sent from a new wallet, ignore the old one', now() - interval '7 days' + interval '1004 minutes', true),
  ('jpR8wD5EjEX2RwdcpPtUiCqqckHSECPwKNiLrfWseEG8', false, 'thanks for building this', now() - interval '7 days' + interval '688 minutes', false),
  ('4Wm4ryZNCWctzVs1y9kNRXh9kbaAs8VddHwxJ5RR3hBN', false, 'is the vesting linear or cliff based? cant find it in the docs', now() - interval '6 days' + interval '1121 minutes', true),
  ('uhA18Anqnn15jRedRDpMxKuYZsjkyDsPFzVW7p7vNGR9', false, 'i have been holding since day one and wanted to ask about the treasury', now() - interval '6 days' + interval '894 minutes', true),
  ('uhA18Anqnn15jRedRDpMxKuYZsjkyDsPFzVW7p7vNGR9', false, 'ok thanks that clears it up', now() - interval '6 days' + interval '923 minutes', true),
  ('sqDpRdqmiappmtB7vxdHKaA3nKdJwPchfCwKrqPvzX4q', false, 'congrats on the launch, looks clean', now() - interval '6 days' + interval '607 minutes', true),
  ('7xK7V4dK5sZ4YaTBKVHVFCmwk7SLPR3fsK8WR8o42Gj6', false, 'how do i verify a second wallet', now() - interval '6 days' + interval '1040 minutes', false),
  ('7xK7V4dK5sZ4YaTBKVHVFCmwk7SLPR3fsK8WR8o42Gj6', true, 'go ahead', now() - interval '6 days' + interval '1047 minutes', true),
  ('ciGPvrrzsoUi1sSu5X4bZcSsPRqdDy3dWRJRbZ5SoiQP', false, 'who do i talk to about a partnership', now() - interval '6 days' + interval '813 minutes', true),
  ('ciGPvrrzsoUi1sSu5X4bZcSsPRqdDy3dWRJRbZ5SoiQP', false, 'just bought more, holding', now() - interval '6 days' + interval '842 minutes', true),
  ('sAcEoXEBsofRfsYNzd877VTwTsEx29KNsURJdAHVvJXj', false, 'is the treasury address public somewhere', now() - interval '6 days' + interval '586 minutes', true),
  ('sAcEoXEBsofRfsYNzd877VTwTsEx29KNsURJdAHVvJXj', false, 'i got logged out on my phone, is that normal', now() - interval '6 days' + interval '615 minutes', true),
  ('sAcEoXEBsofRfsYNzd877VTwTsEx29KNsURJdAHVvJXj', false, 'can you add more poll options next time', now() - interval '6 days' + interval '704 minutes', true),
  ('ikYBLbDDNq8sqNhZ1ceu4N9JFdH6ZPqnsMXcZNxBnLsP', false, 'long time listener first time caller', now() - interval '5 days' + interval '1019 minutes', true),
  ('hBiui7KP7Kkg15i8XEQAyMdhA4AviM42Yv5fsAbhr9vp', false, 'what decides the order of the inbox', now() - interval '5 days' + interval '732 minutes', false),
  ('hBiui7KP7Kkg15i8XEQAyMdhA4AviM42Yv5fsAbhr9vp', false, 'thanks for building this', now() - interval '5 days' + interval '821 minutes', false),
  ('QL1QxipJM4dUww8Af9h2FT3hkXQS6u9u6fgoztgchDjX', false, 'gm ansem, quick question about the unlock schedule', now() - interval '5 days' + interval '1165 minutes', true),
  ('QL1QxipJM4dUww8Af9h2FT3hkXQS6u9u6fgoztgchDjX', true, 'checking', now() - interval '5 days' + interval '1172 minutes', true),
  ('m94qHYv3f9DQHLTgi65CDdJzLozDnhDm9SphwAnVzcDy', false, 'wen next poll ser', now() - interval '5 days' + interval '938 minutes', true),
  ('k3fr1ubGNg5Y1VQLHDAzRexmKPcW8Mjc1o2YEZXj34qc', false, 'can you check the discord invite, it looks off', now() - interval '5 days' + interval '711 minutes', true),
  ('k3fr1ubGNg5Y1VQLHDAzRexmKPcW8Mjc1o2YEZXj34qc', false, 'congrats on the launch, looks clean', now() - interval '5 days' + interval '740 minutes', true),
  ('qRY7sBRQMKaGLWmDMMnTQCLS7UreETd9BaKqJfvJTNzh', false, 'what happens to my vote if i move wallets', now() - interval '4 days' + interval '1084 minutes', false),
  ('tcZfowuY6ukenAf4VTu58BZPAJ56hE329ogGDoaiPZQ5', false, 'any chance of a mobile app later', now() - interval '4 days' + interval '857 minutes', true),
  ('cnsgaGD2v8M8wTNYerzGRX4rUD7f8zcvo5qNBrX5eQoU', false, 'when is the next AMA', now() - interval '4 days' + interval '630 minutes', true),
  ('cnsgaGD2v8M8wTNYerzGRX4rUD7f8zcvo5qNBrX5eQoU', true, 'cliff, then linear over 18 months', now() - interval '4 days' + interval '637 minutes', true),
  ('cnsgaGD2v8M8wTNYerzGRX4rUD7f8zcvo5qNBrX5eQoU', false, 'is the treasury address public somewhere', now() - interval '4 days' + interval '719 minutes', true),
  ('m5LxUhbzomwdQ6XCDBYB76VYMBjKnhezyAqKCnHoLmdD', false, 'can you add more poll options next time', now() - interval '4 days' + interval '1063 minutes', true),
  ('5adq8oCLA9MTD7723eqxGyxth26WjM2pVcUUPJUEykZD', false, 'sent from a new wallet, ignore the old one', now() - interval '4 days' + interval '836 minutes', false),
  ('Km9aTVBCiMNULzPh1mikyPppHh3kNFySKHr598F676u4', false, 'the reply feature is nice, was missing that', now() - interval '4 days' + interval '549 minutes', true),
  ('Km9aTVBCiMNULzPh1mikyPppHh3kNFySKHr598F676u4', false, 'gm ansem, quick question about the unlock schedule', now() - interval '4 days' + interval '638 minutes', true),
  ('Km9aTVBCiMNULzPh1mikyPppHh3kNFySKHr598F676u4', false, 'is the vesting linear or cliff based? cant find it in the docs', now() - interval '4 days' + interval '667 minutes', true),
  ('qx45WPTxThrVov4keYibfnTHRZbVMv8Es75epL75TVpy', false, 'sent you the deck last week, did it arrive', now() - interval '3 days' + interval '982 minutes', true),
  ('jq4eF652BVaFY1AsBdYJfaLqP8owJY2NtuoZHwjJ7tfy', false, 'ok thanks that clears it up', now() - interval '3 days' + interval '755 minutes', true),
  ('jq4eF652BVaFY1AsBdYJfaLqP8owJY2NtuoZHwjJ7tfy', true, 'noted, thanks for flagging', now() - interval '3 days' + interval '762 minutes', true),
  ('2yrhKykLvzP3eP2U8HdZmPPhnAbq633WQC7tU5j6sCb3', false, 'is there a plan for the remaining supply', now() - interval '3 days' + interval '1188 minutes', false),
  ('2yrhKykLvzP3eP2U8HdZmPPhnAbq633WQC7tU5j6sCb3', false, 'what happens to my vote if i move wallets', now() - interval '3 days' + interval '557 minutes', false),
  ('onwkGsCSdouQvkDxjJFd6bsospQpNArNWUTuWrvVazYu', false, 'the chat filter is great, can we get one for polls too', now() - interval '3 days' + interval '901 minutes', true),
  ('Y3ZuX643M7rxxMYe9Dce36DiLzVA5QdhH5LLGb5XVMFQ', false, 'just bought more, holding', now() - interval '3 days' + interval '674 minutes', true),
  ('xFzXkFsNP28HXSRs4hN5P4cXjv7LD7mqqnVu3wv4X1p6', false, 'i got logged out on my phone, is that normal', now() - interval '2 days' + interval '1107 minutes', true),
  ('xFzXkFsNP28HXSRs4hN5P4cXjv7LD7mqqnVu3wv4X1p6', false, 'can you add more poll options next time', now() - interval '2 days' + interval '1196 minutes', true),
  ('qrvGXGvFDtF2mU6Cqb5RdTLjGAHN4YLJnzua8jH9wUcc', false, 'does the $ value update live or on refresh', now() - interval '2 days' + interval '880 minutes', false),
  ('qrvGXGvFDtF2mU6Cqb5RdTLjGAHN4YLJnzua8jH9wUcc', true, 'yes', now() - interval '2 days' + interval '887 minutes', true),
  ('7xKCn5ULamVHapkfb8eySAQXzWYNm6xyjYy1oxkZYYeK', false, 'thanks for building this', now() - interval '2 days' + interval '653 minutes', true),
  ('ME9Xrgqbh7JPAHdPhrMUSAHcsMii2o5wPJJtby3c3rdF', false, 'is the vesting linear or cliff based? cant find it in the docs', now() - interval '2 days' + interval '1026 minutes', true),
  ('ME9Xrgqbh7JPAHdPhrMUSAHcsMii2o5wPJJtby3c3rdF', false, 'sent you the deck last week, did it arrive', now() - interval '2 days' + interval '1115 minutes', true),
  ('xjFhqEDynhUNBpSXQJD8wy6qCs7yKUTRToyNM7nkK6V7', false, 'i have been holding since day one and wanted to ask about the treasury', now() - interval '2 days' + interval '799 minutes', true),
  ('8SN9N9v55BjVjzzvVPVjpL6kZSLMbws87XzownBkTmfH', false, 'congrats on the launch, looks clean', now() - interval '2 days' + interval '572 minutes', false),
  ('8SN9N9v55BjVjzzvVPVjpL6kZSLMbws87XzownBkTmfH', false, 'is there a plan for the remaining supply', now() - interval '2 days' + interval '601 minutes', false),
  ('8SN9N9v55BjVjzzvVPVjpL6kZSLMbws87XzownBkTmfH', false, 'what happens to my vote if i move wallets', now() - interval '2 days' + interval '690 minutes', false),
  ('8GERqsRpmmRoADKTHym5GNiQkSuazZ6n1Y4CVx2aHNC4', false, 'how do i verify a second wallet', now() - interval '1 days' + interval '1005 minutes', true),
  ('8GERqsRpmmRoADKTHym5GNiQkSuazZ6n1Y4CVx2aHNC4', true, 'will cover it in the next poll', now() - interval '1 days' + interval '1012 minutes', true),
  ('8GERqsRpmmRoADKTHym5GNiQkSuazZ6n1Y4CVx2aHNC4', false, 'the chat filter is great, can we get one for polls too', now() - interval '1 days' + interval '1034 minutes', true),
  ('XhxVT6TJ17hocirL2gE4XsyHaT2R94VTGkNQgi47YEs7', false, 'who do i talk to about a partnership', now() - interval '1 days' + interval '778 minutes', true),
  ('F2b9YgMzUVXxtJHfsPsmjtq62NndvEWoAVKbsh3T8Bj5', false, 'is the treasury address public somewhere', now() - interval '1 days' + interval '1151 minutes', true),
  ('tkY8MJfY79q6Wt22RkUPbR2k4WpMrAfq4HmnuXg737yY', false, 'long time listener first time caller', now() - interval '1 days' + interval '924 minutes', false),
  ('tkY8MJfY79q6Wt22RkUPbR2k4WpMrAfq4HmnuXg737yY', false, 'does the $ value update live or on refresh', now() - interval '1 days' + interval '1013 minutes', false),
  ('Ry1DTdX75A94p79eZEo5k74diRi27i1apduUtz72RBZc', false, 'what decides the order of the inbox', now() - interval '1 days' + interval '697 minutes', true);

update public.app_config
   set min_dm_usd = current_setting('sized.schwelle_vorher')::numeric
 where id = 1;

commit;

-- Kurze Kontrolle
select count(*) as gespraeche, sum(unread) as ungelesen from public.dm_threads;
