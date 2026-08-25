# Songrate

Website zum Songraten, Nachbau von Songless. Fünf Songs pro Runde, einer je
Schwierigkeitsstufe, Ausschnitte von 0,01 bis 15 Sekunden. Zweck: der Betreiber
nimmt damit Shorts und TikToks auf.

**Sprache: Deutsch.** Erklärungen knapp halten.

## Harte Randbedingung

Rein statisch auf GitHub Pages. Kein Server, kein Build-Step, keine
Paketabhängigkeiten, kein API-Key, kein Login. Jeder Lösungsvorschlag, der
einen Proxy, ein Backend oder ein npm-Paket zur Laufzeit braucht, ist raus —
lieber die Funktion anders schneiden.

## Warum Apple-Previews

Geprüft: Deezers API schickt kein `Access-Control-Allow-Origin`, bräuchte also
einen Proxy. Die iTunes Search/Lookup-API, das Preview-CDN
(`audio-ssl.itunes.apple.com`) und das Cover-CDN (`mzstatic.com`) liefern alle
`ACAO: *` und Range-Support — damit läuft alles direkt aus dem Browser.

Folge daraus: Previews sind 30-Sekunden-Ausschnitte, meist aus der Songmitte.
Ein „ab Songanfang" wie im Original ist damit **nicht** möglich. Es gibt nur
Preview-Anfang oder zufällige Stelle innerhalb der 30 Sekunden.

Cover-URLs enden auf `100x100bb`; für größere Darstellung im Code ersetzt.

## Warum Web Audio statt `<audio>`

0,01 Sekunden exakt abspielen geht mit einem Audio-Element nicht, Seek- und
Netzwerklatenz sind größer als der Ausschnitt. Deshalb wird die Preview
komplett geladen, dekodiert und über `source.start(when, offset, duration)`
geschnitten. 4 ms Rampen an den Kanten gegen Knackser. Siehe `assets/audio.js`.

## Datenpipeline — läuft nur beim Bauen, nie zur Laufzeit

1. `tools/fetch_catalogs.py <sekunden>` lädt je Künstler **eine** Anfrage
   (`attribute=artistTerm&limit=200`) und legt sie in `catalogs/` ab.
   Apple drosselt nach einigen tausend Anfragen mit 403 — deshalb das
   Zeitbudget als Argument und der Cache pro Datei. Einfach mehrfach aufrufen.
2. `tools/match_local.py` baut daraus offline in Sekunden `songs.json`.
   Streamzahlen kommen von kworb.net (Spotify all-time), Titel werden lokal
   gegen die Kataloge gematcht.

Grenzwerte der Stufen, Songs pro Stufe und die Künstleranzahl stehen oben in
`match_local.py`.

## Stufen (Spotify-Streams)

| Stufe | Streams | Anker |
|---|---|---|
| easy | ab 1,5 Mrd. | Sia – Unstoppable (2,03 Mrd.) |
| medium | 800 Mio. – 1,5 Mrd. | |
| hard | 450 – 800 Mio. | |
| expert | 280 – 450 Mio. | |
| impossible | 130 – 280 Mio. | Britney Spears – Stronger (214 Mio.) |

Unter 130 Mio. wird es unfair statt schwer. Der Pool je Stufe wird mit festem
Seed gemischt, nicht nach Streams sortiert — sonst füllt sich jede Stufe nur
vom oberen Rand ihres Bereichs.

## Spielregeln

- 5 Songs pro Runde, einer je Stufe, jeder mit eigenem Fortschritt.
- Falscher Tipp **oder** Überspringen schaltet eine Stufe weiter.
- Anzahl Versuche = Anzahl aktiver Stufen. Eine Stufe abzuschalten kostet
  deshalb auch einen Versuch, das ist Absicht.
- Rückmeldung: grün richtig, gelb Künstler stimmt, grau daneben.
- Derselbe Künstler darf mehrfach in einer Runde vorkommen.
- Punkte nach gehörten Sekunden mal Stufenfaktor, damit unterschiedliche
  Stufenleitern vergleichbar bleiben.

