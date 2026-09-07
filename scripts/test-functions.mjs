/**
 * Tests the pure logic of the Edge Functions without a Deno runtime:
 * addresses, base58, issuing and verifying JWTs, and matching treasury
 * payments to open challenges.
 */
import fs from 'node:fs';
import { isSolanaAddress, decodeBase58, encodeBase58 } from '../supabase/functions/_shared/base58.ts';
import { signWalletJwt, verifyWalletJwt } from '../supabase/functions/_shared/jwt.ts';
import { mayEnter } from '../supabase/functions/_shared/freischaltung.ts';

let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
};

console.log('\n── Adressen ──');
const VALID = [
  'EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCWa',
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
];
check('Gültige Adressen werden akzeptiert', VALID.every(isSolanaAddress));
check('32 Byte nach Dekodierung', VALID.every((a) => decodeBase58(a).length === 32));

const INVALID = [
  '', 'short', 'nicht-base58!', 'IOl0OI0lIOl0OI0lIOl0OI0lIOl0OI0l',
  'EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZ',          // dekodiert zu 30 Byte
  '1EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCWa',      // dekodiert zu 33 Byte
  'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',       // Wert zu groß
  "'; drop table messages; --",
  'EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCWaEsZCz3LJ',
  null, undefined, 42, {},
];
const rejected = INVALID.filter((v) => !isSolanaAddress(v));
check('Alles Ungültige wird abgelehnt', rejected.length === INVALID.length,
  `${rejected.length}/${INVALID.length}`);

// Solana addresses have no checksum: a string shortened by one character can
// still be structurally valid. A typo in the address therefore leads to a
// payment into the void - the interface calls this out.
check('Ohne Prüfsumme bleibt ein Vertipper strukturell gültig',
  isSolanaAddress('EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCW'));

console.log('\n── JWT ──');
const SECRET = 'super-geheimes-supabase-jwt-secret-mindestens-32-zeichen';
const WALLET = 'EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCWa';

const token = await signWalletJwt(SECRET, { wallet: WALLET, isAdmin: false, ttlSeconds: 3600 });
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

check('Token hat drei Segmente', token.split('.').length === 3);
check('role=authenticated (sonst greift RLS nicht)', payload.role === 'authenticated');
check('aud=authenticated', payload.aud === 'authenticated');
check('wallet-Claim gesetzt', payload.wallet === WALLET);
check('sub gesetzt', payload.sub === WALLET);
check('exp liegt in der Zukunft', payload.exp * 1000 > Date.now());

const verified = await verifyWalletJwt(SECRET, token);
check('Eigenes Token wird verifiziert', verified?.wallet === WALLET);

check('Falsches Secret wird abgelehnt', (await verifyWalletJwt('anderes-secret', token)) === null);

const [h, p, s] = token.split('.');
const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, wallet: 'AAAA', is_admin: true }))
  .toString('base64url');
check('Manipulierter Payload wird abgelehnt',
  (await verifyWalletJwt(SECRET, `${h}.${tamperedPayload}.${s}`)) === null);

const expired = await signWalletJwt(SECRET, { wallet: WALLET, isAdmin: false, ttlSeconds: -10 });
check('Abgelaufenes Token wird abgelehnt', (await verifyWalletJwt(SECRET, expired)) === null);

const adminToken = await signWalletJwt(SECRET, { wallet: WALLET, isAdmin: true, ttlSeconds: 60 });
check('Admin-Flag überlebt die Runde', (await verifyWalletJwt(SECRET, adminToken))?.isAdmin === true);

check('Müll-Token wird abgelehnt', (await verifyWalletJwt(SECRET, 'a.b.c')) === null);

console.log('\n── Base58 ──');
check('encode(decode(x)) === x', VALID.every((a) => encodeBase58(decodeBase58(a)) === a));

console.log('\n── Zahlungszuordnung ──');

/** Reconstruction of the matching rule from verify/index.ts for an isolated test. */
function match(payment, challenges, seen) {
  if (seen.has(payment.signature)) return null;
  return challenges.find((c) =>
    c.status === 'pending' &&
    c.wallet === payment.sender &&
    c.lamports === payment.lamports &&
    c.expiresAt > Date.now()) ?? null;
}

const OTHER = 'CYRHXzKhGBdrJ9v5XtAyBRopaKVDh6DUoaqZdntvG19Z';
const future = Date.now() + 600_000;
const challenges = [
  { id: 'a', wallet: WALLET, lamports: 2_042_779, status: 'pending', expiresAt: future },
  { id: 'b', wallet: OTHER,  lamports: 2_012_846, status: 'pending', expiresAt: future },
  { id: 'c', wallet: WALLET, lamports: 2_099_111, status: 'pending', expiresAt: Date.now() - 1000 },
];
const seen = new Set();

