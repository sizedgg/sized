/**
 * Der Ersatz-Supabase fuer die Vorfuehrung auf dem eigenen Rechner.
 *
 * Im gebauten Ordner liegt diese Datei als vendor/supabase.js. public/app.js
 * importiert von dort createClient() und merkt nichts: dieselbe Form, nur
 * ohne Netz. Nichts an public/ wird dafuer angefasst - der Tausch passiert
 * in der KOPIE, die scripts/demo-halter.mjs baut.
 *
 * Warum ueberhaupt so, und nicht ueber den vorhandenen Demo-Schalter
 * (?demo=40): der zeigt Ansems Posteingang und ersetzt nur das Laden von
 * Abstimmungen und Gespraechen. Angemeldet ist man dabei trotzdem echt -
 * app_config, wallets und die Anmeldung selbst laufen weiter gegen die
 * Datenbank. Auf einem Rechner ohne Node und ohne Postgres gibt es die
 * nicht. Also wird die Naht eine Ebene tiefer gelegt: der Client.
 *
 * Was hier NICHT nachgebaut ist, und das ist wichtig zu wissen, bevor
 * jemand aus dieser Vorfuehrung Schluesse zieht:
 *
 *   * Keine Rechte. RLS ist die Sicherheitsgrenze der echten Seite; hier
 *     gibt es sie nicht. Was diese Datei herausgibt, gibt sie heraus.
 *   * Kein Realtime. Kanaele melden "SUBSCRIBED" und schweigen danach.
 *     Ein zweiter Browser sieht die Stimme also nicht.
 *   * Keine Kette, kein Preis, keine Anmeldung. Das Token liegt fertig im
 *     localStorage, siehe demo-halter.mjs.
 *
 * Alles andere - Zeichnen, Zaehlen, Sortieren, Fristen, die Schwelle fuer
 * DMs, das Bild zum Teilen - ist der echte Code aus public/.
 */

/* --------------------------------------------------------------------------
 * Die Lage, die vorgefuehrt wird
 * ----------------------------------------------------------------------- */

// Der Halter, als der man die Seite sieht. Eine echte base58-Adresse mit
// genau 32 Bytes, damit sie ueberall durchgeht, wo die Seite Adressen
// prueft - das Kuerzel oben rechts kommt aus den ersten drei Zeichen.
export const ICH = '37FriauJcTmAWeuVQVEqVHZydvVbPsS1ooSbNpd9nwWa';
const MEIN_USD = 7240;
const MEIN_PREIS = 0.0042;          // wie im lokalen Stapel
const MEINE_TOKEN = Math.round(MEIN_USD / MEIN_PREIS);

const ANSEM = 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52';

const jetzt = Date.now();
const vor = (stunden) => new Date(jetzt - stunden * 3600_000).toISOString();

const KONFIG = {
  id: 1,
  symbol: 'ANSEM',
  admin_wallet: ANSEM,
  treasury: 'ChrLeUkqhY149aRNK6FS5P6539GSwp3r6sRtx3Ye5Qp9',
  ansem_mint: 'ANSEMdemo1111111111111111111111111111111111',
  base_lamports: 1_000_000,
  min_dm_usd: 1000,
  open_to_public: true,
};

// Die Betraege OHNE die eigene Stimme. Was die Seite zeigt, wird daraus
// jedes Mal neu gerechnet: Grundbetrag plus die eigenen 7.240 $ auf der
// Antwort, die gerade angeklickt ist. Deshalb wandert der eigene Anteil
// mit, wenn man seine Stimme aendert, statt sich zu addieren.
const ABSTIMMUNGEN = [
  {
    id: 2,
    question: "What's your favorite $ANSEM beta?",
    created_at: vor(46),
    closes_at: new Date(jetzt + 31 * 3600_000).toISOString(),
    closed: false,
    optionen: [
      { id: 21, label: '$bullshit', idx: 0, usd: 168_400 },
      { id: 22, label: '$mensa', idx: 1, usd: 149_100 },
      { id: 23, label: 'not buying betas', idx: 2, usd: 82_500 },
    ],
  },
  {
    id: 1,
    question: 'Which chain should I cover next?',
    created_at: vor(160),
    closes_at: vor(22),
    closed: true,
    optionen: [
      { id: 11, label: 'Solana', idx: 0, usd: 138_000 },
      { id: 12, label: 'Hyperliquid', idx: 1, usd: 71_500 },
      { id: 13, label: 'Base', idx: 2, usd: 58_200 },
      { id: 14, label: 'Monad', idx: 3, usd: 32_300 },
    ],
  },
];

