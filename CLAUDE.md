# Songraten

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

### iOS gibt den Ton nur unter drei Bedingungen frei

Das hat auf dem iPhone erst komplett stumm geklungen, in Safari wie in Chrome —
beide sind WebKit, der Fehler ist derselbe:

1. Der AudioContext muss **in** einer Nutzergeste aufgeweckt werden. `resume()`
   nach einem `await` zählt nicht mehr — deshalb ruft `playCurrent()` zuerst
   `Audio2.unlock()` auf und wartet **danach** aufs Laden.
2. Einmal muss wirklich etwas gespielt worden sein, deshalb der stumme
   Ein-Sample-Puffer in `unlock()`.
3. Ohne `navigator.audioSession.type = 'playback'` (Safari 16.4+) schaltet iOS
   die Wiedergabe mit dem Klingelschalter stumm.

Zusätzlich hängt an `pointerdown`, `touchend` und `keydown` ein Aufwecker, der
so lange erneut versucht, bis der Context wirklich läuft.

## Datenpipeline — läuft nur beim Bauen, nie zur Laufzeit

(Einzige Ausnahme: der Playlist-Modus fragt die iTunes-Suche im Browser ab,
siehe unten.)

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

## Songauswahl (Filter)

Regeln in `assets/filters.js`. **Jeder Modus hat seinen eigenen Regelsatz** —
`settings.filters` für die Charts, `settings.plFilters` für die Playlist.
Sonst stünde nach „nur 1960er" in den Charts die eigene Playlist leer da, und
die Auswahllisten passen so zum jeweiligen Bestand. Drei Modi, damit sich
alles kombinieren lässt:

| Modus | Wirkung |
|---|---|
| `nur` | schränkt ein — mehrere gleicher Art wirken als ODER, verschiedene Arten als UND |
| `ohne` | wirft raus |
| `dazu` | holt dazu und schlägt beide anderen |

„nur 2010er + ohne Hip-Hop/Rap + dazu Billie Eilish" ergibt also die 2010er
ohne Rap, aber mit **allen** Billie-Eilish-Songs, auch denen von 2019 und 2021.

Arten: `genre`, `artist`, `decade`, `instrumental`. Werte werden normalisiert
gespeichert (`value`) und im Original angezeigt (`text`). Dieselbe Sache kann
nur einen Modus haben — ein Klick mit anderem Modus ersetzt die alte Regel,
ein Klick mit demselben nimmt sie zurück.

Bedienung: nichts wird getippt. Oben stehen die aktiven Regeln als Chips (nach
Modus eingefärbt), darunter ein Schalter für die Instrumentals, dann die
Wirkung (`nur`/`ohne`/`dazu`) für alles, was danach angeklickt wird, und
darunter drei Klapplisten — Genres und Jahrzehnte komplett als Häkchenliste
mit Songzahl, Künstler über ein Suchfeld mit Vorschlägen (1094 Namen, deshalb
keine offene Liste). Die Häkchen spiegeln die Regeln, `markRules()` hält
beides zusammen. `Filters.counts()` liefert die Zahlen und wird pro Art
einmal gerechnet.

Voreingestellt ist `ohne Instrumental`. Die Kataloge kennzeichnen Instrumentals
nicht, deshalb die Erkennung über Titel, Album (`instrumental`, `karaoke`,
`score` …) und Genres, die praktisch nie Gesang haben. Bewusst eng: im
aktuellen `songs.json` trifft sie genau einen Song. Wer echte Instrumentals
vermisst, erweitert `INST_WORDS`/`INST_GENRES`.

Der Pool wird sofort neu gerechnet, die **laufende Runde aber nicht angefasst**
— sonst wäre ein Klick auf einen Filter dasselbe wie Aufgeben. Vorschläge im
Suchfeld kommen weiter aus der ganzen Datei, nicht aus dem Pool: sonst wäre
die Vorschlagsliste bei kleinen Pools die Lösung.

