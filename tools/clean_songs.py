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

path = sys.argv[1] if len(sys.argv) > 1 else 'data/songs.json'
data = json.load(open(path, encoding='utf-8'))

before = len(data['songs'])
fixed = ensure_ids(data)          # Songs ohne Kuenstler-IDs nachtragen
if fixed:
    print(f'  {fixed} Songs ohne Künstler-IDs ergänzt')
data['songs'], merged = merge_duplicates(data['songs'])
data['songs'].sort(key=lambda x: -x.get('s', 0))

for t, a in merged:
    print(f'  zusammengefuehrt: {t} — {a}')
print(f'{before} Songs -> {len(data["songs"])}')

if merged or fixed:
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('geschrieben:', path)
