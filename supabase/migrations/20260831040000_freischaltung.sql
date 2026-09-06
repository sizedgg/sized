-- ============================================================================
-- Die Seite ist online, aber noch zu
--
-- Neue Spalte app_config.open_to_public. Solange sie false ist, laesst die
-- Edge Function verify niemanden mehr herein ausser der Wallet, die in
-- admin_wallet steht.
--
-- ----------------------------------------------------------------------------
-- Warum die Sperre hier sitzt und nicht im Blatt
--
-- Das Blatt liegt auf einem oeffentlichen Webspace. Alles, was es weiss, kann
-- man lesen, und alles, was es verbirgt, kann man wieder einblenden. Eine
-- Seite, die sich selbst fuer geschlossen haelt, ist deshalb keine Sperre.
--
-- Die Anmeldung dagegen laeuft ueber genau ein Tor: verify stellt eine
-- Challenge aus, und ohne Challenge gibt es keinen Betrag, auf den die
-- Treasury horcht. Wer dort abgewiesen wird, kommt nicht herein – egal, was er
-- im Browser anstellt.
--
-- ----------------------------------------------------------------------------
-- Warum das Nein VOR der Zahlung kommen muss
--
-- Die Anmeldung ist eine Ueberweisung. Wuerde erst die Zahlung geprueft und
-- dann die Freischaltung, haette der Abgewiesene Geld fuer nichts geschickt.
-- Die Absage steht deshalb ganz am Anfang von createChallenge – vor der
-- Zeile, die einen Betrag nennt.
--
-- Aus demselben Grund prueft checkStatus NICHT: Wer eine Challenge in der Hand
-- hat, hat einen Betrag genannt bekommen. Wird zwischendurch zugesperrt und er
-- zahlt, bekommt er seine Sitzung. Das ist die richtige Reihenfolge – ein
-- zugesagter Preis gilt, auch wenn der Laden gerade schliesst. Es sind
-- hoechstens 15 Minuten (CHALLENGE_TTL_MIN).
--
-- ----------------------------------------------------------------------------
-- Vorgabe true: Diese Migration aendert von sich aus NICHTS
--
-- Sie legt nur den Schalter an, sie legt ihn nicht um. Die Seite bleibt offen,
-- bis jemand sie ausdruecklich zusperrt:
--
--   update public.app_config set open_to_public = false where id = 1;   -- zu
--   update public.app_config set open_to_public = true  where id = 1;   -- auf
--
-- Beides wirkt sofort, ohne neuen Upload und ohne Deployment.
--
-- Hier stand als Vorgabe false, und die Function las eine fehlende Spalte
-- ebenfalls als "zu" – aus dem Gedanken heraus, im Zweifel lieber niemanden
-- hereinzulassen. Das war richtig, solange die Seite vor dem Start
-- dichtgehalten werden sollte.
--
-- Danach dreht sich der schlimmere Fall um: Dann sperrt ein Ausrollen, das mit
-- alldem gar nichts zu tun hat, die laufende Seite zu – weil jemand vergessen
-- hat, die Migration mitzunehmen. Ein Fallstrick, der auf ein Vergessen
-- reagiert, ist schlechter als einer, der auf eine Entscheidung reagiert.
--
-- ----------------------------------------------------------------------------
-- Zwei Adressen kommen durch, nicht eine
--
-- admin_wallet und die neue Spalte test_wallet. Der Grund ist keine
-- Bequemlichkeit: Die Seite verhaelt sich von den beiden Seiten VERSCHIEDEN.
-- Ansem sieht einen Posteingang und stellt die Schwelle, ein Nutzer sieht die
-- Schwelle von unten. Nur mit Ansems Wallet zu pruefen hiesse, die Haelfte nie
-- zu sehen, die alle anderen sehen.
--
-- Genau eine Testadresse, kein Feld mit mehreren: Eine Liste waere die Stelle,
-- an der am Ende jemand steht, den man vergessen hat auszutragen.
--
-- ----------------------------------------------------------------------------
-- Ein Zusammenhang, der leicht uebersehen wird
--
-- Bis zum Start steht in admin_wallet noch die eigene Wallet. Wird sie auf
-- Ansems echte Adresse umgestellt, SOLANGE die Seite zu ist, sperrt man sich
-- selbst aus – ausser die eigene Adresse steht dann in test_wallet.
-- ============================================================================

alter table public.app_config
  add column if not exists open_to_public boolean not null default true;

alter table public.app_config
  add column if not exists test_wallet text;

comment on column public.app_config.open_to_public is
  'false = die Seite ist zu: verify laesst nur admin_wallet und test_wallet '
  'herein, alle anderen bekommen eine Absage, bevor ein Betrag genannt wird. '
  'true oder fehlend = offen fuer alle. Wirkt sofort, ohne neuen Upload des '
  'Blatts.';

comment on column public.app_config.test_wallet is
  'Eine einzelne Adresse, die vor der Freischaltung ebenfalls hereinkommt – '
  'zum Pruefen der Nutzerseite, die sich anders verhaelt als Ansems. Nach dem '
  'Start ohne Wirkung, weil dann alle hereinkommen. Leeren mit null.';

do $$
begin
  if exists (select 1 from public.app_config where id = 1 and not open_to_public) then
    raise notice 'Die Seite steht auf ZU. Aufmachen: update public.app_config set open_to_public = true where id = 1;';
  else
    raise notice 'Der Schalter ist da, die Seite bleibt offen. Zusperren: update public.app_config set open_to_public = false where id = 1;';
  end if;
end $$;
