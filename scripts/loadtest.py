#!/usr/bin/env python3
"""
Lasttest für ANSEM HUB.

Misst die drei Stellen, an denen die App unter Andrang zuerst nachgibt:

  login     Ansturm auf die verify-Function (der Launch-Moment)
  write     Schreibdurchsatz im Chat über PostgREST
  realtime  Fan-out: Wie viele Zuschauer bekommen eine Nachricht wie schnell

Ohne Zusatzpakete – nur Python-Standardbibliothek, inklusive eines minimalen
WebSocket-Clients für Supabase Realtime.

    export SUPABASE_URL="https://<ref>.supabase.co"
    export SUPABASE_ANON_KEY="<anon key>"
    export APP_JWT_SECRET="<JWT Secret aus dem Dashboard>"

    python3 scripts/loadtest.py realtime --clients 200
    python3 scripts/loadtest.py login --clients 100

WICHTIG: Der Test schreibt echte Zeilen in die Datenbank und verbraucht
Helius-Kontingent. Alle erzeugten Nachrichten beginnen mit "[loadtest]" und
lassen sich hinterher mit dem am Ende ausgegebenen SQL entfernen.
"""

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import ssl
import statistics
import struct
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
SECRET = os.environ.get("APP_JWT_SECRET", "")
TAG = "[loadtest]"

# Supabase trennt eine Realtime-Verbindung nach etwa 60 s ohne Lebenszeichen.
# 25 s lassen genug Luft für einen ausgefallenen Schlag.
HEARTBEAT_SEC = 25

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


# ---------------------------------------------------------------------------
# Hilfen
# ---------------------------------------------------------------------------

def b58encode(raw: bytes) -> str:
    zeros = len(raw) - len(raw.lstrip(b"\0"))
    num = int.from_bytes(raw, "big")
    out = ""
    while num:
        num, rem = divmod(num, 58)
        out = B58[rem] + out
    return "1" * zeros + out


