#!/usr/bin/env python3
import json, os, re, html, time, unicodedata, random, sys
from difflib import SequenceMatcher

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dedupe import merge_duplicates

TIERS = [('easy', 1.5e9, 1e13), ('medium', 8e8, 1.5e9), ('hard', 4.5e8, 8e8),
         ('expert', 2.8e8, 4.5e8), ('impossible', 1.3e8, 2.8e8)]
PER_TIER = 400
CAP = 8

BAD = re.compile(r"(remix|live|version|edit\b|mix\b|instrumental|karaoke|sped up|slowed|"
                 r"acoustic|demo\b|commentary|remaster|re-recorded|reprise|interlude|"
                 r"extended|club |dub |bonus|a cappella|acapella|cover\b|medley|mashup)", re.I)
FEAT = re.compile(r"[\(\[]?\s*(?:feat\.?|featuring|ft\.?|with|mit)\s+([^)\]]+)[\)\]]?", re.I)
SPLIT = re.compile(r"\s*(?:&|,|\bx\b|\bX\b|\bvs\.?\b|\bwith\b|\band\b|\bund\b|/|\+)\s*")
NEVER_SPLIT = {"hall & oates", "daryl hall & john oates", "sam & dave", "sonny & cher",
               "kool & the gang", "earth, wind & fire", "simon & garfunkel", "mumford & sons",
               "florence + the machine", "nick cave & the bad seeds", "tom petty & the heartbreakers",
               "bob marley & the wailers", "prince & the revolution", "gladys knight & the pips",
               "diana ross & the supremes", "sly & the family stone", "hootie & the blowfish",
               "kc & the sunshine band", "angus & julia stone", "belle & sebastian",
               "of monsters and men", "above & beyond", "the mamas & the papas",
               "emerson, lake & palmer", "crosby, stills & nash", "blood, sweat & tears",
               "salt-n-pepa", "peter, paul and mary", "huey lewis & the news",
               "martha & the vandellas", "echo & the bunnymen", "derek & the dominos"}