// Das Gespraech mit Ansem. from_admin sagt, auf welcher Seite die Blase
// steht - dieselbe Spalte wie in der Datenbank.
const NACHRICHTEN = [
  {
    id: 1, wallet: ICH, from_admin: false, reply_to: null,
    body: 'do you actually reply to smaller holders like me?',
    created_at: vor(27), read_by_admin: true,
  },
  {
    // Ohne Zitat: die Antwort steht direkt unter der Frage, ein Zitat
    // wuerde denselben Satz ein zweites Mal zeigen.
    id: 2, wallet: ICH, from_admin: true, reply_to: null,
    body: 'maybe',
    created_at: vor(25), read_by_admin: true,
  },
];

/* --------------------------------------------------------------------------
 * Der Stand, der sich beim Klicken aendert
 * ----------------------------------------------------------------------- */

const stand = {
  meineStimme: new Map(),          // poll_id -> option_id
  dms: NACHRICHTEN.map((n) => ({ ...n })),
};

/** poll_results, wie PostgREST sie liefern wuerde - Grundbetrag + eigene Stimme. */
function ergebnisse() {
  const zeilen = [];
  for (const p of ABSTIMMUNGEN) {
    const meine = stand.meineStimme.get(p.id);
    for (const o of p.optionen) {
      zeilen.push({
        poll_id: p.id,
        option_id: o.id,
        usd: o.usd + (meine === o.id ? MEIN_USD : 0),
        wallets: 0,
      });
    }
  }
  return zeilen;
}

function tabelle(name) {
  switch (name) {
    case 'app_config':
      return [KONFIG];
    case 'wallets':
      return [{
        address: ICH, ui_amount: MEINE_TOKEN, usd_value: MEIN_USD,
        price_usd: MEIN_PREIS, updated_at: new Date().toISOString(),
      }];
    case 'polls':
      return ABSTIMMUNGEN.map((p) => ({
        id: p.id, question: p.question, created_at: p.created_at,
        closes_at: p.closes_at, closed: p.closed,
        poll_options: p.optionen.map((o) => ({ id: o.id, label: o.label, idx: o.idx })),
      }));
    case 'poll_results':
      return ergebnisse();
    case 'votes':
      return [...stand.meineStimme].map(([poll_id, option_id]) => ({
        poll_id, option_id, wallet: ICH,
      }));
    case 'dms':
      return stand.dms;
    case 'dm_threads':      // nur die Verwaltungsansicht, hier leer
    case 'dm_hidden':
      return [];
    default:
      return [];
  }
}

/* --------------------------------------------------------------------------
 * Der Client
 * ----------------------------------------------------------------------- */

class Abfrage {
  constructor(name) {
    this.name = name;
    this.filter = [];
    this.sortierung = null;
    this.grenze = null;
    this.einzeln = null;
    this.schreiben = null;
  }

  select() { return this; }
  eq(spalte, wert) { this.filter.push([spalte, wert]); return this; }
  order(spalte, opt = {}) { this.sortierung = { spalte, auf: opt.ascending !== false }; return this; }
  limit(n) { this.grenze = n; return this; }
  maybeSingle() { this.einzeln = 'vielleicht'; return this; }
  single() { this.einzeln = 'genau'; return this; }

  insert(was) { this.schreiben = { art: 'insert', was }; return this; }
  upsert(was) { this.schreiben = { art: 'upsert', was }; return this; }
  update(was) { this.schreiben = { art: 'update', was }; return this; }
  delete() { this.schreiben = { art: 'delete' }; return this; }

