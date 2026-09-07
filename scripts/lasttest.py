#!/usr/bin/env python3
# =============================================================================
# Wie viele gleichzeitige Nutzer trägt die Datenbank wirklich?
#
# Bis hierher ist das eine Schätzung: Die Abfragen selbst sind gemessen (unter
# 0,1 ms), der Aufwand pro Anfrage drumherum – Verbindung, Ausweisprüfung,
# JSON – ist geraten. Dieses Skript ersetzt das Raten durch eine Messung.
#
# ----------------------------------------------------------------------------
# Was es nachstellt
#
# Genau das, was loadPolls() im Browser tut, und zwar dreimal je Durchgang:
#
#   1. polls + poll_options   (die Liste, limit 50)
#   2. poll_results           (die Balken)
#   3. die eigenen Stimmen
#
# Seit dem Umbau fragt jeder offene Polls-Tab das alle 5 Sekunden nach. N
# gleichzeitige Nutzer sind also N * 3 / 5 Anfragen pro Sekunde. Bei 3.000
# Nutzern sind das 1.800.
#
# Das Skript fährt mehrere Stufen ab und zeigt für jede, wie viele Anfragen
# tatsächlich durchgingen und wie lange sie dauerten. Die Stufe, ab der die
# Antwortzeiten weglaufen, ist die Grenze der aktuellen Instanzgröße.
#
# ----------------------------------------------------------------------------
# Es wird NUR gelesen
#
# Drei GET-Abfragen, keine einzige Änderung. Der Test kann nichts kaputtmachen
# und keine Daten anfassen. Er kostet Egress – bei einem vollen Durchlauf
# grob 50 bis 100 MB, also ein paar Cent.
#
# ----------------------------------------------------------------------------
# So läuft er
#
#   1. sized.gg im Browser öffnen und ANMELDEN
#   2. Rechtsklick -> Untersuchen -> Reiter "Console", dort eintippen:
#
#        copy(localStorage.getItem('ansem_jwt'))
#
#      Damit liegt der Anmeldeausweis in der Zwischenablage.
#
#   3. Im Terminal:
#
#        cd <projektordner>
#        python3 scripts/lasttest.py --jwt "$(pbpaste)"
#
#   4. WÄHRENDDESSEN im Supabase-Dashboard unter Reports die CPU-Kurve
#      ansehen. Das Skript sagt, was ankommt; die Kurve sagt, was es kostet.
#
# Nur eine einzelne Stufe, etwa zum Nachmessen nach einer Änderung:
#
#        python3 scripts/lasttest.py --jwt "$(pbpaste)" --stufen 800
# =============================================================================

import argparse
import base64
import json
import re
import statistics
import sys
import threading
import time
import http.client
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

TAKT_S = 5.0          # so oft fragt ein offener Polls-Tab nach (STIMMEN_TAKT_MS)
ABFRAGEN_JE_TAKT = 3  # so viele Abfragen macht loadPolls() dabei
STUFEN = [50, 100, 200, 400, 800, 1500, 3000]
DAUER_S = 30          # je Stufe
ARBEITER = 240        # gleichzeitige Verbindungen; mehr bringt vom Laptop nichts


# -----------------------------------------------------------------------------
# Zugangsdaten
# -----------------------------------------------------------------------------

def lies_config(pfad: Path):
    """Holt Projektadresse und anon-Key aus public/config.js."""
    if not pfad.exists():
        sys.exit(f"Nicht gefunden: {pfad}\nBitte im Projektordner ausfuehren.")
    text = pfad.read_text(encoding="utf-8")
    url = re.search(r"https://[a-z0-9]+\.supabase\.co", text)
    key = re.search(r"anonKey\s*\?\?\s*'([^']+)'", text) \
        or re.search(r"SUPABASE_ANON_KEY\s*=\s*[^']*'([^']+)'", text)
    if not url or not key or "DEIN" in key.group(1):
        sys.exit("In public/config.js stehen noch Platzhalter statt echter Werte.")
    return url.group(0), key.group(1)


def wallet_aus_jwt(jwt: str) -> str:
    """Liest die Wallet aus dem Ausweis – ohne Pruefung, nur zum Abfragenbauen."""
    try:
        roh = jwt.split(".")[1]
        roh += "=" * (-len(roh) % 4)
        return json.loads(base64.urlsafe_b64decode(roh))["wallet"]
    except Exception:
        sys.exit("Der Ausweis sieht nicht aus wie ein JWT mit einem wallet-Feld.\n"
                 "In der Browser-Konsole: copy(localStorage.getItem('ansem_jwt'))")


