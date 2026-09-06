-- ============================================================================
-- Eine Challenge gehört dem, der sie geöffnet hat – und niemandem sonst
--
-- ----------------------------------------------------------------------------
-- Die Lücke: sich als Ansem anmelden, ohne seine Wallet zu besitzen
--
-- Die Anmeldung läuft in zwei Schritten über die Edge Function verify:
--
--   POST { action: 'challenge', wallet }   -> challengeId + Betrag
--   POST { action: 'status', challengeId } -> irgendwann das JWT
--
-- Beim ersten Schritt wird NICHT geprüft, ob der Anfragende die Wallet
-- besitzt – das ist Absicht und richtig so: Die Zahlung selbst ist der
-- Nachweis, und genau deshalb muss niemand ein Wallet verbinden.
--
-- Der zweite Schritt verlangte aber nur die challengeId. Und die kennt der,
-- der die Challenge geöffnet hat.
--
-- Dazu kam createChallenge: Lag für eine Wallet schon eine offene Challenge
-- vor, wurde SIE zurückgegeben, statt eine neue anzulegen. Gedacht war das
-- gegen doppelte Kosten beim Neuladen. Es hiess aber auch: zwei verschiedene
-- Leute, die dieselbe Adresse eintippen, bekommen DIESELBE challengeId.
--
-- Damit stand der Weg offen:
--
--   1. Angreifer ruft challenge mit ANSEMS Adresse auf. Er bekommt eine
--      challengeId und einen Betrag. Kosten: nichts.
--   2. Ansem meldet sich irgendwann an. createChallenge findet die offene
--      Challenge und gibt ihm dieselbe zurück – mitsamt dem Betrag.
--   3. Ansem zahlt. scanTreasury bucht die Zahlung: Absender stimmt, Betrag
--      stimmt, Status wird 'paid'.
--   4. Der Angreifer fragt mit SEINER challengeId nach dem Status. Wer den
--      Statuswechsel auf 'used' gewinnt, bekommt das JWT.
--
-- Das JWT trägt wallet = Ansems Adresse. app.is_admin() vergleicht diese
-- Adresse mit app_config.admin_wallet – und sagt ja. Posteingang, Abstimmungen
-- anlegen und löschen, die DM-Schwelle stellen: alles.
--
-- Ansem müsste dafür keinen Fehler machen. Er meldet sich ganz normal an. Der
-- Angreifer muss nur vorher eine Challenge auf seine Adresse offen haben, und
-- er kann sie beliebig offen halten – sie kostet ihn nichts.
--
-- ----------------------------------------------------------------------------
-- Was die Lücke NICHT war
--
-- Das Drumherum hält, und das ist der Grund, warum es an genau dieser Stelle
-- hängt und nicht an fünf:
--
--   * app.is_admin() glaubt dem Claim is_admin im Token NICHT. Es vergleicht
--     die Wallet aus dem Token mit app_config.admin_wallet. Ein selbst
--     gebasteltes "is_admin: true" bringt also nichts.
--   * verifyWalletJwt() prüft die Signatur immer mit HS256, egal was im
--     Header des Tokens steht. Der alg-none-Trick greift nicht.
--   * challenges ist für Clients unlesbar (RLS ohne Regel, keine Rechte).
--     Der Angreifer musste die Kennung auch nicht lesen – er hatte sie.
--   * Die Zahlung muss VON der eingetragenen Wallet kommen (.eq('wallet',
--     p.sender)). Fremd bezahlen geht nicht.
--
-- Es fehlte genau eine Sache: dass der Nachweis am Ende dem gehört, der ihn
-- angefordert hat.
--
-- ----------------------------------------------------------------------------
-- Die Sperre
--
-- Beim Anlegen würfelt verify ein Geheimnis, gibt es genau einmal heraus und
-- legt hier nur seinen SHA-256-Abdruck ab. Status abfragen und mock-pay
-- verlangen es. Wer es nicht hat, bekommt keinen Nachweis – auch nicht, wenn
-- er die Kennung kennt.
--
-- Nur der Abdruck, nicht das Geheimnis: Die Tabelle ist zwar für Clients
-- unlesbar, aber ein Datenabzug, ein Backup oder ein Blick ins Dashboard soll
-- niemandem eine fremde Anmeldung in die Hand geben.
--
-- Und createChallenge gibt eine offene Challenge nur noch heraus, wenn der
-- Anfragende ihr Geheimnis mitschickt. Sonst legt es eine neue an – mit einem
-- neuen Betrag. Damit läuft der Angriff von oben ins Leere: Ansems Zahlung
-- trägt SEINEN Betrag, und scanTreasury bucht sie auf SEINE Challenge. Die
-- des Angreifers wird nie bezahlt und läuft ab.
--
-- ----------------------------------------------------------------------------
-- Warum zusätzlich eine Obergrenze offener Challenges je Wallet
--
-- Der eindeutige Index auf offenen Beträgen (uq_challenges_open_amount) macht
-- jeden Betrag exklusiv, und es gibt nur NONCE_MAX = 100.000 davon. Ohne
-- Grenze könnte jemand für eine fremde Adresse tausende Challenges öffnen und
-- die Beträge besetzen; verify würfelt zwanzigmal und gibt dann auf. Das wäre
-- keine Übernahme mehr, aber eine verschlossene Tür für den Richtigen.
--
-- Drei offene je Wallet: genug für Handy, Rechner und einen hängengebliebenen
-- Versuch, und weit weg von 100.000. Abgelaufene zählen nicht mit.
-- ============================================================================

