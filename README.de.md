# SIZED

*Die englische Fassung liegt in [README.md](README.md) und ist die, die GitHub
zeigt. Diese hier ist ausführlicher, was Einrichtung und Betrieb angeht.*

Token-gated Abstimmungen und DMs. **Die Wallet wird nie verbunden** – man
weist ihren Besitz nach, indem man einen eindeutigen Betrag an eine
Verifikationsadresse überweist.

Die Oberfläche ist auf Englisch, Code-Kommentare und dieses README auf
Deutsch.

- **Abstimmungen** – nur Ansem legt sie an. Pro Antwort werden zwei Zahlen
  angezeigt: wie viele Stimmen dafür sind und wie viel $ in $ANSEM diese
  Stimmen zusammen halten. Der $-Wert folgt dem Bestand: Wer nach dem
  Abstimmen verkauft, verliert Gewicht; wer die Wallet leert, verliert die
  Stimme
- **DMs** – jeder schreibt Ansem; sein Posteingang ist nach Token-Bestand
  sortiert, die größten Halter oben
- **Anzeigename** – die ersten drei Zeichen der Adresse, daneben der $-Wert
  der Wallet, z. B. `EsZ $1.3K`. Ansem hat statt der Zeichen sein Profilbild

---

## Architektur

```
Browser ──► Edge Function "verify"   ──► Solana RPC  (Zahlung an Treasury)
        │        └── stellt ein JWT mit Claim "wallet" aus
        │
        ├──► PostgREST  (Polls, DMs)         ──► Postgres mit Row Level Security
        ├──► Realtime   (Live-Updates)
        └──► Edge Function "refresh-holdings" ──► Solana RPC + Preis-API
                 └── schreibt Bestand nach `wallets`
                         └── Trigger zieht offene Stimmen nach

Helius ──► Edge Function "holdings-webhook"  (Transfer gesehen -> neu einlesen)
pg_cron ─► Edge Function "refresh-holdings"  (Netz darunter)
```

Der Browser redet nach dem Login direkt mit der Datenbank. **Alle Rechte hängen
deshalb an RLS**, nicht am Frontend. Zwei Dinge folgen daraus, und sie sind der
Kern des Entwurfs:

1. Der Token-Bestand einer Wallet steht in der Tabelle `wallets`, die
   ausschließlich die Edge Function (Service-Role) schreibt. Stimmgewichte und
   die DM-Sortierung übernehmen ihre Werte per Trigger von dort – ein Client
   kann sie nicht mitschicken.
2. Wer Ansem ist, steht in `app_config.admin_wallet` und wird pro Anfrage
   gegen den JWT-Claim geprüft. Es gibt kein Admin-Flag, das der Client setzen
   könnte.

---

## Einrichtung

### 1. Projekt anlegen

```bash
npm install
npx supabase login
npx supabase link --project-ref DEIN_PROJECT_REF
```

### 2. Schema einspielen

```bash
npx supabase db push
```

Oder den Inhalt von `supabase/migrations/20260823020000_init.sql` in den
SQL-Editor des Dashboards kopieren.

### 3. Konfiguration setzen

Im SQL-Editor, mit deinen echten Werten:

```sql
update public.app_config set
  admin_wallet  = 'Ansems_Wallet_Adresse',
  treasury      = 'Adresse_die_die_Verifikationszahlungen_empfaengt',
  ansem_mint    = 'Mint_Adresse_von_ANSEM',
  symbol        = 'ANSEM',
  base_lamports = 2000000        -- 0.002 SOL Grundbetrag
where id = 1;
```

Die Treasury-Adresse sammelt echtes SOL ein. „Leer" heißt nur, dass sie sonst
nichts tut – du musst den Seed trotzdem besitzen, sonst sind die Zahlungen weg.

### 4. Edge Functions deployen

```bash
npx supabase functions deploy verify
npx supabase functions deploy refresh-holdings
npx supabase functions deploy holdings-webhook

npx supabase secrets set \
  SOLANA_RPC_URL="https://deine-rpc-url" \
  APP_JWT_SECRET="<Project Settings → JWT Keys → Legacy JWT Secret>" \
  CRON_SECRET="$(openssl rand -hex 24)" \
  WEBHOOK_SECRET="$(openssl rand -hex 24)"
```

