#!/usr/bin/env python3
"""Songs aus den Jahrescharts in eine fertige songs.json einpflegen.

Der Jahrzehntmodus braucht Songs, die es in kworbs Spotify-Streamliste nicht
gibt: "Africa", "Take On Me", "Hotel California" fallen dort durch, weil
Spotify erst seit 2008 mitzaehlt. Dieses Skript geht deshalb den direkten Weg
und fragt fuer jeden Titel der Jahrescharts die iTunes-Suche - unabhaengig von
der kworb-Pipeline, es braucht nur yearcharts.json und die vorhandene
songs.json.

    python3 tools/fetch_yearcharts.py        # zuerst: Jahrescharts holen
    python3 tools/add_decades.py 900         # dann: 900 Sekunden lang suchen
    python3 tools/add_decades.py 900         # ruhig mehrfach, der Cache haelt

Apple drosselt nach einigen hundert Anfragen mit 403. Deshalb das Zeitbudget
als Argument, eine Pause zwischen den Anfragen und ein Cache pro Titel: ein
zweiter Lauf macht dort weiter, wo der erste aufgehoert hat. Geschrieben wird
erst am Ende - ein abgebrochener Lauf laesst songs.json unangetastet.

    python3 tools/add_decades.py --selftest  # nur die Bewertung pruefen
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from artistids import ensure_ids
from dedupe import merge_duplicates
from fame import add_fame

SONGS = 'data/songs.json'
YEARS = 'data/yearcharts.json'
CACHE = '.cache/decade_lookup.json'
PAUSE = 0.26
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
PER_DECADE = 500          # mehr braucht keine Runde, und die Datei bleibt klein
CAP_ARTIST = 12           # sonst besteht ein Jahrzehnt aus einem Kuenstler
MIN_SCORE = 4.0

SPLIT = re.compile(r'\s*(?:&|,|\bfeaturing\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b|/)\s*', re.I)
BAD = re.compile(r'(karaoke|tribute|made popular by|in the style of|instrumental|'
                 r'workout|8-bit|lullaby|cover version|as made famous)', re.I)


def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r'\s*[\(\[].*?[\)\]]\s*', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def score(hit, title, artist):
    """Wie gut passt ein Suchtreffer? Titel zaehlt mehr als Kuenstler, und
    Karaokefassungen fliegen ganz raus - die klingen im Spiel wie ein Fehler."""
    ht, ha = norm(hit.get('trackName')), norm(hit.get('artistName'))
    wt, wa = norm(title), norm(artist)
    if BAD.search((hit.get('trackName') or '') + ' ' + (hit.get('artistName') or '')
                  + ' ' + (hit.get('collectionName') or '')):
        return 0.0
    s = 0.0
    if ht == wt:
        s += 5
    elif ht.startswith(wt) or wt.startswith(ht):
        s += 3
    elif wt in ht or ht in wt:
        s += 2
    else:
        return 0.0
    parts = [norm(p) for p in SPLIT.split(artist) if norm(p)]
    if ha == wa:
        s += 4
    elif any(p and p in ha for p in parts):
        s += 3
    elif ha and (ha in wa or wa in ha):
        s += 2
    else:
        s -= 2
    return s


def lookup(title, artist, country='US'):
    url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode(
        {'term': f'{title} {artist}', 'entity': 'song', 'limit': 12, 'country': country})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return [h for h in json.load(r).get('results', []) if h.get('previewUrl')]


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)


def to_song(hit, row):
    year = int((hit.get('releaseDate') or '0000')[:4] or 0)
    # iTunes gibt bei Neuauflagen gern das Jahr der Wiederveroeffentlichung an.
    if abs(year - row['year']) > 2:
        year = row['year']
    out = {
        't': hit['trackName'], 'a': hit['artistName'],
        'al': hit.get('collectionName') or '', 'y': year,
        'g': hit.get('primaryGenreName') or '', 's': 0, 'r': row['rank'], 'd': '',
        'p': hit['previewUrl'], 'c': hit.get('artworkUrl100') or '',
    }
    # Apples Track-ID: damit zeigt der Sammellink (song.link) auf die richtige
    # Aufnahme statt auf eine Suche.
    if hit.get('trackId'):
        out['k'] = hit['trackId']
    return out


SAMPLE = [
    {'trackName': 'Africa', 'artistName': 'TOTO', 'collectionName': 'Toto IV',
     'releaseDate': '1982-04-08', 'primaryGenreName': 'Rock', 'previewUrl': 'x', 'artworkUrl100': 'y'},
    {'trackName': 'Africa (Karaoke Version)', 'artistName': 'Party Tyme Karaoke',
     'collectionName': 'Karaoke Hits', 'releaseDate': '2010-01-01', 'previewUrl': 'x'},
    {'trackName': 'Africa Unite', 'artistName': 'Bob Marley', 'previewUrl': 'x'},
]


def selftest():
    ranked = sorted(((score(h, 'Africa', 'Toto'), h) for h in SAMPLE), key=lambda x: -x[0])
    assert ranked[0][1]['artistName'] == 'TOTO', ranked
    assert ranked[0][0] >= MIN_SCORE, ranked[0][0]
    assert score(SAMPLE[1], 'Africa', 'Toto') == 0.0, 'Karaoke muss durchfallen'
    assert score(SAMPLE[2], 'Africa', 'Toto') < MIN_SCORE, 'anderer Song, anderer Kuenstler'
    row = {'year': 1982, 'rank': 3}
    assert to_song(SAMPLE[0], row)['y'] == 1982
    assert to_song({**SAMPLE[0], 'releaseDate': '2015-01-01'}, row)['y'] == 1982, 'Neuauflage'
    print('Bewertung in Ordnung')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest()
        sys.exit(0)

    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 600
    rows = json.load(open(YEARS, encoding='utf-8'))
    data = json.load(open(SONGS, encoding='utf-8'))
    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}

    have = {(norm(s['t']), norm(s['a'])) for s in data['songs']}
    per_dec, per_artist = {}, {}
    for s in data['songs']:
        dec = (s.get('y') or 0) // 10 * 10
        per_dec[dec] = per_dec.get(dec, 0) + 1

    # Bester Chartplatz zuerst: wenn das Budget knapp wird, sind wenigstens
    # die bekanntesten Songs jedes Jahrzehnts drin.
    todo = sorted(rows, key=lambda r: (r['rank'], r['year']))
    t0, added, asked, miss = time.time(), 0, 0, 0

    for row in todo:
        if time.time() - t0 > budget:
            print('Zeitbudget aufgebraucht', flush=True)
            break
        dec = row['year'] // 10 * 10
        if per_dec.get(dec, 0) >= PER_DECADE:
            continue
        lead = norm(SPLIT.split(row['artist'])[0])
        if per_artist.get((dec, lead), 0) >= CAP_ARTIST:
            continue
        key = norm(row['title']) + '|' + norm(row['artist'])
        if key in have or (norm(row['title']), lead) in have:
            continue

        hit = cache.get(key)
        if hit is None and key not in cache:
            try:
                hits = None
                for versuch in range(4):
                    try:
                        hits = lookup(row['title'], row['artist'])
                        break
                    except Exception as e:
                        drossel = '403' in str(e) or '429' in str(e)
                        if not drossel or versuch == 2 or time.time() - t0 > budget:
                            raise
                        # Apple macht fuer ein paar Minuten dicht. Einmal warten
                        # lohnt sich, danach lieber aufhoeren und spaeter weiter.
                        # Aus Rechenzentren blockt Apple hart: 60 s reichen
                        # dort nicht, nach der Pause kam sofort wieder 403.
                        wait = (60, 180, 300)[versuch]
                        print(f'  Apple bremst, warte {wait}s', flush=True)
                        save_cache(cache)
                        time.sleep(wait)
                best, bs = None, 0.0
                for h in hits or []:
                    v = score(h, row['title'], row['artist'])
                    if v > bs:
                        best, bs = h, v
                hit = to_song(best, row) if bs >= MIN_SCORE else None
                cache[key] = hit
                asked += 1
                if asked % 50 == 0:
                    save_cache(cache)      # ein Abbruch soll nichts wegwerfen
            except Exception as e:
                print(f'  Abbruch bei "{row["title"]}": {e}', flush=True)
                break
            time.sleep(PAUSE)

        if not hit:
            miss += 1
            continue
        hit = dict(hit, r=row['rank'])
        if abs(hit['y'] - row['year']) > 2:
            hit['y'] = row['year']
        data['songs'].append(hit)
        have.add((norm(hit['t']), norm(hit['a'])))
        per_dec[dec] = per_dec.get(dec, 0) + 1
        per_artist[(dec, lead)] = per_artist.get((dec, lead), 0) + 1
        added += 1

    save_cache(cache)

    if added:
        # Ohne Kuenstler-IDs stolpert das Frontend beim Laden.
        ensure_ids(data)
        data['songs'], merged = merge_duplicates(data['songs'])
        add_fame(data['songs'])
        data['v'] = 2
        json.dump(data, open(SONGS, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    counts = {}
    for s in data['songs']:
        counts[(s.get('y') or 0) // 10 * 10] = counts.get((s.get('y') or 0) // 10 * 10, 0) + 1
    print(f'\n+{added} Songs ({asked} Anfragen, {miss} ohne Treffer), jetzt {len(data["songs"])} gesamt')
    print('je Jahrzehnt: ' + '  '.join(f'{d}er={n}' for d, n in sorted(counts.items())))
