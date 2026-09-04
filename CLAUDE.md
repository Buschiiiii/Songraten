# Songraten

Website zum Songraten, Nachbau von Songless. Fünf Songs pro Runde, einer je
Schwierigkeitsstufe, Ausschnitte von 0,01 bis 15 Sekunden. Privates
Spaßprojekt, keine Videoproduktion — Entscheidungen also nach Spielgefühl,
nicht nach Aufnahmetauglichkeit.

**Sprache: Deutsch.** Erklärungen knapp halten.

## Harte Randbedingung

Rein statisch auf GitHub Pages. Kein Server, kein Build-Step, keine
Paketabhängigkeiten, kein API-Key, kein Login. Jeder Lösungsvorschlag, der
einen Proxy, ein Backend oder ein npm-Paket zur Laufzeit braucht, ist raus —
lieber die Funktion anders schneiden.

Die GitHub Actions sind kein Widerspruch dazu: sie erzeugen nur `songs.json`
und committen sie. Ausgeliefert wird weiterhin, was im Repo liegt.

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

0. `tools/fetch_kworb.py <anzahl>` holt die Streamzahlen: Künstlerübersicht
   und die Songseiten der größten Künstler, daraus `artists_top.json` und
   `candidates.json` sowie die zwei HTML-Schnappschüsse im `.cache`, die
   `match_local.py` erwartet. Erkennt es zu wenig, bricht es ab, statt leere
   Dateien zu schreiben — kworb kann seine Tabellen jederzeit umbauen,
   `--dump` zeigt dann die ersten Zeilen.
1. `tools/fetch_catalogs.py <sekunden>` lädt je Künstler **eine** Anfrage
   (`attribute=artistTerm&limit=200`) und legt sie in `catalogs/` ab.
   Apple drosselt nach einigen tausend Anfragen mit 403 — deshalb das
   Zeitbudget als Argument und der Cache pro Datei. Einfach mehrfach aufrufen.
2. `tools/match_local.py` baut daraus offline in Sekunden `songs.json`.
   Streamzahlen kommen von kworb.net (Spotify all-time), Titel werden lokal
   gegen die Kataloge gematcht.
3. `tools/dedupe.py` führt am Ende Doppeleinträge zusammen. kworb listet
   denselben Track manchmal zweimal (Single- und Albumfassung, minimal
   verschiedene Streamzahlen); der Schlüssel im Matcher fängt das nicht,
   sobald sich eine Künstler-ID unterscheidet. Genau das ist passiert: „Lean
   On" gab es mit und ohne Diplo, und ob ein Tipp gelb wurde, war Zufall.
   Zusammengeführt wird nur bei gleichem Titel **und** mindestens einem
   gemeinsamen Künstler — „Hello" von Adele und von Lionel Richie bleiben
   getrennt. `tools/clean_songs.py` wendet dasselbe auf eine fertige
   `songs.json` an.

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

## Jahrzehnte- und Genremodus

Zwei Modi mit derselben Bedienung: oben in der Mitte stehen Pfeile (`#pickBar`),
die durch die Jahrzehnte bzw. Genres springen; gespielt wird nur aus dem
gewählten. Der Code hält beide zusammen — `PICKED`, `listFor(modus)`,
`currentPick()`, `stepPick()` —, unterschieden wird nur beim Zählen und
Vergleichen (`inPick`). Zu dünn Besetztes steht gar nicht erst zur Wahl:
`DEC_MIN` (10) für Jahrzehnte, `GEN_MIN` (20) für Genres, die sich nicht über
die Zeit verteilen.

**Unter `TIER_MIN × 5` Songs fallen die Stufen weg.** Fünf Schwierigkeitsstufen
aus zwölf Songs sind keine Stufen, sondern eine Verlosung — dann wird gespielt
wie in der Playlist: fünf zufällige Songs, Faktor 1,0, Plätze statt Stufen
(`usesTiers()`, `FLAT_SLOTS`). Die Leiste schreibt „ohne Stufen" dazu.

**Die Stufen sind hier relativ.** Die Chartsstufen hängen an absoluten
Streamzahlen — für ein einzelnes Jahrzehnt taugt das nicht, Spotify zählt erst
seit 2008 mit. `relativeTiers()` sortiert deshalb den Pool des Jahrzehnts nach
Bekanntheit und schneidet ihn in fünf gleich große Teile: das oberste Fünftel
ist Easy.

