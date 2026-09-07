-- ============================================================================
-- Die Werte, mit denen SIZED live geht — Vorlage
-- ============================================================================
--
-- Diese Datei ist die Anleitung. Die Fassung mit den echten Adressen heisst
-- start-konfiguration.sql, liegt daneben und steht in .gitignore — genau wie
-- public/config.js, und aus demselben Grund: Eine Adresse in diesem
-- Verzeichnis ist eine oeffentliche Aussage darueber, wer hinter dem Projekt
-- steht. Was dort steht, entscheidet der Betreiber, nicht diese Vorlage.
--
-- Zum Benutzen: kopieren, die vier Platzhalter ersetzen, im SQL-Editor des
-- Supabase-Dashboards einspielen, einmal, kurz vor dem Aufmachen. Danach die
-- Kontrollabfrage unten laufen lassen und wirklich hinsehen — nicht nur
-- "keine Fehlermeldung" registrieren.
--
-- ----------------------------------------------------------------------------
-- Warum alles in EINER Anweisung steht
--
-- Ein Update, das mittendrin abbricht, hinterlaesst sonst eine halbe
-- Konfiguration: neue Treasury, alte Adminwallet. Die Seite laeuft dann
-- weiter und nimmt Zahlungen an, waehrend der Admin noch der von gestern ist.
--
-- ----------------------------------------------------------------------------
-- Die Adressen
--
-- Beide gehoeren vor dem Eintragen geprueft, und zwar rechnerisch und nicht
-- mit dem Auge:
--
--   44 Zeichen, ausschliesslich aus dem Base58-Alphabet, und beim Dekodieren
--   kommen genau 32 Bytes heraus. Das ist es, was ein Solana-Konto ist.
--
-- Was diese Pruefung nicht leisten kann, und das gehoert dazu: Sie sagt
-- nichts darueber, wem eine Adresse gehoert. Eine Adresse, zu der niemand den
-- Schluessel hat, sieht rechnerisch genauso aus — nur kommt Geld dort nie
-- wieder heraus.
--
-- Deshalb fuer die Treasury einmal, bevor Fremde dorthin zahlen: 0.001 SOL
-- hinschicken, in der Wallet oeffnen, zu der der Seed gehoert, und
-- zurueckschicken. Zahlungen an eine Adresse ohne Schluessel sind der einzige
-- Fehler in diesem Projekt, der sich nicht rueckgaengig machen laesst.
-- ============================================================================

update public.app_config set
  -- Wohin die Verifikationszahlungen gehen. Diese Adresse steht waehrend der
  -- Anmeldung auf dem Bildschirm; sie ist oeffentlich und soll es sein.
  treasury      = 'DEINE_TREASURY_ADRESSE',

  -- Wer der Admin ist. Daran haengt alles, was nur er darf: Abstimmungen
  -- anlegen und schliessen, den Posteingang sehen, Gespraeche verbergen, die
  -- DM-Schwelle setzen.
  --
  -- Geprueft wird das bei JEDER Anfrage, in der Datenbank, gegen den
  -- wallet-Claim des Tokens (app.is_admin()). Es gibt kein Admin-Kennzeichen,
  -- das ein Client setzen koennte — hier steht die einzige Stelle, an der
  -- entschieden wird, wer Admin ist.
  admin_wallet  = 'ADMIN_ADRESSE',

  -- Kein zweiter Zugang mehr. Waehrend der geschlossenen Phase durfte hier
  -- eine Testwallet stehen; ab dem Start waere sie ein zweiter Schluessel zu
  -- einer Tuer, die nur einen haben soll.
  test_wallet   = null,

  -- Die Schwelle in Dollar, ab der jemand dem Admin schreiben darf.
  min_dm_usd    = 1000,

  -- Die Tuer auf.
  open_to_public = true,

  updated_at    = now()
where id = 1;


-- ----------------------------------------------------------------------------
-- Kontrolle
-- ----------------------------------------------------------------------------
-- Hinsehen, nicht ueberfliegen. Vor allem die letzten vier Spalten: Sie
-- vergleichen das Eingetragene mit dem, was dort stehen soll, und antworten
-- mit ja oder nein statt mit einer Adresse, die man beim Lesen fuer richtig
-- haelt, weil sie so aussieht wie die richtige.
--
-- Jede Adressspalte prueft ZWEI Dinge, und das zweite ist der Grund, warum
-- diese Abfrage ueberhaupt etwas wert ist:
--
--   1. Steht das drin, was oben eingetragen wurde? Faengt den Tippfehler und
--      das halb durchgelaufene Update.
--   2. Sieht das ueberhaupt aus wie eine Solana-Adresse? 32 bis 44 Zeichen
--      aus dem Base58-Alphabet — das schliesst 0, O, I und l aus.
--
-- Ohne Punkt 2 haette die unveraenderte Vorlage hier "true" gemeldet: Der
-- Platzhalter oben und der Platzhalter unten sind ja gleich. Eine Kontrolle,
-- die gruen wird, weil man nichts getan hat, ist schlimmer als keine.
select
  treasury,
  admin_wallet,
  test_wallet,
  min_dm_usd,
  open_to_public,
  symbol,
  base_lamports,
  coalesce(treasury = 'DEINE_TREASURY_ADRESSE'
    and treasury ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)        as treasury_stimmt,
  coalesce(admin_wallet = 'ADMIN_ADRESSE'
    and admin_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)    as admin_stimmt,
  test_wallet is null                                             as kein_zweitzugang,
  coalesce(ansem_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)   as mint_gesetzt
from public.app_config
where id = 1;


-- ----------------------------------------------------------------------------
-- Wenn etwas schiefging
-- ----------------------------------------------------------------------------
-- Die Tuer wieder zu, ohne sonst etwas anzufassen:
--
--   update public.app_config set open_to_public = false, updated_at = now()
--   where id = 1;
--
-- Wer schon drin ist, bleibt drin — der Riegel gilt fuer neue Anmeldungen
-- (siehe mayEnter in supabase/functions/_shared/freischaltung.ts). Wer alle
-- hinauswerfen will, rotiert stattdessen APP_JWT_SECRET.