check('Exakter Betrag vom richtigen Absender trifft',
  match({ signature: 's1', sender: WALLET, lamports: 2_042_779 }, challenges, seen)?.id === 'a');
check('Ein Lamport daneben trifft nicht',
  match({ signature: 's2', sender: WALLET, lamports: 2_042_778 }, challenges, seen) === null);
check('Richtiger Betrag, fremder Absender trifft nicht',
  match({ signature: 's3', sender: OTHER, lamports: 2_042_779 }, challenges, seen) === null);
check('Abgelaufene Challenge wird nicht bedient',
  match({ signature: 's4', sender: WALLET, lamports: 2_099_111 }, challenges, seen) === null);

seen.add('s5');
check('Bereits verbuchte Signatur wird ignoriert (kein Replay)',
  match({ signature: 's5', sender: WALLET, lamports: 2_042_779 }, challenges, seen) === null);

// The nonce surcharge is what makes a stranger's payment useless: an
// attacker who enters WALLET doesn't know the expected amount.
const BASE = 2_000_000, NONCE_MAX = 100_000;
const amounts = new Set(Array.from({ length: 500 },
  () => BASE + 1 + Math.floor(Math.random() * (NONCE_MAX - 1))));
check('Nonce-Beträge streuen wide genug',
  amounts.size > 480, `${amounts.size} verschiedene aus 500 Ziehungen`);
check('Betrag liegt immer im erwarteten Fenster',
  [...amounts].every((a) => a > BASE && a < BASE + NONCE_MAX));


// ── Gate access ──
//
// As long as open_to_public is false, only Ansem gets in. What's tested is
// the rule itself and not where it's called from, because it's needed at
// TWO gates: at login and when renewing a session. If it were missing at
// one of them, nobody would notice - it still looks closed.
console.log('\n── Freischaltung ──');
const ADMIN = 'EsZCz3LJMMwPuBc6NhjAUFSUGRpY1Xnhj7oZX2TTZCWa';
const FREMD = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TEST = '11111111111111111111111111111111';
const zu = { admin_wallet: ADMIN, test_wallet: TEST, open_to_public: false };
const auf = { admin_wallet: ADMIN, test_wallet: TEST, open_to_public: true };

check('Zu: ein Fremder kommt nicht herein', !mayEnter(zu, FREMD));
check('Zu: Ansem schon', mayEnter(zu, ADMIN));
// The second address isn't for convenience: the user-facing side behaves
// differently from Ansem's, and with only his wallet you'd never see it.
check('Zu: die Testwallet auch', mayEnter(zu, TEST));
check('Auf: jeder kommt herein', mayEnter(auf, FREMD) && mayEnter(auf, ADMIN));

// Both ways out hinge on a value being set. If nothing is set there, that
// must not turn into an open door: null equals null would otherwise be
// exactly that - for EVERYONE who asks without an address.
const empty = { admin_wallet: null, test_wallet: null, open_to_public: false };
check('Ohne gesetzte Adressen gibt es keinen Ausweg',
  !mayEnter(empty, FREMD) && !mayEnter(empty, null));

// And the case that must not count as "closed": the column is missing.
//
// That happens when the function is rolled out and the migration isn't -
// two paths that are walked by hand and can therefore end up out of sync in
// age. This used to say "closed" here, with the argument: when in doubt,
// let nobody in. After launch that's the worse direction: then a deployment
// locks the site for a completely different reason, without anyone wanting
// that. Locking it must be an action, not an accident.
const withoutColumn = { admin_wallet: ADMIN, test_wallet: null };
check('Fehlt die Spalte, ist die Seite offen', mayEnter(withoutColumn, FREMD));
check('Und null zaehlt genauso',
  mayEnter({ ...withoutColumn, open_to_public: null }, FREMD));
// It's only closed on an explicit false.
check('Nur ein ausdrueckliches false sperrt', !mayEnter(zu, FREMD));

// And the lock sits at both gates in verify - above all BEFORE the spot
// that names an amount. Logging in is a bank transfer: whoever pays first
// and gets turned away afterwards has sent money for nothing.
const verifySrc = fs.readFileSync(
  new URL('../supabase/functions/verify/index.ts', import.meta.url), 'utf8');
check('Beide Tore in verify benutzen die Regel',
  (verifySrc.match(/mayEnter\(/g) || []).length >= 2);
check('Und die Absage steht vor dem genannten Betrag',
  verifySrc.indexOf('mayEnter(') < verifySrc.indexOf('cfg.treasury'));

console.log(`\n${failures === 0 ? '✅ Alle Prüfungen bestanden' : `❌ ${failures} Prüfung(en) fehlgeschlagen`}\n`);
process.exit(failures === 0 ? 0 : 1);
