/**
 * The gate in front of the launch.
 *
 * A standalone file with no imports, and that's deliberate: common.ts pulls
 * in the Supabase client from jsr: and therefore can't be loaded from Node
 * at all. A rule that only exists in production is a rule no test can touch
 * - and this one is the one standing between "nobody gets in" and
 * "everybody gets in".
 */

export interface TorConfig {
  admin_wallet: string | null;
  test_wallet?: string | null;
  /**
   * If the column is missing, this holds undefined - and that's its own
   * case, see mayEnter(). Hence optional rather than a plain boolean.
   */
  open_to_public?: boolean | null;
}

/**
 * Is this wallet even allowed in?
 *
 * Before launch, only Ansem's own - everyone else gets turned away BEFORE
 * any amount is mentioned. That's not a nicety here, it's the whole point:
 * signing in consists of a transfer. Whoever pays first and gets rejected
 * afterward has sent money for nothing. The rejection has to come at the
 * start, not the end.
 *
 * As its own function rather than two lines in two places: it's needed at
 * both gates (a new sign-in and renewing an old session), and a rule
 * missing from one of the two goes unnoticed by anyone - it still looks
 * closed.
 *
 * Two addresses get through, not one: admin_wallet and test_wallet. The
 * reason isn't convenience, it's that the page behaves DIFFERENTLY for the
 * two sides - Ansem sees an inbox, a regular user sees a threshold.
 * Checking against Ansem's wallet alone would mean never seeing the half
 * that everyone else sees.
 *
 * Exactly ONE test address, not a field with several. A list would be the
 * spot where, eventually, someone stands who was forgotten and never
 * removed; a single field is visible at a glance.
 */
export function mayEnter(cfg: TorConfig, wallet: string | null): boolean {
  // The page is only closed when it EXPLICITLY says so. If the column is
  // missing, it's open.
  //
  // The other direction used to stand here, with the argument: when in
  // doubt, better let nobody in. That was correct as long as the page was
  // meant to stay locked before launch - a deployment without the migration
  // would then simply stay locked instead of opening up.
  //
  // After launch, the worse case flips around. By then the Function has
  // been in use for months, someone redeploys it for a completely different
  // reason, the column is missing in this database - and the page is
  // closed, without anyone wanting that or noticing right away.
  //
  // A trap that triggers on FORGETTING is worse than one that triggers on
  // a DECISION. Closing it is now an action:
  //   update public.app_config set open_to_public = false where id = 1;
  if (cfg.open_to_public !== false) return true;

  if (cfg.admin_wallet && wallet === cfg.admin_wallet) return true;
  return Boolean(cfg.test_wallet) && wallet === cfg.test_wallet;
}
