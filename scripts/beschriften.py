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
WASSER = 46                      # Schriftgroesse des Wasserzeichens
WASSER_DECKUNG = 92              # 0 bis 255 - einmal gesetzt, also kraeftiger

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


def wasserzeichen(bild, text, schrift, mitte_x, mitte_y):
    """Setzt DEMO DATA einmal waagerecht in das leere Feld des Fensters.

    Einmal, gerade, und in die Luecke zwischen der roten Linie und der
    ersten Nachrichtenblase. Der erste Versuch kachelte es schraeg ueber
    das ganze Foto - das kennzeichnet zuverlaessig, legt sich aber auch
    ueber jede Zahl und jede Nachricht, also ueber genau das, was das Bild
    zeigen soll.

    Die Mitte kommt gemessen aus der Seite (siehe gassen in
    vorschau-posteingang-erklaert.mjs) und nicht aus einer Zahl hier: die
    Luecke verschiebt sich mit jeder Nachricht mehr oder weniger im
    Gespraech.
    """
    schicht = Image.new('RGBA', bild.size, (0, 0, 0, 0))
    ImageDraw.Draw(schicht).text(
        (mitte_x, mitte_y), text, font=schrift, anchor='mm',
        fill=(*ROT[:3], WASSER_DECKUNG))
    return Image.alpha_composite(bild, schicht)


def ganz(kasten):
    """Auf ganze Bildpunkte - sonst sind die Linien verschieden stark."""
    return [int(round(v)) for v in kasten]