# -----------------------------------------------------------------------------
# Die drei Abfragen, wortgleich zu loadPolls()
# -----------------------------------------------------------------------------

def baue_abfragen(wallet: str):
    """Nur die Pfade – die Verbindung steht pro Arbeiter und bleibt offen."""
    r = "/rest/v1"
    return [
        ("polls",
         f"{r}/polls?select=id,question,created_at,closes_at,closed,"
         f"poll_options(id,label,idx)&order=created_at.desc&limit=50"),
        ("poll_results", f"{r}/poll_results?select=*"),
        ("votes",        f"{r}/votes?select=poll_id,option_id&wallet=eq.{wallet}"),
    ]


class Zaehler:
    def __init__(self):
        self.sperre = threading.Lock()
        self.zeiten = []
        self.fehler = {}

    def gut(self, ms):
        with self.sperre:
            self.zeiten.append(ms)

    def schlecht(self, grund):
        with self.sperre:
            self.fehler[grund] = self.fehler.get(grund, 0) + 1


# Jeder Arbeiter haelt seine eigene, dauerhaft offene Verbindung.
#
# Das ist kein Feinschliff, sondern der Unterschied zwischen einer gueltigen
# und einer wertlosen Messung: urllib baut fuer JEDE Anfrage eine neue
# TLS-Verbindung auf. Bei 1.800 Anfragen pro Sekunde waeren das 1.800
# Handshakes pro Sekunde – gemessen haette dieser Test dann die
# Rechenleistung des Laptops und nicht die der Datenbank. Ein Browser
# benutzt eine Verbindung ebenfalls wieder; so ist es also auch naeher an
# der Wirklichkeit.
_lokal = threading.local()


def verbindung(basis: str):
    c = getattr(_lokal, "conn", None)
    if c is None:
        u = urlsplit(basis)
        bauer = (http.client.HTTPSConnection if u.scheme == "https"
                 else http.client.HTTPConnection)
        c = bauer(u.hostname, u.port or (443 if u.scheme == "https" else 80),
                  timeout=20)
        _lokal.conn = c
    return c


def hole(basis: str, pfad: str, kopf: dict, z: Zaehler):
    start = time.perf_counter()
    try:
        c = verbindung(basis)
        c.request("GET", pfad, headers=kopf)
        antwort = c.getresponse()
        antwort.read()                      # Koerper wird verworfen, aber gelesen
        if antwort.status >= 400:
            z.schlecht(f"HTTP {antwort.status}")
        else:
            z.gut((time.perf_counter() - start) * 1000)
    except Exception as e:
        # Kaputte Verbindung wegwerfen, der naechste Versuch baut eine neue.
        try:
            _lokal.conn.close()
        except Exception:
            pass
        _lokal.conn = None
        z.schlecht(type(e).__name__)


# -----------------------------------------------------------------------------
# Eine Stufe
# -----------------------------------------------------------------------------

