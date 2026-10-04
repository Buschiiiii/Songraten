#!/usr/bin/env python3
"""Hits einzelner Laender einpflegen, die in songs.json fehlen.

songs.json kommt aus kworbs weltweiter Streamliste. Was nur in einem Land
gross war - deutscher Rap, franzoesischer Pop, Schlager -, steht dort nicht,
und der Modus „Laender-Charts" haette fuer Deutschland nur die Welthits, die
hier auch liefen. Dieses Skript nimmt je Land die obersten TOP_N der
kworb-Wochencharts-Summen (dieselben Seiten wie fetch_regions.py, aus dem
Cache), sucht, was fehlt, bei Apple und haengt die Treffer an - ohne
weltweite Streams und ohne Stufe (`d` leer), wie die Songs aus den
Jahrescharts. Die Streams je Land (`rc`) schreibt danach fetch_regions.py.

    python3 tools/add_regional.py 900         # 900 Sekunden lang suchen
    python3 tools/add_regional.py --selftest  # nur die Auswahl pruefen

Abwechselnd nach Rang ueber alle Laender: wird das Budget knapp, hat jedes
Land wenigstens seine groessten Hits. Cache pro Titel, geschrieben wird erst
am Ende - wie add_decades.py.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_decades import BAD, MIN_SCORE, PAUSE, lookup, norm, score  # noqa: E402
from artistids import ensure_ids  # noqa: E402
from dedupe import merge_duplicates  # noqa: E402
from fame import add_fame  # noqa: E402
from fetch_regions import REGIONS, SPLIT, Index, base, load_rows  # noqa: E402

SONGS = 'data/songs.json'
CACHE = '.cache/region_lookup.json'
TOP_N = 400           # je Land - tiefer kennt man die Songs auch dort kaum
CAP_ARTIST = 15       # je Land, sonst besteht Deutschland aus drei Rappern


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)


def todo_list(all_rows, index):
    """[(land, kuenstler, titel)] - was fehlt, abwechselnd nach Rang."""
    per = {}
    seen = set()
    for cc in REGIONS:
        rows, out, je = all_rows.get(cc) or [], [], {}
        for artist, title, _ in rows[:TOP_N]:
            if BAD.search(title + ' ' + artist):
                continue
            if index.find(artist, title):
                continue
            lead = norm(SPLIT.split(artist)[0])
            key = (base(title), lead)
            if je.get(lead, 0) >= CAP_ARTIST:
                continue
            je[lead] = je.get(lead, 0) + 1
            if key in seen:
                continue           # dasselbe Lied in zwei Laendern: einmal suchen
            seen.add(key)
            out.append((cc, artist, title))
        per[cc] = out
    order = []
    for i in range(max((len(v) for v in per.values()), default=0)):
        for cc in REGIONS:
            if i < len(per.get(cc, [])):
                order.append(per[cc][i])
    return order


def to_song(hit):
    out = {
        't': hit['trackName'], 'a': hit['artistName'],
        'al': hit.get('collectionName') or '',
        'y': int((hit.get('releaseDate') or '0000')[:4] or 0),
        'g': hit.get('primaryGenreName') or '', 's': 0, 'd': '',
        'p': hit['previewUrl'], 'c': hit.get('artworkUrl100') or '',
    }
    if hit.get('trackId'):
        out['k'] = hit['trackId']
    return out


def selftest():
    data = {'artists': ['Luis Fonsi', 'Daddy Yankee'],
            'songs': [{'t': 'Despacito', 'a': 'Luis Fonsi & Daddy Yankee', 'ar': [0, 1]}]}
    rows = {'de': [('Luis Fonsi', 'Despacito (w/ Daddy Yankee)', 9), ('Apache 207', 'Roller', 8),
                   ('Apache 207', 'Komet', 7), ('Party Tyme', 'Roller (Karaoke Version)', 6)],
            'at': [('Apache 207', 'Roller', 5), ('Bilderbuch', 'Maschin', 4)],
            'us': []}
    order = todo_list(rows, Index(data))
    assert order == [('de', 'Apache 207', 'Roller'), ('at', 'Bilderbuch', 'Maschin'),
                     ('de', 'Apache 207', 'Komet')], order
    hit = {'trackName': 'Roller', 'artistName': 'Apache 207', 'releaseDate': '2019-08-02T07:00:00Z',
           'previewUrl': 'x', 'trackId': 5, 'primaryGenreName': 'Hip-Hop/Rap'}
    assert score(hit, 'Roller', 'Apache 207') >= MIN_SCORE
    s = to_song(hit)
    assert s['y'] == 2019 and s['d'] == '' and s['k'] == 5, s
    print('Auswahl in Ordnung')


def main():
    if '--selftest' in sys.argv:
        selftest()
        return
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 600
    all_rows = {cc: load_rows(cc) for cc in REGIONS}
    if not any(all_rows.values()):
        sys.exit('Kein Land geladen - nichts zu tun.')
    data = json.load(open(SONGS, encoding='utf-8'))
    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    index = Index(data)
    todo = todo_list(all_rows, index)
    print(f'{len(todo)} Laender-Hits fehlen in songs.json')

    t0, added, asked, miss = time.time(), {}, 0, 0
    for cc, artist, title in todo:
        if time.time() - t0 > budget:
            print('Zeitbudget aufgebraucht', flush=True)
            break
        key = norm(title) + '|' + norm(artist)
        if key not in cache:
            try:
                hits = None
                for versuch in range(3):
                    try:
                        hits = lookup(title, artist, cc.upper())
                        break
                    except Exception as e:
                        drossel = '403' in str(e) or '429' in str(e)
                        if not drossel or versuch == 2 or time.time() - t0 > budget:
                            raise
                        wait = (60, 180)[versuch]
                        print(f'  Apple bremst, warte {wait}s', flush=True)
                        save_cache(cache)
                        time.sleep(wait)
                best, bs = None, 0.0
                for h in hits or []:
                    v = score(h, title, artist)
                    if v > bs:
                        best, bs = h, v
                cache[key] = to_song(best) if bs >= MIN_SCORE else None
                asked += 1
                if asked % 50 == 0:
                    save_cache(cache)
            except Exception as e:
                print(f'  Abbruch bei "{title}": {e}', flush=True)
                break
            time.sleep(PAUSE)
        song = cache.get(key)
        if not song:
            miss += 1
            continue
        # Apple kann unter anderem Namen liefern, was schon da ist.
        if index.find(song['a'], song['t']):
            continue
        data['songs'].append(dict(song))
        index.add(len(data['songs']) - 1)
        added[cc] = added.get(cc, 0) + 1

    save_cache(cache)
    total = sum(added.values())
    if total:
        ensure_ids(data)
        data['songs'], _ = merge_duplicates(data['songs'])
        add_fame(data['songs'])
        data['v'] = 2
        data['built'] = time.strftime('%Y-%m-%d')
        json.dump(data, open(SONGS, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'+{total} Songs ({asked} Anfragen, {miss} ohne Treffer) - '
          + ', '.join(f'{cc} +{n}' for cc, n in added.items()) + f', jetzt {len(data["songs"])} gesamt')


if __name__ == '__main__':
    main()