Alle drei Functions laufen ohne Supabase-JWT – `verify` weil dort die Session
erst entsteht, die anderen beiden weil sie ihr eigenes Secret prüfen. Das steht
in `supabase/config.toml`; im Dashboard entspricht das
Edge Functions → Function → „Verify JWT" aus.

### 5. Realtime einschalten

Im Dashboard unter Database → Replication die Tabellen `polls`,
`poll_options`, `votes` und `dms` zur Publication `supabase_realtime`
hinzufügen. Die Migration versucht das bereits selbst, still scheitern darf sie
je nach Projektzustand.

`messages` steht dort ebenfalls drin und kann drinbleiben – die Seite hört den
Kanal seit dem Entfernen des Chats nicht mehr ab, es wird also auch nichts
abgerechnet.

### 6. Bestände aktuell halten

Hieran hängt die Korrektheit der Abstimmungen, nicht nur die Anzeige. Drei
Cron-Jobs im Dashboard (Database → Cron) – der erste ist der wichtige, er
betrifft nur Wallets mit einer Stimme in einer offenen Abstimmung:

Ein Betrag besteht aus **Menge x Kurs**, und die beiden verhalten sich völlig
verschieden. Die Menge ändert sich nur, wenn jemand Token bewegt – das meldet
der Webhook in Sekunden. Der Kurs ändert sich dauernd, ist aber für alle
Wallets derselbe. Deshalb drei Jobs statt zwei:

```sql
-- 1. Kurs-Takt: EIN Kursabruf, eine Anweisung, alle Wallets gleichzeitig.
--    Das ist der Job, der die Beträge auf der Seite aktuell hält. Er liest keine
--    einzige Wallet von der Chain – jede Minute jede Wallet einzeln
--    nachzulesen wären bei 1000 Wallets 1,4 Mio. RPC-Aufrufe am Tag für eine
--    Zahl, die sich fast nie ändert.
select cron.schedule('price-tick', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"prices":true}'::jsonb
  );
$$);

-- 2. Wer abgestimmt hat, wird jede Minute mit der Menge nachgelesen
select cron.schedule('refresh-voters', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"all":true,"votersOnly":true,"stale":60,"limit":120}'::jsonb
  );
$$);

-- 3. Mengen aller übrigen Wallets, gemächlich. Netz unter dem Webhook.
select cron.schedule('refresh-holdings', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"all":true,"stale":300,"limit":120}'::jsonb
  );
$$);
```

Job 3 nimmt pro Lauf die 120 ältesten Einträge. Bis etwa 120 aktive Wallets ist
damit ohnehin jede Minute jede Menge frisch; darüber hinaus rotiert es, und die
schnelle Meldung übernimmt der Webhook. Wächst das deutlich, `limit` erhöhen
(die Datenbank deckelt bei 500).

Läuft ein alter Stand: `select cron.unschedule('refresh-holdings');` und neu
anlegen – `cron.schedule` überschreibt einen gleichnamigen Job nicht.

### 6b. Helius-Webhook (macht Abflüsse sofort sichtbar)

Der Cron-Job lässt ein Zeitfenster offen. Ein Webhook schließt es weitgehend:

| Feld | Wert |
|---|---|
| Webhook Type | Enhanced |
| Transaction Types | TRANSFER, SWAP (oder Any) |
| Account Address | die Mint-Adresse von $ANSEM |
| Webhook URL | `https://DEIN-PROJEKT.supabase.co/functions/v1/holdings-webhook` |
| Auth Header | derselbe Wert wie `WEBHOOK_SECRET` |

Der Webhook ersetzt den Cron-Job nicht – er ist die schnelle Quelle, der Cron
das Netz für Ausfälle und für Kursänderungen ohne Transfer.

