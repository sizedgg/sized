-- ============================================================================
-- Der Nachlauf und die Aufraeumung widersprachen sich
--
-- Zwei Aenderungen, beide aus dieser Woche, beide fuer sich richtig:
--
--   20260907010000  Ein Trigger setzt beim Anlegen einer neuen Challenge
--                   alle abgelaufenen offenen DERSELBEN Wallet auf
--                   'expired'. Sonst belegen sie ihren Betrag dauerhaft im
--                   eindeutigen Index, und eine Adresse laesst sich
--                   fremdaussperren.
--
--   heute           verify/index.ts ordnet eine Zahlung noch eine Stunde
--                   nach Ablauf zu (NACHLAUF_MS). Wer bei ueberlastetem Netz
--                   sendet und dessen Bestaetigung erst nach den 25 Minuten
--                   eintrifft, hatte bezahlt und kam trotzdem nicht hinein.
--
-- Zusammen heben sie sich auf, und zwar genau im wahrscheinlichsten Fall:
--
--   1. Jemand sendet, die Bestaetigung haengt.
--   2. Er wartet, es passiert nichts, er drueckt neu - und bekommt eine
--      neue Challenge fuer dieselbe Adresse.
--   3. Der Trigger setzt dabei die alte auf 'expired'.
--   4. Die Bestaetigung kommt an. Die Zuordnung sucht 'pending' und findet
--      nichts mehr. Das Geld ist weg, die Anmeldung schlaegt fehl, und von
--      aussen ist kein Grund zu sehen.
--
-- Genau der Fall, fuer den der Nachlauf gebaut wurde. Er war wirkungslos,
-- sobald der Betroffene das Naheliegende tut.
--
-- ----------------------------------------------------------------------------
-- Warum die Stunde hier nichts kostet
--
-- Der Trigger raeumt eine Stunde spaeter. Der Betrag bleibt also bis zu
-- 1 h 25 min reserviert statt 25 min - und das ist fuer den Nachlauf sogar
-- die Voraussetzung: der eindeutige Index auf offenen Betraegen
-- (uq_challenges_open_amount) ist es, der garantiert, dass eine spaete
-- Zahlung auf GENAU EINE Zeile passt. Ohne ihn koennte die Zuordnung zwei
-- Zeilen treffen, beide bekaemen dieselbe tx_sig, und die ist eindeutig -
-- die Zuordnung schluege ganz fehl.
--
-- Die Obergrenze offener Fenster pro Wallet zaehlt davon nichts mit: sie
-- zaehlt "status = 'pending' and expires_at > now()"
-- (app.limit_open_challenges), also nur noch laufende. Eine Zeile im
-- Nachlauf ist abgelaufen und faellt heraus. Niemand kommt dadurch
-- schlechter hinein als vorher.
--
-- Und die Aussperrung, gegen die der Trigger gebaut wurde, bleibt
-- verhindert: "dauerhaft" war das Problem, nicht "eine Stunde".
--
-- Bleibt die Stunde an zwei Stellen zu pflegen - hier und als NACHLAUF_MS in
-- verify/index.ts. Ein Wert in app_config waere sauberer, kostet aber bei
-- jedem Anlegen einen Lesezugriff aus einem Trigger. Wer eine der beiden
-- aendert, aendert die andere mit; deshalb steht der Name der Konstante hier.
-- ============================================================================

begin;

create or replace function app.raeume_abgelaufene_challenges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Nur diese Wallet, nicht die ganze Tabelle: das haelt die Schreibspur
  -- klein und macht aus dem Aufraeumen keine Sperre fuer alle anderen.
  --
  -- Und erst eine Stunde nach Ablauf - so lange kann verify eine spaet
  -- bestaetigte Zahlung noch zuordnen (NACHLAUF_MS). Vorher stand hier
  -- "expires_at <= now()", und damit verlor genau der sein Geld, fuer den
  -- der Nachlauf gedacht war.
  update public.challenges
     set status = 'expired'
   where wallet = new.wallet
     and status = 'pending'
     and expires_at <= now() - interval '1 hour';
  return new;
end;
$$;

comment on function app.raeume_abgelaufene_challenges() is
  'Setzt offene Challenges derselben Wallet auf expired, sobald auch der '
  'Nachlauf von einer Stunde vorbei ist (NACHLAUF_MS in verify/index.ts). '
  'Ohne das belegen sie ihren Betrag dauerhaft und eine Adresse laesst sich '
  'fremdaussperren; ohne den Nachlauf verliert eine spaet bestaetigte '
  'Zahlung ihre Challenge.';

commit;
