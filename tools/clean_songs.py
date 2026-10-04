#!/usr/bin/env python3
"""Raeumt doppelte Songs aus einer fertigen songs.json.

Aufruf:  python3 tools/clean_songs.py [pfad]   (Vorgabe: data/songs.json)
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dedupe import merge_duplicates
from artistids import ensure_ids

# Apple liefert Genres in der Sprache des Stores. songs.json nutzt die
# deutschen (und ein paar US-) Namen; was aus einem anderen Store kam
# (add_regional.py, wenn der deutsche nichts hatte), wird hier umbenannt -
# sonst stuende „Pop en español" im Genremodus neben „Pop auf Spanisch",
# und der Sprachfilter kennte das Genre nicht.
GENRE_DE = {
    'Música latina': 'Latin', 'Musica latina': 'Latin', 'Latina': 'Latin',
    'Pop en español': 'Pop auf Spanisch', 'Pop latino': 'Pop auf Spanisch',
    'Urbano latino': 'Latin Urban', 'Alternativa': 'Alternative',
    'Alternativa y rock en español': 'Alternative und Latin-Rock',
    'Hip-hop/Rap': 'Hip-Hop/Rap', 'Hiphop/Rap': 'Hip-Hop/Rap', 'Rap/Hip-Hop': 'Hip-Hop/Rap',
    'Indie Rock': 'Indie-Rock', 'Afro\xa0pop': 'Afrobeats', 'Afro pop': 'Afrobeats',
    'Variété française': 'Französischer Pop', 'Variété internationale': 'Pop',
    'Rap français': 'Hip-Hop/Rap', 'Musique africaine': 'Afrobeats',
    'Musica italiana': 'Italienischer Pop', 'Pop italiano': 'Italienischer Pop',
    'Nederlandstalig': 'Pop', 'Electrónica': 'Electronic', 'Électronique': 'Electronic',
    'Elettronica': 'Electronic', 'Rock alternativo': 'Alternative',
}


def german_genres(songs):
    n = 0
    for s in songs:
        neu = GENRE_DE.get(s.get('g'))
        if neu:
            s['g'] = neu
            n += 1
    return n


path = sys.argv[1] if len(sys.argv) > 1 else 'data/songs.json'
data = json.load(open(path, encoding='utf-8'))

before = len(data['songs'])
renamed = german_genres(data['songs'])
if renamed:
    print(f'  {renamed} Genres auf die deutschen Namen umgestellt')
fixed = ensure_ids(data)          # Songs ohne Kuenstler-IDs nachtragen
if fixed:
    print(f'  {fixed} Songs ohne Künstler-IDs ergänzt')
data['songs'], merged = merge_duplicates(data['songs'])
data['songs'].sort(key=lambda x: -x.get('s', 0))

for t, a in merged:
    print(f'  zusammengefuehrt: {t} — {a}')
print(f'{before} Songs -> {len(data["songs"])}')

if merged or fixed or renamed:
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('geschrieben:', path)
