#!/usr/bin/env python3
"""Wie bekannt ist ein Song in Deutschland? Spotify-Streams nur aus Deutschland.

Die Bekanntheit in songs.json haengt an weltweiten Streams (kworb, Spotify
all-time). Damit stehen Bad Bunny und Arijit Singh weit oben, obwohl man sie
hier kaum kennt - und Despacito, das hier jeder kennt, sieht genauso aus.
kworb fuehrt dieselben Zahlen auch je Land: die Wochencharts-Summen fuer
Deutschland (alle Streams, die ein Song in seinen Wochen in den deutschen
Top 200 gesammelt hat). Dieses Skript holt die Seite, ordnet sie den Songs zu
und schreibt die Summe als `de` in data/songs.json.

    python3 tools/fetch_de.py             # holen, zuordnen, schreiben
    python3 tools/fetch_de.py --selftest  # nur den Parser pruefen
    python3 tools/fetch_de.py --dump      # die ersten Zeilen der Seite zeigen

Eine Anfrage, mit Cache (3 Tage). Bricht ab, statt eine halbe Zuordnung zu
schreiben, wenn die Tabelle anders aussieht als erwartet. Im Frontend
entscheidet `de` mit, ob ein fremdsprachiger Song als bekannt gilt
(Filters.langOf, DE_HIT).
"""

import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_kworb import BASE, cells, get, num  # noqa: E402

SONGS = 'data/songs.json'
PAGES = [('country/de_weekly_totals.html', 'kworb_de_weekly_totals.html'),
         ('country/de_daily_totals.html', 'kworb_de_daily_totals.html')]
MIN_ROWS = 300       # weniger heisst: kworb hat die Tabelle umgebaut
MIN_MATCHED = 150    # weniger heisst: die Zuordnung ist kaputt


