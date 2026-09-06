-- ============================================================================
-- DMs werden angestupst, nicht an alle gemeldet
-- ============================================================================
--
-- Das Problem
--
-- Bisher hörte jeder offene Browser über `postgres_changes` an public.dms mit.
-- Supabase prüft bei dieser Art Kanal die Rechte EINZELN, für jeden Zuhörer,
-- bei jeder Änderung. Aus deren Doku:
--
--   "Postgres Changes authorizes every event against each subscriber. When you
--    make a single change to a table with 100 subscribed users, Realtime
--    performs 100 authorization checks — one per user."
--
-- Eine einzige DM an Ansem löst bei 3.000 offenen Seiten also 3.000
-- Rechteprüfungen aus. Bei 50 DMs pro Minute sind das rund 2.500 Prüfungen
-- pro Sekunde. Und dieselbe Seite nennt genau unsere Zielgröße als Grenze:
-- über ~3.000 gleichzeitige Zuhörer soll man auf Broadcast wechseln.
--
-- Der Satz, auf den es ankommt:
--
--   "changes are also processed on a single thread to preserve their order,
--    which means larger compute add-ons don't meaningfully increase Postgres
--    Changes throughput."
--
-- Ein größerer Server hilft hier also NICHT. Das ist ein Umbau oder nichts.
--
-- ----------------------------------------------------------------------------
-- Die Lösung
--
-- Ein Trigger schickt bei jeder neuen DM zwei Broadcasts:
--
--   dm:<wallet>   -> an den Eigentümer des Threads    (1 Zuhörer)
--   dm:admin      -> an Ansems Posteingang            (1 Zuhörer)
--
-- Zwei Zustellungen statt 3.000 Prüfungen. Die Rechte werden EINMAL beim
-- Betreten des Kanals geprüft, nicht bei jeder Nachricht.
--
-- ----------------------------------------------------------------------------
-- Warum der Broadcast KEINEN Inhalt trägt
--
-- Er enthält nur die Thread-Adresse und einen Zeitstempel – kein `body`, keine
-- Beträge, nichts. Der Browser weiss dadurch nur "in deinem Thread hat sich
-- etwas getan" und lädt danach ganz normal über die Datenbank nach, wo die
-- bestehende RLS von public.dms greift wie immer.
--
-- Das ist Absicht und der Grund, warum ich mich bei dieser Bauweise wohlfühle:
-- Selbst wenn die Zugangsregel weiter unten falsch wäre und jemand einen
-- fremden Kanal beträte, bekäme er nichts zu lesen ausser der Information,
-- dass irgendwo eine Nachricht liegt. Der Inhalt läuft weiter ausschliesslich
-- über den Weg, der seit dem ersten Tag geprüft ist.
--
-- ----------------------------------------------------------------------------
-- Nur empfangen, nicht senden
--
-- Weiter unten steht eine Regel für `select` und ausdrücklich KEINE für
-- `insert`. select heisst empfangen, insert heisst senden. Ohne insert-Regel
-- kann kein Browser selbst einen Stups losschicken – niemand kann Ansem ein
-- Klingeln vortäuschen oder fremde Browser zu Abfragen treiben. Gesendet wird
-- ausschliesslich vom Trigger unten, und der läuft in der Datenbank.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Der Stups
-- ----------------------------------------------------------------------------

create or replace function app.dm_stups()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare nutzlast jsonb;
begin
  -- Bewusst ohne Inhalt: nur wessen Thread und wann. Siehe oben.
  nutzlast := jsonb_build_object(
    'wallet', new.wallet,
    'at',     extract(epoch from new.created_at)
  );

  -- realtime.send(payload, event, topic, private)
  perform realtime.send(nutzlast, 'dm', 'dm:' || new.wallet, true);
  perform realtime.send(nutzlast, 'dm', 'dm:admin',          true);

  return null;
end;
$$;

drop trigger if exists trg_dms_stups on public.dms;
create trigger trg_dms_stups
  after insert on public.dms
  for each row execute function app.dm_stups();

-- ----------------------------------------------------------------------------
-- 2. Wer welchen Kanal betreten darf
-- ----------------------------------------------------------------------------
--
-- Die Doku zeigt als Beispiel `using (true)` – "authenticated users can receive
-- broadcasts". Das wäre hier ein Loch: Damit könnte jeder Angemeldete den
-- Kanal dm:<fremde-adresse> betreten und mitbekommen, wann diese Person mit
-- Ansem schreibt. Kein Inhalt, aber ein Bewegungsprofil.
--
-- Also eng: die eigene Adresse, und dm:admin nur für Ansem. app.is_admin()
-- vergleicht dabei wie überall die Wallet aus dem Anmeldeausweis gegen
-- app_config.admin_wallet – es glaubt keinem is_admin-Feld im Ausweis.
--
-- Ist keine Wallet im Ausweis, ergibt 'dm:' || null den Wert null, und der
-- Vergleich ist niemals wahr. Also kommt niemand ohne Anmeldung hinein.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice 'Schema realtime fehlt – Zugangsregel übersprungen (lokaler Test?).';
    return;
  end if;

  execute 'drop policy if exists dm_stups_empfangen on realtime.messages';
  execute $regel$
    create policy dm_stups_empfangen on realtime.messages
      for select to authenticated
      using (
        extension = 'broadcast'
        and (
          (select realtime.topic()) = 'dm:' || app.jwt_wallet()
          or ((select realtime.topic()) = 'dm:admin' and app.is_admin())
        )
      )
  $regel$;
end $$;

-- ----------------------------------------------------------------------------
-- 3. public.dms verlässt die Live-Zustellung
-- ----------------------------------------------------------------------------
--
-- Sonst liefe beides nebeneinander: der Stups UND die alte Meldung an jeden
-- Zuhörer. Die teure Hälfte muss weg, sonst war der Umbau umsonst.
--
-- ACHTUNG für später: Wer in public/app.js je wieder einen postgres_changes-
-- Kanal auf `dms` einbaut, muss die Tabelle hier erneut aufnehmen. Sonst kommt
-- nichts an, ohne Fehler und ohne Warnung.
--
-- replica identity full bleibt stehen – kostet nichts, solange die Tabelle
-- nicht veröffentlicht ist, und wäre der stille Fallstrick beim Zurückbauen.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'dms'
     )
  then
    alter publication supabase_realtime drop table public.dms;
  end if;
end $$;
