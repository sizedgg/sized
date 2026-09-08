#!/usr/bin/env python3
"""
Erzeugt die Icons für den Startbildschirm.

Das Zeichen sind zwei Balken gleicher Breite und verschiedener Höhe: der
Größenunterschied, um den sich die ganze Seite dreht. Gezeichnet und nicht als
Schriftzeichen gesetzt – so sieht es auf jedem System gleich aus.

Die Maße stammen aus dem 100er-Raster der Vorschau (scripts/vorschau-logo.mjs,
Satz "gleich", Nummer 2) und stehen unten in BALKEN. Wer das Zeichen ändert,
ändert es dort und hier – und in der Kopfzeile und im Favicon in index.html.

Die FARBEN stehen hier nicht mehr. Sie kommen aus public/styles.css, aus
--bg und --marke. Der Grund ist ein Fehler: beim Wechsel auf das helle Blatt
wurden Kopfzeile, Favicon, Manifest und theme-color umgestellt, und diese
Datei nicht – ihre zwei Zahlen waren die einzige Kopie der Palette außerhalb
des Blattes. Wochen später zeigte der Startbildschirm noch das alte, dunkle
Zeichen, und zwar nur dort, wo niemand hinsieht. Gelesen statt kopiert kann
das nicht wieder passieren; test-pwa.mjs misst zusätzlich die fertigen
Bildpunkte gegen dieselben zwei Werte.

Zwei Sorten, beide werden gebraucht:

  * normal    – wird so angezeigt, wie sie ist
  * maskable  – Android schneidet daraus einen Kreis, ein Quadrat oder eine
                Tropfenform, je nach Hersteller. Deshalb sitzt das Zeichen hier
                deutlich kleiner in der Mitte, damit nichts abgeschnitten wird.

    python3 scripts/make-icons.py
"""
import pathlib
import re
import sys
from PIL import Image, ImageDraw

WURZEL = pathlib.Path(__file__).resolve().parent.parent
OUT = WURZEL / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BLATT = (WURZEL / "public" / "styles.css").read_text(encoding="utf-8")


def farbe(name: str, tiefe: int = 0) -> tuple:
    """Liest eine Farbvariable aus styles.css.

    Folgt var(--x), weil --marke genau das ist: ein Verweis auf
    --accent-fill. Eine Kopie des Wertes hier wäre wieder die Kopie, die
    dieses Skript gerade losgeworden ist.
    """
    if tiefe > 4:
        sys.exit(f"  {name}: Verweise drehen sich im Kreis")
    treffer = re.search(rf"^\s*{re.escape(name)}\s*:\s*([^;]+);", BLATT, re.M)
    if not treffer:
        sys.exit(f"  {name} steht nicht in public/styles.css")
    wert = treffer.group(1).strip()
    verweis = re.fullmatch(r"var\(\s*(--[\w-]+)\s*\)", wert)
    if verweis:
        return farbe(verweis.group(1), tiefe + 1)
    hex_wert = re.fullmatch(r"#([0-9a-fA-F]{6})", wert)
    if not hex_wert:
        sys.exit(f"  {name} ist kein sechsstelliger Hexwert, sondern: {wert}")
    r, g, b = (int(hex_wert.group(1)[i:i + 2], 16) for i in (0, 2, 4))
    return (r, g, b, 255)


BG = farbe("--bg")
MARKE = farbe("--marke")

# Zwei Balken im 100er-Raster: x, y, Breite, Höhe, Eckenradius.
# Beide stehen auf derselben Grundlinie bei y = 80.
BALKEN = [
    (29, 54, 18, 26, 9),   # kurz, links
    (53, 16, 18, 64, 9),   # lang, rechts
]

# Der Kasten, den die Balken zusammen einnehmen – daran wird zentriert und
# skaliert. Von Hand ausgerechnet zu haben wäre eine Fehlerquelle bei jeder
# Änderung an BALKEN.
X0 = min(b[0] for b in BALKEN)
Y0 = min(b[1] for b in BALKEN)
X1 = max(b[0] + b[2] for b in BALKEN)
Y1 = max(b[1] + b[3] for b in BALKEN)

# Übertrieben groß zeichnen und am Ende verkleinern – so werden die Rundungen
# glatt, ohne dass wir Kantenglättung von Hand bauen müssen.
SS = 8


def draw(size: int, mark_ratio: float, rounded: bool) -> Image.Image:
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        # Eckenradius wie bei iOS-Kacheln: knapp ein Viertel der Kantenlänge.
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, n - 1, n - 1], fill=BG)

    # Die Balken so skalieren, dass ihre laengste Seite mark_ratio der
    # Kachelkante einnimmt, und mittig setzen. Ueber die laengste Seite und
    # nicht ueber die Breite, damit ein Zeichen dieser Proportion nicht
    # ueberlaeuft, wenn jemand spaeter die Hoehen aendert.
    skala = n * mark_ratio / max(X1 - X0, Y1 - Y0)
    links = (n - (X1 - X0) * skala) / 2 - X0 * skala
    oben = (n - (Y1 - Y0) * skala) / 2 - Y0 * skala

    for bx, by, bw, bh, br in BALKEN:
        x0 = links + bx * skala
        y0 = oben + by * skala
        d.rounded_rectangle(
            [x0, y0, x0 + bw * skala, y0 + bh * skala],
            radius=br * skala, fill=MARKE)

    return img.resize((size, size), Image.LANCZOS)


def main():
    print(f"\n  Grund  --bg    #{BG[0]:02x}{BG[1]:02x}{BG[2]:02x}")
    print(f"  Zeichen --marke #{MARKE[0]:02x}{MARKE[1]:02x}{MARKE[2]:02x}\n")
    made = []
    for size in (180, 192, 512):
        # Normal: Zeichen füllt gut die Hälfte der Fläche.
        p = OUT / f"icon-{size}.png"
        draw(size, 0.52, rounded=True).save(p)
        made.append(p)

    for size in (192, 512):
        # Maskierbar: Android darf bis zu 20 % je Seite wegschneiden. Das
        # Zeichen bleibt deshalb weit innerhalb des sicheren Bereichs.
        p = OUT / f"maskable-{size}.png"
        draw(size, 0.40, rounded=False).save(p)
        made.append(p)

    for p in made:
        print(f"  {p.relative_to(OUT.parent.parent)}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