def main(planpfad):
    plan = json.loads(pathlib.Path(planpfad).read_text())
    s = plan['skala']
    g = plan['gassen']
    foto = Image.open(plan['foto']).convert('RGBA')

    if plan.get('wasserzeichen'):
        # Wohin, sagt der Aufrufer - er hat die Seite vor sich gemessen. Im
        # Posteingang ist das die Luecke zwischen der roten Linie und der
        # obersten Blase, in den Abstimmungen das Blatt unter der letzten
        # Karte. Hier waere jede Zahl eine geratene.
        w = plan['gassen']['wasser']
        # Die Groesse darf der Aufrufer setzen. Auf einem Bildschirmfoto
        # steht das Zeichen in einem leeren Fenster und kann gross sein; auf
        # der Abstimmungskarte ist jeder Zentimeter belegt, dort muss es
        # klein bleiben.
        schrift_w = ImageFont.truetype(MONO, int(w.get('groesse', WASSER) * s))
        if w.get('pruefen'):
            # Nachsehen, ob dort ueberhaupt Platz ist.
            #
            # Auf einem Bildschirmfoto darf das Zeichen ueber einer Blase
            # liegen; auf der Abstimmungskarte ist jede Zeile belegt, und
            # eine Zahl aus Papier und Wasserzeichen ist unlesbar. Die
            # Stelle steht als Anteil der Bildhoehe im Aufrufer - also
            # geraten, nicht gemessen -, und diese Pruefung ist der
            # Ausgleich dafuer: aendert sich die Karte, faellt es hier auf
            # und nicht im fertigen Bild.
            probe = ImageDraw.Draw(foto)
            kasten = probe.textbbox((w['x'] * s, w['y'] * s), plan['wasserzeichen'],
                                    font=schrift_w, anchor='mm')
            luft = int(schrift_w.size * 0.35)
            feld = foto.crop((kasten[0] - luft, kasten[1] - luft,
                              kasten[2] + luft, kasten[3] + luft)).convert('RGB')
            farben = feld.getcolors(feld.width * feld.height) or []
            haeufigste = max(farben)[1] if farben else None
            gleich = sum(n for n, f in farben
                         if all(abs(a - b) <= 4 for a, b in zip(f, haeufigste)))
            anteil = gleich / (feld.width * feld.height)
            if anteil < 0.98:
                sys.exit(f'  An der Stelle fuer das Wasserzeichen steht schon etwas '
                         f'({anteil * 100:.0f} % der Flaeche sind leer, noetig sind 98). '
                         f'Die Stelle im Aufrufer verschieben.')
        foto = wasserzeichen(foto, plan['wasserzeichen'], schrift_w,
                             w['x'] * s, w['y'] * s)

    # Der Rand ist die Spalte fuer die Saetze. Ein Bild ohne Beschriftung -
    # eines, das nur das Wasserzeichen bekommt - braucht ihn nicht und sagt
    # das mit rand: 0.
    rand = plan.get('rand', RAND) * s
    breite = foto.width + 2 * rand
    blatt = Image.new('RGBA', (breite, foto.height), GRUND)
    blatt.paste(foto, (rand, 0))
    d = ImageDraw.Draw(blatt)

    schrift = ImageFont.truetype(MONO, SCHRIFT * s)
    zeilenhoehe = int(SCHRIFT * s * 1.45)
    textbreite = rand - 2 * AUSSEN * s - 2 * POLSTER * s

    gasse_links = int(rand + g.get('links', 0) * s)
    gasse_spalt = int(rand + g.get('spalt', 0) * s)
    # Die rechte Gasse gibt es nur, wo rechts ueberhaupt Platz ist - im
    # Posteingang laeuft die eine rechte Linie durch die Luecke zwischen
    # Liste und Fenster, in den Abstimmungen neben der Karte.
    gasse_rechts = int(rand + g.get('rechts', g.get('spalt', 0)) * s)
    strich = int(STRICH * s)

    # Erst rechnen, dann zeichnen: die Satzkaesten der linken Spalte werden
    # gestapelt, und wo einer den naechsten stossen wuerde, ruecken beide
    # auseinander.
    gesetzt = []
    unterkante = {'links': 0, 'rechts': 0}
    for e in plan['beschriftung']:
        k = plan['kaesten'][e['schluessel']]
        kasten = ganz([
            rand + k['x'] * s - LUFT * s, k['y'] * s - LUFT * s,
            rand + (k['x'] + k['w']) * s + LUFT * s, (k['y'] + k['h']) * s + LUFT * s,
        ])
        zeilen = umbrechen(e['text'], schrift, textbreite)
        hoehe = len(zeilen) * zeilenhoehe + 2 * POLSTER * s
        mitte_kasten = (kasten[1] + kasten[3]) / 2

        oben = (g['frei'] * s if e['route'] == 'spalt' else mitte_kasten) - hoehe / 2  # noqa: E501
        # Gestapelt wird je Seite: zwei Saetze uebereinander sind unlesbar,
        # und das faellt sonst erst im fertigen Bild auf.
        if e['route'] != 'spalt':
            oben = max(oben, unterkante[e['seite']] + ABSTAND * s)
            unterkante[e['seite']] = oben + hoehe

        links = e['seite'] == 'links'
        x0 = AUSSEN * s if links else breite - rand + AUSSEN * s
        satzkasten = ganz([x0, oben, x0 + rand - 2 * AUSSEN * s, oben + hoehe])
        gesetzt.append((e, kasten, satzkasten, zeilen))

    # Erst alle Linien rechnen, dann pruefen, dann zeichnen.
    #
    # Zwei Linien, die sich kreuzen, sehen im fertigen Bild aus wie ein
    # Verteilerkasten: an der Kreuzung weiss niemand mehr, welcher Satz zu
    # welchem Kasten gehoert. Genau das ist passiert - die Linie zur Frist
    # lief quer durch die Karte und schnitt die vom Betrag. Aufgefallen ist
    # es einem Menschen im fertigen Bild, nicht hier; das ist der Grund fuer
    # diesen Block.
    def strecken(e, kasten, satzkasten):
        links = e["seite"] == "links"
        mitte_satz = int((satzkasten[1] + satzkasten[3]) / 2)
        eintritt = int(kasten[1] + (kasten[3] - kasten[1]) * e.get("eintritt", 0.5))
        # Die Linie beginnt AUF der Kante des Satzkastens und endet auf der
        # Kante des Elementkastens - beide Enden beruehren.
        ab = satzkasten[2] if links else satzkasten[0]
        if e["route"] == "korridor":
            # Waagerecht zur Gasse neben der Liste, dort senkrecht auf die
            # Hoehe des Kastens, dann hinein.
            return [(ab, mitte_satz), (gasse_links, mitte_satz),
                    (gasse_links, eintritt), (kasten[0], eintritt)]
        if e["route"] == "rechts":
            # Dasselbe auf der anderen Seite, in der Gasse neben der Karte.
            return [(kasten[2], eintritt), (gasse_rechts, eintritt),
                    (gasse_rechts, mitte_satz), (ab, mitte_satz)]
        if e["route"] == "spalt":
            # Durch die Luecke zwischen Liste und Fenster.
            return [(kasten[2], eintritt), (gasse_spalt, eintritt),
                    (gasse_spalt, mitte_satz), (ab, mitte_satz)]
        return [(kasten[2], eintritt), (ab, mitte_satz)]

    # Zwei Strecken, beide waagerecht oder senkrecht - etwas anderes
    # zeichnet dieses Skript nicht.
    def schneidet(a, b):
        def spanne(x, y, i):
            return (min(x[i], y[i]), max(x[i], y[i]))
        ax, ay = spanne(*a, 0), spanne(*a, 1)
        bx, by = spanne(*b, 0), spanne(*b, 1)
        return (ax[0] <= bx[1] and bx[0] <= ax[1]
                and ay[0] <= by[1] and by[0] <= ay[1])

    linien = [(e["schluessel"], strecken(e, kasten, satzkasten))
              for e, kasten, satzkasten, _ in gesetzt]
    for i, (na, pa) in enumerate(linien):
        for nb, pb in linien[i + 1:]:
            for a in zip(pa, pa[1:]):
                for b in zip(pb, pb[1:]):
                    if schneidet(a, b):
                        sys.exit(f'  Die Linien zu "{na}" und "{nb}" kreuzen sich. '
                                 f'Eine der beiden anders fuehren, oder die zwei '
                                 f'Kaesten zu einem zusammenfassen.')

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

        d.line(strecken(e, kasten, satzkasten), fill=ROT, width=strich, joint='curve')

    ziel = pathlib.Path(plan['ziel'])
    blatt.convert('RGB').save(ziel)
    print(f'  {ziel.name}  {blatt.width}x{blatt.height}')


if __name__ == '__main__':
    main(sys.argv[1])