Sortiert wird nach `f`, dem von der Pipeline gerechneten Bekanntheitswert
(0–100, siehe `tools/fame.py`): Streams zählen als Rang **innerhalb** des
Jahrzehnts, ein Jahreschartplatz dagegen absolut (Platz 1 = 100, Platz 100 =
0). Das ist wichtig — relativ gerechnet macht ein Jahrzehnt mit nur drei
Chartsongs aus „Africa" den unbekanntesten Song der 80er. Fehlt `f` (ältere
`songs.json`), entscheiden die Streams.

Songs mit leerem `d` haben keine Stufe und damit keine Streamzahl — sie kommen
aus den Jahrescharts und spielen in den Charts **nicht** mit, im Jahrzehnte-
und Genremodus schon. `chartFiltered` hält sie aus den Charts heraus,
`filtered` (und damit die Vorschlagsliste) enthält sie.

## Mehr Songs für alte Jahrzehnte

`songs.json` hängt an kworb (Spotify all-time) und deckt deshalb alles vor 2000
kaum ab — „Africa", „Take On Me" und „Hotel California" fehlten komplett. Zwei
Skripte holen das nach, beide unabhängig von der kworb-Pipeline:

1. `tools/fetch_yearcharts.py` lädt die Billboard-Jahrescharts (Year-End Hot
   100) von Wikipedia, ein Jahr pro Anfrage mit Cache, und schreibt
   `yearcharts.json`. `--selftest` prüft nur den Tabellenparser.
2. `tools/add_decades.py <sekunden>` sucht jeden dieser Titel über die
   iTunes-Suche und hängt die Treffer an `data/songs.json` — mit `r`
   (Jahresplatz), ohne Streams, ohne Stufe. Zeitbudget als Argument, Cache pro
   Titel (`.cache/decade_lookup.json`), also beliebig oft aufrufbar; Apple
   drosselt nach einigen hundert Anfragen. Geschrieben wird erst am Ende.
   Grenzen: `PER_DECADE` (500) und `CAP_ARTIST` (12) pro Jahrzehnt.

Wer die volle Pipeline neu baut, bekommt dasselbe über `match_local.py` — es
liest `yearcharts.json` mit, wenn sie da ist, und `fetch_catalogs.py` holt die
Kataloge der zusätzlichen Künstler.

## Genres zusammenfassen

Apple vergibt für dasselbe mehrere Genres: „Hip-Hop/Rap" (349 Songs),
„Hip-Hop" (14) und „Rap" (4) standen nebeneinander, wer Rap loswerden wollte,
musste drei Häkchen setzen. `GENRE_ALIAS` in `filters.js` zieht solche Fälle
zusammen (`Filters.genreOf()`), aus 43 Genres werden 35. Zusammengefasst wird
nur, was wirklich dasselbe meint — „Latin" und „Latin Urban" bleiben getrennt.

Gespeicherte Regeln zeigen sonst ins Leere, deshalb `Filters.migrate()`: beim
Start werden Genre-Regeln auf den neuen Namen gezogen und dabei entstehende
Doppel entfernt.

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
- Auf der letzten Stufe heißt der Knopf **Aufgeben**, nicht Überspringen —
  dort wird ja nichts mehr übersprungen.
- Falscher Tipp **oder** Überspringen schaltet eine Stufe weiter.
- Anzahl Versuche = Anzahl aktiver Stufen. Eine Stufe abzuschalten kostet
  deshalb auch einen Versuch, das ist Absicht.
- Rückmeldung: grün richtig, gelb Künstler stimmt, grau daneben.
- Derselbe Künstler darf mehrfach in einer Runde vorkommen.
- Punkte nach gehörten Sekunden mal Stufenfaktor, damit unterschiedliche
  Stufenleitern vergleichbar bleiben.
- **Hardmode** (`settings.hard`, aus): ein verpasster Song beendet die ganze
  Runde — die übrigen Plätze fallen mit, gezählt wird in der Statistik nur der
  Song, den man wirklich gespielt hat. Außerdem geht es strikt der Reihe nach:
  `locked(i)` sperrt jeden Platz, vor dem noch einer offen ist, und `render()`
  zeichnet ihn ausgegraut.

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

## Jeder Song braucht `ar`

