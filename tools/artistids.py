"""Kuenstler-IDs fuer Songs, die noch keine haben.

Jeder Song traegt eine Liste von IDs in `ar`, keinen Textnamen - nur so wird
ein Tipp bei einer Kollaboration fuer jeden Beteiligten gelb. Songs, die
add_decades.py nachtraegt, kommen aus der iTunes-Suche und hatten das Feld
zunaechst gar nicht; das Frontend ist darueber gestolpert.

Aufgespalten wird vorsichtig: der komplette Kuenstlerstring bleibt immer eine
ID, die Einzelnamen kommen dazu. Ein zu grosszuegiger Schnitt faerbt hier
hoechstens einen Tipp gelb, der es nicht sein muesste - das ist harmloser als
eine fehlende Verbindung.
"""

import re
import unicodedata

SPLIT = re.compile(r'\s*(?:&|,|\band\b|\bund\b|\bfeaturing\b|\bfeat\.?\b|\bft\.?\b'
                   r'|\bwith\b|\bx\b|\bvs\.?\b|/|\+)\s*', re.I)
FEAT = re.compile(r'[\(\[]\s*(?:feat\.?|featuring|ft\.?|with)\s+([^)\]]+)[\)\]]', re.I)
# Gruppen, deren Name wie eine Aufzaehlung aussieht.
NEVER_SPLIT = {
    'earth wind fire', 'simon garfunkel', 'mumford sons', 'hall oates',
    'sam dave', 'sonny cher', 'kool the gang', 'peter paul and mary',
    'crosby stills nash', 'emerson lake palmer', 'blood sweat tears',
    'the mamas the papas', 'derek the dominos', 'huey lewis the news',
    'martha the vandellas', 'gladys knight the pips', 'diana ross the supremes',
    'sly the family stone', 'kc the sunshine band', 'tom petty the heartbreakers',
    'bob marley the wailers', 'prince the revolution', 'nick cave the bad seeds',
    'florence the machine', 'echo the bunnymen', 'hootie the blowfish',
    'salt n pepa', 'above beyond', 'belle sebastian', 'angus julia stone',
    'of monsters and men',
}


def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def group_key(s):
    """Vergleichsform fuer NEVER_SPLIT: "Hall & Oates" und "Hall and Oates"
    sollen dieselbe Gruppe sein."""
    return re.sub(r'\b(and|und)\b', ' ', norm(s)).replace('  ', ' ').strip()


def names_of(song):
    """Alle Kuenstlernamen eines Songs: der ganze String und die Einzelnamen."""
    raw = (song.get('a') or '').strip()
    out = [raw] if raw else []
    if group_key(raw) in {group_key(x) for x in NEVER_SPLIT}:
        return out
    for part in SPLIT.split(raw):
        part = part.strip(' .-')
        if len(part) > 1 and part not in out:
            out.append(part)
    for m in FEAT.findall(song.get('t') or ''):
        for part in SPLIT.split(m):
            part = part.strip(' .-')
            if len(part) > 1 and part not in out:
                out.append(part)
    return out


def ensure_ids(data):
    """Ergaenzt fehlende `ar`-Listen und liefert, wie viele Songs es betraf."""
    artists = data.setdefault('artists', [])
    index = {norm(n): i for i, n in enumerate(artists)}

    def aid(name):
        k = norm(name)
        if not k:
            return None
        if k not in index:
            index[k] = len(artists)
            artists.append(name.strip())
        return index[k]

    fixed = 0
    for s in data.get('songs', []):
        if s.get('ar'):
            continue
        ids = []
        for n in names_of(s):
            i = aid(n)
            if i is not None and i not in ids:
                ids.append(i)
        s['ar'] = ids
        fixed += 1
    return fixed


if __name__ == '__main__':
    data = {'artists': ['Sia'], 'songs': [
        {'t': 'Unstoppable', 'a': 'Sia', 'ar': [0]},
        {'t': 'Africa', 'a': 'TOTO'},
        {'t': 'Ebony and Ivory', 'a': 'Paul McCartney and Stevie Wonder'},
        {'t': 'September', 'a': 'Earth, Wind & Fire'},
        {'t': 'Where Are Ü Now (feat. Justin Bieber)', 'a': 'Jack Ü'},
    ]}
    n = ensure_ids(data)
    namen = lambda s: [data['artists'][i] for i in s['ar']]
    for s in data['songs']:
        print(f"  {s['t'][:34]:<36} {namen(s)}")
    assert n == 4, n
    assert namen(data['songs'][0]) == ['Sia'], 'vorhandene IDs bleiben'
    assert namen(data['songs'][1]) == ['TOTO']
    assert 'Paul McCartney' in namen(data['songs'][2]) and 'Stevie Wonder' in namen(data['songs'][2])
    assert namen(data['songs'][3]) == ['Earth, Wind & Fire'], 'Gruppen nicht zerlegen'
    assert 'Justin Bieber' in namen(data['songs'][4]), 'feat. im Titel zaehlt mit'
    print('artistids.py in Ordnung')
