-- ============================================================================
-- Entfernt die Testdaten aus scripts/seed-dms.sql wieder.
--
-- Gelöscht wird ausschließlich anhand der Adressliste unten – nichts, was
-- nicht aus dem Testlauf stammt. Läuft auch mehrfach ohne Schaden.
--
-- Alles in einer einzigen Anweisung, damit keine temporäre Tabelle nötig ist:
-- Der SQL-Editor von Supabase warnt sonst bei jedem CREATE TABLE, dass die
-- neue Tabelle keine RLS hat. Bei einer temporären Tabelle ist das
-- gegenstandslos, aber die Warnung erscheint trotzdem.
-- ============================================================================

with liste(address) as (
  select unnest(array[
    '9xYmc2wPNjtr4L2ULmyNoxmbLCmB3bzvZQCUg7FJuw2r',
  '997j11G8AX8JXvUc9b8uG7o9FFM7PdbMEHwQDakguqPc',
  'EMZnrfLeNT5gkRgGcWxuJgZg5uS1xHs4Ho37jupEZYBe',
  'M4gkqJ3J5cmfNsoKWUEaBk2EkjGUUvkFg7cU6yUZWkKr',
  'nh6dq6VSXAFv7LpsTQcQM4yi8mkNJekdWN4hT95WafBA',
  'rryw4S8wNeLao1g35Sg2sXADjZ5kstwcgfwtSPZpBrCo',
  '8CWE9RU6KnnZssZZLtew8dVUadn98YVqqpRXCkCLncQB',
  '7KnncmmWVK8CYzKP6QBLdDRsswgrZHyQ66e4A1bUZcAo',
  'DyUdKV2v8BUFNHvtLoFPMgSBRuUxvh8wfRfkWHAzCZ2F',
  'qy1tMyv9x54waKDZYhzqBjEbVDeTHbe6rSzWZyavTx7L',
  'oD8cmMrUkNmqhjTQkg7hecAdVby6ix95RLfVnhNKbBk9',
  'PLam8HCvwnDpReV8QinRv99jR9NhKQLmVwK72XM4ota2',
  'Km9pdGjUDrGJj9DXYUcmmxiSjM57Fm7ucXAFgZCfvJEv',
  'ii77gTPNUwuBbNx5jS4CHmaMtFvcQH3wNd2UqtvP8xPD',
  'rNd5sMwWyijBs35boDuhkoRwZhDExK5UKdiGPnM3aWDt',
  '1tHhhBAEArSiRAvddaUVMWZEQqgArzgqckQ52AsdZA2F',
  'jpR8wD5EjEX2RwdcpPtUiCqqckHSECPwKNiLrfWseEG8',
  '4Wm4ryZNCWctzVs1y9kNRXh9kbaAs8VddHwxJ5RR3hBN',
  'uhA18Anqnn15jRedRDpMxKuYZsjkyDsPFzVW7p7vNGR9',
  'sqDpRdqmiappmtB7vxdHKaA3nKdJwPchfCwKrqPvzX4q',
  '7xK7V4dK5sZ4YaTBKVHVFCmwk7SLPR3fsK8WR8o42Gj6',
  'ciGPvrrzsoUi1sSu5X4bZcSsPRqdDy3dWRJRbZ5SoiQP',
  'sAcEoXEBsofRfsYNzd877VTwTsEx29KNsURJdAHVvJXj',
  'ikYBLbDDNq8sqNhZ1ceu4N9JFdH6ZPqnsMXcZNxBnLsP',
  'hBiui7KP7Kkg15i8XEQAyMdhA4AviM42Yv5fsAbhr9vp',
  'QL1QxipJM4dUww8Af9h2FT3hkXQS6u9u6fgoztgchDjX',
  'm94qHYv3f9DQHLTgi65CDdJzLozDnhDm9SphwAnVzcDy',
  'k3fr1ubGNg5Y1VQLHDAzRexmKPcW8Mjc1o2YEZXj34qc',
  'qRY7sBRQMKaGLWmDMMnTQCLS7UreETd9BaKqJfvJTNzh',
  'tcZfowuY6ukenAf4VTu58BZPAJ56hE329ogGDoaiPZQ5',
  'cnsgaGD2v8M8wTNYerzGRX4rUD7f8zcvo5qNBrX5eQoU',
  'm5LxUhbzomwdQ6XCDBYB76VYMBjKnhezyAqKCnHoLmdD',
  '5adq8oCLA9MTD7723eqxGyxth26WjM2pVcUUPJUEykZD',
  'Km9aTVBCiMNULzPh1mikyPppHh3kNFySKHr598F676u4',
  'qx45WPTxThrVov4keYibfnTHRZbVMv8Es75epL75TVpy',
  'jq4eF652BVaFY1AsBdYJfaLqP8owJY2NtuoZHwjJ7tfy',
  '2yrhKykLvzP3eP2U8HdZmPPhnAbq633WQC7tU5j6sCb3',
  'onwkGsCSdouQvkDxjJFd6bsospQpNArNWUTuWrvVazYu',
  'Y3ZuX643M7rxxMYe9Dce36DiLzVA5QdhH5LLGb5XVMFQ',
  'xFzXkFsNP28HXSRs4hN5P4cXjv7LD7mqqnVu3wv4X1p6',
  'qrvGXGvFDtF2mU6Cqb5RdTLjGAHN4YLJnzua8jH9wUcc',
  '7xKCn5ULamVHapkfb8eySAQXzWYNm6xyjYy1oxkZYYeK',
  'ME9Xrgqbh7JPAHdPhrMUSAHcsMii2o5wPJJtby3c3rdF',
  'xjFhqEDynhUNBpSXQJD8wy6qCs7yKUTRToyNM7nkK6V7',
  '8SN9N9v55BjVjzzvVPVjpL6kZSLMbws87XzownBkTmfH',
  '8GERqsRpmmRoADKTHym5GNiQkSuazZ6n1Y4CVx2aHNC4',
  'XhxVT6TJ17hocirL2gE4XsyHaT2R94VTGkNQgi47YEs7',
  'F2b9YgMzUVXxtJHfsPsmjtq62NndvEWoAVKbsh3T8Bj5',
  'tkY8MJfY79q6Wt22RkUPbR2k4WpMrAfq4HmnuXg737yY',
  'Ry1DTdX75A94p79eZEo5k74diRi27i1apduUtz72RBZc'
  ])
),
weg_dms as (
  delete from public.dms d using liste l where d.wallet = l.address returning 1
),
weg_votes as (
  delete from public.votes v using liste l where v.wallet = l.address returning 1
),
weg_messages as (
  delete from public.messages m using liste l where m.wallet = l.address returning 1
),
weg_wallets as (
  delete from public.wallets w using liste l where w.address = l.address returning 1
)
select
  (select count(*) from weg_dms)      as nachrichten,
  (select count(*) from weg_votes)    as stimmen,
  (select count(*) from weg_messages) as chatzeilen,
  (select count(*) from weg_wallets)  as wallets;