  /* Thenable: app.js schreibt `await ...` und `.then(unwrap)`, beides
     landet hier. */
  then(weiter, daneben) {
    return Promise.resolve().then(() => this.#lauf()).then(weiter, daneben);
  }

  #lauf() {
    if (this.schreiben) return this.#schreibe();

    let zeilen = tabelle(this.name)
      .filter((z) => this.filter.every(([s, w]) => z[s] === w));

    if (this.sortierung) {
      const { spalte, auf } = this.sortierung;
      zeilen = [...zeilen].sort((a, b) => (a[spalte] > b[spalte] ? 1 : a[spalte] < b[spalte] ? -1 : 0) * (auf ? 1 : -1));
    }
    if (this.grenze) zeilen = zeilen.slice(0, this.grenze);

    if (this.einzeln) {
      if (!zeilen.length) {
        return this.einzeln === 'genau'
          ? { data: null, error: { message: 'Kein Datensatz' } }
          : { data: null, error: null };
      }
      return { data: zeilen[0], error: null };
    }
    return { data: zeilen, error: null };
  }

  #schreibe() {
    const nein = (text) => ({ data: null, error: { message: text } });

    if (this.name === 'votes' && (this.schreiben.art === 'upsert' || this.schreiben.art === 'insert')) {
      const z = this.schreiben.was;
      const poll = ABSTIMMUNGEN.find((p) => String(p.id) === String(z.poll_id));
      // Dieselbe Absage wie in der Datenbank: auf eine geschlossene
      // Abstimmung nimmt niemand mehr Einfluss.
      if (!poll) return nein('Diese Abstimmung gibt es nicht.');
      if (poll.closed || new Date(poll.closes_at) < new Date()) {
        return nein('Diese Abstimmung ist geschlossen.');
      }
      stand.meineStimme.set(poll.id, Number(z.option_id));
      return { data: null, error: null };
    }

    if (this.name === 'votes' && this.schreiben.art === 'delete') {
      const poll = this.filter.find(([s]) => s === 'poll_id');
      if (poll) stand.meineStimme.delete(Number(poll[1]));
      return { data: null, error: null };
    }

    if (this.name === 'dms' && this.schreiben.art === 'insert') {
      const z = this.schreiben.was;
      stand.dms.push({
        id: (stand.dms.at(-1)?.id ?? 0) + 1,
        wallet: ICH,
        from_admin: Boolean(z.from_admin),
        reply_to: z.reply_to ?? null,
        body: String(z.body ?? ''),
        created_at: new Date().toISOString(),
        read_by_admin: false,
      });
      return { data: null, error: null };
    }

    if (this.name === 'dms' && this.schreiben.art === 'update') {
      return { data: null, error: null };     // gelesen-Markierung, ohne Wirkung
    }

    // Alles, was nur Ansem kann: dieselbe Antwort, die die echte Seite
    // einem Halter gaebe. Nicht stillschweigend durchwinken - sonst sieht
    // die Vorfuehrung Rechte vor, die es nicht gibt.
    return nein('Nur der Betreiber darf das.');
  }
}

class Kanal {
  constructor(name) { this.name = name; }
  on() { return this; }
  subscribe(rueck) { setTimeout(() => rueck?.('SUBSCRIBED'), 0); return this; }
  unsubscribe() { return Promise.resolve('ok'); }
}

class DemoClient {
  from(name) { return new Abfrage(name); }
  channel(name) { return new Kanal(name); }
  removeChannel() { return Promise.resolve('ok'); }
  async rpc() { return { data: null, error: { message: 'Nur der Betreiber darf das.' } }; }

  storage = {
    from: () => ({
      list: async () => ({ data: [], error: null }),
      upload: async () => ({ data: null, error: { message: 'Nur der Betreiber darf das.' } }),
      remove: async () => ({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
    }),
  };
}

export function createClient() { return new DemoClient(); }