**Er legt keine neuen Wallets an.** Helius meldet jede Bewegung des Mints, also
auch die von Tausenden Adressen, die die Seite nie besuchen. Wuerde der Webhook
sie alle eintragen, waere `wallets` ein Verzeichnis des Tokens statt eines der
Mitglieder – und der Kurs-Takt schriebe jede Minute Zehntausende Zeilen neu, die
niemanden interessieren. Genau das ist einmal passiert: 27.477 Zeilen, davon
zwei mit einem Menschen dahinter. Neue Adressen kommen ueber `verify` herein,
also beim Bezahlen, und ab dann meldet der Webhook ihre Bewegungen.

### 7. Frontend

In `public/config.js` die Projekt-URL und den anon-Key eintragen, dann `public/`
irgendwo statisch hosten – Vercel, Netlify, Cloudflare Pages, Supabase Storage.
Kein Build-Schritt nötig; supabase-js liegt gebündelt in `public/vendor/`
(neu bauen mit `npm run vendor`).

---

## Lokal testen

Ohne Supabase-Projekt, gegen echtes Postgres und echtes PostgREST – also mit
echter RLS, aber simulierter Chain:

```bash
# Postgres-Rollen einmalig anlegen
psql -c "create role anon nologin noinherit;
         create role authenticated nologin noinherit;
         create role authenticator login password 'test' noinherit;
         grant anon, authenticated to authenticator;"

createdb ansem_dev
psql -d ansem_dev -f supabase/migrations/20260823020000_init.sql
psql -d ansem_dev -c "update app_config set admin_wallet='<deine Testadresse>',
                      treasury='Trea5ury1111111111111111111111111111111111',
                      ansem_mint='An5emMint111111111111111111111111111111111' where id=1;"

# PostgREST-Binary nach /tmp/postgrest legen, dann:
PGURL=postgres://postgres@localhost/ansem_dev npm run dev
```

Der Token-Bestand wird lokal deterministisch aus der Adresse abgeleitet, und ein
Knopf „Simulate payment" ersetzt die echte Überweisung. Realtime gibt es lokal
nicht; die Oberfläche lädt stattdessen nach jeder Aktion neu.

### Demomodus

`?demo=40` füllt den Posteingang mit erfundenen Gesprächen – nur auf
`localhost`, auf der echten Seite bewirkt der Parameter nichts. In diesem Modus
wird nichts geladen und nichts geschrieben, damit beim Ausprobieren keine
Testdaten in einer Produktionsdatenbank landen.

Die Bildschirmfotos und Mitschnitte, die für SIZED veröffentlicht werden,
entstehen in diesem Modus. Was dort an Beträgen und Nachrichten steht, ist
erfunden.

### Tests

```bash
npm run test:functions   # Adressen, Base58, JWT, Zahlungszuordnung
npm run test:schema      # RLS, Trigger und Stimmgewichte gegen echtes Postgres
```

Daneben liegen in `scripts/` zweiundzwanzig weitere `test-*.mjs`, die mit
Playwright gegen die echte `index.html` und das echte Blatt messen – Reiter,
Fokus, Seitenhöhe, Tastaturverhalten, Trefferflächen, Abstimmungsbilder,
Realtime-Kanäle. Sie laufen einzeln mit `node scripts/test-….mjs`.

Die meisten tragen eine Gegenprobe: Die Prüfung macht den Zustand, den sie
bewacht, absichtlich kaputt und verlangt, dass sie dann durchfällt. Eine
Prüfung, die „ok" meldet und dabei nichts misst, ist schlechter als keine – und
davon sind hier genug entstanden, um sich die Gewohnheit anzueignen.

Der Schema-Test ist der wichtigere: Er greift die Datenbank so an, wie es ein
Nutzer mit gültigem Token und einem HTTP-Client könnte – fremder Absender,
selbst gesetztes Stimmgewicht, Abstimmung ohne Adminrechte, fremde DMs lesen,
und der Versuch, dasselbe Guthaben über zwei Wallets doppelt abstimmen zu
lassen.

---

## Der Chat ist raus – die Tabelle steht noch

Die Seite hatte einen dritten Tab: einen offenen Chat für alle Verifizierten,
filterbar nach Mindestbestand. Er ist aus der Oberfläche entfernt worden, weil
DMs und Abstimmungen die eigentliche Sache sind und der Chat sie überlagert
hat.

