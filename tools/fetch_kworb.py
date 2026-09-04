#!/usr/bin/env python3
"""kworb-Streamdaten holen - die Vorstufe fuer den Chartsmodus.

match_local.py braucht vier Dinge, die bisher nur auf dem Rechner lagen, auf
dem die Pipeline einmal lief: artists_top.json, candidates.json und zwei
HTML-Schnappschuesse im .cache. Ohne die laesst sich songs.json nirgends neu
bauen. Dieses Skript erzeugt sie.

    python3 tools/fetch_kworb.py            # Vorgabe: 700 Kuenstler
    python3 tools/fetch_kworb.py 300        # weniger, dafuer schneller
    python3 tools/fetch_kworb.py --selftest # nur die Parser pruefen

Eine Anfrage pro Kuenstlerseite, mit Cache und einer halben Sekunde Pause -
kworb ist eine kleine Seite, die niemand mit Anfragen zuschuetten sollte.

Vorsicht: kworb kann seine Tabellen jederzeit umbauen. Deshalb prueft das
Skript nach jedem Schritt, ob ueberhaupt etwas Sinnvolles herauskam, und
bricht mit einer Meldung ab, statt leere Dateien zu schreiben. `--dump zeigt
die ersten Zeilen einer geladenen Seite, wenn man nachsehen will.
"""

import html
import json
import os
import re
import sys
import time
import urllib.request

BASE = 'https://kworb.net/spotify/'
CACHE = '.cache'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
PAUSE = 0.5
MIN_STREAMS = 1.3e8      # darunter beginnt keine Stufe
DEFAULT_ARTISTS = 700


