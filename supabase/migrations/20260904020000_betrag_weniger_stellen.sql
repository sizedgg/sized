-- ============================================================================
-- Der Anmeldebetrag braucht weniger Nachkommastellen
-- ============================================================================
--
-- Der Befund, aus dem Betrieb
--
-- Der Betrag sah bisher so aus:
--
--   0.002 SOL  +  1 bis 99.999 Lamports   ->   0.002043217 SOL
--
-- Das sind NEUN Nachkommastellen. In Phantom auf dem Handy lässt sich das
-- nicht eintippen: Das Eingabefeld nimmt weniger Stellen an, die letzte fällt
-- weg. Wer 0.002043217 senden will, sendet 0.00204321 – und dieser Betrag
-- passt auf keine Challenge. Die Zahlung ist weg, die Anmeldung scheitert,
-- und der Grund ist von aussen nicht zu sehen.
--
-- Bei einer Seite, deren einziger Weg hinein eine Zahlung ist, ist das kein
-- Schönheitsfehler, sondern die Tür.
--
-- ----------------------------------------------------------------------------
-- Warum der Betrag überhaupt so genau war
--
-- Wegen dieses Index hier:
--
--   create unique index uq_challenges_open_amount
--     on public.challenges (lamports) where status = 'pending';
--
-- Begründet war er mit: "Solange eine Challenge offen ist, muss ihr Betrag
-- eindeutig sein – sonst liesse sich eine fremde Zahlung auf die eigene
-- Challenge buchen." Damit brauchte es viele mögliche Beträge, und viele
-- Beträge brauchten viele Stellen.
--
-- Der Satz stimmt aber nicht mehr. Der Abgleich in scanTreasury lautet:
--
--   .eq('status', 'pending')
--   .eq('wallet',   p.sender)      <-- die Absenderadresse aus der Kette
--   .eq('lamports', p.lamports)
--
-- Es wird also GEGEN DIE ABSENDERADRESSE abgeglichen, nicht nur gegen den
-- Betrag. Eine fremde Zahlung kann schon deshalb nicht auf eine fremde
-- Challenge laufen: Sie käme aus einer anderen Wallet. Und die eigene Wallet
-- fremd bezahlen zu lassen, geht nicht – dafür bräuchte man deren Schlüssel.
--
-- Eindeutig sein muss der Betrag also nur INNERHALB einer Wallet. Und dort
-- sind höchstens drei Challenges gleichzeitig offen (app.limit_open_challenges
-- aus 20260903020000). Drei.
--
-- ----------------------------------------------------------------------------
-- Was das ändert
--
-- Statt 100.000 Beträgen mit Lamport-Genauigkeit genügen tausend in Schritten
-- von 1.000 Lamports:
--
--   0.002001 … 0.002999 SOL     ->  SECHS Nachkommastellen
--
-- Sechs Stellen nimmt jede Wallet-App an. Der Preis für den Nutzer bleibt
-- praktisch gleich (rund 0,0025 SOL), und die Zahl ist nebenbei deutlich
-- leichter abzutippen.
--
-- Nebeneffekt, der wichtiger ist als er klingt: Der alte Index war eine
-- Wachstumsgrenze. Bei 900 gleichzeitig offenen Anmeldungen und 100.000
-- Beträgen traf jeder zwanzigste Versuch auf eine Kollision; die Function
-- würfelt bis zu 20 Mal neu und gäbe danach auf. Pro Wallet gezählt gibt es
-- diese Grenze nicht mehr – egal wie viele Leute gleichzeitig hereinwollen.
-- ============================================================================

drop index if exists public.uq_challenges_open_amount;

-- Eindeutig je Wallet, nicht global. Genau das, was der Abgleich braucht.
create unique index if not exists uq_challenges_open_amount_wallet
  on public.challenges (wallet, lamports) where status = 'pending';

comment on index public.uq_challenges_open_amount_wallet is
  'Eine Wallet kann nicht zwei offene Challenges mit demselben Betrag haben. '
  'Global muss der Betrag NICHT eindeutig sein: scanTreasury gleicht zusätzlich '
  'die Absenderadresse ab, und eine fremde Zahlung kommt aus einer fremden '
  'Wallet.';
