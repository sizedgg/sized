-- ============================================================================
-- Die og-Function wach halten
--
-- Einzuspielen im Supabase-Dashboard unter SQL Editor.
--
-- Das Problem, das dieser Job löst:
--
-- Wer einen Abstimmungslink in Xs Schreibfenster einfügt, sieht erst nur den
-- Link. Die Kachel erscheint, sobald Xs Crawler die Seite geholt hat. Das
-- Warten kommt fast vollständig aus einer Stelle: Eine Edge Function, die
-- eine Weile nicht gebraucht wurde, schläft. Der erste Aufruf muss sie
-- aufwecken, und das kostet ein bis zwei Sekunden – mehr als alles andere im
-- ganzen Weg zusammen.
--
-- Genau dieser erste Aufruf ist aber der, auf den es ankommt. Ein Link wird
-- einmal gepostet; danach merkt X sich die Kachel tagelang und fragt gar
-- nicht mehr nach. Die Function ist also fast immer kalt, wenn sie gebraucht
-- wird – ein perfektes Gegenteil von dem, was man will.
--
-- Alle zwei Minuten ein Aufruf hält sie wach. Das sind rund 21.000 Aufrufe im
-- Monat; im Pro-Tarif sind zwei Millionen enthalten, es kostet also nichts.
--
-- Aufgerufen wird /p/0 – eine Abstimmung mit dieser Nummer gibt es nicht. Das
-- ist Absicht: Der Weg durch die Function ist derselbe (Datenbank fragen,
-- Antwort bauen), nur ohne Bildprüfung. Es wärmt, was gewärmt werden muss,
-- und rührt sonst nichts an.
--
-- Der User-Agent muss nach Bot aussehen, sonst antwortet die Function mit
-- einer Weiterleitung und der eigentliche Weg – Datenbank, Seitenbau – bliebe
-- kalt.
--
-- Wiederholbar: Ein gleichnamiger Job wird vorher weggeräumt. cron.schedule
-- überschreibt NICHT, es legt einen zweiten mit demselben Namen an.
-- ============================================================================

do $$
begin
  perform cron.unschedule(jobname)
  from cron.job
  where jobname = 'og-warm';
end $$;

select cron.schedule('og-warm', '*/2 * * * *', $$
  select net.http_get(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/og/p/0',
    headers := '{"user-agent":"sized-warmup-bot"}'::jsonb
  );
$$);

-- Prüfen: Der Job muss dastehen und active = true sein.
select jobname, schedule, active from cron.job where jobname = 'og-warm';