def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[\u2018\u2019\u201c\u201d]", "'", s)
    s = re.sub(r'\s*[\(\[].*?[\)\]]\s*', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def sim(a, b):
    return SequenceMatcher(None, a, b).ratio()


def cpath(name):
    return os.path.join('catalogs', re.sub(r'\W+', '_', name)[:80] + '.json')


print('lade Kataloge', flush=True)
CAT = {}
for a in json.load(open('artists_top.json')):
    p = cpath(a['name'])
    if not os.path.exists(p):
        continue
    idx = {}
    for t in json.load(open(p)):
        if not t.get('trackName') or not t.get('previewUrl'):
            continue
        idx.setdefault(norm(t['trackName']), []).append(t)
    CAT[a['name']] = idx
print(f'  {len(CAT)} Kataloge, {sum(len(v) for v in CAT.values())} Titel', flush=True)

idx_html = open('.cache/' + [f for f in os.listdir('.cache') if 'artists_html' in f][0], encoding='utf-8').read()
canonical = set()
for m in re.findall(r'_songs\.html"[^>]*>([^<]+)<', idx_html):
    canonical.add(norm(html.unescape(m)))
print(f'  {len(canonical)} kanonische Kuenstlernamen', flush=True)

cands = json.load(open('candidates.json'))
glob_cache = [f for f in os.listdir('.cache') if 'spotify_songs_html' in f]
if glob_cache:
    g = open('.cache/' + glob_cache[0], encoding='utf-8').read()
    known = {norm(k): k for k in CAT}
    by_streams = {c['streams']: c for c in cands}
    add = 0
    for row in re.findall(r'<tr>(.*?)</tr>', g, re.S):
        c = [html.unescape(re.sub('<.*?>', '', x)).strip()
             for x in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]
        if len(c) < 2 or not re.fullmatch(r'[\d,]+', c[1] or '') or ' - ' not in c[0]:
            continue
        art, title = c[0].split(' - ', 1)
        s = int(c[1].replace(',', ''))
        if s < 1.3e8 or BAD.search(title) or s in by_streams:
            continue
        real = known.get(norm(art))
        if real:
            cands.append({'title': title.strip(), 'artists': [real], 'streams': s})
            add += 1
    print(f'  +{add} aus der globalen Liste', flush=True)


def find(cand):
    """bester iTunes-Treffer aus den Katalogen der beteiligten Kuenstler.
    Eine Remix-/Instrumental-Fassung wird nur genommen, wenn der gesuchte
    Titel selbst so heisst - sonst raet man gegen eine Version, die niemand kennt."""
    want = norm(FEAT.sub('', cand['title']))
    cand_bad = bool(BAD.search(cand['title']))
    best, score = None, 0
    for a in cand['artists']:
        idx = CAT.get(a)
        if not idx:
            continue
        pairs = []
        hits = idx.get(want)
        if hits:
            pairs = [(1.0, t) for t in hits]
        else:
            for key in idx:
                if abs(len(key) - len(want)) > 6:
                    continue
                r = sim(key, want)
                if r > 0.88:
                    pairs += [(r, t) for t in idx[key]]
        for r, t in pairs:
            if BAD.search(t['trackName'] or '') and not cand_bad:
                continue
            if r > score:
                best, score = t, r
    return best if score >= 0.8 else None


print('matche', flush=True)
t0 = time.time()
out_tiers = {}
for tier, lo, hi in TIERS:
    pool = [c for c in cands if lo <= c['streams'] < hi]
    random.Random(7).shuffle(pool)
    keep, cnt, tried = [], {}, 0
    for c in pool:
        tried += 1
        lead = c['artists'][0]
        if cnt.get(lead, 0) >= CAP:
            continue
        m = find(c)
        if not m:
            continue
        cnt[lead] = cnt.get(lead, 0) + 1
        c['it'] = m
        c['tier'] = tier
        keep.append(c)
        if len(keep) >= PER_TIER:
            break
    if len(keep) < PER_TIER:
        for c in pool:
            if len(keep) >= PER_TIER:
                break
            if 'it' in c:
                continue
            m = find(c)
            if not m:
                continue
            c['it'] = m
            c['tier'] = tier
            keep.append(c)
    out_tiers[tier] = keep
    print(f'  {tier:11s} {len(keep):4d} von {len(pool)} Kandidaten ({tried} geprueft)', flush=True)
print(f'  {time.time()-t0:.0f}s', flush=True)


def split_artist(raw):
    raw = (raw or '').strip()
    if not raw:
        return []
    if norm(raw) in canonical or raw.lower() in NEVER_SPLIT:
        return [raw]
    parts = [p.strip(' .-') for p in SPLIT.split(raw) if p.strip(' .-')]
    if len(parts) <= 1:
        return [raw]
    good = [p for p in parts if norm(p) in canonical]
    if len(good) >= 2:
        return good
    if all(len(p) > 1 for p in parts) and len(parts) <= 4:
        return parts
    return [raw]


names, index = {}, []


def aid(n):
    k = norm(n)
    if not k:
        return None
    if k not in names:
        names[k] = len(index)
        index.append(n.strip())
    return names[k]


songs, seen = [], set()
for tier, _, _ in TIERS:
    for c in out_tiers[tier]:
        it = c['it']
        raw = set()
        for a in c['artists']:
            raw.update(split_artist(a))
        raw.update(split_artist(it['artistName']))
        for m in FEAT.findall((it['trackName'] or '') + ' ' + c['title']):
            raw.update(split_artist(m))
        ids = []
        for n in raw:
            i = aid(n)
            if i is not None and i not in ids:
                ids.append(i)
        title = FEAT.sub('', it['trackName'] or '')
        title = re.sub(r'\s*[\(\[]\s*(mixed|bonus track|deluxe|explicit|album version|single version)\s*[\)\]]', '', title, flags=re.I)
        title = re.sub(r'\s*[\(\[]\s*[\)\]]\s*', ' ', title)
        title = re.sub(r'\s+', ' ', title).strip(' -')
        key = (norm(title), tuple(sorted(ids)))
        if key in seen:
            continue
        seen.add(key)
        songs.append({
            't': title, 'a': it['artistName'], 'ar': ids,
            'al': it.get('collectionName') or '',
            'y': int((it.get('releaseDate') or '0000')[:4] or 0),
            'g': it.get('primaryGenreName') or '',
            's': c['streams'], 'd': tier,
            'p': it['previewUrl'], 'c': it['artworkUrl100'],
        })

# kworb fuehrt denselben Track manchmal zweimal mit leicht verschiedenen
# Streamzahlen; der Schluessel oben faengt das nicht, sobald sich eine
# Kuenstler-ID unterscheidet. Deshalb zum Schluss zusammenfuehren.
songs, merged = merge_duplicates(songs)
if merged:
    print(f'{len(merged)} Doppeleintraege zusammengefuehrt')
songs.sort(key=lambda x: -x['s'])
data = {'v': 1, 'built': time.strftime('%Y-%m-%d'),
        'tiers': [t[0] for t in TIERS], 'artists': index, 'songs': songs}
json.dump(data, open('songs.json', 'w'), ensure_ascii=False, separators=(',', ':'))
per = {}
for s in songs:
    per[s['d']] = per.get(s['d'], 0) + 1
print('\nsongs.json:', f'{os.path.getsize("songs.json")/1024:.0f} KB')
print('Songs:', len(songs), per)
print('Kuenstler:', len(index))
