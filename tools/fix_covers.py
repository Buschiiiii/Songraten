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
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_decades import MIN_SCORE, PAUSE, UA, lookup, norm, score  # noqa: E402
from artistids import names_of, norm as anorm  # noqa: E402
from fetch_regions import SPLIT, base, names  # noqa: E402

SONGS = 'data/songs.json'
# v2: der erste Lauf suchte nur ueber die Suche - die verschweigt seit
# September 2025 explizite Titel, und das waren 31 der 32.
CACHE = '.cache/cover_lookup2.json'
# Zweiter Fund (24. Oktober, „Nur Hits"): „Mood (Original by 24kGoldn …)" von
# „Piano Cover by Lily Morgan", Melanie Martinez von „Piano Dreamers Perform
# the Music of …", „Redbone" von „Smooth Jazz All Stars Cover …". Bewusst
# kein nacktes „cover": „Cover Me Up" und „Cover Me In Sunshine" sind echt.
COVER = re.compile(r'(lullaby (versions?|renditions?|tribute)|lullabies for|'
                   r'piano (rendition|tribute|version|covers?)|\btribute\)|\btribute to\b|8-bit|'
                   r'\boriginal(ly)? (performed )?by\b|karaoke|in the style of|made famous|'
                   r'\bcovers? by\b|\b(stars|orchestra|quartet|dreamers) cover\b|\bmis covers\b|'
                   r'\bperform(s|ed)? the (music|songs|hits) of\b|twinkle twinkle|rockabye baby)', re.I)
# Wer im Titel oder Album als Urheber steht: „(Original by 24kGoldn feat.
# iann dior)" - dort fehlte 24kGoldn sogar unter den Kuenstler-IDs.
CREDIT = re.compile(r'(?:original(?:ly)?(?: performed)? by|made famous by|in the style of|'
                    r'the (?:music|songs|hits) of|tribute to)\s+([^()\[\]]+?)\s*(?:[)\]]|\s-\s|$)', re.I)


def credited(s):
    """Namen, die Titel oder Album als Urheber nennen, in Originalschreibung."""
    out = []
    for text in (s.get('t', ''), s.get('al', '')):
        for m in CREDIT.findall(text or ''):
            for teil in SPLIT.split(m):
                teil = teil.strip(' .-')
                # „Performs the Hits of 2018" nennt ein Jahr, keinen Namen.
                if len(teil) > 1 and not teil.isdigit() and teil not in out:
                    out.append(teil)
    return out


def is_cover(s, artists):
    """[echte Kuenstlernamen] oder None - wer im Titel steht, kommt zuerst."""
    if not COVER.search(' '.join([s.get('t', ''), s.get('al', ''), s.get('a', '')])):
        return None
    band = names(s.get('a', ''))
    echt = []
    for n in credited(s) + [artists[i] for i in s.get('ar') or [] if 0 <= i < len(artists)]:
        if not (names(n) & band) and not any(names(n) & names(x) for x in echt):
            echt.append(n)
    return echt or None


def clean_title(title):
    """„Gata Only (Piano rendition of …)" -> „Gata Only", auch wenn die
    Klammer nie zugeht („Mood (Original by 24kGoldn")."""
    return re.sub(r'\s*[(\[][^)\]]*\b(rendition|tribute|8-bit|original(ly)?\s+by|karaoke|lullaby|cover)\b'
                  r'[^)\]]*([)\]]|$)', '', title or '', flags=re.I).strip() or title


# Eine Fassung, die nicht gesucht war, verliert - wie in add_regional.py.
# Erster Lauf mit „Mood": statt „Mood (feat. iann dior)" kam „Mood (Remix)"
# mit Justin Bieber und J Balvin, weil dessen Kuenstlerfeld besser passte.
FASSUNG = re.compile(r'\b(acoustic|live|remix|mix|version|edit|sped up|slowed|remaster(ed)?)\b', re.I)
FELDER = ('trackName', 'artistName', 'collectionName', 'previewUrl', 'artworkUrl100', 'trackId',
          'primaryGenreName', 'releaseDate')


def bewerte(hit, title, artist):
    v = score(hit, title, artist)
    if v and FASSUNG.search(hit.get('trackName') or '') and not FASSUNG.search(title or ''):
        v -= 3
    return v


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
        v = bewerte(h, title, ' & '.join(echt))
        if v > bs:
            best, bs = h, v
    return best if bs >= MIN_SCORE else None


def holen(params, pfad='search'):
    url = f'https://itunes.apple.com/{pfad}?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
        return json.load(r).get('results', [])