def norm(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


TAIL = re.compile(r'\s+-\s+.*$')
BRACKET = re.compile(r'\s*[(\[][^)\]]*[)\]]\s*$')


def base(title):
    """Grundtitel wie Playlist.base(): ohne „ - 2005 Remaster", ohne
    angehaengte Klammern („(w/ Daddy Yankee)", „(feat. …)")."""
    s = TAIL.sub('', title or '')
    for _ in range(4):
        kurz = BRACKET.sub('', s)
        if kurz == s or not kurz.strip():
            break
        s = kurz
    return norm(s) or norm(title)


SPLIT = re.compile(r'\s*(?:,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bwith\b|/)\s*', re.I)


def names(text):
    out = {norm(text)}
    out.update(norm(x) for x in SPLIT.split(text or ''))
    return {x for x in out if x}


def parse_totals(page):
    """[(kuenstler, titel, streams)] aus einer Summen-Tabelle.

    Bewusst tolerant: die erste Zelle ist „Kuenstler - Titel", die Summe ist
    die groesste Zahl der Zeile (Wochen, Platz und Spitzenwert sind kleiner).
    So uebersteht der Parser eine umgestellte Spaltenfolge."""
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        c = cells(row)
        if len(c) < 2 or ' - ' not in c[0]:
            continue
        artist, title = c[0].split(' - ', 1)
        zahlen = [n for n in (num(x) for x in c[1:]) if n is not None]
        if not zahlen or not artist.strip() or not title.strip():
            continue
        out.append((artist.strip(), title.strip(), max(zahlen)))
    return out


def match(rows, data):
    """Summiert je Song, was kworb unter seinem Grundtitel und einem seiner
    Kuenstler fuehrt - Remix und Original zaehlen zusammen."""
    songs, artists = data['songs'], data.get('artists', [])
    index = {}
    for i, s in enumerate(songs):
        index.setdefault(base(s.get('t')), []).append(i)
    wer = {}

    def von(i):
        if i not in wer:
            s = songs[i]
            n = names(s.get('a', ''))
            for a in s.get('ar') or []:
                if 0 <= a < len(artists):
                    n |= names(artists[a])
            wer[i] = n
        return wer[i]

    summe, treffer = {}, 0
    for artist, title, streams in rows:
        kandidaten = index.get(base(title), [])
        lead = names(artist)
        hit = [i for i in kandidaten if lead & von(i)]
        if not hit:
            continue
        treffer += 1
        for i in hit:
            summe[i] = summe.get(i, 0) + streams
    return summe, treffer


SAMPLE = '''
<table class="sortable"><thead>
<tr><th>Artist and Title</th><th>Wks</th><th>T10</th><th>Pk</th><th>(x?)</th><th>PkStreams</th><th>Total</th></tr>
</thead><tbody>
<tr><td class="text mp"><div><a href="../artist/a.html">Luis Fonsi</a> - <a href="../track/b.html">Despacito (w/ Daddy Yankee)</a></div></td><td>120</td><td>30</td><td>1</td><td>(x12)</td><td>4,100,000</td><td>210,345,678</td></tr>
<tr><td class="text mp"><div><a href="../artist/a.html">Luis Fonsi</a> - <a href="../track/c.html">Despacito - Remix (w/ Daddy Yankee, Justin Bieber)</a></div></td><td>40</td><td>12</td><td>1</td><td></td><td>3,000,000</td><td>60,000,000</td></tr>
<tr><td class="text mp"><div><a href="../artist/d.html">Bad Bunny</a> - <a href="../track/e.html">Ojitos Lindos (w/ Bomba Estéreo)</a></div></td><td>10</td><td>0</td><td>42</td><td></td><td>900,000</td><td>8,500,000</td></tr>
<tr><td class="text mp"><div><a href="../artist/f.html">Niemand</a> - <a href="../track/g.html">Gibts nicht</a></div></td><td>1</td><td>0</td><td>200</td><td></td><td>100,000</td><td>100,000</td></tr>
</tbody></table>
'''


def selftest():
    rows = parse_totals(SAMPLE)
    assert rows[0] == ('Luis Fonsi', 'Despacito (w/ Daddy Yankee)', 210345678), rows[0]
    assert len(rows) == 4, rows
    data = {'artists': ['Luis Fonsi', 'Daddy Yankee', 'Bad Bunny', 'Bomba Estéreo'],
            'songs': [{'t': 'Despacito', 'a': 'Luis Fonsi & Daddy Yankee', 'ar': [0, 1]},
                      {'t': 'Ojitos Lindos', 'a': 'Bad Bunny & Bomba Estéreo', 'ar': [2, 3]},
                      {'t': 'Despacito', 'a': 'Jemand Anders', 'ar': []}]}
    summe, treffer = match(rows, data)
    assert summe == {0: 270345678, 1: 8500000}, summe
    assert treffer == 3, treffer
    print('Parser in Ordnung:', [r[1] for r in rows])


def main():
    if '--selftest' in sys.argv:
        selftest()
        return
    rows, quelle = [], ''
    for pfad, name in PAGES:
        try:
            page = get(BASE + pfad, name, max_age_days=3)
        except Exception as e:  # noqa: BLE001 - jede Panne heisst: naechste Seite
            print(f'{pfad}: nicht geladen ({e})')
            continue
        if '--dump' in sys.argv:
            for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S)[:6]:
                print(cells(row))
        rows = parse_totals(page)
        print(f'{pfad}: {len(rows)} Zeilen')
        if len(rows) >= MIN_ROWS:
            quelle = pfad
            break
    if len(rows) < MIN_ROWS:
        sys.exit(f'Nur {len(rows)} Zeilen erkannt - kworb hat die Tabelle umgebaut? Mit --dump nachsehen. '
                 'songs.json bleibt unveraendert.')

    data = json.load(open(SONGS, encoding='utf-8'))
    summe, treffer = match(rows, data)
    if len(summe) < MIN_MATCHED:
        sys.exit(f'Nur {len(summe)} Songs zugeordnet - da stimmt etwas nicht. songs.json bleibt unveraendert.')

    vorher = sum(1 for s in data['songs'] if s.get('de'))
    for i, s in enumerate(data['songs']):
        if i in summe:
            s['de'] = summe[i]
        else:
            s.pop('de', None)
    json.dump(data, open(SONGS, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    print(f'Quelle {quelle}: {len(rows)} Zeilen, {treffer} zugeordnet, {len(summe)} Songs mit `de` (vorher {vorher})')
    # Zum Einstellen der Grenze im Frontend (DE_HIT): wie viel haben die
    # Songs aus fremdsprachigen Genres in Deutschland?
    fremd = re.compile(r'latin|spanisch|mexiko|salsa|k-pop|bollywood|sertanejo|brasil|tamil|indisch', re.I)
    liste = sorted(((s.get('de') or 0, s['t'], s['a'], s.get('g', '')) for s in data['songs']
                    if fremd.search(s.get('g', ''))), reverse=True)
    print('Fremdsprachige Genres, Streams in Deutschland (Mio.):')
    for de, t, a, g in liste[:80]:
        print(f'  {de / 1e6:8.1f}  {t[:40]:40}  {a[:28]:28}  {g}')
    alle = sorted((s['de'] for s in data['songs'] if s.get('de')), reverse=True)
    for q in (50, 200, 500, 1000, 1500, 2000):
        if q <= len(alle):
            print(f'  Platz {q:5}: {alle[q - 1] / 1e6:.1f} Mio.')


if __name__ == '__main__':
    main()
