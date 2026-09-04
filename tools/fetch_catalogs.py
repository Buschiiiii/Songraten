#!/usr/bin/env python3
import json, os, sys, time, urllib.request, urllib.parse, re
from concurrent.futures import ThreadPoolExecutor

BUDGET = float(sys.argv[1]) if len(sys.argv) > 1 else 200
OUT = 'catalogs'
os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
artists = json.load(open('artists_top.json'))

# Die Jahrescharts bringen Kuenstler mit, die in kworbs Streamliste fehlen -
# ohne deren Kataloge findet match_local.py fuer alte Jahrzehnte nichts.
_yc = next((p for p in ('data/yearcharts.json', 'yearcharts.json') if os.path.exists(p)), None)
if _yc:
    SPLIT = re.compile(r'\s*(?:&|,|\bfeaturing\b|\bfeat\.?\b|\bwith\b|\bx\b|/)\s*', re.I)
    have = {a['name'].lower() for a in artists}
    extra = []
    for row in json.load(open(_yc, encoding='utf-8')):
        for part in SPLIT.split(row.get('artist') or ''):
            part = part.strip(' .-')
            if len(part) < 2 or part.lower() in have:
                continue
            have.add(part.lower())
            extra.append({'name': part})
    artists += extra
    print(f'+{len(extra)} Kuenstler aus den Jahrescharts', flush=True)

t0 = time.time()

def path(name):
    return os.path.join(OUT, re.sub(r'\W+', '_', name)[:80] + '.json')

todo = [a for a in artists if not os.path.exists(path(a['name']))]
print(f'offen: {len(todo)} von {len(artists)}', flush=True)

lock_fail = [0]

def grab(a):
    if time.time() - t0 > BUDGET:
        return 'skip'
    u = 'https://itunes.apple.com/search?' + urllib.parse.urlencode(
        {'term': a['name'], 'entity': 'song', 'attribute': 'artistTerm',
         'limit': 200, 'country': 'DE'})
    for att in range(3):
        if time.time() - t0 > BUDGET:
            return 'skip'
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=25)
            d = json.load(r)
            keep = [{k: t.get(k) for k in ('trackName', 'artistName', 'collectionName',
                                           'releaseDate', 'primaryGenreName', 'previewUrl',
                                           'artworkUrl100', 'trackId')}
                    for t in d.get('results', []) if t.get('previewUrl')]
            json.dump(keep, open(path(a['name']), 'w'), ensure_ascii=False)
            return 'ok'
        except Exception:
            lock_fail[0] += 1
            time.sleep(1.5 + att * 2.5)
    return 'fail'

with ThreadPoolExecutor(max_workers=3) as ex:
    res = list(ex.map(grab, todo))
n = {k: res.count(k) for k in set(res)}
done = len([a for a in artists if os.path.exists(path(a['name']))])
print(f'{n} | fertig gesamt: {done}/{len(artists)} | {time.time()-t0:.0f}s', flush=True)
