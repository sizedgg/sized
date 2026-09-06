-- ============================================================================
-- Zwei Änderungen an derselben Prüfung
--
--  1. Dieselbe Nachricht darf wieder zweimal hintereinander geschickt werden.
--  2. Die Absagen, die HAUSREGELN sind – ein Link im Chat, zu schnell
--     geschrieben –, bekommen eine Kennung, damit die Seite sie von echten
--     Fehlern unterscheiden kann.
--
-- ----------------------------------------------------------------------------
-- Zu 1: Warum die Sperre wieder rausgeht
--
-- Sie war als Spamschutz gedacht und hat dabei etwas Normales mitgefangen. In
-- einem Chat sagt man Dinge zweimal, und zwar aus guten Gründen: Die erste
-- Nachricht ging im Verlauf unter, niemand hat geantwortet, die Frage steht
-- noch. "wen poll" nach zehn Minuten noch einmal ist kein Spam, sondern der
-- übliche Umgang mit einem laufenden Chat.
--
-- Dass es sich anfühlte wie ein Fehler, lag an der Formulierung: "You already
-- said that" belehrt. Und der eigentliche Spamschutz sitzt ohnehin woanders –
-- sechs Nachrichten pro Minute, 120 pro Stunde, und ein Mindestbestand, der
-- das Mitreden Geld kostet. Wer damit spammen will, zahlt dafür.
--
-- ----------------------------------------------------------------------------
-- Zu 2: Warum eine Kennung und nicht nur ein Text
--
-- Die Seite soll bei diesen Absagen keine rote Fehlermeldung mehr zeigen,
-- sondern einen ruhigen Hinweis neben der Eingabe: Es sind Regeln, keine
-- Defekte. Dafür muss sie sie von echten Fehlern unterscheiden können.
--
-- Zwei Kennungen statt einer, weil die Seite mit ihnen Verschiedenes tut: Bei
-- no_links schreibt sie einen eigenen kurzen Satz, bei rate_limit zeigt sie
-- die Meldung der Datenbank – die weiss als Einzige, ob es die Minuten- oder
-- die Stundengrenze war.
--
-- Warum eine LISTE erlaubter Kennungen und nicht "alles mit hint ist eine
-- Regel": Postgres haengt an manche eigenen Fehler selbst einen hint ("Perhaps
-- you meant to reference the column ..."). Damit wuerde ein echter Fehler
-- stillschweigend zum ruhigen Hinweis – genau die Sorte Nachlaessigkeit, die
-- man erst bemerkt, wenn etwas kaputt ist und niemand es gesehen hat.
--
-- Der naheliegende Weg wäre, im Browser auf den Meldungstext zu prüfen. Das
-- bricht beim ersten Umformulieren, und zwar lautlos: Aus dem ruhigen Hinweis
-- würde wieder die rote Meldung, ohne dass irgendwo etwas rot wird. Deshalb
-- reist die Kennung in "hint" mit – ein Feld, das PostgREST unverändert
-- weitergibt und das nichts mit dem Wortlaut zu tun hat.
--
-- Der Fehlercode bleibt bewusst P0001 (raise_exception). Ein eigener SQLSTATE
-- wäre sauberer benannt, aber PostgREST leitet Codes, die es nicht kennt, als
-- 500 weiter – aus einer Regelverletzung würde ein Serverfehler.
-- ============================================================================

create or replace function app.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender     text;
  cfg        public.app_config%rowtype;
  bal        numeric;
  per_minute int;
  per_hour   int;
begin
  if app.is_admin() then
    return new;
  end if;

  -- Nicht new.wallet: Trigger auf derselben Tabelle feuern in alphabetischer
  -- Reihenfolge, und die Absenderkorrektur läuft nach dieser Prüfung.
  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Mindestbestand ------------------------------------------------------
  if coalesce(cfg.min_chat_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_chat_usd then
      raise exception 'You need at least $% in $% to write here',
        app.betrag_text(cfg.min_chat_usd),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- Keine Links ---------------------------------------------------------
  -- Der Text bleibt für alle, die direkt an der API hängen. Die Seite selbst
  -- liest die Kennung.
  if app.contains_link(new.body) then
    raise exception 'Links are not allowed in chat - send it as a DM instead'
      using hint = 'no_links';
  end if;

  -- ---- Takt ----------------------------------------------------------------
  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.messages
  where wallet = sender
    and created_at > now() - interval '1 hour';

  -- Auch das ist eine Hausregel, kein Defekt: Der Text der Datenbank wandert
  -- unveraendert in den Hinweiskasten, weil nur sie weiss, welche der beiden
  -- Grenzen erreicht wurde.
  if per_minute >= 6 then
    raise exception 'Slow down - you can send 6 messages per minute'
      using hint = 'rate_limit';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later'
      using hint = 'rate_limit';
  end if;

  -- Die Sperre gegen zweimal dieselbe Nachricht stand hier. Siehe oben.

  return new;
end;
$$;

comment on function app.rate_limit_messages() is
  'Chatregeln vor dem Einfügen: Mindestbestand, keine Links (hint=no_links), '
  'Takt (hint=rate_limit). Doppelte Nachrichten sind erlaubt.';