Die Künstler-IDs sind kein Beiwerk: `boot()` baut daraus den Suchindex und
stolpert über `s.ar.map(...)`, wenn das Feld fehlt — die Seite bleibt dann
**weiß**. Genau das ist passiert, als der erste Actions-Lauf Songs ohne `ar`
committet hat. `tools/artistids.py` vergibt sie jetzt beim Einfügen
(`add_decades.py`) und repariert bestehende Dateien (`clean_songs.py`); das
Frontend hält ein fehlendes Feld zusätzlich aus.

## Aufbau der Seite

Links Kopfzeile (Marke, Stufenliste, Neuwürfeln, Rundenpunkte) und darunter
die Panels *Stufen* und *Statistik*; in der Mitte das Spielfeld; rechts
*Modus*, *Spielweise*, *Songstart*, *Lautstärke* und ganz unten die
*Songauswahl*.

Auf schmalen Bildschirmen wird `.col-left` zu `display:contents`, damit
`.left-head` (order 1) oben bleibt und `.left-panels` (order 4) hinter das
Spielfeld und die Einstellungen rutscht — sonst müsste man an den Panels
vorbeiscrollen, um den Abspielknopf zu sehen.

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
4. **Ein Kasten je Stufe, alle gleich breit.** Nach Sekunden geteilt wäre
   0,01 s mit 0,07 % unsichtbar; logarithmisch geteilt bekommt ausgerechnet
   der längste Abschnitt den schmalsten Kasten (8 → 15 s ist nicht mal eine
   Verdopplung, 0,01 → 0,1 s ein Faktor zehn). Die Leiste zeigt deshalb, was
   sie eigentlich meint: sechs Versuche, du bist beim vierten.
5. **Abgeschaltete Stufen bekommen keinen eigenen Kasten.** Ihre Sekunden
   gehören zur nächsten aktiven Stufe, die sie ja mitspielt — ein grauer Kasten
   mit Trennlinie würde eine Grenze zeigen, die es beim Hören nicht gibt.
   `segmentWidths()` schlägt die Breite deshalb der folgenden Stufe zu, der
   Kasten wird also doppelt so breit.
6. **Der helle Balken muss die Zeit umrechnen, nicht linear wachsen.** Die
   Kästen sind gleich breit, die Zeit in ihnen springt um Zehnerpotenzen — ein
   linear wachsender Balken hängt fast die ganze Wiedergabe zu weit links.
   `sweepBar()` rechnet deshalb pro Bild die gehörten Sekunden über
   `xForTime()` in Pixel um: nach 0,01 s steht er genau auf der 0,01s-Kante,
   nach 2 s auf der 2s-Kante, dazwischen wird interpoliert. `barStops()` setzt
   auch für verschluckte Stufen Stützpunkte, sonst kröche er durch einen
   verschmolzenen Kasten, als wäre nur eine Stufe darin. Stufen unter 0,4 s
   laufen optisch über 0,4 s ab, sonst sieht man nichts — die Breite bleibt
   korrekt, nur das Tempo ist gestreckt.
7. **Der Cursor steht dauerhaft im Suchfeld.** Kürzel dürfen deshalb keine
   Schriftzeichen sein: ↑ spielt ab, Enter rät, Shift+Enter überspringt,
   ←→ wechselt die Stufe (nur bei leerem Feld), Shift+←→ das Jahrzehnt oder
   Genre, Cmd+Enter würfelt neu. Die globalen Kürzel `s` und `r` waren
   trotzdem drin und sind rausgeflogen: nach einem Klick auf einen Filter
   liegt der Fokus auf dem Knopf, und wer dann „Sia" tippt, hat mit dem `s`
   übersprungen.
8. **Die Vorschlagsliste wird häppchenweise gezeichnet** (`SUG_PAGE`), sonst
   sind bei „billie" zwar 30 Treffer da, aber nur die ersten acht erreichbar.
   Nachgeladen wird beim Scrollen ans Ende, beim Klick auf „n weitere" und
   wenn man mit ↓ unten anstößt; die Auswahl scrollt über `scrollIntoView`
   mit. Zwei Stolpersteine: `renderSuggest()` darf die Liste **nicht** neu
   aufbauen (sonst springt die Scrollposition bei jedem Tastendruck), und der
   globale Klick-Handler muss `isConnected` prüfen — der „weitere"-Knopf
   verschwand sonst beim Klick aus dem DOM und galt als Klick daneben, was
   die Liste sofort wieder schloss.
