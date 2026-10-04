"""Doppelte Songs zusammenfuehren.

kworb fuehrt denselben Track manchmal zweimal (Single- und Albumfassung),
mit leicht verschiedenen Streamzahlen. Beim Matchen kommen dann zwei
Eintraege heraus, die sich nur in einer Kuenstler-ID unterscheiden - z. B.
"Lean On" einmal mit und einmal ohne Diplo. Im Spiel entscheidet dann der
Zufall, ob ein Tipp gelb wird oder grau.

Zusammengefuehrt wird nur, was denselben normalisierten Titel hat *und*
mindestens einen Kuenstler teilt: "Hello" von Adele und "Hello" von Lionel
Richie bleiben zwei Songs.
"""

import re
import unicodedata


def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r'\s*[\(\[].*?[\)\]]\s*', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def merge_duplicates(songs):
    """Liefert (bereinigte Liste, Liste der zusammengefuehrten Paare)."""
    groups = {}
    order = []
    merged = []

    for s in songs:
        key = norm(s.get('t'))
        hit = None
        for other in groups.get(key, []):
            if set(other.get('ar') or []) & set(s.get('ar') or []) or norm(other.get('a')) == norm(s.get('a')):
                hit = other
                break

        if hit is None:
            groups.setdefault(key, []).append(s)
            order.append(s)
            continue

        # Der Eintrag mit den meisten Streams gibt Titel, Cover und Stufe vor,
        # die Kuenstler-IDs werden vereinigt.
        keep, drop = (hit, s) if hit.get('s', 0) >= s.get('s', 0) else (s, hit)
        ids = list(keep.get('ar') or [])
        for a in (drop.get('ar') or []):
            if a not in ids:
                ids.append(a)
        # Streams je Land: aus beiden das Groessere, sonst verliert der
        # zusammengefuehrte Song ein Land, das nur der andere Eintrag kannte.
        rc = dict(drop.get('rc') or {})
        for k, v in (keep.get('rc') or {}).items():
            rc[k] = max(v, rc.get(k, 0))
        if keep is s:
            hit.update(s)
        hit['ar'] = ids
        hit['s'] = max(hit.get('s', 0), s.get('s', 0))
        if rc:
            hit['rc'] = rc
        merged.append((keep.get('t'), keep.get('a')))

    return order, merged
