#!/usr/bin/env python3
"""Prueft die Datenpipeline ohne Netz.

Die Skripte reden sonst mit kworb, Apple und Wikipedia - hier bekommen sie
nachgebaute Eingaben und muessen daraus dieselbe songs.json bauen wie im
Ernstfall. Dazu laufen die Selbsttests der einzelnen Parser.

    python3 tools/test_pipeline.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
fails = []


def check(ok, msg):
    print(('ok  ' if ok else 'FEHLGESCHLAGEN: ') + msg)
    if not ok:
        fails.append(msg)


def run(script, *args, cwd=None):
    r = subprocess.run([sys.executable, os.path.join(TOOLS, script), *args],
                       capture_output=True, text=True, cwd=cwd)
    return r


def selftests():
    for script in ('fetch_yearcharts.py', 'add_decades.py', 'fetch_kworb.py'):
        r = run(script, '--selftest')
        check(r.returncode == 0, f'{script} --selftest' + ('' if r.returncode == 0 else ': ' + r.stderr.strip()))
    r = run('fame.py')
    check(r.returncode == 0, 'fame.py' + ('' if r.returncode == 0 else ': ' + r.stderr.strip()))


def track(t, a, y, g='Pop'):
    return {'trackName': t, 'artistName': a, 'collectionName': 'Album',
            'releaseDate': f'{y}-01-01', 'primaryGenreName': g,
            'previewUrl': 'https://audio/' + re.sub(r'\W+', '', t),
            'artworkUrl100': 'https://art/x/100x100bb.jpg', 'trackId': abs(hash(t)) % 99999}


def build_input(d):
    """Nachgebaute Eingaben: Kataloge wie von Apple, Kandidaten wie von kworb."""
    os.makedirs(os.path.join(d, 'catalogs'))
    os.makedirs(os.path.join(d, '.cache'))
    os.makedirs(os.path.join(d, 'data'))
    artists = ['The Weeknd', 'Sia', 'Toto', 'a-ha']

    def w(path, obj):
        json.dump(obj, open(os.path.join(d, path), 'w', encoding='utf-8'), ensure_ascii=False)

    w('artists_top.json', [{'name': a} for a in artists])
    w('candidates.json', [
        {'title': 'Blinding Lights', 'artists': ['The Weeknd'], 'streams': 4_800_000_000},
        {'title': 'Unstoppable', 'artists': ['Sia'], 'streams': 2_030_000_000},
        {'title': 'Chandelier', 'artists': ['Sia'], 'streams': 1_200_000_000},
        {'title': 'Save Your Tears', 'artists': ['The Weeknd'], 'streams': 900_000_000},
        {'title': 'Elastic Heart', 'artists': ['Sia'], 'streams': 600_000_000},
        {'title': 'Cheap Thrills', 'artists': ['Sia'], 'streams': 350_000_000},
        {'title': 'In The Shadows', 'artists': ['The Weeknd'], 'streams': 200_000_000},
        # Derselbe Track zweimal, wie kworb ihn manchmal fuehrt
        {'title': 'Unstoppable', 'artists': ['Sia'], 'streams': 2_029_000_000},
    ])
    cat = {
        'The Weeknd': [track('Blinding Lights', 'The Weeknd', 2019), track('Save Your Tears', 'The Weeknd', 2020),
                       track('In The Shadows', 'The Weeknd', 2018)],
        'Sia': [track('Unstoppable', 'Sia', 2016), track('Chandelier', 'Sia', 2014),
                track('Elastic Heart', 'Sia', 2015), track('Cheap Thrills', 'Sia', 2016)],
        'Toto': [track('Africa', 'TOTO', 1982, 'Rock')],
        'a-ha': [track('Take On Me', 'a-ha', 1985)],
    }
    for name, tracks in cat.items():
        w(os.path.join('catalogs', re.sub(r'\W+', '_', name)[:80] + '.json'), tracks)

    open(os.path.join(d, '.cache/kworb_artists_html.html'), 'w', encoding='utf-8').write(
        ''.join(f'<a href="artist/{i}_songs.html">{a}</a>' for i, a in enumerate(artists)))
    open(os.path.join(d, '.cache/kworb_spotify_songs_html.html'), 'w', encoding='utf-8').write('<table></table>')

    w('data/yearcharts.json', [
        {'year': 1982, 'rank': 3, 'title': 'Africa', 'artist': 'Toto'},
        {'year': 1985, 'rank': 2, 'title': 'Take On Me', 'artist': 'a-ha'},
    ])


def pipeline():
    d = tempfile.mkdtemp(prefix='songraten-test-')
    try:
        build_input(d)
        r = run('match_local.py', cwd=d)
        if r.returncode != 0:
            check(False, 'match_local.py laeuft durch: ' + (r.stderr.strip()[-400:] or r.stdout.strip()[-400:]))
            return
        check(True, 'match_local.py laeuft durch')

        data = json.load(open(os.path.join(d, 'data/songs.json'), encoding='utf-8'))
        songs = {s['t']: s for s in data['songs']}
        check(data.get('v') == 2, 'songs.json traegt Version 2')
        check(len(data['songs']) == 9, f'neun Songs gebaut (waren {len(data["songs"])})')
        check(songs['Blinding Lights']['d'] == 'easy', 'Stufen kommen aus den Streamgrenzen')
        check(songs['In The Shadows']['d'] == 'impossible', 'auch am unteren Rand')

        check(songs['Africa']['d'] == '' and songs['Africa']['s'] == 0,
              'Jahrescharts-Songs haben keine Stufe und keine Streams')
        check(songs['Africa'].get('r') == 3 and songs['Africa']['y'] == 1982,
              'sie tragen Jahresplatz und Chartjahr')
        check(songs['Africa']['f'] > 95, f'und eine hohe Bekanntheit ({songs["Africa"]["f"]})')
        check(songs['Blinding Lights']['f'] == 100, 'der meistgestreamte Song seines Jahrzehnts steht oben')

        ids = data['artists']
        check(ids[songs['Africa']['ar'][0]] == 'TOTO', 'Kuenstler-IDs zeigen auf die richtigen Namen')
        check(all(s.get('p') and s.get('c') for s in data['songs']), 'jeder Song hat Preview und Cover')
        check(sum(1 for s in data['songs'] if s['t'] == 'Unstoppable') == 1,
              'der doppelt gefuehrte Track ist zusammengefuehrt')
    finally:
        shutil.rmtree(d, ignore_errors=True)


def decades():
    """add_decades.py mit vorgefuelltem Cache - laeuft ohne eine einzige Anfrage."""
    d = tempfile.mkdtemp(prefix='songraten-dec-')
    try:
        os.makedirs(os.path.join(d, 'data'))
        os.makedirs(os.path.join(d, '.cache'))
        bestand = {
            'v': 2, 'built': '2026-01-01', 'tiers': ['easy', 'medium', 'hard', 'expert', 'impossible'],
            'artists': ['Sia'],
            'songs': [{'t': 'Unstoppable', 'a': 'Sia', 'ar': [0], 'al': 'This Is Acting', 'y': 2016,
                       'g': 'Pop', 's': 2_030_000_000, 'd': 'easy',
                       'p': 'https://audio/u', 'c': 'https://art/u/100x100bb.jpg'}],
        }
        json.dump(bestand, open(os.path.join(d, 'data/songs.json'), 'w', encoding='utf-8'))
        rows = [{'year': 1982, 'rank': 3, 'title': 'Africa', 'artist': 'Toto'},
                {'year': 1985, 'rank': 2, 'title': 'Take On Me', 'artist': 'a-ha'},
                {'year': 1999, 'rank': 9, 'title': 'Gibtsnicht', 'artist': 'Niemand'}]
        json.dump(rows, open(os.path.join(d, 'data/yearcharts.json'), 'w', encoding='utf-8'))

        # Wie ein frueherer Lauf: zwei Treffer, ein Fehlschlag. Der Schluessel
        # ist derselbe wie im Skript: normalisierter Titel|Kuenstler.
        cache = {
            'africa|toto': {'t': 'Africa', 'a': 'TOTO', 'al': 'Toto IV', 'y': 1982, 'g': 'Rock',
                            's': 0, 'r': 3, 'd': '', 'p': 'https://audio/a', 'c': 'https://art/a/100x100bb.jpg'},
            'take on me|a ha': {'t': 'Take On Me', 'a': 'a-ha', 'al': 'Hunting High', 'y': 1985, 'g': 'Pop',
                                's': 0, 'r': 2, 'd': '', 'p': 'https://audio/t', 'c': 'https://art/t/100x100bb.jpg'},
            'gibtsnicht|niemand': None,
        }
        json.dump(cache, open(os.path.join(d, '.cache/decade_lookup.json'), 'w', encoding='utf-8'))

        r = run('add_decades.py', '20', cwd=d)
        check(r.returncode == 0, 'add_decades.py laeuft durch' + ('' if r.returncode == 0 else ': ' + r.stderr.strip()[-300:]))
        check('0 Anfragen' in r.stdout, 'nichts Bekanntes wird neu angefragt')

        data = json.load(open(os.path.join(d, 'data/songs.json'), encoding='utf-8'))
        songs = {s['t']: s for s in data['songs']}
        check(len(data['songs']) == 3, f'zwei Songs dazu (jetzt {len(data["songs"])})')
        check(songs['Africa']['r'] == 3 and songs['Africa']['d'] == '',
              'mit Jahresplatz und ohne Stufe eingetragen')
        check(songs['Africa']['f'] > 95 and songs['Unstoppable']['f'] == 100,
              'Bekanntheit fuer alle neu gerechnet')
        check('Gibtsnicht' not in songs, 'was Apple nicht kennt, bleibt draussen')

        # Ein zweiter Lauf darf nichts doppeln.
        r2 = run('add_decades.py', '20', cwd=d)
        data2 = json.load(open(os.path.join(d, 'data/songs.json'), encoding='utf-8'))
        check(len(data2['songs']) == 3, f'ein zweiter Lauf doppelt nichts (jetzt {len(data2["songs"])})')
    finally:
        shutil.rmtree(d, ignore_errors=True)


def rebuild_keeps_extras():
    """Ein Chartsneubau darf die ueber Wochen gesammelten Jahrzehnt-Songs
       nicht wegwerfen. match_local.py baut songs.json komplett neu und kennt
       sie nicht - keep_extras.py holt sie aus der alten Datei zurueck."""
    d = tempfile.mkdtemp()
    try:
        alt = {
            'v': 2, 'built': '2026-01-01', 'tiers': ['easy'],
            'artists': ['Toto', 'Sia', 'Gaste'],
            'songs': [
                {'t': 'Unstoppable', 'a': 'Sia', 'ar': [1], 'y': 2016, 'g': 'Pop',
                 's': 2000000000, 'd': 'easy', 'p': 'x', 'c': 'y'},
                {'t': 'Africa', 'a': 'Toto', 'ar': [0], 'y': 1982, 'g': 'Rock',
                 's': 0, 'r': 3, 'd': '', 'p': 'x', 'c': 'y'},
                {'t': 'Rosanna', 'a': 'Toto', 'ar': [0, 2], 'y': 1982, 'g': 'Rock',
                 's': 0, 'r': 9, 'd': '', 'p': 'x', 'c': 'y'},
            ],
        }
        # So sieht ein gedrosselter Neubau aus: der Katalog von Queen fehlt,
        # also fehlt auch "Bohemian Rhapsody" - und die Kuenstlerliste ist
        # eine andere, genau da gehen die IDs sonst schief. Die Streamzahl
        # von "Unstoppable" ist frisch.
        alt['artists'].append('Queen')
        alt['songs'].append({'t': 'Bohemian Rhapsody', 'a': 'Queen', 'ar': [3], 'y': 1975,
                             'g': 'Rock', 's': 900000000, 'd': 'easy', 'p': 'x', 'c': 'y'})
        neu = {
            'v': 2, 'built': '2026-02-02', 'tiers': ['easy'],
            'artists': ['Sia'],
            'songs': [{'t': 'Unstoppable', 'a': 'Sia', 'ar': [0], 'y': 2016, 'g': 'Pop',
                       's': 2200000000, 'd': 'easy', 'p': 'x', 'c': 'y'}],
        }
        json.dump(alt, open(os.path.join(d, 'alt.json'), 'w'), ensure_ascii=False)
        json.dump(neu, open(os.path.join(d, 'neu.json'), 'w'), ensure_ascii=False)

        r = run('keep_extras.py', os.path.join(d, 'alt.json'), os.path.join(d, 'neu.json'))
        check(r.returncode == 0, 'keep_extras.py laeuft durch'
              + ('' if r.returncode == 0 else ': ' + r.stderr.strip()[-300:]))

        out = json.load(open(os.path.join(d, 'neu.json'), encoding='utf-8'))
        titel = {s['t']: s for s in out['songs']}
        check(len(out['songs']) == 4, f'die Jahrzehnt-Songs sind wieder da (jetzt {len(out["songs"])})')
        check('Bohemian Rhapsody' in titel and titel['Bohemian Rhapsody']['d'] == 'easy',
              'ein Chartsong ohne Katalog geht auch nicht verloren')
        check([out['artists'][a] for a in titel['Bohemian Rhapsody']['ar']] == ['Queen'],
              'und behaelt seinen Kuenstler')
        check(titel['Africa']['r'] == 3 and titel['Africa']['d'] == '',
              'mit Jahresplatz und ohne Stufe')
        namen = [out['artists'][a] for a in titel['Rosanna']['ar']]
        check(namen == ['Toto', 'Gaste'], f'die Kuenstler-IDs zeigen richtig ({namen})')
        check(all(a < len(out['artists']) for s in out['songs'] for a in s['ar']),
              'keine ID zeigt ins Leere')
        check(all(s.get('f') is not None for s in out['songs']), 'Bekanntheit neu gerechnet')

        # Zweimal laufen aendert nichts.
        run('keep_extras.py', os.path.join(d, 'alt.json'), os.path.join(d, 'neu.json'))
        out2 = json.load(open(os.path.join(d, 'neu.json'), encoding='utf-8'))
        check(len(out2['songs']) == 4, f'ein zweiter Lauf doppelt nichts (jetzt {len(out2["songs"])})')

        # Was der Neubau selbst gefunden hat, gewinnt - mitsamt frischer
        # Streamzahl. Sonst waere ein Neubau sinnlos.
        check(titel['Unstoppable']['s'] == 2200000000,
              'der Neubau gewinnt, wo er etwas gefunden hat')
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == '__main__':
    print('Selbsttests der Skripte')
    selftests()
    print('\nDurchlauf der Pipeline')
    pipeline()
    print('\nJahrzehnte nachtragen')
    decades()
    print('\nChartsneubau wirft nichts weg')
    rebuild_keeps_extras()
    print('\n' + (f'{len(fails)} Fehler' if fails else 'Pipeline in Ordnung'))
    sys.exit(1 if fails else 0)