9. **Die Statistik zeigt `stats.byTier` erst seit Kurzem.** Gesammelt wurde
   immer schon pro Stufe (`easy`…), pro Jahrzehnt (`dec-1980`), Genre
   (`gen-pop`) und für die Playlist — `statGroups()` fasst das zusammen und
   zeigt es nur, wenn mehr als ein Modus bespielt wurde.
10. localStorage-Schlüssel: `songrate:settings` (enthält auch `filters`),
   `songrate:stats`,
   `songrate:recent` (letzte 60 Songs, gegen Wiederholungen),
   `songrate:playlist` (aufgelöste Playlist), `songrate:plcache`
   (Titel → iTunes-Treffer), `songrate:plqueue` (Titelliste eines noch nicht
   fertigen Laufs). Das Präfix bleibt
   `songrate:`, obwohl die Seite Songraten heißt — Umbenennen würde alle
   bereits gespeicherten Einstellungen und Statistiken verwerfen.

## Testen der Pipeline ohne Netz

`python3 tools/test_pipeline.py` baut nachgebaute Eingaben zusammen (Kataloge
wie von Apple, Kandidaten wie von kworb, zwei Jahrescharts-Zeilen), lässt
`match_local.py` darauf laufen und prüft das Ergebnis: Stufen aus den
Streamgrenzen, Jahrescharts-Songs ohne Stufe mit Jahresplatz, Künstler-IDs,
Bekanntheit, zusammengeführte Doppel. Dazu laufen die `--selftest`-Parser aller
Skripte. Beide Workflows starten damit, bevor sie irgendwo anfragen.

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

## Automatische Aktualisierung

`.github/workflows/update-songs.yml` läuft monatlich (und auf Knopfdruck über
*Actions → Songs aktualisieren → Run workflow*): Jahrescharts holen, Titel bei
Apple suchen, Doppelte zusammenführen, `data/` committen. `.cache` liegt im
Actions-Cache, ein Lauf macht also dort weiter, wo der letzte aufhörte.

Vor dem Commit prüft ein Schritt die Datei: mindestens 1900 Songs, jeder mit
Titel und Preview, und nie weniger als vorher. Lieber nichts committen als eine
halbe `songs.json` ausliefern — die Seite bliebe weiß.

Was der erste echte Lauf gezeigt hat:

- **Wikipedia** drosselt nach etwa zehn schnellen Anfragen mit 429. Weil ein
  Fehlschlag ohne Pause zum nächsten Jahr sprang, kamen nur 1959–1968 an.
  Seitdem wird bei 429 gewartet und wiederholt.
- **Apple blockt aus GitHubs Rechenzentren viel härter als von zu Hause**: 56
  Anfragen in 17 Minuten, der Rest der Zeit war Warten. Deshalb läuft der
  Workflow täglich statt monatlich — und lokal geht es um ein Vielfaches
  schneller.

**Das erweitert nur den Jahrzehnte- und Genrebestand.** Der Chartsmodus hängt
an kworb, und dessen Vorstufe (`artists_top.json`, `candidates.json`, die
HTML-Schnappschüsse in `.cache`) liegt nicht im Repo. Ob Apple und Wikipedia
aus GitHubs Rechenzentren überhaupt antworten, ist ungetestet — der erste Lauf
zeigt es.

## Offene Punkte

1. **Apple drosselt den Katalog-Schritt.** *Charts neu bauen* lief durch, aber
   in 25 Minuten kamen nicht alle Kataloge zusammen — der erste Neubau hatte
   35 Chartsongs weniger, „Bohemian Rhapsody" verlor dabei seine Stufe. Die
   Prüfung lässt so einen Lauf inzwischen nicht mehr durch (weniger als 99 %
   der bisherigen Chartsongs = kein Commit), aber der eigentliche Weg zu einem
   vollständigen Bestand sind mehrere Läufe hintereinander: der Cache behält
   die Kataloge.
2. **Playlist-Modus.** Steht (siehe oben). Offen bleibt: die Trefferquote der
   iTunes-Suche ist bei Remixen und Live-Versionen mager. Wie lange Apple nach
   einem 403 wirklich dichthält, ist nicht dokumentiert — die Wartestufen sind
   geraten und müssen an echten großen Listen nachjustiert werden.

## Deployment

Dateien liegen im Repo-Wurzelverzeichnis, GitHub Pages auf `main` / root,
`.nojekyll` ist vorhanden. `index.html` muss direkt im Wurzelverzeichnis
liegen, sonst bleibt die Seite weiß.
