#!/usr/bin/env python3
"""Wie bekannt ist ein Song in einem Land? Spotify-Streams je Land.

Die Bekanntheit in songs.json haengt an weltweiten Streams (kworb, Spotify
all-time). Damit stehen Bad Bunny und Arijit Singh weit oben, obwohl man sie
hier kaum kennt. kworb fuehrt dieselben Zahlen auch je Land: die Summen der
Wochencharts (alle Streams, die ein Song in seinen Wochen in den Top 200
dieses Landes gesammelt hat). Dieses Skript holt diese Seiten fuer REGIONS,
ordnet sie den Songs zu und schreibt sie als `rc` in data/songs.json:

    "rc": {"de": 100812345, "us": 380000000}

Gebraucht wird das zweimal im Frontend: der Modus „Laender-Charts" spielt nur,
was in einem Land lief, und stuft nach den Streams dort; der Sprachfilter
laesst fremdsprachige Songs drin, die in einem Land bekannt sind
(Filters.knownIn). Die Grenze dafuer steht je Land in `known`: so viele
Plaetze tief, wie in Deutschland DE_HIT reicht (10 Mio.) - in den USA ist
das eine hoehere Zahl, in Oesterreich eine kleinere, gemeint ist dasselbe.

    python3 tools/fetch_regions.py             # holen, zuordnen, schreiben
    python3 tools/fetch_regions.py --selftest  # nur Parser und Zuordnung pruefen
    python3 tools/fetch_regions.py --dump      # die ersten Zeilen je Seite zeigen

Eine Anfrage je Land, mit Cache (1 Tag). Ein Land, dessen Seite nicht kommt
oder fremd aussieht, behaelt seine alten Zahlen - lieber gestern als leer.
Kommt kein einziges Land, bleibt die Datei unveraendert.
"""

import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_kworb import BASE, cells, get, num  # noqa: E402

SONGS = 'data/songs.json'
# Reihenfolge = Reihenfolge im Frontend (Filters.REGIONS).
REGIONS = ['de', 'at', 'ch', 'us', 'gb', 'fr', 'es', 'it', 'nl']
MIN_ROWS = 300       # weniger heisst: kworb hat die Tabelle umgebaut
MIN_MATCHED = 100    # weniger heisst: die Zuordnung ist kaputt
DE_HIT = 1e7         # wie Filters.DE_HIT - daraus die Grenze je Land


