-- ===========================================================================
-- Ablage für die Vorschaubilder, die X unter einem geteilten Link zeigt
--
-- Warum es diese Ablage überhaupt braucht:
--
-- Das Bild einer Abstimmung wird im Browser gezeichnet. Der Besucher, der den
-- Link auf X anklickt, ist aber nicht der Erste, der ihn öffnet – der Erste
-- ist Xs Crawler, und der führt kein JavaScript aus. Er liest die Meta-Zeilen
-- im Kopf der Seite und holt genau die Adresse, die dort als Bild steht. Also
-- muss das Bild schon fertig irgendwo liegen, bevor der Link gepostet wird.
--
-- Deshalb: Sobald Ansem eine Abstimmung anlegt, lädt sein Browser das Bild
-- hier hoch. Der öffentliche Eimer liefert es ohne Anmeldung aus – das muss
-- er, denn der Crawler hat keine.
--
-- Dass in dem Bild dann "0 votes" steht, ist kein Mangel: Genau so sieht die
-- Abstimmung in dem Moment aus, in dem der Link gepostet wird. Und X speichert
-- die Karte ohnehin zwischen, ein später erneuertes Bild würde dort tagelang
-- nicht ankommen.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('og', 'og', true, 4194304, array['image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = 4194304,
      allowed_mime_types = array['image/png'];

-- Lesen darf jeder, auch ohne Anmeldung. Der Crawler von X bringt kein Token
-- mit, und ein Vorschaubild ist ohnehin für die Öffentlichkeit bestimmt –
-- es steht am Ende in einer Zeitleiste.
drop policy if exists og_read on storage.objects;
create policy og_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'og');

-- Schreiben nur Ansem. app.is_admin() liest die Wallet aus demselben Token,
-- das auch für Nachrichten und Abstimmungen gilt – Storage-Regeln sind
-- gewöhnliche RLS-Regeln auf storage.objects, also greift dieselbe Funktion.
drop policy if exists og_admin_write on storage.objects;
create policy og_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'og' and app.is_admin());

-- Getrennt von insert, weil ein erneutes Hochladen desselben Namens ein
-- update ist. Ohne diese Regel liefe das Auffrischen einer Karte ins Leere.
drop policy if exists og_admin_update on storage.objects;
create policy og_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'og' and app.is_admin())
  with check (bucket_id = 'og' and app.is_admin());

-- Löschen ebenfalls: Wird eine Abstimmung gelöscht, soll ihr Bild nicht als
-- Leiche liegen bleiben.
drop policy if exists og_admin_delete on storage.objects;
create policy og_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'og' and app.is_admin());

-- Ansems Browser trägt beim Start fehlende Karten nach. Dafür muss er einmal
-- auflisten dürfen, was schon da ist – sonst müsste er für jede Abstimmung
-- einzeln nachsehen. Das Auflisten läuft über dieselbe select-Regel wie das
-- Lesen (og_read), die gilt bereits für alle. Hier steht nur der Hinweis,
-- damit niemand die Regel für überflüssig hält und sie entfernt.