## Künstlerindex — hier steckt die Arbeit

Jeder Song hat eine Liste von Künstler-IDs, nicht ein Textfeld. Nur so wird
ein Tipp bei einer Kollaboration für **jeden** Beteiligten gelb. Die IDs
stammen aus drei Quellen: kworb-Querverweis (ein Feature-Track steht auf beiden
Künstlerseiten, verbunden über die identische Streamzahl), `feat.` im Titel,
und Aufspalten des iTunes-Künstlerfelds.

Das Aufspalten ist die gefährliche Stelle: `Simon & Garfunkel`,
`Earth, Wind & Fire`, `Mumford & Sons` dürfen **nicht** zerlegt werden.
Schutz: der komplette String wird gegen ~3000 kanonische Künstlernamen von
kworb geprüft, plus die `NEVER_SPLIT`-Liste in `match_local.py`.

## Fallstricke im Frontend

1. **`[hidden]{display:none !important}` in `style.css` muss bleiben.**
   `.reveal` setzt `display:grid`, was das `hidden`-Attribut aushebelt. Das hat
   die Seite schon einmal komplett blockiert: beide Overlays waren dauerhaft
   sichtbar und kein Klick kam mehr durch.
2. **Stufen umschalten darf die Runde nicht zurücksetzen.** `remapStages()`
   rechnet die Position auf die nächste Stufe um, die mindestens so lang ist
   wie die bisherige. Nie `newRound()` aus einer Einstellung heraus aufrufen.
3. **`.stage-progress` darf in `render()` nicht mitgelöscht werden.** `render()`
   entfernt gezielt nur `.stage-seg`, sonst reißt die laufende Animation ab.
4. Stufen unter 0,4 s laufen optisch über 0,4 s ab, sonst sieht man nichts.
   Die Breite bleibt korrekt, nur das Tempo ist gestreckt.
5. **Der Cursor steht dauerhaft im Suchfeld.** Kürzel dürfen deshalb keine
   Schriftzeichen sein: ↑ spielt ab, Enter rät, Shift+Enter überspringt,
   ←→ wechselt die Stufe (nur bei leerem Feld), Cmd+Enter würfelt neu.
6. localStorage-Schlüssel: `songrate:settings`, `songrate:stats`,
   `songrate:recent` (letzte 60 Songs, gegen Wiederholungen).

## Testen ohne Browser

Es gibt keinen Browser in der Entwicklungsumgebung, aber jsdom reicht und hat
bisher jeden Fehler gefunden: `index.html` laden, `AudioContext` mocken,
`fetch` auf die lokale `songs.json` biegen, dann `audio.js` + `app.js`
auswerten und die Handler direkt aufrufen. Vor jeder Auslieferung einmal
durchspielen: Runde starten, raten, überspringen, auflösen, neue Runde,
Stufen umschalten, Neuwürfeln.

## Offene Punkte

1. **Automatische Aktualisierung.** `songs.json` ist ein Schnappschuss, neue
   Releases fehlen. Geplant: GitHub Actions, das monatlich beide Scripte laufen
   lässt und die neue `songs.json` selbst committet. Vorher prüfen, ob Apple
   und kworb Anfragen aus GitHubs Rechenzentren durchlassen.
2. **Playlist-Modus.** Eigene Playlist hochladen und nur daraus spielen. In dem
   Modus **keine** Schwierigkeitsstufen, sondern fünf zufällige Songs. Offene
   Frage: welches Format die Playlist hat und wie die Titel auf Apple-Previews
   gemappt werden.

## Deployment

Dateien liegen im Repo-Wurzelverzeichnis, GitHub Pages auf `main` / root,
`.nojekyll` ist vorhanden. `index.html` muss direkt im Wurzelverzeichnis
liegen, sonst bleibt die Seite weiß.
