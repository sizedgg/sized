# SIZED

Token-gated polls and DMs for $ANSEM holders.

Ansem posts a poll; anyone holding $ANSEM can vote, and each vote weighs what
that wallet holds. Holders above a threshold he sets can also message him
directly, and his inbox is ordered by holdings.

Logging in does not connect a wallet. You prove you control an address by
sending one specific amount of SOL to a published address — no connect button,
no signature request, no approval popup.

The interface is English. Code comments and `README.de.md` are German.

---

## What it does

- **Polls** — only the admin creates them. Each option shows two numbers: how
  many wallets voted for it, and how much those wallets hold in $ANSEM. The
  dollar figure follows the balance: sell after voting and your weight drops;
  empty the wallet and your vote is gone.
- **DMs** — anyone above the threshold can write to the admin. His inbox is
  sorted by holdings, largest first.
- **Display name** — the first three characters of your address plus the dollar
  value of the wallet, e.g. `EsZ $1.3K`. Nothing else about you is stored.

---

## Security

**The app never asks for a signature.** Funds cannot leave a wallet without
one. `public/app.js` contains no `connect`, no `signTransaction` and no
`signMessage`.

The bundled Supabase client in `public/vendor/supabase.js` ships
`signInWithWeb3`, an unused wallet sign-in path that references
`window.solana.signMessage`. It is library code, and nothing in this app calls
it — the only auth path is `verify`, which issues a JWT after seeing a payment
on chain.

**No token, no presale, no airdrop, no allowlist.** SIZED sells nothing.
$ANSEM is an existing token this app reads balances of; SIZED has no token of
its own.

**One payment, once.** Logging in costs a small verification amount — a
fraction of a dollar in SOL — sent by you, from your own wallet app, to an
address shown on screen. The app cannot initiate it, cannot repeat it and
cannot take more. The amount and the destination are both on screen before you
send. The payment is not refundable, and the interface says so before you pay.

**The receiving address is public.** It is in `app_config.treasury` and shown
during login. It receives dust and nothing else.

**Balances are read from the chain, never sent by the browser.** Voting weight
comes from a table that only a server-side function can write.

**The frontend is not a security boundary.** Modify it, run your own copy
against the same database, or send raw HTTP — you get exactly the same rights.
Every permission lives in Row Level Security.

---

## How login works

1. You type your Solana address. Nothing is connected.
2. The server hands back an amount: a fixed base plus a random surcharge of up
   to 0.000999 SOL, unique among all open challenges.
3. You send exactly that amount to the treasury address, from your own wallet
   app.
4. The server watches the chain for a payment of exactly that amount and issues
   a session token for the sending address.

**Why the odd amount.** With a fixed price, someone could enter a stranger's
address, wait until that person happens to pay, and claim their payment as
proof of ownership. The random surcharge is unknown to an attacker, open
amounts are unique by database constraint, and every transaction signature is
accepted only once.

**What this proves.** Control of the private key at that moment. A leaked key
means someone else can log in — the same as every other wallet-based system.

**Addresses have no checksum.** A typo is often still a structurally valid
address. Money sent to a wallet nobody can redeem is gone; the interface warns
about this before you send.

---

## Architecture

```
Browser ──► Edge Function "verify"   ──► Solana RPC  (payment to treasury)
        │        └── issues a JWT with a "wallet" claim
        │
        ├──► PostgREST  (polls, DMs)          ──► Postgres with Row Level Security
        ├──► Realtime   (live updates)
        └──► Edge Function "refresh-holdings" ──► Solana RPC + price API
                 └── writes balances into `wallets`
                         └── trigger updates open votes

Helius ──► Edge Function "holdings-webhook"  (transfer seen -> re-read)
pg_cron ─► Edge Function "refresh-holdings"  (safety net)
```

After login the browser talks to the database directly, so every permission
lives in RLS rather than in the frontend. Two consequences shape the design:

1. A wallet's token balance lives in `wallets`, written exclusively by the edge
   function under the service role. Vote weights and DM ordering take their
   values from there by trigger — a client cannot supply them.
