#!/usr/bin/env python3
"""Hits, die in songs.json als Cover stehen, gegen das Original tauschen.

match_local.py ordnet kworbs Streamzahlen Titeln aus Apples Kuenstlerkatalogen
zu. Bei manchen Kuenstlern lieferte der Katalog als ersten Treffer eine
Schlaflied-, Klavier- oder 8-Bit-Fassung („Lullaby Versions of Tyler, The
Creator", „Piano Tribute to Frank Ocean"). So stand „See You Again" mit 3,1
Mrd. Streams als Spieluhr im Pool - versteckt nur, weil der Instrumental-
Filter Schlaflieder aussortiert. Gefunden am 4. Oktober: 32 Songs.

Erkannt wird ein Cover am Album oder Titel (COVER) und daran, dass unter den
Kuenstler-IDs noch ein anderer Name steht als der der Cover-Band - das ist
der echte Kuenstler. Fuer ihn wird der Grundtitel im deutschen Store gesucht;
nur ein Treffer, der selbst kein Cover ist und dessen Kuenstler passt, ersetzt
Titel, Kuenstler, Album, Preview, Cover, Track-ID und Genre. Streams, Stufe
und Laenderzahlen bleiben, die Cover-Band fliegt aus den Kuenstler-IDs.

    python3 tools/fix_covers.py 300         # 300 Sekunden lang suchen
    python3 tools/fix_covers.py --selftest  # nur Erkennung und Auswahl pruefen

Cache pro Song (.cache/cover_lookup.json), geschrieben wird erst am Ende.
"""

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_decades import MIN_SCORE, PAUSE, lookup, norm, score  # noqa: E402
from fetch_regions import base, names  # noqa: E402

SONGS = 'data/songs.json'
CACHE = '.cache/cover_lookup.json'
COVER = re.compile(r'(lullaby (versions?|renditions?|tribute)|lullabies for|piano (rendition|tribute|version)|'
                   r'\btribute\)|8-bit|originally (performed )?by|karaoke|in the style of|made famous)', re.I)


def is_cover(s, artists):
    """[echte Kuenstlernamen] oder None."""
    if not COVER.search(' '.join([s.get('t', ''), s.get('al', ''), s.get('a', '')])):
        return None
    band = names(s.get('a', ''))
    echt = [artists[i] for i in s.get('ar') or [] if 0 <= i < len(artists) and not (names(artists[i]) & band)]
    return echt or None


def clean_title(title):
    """„Gata Only (Piano rendition of …)" -> „Gata Only"."""
    return re.sub(r'\s*[(\[][^)\]]*\b(rendition|tribute|8-bit|originally|karaoke|lullaby)\b[^)\]]*[)\]]', '',
                  title or '', flags=re.I).strip() or title


def pick(hits, title, echt):
    """Bester Treffer, der kein Cover ist und vom echten Kuenstler stammt."""
    wer = set()
    for n in echt:
        wer |= names(n)
    best, bs = None, 0.0
    for h in hits or []:
        if COVER.search(' '.join([h.get('trackName') or '', h.get('collectionName') or '', h.get('artistName') or ''])):
            continue
        if not (names(h.get('artistName') or '') & wer):
            continue
        v = score(h, title, ' & '.join(echt))
        if v > bs:
            best, bs = h, v
    return best if bs >= MIN_SCORE else None


def apply(s, hit, artists):
    band = names(s.get('a', ''))
    s['t'], s['a'] = hit['trackName'], hit['artistName']
    s['al'] = hit.get('collectionName') or ''
    s['p'] = hit['previewUrl']
    s['c'] = hit.get('artworkUrl100') or s.get('c', '')
    if hit.get('trackId'):
        s['k'] = hit['trackId']
    if hit.get('primaryGenreName'):
        s['g'] = hit['primaryGenreName']
    jahr = int((hit.get('releaseDate') or '0')[:4] or 0)
    if jahr and (not s.get('y') or abs(jahr - s['y']) <= 3):
        s['y'] = jahr
    s['ar'] = [i for i in s.get('ar') or [] if not (0 <= i < len(artists) and names(artists[i]) & band)]


SAMPLE_ARTISTS = ['Twinkle Twinkle Little Rock Star', 'Tyler, The Creator', 'Avril Lavigne']