def stufe(nutzer: int, basis: str, abfragen, kopf: dict, dauer: float):
    """Haelt `nutzer` gleichzeitige Nutzer fuer `dauer` Sekunden nach."""
    ziel = nutzer * ABFRAGEN_JE_TAKT / TAKT_S      # Anfragen pro Sekunde
    z = Zaehler()
    ende = time.perf_counter() + dauer
    geschickt = 0

    with ThreadPoolExecutor(max_workers=ARBEITER) as pool:
        beginn = time.perf_counter()
        while time.perf_counter() < ende:
            # Wie viele Anfragen haetten bis jetzt raus sein muessen?
            soll = int((time.perf_counter() - beginn) * ziel)
            while geschickt < soll:
                _, pfad = abfragen[geschickt % len(abfragen)]
                pool.submit(hole, basis, pfad, kopf, z)
                geschickt += 1
            time.sleep(0.002)

    gelaufen = dauer
    n = len(z.zeiten)
    fehler = sum(z.fehler.values())
    if n:
        s = sorted(z.zeiten)
        p50 = s[len(s) // 2]
        p95 = s[min(len(s) - 1, int(len(s) * 0.95))]
        p99 = s[min(len(s) - 1, int(len(s) * 0.99))]
    else:
        p50 = p95 = p99 = float("nan")

    return {
        "nutzer": nutzer, "ziel": ziel, "ist": n / gelaufen,
        "p50": p50, "p95": p95, "p99": p99,
        "fehler": fehler, "fehlerarten": z.fehler,
    }


def main():
    p = argparse.ArgumentParser(description="Lasttest gegen die eigene Supabase-Datenbank")
    p.add_argument("--jwt", required=True, help="Anmeldeausweis aus localStorage")
    p.add_argument("--stufen", type=int, nargs="*", default=STUFEN,
                   help=f"Nutzerzahlen (Vorgabe: {' '.join(map(str, STUFEN))})")
    p.add_argument("--dauer", type=float, default=DAUER_S, help="Sekunden je Stufe")
    p.add_argument("--config", default="public/config.js")
    a = p.parse_args()

    jwt = a.jwt.strip()
    basis, anon = lies_config(Path(a.config))
    wallet = wallet_aus_jwt(jwt)
    abfragen = baue_abfragen(wallet)
    kopf = {"apikey": anon, "Authorization": f"Bearer {jwt}",
            "Accept": "application/json", "Accept-Encoding": "gzip"}

    print(f"\n  Ziel     {basis}")
    print(f"  Wallet   {wallet[:8]}…")
    print(f"  Modell   ein Nutzer = {ABFRAGEN_JE_TAKT} Abfragen alle {TAKT_S:.0f} s\n")

    # Aufwaermen: Geht ueberhaupt alles durch? Ein 401 hier spart 5 Minuten
    # Warten auf ein Ergebnis, das nur aus Fehlern besteht.
    print("  Aufwaermen …", end=" ", flush=True)
    z = Zaehler()
    for name, pfad in abfragen:
        hole(basis, pfad, kopf, z)
    if z.fehler:
        print("FEHLGESCHLAGEN")
        for grund, n in z.fehler.items():
            print(f"    {grund} ({n}x)")
        print("\n  HTTP 401 heisst: der Ausweis ist abgelaufen. Neu anmelden und")
        print("  copy(localStorage.getItem('ansem_jwt')) noch einmal ausfuehren.")
        sys.exit(1)
    print(f"ok ({statistics.mean(z.zeiten):.0f} ms Grundlaufzeit)\n")

    kopfzeile = f"  {'Nutzer':>7}  {'Ziel/s':>7}  {'Ist/s':>7}  {'p50':>7}  {'p95':>7}  {'p99':>7}  {'Fehler':>7}"
    print(kopfzeile)
    print("  " + "-" * (len(kopfzeile) - 2))

    for n in a.stufen:
        r = stufe(n, basis, abfragen, kopf, a.dauer)
        print(f"  {r['nutzer']:>7}  {r['ziel']:>7.0f}  {r['ist']:>7.0f}  "
              f"{r['p50']:>6.0f}m  {r['p95']:>6.0f}m  {r['p99']:>6.0f}m  {r['fehler']:>7}")
        if r["fehlerarten"]:
            for grund, k in sorted(r["fehlerarten"].items()):
                print(f"           {grund}: {k}")

        # Abbrechen, wenn es offensichtlich reisst – weiter zu drehen misst
        # dann nur noch, wie schnell etwas kaputtgeht.
        if r["fehler"] > r["ist"] * a.dauer * 0.05:
            print("\n  Ueber 5 % Fehler – hier ist die Grenze. Abbruch.")
            break
        if r["p95"] > 2000:
            print("\n  p95 ueber 2 Sekunden – hier ist die Grenze. Abbruch.")
            break
        if r["ist"] < r["ziel"] * 0.8:
            print("\n  Die Zielrate wird nicht mehr erreicht. Entweder ist die")
            print("  Datenbank am Limit oder dieser Laptop. Abbruch.")
            break
        time.sleep(3)   # kurz durchatmen lassen, damit Stufen sich nicht ueberlappen

    print("\n  p50/p95/p99 sind Antwortzeiten in Millisekunden.")
    print("  Die letzte Zeile ohne Fehler und mit p95 unter etwa 300 ms ist das,")
    print("  was diese Instanzgroesse traegt.\n")


if __name__ == "__main__":
    main()
