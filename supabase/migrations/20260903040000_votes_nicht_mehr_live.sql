-- ----------------------------------------------------------------------------
-- public.votes verlässt die Realtime-Veröffentlichung
--
-- Warum
--
-- Realtime zählt Zustellungen, nicht Änderungen: Eine Zeile, die an 500
-- Zuhörer geht, sind 500 Nachrichten. Und votes_read steht auf `using (true)` –
-- Stimmen sind absichtlich für alle einsehbar, damit die Gewichtung
-- nachvollziehbar bleibt. Also fällt kein einziger Zuhörer durch die
-- Rechteprüfung heraus.
--
-- Der Fall, auf den die Seite hinarbeitet: Ansem stellt eine Abstimmung online,
-- 500 Leute sind da und stimmen in einer halben Minute ab. Rund 17 Stimmen pro
-- Sekunde mal 500 Browser sind etwa 8.300 Nachrichten pro Sekunde. Das
-- Kontingent liegt je nach Tarif bei 500 oder 2.500. Darüber schliesst Supabase
-- die Kanäle mit „Too many messages per second", alle Browser treten
-- gleichzeitig neu bei und laufen ins Beitritts-Limit hinterher.
--
-- Eine Stimmenzahl ist ein Zähler, kein Ereignis. Der Polls-Tab fragt sie
-- deshalb alle 5 Sekunden selbst nach (STIMMEN_TAKT_MS in public/app.js).
-- Gewöhnliche Abfragen zählen gegen kein Realtime-Kontingent.
--
-- Was live bleibt
--
--   polls, poll_options -> eine neue oder beendete Abstimmung, ein paar Mal am
--                          Tag, soll sofort erscheinen
--   dms                 -> ein Satz an einen einzelnen Menschen, der auf
--                          Antwort wartet
--   messages            -> unverändert
--
-- ACHTUNG für später
--
-- Wer in public/app.js die Zeile `.on(… table: 'votes' …)` wieder einbaut, muss
-- die Tabelle hier ebenfalls wieder aufnehmen. Sonst kommt schlicht nichts an –
-- ohne Fehler, ohne Warnung, ohne Eintrag in der Konsole. Diese Wanderung ist
-- die einzige Stelle, an der das steht.
--
-- replica identity full bleibt
--
-- Das kostet nichts, solange die Tabelle nicht veröffentlicht ist, und wäre der
-- stille Fallstrick beim Wiedereinschalten. Also stehen lassen.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'votes'
     )
  then
    alter publication supabase_realtime drop table public.votes;
  end if;
end $$;