def selftest():
    a = SAMPLE_ARTISTS
    cover = {'t': 'See You Again', 'a': 'Twinkle Twinkle Little Rock Star', 'ar': [0, 1],
             'al': 'Lullaby Versions of Tyler, The Creator', 's': 3134000000, 'd': 'easy', 'y': 2017,
             'rc': {'de': 5}, 'p': 'alt'}
    echt = {'t': 'What the Hell', 'a': 'Avril Lavigne', 'ar': [2], 'al': 'Goodbye Lullaby (Expanded Edition)'}
    assert is_cover(cover, a) == ['Tyler, The Creator'], is_cover(cover, a)
    assert is_cover(echt, a) is None, 'Goodbye Lullaby ist ein echtes Album'
    assert clean_title('Gata Only (Piano rendition of Cris MJ)') == 'Gata Only'
    assert clean_title('Moonlight (XXXTENTACION tribute)') == 'Moonlight'
    hits = [{'trackName': 'See You Again', 'artistName': 'Twinkle Twinkle Little Rock Star',
             'collectionName': 'Lullaby Versions of Tyler, The Creator', 'previewUrl': 'x'},
            {'trackName': 'See You Again (feat. Kali Uchis)', 'artistName': 'Tyler, The Creator',
             'collectionName': 'Flower Boy', 'previewUrl': 'echt', 'trackId': 7, 'releaseDate': '2017-07-21',
             'primaryGenreName': 'Hip-Hop/Rap'}]
    assert pick(hits, 'See You Again', ['Kali Uchis', 'Tyler, The Creator']), 'Gast vorn, Treffer trotzdem'
    hit = pick(hits, 'See You Again', ['Tyler, The Creator'])
    assert hit and hit['previewUrl'] == 'echt', hit
    apply(cover, hit, a)
    assert cover['a'] == 'Tyler, The Creator' and cover['p'] == 'echt' and cover['ar'] == [1], cover
    assert cover['s'] == 3134000000 and cover['d'] == 'easy' and cover['rc'] == {'de': 5}, 'Streams bleiben'
    print('Cover-Erkennung in Ordnung')


def main():
    if '--selftest' in sys.argv:
        selftest()
        return
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 300
    data = json.load(open(SONGS, encoding='utf-8'))
    artists = data.get('artists', [])
    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    t0, fixed, missing, asked = time.time(), [], [], 0
    for s in data['songs']:
        echt = is_cover(s, artists)
        if not echt:
            continue
        title = base(clean_title(s.get('t')))
        key = norm(title) + '|' + norm(' & '.join(echt))
        if key not in cache:
            if time.time() - t0 > budget:
                print('Zeitbudget aufgebraucht', flush=True)
                break
            # Bei Duetten steht oft der Gast vorn („Kali Uchis" bei „See You
            # Again") - also mit jedem Beteiligten suchen, bis einer passt.
            hit, kaputt = None, False
            for wer in echt[:3]:
                try:
                    hits = lookup(clean_title(s.get('t')), wer, 'DE')
                    asked += 1
                except Exception as e:  # noqa: BLE001
                    print(f'  Abbruch bei "{s.get("t")}": {e}', flush=True)
                    kaputt = True
                    break
                hit = pick(hits, clean_title(s.get('t')), echt)
                time.sleep(PAUSE)
                if hit:
                    break
            if kaputt:
                break
            cache[key] = {k: hit.get(k) for k in ('trackName', 'artistName', 'collectionName', 'previewUrl',
                                                   'artworkUrl100', 'trackId', 'primaryGenreName',
                                                   'releaseDate')} if hit else None
        if cache[key]:
            alt = f'{s.get("t")} – {s.get("a")}'
            apply(s, cache[key], artists)
            fixed.append(f'{alt}  ->  {s["t"]} – {s["a"]}')
        else:
            missing.append(f'{s.get("t")} – {s.get("a")} (gesucht: {echt[0]})')
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    if fixed:
        json.dump(data, open(SONGS, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(fixed)} Cover gegen das Original getauscht ({asked} Anfragen), {len(missing)} ohne Original:')
    for z in fixed:
        print('  ' + z)
    for z in missing:
        print('  fehlt: ' + z)


if __name__ == '__main__':
    main()
