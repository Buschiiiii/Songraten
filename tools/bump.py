#!/usr/bin/env python3
"""Zaehlt die Versionsnummer in assets/version.js hoch: <Datum>.<Nummer am Tag>.

Laeuft vor jedem Commit (Git-Hook, siehe CLAUDE.md), kann aber auch von Hand
aufgerufen werden. Neuer Tag -> .1, sonst Nummer + 1."""
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DATEI = Path(__file__).resolve().parent.parent / 'assets' / 'version.js'
MUSTER = re.compile(r"const VERSION = '(\d{4}-\d{2}-\d{2})\.(\d+)';")


def bump(text, heute):
    m = MUSTER.search(text)
    if not m:
        sys.exit('version.js: keine VERSION-Zeile gefunden')
    tag, n = m.group(1), int(m.group(2))
    neu = f'{heute}.{n + 1 if tag == heute else 1}'
    return MUSTER.sub(f"const VERSION = '{neu}';", text), neu


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        t = "x\nconst VERSION = '2026-10-01.3';\n"
        assert bump(t, '2026-10-01')[1] == '2026-10-01.4'
        assert bump(t, '2026-10-02')[1] == '2026-10-02.1'
        print('bump ok')
        sys.exit(0)
    heute = datetime.now(ZoneInfo('Europe/Berlin')).strftime('%Y-%m-%d')
    text, neu = bump(DATEI.read_text(encoding='utf-8'), heute)
    DATEI.write_text(text, encoding='utf-8')
    print(neu)
