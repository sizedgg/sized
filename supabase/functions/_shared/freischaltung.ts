/**
 * Das Tor vor der Freischaltung.
 *
 * Eine eigene Datei ohne Importe, und das mit Absicht: common.ts zieht den
 * Supabase-Client aus jsr: nach und laesst sich deshalb aus Node heraus gar
 * nicht laden. Eine Regel, die nur im Betrieb existiert, kann kein Test
 * anfassen – und diese hier ist die eine, die zwischen "niemand kommt herein"
 * und "alle kommen herein" steht.
 */

export interface TorConfig {
  admin_wallet: string | null;
  test_wallet?: string | null;
  /**
   * Fehlt die Spalte, steht hier undefined – und das ist ein eigener Fall,
   * siehe mayEnter(). Deshalb optional und nicht einfach boolean.
   */
  open_to_public?: boolean | null;
}

/**
 * Darf diese Wallet ueberhaupt herein?
 *
 * Vor der Freischaltung nur Ansems eigene – der Rest bekommt eine Absage,
 * BEVOR ein Betrag genannt wird. Das ist hier keine Feinheit, sondern der
 * ganze Punkt: Die Anmeldung besteht aus einer Ueberweisung. Wer erst zahlt
 * und dann abgewiesen wird, hat Geld fuer nichts geschickt. Die Absage muss
 * also am Anfang stehen, nicht am Ende.
 *
 * Als eigene Funktion und nicht als zwei Zeilen an zwei Stellen: Sie wird an
 * beiden Toren gebraucht (neue Anmeldung und Verlaengerung einer alten
 * Sitzung), und eine Regel, die an einem der beiden fehlt, faellt niemandem
 * auf – sie sieht ja aus wie geschlossen.
 *
 * Zwei Adressen kommen durch, nicht eine: admin_wallet und test_wallet. Der
 * Grund ist keine Bequemlichkeit, sondern dass sich die Seite von den beiden
 * Seiten VERSCHIEDEN verhaelt – Ansem sieht einen Posteingang, ein Nutzer
 * eine Schwelle. Nur mit Ansems Wallet zu pruefen hiesse, die Haelfte nie zu
 * sehen, die alle anderen sehen.
 *
 * Genau EINE Testadresse, kein Feld mit mehreren. Eine Liste waere die
 * Stelle, an der am Ende jemand steht, den man vergessen hat auszutragen; ein
 * einzelnes Feld sieht man beim Draufschauen.
 */
export function mayEnter(cfg: TorConfig, wallet: string | null): boolean {
  // Zu ist die Seite nur, wenn es AUSDRUECKLICH dort steht. Fehlt die Spalte,
  // ist offen.
  //
  // Hier stand die andere Richtung, mit dem Argument: Im Zweifel lieber
  // niemanden hereinlassen. Das war richtig, solange die Seite vor dem Start
  // dichtgehalten werden sollte – ein Deployment ohne die Migration hat dann
  // eben zugesperrt statt aufgemacht.
  //
  // Nach dem Start dreht sich der schlimmere Fall um. Dann ist die Function
  // seit Monaten im Einsatz, jemand rollt sie aus einem ganz anderen Grund neu
  // aus, die Spalte fehlt in dieser Datenbank – und die Seite ist zu, ohne
  // dass jemand das wollte oder gleich merkt.
  //
  // Ein Fallstrick, der auf ein VERGESSEN reagiert, ist schlechter als einer,
  // der auf eine ENTSCHEIDUNG reagiert. Zusperren ist jetzt eine Handlung:
  //   update public.app_config set open_to_public = false where id = 1;
  if (cfg.open_to_public !== false) return true;

  if (cfg.admin_wallet && wallet === cfg.admin_wallet) return true;
  return Boolean(cfg.test_wallet) && wallet === cfg.test_wallet;
}
