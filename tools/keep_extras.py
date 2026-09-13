#!/usr/bin/env python3
"""Rettet die Songs, die `match_local.py` beim Neubau nicht kennt.

Aufruf:  python3 tools/keep_extras.py [alt.json] [neu.json]
         ohne Argumente: HEAD:data/songs.json  ->  data/songs.json

Warum es das braucht: `match_local.py` baut `songs.json` komplett neu, aus
kworb und den Katalogen. Die Songs, die `add_decades.py` ueber Wochen aus den
Jahrescharts dazugeholt hat (erkennbar an leerem `d`: keine Streamzahl, keine
Stufe), stehen dort nicht drin. Sie wieder zu beschaffen kostet je Song eine
Anfrage bei Apple - und Apple drosselt aus GitHubs Rechenzentren so hart, dass
davon in einem Lauf nur ein Bruchteil zurueckkaeme.

Sie stehen aber noch in der alten Datei. Also werden sie von dort uebernommen,
statt sie neu zu suchen. Was der Neubau selbst gefunden hat, hat Vorrang.
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from artistids import ensure_ids, norm
from dedupe import merge_duplicates
from fame import add_fame


def key_of(song, artists):
    """Titel plus Kuenstlername - die IDs zeigen in zwei Dateien woandershin."""
    namen = sorted(norm(artists[a]) for a in song.get('ar', []) if a < len(artists))
    return (norm(song.get('t', '')), tuple(namen) or (norm(song.get('a', '')),))


def load_old(arg):
    if arg:
        return json.load(open(arg, encoding='utf-8'))
    out = subprocess.run(['git', 'show', 'HEAD:data/songs.json'],
                         capture_output=True, text=True)
    if out.returncode or not out.stdout:
        return None
    return json.loads(out.stdout)


def carry_over(old, new):
    """Haengt die stufenlosen Songs der alten Datei an die neue. Gibt die
       Zahl der uebernommenen Songs zurueck."""
    alt_artists = old.get('artists', [])
    neu_artists = new.setdefault('artists', [])
    index = {norm(n): i for i, n in enumerate(neu_artists)}

    da = {key_of(s, neu_artists) for s in new['songs']}
    genommen = 0
    for s in old['songs']:
        if s.get('d'):
            continue                      # Chartsongs baut der Neubau selbst
        if key_of(s, alt_artists) in da:
            continue
        kopie = dict(s)
        ids = []
        for a in s.get('ar', []):
            if a >= len(alt_artists):
                continue
            name = alt_artists[a]
            n = norm(name)
            if n not in index:
                index[n] = len(neu_artists)
                neu_artists.append(name)
            ids.append(index[n])
        kopie['ar'] = ids
        new['songs'].append(kopie)
        da.add(key_of(kopie, neu_artists))
        genommen += 1
    return genommen


def main():
    alt_pfad = sys.argv[1] if len(sys.argv) > 1 else None
    neu_pfad = sys.argv[2] if len(sys.argv) > 2 else 'data/songs.json'

    old = load_old(alt_pfad)
    if not old or not old.get('songs'):
        print('keine alte Datei - nichts zu uebernehmen')
        return
    new = json.load(open(neu_pfad, encoding='utf-8'))

    vorher = len(new['songs'])
    genommen = carry_over(old, new)
    ensure_ids(new)
    new['songs'], _ = merge_duplicates(new['songs'])
    add_fame(new['songs'])
    json.dump(new, open(neu_pfad, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    alt_ohne = sum(1 for s in old['songs'] if not s.get('d'))
    print(f'{vorher} -> {len(new["songs"])} Songs '
          f'({genommen} von {alt_ohne} stufenlosen aus der alten Datei uebernommen)')


if __name__ == '__main__':
    main()