def katalog(name, cache):
    """Alle Songs eines Kuenstlers ueber lookup?id= - anders als die Suche
    liefert das auch explizite Titel („See You Again", „The Box"). Zwei
    Anfragen je Kuenstler, gemerkt unter `kuenstler:<name>`."""
    key = 'kuenstler:' + norm(name)
    if key not in cache:
        treffer = holen({'term': name, 'entity': 'musicArtist', 'limit': 5, 'country': 'DE'})
        gleich = [a for a in treffer if norm(a.get('artistName')) == norm(name)] or treffer[:1]
        songs = []
        if gleich and gleich[0].get('artistId'):
            time.sleep(PAUSE)
            songs = [t for t in holen({'id': gleich[0]['artistId'], 'entity': 'song', 'limit': 200, 'country': 'DE'},
                                      'lookup')
                     if t.get('wrapperType') == 'track' and t.get('previewUrl')]
        cache[key] = [{k: t.get(k) for k in FELDER} for t in songs]
        time.sleep(PAUSE)
    return cache[key]


def jahr_of(hit):
    return int((hit.get('releaseDate') or '0')[:4] or 0)


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
    # Das Original ist aelter als sein Cover - das Jahr der Cover-Band
    # („B.Y.O.B." stand bei 2026) zaehlt nicht. Juenger nur knapp, sonst
    # ist es meist ein Remaster.
    jahr = jahr_of(hit)
    if jahr and (not s.get('y') or jahr - s['y'] <= 3):
        s['y'] = jahr
    s['ar'] = [i for i in s.get('ar') or [] if not (0 <= i < len(artists) and names(artists[i]) & band)]
    # Wer das Original singt, braucht eine ID - bei „Mood" fehlte 24kGoldn,
    # nur iann dior stand da. Bekannte Namen bekommen ihre ID; kennt die
    # Liste keinen davon, kommt der Kuenstler als Ganzes neu dazu.
    index = {anorm(n): i for i, n in enumerate(artists)}
    for n in names_of(s):
        i = index.get(anorm(n))
        if i is not None and i not in s['ar']:
            s['ar'].append(i)
    if not any(anorm(n) in index for n in names_of({'a': s['a']})):
        artists.append(s['a'])
        s['ar'].insert(0, len(artists) - 1)


def nachbessern(data, cache, artists):
    """Fruehere Taeusche mit der heutigen Regel pruefen, ohne Anfrage: eine
    Fassung gegen das Original aus den gemerkten Katalogen („Mood (Remix)"),
    und das Jahr des Originals statt des Cover-Jahrs."""
    nach_p = {}
    for s in data['songs']:
        nach_p.setdefault(s.get('p'), s)
    kataloge = {k: v for k, v in cache.items() if k.startswith('kuenstler:') and v}
    out = []
    for key, alt in list(cache.items()):
        if key.startswith('kuenstler:') or not isinstance(alt, dict):
            continue
        s = nach_p.get(alt.get('previewUrl'))
        if not s:
            continue
        titel, hit = key.split('|', 1)[0], alt
        if FASSUNG.search(alt.get('trackName') or '') and not FASSUNG.search(titel):
            echt = [n.strip() for n in SPLIT.split(alt.get('artistName') or '') if n.strip()]
            pool = [t for k, kat in kataloge.items()
                    if k in {'kuenstler:' + norm(n) for n in echt} or any(t.get('previewUrl') == alt['previewUrl']
                                                                          for t in kat)
                    for t in kat]
            neu = pick(pool, titel, echt)
            if neu and neu.get('previewUrl') != alt.get('previewUrl') and not FASSUNG.search(neu.get('trackName') or ''):
                vorher = f'{s["t"]} – {s["a"]}'
                apply(s, neu, artists)
                cache[key] = hit = {k: neu.get(k) for k in FELDER}
                out.append(f'{vorher}  ->  {s["t"]} – {s["a"]}')
        jahr = jahr_of(hit)
        if jahr and s.get('y') and jahr < s['y']:
            out.append(f'{s["t"]} – {s["a"]}: Jahr {s["y"]} -> {jahr}')
            s['y'] = jahr
    return out


SAMPLE_ARTISTS = ['Twinkle Twinkle Little Rock Star', 'Tyler, The Creator', 'Avril Lavigne']


