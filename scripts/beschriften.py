#!/usr/bin/env python3
"""
Setzt rote Kaesten und die Saetze daneben.

Bekommt eine Plandatei (JSON) von scripts/vorschau-posteingang-erklaert.mjs:
das rohe Bildschirmfoto, die gemessenen Kaesten in CSS-Punkten, die Skala
und die Saetze. Hier wird nur gezeichnet - gemessen wird im Browser, an den
echten Elementen.

Vier Regeln, alle aus den ersten Versuchen:

  Die Saetze stehen im Rand, nicht auf der Seite. Ein Kasten mit Text auf
  der Oberflaeche verdeckt genau das, was er erklaeren soll.

  Jeder Satz steht in einem Kasten derselben Machart wie der am Element,
  und die Linie beruehrt beide. Ein Satz ohne Rahmen sieht aus wie
  Bildunterschrift, nicht wie Beschriftung.

  Alle Linien sind gleich stark. Deshalb werden die Ecken auf ganze
  Bildpunkte gerundet: eine Kante auf x.5 zeichnet Pillow weich, und
  daneben steht dann ein Kasten, der duenner aussieht als der andere.

  Die Linien laufen durch gemessene Gassen (links neben der Liste, in der
  Luecke zwischen Liste und Fenster) statt quer durchs Bild.

    python3 scripts/beschriften.py preview/artikel/.plan.json
"""
import json
import pathlib
import sys
from PIL import Image, ImageDraw, ImageFont

ROT = (198, 40, 40, 255)
GRUND = (245, 242, 236, 255)     # --bg, damit der Rand dasselbe Blatt ist
RAND = 380                       # Spalte fuer die Saetze, in Punkten
LUFT = 5                         # Abstand des Kastens vom Element - eng
AUSSEN = 26                      # Abstand der Satzkaesten vom Bildrand
POLSTER = 9                      # Luft zwischen Text und seinem Rahmen
STRICH = 2
SCHRIFT = 15
ABSTAND = 18                     # Mindestluft zwischen zwei Satzkaesten

MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'


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


def ganz(kasten):
    """Auf ganze Bildpunkte - sonst sind die Linien verschieden stark."""
    return [int(round(v)) for v in kasten]


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
    zeilenhoehe = int(SCHRIFT * s * 1.45)
    textbreite = rand - 2 * AUSSEN * s - 2 * POLSTER * s

    gasse_links = int(rand + g['links'] * s)
    gasse_spalt = int(rand + g['spalt'] * s)
    strich = int(STRICH * s)

    # Erst rechnen, dann zeichnen: die Satzkaesten der linken Spalte werden
    # gestapelt, und wo einer den naechsten stossen wuerde, ruecken beide
    # auseinander.
    gesetzt = []
    unterkante = 0
    for e in plan['beschriftung']:
        k = plan['kaesten'][e['schluessel']]
        kasten = ganz([
            rand + k['x'] * s - LUFT * s, k['y'] * s - LUFT * s,
            rand + (k['x'] + k['w']) * s + LUFT * s, (k['y'] + k['h']) * s + LUFT * s,
        ])
        zeilen = umbrechen(e['text'], schrift, textbreite)
        hoehe = len(zeilen) * zeilenhoehe + 2 * POLSTER * s
        mitte_kasten = (kasten[1] + kasten[3]) / 2

        oben = (g['frei'] * s if e['route'] == 'spalt' else mitte_kasten) - hoehe / 2
        if e['seite'] == 'links':
            oben = max(oben, unterkante + ABSTAND * s)
            unterkante = oben + hoehe

        links = e['seite'] == 'links'
        x0 = AUSSEN * s if links else breite - rand + AUSSEN * s
        satzkasten = ganz([x0, oben, x0 + rand - 2 * AUSSEN * s, oben + hoehe])
        gesetzt.append((e, kasten, satzkasten, zeilen))

    for e, kasten, satzkasten, zeilen in gesetzt:
        d.rectangle(kasten, outline=ROT, width=strich)
        d.rectangle(satzkasten, outline=ROT, width=strich)
        # Mittig, und zwar nach der TINTE, nicht nach der Zeilenhoehe.
        #
        # Eine Zeile ist 1,45 mal so hoch wie die Schrift; die Buchstaben
        # stehen darin oben, der Rest ist Durchschuss. Wer den Text am
        # oberen Rand plus Polster ansetzt, bekommt deshalb einen Satz, der
        # im Kasten nach oben rutscht - bei einer einzelnen Zeile am
        # deutlichsten, weil dort kein zweiter Satz den Eindruck ausgleicht.
        #
        # Also wird gemessen, wo die Buchstaben wirklich anfangen und
        # aufhoeren, und dieser Block auf die Mitte des Kastens gesetzt.
        kaesten_mitte = (satzkasten[1] + satzkasten[3]) / 2
        oberste = min(i * zeilenhoehe + d.textbbox((0, 0), z, font=schrift)[1]
                      for i, z in enumerate(zeilen))
        unterste = max(i * zeilenhoehe + d.textbbox((0, 0), z, font=schrift)[3]
                       for i, z in enumerate(zeilen))
        start = kaesten_mitte - (oberste + unterste) / 2
        for i, zeile in enumerate(zeilen):
            d.text((satzkasten[0] + POLSTER * s, start + i * zeilenhoehe),
                   zeile, font=schrift, fill=ROT)

        links = e['seite'] == 'links'
        mitte_satz = int((satzkasten[1] + satzkasten[3]) / 2)
        eintritt = kasten[1] + (kasten[3] - kasten[1]) * e.get('eintritt', 0.5)
        eintritt = int(eintritt)
        # Die Linie beginnt AUF der Kante des Satzkastens und endet auf der
        # Kante des Elementkastens - beide Enden beruehren.
        ab = satzkasten[2] if links else satzkasten[0]

        if e['route'] == 'korridor':
            punkte = [(ab, mitte_satz), (gasse_links, mitte_satz),
                      (gasse_links, eintritt), (kasten[0], eintritt)]
        elif e['route'] == 'spalt':
            punkte = [(kasten[2], eintritt), (gasse_spalt, eintritt),
                      (gasse_spalt, mitte_satz), (ab, mitte_satz)]
        else:
            punkte = [(kasten[2], eintritt), (ab, mitte_satz)]

        d.line(punkte, fill=ROT, width=strich, joint='curve')

    ziel = pathlib.Path(plan['ziel'])
    blatt.convert('RGB').save(ziel)
    print(f'  {ziel.name}  {blatt.width}x{blatt.height}')


if __name__ == '__main__':
    main(sys.argv[1])
