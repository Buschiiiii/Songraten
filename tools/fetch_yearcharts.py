#!/usr/bin/env python3
"""Jahrescharts von Wikipedia holen - die Songquelle fuer alte Jahrzehnte.

Warum ueberhaupt: songs.json haengt an Spotify-Streams (kworb), und Spotify
gibt es erst seit 2008. Ein Welthit von 1985 hat dort weniger Streams als ein
mittelmaessiger Song von 2021 und faellt deshalb komplett durch - "Africa",
"Take On Me" oder "Hotel California" stehen gar nicht erst im Bestand. Die
Billboard-Jahrescharts kennen dieses Problem nicht: Platz 7 im Jahr 1985 ist
Platz 7 im Jahr 1985, fuer immer.

Geholt wird das gerenderte HTML der Wikipedia-Seiten (einheitlicher als
Wikitext), eine Anfrage pro Jahr, mit Cache. Wikipedia will einen sprechenden
User-Agent und keine Dauerfeuer-Anfragen, deshalb eine Sekunde Pause.

    python3 tools/fetch_yearcharts.py                # 1959 bis heute
    python3 tools/fetch_yearcharts.py 1980 1989      # nur die 80er
    python3 tools/fetch_yearcharts.py --selftest     # nur den Parser pruefen

Ergebnis: yearcharts.json  [{"year":1985,"rank":7,"title":"...","artist":"..."}]
"""

import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

CACHE = '.cache/yearcharts'
OUT = 'data/yearcharts.json'
UA = {'User-Agent': 'Songraten/1.0 (statisches Songratespiel; Kontakt ueber GitHub)'}
API = 'https://en.wikipedia.org/w/api.php'

# Bis 1958 hiess die Liste anders und ist nicht einheitlich aufgebaut.
FIRST_YEAR = 1959


def page_for(year):
    return f'Billboard_Year-End_Hot_100_singles_of_{year}'


def strip(cell):
    """HTML-Zelle -> reiner Text, ohne Fussnoten und Verweise."""
    cell = re.sub(r'<sup.*?</sup>', '', cell, flags=re.S)
    cell = re.sub(r'<style.*?</style>', '', cell, flags=re.S)
    cell = re.sub(r'<.*?>', '', cell, flags=re.S)
    cell = html.unescape(cell)
    cell = cell.replace(' ', ' ').replace('​', '')
    cell = re.sub(r'\[\d+\]', '', cell)
    return re.sub(r'\s+', ' ', cell).strip()


def parse_rows(page_html):
    """Liest Rang, Titel und Kuenstler aus der Jahrestabelle.

    Die Tabellen sehen ueber die Jahrzehnte leicht verschieden aus (mal steht
    der Rang in einer Kopfzelle, mal in einer normalen), gemeinsam ist ihnen:
    erste Zelle eine Zahl, danach der Titel in Anfuehrungszeichen, danach der
    Kuenstler. Genau daran haengt sich der Parser auf - nicht an der Reihenfolge
    der Spalten oder an einer Tabellenklasse.
    """
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page_html, re.S):
        cells = [strip(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]
        cells = [c for c in cells if c != '']
        if len(cells) < 3:
            continue
        if not re.fullmatch(r'\d{1,3}', cells[0]):
            continue
        rank = int(cells[0])
        if not 1 <= rank <= 100:
            continue
        title = cells[1].strip()
        m = re.fullmatch(r'["“’\'](.+?)["”’\']', title)
        if not m:
            continue
        artist = cells[2].strip()
        if not artist:
            continue
        out.append({'rank': rank, 'title': m.group(1).strip(), 'artist': artist})
    return out


def fetch(year):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{year}.html')
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()

    url = API + '?' + urllib.parse.urlencode({
        'action': 'parse', 'page': page_for(year), 'prop': 'text',
        'format': 'json', 'formatversion': '2', 'redirects': '1',
    })
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if 'error' in data:
        raise LookupError(data['error'].get('info', 'Seite fehlt'))
    text = data['parse']['text']
    open(path, 'w', encoding='utf-8').write(text)
    time.sleep(1.0)
    return text


SAMPLE = '''
<table class="wikitable sortable">
<tr><th>No.</th><th>Title</th><th>Artist(s)</th></tr>
<tr><th scope="row">1</th><td>"<a href="/wiki/Physical">Physical</a>"</td>
    <td><a href="/wiki/Olivia_Newton-John">Olivia Newton-John</a></td></tr>
<tr><td>2</td><td>"Eye of the Tiger"<sup class="reference">[1]</sup></td>
    <td>Survivor</td></tr>
<tr><td>3</td><td>"Ebony and Ivory"</td>
    <td>Paul McCartney&#160;and&#160;Stevie Wonder</td></tr>
<tr><td colspan="3">Zwischenueberschrift</td></tr>
</table>
'''


def selftest():
    rows = parse_rows(SAMPLE)
    want = [(1, 'Physical', 'Olivia Newton-John'),
            (2, 'Eye of the Tiger', 'Survivor'),
            (3, 'Ebony and Ivory', 'Paul McCartney and Stevie Wonder')]
    got = [(r['rank'], r['title'], r['artist']) for r in rows]
    assert got == want, f'Parser liefert {got}'
    print('Parser in Ordnung:', got)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--selftest' in sys.argv:
        selftest()
        sys.exit(0)

    lo = int(args[0]) if args else FIRST_YEAR
    hi = int(args[1]) if len(args) > 1 else time.localtime().tm_year
    all_rows = []
    if os.path.exists(OUT):
        all_rows = json.load(open(OUT, encoding='utf-8'))
    have = {r['year'] for r in all_rows}

    for year in range(lo, hi + 1):
        if year in have:
            continue
        try:
            rows = parse_rows(fetch(year))
        except Exception as e:
            print(f'  {year}: {e}', flush=True)
            continue
        if len(rows) < 20:
            print(f'  {year}: nur {len(rows)} Zeilen erkannt - uebersprungen', flush=True)
            continue
        for r in rows:
            r['year'] = year
        all_rows += rows
        print(f'  {year}: {len(rows)} Songs', flush=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    all_rows.sort(key=lambda r: (r['year'], r['rank']))
    json.dump(all_rows, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    years = sorted({r['year'] for r in all_rows})
    print(f'\n{OUT}: {len(all_rows)} Songs aus {len(years)} Jahren'
          + (f' ({years[0]}-{years[-1]})' if years else ''))
