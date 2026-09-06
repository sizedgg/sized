#!/usr/bin/env python3
"""
Erzeugt die Icons für den Startbildschirm.

Das Zeichen sind zwei Balken gleicher Breite und verschiedener Höhe: der
Größenunterschied, um den sich die ganze Seite dreht. Gezeichnet und nicht als
Schriftzeichen gesetzt – so sieht es auf jedem System gleich aus.

Die Maße stammen aus dem 100er-Raster der Vorschau (scripts/vorschau-logo.mjs,
Satz "gleich", Nummer 2) und stehen unten in BALKEN. Wer das Zeichen ändert,
ändert es dort und hier – und in der Kopfzeile und im Favicon in index.html.

Zwei Sorten, beide werden gebraucht:

  * normal    – wird so angezeigt, wie sie ist
  * maskable  – Android schneidet daraus einen Kreis, ein Quadrat oder eine
                Tropfenform, je nach Hersteller. Deshalb sitzt das Zeichen hier
                deutlich kleiner in der Mitte, damit nichts abgeschnitten wird.

    python3 scripts/make-icons.py
"""
import pathlib
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (10, 11, 15, 255)        # --bg
MARKE = (236, 239, 245, 255)  # --accent (Knochenweiss)

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
