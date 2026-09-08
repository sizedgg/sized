#!/usr/bin/env python3
"""
Setzt rote Kaesten und die Saetze daneben.

Bekommt eine Plandatei (JSON) von scripts/vorschau-posteingang-erklaert.mjs:
das rohe Bildschirmfoto, die gemessenen Kaesten in CSS-Punkten, die Skala
und die Saetze. Hier wird nur gezeichnet - gemessen wird im Browser, an den
echten Elementen.

Zwei Entscheidungen stecken darin, beide aus dem ersten Versuch gelernt:

  Die Saetze stehen im Rand, nicht auf der Seite. Ein Kasten mit Text auf
  der Oberflaeche verdeckt genau das, was er erklaeren soll.

  Die Linien laufen durch Gassen, nicht quer durchs Bild. Der erste Versuch
  zog sie auf der Hoehe des Satzes waagerecht zum Kasten - eine davon lief
  quer durch die Liste, eine andere mitten durch eine Nachrichtenblase. Die
  Gassen (links neben der Liste, in der Luecke zwischen Liste und Fenster)
  kommen gemessen aus der Seite und nicht aus geschaetzten Zahlen.

    python3 scripts/beschriften.py preview/artikel/.plan.json
"""
import json
import pathlib
import sys
from PIL import Image, ImageDraw, ImageFont

ROT = (198, 40, 40, 255)
GRUND = (245, 242, 236, 255)     # --bg, damit der Rand dasselbe Blatt ist
RAND = 330                       # Spalte fuer die Saetze, in Punkten
LUFT = 5                         # Abstand des Kastens vom Element - eng
STRICH = 2
SCHRIFT = 15
ABSTAND = 16                     # Mindestluft zwischen zwei Saetzen

MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
MONO_FETT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'


def umbrechen(text, schrift, breite):
    zeilen, laufend = [], ''
    for wort in text.split():
        versuch = f'{laufend} {wort}'.strip()
        if schrift.getlength(versuch) <= breite or not laufend:
            laufend = versuch
        else:
            zeilen.append(laufend)
            laufend = wort
    if laufend:
        zeilen.append(laufend)
    return zeilen


def main(planpfad):
    plan = json.loads(pathlib.Path(planpfad).read_text())
    s = plan['skala']
    g = plan['gassen']
    foto = Image.open(plan['foto']).convert('RGBA')

    rand = RAND * s
    breite = foto.width + 2 * rand
    blatt = Image.new('RGBA', (breite, foto.height), GRUND)
    blatt.paste(foto, (rand, 0))
    d = ImageDraw.Draw(blatt)

    schrift = ImageFont.truetype(MONO, SCHRIFT * s)
    ziffer = ImageFont.truetype(MONO_FETT, (SCHRIFT - 1) * s)
    zeilenhoehe = int(SCHRIFT * s * 1.45)
    spalte = rand - 2 * LUFT * s - 30 * s      # nutzbare Textbreite

    gasse_links = rand + g['links'] * s
    gasse_spalt = rand + g['spalt'] * s

    # Erst rechnen, dann zeichnen: die Saetze der linken Spalte werden
    # gestapelt, und wo einer den naechsten stossen wuerde, ruecken beide
    # auseinander. Zwei uebereinander geschriebene Saetze faellt sonst erst
    # im fertigen Bild auf.
    gesetzt = []
    unterkante = 0
    for nummer, e in enumerate(plan['beschriftung'], start=1):
        k = plan['kaesten'][e['schluessel']]
        kasten = (
            rand + k['x'] * s - LUFT * s, k['y'] * s - LUFT * s,
            rand + (k['x'] + k['w']) * s + LUFT * s, (k['y'] + k['h']) * s + LUFT * s,
        )
        zeilen = umbrechen(e['text'], schrift, spalte)
        hoehe = len(zeilen) * zeilenhoehe
        mitte_kasten = (kasten[1] + kasten[3]) / 2

        if e['route'] == 'spalt':
            oben = g['frei'] * s - hoehe / 2
        else:
            oben = mitte_kasten - hoehe / 2
        if e['seite'] == 'links':
            oben = max(oben, unterkante + ABSTAND * s)
            unterkante = oben + hoehe
        gesetzt.append((nummer, e, kasten, zeilen, oben, hoehe))

    for nummer, e, kasten, zeilen, oben, hoehe in gesetzt:
        d.rectangle(list(kasten), outline=ROT, width=STRICH * s)

        links = e['seite'] == 'links'
        tx = int(LUFT * s) if links else int(breite - rand + LUFT * s)
        d.text((tx, oben), f'{nummer}', font=ziffer, fill=ROT)
        for i, zeile in enumerate(zeilen):
            d.text((tx + 26 * s, oben + i * zeilenhoehe), zeile, font=schrift, fill=ROT)

        mitte_satz = oben + hoehe / 2
        # Wo die Linie in den Kasten faehrt. Mittig, ausser der Eintrag sagt
        # etwas anderes: bei der Vorschau liegt links davon das Kuerzel, und
        # eine Linie auf halber Hoehe streicht es durch.
        eintritt = e.get('eintritt', 0.5)
        mitte_kasten = kasten[1] + (kasten[3] - kasten[1]) * eintritt
        satz_ende = tx + spalte + 26 * s if links else breite - rand - LUFT * s

        if e['route'] == 'korridor':
            # Waagerecht zur Gasse links neben der Liste, dort senkrecht auf
            # die Hoehe des Kastens, dann hinein.
            punkte = [(satz_ende, mitte_satz), (gasse_links, mitte_satz),
                      (gasse_links, mitte_kasten), (kasten[0], mitte_kasten)]
        elif e['route'] == 'spalt':
            # Aus dem Kasten in die Luecke zwischen Liste und Fenster, dort
            # senkrecht in das leere Feld oben, dann hinaus zum Satz.
            punkte = [(kasten[2], mitte_kasten), (gasse_spalt, mitte_kasten),
                      (gasse_spalt, mitte_satz), (satz_ende, mitte_satz)]
        else:
            punkte = [(kasten[2], mitte_kasten), (satz_ende, mitte_satz)]

        d.line(punkte, fill=ROT, width=max(1, s), joint='curve')

    ziel = pathlib.Path(plan['ziel'])
    blatt.convert('RGB').save(ziel)
    print(f'  {ziel.name}  {blatt.width}x{blatt.height}')


if __name__ == '__main__':
    main(sys.argv[1])