alter table public.challenges
  add column if not exists secret_hash text;

comment on column public.challenges.secret_hash is
  'SHA-256 (Hex) des Geheimnisses, das verify beim Anlegen genau einmal '
  'herausgibt. Status und mock-pay verlangen es. Ohne diese Spalte reichte '
  'die challengeId, und die kennt auch, wer die Challenge fuer eine FREMDE '
  'Wallet geoeffnet hat.';

-- Nachschlagen geht ueber (id, secret_hash); der Primaerschluessel reicht.

-- ----------------------------------------------------------------------------
-- Obergrenze offener Challenges je Wallet
-- ----------------------------------------------------------------------------
create or replace function app.limit_open_challenges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  offen int;
begin
  select count(*) into offen
    from public.challenges
   where wallet = new.wallet
     and status = 'pending'
     and expires_at > now();

  if offen >= 3 then
    raise exception 'Too many open verification requests for this address - wait a few minutes';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_challenges_limit on public.challenges;
create trigger trg_challenges_limit
  before insert on public.challenges
  for each row execute function app.limit_open_challenges();

-- ----------------------------------------------------------------------------
-- Altbestand
-- ----------------------------------------------------------------------------
-- Offene Challenges ohne Abdruck stammen aus der Zeit davor. verify weist sie
-- nach dem Ausrollen ab, und das ist richtig so: Eine von ihnen KOENNTE die
-- eines Angreifers sein, und man sieht es ihr nicht an. Sie hier gleich auf
-- 'expired' zu setzen macht dasselbe sichtbar, statt es als stille Absage in
-- der Function zu lassen – wer gerade mitten in der Anmeldung war, faengt neu
-- an und zahlt nichts doppelt, weil er noch gar nicht gezahlt hat.
--
-- Bereits BEZAHLTE Challenges bleiben unangetastet: Dort ist Geld geflossen,
-- und der Weg zum Token muss offen bleiben.
update public.challenges
   set status = 'expired'
 where status = 'pending'
   and secret_hash is null;

do $$
declare n int;
begin
  select count(*) into n from public.challenges where secret_hash is null and status = 'paid';
  if n > 0 then
    raise notice '% bezahlte Challenge(n) ohne Geheimnis - verify laesst diese noch einmal durch, danach nie wieder.', n;
  else
    raise notice 'Challenges gehoeren ab jetzt ihrem Ersteller. verify und app.js muessen zusammen mit dieser Migration ausgerollt werden.';
  end if;
end $$;
