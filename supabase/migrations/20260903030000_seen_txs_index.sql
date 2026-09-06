-- ----------------------------------------------------------------------------
-- Ein Index für das Sieb im Treasury-Scan
--
-- scanTreasury() holt vor jedem Lauf die zuletzt verbuchten 600 Signaturen und
-- gibt sie als Sieb an recentTreasuryPayments(): Was schon verbucht ist, kostet
-- dann keine Detailabfrage beim RPC mehr.
--
-- Diese Abfrage lautet "order by seen_at desc limit 600". Ohne Index bedeutet
-- das einen vollständigen Durchlauf plus Sortierung über public.seen_txs – jetzt
-- unmerklich, aber die Tabelle wächst um eine Zeile pro Zahlung und wird nie
-- aufgeräumt. Bei einem Start mit vielen Anmeldungen läuft die Abfrage alle 5
-- Sekunden.
--
-- Absteigend, weil die Abfrage absteigend liest: So ist es ein Blick auf die
-- ersten 600 Einträge des Index und nichts weiter.
-- ----------------------------------------------------------------------------

create index if not exists seen_txs_seen_at_idx
  on public.seen_txs (seen_at desc);