Warnung ab weniger als 30 Songs (`Filters.MIN_POOL`), ebenso wenn eine Stufe
leer läuft. Leere Stufen ziehen Ersatz aus dem restlichen Pool, damit die Runde
spielbar bleibt. In der Playlist ist die Schwelle `PL_MIN` (5) — so viele
braucht eine Runde; bleiben weniger übrig, sind die restlichen Plätze leer und
die Warnung sagt es.

## Playlist-Modus

Direkt bei Spotify, Apple Music oder YouTube nachfragen geht nicht: alle drei
wollen OAuth mit registrierter App und Login, also einen Server. Deshalb der
Umweg über einen Export. Eingelesen werden CSV, TSV, TXT, M3U und JSON — Exportify
(Spotify), TuneMyMusic, Soundiiz, „Playlist exportieren" in der Musik-App und
Google Takeout decken damit alles Übliche ab, notfalls tut es eine eingefügte
Liste „Titel – Künstler".

`assets/playlist.js` erkennt Trennzeichen und Spalten selbst (Aliasliste für
Titel/Künstler/Album). Ohne erkennbare Kopfzeile werden die ersten zwei Spalten
genommen; bei Freitextzeilen ist unklar, welche Hälfte der Titel ist, deshalb
wird beim Bewerten **beide Reihenfolgen** geprüft (`loose`).

Danach wird jeder Titel über die iTunes-Suche aufgelöst — die **einzige**
Stelle, an der zur Laufzeit gesucht wird. Sequentiell mit 260 ms Pause; Apple
lässt trotzdem nur ein paar hundert Anfragen durch und schickt dann für einige
Minuten 403. Der Lauf bricht deshalb **nicht** ab, sondern wartet sichtbar
(30, 60, 120, 240, 300 s) und macht an derselben Stelle weiter; erst danach
gibt er auf. „Abbrechen" hält an, „Weiter suchen" nimmt die gespeicherte Liste
(`songrate:plqueue`) wieder auf — was schon gefunden wurde, liegt im Cache und
kostet keine Anfrage mehr. Treffer landen in `songrate:plcache` und überleben
das Neuladen, Fehlschläge nicht — ein Titel, den Apple gerade nicht ausspuckt,
wäre sonst dauerhaft verloren.
Übernommen wird nur, was `previewUrl` hat und beim Abgleich von Titel und
Künstler mindestens 2,5 Punkte erreicht.

Im Modus selbst: keine Schwierigkeitsstufen, fünf zufällige Songs aus der
Liste, Faktor 1,0, Vorschläge im Suchfeld nur aus der Playlist. Die Filter
gelten hier genauso — ein importiertes Album bringt gern Instrumental- und
Karaokefassungen mit, die die Standardregel wegräumt. Die
Ausschnittlängen (0,01–15 s) bleiben. Unter fünf gefundenen Songs bleibt der
Modus gesperrt. Künstler-IDs werden hier lokal vergeben: der komplette
Künstlerstring plus die Einzelnamen — ein falscher Schnitt färbt hier
höchstens einen Tipp gelb, anders als in der Pipeline.

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
2. **Weder Stufen noch Filter dürfen die Runde zurücksetzen.** `remapStages()`
   rechnet die Position auf die nächste Stufe um, die mindestens so lang ist
   wie die bisherige. Nie `newRound()` aus einer Einstellung heraus aufrufen.
3. **`.stage-progress` darf in `render()` nicht mitgelöscht werden.** `render()`
   entfernt gezielt nur `.stage-seg`, sonst reißt die laufende Animation ab.
4. **Der helle Balken muss die Zeit umrechnen, nicht linear wachsen.** Die
   Leiste ist logarithmisch geteilt, die Zeit läuft gleichmäßig — ein linear
   wachsender Balken hängt fast die ganze Wiedergabe zu weit links, weil er
   sich durch die kurzen Abschnitte quält. `sweepBar()` rechnet deshalb pro
   Bild die gehörten Sekunden über `xForTime()` in Pixel um: nach 0,01 s steht
   er genau auf der 0,01s-Kante, nach 2 s auf der 2s-Kante. Stufen unter 0,4 s
   laufen optisch über 0,4 s ab, sonst sieht man nichts — die Breite bleibt
   korrekt, nur das Tempo ist gestreckt.