def fake_wallet() -> str:
    return b58encode(secrets.token_bytes(32))


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_jwt(wallet: str, ttl_hours: int = 2) -> str:
    """Baut ein Token wie die verify-Function – damit wir ohne echte Zahlung testen."""
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "aud": "authenticated", "role": "authenticated", "sub": wallet,
        "iat": now, "exp": now + ttl_hours * 3600,
        "wallet": wallet, "is_admin": False, "oiat": now,
    }
    signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(payload).encode())}"
    sig = hmac.new(SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{b64url(sig)}"


def http(path: str, method="GET", body=None, token=None, timeout=30):
    """Ein HTTP-Aufruf. Gibt (status, dauer_ms, text) zurück, wirft nicht."""
    req = urllib.request.Request(URL + path, method=method)
    req.add_header("apikey", ANON)
    req.add_header("authorization", "Bearer " + (token or ANON))
    if body is not None:
        req.add_header("content-type", "application/json")
        req.data = json.dumps(body).encode()
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, (time.monotonic() - t0) * 1000, r.read().decode()[:400]
    except urllib.error.HTTPError as e:
        return e.code, (time.monotonic() - t0) * 1000, e.read().decode()[:400]
    except Exception as e:
        return 0, (time.monotonic() - t0) * 1000, f"{type(e).__name__}: {e}"


def report(name: str, results):
    """results: Liste von (status, ms)."""
    total = len(results)
    ok = [ms for st, ms in results if 200 <= st < 300]
    codes = {}
    for st, _ in results:
        codes[st] = codes.get(st, 0) + 1
    print(f"\n  {name}")
    print(f"    Anfragen           {total}")
    print(f"    Erfolgreich        {len(ok)}  ({len(ok) * 100 // max(total, 1)} %)")
    print(f"    Statuscodes        {dict(sorted(codes.items()))}")
    if ok:
        s = sorted(ok)
        print(f"    Antwortzeit  p50   {s[len(s) // 2]:.0f} ms")
        print(f"                 p95   {s[int(len(s) * 0.95) - 1]:.0f} ms")
        print(f"                 max   {s[-1]:.0f} ms")


# ---------------------------------------------------------------------------
# Test 1: Login-Ansturm
# ---------------------------------------------------------------------------

def test_login(n: int, workers: int):
    print(f"\n=== Login-Ansturm: {n} Wallets gleichzeitig ===")
    print("    Jede fordert einen Betrag an und fragt einmal den Status ab.")
    print("    Genau das passiert, wenn der Link rausgeht.")

    wallets = [fake_wallet() for _ in range(n)]

    def one(w):
        st, ms, txt = http("/functions/v1/verify", "POST",
                           {"action": "challenge", "wallet": w})
        if st != 200:
            return ("challenge", st, ms), None
        try:
            cid = json.loads(txt)["challengeId"]
        except Exception:
            return ("challenge", 0, ms), None
        st2, ms2, _ = http("/functions/v1/verify", "POST",
                           {"action": "status", "challengeId": cid})
        return ("challenge", st, ms), ("status", st2, ms2)

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        pairs = list(ex.map(one, wallets))
    dur = time.monotonic() - t0

    report("Betrag anfordern", [(st, ms) for (_, st, ms), _ in pairs])
    report("Status abfragen (löst den Treasury-Scan aus)",
           [(st, ms) for _, r in pairs if r for (_, st, ms) in [r]])
    print(f"\n    Gesamtdauer        {dur:.1f} s  ->  {n / dur:.0f} Logins/s")
    print("\n    Achte auf 429 und 5xx bei 'Status abfragen'. Die entstehen,")
    print("    wenn zu viele Function-Instanzen gleichzeitig Helius abfragen.")


# ---------------------------------------------------------------------------
# Test 2: Schreibdurchsatz im Chat
# ---------------------------------------------------------------------------

def test_write(n: int, per_wallet: int, workers: int):
    print(f"\n=== Chat-Schreiblast: {n} Wallets x {per_wallet} Nachrichten ===")
    print("    Das Rate-Limit erlaubt 6 pro Minute und Wallet – deshalb viele")
    print("    Wallets mit wenigen Nachrichten, nicht umgekehrt.")

    def one(i):
        w = fake_wallet()
        tok = make_jwt(w)
        out = []
        for k in range(per_wallet):
            st, ms, _ = http("/rest/v1/messages", "POST",
                             {"wallet": w, "body": f"{TAG} {i}-{k} {secrets.token_hex(3)}"},
                             token=tok)
            out.append((st, ms))
        return out

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        nested = list(ex.map(one, range(n)))
    dur = time.monotonic() - t0

    flat = [r for sub in nested for r in sub]
    report("Nachricht schreiben", flat)
    written = sum(1 for st, _ in flat if 200 <= st < 300)
    print(f"\n    Gesamtdauer        {dur:.1f} s  ->  {written / dur:.0f} geschriebene Nachrichten/s")


# ---------------------------------------------------------------------------
# Minimaler WebSocket-Client (nur Standardbibliothek)
# ---------------------------------------------------------------------------

class WS:
    """Gerade genug WebSocket für Supabase Realtime: Handshake, Text-Frames, Ping."""

    def __init__(self, reader, writer):
        self.r, self.w = reader, writer

    @classmethod
    async def connect(cls, url: str):
        u = urlparse(url)
        port = u.port or (443 if u.scheme == "wss" else 80)
        ctx = ssl.create_default_context() if u.scheme == "wss" else None
        reader, writer = await asyncio.open_connection(u.hostname, port, ssl=ctx)
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        path = u.path + ("?" + u.query if u.query else "")

        # Bis hierher hat sich dieses Werkzeug wie ein nackter Skript-Client
        # vorgestellt: kein Origin, kein User-Agent, keine Extensions. Genau so
        # sieht ein Bot aus, und ein Schutzwall davor darf so etwas härter
        # begrenzen als einen Browser. Damit hätte die Messung eine Grenze
        # gefunden, die für echte Nutzer gar nicht gilt.
        #
        # Mit BROWSER_LIKE=0 lässt sich der alte Zustand zum Vergleich
        # wiederherstellen – der Unterschied zwischen beiden Läufen ist die
        # Antwort auf die Frage, ob die Grenze dem Client oder dem Projekt gilt.
        extra = ""
        if os.environ.get("BROWSER_LIKE", "1") != "0":
            origin = os.environ.get("ORIGIN", "http://localhost:8000")
            extra = (
                f"Origin: {origin}\r\n"
                "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36\r\n"
                "Accept-Language: en-US,en;q=0.9\r\n"
                "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n"
            )

        req = (
            f"GET {path} HTTP/1.1\r\nHost: {u.hostname}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
            f"{extra}\r\n"
        )
        writer.write(req.encode())
        await writer.drain()
        line = await reader.readline()
        if b"101" not in line:
            # Kopfzeilen mitlesen: Steht dort etwas über eine Wartezeit oder
            # ein Kontingent, ist das der direkteste Hinweis auf die Ursache.
            hints = []
            for _ in range(20):
                l = await reader.readline()
                if l in (b"\r\n", b"", b"\n"):
                    break
                low = l.lower()
                if low.startswith((b"retry-after", b"x-ratelimit", b"ratelimit",
                                   b"x-request-id", b"cf-ray", b"server:")):
                    hints.append(l.decode(errors="replace").strip())

            # WICHTIG: Der Socket muss hier zu. Ohne das bleibt jede abgelehnte
            # Verbindung offen stehen – bei 500 Ablehnungen sind das 500
            # Leitungen, die das Werkzeug selbst offen hält und die die Messung
            # verfälschen, indem sie genau das Kontingent belegen, das gemessen
            # werden soll.
            try:
                writer.close()
            except Exception:
                pass

            msg = line.decode(errors="replace").strip()
            if hints:
                msg += " | " + " ; ".join(hints[:3])
            raise RuntimeError(msg)
        while (await reader.readline()) not in (b"\r\n", b"", b"\n"):
            pass
        return cls(reader, writer)

    async def send(self, text: str):
        data = text.encode()
        header = bytearray([0x81])
        mask = secrets.token_bytes(4)
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126); header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127); header += struct.pack(">Q", n)
        header += mask
        self.w.write(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        await self.w.drain()

    async def recv(self):
        h = await self.r.readexactly(2)
        opcode = h[0] & 0x0F
        n = h[1] & 0x7F
        if n == 126:
            n = struct.unpack(">H", await self.r.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", await self.r.readexactly(8))[0]
        payload = await self.r.readexactly(n) if n else b""
        if opcode == 0x9:            # Ping -> Pong
            await self.send("")
            return None
        if opcode == 0x8:
            raise ConnectionError("Server hat geschlossen")
        return payload.decode(errors="replace")

    def close(self):
        try:
            self.w.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Test 3: Realtime-Fan-out
# ---------------------------------------------------------------------------

async def subscriber(idx, ready, received, stop, lost, start_delay):
    """
    Ein Zuschauer: verbindet, abonniert messages, meldet Ankunftszeiten.

    Fehler werden gezählt statt geworfen. Eine Verbindung, die der Server
    mittendrin schließt, ist ein Messergebnis – kein Absturz des Werkzeugs.
    """
    if start_delay:
        await asyncio.sleep(start_delay)
    if stop.is_set():
        return

    wallet = fake_wallet()
    tok = make_jwt(wallet)
    ws_url = URL.replace("https://", "wss://").replace("http://", "ws://")
    ws_url += f"/realtime/v1/websocket?apikey={ANON}&vsn=1.0.0"

    ws = None
    try:
        ws = await WS.connect(ws_url)
    except Exception as e:
        detail = str(e)[:160] or type(e).__name__
        ready.append((idx, f"Verbindung: {detail}", time.monotonic()))
        return

    join = {
        # Derselbe Kanal für alle – exakt wie die App es macht. Ein eigener
        # Kanal je Zuschauer wäre eine ganz andere (und unrealistische) Last.
        "topic": "realtime:hub:chat",
        "event": "phx_join",
        "payload": {
            "config": {
                "postgres_changes": [
                    {"event": "INSERT", "schema": "public", "table": "messages"}
                ]
            },
            "access_token": tok,
        },
        "ref": "1",
    }

    joined = False
    ref = 1
    next_beat = time.monotonic() + HEARTBEAT_SEC
    try:
        await ws.send(json.dumps(join))
        while not stop.is_set():
            # Phoenix erwartet regelmäßig ein Lebenszeichen auf dem Topic
            # "phoenix". Bleibt es aus, trennt Supabase nach etwa 60 Sekunden.
            # Ohne das misst ein langer Testlauf die eigene Nachlässigkeit
            # statt der Belastbarkeit des Servers.
            if time.monotonic() >= next_beat:
                ref += 1
                await ws.send(json.dumps({
                    "topic": "phoenix", "event": "heartbeat",
                    "payload": {}, "ref": str(ref),
                }))
                next_beat = time.monotonic() + HEARTBEAT_SEC

            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if raw is None:
                continue
            msg = json.loads(raw)
            ev = msg.get("event")
            if ev == "phx_reply" and msg.get("topic") == "phoenix":
                continue                      # Antwort auf das Lebenszeichen
            if ev == "phx_reply" and not joined:
                ok = msg.get("payload", {}).get("status") == "ok"
                joined = ok
                ready.append((idx, "ok" if ok else str(msg.get("payload"))[:100], time.monotonic()))
            elif ev == "postgres_changes":
                rec = msg.get("payload", {}).get("data", {}).get("record", {})
                body = rec.get("body", "")
                if body.startswith(TAG + " ping"):
                    received.append((idx, body, time.monotonic()))
    except asyncio.CancelledError:
        raise
    except Exception as e:
        # Genau das wollen wir sehen: Verbindung ging unterwegs verloren.
        if joined:
            lost.append((idx, type(e).__name__))
        else:
            ready.append((idx, f"Abbruch: {type(e).__name__}", time.monotonic()))
    finally:
        if ws:
            ws.close()


async def test_realtime(n: int, pings: int, rate: float, join_rate: float):
    print(f"\n=== Realtime-Fan-out: {n} gleichzeitige Zuschauer ===")

    # asyncio meldet beim Herunterfahren gern Transportfehler. Die zählen wir,
    # statt sie als Stacktrace über das Ergebnis zu schütten.
    noise = []
    asyncio.get_running_loop().set_exception_handler(
        lambda loop, ctx: noise.append(ctx.get("message", "?")))

    async def shutdown(tasks, stop):
        stop.set()
        await asyncio.sleep(0.3)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # --- Selbsttest mit einem Zuschauer ---
    print("    Selbsttest: ein Zuschauer, eine Nachricht.")
    ready, received, lost, stop = [], [], [], asyncio.Event()
    solo = [asyncio.create_task(subscriber(0, ready, received, stop, lost, 0))]
    await asyncio.sleep(3)
    if not ready or ready[0][1] != "ok":
        await shutdown(solo, stop)
        print(f"    ABBRUCH: Konnte nicht abonnieren -> {ready or 'keine Antwort'}")
        print("    Das ist ein Problem des Werkzeugs oder der Realtime-Einstellung,")
        print("    nicht zwingend deiner App.")
        return

    w = fake_wallet()
    st, _, txt = http("/rest/v1/messages", "POST",
                      {"wallet": w, "body": f"{TAG} ping selftest"}, token=make_jwt(w))
    await asyncio.sleep(3)
    if not received:
        await shutdown(solo, stop)
        print(f"    ABBRUCH: Nachricht geschrieben (HTTP {st}), aber nichts empfangen.")
        print(f"    Antwort: {txt[:200]}")
        return
    print("    Bestanden – Abonnement und Zustellung funktionieren.\n")
    await shutdown(solo, stop)

    # --- Hochdrehen, gestaffelt ---
    ready, received, lost, stop = [], [], [], asyncio.Event()
    print(f"    Verbinde mit {join_rate:g} Beitritten/s (nicht alle auf einmal –")
    print("    Supabase begrenzt auch die Beitrittsrate).")
    tasks = [asyncio.create_task(subscriber(i, ready, received, stop, lost, i / join_rate))
             for i in range(n)]

    t0 = time.monotonic()
    deadline = n / join_rate + 30
    while len(ready) < n and time.monotonic() - t0 < deadline:
        await asyncio.sleep(0.5)
    connect_time = time.monotonic() - t0

    good = sum(1 for _, s, _t in ready if s == "ok")
    print(f"\n    Verbunden          {good} von {n} in {connect_time:.1f} s")
    if good < n:
        reasons = {}
        for _, s, _t in ready:
            if s != "ok":
                reasons[s[:160]] = reasons.get(s[:160], 0) + 1
        fehlend = n - len(ready)
        if fehlend:
            reasons["keine Antwort"] = fehlend
        print(f"    Nicht verbunden    {n - good}   {dict(list(reasons.items())[:4])}")

        # Wann im Anlauf kamen die Ablehnungen? Das unterscheidet die beiden
        # möglichen Ursachen, ohne raten zu müssen:
        #
        #   Erst alles ok, ab einem Punkt nur noch Ablehnungen
        #     -> eine Obergrenze. So viele gleichzeitig gehen, mehr nicht.
        #
        #   Von Anfang an gemischt, Quote sinkt allmählich
        #     -> eine Bremse mit Guthaben, das sich langsam wieder füllt.
        #        Dann verfälscht jeder Testlauf den nächsten.
        print("\n    Verlauf des Anlaufs (je Zehntel der Anlaufzeit):")
        span = max(connect_time, 0.001) / 10
        for b in range(10):
            lo, hi = t0 + b * span, t0 + (b + 1) * span
            in_b = [s for _, s, ts in ready if lo <= ts < hi]
            if not in_b:
                continue
            ok_b = sum(1 for s in in_b if s == "ok")
            bar = "#" * round(20 * ok_b / len(in_b))
            print(f"      {lo - t0:5.1f}-{hi - t0:5.1f}s  {ok_b:4d}/{len(in_b):<4d} ok  {bar}")

    if good == 0:
        await shutdown(tasks, stop)
        print("    Keine Verbindung zustande gekommen – Abbruch.")
        return

    # --- Nachrichten senden und Zustellung messen ---
    interval = 1.0 / max(rate, 0.01)
    print(f"\n    Sende {pings} Nachrichten mit {rate:g}/s")
    print(f"    -> etwa {good * rate:.0f} Realtime-Nachrichten/s bei {good} Zuschauern")

    sent = {}
    for k in range(pings):
        wk = fake_wallet()
        body = f"{TAG} ping {k}"
        http("/rest/v1/messages", "POST", {"wallet": wk, "body": body}, token=make_jwt(wk))
        sent[body] = time.monotonic()
        await asyncio.sleep(interval)

    await asyncio.sleep(10)
    await shutdown(tasks, stop)

    delivered = {}
    for idx, body, at in received:
        if body in sent:
            delivered.setdefault(body, []).append(at - sent[body])

    total_expected = good * pings
    total_got = sum(len(v) for v in delivered.values())
    print(f"\n  Zustellung bei {good} Zuschauern")
    print(f"    Erwartet           {total_expected}")
    print(f"    Angekommen         {total_got}  ({total_got * 100 // max(total_expected, 1)} %)")
    if lost:
        print(f"    Verbindung verloren {len(lost)} Zuschauer waehrend des Tests")
    lat = [x for v in delivered.values() for x in v]
    if lat:
        s = sorted(lat)
        print(f"    Verzoegerung p50   {s[len(s) // 2] * 1000:.0f} ms")
        print(f"                 p95   {s[int(len(s) * 0.95) - 1] * 1000:.0f} ms")
        print(f"                 max   {s[-1] * 1000:.0f} ms")

    # Zustellung je gesendeter Nachricht: zeigt, ob es erst spaeter klemmt
    print("\n    Je Nachricht:", "  ".join(
        f"{len(delivered.get(f'{TAG} ping {k}', []))}" for k in range(pings)))
    print(f"    (jeweils von {good} erwartet)")

    if noise:
        print(f"\n    {len(noise)} Transportfehler beim Herunterfahren (nur Kosmetik)")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Lasttest für ANSEM HUB")
    ap.add_argument("test", choices=["login", "write", "realtime"])
    ap.add_argument("--clients", type=int, default=50)
    ap.add_argument("--per-wallet", type=int, default=3)
    ap.add_argument("--pings", type=int, default=5)
    ap.add_argument("--rate", type=float, default=1.0,
                    help="Nachrichten pro Sekunde (ein lebhafter Chat: 3-5)")
    ap.add_argument("--join-rate", type=float, default=50.0,
                    help="Verbindungsaufbauten pro Sekunde")
    ap.add_argument("--workers", type=int, default=64)
    a = ap.parse_args()

    missing = [k for k, v in
               [("SUPABASE_URL", URL), ("SUPABASE_ANON_KEY", ANON), ("APP_JWT_SECRET", SECRET)]
               if not v]
    if missing:
        sys.exit("Fehlende Umgebungsvariablen: " + ", ".join(missing))

    print("=" * 70)
    print(f"  Ziel:  {URL}")
    print(f"  Test:  {a.test}   Clients: {a.clients}")
    print("=" * 70)

    if a.test == "login":
        test_login(a.clients, a.workers)
    elif a.test == "write":
        test_write(a.clients, a.per_wallet, a.workers)
    else:
        asyncio.run(test_realtime(a.clients, a.pings, a.rate, a.join_rate))

    print("\n" + "-" * 70)
    print("  Aufräumen im SQL-Editor:")
    print("    delete from public.messages where body like '[loadtest]%';")
    print("    delete from public.challenges where status = 'pending';")
    print("    delete from public.wallets where address not in")
    print("      (select wallet from public.messages union select wallet from public.dms);")
    print("-" * 70)


if __name__ == "__main__":
    main()