def selftest():
    a = list(SAMPLE_ARTISTS)
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
    # Der Katalog ueber lookup?id= (explizite Titel fehlen in der Suche).
    global holen
    echt_holen = holen
    holen = lambda params, pfad='search': (  # noqa: E731
        [{'artistName': 'Tyler, The Creator', 'artistId': 1}] if params.get('entity') == 'musicArtist'
        else [{'wrapperType': 'artist'},
              {'wrapperType': 'track', 'trackName': 'EARFQUAKE', 'artistName': 'Tyler, The Creator',
               'collectionName': 'IGOR', 'previewUrl': 'igor'}])
    try:
        kat = katalog('Tyler, The Creator', {})
    finally:
        holen = echt_holen
    assert len(kat) == 1 and pick(kat, 'EARFQUAKE', ['Tyler, The Creator'])['previewUrl'] == 'igor', kat
    # Zweiter Fund: der echte Kuenstler steht nur im Titel, die Klammer geht
    # nie zu, und unter den IDs fehlt er.
    arts = ['Piano Cover by Lily Morgan', 'iann dior', 'Morgan Wallen', 'Childish Gambino', 'Smooth Jazz All Stars']
    mood = {'t': 'Mood (Original by 24kGoldn', 'a': 'Piano Cover by Lily Morgan', 'ar': [0, 1],
            'al': 'Mood (Original by 24kGoldn feat. iann dior) - Single', 's': 2208390939, 'd': 'easy'}
    assert is_cover(mood, arts) == ['24kGoldn', 'iann dior'], is_cover(mood, arts)
    assert clean_title(mood['t']) == 'Mood' and clean_title('Without You (Original by The Kid Laroi)') == 'Without You'
    treffer = pick([{'trackName': 'Mood (feat. iann dior)', 'artistName': '24kGoldn', 'collectionName': 'El Dorado',
                     'previewUrl': 'mood', 'trackId': 9}], clean_title(mood['t']), is_cover(mood, arts))
    assert treffer and treffer['previewUrl'] == 'mood', treffer
    apply(mood, treffer, arts)
    assert arts[-1] == '24kGoldn' and sorted(mood['ar']) == [1, len(arts) - 1], (mood['ar'], arts)
    redbone = {'t': 'Redbone', 'a': 'Smooth Jazz All Stars', 'ar': [4, 3],
               'al': 'Smooth Jazz All Stars Cover Childish Gambino'}
    assert is_cover(redbone, arts) == ['Childish Gambino'], is_cover(redbone, arts)
    remix = {'trackName': 'Mood (Remix)', 'artistName': '24kGoldn, Justin Bieber, J Balvin & iann dior',
             'collectionName': 'Mood (Remix) - Single', 'previewUrl': 'remix', 'releaseDate': '2020-11-06'}
    original = {'trackName': 'Mood (feat. iann dior)', 'artistName': '24kGoldn', 'collectionName': 'El Dorado',
                'previewUrl': 'mood', 'releaseDate': '2020-07-24', 'trackId': 9}
    assert pick([remix, original], 'Mood', ['24kGoldn', 'iann dior']) is original, 'Original vor Remix'
    # Ein frueherer Tausch auf die Fassung wird aus dem Cache nachgebessert,
    # ebenso das Jahr der Cover-Band.
    arts2 = ['iann dior', '24kGoldn', 'Justin Bieber', 'J Balvin', 'System Of A Down']
    daten = {'artists': arts2, 'songs': [
        {'t': 'Mood (Remix)', 'a': remix['artistName'], 'ar': [0, 1, 2, 3], 'p': 'remix', 'y': 2020, 's': 2.2e9},
        {'t': 'B.Y.O.B.', 'a': 'System Of A Down', 'ar': [4], 'p': 'byob', 'y': 2026}]}
    zwischen = {'kuenstler:24kgoldn': [remix, original], 'mood|24kgoldn iann dior': remix,
                'b y o b|system of a down': {'trackName': 'B.Y.O.B.', 'artistName': 'System Of A Down',
                                             'previewUrl': 'byob', 'releaseDate': '2005-05-17'}}
    log = nachbessern(daten, zwischen, arts2)
    mood2, byob = daten['songs']
    assert mood2['t'] == 'Mood (feat. iann dior)' and mood2['p'] == 'mood' and sorted(mood2['ar']) == [0, 1], (mood2, log)
    assert zwischen['mood|24kgoldn iann dior']['previewUrl'] == 'mood' and mood2['s'] == 2.2e9
    assert byob['y'] == 2005, byob
    assert nachbessern(daten, zwischen, arts2) == [], 'ein zweiter Lauf aendert nichts'
    for t, al in [('Cover Me Up', 'Cover Me Up - Single'), ('OK', 'Uncovered'), ('Piano Man', 'Piano Man'),
                  ('Undercover Angel (Original 45 Version)', 'Undercover Angel - Single')]:
        assert not COVER.search(t + ' ' + al), t
    print('Cover-Erkennung in Ordnung')


def main():
    if '--selftest' in sys.argv:
        selftest()
        return
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 300
    data = json.load(open(SONGS, encoding='utf-8'))
    artists = data.get('artists', [])
    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    t0, fixed, missing, asked = time.time(), nachbessern(data, cache, artists), [], 0
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
            # Again") - also bei jedem Beteiligten nachsehen, bis einer passt:
            # erst im Katalog (auch Explizites), dann in der Suche.
            hit, kaputt = None, False
            for wer in echt[:3]:
                try:
                    hit = pick(katalog(wer, cache), clean_title(s.get('t')), echt)
                    asked += 2
                    if not hit:
                        hit = pick(lookup(clean_title(s.get('t')), wer, 'DE'), clean_title(s.get('t')), echt)
                        asked += 1
                        time.sleep(PAUSE)
                except Exception as e:  # noqa: BLE001
                    print(f'  Abbruch bei "{s.get("t")}": {e}', flush=True)
                    kaputt = True
                    break
                if hit:
                    break
            if kaputt:
                break
            cache[key] = {k: hit.get(k) for k in FELDER} if hit else None
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