def get(url, cache_name, max_age_days=7):
    """Laedt eine Seite und legt sie im .cache ab."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age_days * 86400:
        return open(path, encoding='utf-8', errors='replace').read()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode('utf-8', 'replace')
    open(path, 'w', encoding='utf-8').write(text)
    time.sleep(PAUSE)
    return text


def cells(row):
    out = []
    for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S):
        c = re.sub(r'<.*?>', '', c, flags=re.S)
        out.append(html.unescape(c).strip())
    return out


def num(s):
    return int(s.replace(',', '')) if re.fullmatch(r'[\d,]+', s or '') else None


def parse_artists(page):
    """[(id, name, streams)] aus der Kuenstleruebersicht."""
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        m = re.search(r'artist/([A-Za-z0-9]+)_songs\.html', row)
        if not m:
            continue
        c = cells(row)
        name = next((x for x in c if x and num(x) is None), None)
        streams = next((num(x) for x in c if num(x) is not None), None)
        if name:
            out.append((m.group(1), name, streams or 0))
    return out


def parse_songs(page, artist):
    """[(titel, streams)] von einer Kuenstlerseite.

    kworb setzt einen Stern vor Titel, bei denen der Kuenstler nur Gast ist,
    und schreibt dann "Anderer Kuenstler - Titel". Beides wird abgeraeumt."""
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        c = cells(row)
        if len(c) < 2:
            continue
        title = c[0].lstrip('*').strip()
        streams = num(c[1])
        if streams is None or not title or title.lower() in ('song title', 'title'):
            continue
        others = []
        if ' - ' in title:
            lead, title = title.split(' - ', 1)
            others = [lead.strip()]
        out.append((title.strip(), streams, others))
    return out


SAMPLE_ARTISTS = '''
<table class="addpos sortable"><tbody>
<tr><th>Artist</th><th>Streams</th></tr>
<tr><td><a href="artist/06HL4z0CvFAxyc27GXpf02_songs.html">Taylor Swift</a></td><td>123,456,789,012</td></tr>
<tr><td><a href="artist/1Xyo4u8uXC1ZmMpatF05PJ_songs.html">The Weeknd</a></td><td>99,000,000,000</td></tr>
<tr><td>Kein Link</td><td>1,000</td></tr>
</tbody></table>
'''

SAMPLE_SONGS = '''
<table class="addpos sortable"><tbody>
<tr><th>Song Title</th><th>Streams</th><th>Daily</th></tr>
<tr><td><a href="https://open.spotify.com/track/x">Blinding Lights</a></td><td>4,800,000,000</td><td>2,000,000</td></tr>
<tr><td>*Kendrick Lamar - Pray For Me</td><td>1,200,000,000</td><td>500,000</td></tr>
<tr><td>Zu wenig</td><td>1,000</td><td>10</td></tr>
</tbody></table>
'''


def selftest():
    a = parse_artists(SAMPLE_ARTISTS)
    assert [x[1] for x in a] == ['Taylor Swift', 'The Weeknd'], a
    assert a[0][0] == '06HL4z0CvFAxyc27GXpf02' and a[0][2] == 123456789012, a[0]

    s = parse_songs(SAMPLE_SONGS, 'The Weeknd')
    assert s[0] == ('Blinding Lights', 4800000000, []), s[0]
    assert s[1] == ('Pray For Me', 1200000000, ['Kendrick Lamar']), s[1]
    assert len(s) == 3 and s[2][1] == 1000, s
    print('Parser in Ordnung:', [x[0] for x in s])


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest()
        sys.exit(0)

    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    top_n = int(args[0]) if args else DEFAULT_ARTISTS

    print('Kuenstleruebersicht', flush=True)
    page = get(BASE + 'artists.html', 'kworb_artists_html.html')
    if '--dump' in sys.argv:
        print('\n'.join(re.findall(r'<tr[^>]*>.*?</tr>', page, re.S)[:5]))
    artists = parse_artists(page)
    if len(artists) < 100:
        sys.exit(f'nur {len(artists)} Kuenstler erkannt - kworb hat die Tabelle wohl umgebaut. '
                 'Mit --dump nachsehen.')
    artists.sort(key=lambda a: -a[2])
    artists = artists[:top_n]
    print(f'  {len(artists)} Kuenstler', flush=True)

    print('globale Songliste', flush=True)
    get(BASE + 'songs.html', 'kworb_spotify_songs_html.html')

    print('Kuenstlerseiten', flush=True)
    cands, done = [], 0
    for aid, name, _ in artists:
        try:
            p = get(f'{BASE}artist/{aid}_songs.html', f'kworb_artist_{aid}.html')
        except Exception as e:
            print(f'  {name}: {e}', flush=True)
            continue
        for title, streams, others in parse_songs(p, name):
            if streams < MIN_STREAMS:
                continue
            cands.append({'title': title, 'artists': [name] + others, 'streams': streams})
        done += 1
        if done % 50 == 0:
            print(f'  {done}/{len(artists)} · {len(cands)} Kandidaten', flush=True)

    if len(cands) < 500:
        sys.exit(f'nur {len(cands)} Kandidaten - da stimmt etwas nicht, nichts geschrieben.')

    # Derselbe Track steht auf mehreren Kuenstlerseiten; ueber die identische
    # Streamzahl gehoeren die zusammen - daher stammen die Feature-Verweise.
    merged = {}
    for c in cands:
        key = (c['streams'], re.sub(r'[^a-z0-9]+', ' ', c['title'].lower()).strip())
        if key in merged:
            for a in c['artists']:
                if a not in merged[key]['artists']:
                    merged[key]['artists'].append(a)
        else:
            merged[key] = c

    out = sorted(merged.values(), key=lambda c: -c['streams'])
    json.dump([{'name': n} for _, n, _ in artists], open('artists_top.json', 'w'), ensure_ascii=False)
    json.dump(out, open('candidates.json', 'w'), ensure_ascii=False)
    print(f'\nartists_top.json: {len(artists)} Kuenstler')
    print(f'candidates.json:  {len(out)} Songs ab {MIN_STREAMS/1e6:.0f} Mio. Streams')
    print('weiter mit:  python3 tools/fetch_catalogs.py 1800  &&  python3 tools/match_local.py')
