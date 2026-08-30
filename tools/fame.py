"""Bekanntheit eines Songs innerhalb seines Jahrzehnts.

Der Jahrzehntmodus braucht ein Mass, das quer durch die Jahrzehnte
funktioniert. Spotify-Streams taugen dafuer nicht - es gibt sie erst seit
2008, und ein Welthit von 1985 sieht daneben blass aus. Jahreschartplaetze
gibt es dafuer nicht fuer jeden Song. Also wird beides *innerhalb* des
Jahrzehnts in einen Rang umgerechnet und gemittelt: 100 = bekanntester Song
des Jahrzehnts, 0 = der unbekannteste.
"""


def add_fame(songs):
    by_dec = {}
    for s in songs:
        by_dec.setdefault((s.get('y') or 0) // 10 * 10, []).append(s)

    for group in by_dec.values():
        # Streams sind nur *innerhalb* eines Jahrzehnts vergleichbar, deshalb
        # der Rang in der eigenen Gruppe.
        have = sorted((s for s in group if s.get('s')), key=lambda s: -s['s'])
        n = max(1, len(have) - 1)
        by_streams = {id(s): 100 - 100 * i / n for i, s in enumerate(have)}

        for s in group:
            vals = []
            if id(s) in by_streams:
                vals.append(by_streams[id(s)])
            if s.get('r'):
                # Ein Jahreschartplatz ist schon eine absolute Skala: Platz 1
                # ist Platz 1, egal wie viele Songs sonst im Jahrzehnt stehen.
                # Ihn relativ zur Gruppe zu rechnen macht aus einem Welthit den
                # unbekanntesten Song des Jahrzehnts, sobald nur drei Songs
                # einen Rang haben.
                vals.append(max(0.0, 100 - (s['r'] - 1) * 100 / 99))
            s['f'] = round(sum(vals) / len(vals), 1) if vals else 50.0
    return songs


if __name__ == '__main__':
    songs = [
        {'t': 'Hit 85', 'y': 1985, 'r': 1},
        {'t': 'Mittel 87', 'y': 1987, 'r': 50},
        {'t': 'Rand 89', 'y': 1989, 'r': 100},
        {'t': 'Stream 2015', 'y': 2015, 's': 3_000_000_000},
        {'t': 'Wenig 2016', 'y': 2016, 's': 200_000_000},
        {'t': 'Beides 2017', 'y': 2017, 's': 1_000_000_000, 'r': 3},
        {'t': 'Ohne alles', 'y': 1995},
    ]
    add_fame(songs)
    for s in songs:
        print(f"  {s['t']:<14} {s['y']}  f={s['f']}")
    assert songs[0]['f'] == 100, 'Platz 1 ist der bekannteste'
    assert 45 < songs[1]['f'] < 55, 'Platz 50 liegt in der Mitte'
    assert songs[2]['f'] == 0, 'Platz 100 ist der unbekannteste'
    assert songs[3]['f'] == 100 and songs[4]['f'] == 0, 'Streams zaehlen im Jahrzehnt'
    # mittlere Streams (50) und Platz 3 (98) ergeben zusammen rund 74
    assert 70 < songs[5]['f'] < 80, f'Streams und Chartplatz gemischt: {songs[5]["f"]}'
    assert songs[6]['f'] == 50.0, 'ohne Angaben in die Mitte'
    # Der Fehler, der das ausgeloest hat: drei Rang-Songs im selben Jahrzehnt
    # duerfen nicht auf 100/50/0 gespreizt werden.
    dreier = [{'t': 'a', 'y': 1982, 'r': 1}, {'t': 'b', 'y': 1985, 'r': 2}, {'t': 'c', 'y': 1982, 'r': 3}]
    add_fame(dreier)
    assert all(s['f'] > 95 for s in dreier), f'Spitzenplaetze bleiben oben: {[s["f"] for s in dreier]}'
    print('fame.py in Ordnung')
