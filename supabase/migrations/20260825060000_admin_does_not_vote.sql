-- ============================================================================
-- Ansem stimmt in seinen eigenen Umfragen nicht ab
--
-- Er legt die Frage fest, er bestimmt die Auswahlmöglichkeiten, und er schließt
-- die Abstimmung. Wenn er zusätzlich mitstimmt, ist das Ergebnis kein Ergebnis
-- mehr, sondern seine Meinung mit einer Zahl daneben – und zwar mit dem
-- schwersten Gewicht im Raum, weil Gewicht am Bestand hängt.
--
-- Das ist keine Frage der Höflichkeit. Die Umfragen sind der einzige Ort, an
-- dem die Gemeinschaft etwas entscheidet; wer sie stellt, muss draußen bleiben,
-- damit die Antwort etwas wert ist.
--
-- Die Prüfung steht im Trigger und nicht in der RLS-Regel: guard_vote hat die
-- übrigen Bedingungen schon (Umfrage offen, Option passt, Gewicht > 0) und
-- meldet sie mit lesbarem Text. Eine abgewiesene RLS-Regel sagt dem Nutzer
-- dagegen nur, dass irgendetwas nicht erlaubt war.
-- ============================================================================

create or replace function app.guard_vote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.polls%rowtype;
begin
  -- Zuerst, denn es ist die grundsätzlichste der Bedingungen.
  --
  -- Bewusst app.is_admin() und nicht ein Vergleich mit new.wallet: is_admin()
  -- geht von der Wallet im Token aus. Ein Vergleich mit dem eingesendeten Feld
  -- ließe sich umgehen, indem man dort etwas anderes einträgt – die RLS-Regel
  -- votes_insert würde die Zeile am Ende zwar abweisen, aber dann hinge diese
  -- Sperre an einer anderen Regel statt an sich selbst.
  if app.is_admin() then
    raise exception 'You cannot vote in your own polls';
  end if;

  select * into p from public.polls where id = new.poll_id;
  if not found then
    raise exception 'This poll does not exist';
  end if;
  if p.closed or (p.closes_at is not null and p.closes_at < now()) then
    raise exception 'This poll is closed';
  end if;
  if not exists (
    select 1 from public.poll_options
    where id = new.option_id and poll_id = new.poll_id
  ) then
    raise exception 'That option belongs to a different poll';
  end if;
  if new.weight_tokens <= 0 then
    raise exception 'No tokens, no voting weight';
  end if;
  return new;
end;
$$;

-- Falls Ansem beim Testen schon abgestimmt hat: Diese Stimmen wieder entfernen.
-- Sie würden sonst in laufenden Umfragen weiterzählen, weil der Trigger nur
-- beim Einfügen und Ändern greift.
delete from public.votes v
 using public.app_config c
 where c.id = 1
   and c.admin_wallet is not null
   and v.wallet = c.admin_wallet;
