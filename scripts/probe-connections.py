#!/usr/bin/env python3
"""
Wie viele Realtime-Verbindungen nimmt das Projekt gleichzeitig an?

Bewusst winzig gehalten: Nur der WebSocket-Aufbau, kein Kanalbeitritt, keine
Anmeldung. Der beobachtete HTTP 429 entsteht schon beim Aufbau, also reicht
dafür der öffentliche anon-Key – kein JWT, kein Secret.

Der Zweck ist eine einzige Frage: Gilt die beobachtete Grenze von rund 430 pro
Absender-IP oder für das ganze Projekt? Läuft dieses Werkzeug von einem anderen
Rechner aus in dieselbe Grenze, während ein zweiter Rechner seine Verbindungen
hält, ist es das Projekt. Kommt jeder Rechner für sich auf 430, ist es die IP –
und dann ist die Grenze ein Messartefakt und kein Problem der Anwendung.

  Grenze suchen:   python3 scripts/probe-connections.py --find 1500
  Halten:          python3 scripts/probe-connections.py --hold 400 --seconds 300

Erwartet SUPABASE_URL und SUPABASE_ANON_KEY in der Umgebung.
"""
import argparse
import asyncio
import base64
import json
import os
import ssl
import struct
import sys
import time
from urllib.parse import urlparse

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
HEARTBEAT_SEC = 25


async def open_ws(url: str):
    """WebSocket-Handshake von Hand. Gibt (reader, writer) zurueck."""
    u = urlparse(url)
    port = u.port or (443 if u.scheme == "wss" else 80)
    ctx = ssl.create_default_context() if u.scheme == "wss" else None
    reader, writer = await asyncio.open_connection(u.hostname, port, ssl=ctx)

    key = base64.b64encode(os.urandom(16)).decode()
    path = u.path + ("?" + u.query if u.query else "")
    writer.write((
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {u.hostname}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    await writer.drain()

    status = (await reader.readline()).decode(errors="replace").strip()
    while True:                       # restliche Kopfzeilen wegwerfen
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
    if "101" not in status:
        writer.close()
        raise ConnectionError(status or "keine Antwort")
    return reader, writer


async def send_frame(writer, text: str):
    data = text.encode()
    mask = os.urandom(4)
    n = len(data)
    head = bytearray([0x81])
    if n < 126:
        head.append(0x80 | n)
    elif n < 1 << 16:
        head.append(0x80 | 126)
        head += struct.pack(">H", n)
    else:
        head.append(0x80 | 127)
        head += struct.pack(">Q", n)
    head += mask
    writer.write(bytes(head) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    await writer.drain()


class Holder:
    """Haelt eine Verbindung offen und schickt das noetige Lebenszeichen."""

    def __init__(self, url):
        self.url = url
        self.writer = None
        self.alive = False

    async def connect(self):
        self.reader, self.writer = await open_ws(self.url)
        self.alive = True

    async def run(self, stop: asyncio.Event):
        ref = 0
        nxt = time.monotonic() + HEARTBEAT_SEC
        try:
            while not stop.is_set():
                if time.monotonic() >= nxt:
                    ref += 1
                    await send_frame(self.writer, json.dumps({
                        "topic": "phoenix", "event": "heartbeat",
                        "payload": {}, "ref": str(ref)}))
                    nxt = time.monotonic() + HEARTBEAT_SEC
                try:
                    await asyncio.wait_for(self.reader.read(4096), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
        except Exception:
            self.alive = False
        finally:
            try:
                self.writer.close()
            except Exception:
                pass


def ws_url() -> str:
    base = URL.replace("https://", "wss://").replace("http://", "ws://")
    return f"{base}/realtime/v1/websocket?apikey={ANON}&vsn=1.0.0"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--find", type=int, metavar="MAX",
                    help="so weit hochfahren, bis der Server ablehnt")
    ap.add_argument("--hold", type=int, metavar="N",
                    help="N Verbindungen aufbauen und offen halten")
    ap.add_argument("--seconds", type=int, default=300)
    ap.add_argument("--rate", type=float, default=40.0,
                    help="Verbindungen pro Sekunde beim Aufbau")
    a = ap.parse_args()

    if not URL or not ANON:
        sys.exit("SUPABASE_URL und SUPABASE_ANON_KEY muessen gesetzt sein")

    target = a.find or a.hold
    if not target:
        sys.exit("--find oder --hold angeben")

    url = ws_url()
    print(f"\nZiel {target} Verbindungen, {a.rate:g}/s, nach {urlparse(URL).hostname}")

    stop = asyncio.Event()
    holders, tasks, errors = [], [], {}
    t0 = time.monotonic()

    async def one(i):
        await asyncio.sleep(i / a.rate)
        if stop.is_set():
            return
        h = Holder(url)
        try:
            await h.connect()
        except Exception as e:
            key = str(e)[:60] or type(e).__name__
            errors[key] = errors.get(key, 0) + 1
            return
        holders.append(h)
        tasks.append(asyncio.create_task(h.run(stop)))

    await asyncio.gather(*(one(i) for i in range(target)), return_exceptions=True)

    took = time.monotonic() - t0
    ok = len(holders)
    print(f"\n  Aufgebaut        {ok} von {target} in {took:.1f} s")
    if errors:
        print(f"  Abgelehnt        {target - ok}")
        for k, v in sorted(errors.items(), key=lambda x: -x[1])[:4]:
            print(f"                   {v}x  {k}")
    else:
        print("  Abgelehnt        0  (Grenze nicht erreicht - hoeher probieren)")

    if a.hold:
        print(f"\n  Halte {ok} Verbindungen fuer {a.seconds} s offen ...")
        await asyncio.sleep(a.seconds)
        still = sum(1 for h in holders if h.alive)
        print(f"  Nach {a.seconds} s noch offen: {still} von {ok}")

    stop.set()
    await asyncio.gather(*tasks, return_exceptions=True)
    print()


if __name__ == "__main__":
    asyncio.run(main())