def pages(cc):
    return [(f'country/{cc}_weekly_totals.html', f'kworb_{cc}_weekly_totals.html'),
            (f'country/{cc}_daily_totals.html', f'kworb_{cc}_daily_totals.html')]


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
    """[(kuenstler, titel, streams)] aus einer Summen-Tabelle, groesste zuerst.

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
    out.sort(key=lambda r: -r[2])
    return out


def load_rows(cc, dump=False):
    """Zeilen eines Landes, oder [] wenn keine Seite taugt."""
    for pfad, name in pages(cc):
        try:
            page = get(BASE + pfad, name, max_age_days=1)
        except Exception as e:  # noqa: BLE001 - jede Panne heisst: naechste Seite
            print(f'{pfad}: nicht geladen ({e})')
            continue
        if dump:
            for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S)[:6]:
                print(cells(row))
        rows = parse_totals(page)
        print(f'{pfad}: {len(rows)} Zeilen')
        if len(rows) >= MIN_ROWS:
            return rows
    return []


class Index:
    """Songs nach Grundtitel, mit allen Kuenstlernamen - fuer die Zuordnung
    und fuer add_regional.py, das wissen will, was schon da ist."""

    def __init__(self, data):
        self.songs, self.artists = data['songs'], data.get('artists', [])
        self.by_title = {}
        for i, s in enumerate(self.songs):
            self.by_title.setdefault(base(s.get('t')), []).append(i)
        self.wer = {}

    def add(self, i):
        self.by_title.setdefault(base(self.songs[i].get('t')), []).append(i)

    def von(self, i):
        if i not in self.wer:
            s = self.songs[i]
            n = names(s.get('a', ''))
            for a in s.get('ar') or []:
                if 0 <= a < len(self.artists):
                    n |= names(self.artists[a])
            self.wer[i] = n
        return self.wer[i]

    def find(self, artist, title):
        lead = names(artist)
        return [i for i in self.by_title.get(base(title), []) if lead & self.von(i)]


def match(rows, data, index=None):
    """Summiert je Song, was kworb unter seinem Grundtitel und einem seiner
    Kuenstler fuehrt - Remix und Original zaehlen zusammen."""
    index = index or Index(data)
    summe, treffer = {}, 0
    for artist, title, streams in rows:
        hit = index.find(artist, title)
        if not hit:
            continue
        treffer += 1
        for i in hit:
            summe[i] = summe.get(i, 0) + streams
    return summe, treffer


def known_limits(all_rows, old):
    """Grenze fuer „bekannt" je Land: der Platz, den DE_HIT in Deutschland
    erreicht, in jedem Land gleich tief. Ohne deutsche Zeilen bleibt alles
    beim Alten."""
    out = dict(old or {})
    de = all_rows.get('de')
    if not de:
        return out
    platz = max(1, sum(1 for r in de if r[2] >= DE_HIT))
    for cc, rows in all_rows.items():
        if rows:
            out[cc] = rows[min(platz, len(rows)) - 1][2]
    out['de'] = int(DE_HIT)
    return out


def apply(data, all_rows):
    """Schreibt rc fuer jedes Land, das Zeilen hat; die anderen bleiben."""
    index = Index(data)
    stats = {}
    for cc, rows in all_rows.items():
        if not rows:
            continue
        summe, treffer = match(rows, data, index)
        if len(summe) < MIN_MATCHED:
            print(f'{cc}: nur {len(summe)} Songs zugeordnet - Land bleibt beim alten Stand')
            continue
        for i, s in enumerate(data['songs']):
            rc = s.get('rc') or {}
            if i in summe:
                rc[cc] = summe[i]
            else:
                rc.pop(cc, None)
            if rc:
                s['rc'] = rc
            else:
                s.pop('rc', None)
        stats[cc] = (len(rows), treffer, len(summe))
    return stats


def migrate_de(data):
    """Das alte Feld `de` (nur Deutschland) wandert nach rc.de."""
    for s in data['songs']:
        if 'de' in s:
            v = s.pop('de')
            if v:
                s.setdefault('rc', {})['de'] = v


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
    global MIN_MATCHED
    rows = parse_totals(SAMPLE)
    assert rows[0] == ('Luis Fonsi', 'Despacito (w/ Daddy Yankee)', 210345678), rows[0]
    assert len(rows) == 4 and rows[-1][2] == 100000, rows
    data = {'artists': ['Luis Fonsi', 'Daddy Yankee', 'Bad Bunny', 'Bomba Estéreo'],
            'songs': [{'t': 'Despacito', 'a': 'Luis Fonsi & Daddy Yankee', 'ar': [0, 1], 'de': 5},
                      {'t': 'Ojitos Lindos', 'a': 'Bad Bunny & Bomba Estéreo', 'ar': [2, 3], 'rc': {'us': 7}},
                      {'t': 'Despacito', 'a': 'Jemand Anders', 'ar': []}]}
    summe, treffer = match(rows, data)
    assert summe == {0: 270345678, 1: 8500000}, summe
    assert treffer == 3, treffer
    migrate_de(data)
    assert data['songs'][0]['rc'] == {'de': 5} and 'de' not in data['songs'][0], data['songs'][0]
    MIN_MATCHED, alt = 1, MIN_MATCHED
    try:
        stats = apply(data, {'de': rows, 'at': []})
    finally:
        MIN_MATCHED = alt
    assert data['songs'][0]['rc'] == {'de': 270345678}, data['songs'][0]
    assert data['songs'][1]['rc'] == {'us': 7, 'de': 8500000}, 'ein Land ohne Zeilen laesst die anderen stehen'
    assert 'rc' not in data['songs'][2], data['songs'][2]
    assert list(stats) == ['de'], stats
    # Grenze je Land: so tief wie DE_HIT in Deutschland
    lim = known_limits({'de': [('a', 'x', 3e7), ('b', 'y', 2e7), ('c', 'z', 5e6)],
                        'at': [('a', 'x', 4e6), ('b', 'y', 3e6), ('c', 'z', 1e6)], 'us': []}, {'us': 9})
    assert lim == {'de': 1e7, 'at': 3e6, 'us': 9}, lim
    print('Parser in Ordnung:', [r[1] for r in rows])


def main():
    if '--selftest' in sys.argv:
        selftest()
        return
    dump = '--dump' in sys.argv
    all_rows = {cc: load_rows(cc, dump) for cc in REGIONS}
    if not any(all_rows.values()):
        sys.exit('Kein Land geladen - songs.json bleibt unveraendert.')

    data = json.load(open(SONGS, encoding='utf-8'))
    migrate_de(data)
    stats = apply(data, all_rows)
    if not stats:
        sys.exit('Kein Land zugeordnet - songs.json bleibt unveraendert.')
    data['known'] = {k: int(v) for k, v in known_limits(
        {cc: all_rows[cc] for cc in stats}, data.get('known')).items()}
    json.dump(data, open(SONGS, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    for cc in REGIONS:
        if cc in stats:
            z, t, n = stats[cc]
            print(f'{cc}: {z} Zeilen, {t} zugeordnet, {n} Songs, bekannt ab {data["known"].get(cc, 0) / 1e6:.1f} Mio.')
        else:
            print(f'{cc}: alter Stand')
    # Zum Einstellen der Grenze im Frontend (DE_HIT): wie viel haben die
    # Songs aus fremdsprachigen Genres in Deutschland?
    fremd = re.compile(r'latin|spanisch|mexiko|salsa|k-pop|bollywood|sertanejo|brasil|tamil|indisch', re.I)
    de = lambda s: (s.get('rc') or {}).get('de', 0)  # noqa: E731
    liste = sorted(((de(s), s['t'], s['a'], s.get('g', '')) for s in data['songs']
                    if fremd.search(s.get('g', ''))), reverse=True)
    print('Fremdsprachige Genres, Streams in Deutschland (Mio.):')
    for v, t, a, g in liste[:40]:
        print(f'  {v / 1e6:8.1f}  {t[:40]:40}  {a[:28]:28}  {g}')


if __name__ == '__main__':
    main()