2. Who the admin is lives in `app_config.admin_wallet` and is checked against
   the JWT claim on every request. There is no admin flag a client could set.

---

## Tests

```bash
npm run test:functions   # addresses, base58, JWT, payment matching
npm run test:schema      # RLS, triggers and vote weights against real Postgres
```

The schema test attacks the database the way a user with a valid token and an
HTTP client could: forged sender, self-set vote weight, creating a poll without
admin rights, reading someone else's DMs, and voting twice with the same
balance across two wallets.

Alongside those, `scripts/` holds 23 more `test-*.mjs` that measure against the
real `index.html` and the real stylesheet with Playwright — tabs, focus, page
height, keyboard behaviour, touch targets, realtime channels, contrast. Run one
with `node scripts/test-<name>.mjs`.

Most carry a counter-proof: the test deliberately breaks the thing it guards
and asserts that it then fails. A check that reports "ok" without measuring
anything passes just as quietly as one that works.

---

## Demo mode

`?demo=40` fills the inbox with made-up conversations. It works on `localhost`
only; on the live site the parameter does nothing. Nothing is read from or
written to the database in demo mode.

Screenshots and videos published for SIZED use this mode. Any post showing a
full inbox is showing invented data.

---

## Setup

See `README.de.md` for the full walkthrough (German). In short:

```bash
npm install
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Then set `admin_wallet`, `treasury`, `ansem_mint`, `symbol` and `base_lamports`
in `app_config`, deploy the edge functions with their secrets, enable Realtime
for `polls`, `poll_options`, `votes` and `dms`, and schedule the cron jobs that
keep balances current. Finally put your project URL and anon key into
`public/config.js` and host `public/` statically — no build step.

`public/config.js` is not in this repository. Copy `public/config.example.js`
to `public/config.js` and put your own project URL and anon key in it.

The anon key is public by design: it ships to every visitor's browser, and
every access it permits goes through RLS. Keeping it out of the repository is
tidiness, not secrecy — `public/_headers` names the project host openly, inside
a strict Content-Security-Policy.

The service role key exists only in the edge function secrets. Every use of it
here reads it from the environment; grep for `SUPABASE_SERVICE_ROLE_KEY` and
you will find three `Deno.env.get` calls and no literals.

---

## Operational notes

**Vote weights are only as fresh as the last sync.** Solana pushes nothing on
its own. Between someone sending their tokens away and their vote disappearing
sits the webhook or cron latency — seconds with the Helius webhook, up to a
minute without it. For a close result: close the poll first, then re-read all
voters one last time.

**Closed polls freeze.** Once `closed = true`, no balance sync changes the
result. That is intended.

**Rate limits.** RLS limits *what* someone does, not *how often*. A trigger
counts messages per wallet per minute against spam.

**The public Solana RPC is not enough.** Use your own endpoint (Helius,
QuickNode, Triton) in production — the login polls with a 3/10/30 second
backoff.

**Price source.** Jupiter first, DexScreener as fallback. For an illiquid token
the dollar value swings, and the weighting swings with it.

---

## Files

```
public/                     frontend, no build step
  index.html                login + two tabs
  app.js                    supabase-js, queries, realtime
  styles.css
  config.js                 project URL and anon key (placeholders here)
  vendor/supabase.js        bundled supabase-js

supabase/
  migrations/…_init.sql               tables, views, triggers, RLS, grants
  functions/verify/                   issue amount, check payment, issue JWT
  functions/refresh-holdings/         write balance + price into `wallets`
  functions/holdings-webhook/         Helius reports transfers
  functions/og/                       link previews for shared polls
  functions/_shared/                  base58, JWT, Solana RPC, prices

scripts/
  dev-stack.mjs             local stack without a Supabase project
  test-*.mjs                see Tests above
```

---

## License

All rights reserved — see [LICENSE](LICENSE).

The code is public so that it can be read and checked, not so that it can be
reused. Reading it, auditing it and reporting problems are the point. For
anything else, ask.