**In der Datenbank wurde nichts gelöscht.** Die Tabelle `messages` steht
unverändert da, samt RLS-Regeln, Linksperre, Wiederholungssperre und
Taktgrenze; die geschriebenen Nachrichten liegen weiter drin. `test-schema.mjs`
prüft sie auch weiter. Damit ist der Schritt umkehrbar: Was fehlt, ist die
Oberfläche, nicht das Fundament.

Ebenfalls stehengeblieben: die Spalte `app_config.min_chat_usd`. Sie wird von
der Seite nicht mehr gelesen.

Mitgegangen sind: der Betragsfilter über dem Verlauf samt seiner
Voreinstellungs-Knöpfe, der ruhige Hinweiskasten über der Eingabe ("No links
allowed here"), Ansems getönte Chatzeile und sein Profilbild an dieser Stelle –
in der Kopfzeile steht es weiter.

---

## Was du vor dem Livegang wissen solltest

**Die Zahlung beweist Kontrolle über die Wallet, mehr nicht.** Wer den Private
Key hat, kommt rein – bei einer geleakten Wallet also auch jemand anderes.

**Warum der krumme Betrag wichtig ist.** Bei einem festen Preis könnte jemand
eine fremde Adresse eintragen, warten, bis diese Person zufällig bezahlt, und
deren Zahlung als eigenen Nachweis einlösen. Der Zufallsaufschlag von bis zu
0,000999 SOL ist dem Angreifer unbekannt, offene Beträge sind per Unique-Index
eindeutig, und jede Transaktionssignatur wird nur einmal akzeptiert.

**Adressen haben keine Prüfsumme.** Ein Vertipper ist strukturell oft noch eine
gültige Adresse. Die Zahlung geht dann von einer Wallet los, die niemand
einlösen kann – rückholbar ist da nichts. Die Oberfläche weist darauf hin.

**Stimmgewichte sind nur so aktuell wie der letzte Abgleich.** Solana schickt
von sich aus nichts. Zwischen dem Moment, in dem jemand seine Token wegschickt,
und dem Moment, in dem seine Stimme verschwindet, liegt die Latenz von Webhook
bzw. Cron – mit dem Helius-Webhook typischerweise Sekunden, ohne ihn bis zu eine
Minute. Für ein knappes Ergebnis kurz vor Schluss: Abstimmung beenden, danach
ein letztes Mal alle Stimmenden nachlesen lassen.

**Beendete Abstimmungen frieren ein.** Sobald `closed = true` gesetzt ist,
ändert kein Bestandsabgleich mehr etwas am Ergebnis. Das ist Absicht.

**Rate-Limits.** RLS begrenzt, *was* jemand tut, nicht *wie oft*. Gegen Spam
steht deshalb ein Trigger daneben, der Nachrichten pro Wallet und Minute zählt.

**Der öffentliche Solana-RPC reicht nicht.** Für Livebetrieb einen eigenen
Endpoint (Helius, QuickNode, Triton) eintragen, sonst laufen Login und
Bestandsabruf ins Rate-Limit. Der Login fragt mit 3/10/30 Sekunden Abstand nach, das summiert
sich schnell.

**Preisquelle.** Jupiter zuerst, DexScreener als Rückfall. Bei einem sehr
illiquiden Token schwankt der $-Wert stark – und damit die Gewichtung.

---

## Dateien

```
public/                     Frontend, kein Build-Schritt
  index.html                Login + zwei Tabs (Oberfläche auf Englisch)
  app.js                    supabase-js, Queries, Realtime
  styles.css
  config.js                 Projekt-URL und anon-Key
  vendor/supabase.js        gebündeltes supabase-js

supabase/
  migrations/…_init.sql                Tabellen, Views, Trigger, RLS, Grants
  functions/verify/                    Betrag ausgeben, Zahlung prüfen, JWT
  functions/refresh-holdings/          Bestand + Kurs nach `wallets` schreiben
  functions/holdings-webhook/          Helius meldet Transfers
  functions/_shared/                   base58, JWT, Solana-RPC, Preise

scripts/
  dev-stack.mjs             lokaler Stack ohne Supabase-Projekt
  test-schema.mjs           RLS- und Trigger-Tests
  test-functions.mjs        Logik-Tests der Edge Functions
```