5. **Der Cursor steht dauerhaft im Suchfeld.** Kürzel dürfen deshalb keine
   Schriftzeichen sein: ↑ spielt ab, Enter rät, Shift+Enter überspringt,
   ←→ wechselt die Stufe (nur bei leerem Feld), Cmd+Enter würfelt neu.
6. **Die Vorschlagsliste wird häppchenweise gezeichnet** (`SUG_PAGE`), sonst
   sind bei „billie" zwar 30 Treffer da, aber nur die ersten acht erreichbar.
   Nachgeladen wird beim Scrollen ans Ende, beim Klick auf „n weitere" und
   wenn man mit ↓ unten anstößt; die Auswahl scrollt über `scrollIntoView`
   mit. Zwei Stolpersteine: `renderSuggest()` darf die Liste **nicht** neu
   aufbauen (sonst springt die Scrollposition bei jedem Tastendruck), und der
   globale Klick-Handler muss `isConnected` prüfen — der „weitere"-Knopf
   verschwand sonst beim Klick aus dem DOM und galt als Klick daneben, was
   die Liste sofort wieder schloss.
7. localStorage-Schlüssel: `songrate:settings` (enthält auch `filters`),
   `songrate:stats`,
   `songrate:recent` (letzte 60 Songs, gegen Wiederholungen),
   `songrate:playlist` (aufgelöste Playlist), `songrate:plcache`
   (Titel → iTunes-Treffer), `songrate:plqueue` (Titelliste eines noch nicht
   fertigen Laufs). Das Präfix bleibt
   `songrate:`, obwohl die Seite Songraten heißt — Umbenennen würde alle
   bereits gespeicherten Einstellungen und Statistiken verwerfen.

## Testen ohne Browser

Es gibt keinen Browser in der Entwicklungsumgebung, aber jsdom reicht und hat
bisher jeden Fehler gefunden: `index.html` laden, `AudioContext` mocken,
`fetch` auf die lokale `songs.json` biegen, dann `audio.js`, `playlist.js`,
`filters.js` und `app.js` auswerten und die Handler direkt aufrufen. Genau das macht `tools/test_ui.js`
(`npm i jsdom`, dann `node tools/test_ui.js`) — es spielt eine Runde in beiden
Modi durch. Zwei Stolpersteine dabei: alle vier
Skripte in **einem** `eval` zusammenhängen (sonst sieht `app.js` weder `Audio2`
noch `Playlist` oder `Filters`), und `getContext` für das Konfetti-Canvas stubben. Vor jeder
Auslieferung einmal durchspielen: Runde starten, raten, überspringen, auflösen,
neue Runde, Stufen umschalten, Neuwürfeln, Filter setzen und entfernen,
Playlist laden, im Playlist-Modus eine Runde beenden, zurückschalten.

## Offene Punkte

1. **Automatische Aktualisierung.** `songs.json` ist ein Schnappschuss, neue
   Releases fehlen. Geplant: GitHub Actions, das monatlich beide Scripte laufen
   lässt und die neue `songs.json` selbst committet. Vorher prüfen, ob Apple
   und kworb Anfragen aus GitHubs Rechenzentren durchlassen.
2. **Playlist-Modus.** Steht (siehe oben). Offen bleibt: die Trefferquote der
   iTunes-Suche ist bei Remixen und Live-Versionen mager. Wie lange Apple nach
   einem 403 wirklich dichthält, ist nicht dokumentiert — die Wartestufen sind
   geraten und müssen an echten großen Listen nachjustiert werden.

## Deployment

Dateien liegen im Repo-Wurzelverzeichnis, GitHub Pages auf `main` / root,
`.nojekyll` ist vorhanden. `index.html` muss direkt im Wurzelverzeichnis
liegen, sonst bleibt die Seite weiß.
