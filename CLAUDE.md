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

**Eine bewusste Ausnahme beim Login:** die Spotify-Anmeldung (siehe unten).
Sie ist freiwillig, braucht keinen Server (PKCE im Browser) und keinen
Schlüssel im Repo – nur eine Client ID, die kein Geheimnis ist. Ohne sie
läuft alles wie vorher. Gewünscht vom Besitzer der Seite.

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

Zur Laufzeit fragt die Seite nur an fünf Stellen nach, alle vom Nutzer
angestoßen und alle ohne Schlüssel: der **Playlist-Modus** löst Titel über die
iTunes-Suche auf, der **Künstlermodus** holt den Katalog bei Apple, der
**Mediathek-Server** ist der eigene, **song.link** liefert auf Wunsch die
genauen Links in der Auflösung, und **Spotify** gibt nach Anmeldung die
eigenen Playlists heraus. Nichts davon braucht ein Backend.

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

## Stufen: Prozent des Pools nach Bekanntheit

Früher feste Streamgrenzen (Easy ab 1,5 Mrd., Impossible 130–280 Mio.), die
die Pipeline als `d` in die Datei schrieb. Jetzt rechnet das Frontend die
Stufen selbst: der Pool wird nach Bekanntheit (`pop`) sortiert und nach
kumulativen Prozenten geschnitten (`applyTiers()`, `settings.tiers`). Fünf
Zahlen, streng steigend, 1–100 (`cleanCuts()`); was hinter der letzten liegt,
spielt mit Stufen nicht mit (`tierInfo.played`).

| Vorlage | Easy | Medium | Hard | Expert | Impossible |
|---|---|---|---|---|---|
| leicht | 5 | 12 | 22 | 35 | 50 |
| **normal** | 15 | 35 | 55 | 75 | 100 |
| schwer | 25 | 45 | 65 | 85 | 100 |

**Normal entspricht genau den alten Grenzen**: 15/35/55/75 % der 2971
gestreamten Songs sind 1,5 Mrd. / 750 / 440 / 280 Mio. — gleiche Stufen wie
vorher, nur anders ausgedrückt. Panel *Schwierigkeit* (links, `#tierPanel`):
Vorlagen, Balken, je Stufe ein Prozentfeld mit Songzahl und Streamgrenze an
der Unterkante, dazu der Anteil für *Nur Hits* (`settings.hitShare`).

**Bereiche** (`tierScope()`): `charts`, `dec-2010`, `gen-pop`. Der Schalter
*Eigene Grenzen für …* kopiert die geltenden Zahlen nach
`settings.tiers.scopes[key]`; von da an schreiben Vorlagen und Felder dorthin
(`writeCuts()`), sonst nach `settings.tiers.global`. Schalter aus löscht den
Eintrag. Gewünscht war Spielraum („2010er anders als 1950er"), deshalb je
Bereich und nicht je Modus.

`d` bleibt in der Datei als Marker „hat Streams" (`chartFiltered`,
`keep_extras`, Guards) und steuert in `match_local.py` nur noch, wie viele
Songs je Streambereich gesammelt werden. Neu dort: Band `deep` (50–130 Mio.,
`fetch_kworb.MIN_STREAMS` = 5e7) als Vorrat für ein tiefer gestelltes
Impossible. **Greift erst nach *Charts neu bauen*.** Der Guard verlangt für
`deep` erst dann 150 Songs, wenn es sie vorher schon gab.

### Bekanntheit (`pop`)

`addPop()` in `boot()`: Streams, wo es welche gibt. Für Songs aus den
Jahrescharts (keine Streams) eine **Schätzung**, damit sie in Jahrzehnt- und
Genrepools zwischen den gestreamten liegen statt pauschal unten: Median der
gestreamten Songs desselben Jahrzehnts (ab 12 Songs, sonst das nächste
Jahrzehnt) mal `10^((f−75)/50)` — Platz 1 (f = 100) das Dreifache, Platz 25
der Median, Platz 100 ein Dreißigstel. `s.est = true`, im Panel steht dann ≈.
Songs aus Playlist, Künstlerkatalog und eigener Musik bekommen `pop` über
`dbFind()` (`popOf()`), Unbekanntes bleibt hinten in bisheriger Reihenfolge
(`ranked()`).

**Der gemeldete Fehler:** im Genremodus hatte Medium mehr Streams als Easy.
Ursache war `f` aus `fame.py` — für gestreamte Songs der Rang **innerhalb des
Jahrzehnts**. Über Jahrzehnte hinweg (Genres!) stand damit der größte Song der
90er über einem viel öfter gestreamten der 2010er. Jetzt gilt in jedem Pool:
mehr Streams = bekannter, nie umgekehrt (`monotone()` in `test_ui.js` prüft
das in Charts, Jahrzehnten und Genres). `fame.py` läuft weiter, `f` wird nur
noch für die Schätzung gebraucht.

## Stufenlängen (`settings.ladder`)

`STAGES` ist ein `let`, beim Laden aus `settings.ladder` gesetzt (null =
`DEFAULT_LADDER`). `setLadder()` tauscht die Leiter, ohne die Runde zu
verlieren — `remapStages()` wie beim Abschalten einzelner Stufen; eigene
Dateien werden neu dekodiert, wenn die Leiter länger wird als der bisherige
Schnitt. Grenzen: `MIN_STAGE` 0,01, `MAX_STAGE` 20 (mehr passt nicht in eine
30-s-Preview mit Zufallsstart), 2–8 Stufen. Vorlagen in `LADDERS`, Editor im
Panel *Stufen → Längen anpassen* (`ladderDraft`, erst *Übernehmen* schreibt).

**Punkte hängen an der Zeit, nicht an der Stufennummer** (`pointsFor()`): die
alte Tabelle `POINTS` als Stützpunkte, dazu 20 s = 100, dazwischen linear im
Logarithmus der Sekunden. Für die Standardleiter kommt exakt das Alte heraus.

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

**Die Stufen sind hier relativ** — aber nach derselben Regel wie in den
Charts: `applyTiers(pickFiltered)` sortiert den Pool nach `pop` und schneidet
nach den Prozenten des Bereichs (siehe *Stufen*). Easy sind die obersten 15 %
der 80er, nicht die meistgestreamten Songs überhaupt.

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

## Künstlermodus

Vierter Modus. Man tippt einen Namen ins Feld *Künstler*, bekommt eine Auswahl
und mit einem Klick eine Runde aus dessen Songs. Der Katalog kommt **nicht**
aus `songs.json` — dort stehen pro Künstler nur die paar Songs, die es in die
Streamlisten geschafft haben. `assets/artist.js` fragt stattdessen Apple:

1. `entity=musicArtist` für die Auswahlliste — „billie" soll Künstler zeigen,
   keine wilde Songsuche.
2. `entity=song&attribute=artistTerm&limit=200` für den eigenen Katalog.
3. `entity=song&limit=200` ohne `attribute` für die Gastauftritte — so kommt
   „Gastsong (feat. …)" mit, der unter fremdem Künstlernamen läuft. Fällt diese
   zweite Anfrage aus, wird trotzdem gespielt, der Katalog allein reicht.

`tidy()` räumt auf: ohne `previewUrl` fliegt raus, ebenso alles, was nach
Remix, Live, Karaoke, Remaster, Sped Up, Cover oder Medley klingt (`BAD`) —
sonst besteht die halbe Runde aus Fassungen desselben Songs. Von Dubletten
bleibt die **älteste** Fassung, das ist meistens das Original. Danach müssen
mindestens `MIN_SONGS` (5) übrig sein, sonst bleibt der Modus gesperrt.

**Der Titel weist keinen Künstler aus.** `tidy()` hat lange `norm(artistName)
.includes(n) || norm(trackName).includes(n)` geprüft — und damit „A$AP &
Rihanna" von CÉLINE in eine Rihanna-Runde gelassen, einen deutschen Rapsong.
`belongs()` prüft jetzt drei Dinge, alle eng: Apples `artistId` trifft, der
Name steht als **eigenes Wort** im Künstlerfeld (`wort()` setzt Leerzeichen
als Grenze, was nach `norm()` reicht), oder er steht **hinter einer
Feature-Angabe** im Titel (`feat.`, `ft.`, `featuring`, `with`). Ein Name
irgendwo im Titel zählt nicht mehr.

**Fassungen, die man am Anfang nicht unterscheiden kann.** „Only Girl (In the
World)" und „Only Girl (In the World) [Extended Club]" klingen die ersten
Sekunden identisch — die Wahl zwischen beiden wäre geraten, nicht gewusst.
`plain()` gruppiert deshalb nach dem Titel **ohne angehängte Klammerzusätze**
(`base()`, mehrfach angewandt, weil der Extended-Titel zwei davon hat) und
behält je Gruppe den kürzesten Titel. Gibt es nur die eine Fassung, bleibt sie
— die Regel wirft nie den einzigen Vertreter weg.

**Keine Stufen, fünf zufällige Songs.** Nach Bekanntheit sortieren ginge nur
über die Streamzahlen, die es hier nicht gibt — und wäre auch falsch: bei einem
Künstler mit einem einzigen großen Hit wäre der als Easy sofort geraten.

Geladene Kataloge liegen in `songrate:artists` (die letzten 12), ein zweiter
Besuch kostet keine Anfrage. Sie tragen einen **Versionsstempel**
(`CACHE_VER`): ändert sich `tidy()`, steckt im Speicher sonst weiter genau
das, was gerade erst aussortiert wurde — beim Hochzählen wird jeder alte
Katalog verworfen und beim nächsten Besuch neu geholt. Die Pfeile oben springen durch die geladenen
Künstler. Eigener Regelsatz: `settings.arFilters`.

## Playlist-Modus

Apple Music und YouTube wollen für Playlists einen Server (signierter
Developer-Token bzw. OAuth mit Secret). Spotify geht seit PKCE ohne – mit
eigener App, siehe *Spotify-Anmeldung*. Für alles andere der Umweg über einen
Export. Eingelesen werden CSV, TSV, TXT, M3U und JSON — Exportify
(Spotify), TuneMyMusic, Soundiiz, „Playlist exportieren" in der Musik-App und
Google Takeout decken damit alles Übliche ab, notfalls tut es eine eingefügte
Liste „Titel – Künstler".

`assets/playlist.js` erkennt Trennzeichen und Spalten selbst (Aliasliste für
Titel/Künstler/Album). Ohne erkennbare Kopfzeile werden die ersten zwei Spalten
genommen; bei Freitextzeilen ist unklar, welche Hälfte der Titel ist, deshalb
wird beim Bewerten **beide Reihenfolgen** geprüft (`loose`).

### Auflösen: schnellster Weg zuerst

Ein Import ist ein **Auftrag** (`Playlist.job()`): jeder Titel steht unter
`found`, `missed` oder noch in `pending`. Der Lauf (`Playlist.run()`) nimmt
immer `pending[0]` – kein `for … of` über eine feste Liste, sonst ginge
Vorziehen nicht. Aufgelöst wird in vier Stufen:

1a. **ISRC** (`lookupIsrc`, Stufe zwischen Cache und Katalog). Exportify,
   TuneMyMusic und Soundiiz schreiben die Kennung der Aufnahme in die CSV
   (`ISRC_KEYS`, Format `^[A-Z]{2}[A-Z0-9]{3}\d{7}$`), Spotify liefert sie
   seit 2026 nicht mehr. `lookup?isrc=A,B,C` holt bis zu `ISRC_BATCH` (20)
   Aufnahmen je Anfrage, **exakt, ohne Raten** – auch Titel, die bei Apple
   anders heißen. Die Antwort trägt den Code nicht mit, deshalb ordnet
   `pick()` die Treffer zu; was übrig bleibt, bekommt einen einzelnen
   Nachschlag (`x.isrcSingle`), bei dem jede Antwort der Titel ist. Ob Apple
   mehrere Codes nimmt, ist hier nicht prüfbar (kein Netz): bleibt eine
   Sammelantwort leer, geht die Gruppe einzeln (`isrcDoubt`), und erst ein
   einzelner Treffer beweist, dass Listen nicht gehen (`isrcBatch = false`).
   Bei der Classics-Liste des Besitzers haben alle 233 Zeilen eine ISRC.
   Erst was keinen Code hat oder nicht gefunden wird, läuft weiter:

1. **Ohne Anfrage** (`prefill`): Cache (`songrate:plcache`) und
   `songs.json` über `localFind()` → `dbFind()`. Verglichen wird der
   **Grundtitel** (`Playlist.base()`: ohne „- 2005 Remaster", ohne
   angehängte Klammern) und der Künstler über die Namen einzeln
   (`Playlist.names()`/`fits()`). Bei der Classics-Liste des Besitzers (233
   Titel, Exportify) kamen so 149 sofort. Der Treffer bringt in `an` die
   Beteiligten aus `songs.json` mit, sonst wäre „Levitating" für DaBaby nicht
   mehr gelb.
2. **Künstlerkatalog** (`catalog()`): stehen `BATCH_MIN` (2) offene Titel
   desselben ersten Künstlers an, holt **eine** Anfrage mit
   `attribute=artistTerm&limit=200` alle; zugeordnet wird nur bei gleichem
   Grundtitel (`pick()`), der Rest geht einzeln. Kataloge liegen gekürzt
   (`trim()`, ~40 KB) in **IndexedDB** (`Local.kvGet/kvPut`, Speicher `kv`,
   Datenbank-Version 2) für `CATALOG_DAYS` (45) – im localStorage passten
   davon nur eine Handvoll. In der Classics-Liste decken 43 Künstler 199 der
   233 Titel.
3. **Einzelsuche in Stufen** (`searchOne()` → `queries()`). Apples Suche
   findet nur, was **jedes** Wort trägt – „Sweet Dreams (Are Made of This) -
   2005 Remaster Eurythmics;Annie Lennox;Dave Stewart" liefert nichts. Genau
   daran ist bei der Classics-Liste die Hälfte gescheitert. Deshalb: Grundtitel
   + erster Künstler (DE), dann nur der Grundtitel mit 25 Treffern (DE), dann
   wie zuerst im US-Store. „JAŸ-Z", „Beyoncé" und typografische Apostrophe
   glättet `glatt()`. Erst wenn keine Stufe sicher trifft, entscheidet die alte
   Punktwertung (≥ 2,5) über alles Gesammelte.

Der erste Künstler (`leadOf()`): steht ein Semikolon drin (Exportify,
Spotify), trennt nur das – „Earth, Wind & Fire" bleibt ganz. Spotify liefert
ihn zusätzlich als `lead`.

**Takt** (`pace`): Apple dokumentiert rund 20 Anfragen je Minute. Mit festen
260 ms lief der Import in die Sperre, wartete 30 s, lief wieder hinein,
wartete 60 s … – daher „Stunden für 200 Songs". Jetzt ein Regler: Start bei
`PACE_MIN` (300 ms), nach einer Sperre `max(3 s, ×2)` bis `PACE_MAX` (10 s),
nach `PACE_STREAK` (40) sauberen Anfragen wieder ×0,7. Die Wartestufen (30,
60, 120, 240, 300 s) bleiben als Netz; der Lauf bricht nicht ab, sondern
macht an derselben Stelle weiter. Der Fortschritt zeigt die **Restzeit**
(`plEta()`, aus dem Tempo dieses Laufs). **Der Fortschritt bleibt
dabei stehen** – früher hat „Apple bremst – weiter in 30 s" ihn ersetzt, jetzt
steht die Wartezeit in `#plSub` darunter, der Balken (`#plBar`, grün gefunden,
grau fehlt) bleibt, und die zugeklappte Zeile sagt „149/233 · Pause 30 s".

**Spielen, während noch gesucht wird.** Jeder Treffer meldet sich über
`onFound`, `plSync()` zieht die Playlist (gedrosselt auf 250 ms) nach. Ab
`PL_MIN` Songs ist der Modus frei; ist in der laufenden Runde noch nichts
passiert (`roundUntouched()`), wird gleich gewechselt. Eine **alte** Playlist
bleibt stehen, bis die neue für eine Runde reicht (`j.own`) – sonst wäre der
Modus in den ersten Sekunden einer neuen Suche gesperrt.

**Gespeichert** wird die Titelliste jetzt auch **fertig** (`songrate:plqueue`,
mit `own` und den Schlüsseln der fehlenden), damit man nach dem Neuladen noch
sieht, was fehlt. `Playlist.revive()` setzt den Auftrag aus Liste und
gespeicherter Playlist wieder zusammen: Songs mit `q` (Schlüssel des Titels)
gehören zum Auftrag, Songs ohne `q` kamen von Hand dazu und bleiben als
`extra`. Treffer liegen in `songrate:plcache`; Fehlschläge nur in der
Sitzung (`misses`), außer die Titelliste hat sie als fehlend gespeichert.
Übernommen wird nur, was `previewUrl` hat.

### Titelliste: sehen, was fehlt, selbst nachhelfen

`#imp`, geöffnet über *Titelliste ansehen* im Panel. Drei Reiter (Gefunden /
Offen / Fehlt), je Zeile:

- **Offen**: Vorziehen (`Playlist.prio()`), läuft nichts, geht es los.
  Mit Suchbegriff: „Diese n vorziehen".
- **Fehlt**: ↻ (`Playlist.retry()`, auch für alle), Lupe.
- **Gefunden**: ▶, Lupe (anderen Song zuordnen), ✕ falscher Treffer
  (`Playlist.assign(j, key, null)`: Cache-Eintrag weg, Titel nach *Fehlt*).
  Weicht der Grundtitel ab, steht das Original gelb darunter.

Die Lupe klappt eine Suche unter der Zeile auf (`impFinder()`), vorbelegt mit
`Playlist.hintOf()` – Grundtitel und erster Künstler, also genau das, was die
Automatik zuerst probiert. Ein Klick ordnet zu (`assign`, landet im Cache,
überlebt also das Neuladen). Während eines Laufs wird die Liste laufend
nachgezeichnet, **aber nicht, solange eine Suche offen ist** – sonst
verschwände das Feld beim Tippen. Ordnet man einen Titel zu, der gerade
gesucht wird, verwirft der Lauf sein spätes Ergebnis (`pending.includes`).

Im Modus selbst: keine Schwierigkeitsstufen, fünf zufällige Songs aus der
Liste, Faktor 1,0, Vorschläge im Suchfeld nur aus der Playlist. Die Filter
gelten hier genauso — ein importiertes Album bringt gern Instrumental- und
Karaokefassungen mit, die die Standardregel wegräumt. Die
Ausschnittlängen (0,01–15 s) bleiben. Unter fünf gefundenen Songs bleibt der
Modus gesperrt. Künstler-IDs werden hier lokal vergeben: der komplette
Künstlerstring plus die Einzelnamen — ein falscher Schnitt färbt hier
höchstens einen Tipp gelb, anders als in der Pipeline.

## Eigene Musik vom Gerät

Sechster Modus, unabhängig von allem anderen: gespielt wird aus Dateien, die
auf dem Gerät liegen. **Hochgeladen wird nichts** — der Browser darf die
gewählten Dateien lesen, das reicht, und genau deshalb passt der Modus zur
harten Randbedingung.

Zwei Wege hinein, weil nicht jeder Browser beide kann:

1. `showDirectoryPicker()` (Chrome, Edge): der Ordner-Handle landet in
   IndexedDB (`songraten` → `handles` → `dir`) und wird beim nächsten Besuch
   wieder geöffnet. Steht die Freigabe noch (`queryPermission` = `granted`),
   ist die Mediathek einfach da; sonst erscheint *Ordner wieder freigeben* —
   `requestPermission` braucht eine Nutzergeste, das lässt sich nicht umgehen.
2. `<input webkitdirectory>`, einzelne Dateien und Ziehen-und-Ablegen
   (überall, auch Safari und Firefox). Nach dem Neuladen muss der Ordner
   erneut gewählt werden; der Browser gibt keine Dateirechte über die Sitzung
   hinaus.

Damit der zweite Weg nicht jedes Mal Minuten kostet, liegen die gelesenen
Tags in `songrate:localmeta`. Erkannt wird eine Datei an Pfad, Größe und
Änderungsdatum — dann muss sie nicht noch einmal geöffnet werden.

### Tags selbst lesen

`assets/tags.js` zerlegt ID3v2 (2.2/2.3/2.4, auch unsynchronisiert und
UTF-16), ID3v1, die Atome von MP4/M4A, Vorbis-Kommentare in FLAC, Ogg und
Opus sowie die INFO-Liste in WAV. Ein Paket dafür wäre bequemer, ist aber
verboten. Gelesen wird immer nur der Anfang der Datei über `slice()` — ein
Album FLACs sind schnell zwei Gigabyte.

Das Titelbild wird **nicht** mitgeschleppt, sondern nur seine Lage gemerkt
(`{off, len, type}`) und erst bei der Auflösung herausgeschnitten. Tausend
Cover im Speicher wären sonst der Preis für eine Mediathek.

Findet sich nichts, entscheidet der Pfad: „Künstler/Album/03 - Titel.flac"
sagt genug. Die führende Titelnummer fällt nur weg, wenn sie sich als solche
zu erkennen gibt (führende Null oder ein Trennzeichen) — sonst verlöre
„99 Luftballons" seinen Namen.

`tools/test_tags.js` baut sich zu jedem Format eine Datei und prüft das
Ergebnis; die Bausteine nutzt `test_ui.js` mit.

### Warum der Ausschnitt gleich beim Dekodieren fällt

Eine lokale Datei ist ein ganzer Song, keine 30-Sekunden-Preview. Eine Minute
Stereo belegt dekodiert rund 20 MB — fünf Songs einer Runde wären ein halbes
Gigabyte. `Audio2.loadFile()` dekodiert deshalb zwar die ganze Datei (aus
einem Ausschnitt der **Rohdatei** bekäme man bei FLAC oder AAC nichts
Brauchbares), schneidet aber sofort auf 23 Sekunden zusammen und lässt den
großen Puffer fallen. Aus demselben Grund wird im Modus **nacheinander**
geladen, nicht alle fünf gleichzeitig (`roundToken` bricht ab, wenn
zwischendurch eine neue Runde beginnt).

Geschnitten wird immer nach der längsten Stufe, nicht nach der gerade
eingeschalteten — sonst fehlt Ton, wenn mitten in der Runde eine längere
Stufe dazukommt.

`firstSound()` überspringt die Stille am Anfang: 0,01 s Rauschen wären als
Rätsel eine Zumutung. Damit spielt der Modus als einziger tatsächlich „ab
Songanfang" wie das Original — mit Apples Previews geht das nicht.

### Sonst wie die Playlist

Keine Stufen, fünf zufällige Songs, eigener Regelsatz (`settings.loFilters`),
Vorschläge nur aus der eigenen Musik, eigene Zeile in der Statistik
(`local`). Die Voreinstellung *ohne Instrumental* räumt Karaoke- und
Instrumentalfassungen weg, die ein gezogenes Album gern mitbringt. Unter
`Local.MIN` (5) Songs bleibt der Modus gesperrt. Die Auflösung nennt die
Datei und öffnet sie auf Klick über eine Objekt-URL, die beim Schließen
wieder freigegeben wird.

## Mediathek vom eigenen Server

Dieselbe Spielweise wie „Eigene Musik", nur kommen die Songs nicht von der
Platte, sondern von **Subsonic** (Navidrome, Airsonic, Gonic), **Jellyfin**
(auch Emby) oder **Plex**. Alle drei haben eine offene REST-Schnittstelle
ohne OAuth und ohne registrierte App — deshalb geht das trotz der harten
Randbedingung. `assets/server.js` hält die drei Clients.

Zwei Dinge müssen beim Nutzer stimmen, und beides lässt sich von hier aus
nicht erzwingen:

1. **https.** Die Seite läuft über https und darf nichts von http nachladen —
   der Browser bricht das kommentarlos ab. Die typische Heimnetzadresse
   (`http://192.168.…`) geht also nicht; es braucht Reverse Proxy, Tailscale,
   Cloudflare Tunnel oder bei Plex die dafür gedachte `*.plex.direct`-Adresse.
2. **CORS.** Navidrome, Jellyfin und Plex erlauben fremde Herkunft von Haus
   aus, ältere Airsonic-Versionen nicht immer.

Weil `fetch` beide Fälle im `catch` gleich aussehen lässt (ein nacktes
`TypeError`), rät `hint()` anhand des Schemas: steht `http:` in der Adresse
und `https:` in der Seite, ist es Mixed Content — sonst wird nach Adresse,
laufendem Server und CORS gefragt. „Fehler beim Laden" hilft niemandem.

Details, die leicht schiefgehen:

- **Subsonic** will `t=md5(passwort+salt)`. Eine Bibliothek dafür ist
  verboten, also steht MD5 in `server.js` — geprüft gegen Nodes `crypto`.
  Die Songliste kommt über `search3` mit leerem Suchbegriff (Navidrome gibt
  dann alles heraus); wo das nichts liefert, wird `*` versucht.
- **Jellyfin** meldet sich über `/Users/AuthenticateByName` an und braucht den
  `X-Emby-Authorization`-Kopf mit einer festen Geräte-ID
  (`songrate:device`) — sonst legt der Server bei jedem Besuch ein neues Gerät
  an. Ein API-Schlüssel geht auch, dann bleibt der Benutzername leer.
- **Plex** kennt keinen Benutzernamen, nur den `X-Plex-Token`. Gespielt wird
  die Datei direkt (`/library/parts/…`), Plex' Transkodierung ist zu
  umständlich für den Zweck.

Gespielt wird bei Subsonic und Jellyfin ein auf 192 kbit/s umgerechnetes MP3
— der Server rechnet das selbst, und eine 40-MB-FLAC pro Rateversuch über die
Leitung zu ziehen wäre unsinnig. Ansonsten läuft alles wie bei lokalen
Dateien: `Audio2.loadFile()` nimmt eine Adresse genauso wie eine Datei,
schneidet den Ausschnitt heraus und lässt den Rest fallen.

Zugangsdaten liegen in `songrate:server`, unverschlüsselt — das steht auch so
im Panel. Der Schalter *Zugang merken* lässt sich abschalten, *Zugang
vergessen* räumt ihn weg, und *Eigene Musik entfernen* nimmt ihn mit: sonst
wäre die Mediathek nach dem Neuladen sofort wieder da.

**Ungetestet gegen echte Server.** In der Entwicklungsumgebung gibt es kein
Netz; geprüft ist gegen nachgebaute Antworten (`tools/test_ui.js`), dass die
Anfragen richtig gebaut und die Antworten richtig gelesen werden. Ob ein
konkreter Server CORS erlaubt, zeigt erst der Versuch.

## Songliste ansehen, entfernen, zurückholen

„Was steckt da eigentlich drin?" beantwortet ein Overlay (`#browse`, Knopf
*Songs ansehen* links unter den Rundenpunkten und unten in der Songauswahl).
Gezeigt wird **genau `activePool()`** — also das, was auch wirklich gezogen
werden kann, im Chartsmodus mit Stufen zum Beispiel nicht die Songs aus den
Jahrescharts. Die Überschrift nennt den Bereich über `filterScope()`.

Gezeichnet wird seitenweise (`BROW_PAGE`, 40), nachgeladen beim Scrollen ans
Ende und über „n weitere" — 4000 Zeilen auf einmal braucht kein Browser. Das
Suchfeld filtert die Liste über Titel und Künstler.

Je Zeile drei Knöpfe: **▶** hört zehn Sekunden rein (`previewSong()` nimmt
Preview, lokale Datei oder Serveradresse), **↗** klappt die Dienste auf
(dieselbe Reihe wie in der Auflösung, samt song.link-Nachschlag), **✕** nimmt
den Song aus der Auswahl.

### Entfernte Songs

`settings.blocked` ist eine Liste `{key, t, a}` und gilt in **jedem** Modus.
Der Schlüssel ist `norm(titel) + '|' + norm(künstler)` (`songKey()`) und
bewusst **nicht** Apples Track-ID: die wäre genauer, träfe aber nur im selben
Pool — wer einen Song in den Charts wegräumt, will ihn auch in der eigenen
Playlist nicht mehr sehen. `unblocked()` hängt in `applyFilters()` an jedem
Pool.

Der Reiter *Entfernt (n)* zeigt sie mit ↺ zum Zurückholen, darunter steht
„Alle entfernten zurückholen". Beim Entfernen wird **nur die eine Zeile**
aus dem DOM genommen, nicht die Liste neu gezeichnet — sonst stünde man nach
dem Aussortieren des sechzigsten Songs wieder ganz oben.

Die Vorschläge im Suchfeld des Spiels enthalten entfernte Songs weiterhin:
sie sind keine Lösung mehr, aber tippen können soll man sie dürfen.

## Fünf gestuft oder fünf zufällig

`settings.draw` (`'tiers'` oder `'random'`, Panel *Spielweise*) schaltet die
Stufen global ab: `usesTiers()` liefert dann überall `false`, also fünf
gleichwertige Plätze aus `shuffled(activePool())`. Wie bei den Filtern bleibt
die **laufende Runde unangetastet**, es gilt ab der nächsten.

Ein Nebeneffekt mit Absicht: ohne Stufen zieht der Chartsmodus aus `filtered`
statt aus `chartFiltered`. Die Songs aus den Jahrescharts haben keine
Streamzahl und damit keine Stufe — einsortieren kann man sie nicht, mitspielen
lassen sehr wohl. Aus 1913 werden so über 4000.

## Nur Hits

Gewünscht als Modus „für Erfolgserlebnisse", hieß kurz „Heimspiel" (der Name
gefiel nicht). Schalter im Panel *Modus* (`settings.hits`), der sich mit
**jedem** Modus kombiniert: gezogen wird aus `hitPool(basePool())` –
`activePool()` ist dafür in `basePool()` und die Hülle geteilt. Keine Stufen
(`usesTiers()` ist dann `false`), die Plätze heißen „Hit 1"–„Hit 5"
(`HIT_SLOTS`, `hit: true`), in der Statistik ein eigener Schlüssel `hits`.

Genommen werden die obersten `settings.hitShare` Prozent (Feld im Panel
*Schwierigkeit*, voreingestellt 20) der Songs mit bekanntem `pop`, mindestens
`HIT_MIN` (10). In den Charts zählen nur gestreamte Songs (`chartFiltered`) —
ein Jahressieger von 1962 ist dort kein Hit.

Wie die Spielweise gilt es **ab der nächsten Runde** (Fallstrick 2), die
Notiz darunter verweist auf *Alle neu würfeln*. Ohne Stufen werden zuletzt
gespielte Songs nach hinten gemischt, sonst fiele im kleinen Pool die
Wiederholung auf.

## Spotify-Anmeldung

`assets/spotify.js`, Panel *Eigene Playlist → Von Spotify*. Ausdrücklich
gewünscht, deshalb die Ausnahme oben.

- **PKCE ohne Server**: `login()` legt Verifier und State in
  `songrate:spotify` ab und schickt zu `accounts.spotify.com/authorize`;
  `callback()` (beim Start) prüft den State, tauscht den Code gegen ein Token
  und macht die Adresse wieder sauber. Refresh-Token werden genutzt und, wenn
  Spotify sie austauscht, ersetzt.
- **Die App des Besitzers ist eingebaut** (`CLIENT_ID` in `spotify.js`,
  Redirect-URI `https://buschiiii.github.io/Songraten/`). Wer dort nicht
  unter *User Management* freigeschaltet ist, klappt über *eigene App
  verwenden* die Anleitung auf und trägt seine eigene Client ID ein – die
  gewinnt (`ownId()`). Redirect-URI ist `redirectUri()`, die Seite ohne
  `index.html`, und muss im Dashboard exakt so stehen.
- **Fremde Playlists sind antippbar**, nur abgeblendet. `readable` ist eine
  Vermutung aus Besitzer und `collaborative`; ob Spotify die Titel herausgibt,
  zeigt der Versuch, und bei 403 nennt die Meldung Besitzer und Ausweg (in
  eine eigene Playlist kopieren oder Exportify). Beim ersten echten Login
  stand die eigene „classics" als nicht lesbar da – sie gehört einem
  anderen Konto (`Added By` im Export).
- **Stand März 2026** (Entwicklungsmodus): Titel nur aus eigenen oder
  gemeinsamen Playlists und den Lieblingssongs (`me/tracks`); fremde stehen
  ausgegraut da. Der Endpunkt heißt `playlists/{id}/items`, der Song darin
  `item` statt `track` – gelesen wird beides. Keine `external_ids`/ISRC mehr.
  Premium beim Besitzer der App, höchstens fünf Nutzer.
- **Kein Ton von Spotify**: `preview_url` gibt es für neue Apps seit Ende 2024
  nicht. Spotify liefert nur Titel, Künstler (mit `;` wie Exportify, dazu
  `lead`) und Album; die Liste geht durch `startImport()` wie eine Datei.
- `Spotify.nav.go` ist austauschbar, damit der Test nicht wegnavigiert.

**Die Anmeldung läuft im Echten** (Besitzer, 1. Oktober: 196 Playlists
gelistet). Die Umgebung selbst kommt weder an `accounts.spotify.com` noch an
`api.spotify.com`; geprüft wird gegen nachgebaute Antworten im Format von
2026.

## Playlist: einzeln hinzufügen

Eine Playlist muss nicht aus einer Datei kommen. Das Suchfeld im Panel
*Eigene Playlist* fragt dieselbe iTunes-Suche (`Playlist.find(q, 'song'|'album')`),
ein Klick legt den Song dazu; bei einem Album holt `Playlist.albumTracks(id)`
über `lookup?id=…&entity=song` alle Titel. Ohne `previewUrl` fliegt ein Titel
raus, Doppelte fängt `Playlist.dedupe()` ab. Gespeichert wird wie beim Import
über `Playlist.store()`, gibt es noch keine Playlist, entsteht sie dabei.

## Nachhören: Links statt eines Dienstes

Die Auflösung verlinkte früher nur zu Apple Music. Abfragen lässt sich keiner
der Dienste ohne registrierte App und Login, aber **jeder hat eine Suchseite,
die sich per URL aufrufen lässt** — das reicht: Titel und Künstler
hineinschreiben, der Rest ist Sache des Dienstes. Kostet keine Anfrage und
funktioniert auch für Songs, die nur lokal auf der Platte liegen.
`assets/links.js` hält die Liste (Apple, Spotify, YouTube Music, YouTube,
Deezer, Tidal, Qobuz, Amazon Music, SoundCloud, Bandcamp, Discogs).

Genauer geht es mit **`k`, Apples Track-ID**: `song.link/i/<k>` (Odesli) löst
sie in einen Link je Dienst auf — auf die richtige Aufnahme statt auf eine
Suche. Deshalb schreiben `match_local.py` und `add_decades.py` die ID mit, und
Playlist wie Künstlerkatalog übernehmen sie von Apple. Fehlt sie (ältere
`songs.json`, lokale Dateien), bleibt es bei der Suche — deshalb stehen die
Einzellinks weiterhin daneben und nicht nur der Sammellink.

### Genau diese Aufnahme statt einer Trefferliste

Ein Suchlink landet auf einer Ergebnisliste; man will aber auf den Song. Bei
eingeschaltetem `settings.exact` (Voreinstellung) fragt `Links.exact()` einmal
je Song die Odesli-API (`api.song.link/v1-alpha.1/links?platform=itunes&
type=song&id=<k>`) und ersetzt die Suchadressen durch die echten. Ein grüner
Punkt am Chip zeigt, dass der Link genau trifft.

Wichtig dabei:

- **Angemeldet ist man sowieso.** Der Link geht in den eigenen Browser, dort
  läuft die Sitzung bei Spotify, Tidal oder Qobuz weiter. Die Seite selbst
  kann sich nirgends anmelden und muss es auch nicht — sie spart nur den
  Umweg über die Trefferliste.
- Gerendert wird **sofort mit der Suche**; die genauen Adressen kommen
  nachträglich und tauschen nur das `href`. Wer schneller klickt, landet
  trotzdem richtig.
- Treffer liegen in `songrate:links` (300 Songs), ein zweiter Blick kostet
  keine Anfrage. Ohne Schlüssel lässt Odesli rund zehn Anfragen je Minute
  durch, deshalb die Bremse bei acht — und bei Fehler, 429 oder fehlendem `k`
  bleibt einfach die Suche stehen.
- **Qobuz und Bandcamp kennt Odesli nicht.** Dort bleibt es bei der Suche im
  jeweiligen Player, und das ist verschmerzbar: eingeloggt ist man, es kostet
  einen Klick mehr.

Der Lieblingsdienst (`settings.service`) steht in der Auflösung — und zwar
**nur er**, dazu der Sammellink; die übrigen kommen über „+ n weitere"
(`settings.svcAll`, bleibt dann so). Ein gespeicherter Dienst, den es nicht
mehr gibt, fällt beim Laden auf Apple zurück.

Zwei Adressen zeigten auf den falschen Ort: `qobuz.com` ist der Kaufladen,
gespielt wird auf `play.qobuz.com`. Bandcamp, Discogs und der Qobuz-Shop
stehen deshalb als `shop: true` hinten und leicht abgeblendet.

**Anmelden und direkt abspielen geht nicht.** Spotifys Web Playback SDK
bräuchte eine registrierte App, Premium und ein Fremdskript — und könnte
trotzdem keine 0,01 Sekunden schneiden, weil Seek und Play dort im
Zehntelsekundenbereich liegen. Apples MusicKit will einen signierten
Developer-Token, also einen Server. Wer direkt abspielen will, nimmt die
eigene Musik oder den eigenen Mediathek-Server — dort läuft der Ton wirklich
aus der Seite heraus.

## Spielregeln

- 5 Songs pro Runde, einer je Stufe, jeder mit eigenem Fortschritt.
- Auf der letzten Stufe heißt der Knopf **Aufgeben**, nicht Überspringen —
  dort wird ja nichts mehr übersprungen.
- Falscher Tipp **oder** Überspringen schaltet eine Stufe weiter.
- Anzahl Versuche = Anzahl aktiver Stufen. Eine Stufe abzuschalten kostet
  deshalb auch einen Versuch, das ist Absicht.
- Rückmeldung: grün richtig, gelb Künstler stimmt, grau daneben.
- Derselbe Künstler darf mehrfach in einer Runde vorkommen.
- Punkte nach gehörten Sekunden (`pointsFor()`, nicht nach Stufennummer) mal
  Stufenfaktor, damit unterschiedliche Stufenleitern vergleichbar bleiben.
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
*Stufen*, *Schwierigkeit* und *Statistik*; in der Mitte das Spielfeld; rechts *Modus* (mit dem
Schalter *Nur Hits*), *Eigene Playlist* (mit *Von Spotify*), *Künstler*, *Eigene Musik*, *Nachhören bei*, *Spielweise* und ganz
unten die *Songauswahl*. *Songs ansehen* öffnet von zwei Stellen aus
(`.js-browse`) die Songliste.

Auf schmalen Bildschirmen wird `.col-left` zu `display:contents`, damit
`.left-head` (order 1) oben bleibt und `.left-panels` (order 4) hinter das
Spielfeld und die Einstellungen rutscht — sonst müsste man an den Panels
vorbeiscrollen, um den Abspielknopf zu sehen. `#modeSeg` wird dort zweispaltig
und die Tastaturhilfe verschwindet.

### Alles klappt zu, und die Zeile sagt trotzdem Bescheid

Sechs Modi, drei Quellen und die Einstellungen — untereinander wäre das eine
Scrollstrecke, auf dem Handy erst recht. Deshalb ist jedes Panel ein
`<details class="panel" data-k="…">`; offen bleibt nur *Modus*, weil man dort
anfängt. Der Zustand liegt in `settings.open`.

Damit Zuklappen nichts verbirgt, steht in jeder Kopfzeile rechts der aktuelle
Wert (`panelSum()` → `.psum`): „Nachhören bei · Spotify", „Eigene Musik ·
1240 Songs", „Songauswahl · Charts · 1913 Songs · 1 Regel", und bei zu kleinem
Pool gelb. Damit muss man die meisten Panels nie aufmachen.
`renderPanelSums()` hängt an `render()` und an allem, was sich ohne `render()`
ändert (Lautstärke, Songstart, Stufen, Statistik, Filter, Quellen).

Die Überschrift der *Songauswahl* wurde früher umgeschrieben („Songauswahl ·
Playlist"). Das steht jetzt in der Zeile (`filterScope()`) — eine lange
Überschrift hätte den Wert rechts hinausgedrückt.

## Sicherheit

Die Seite verarbeitet Fremdes an fünf Stellen: Antworten von Apple, song.link
und Spotify, Dateien und Playlists des Nutzers, und was andere Tabs in den
localStorage geschrieben haben. Prüfung vom 1. Oktober, Befunde und was
daraus wurde:

- **Nur `textContent`, nie `innerHTML` mit Fremdem.** Die zwei `innerHTML`
  in `app.js` setzen feste SVG-Konstanten (`LUPE`, `NACH_VORN`). Damit das so
  bleibt, steht eine **Content-Security-Policy** im `<head>`: Skripte nur von
  hier, Stile nur von hier, Daten nur über https, kein `object`, kein
  `base`. Inline-Styles gibt es nicht (nur CSSOM, das ist erlaubt). Geprüft
  in Chromium: keine Verstöße.
- **`href` nur https.** Odesli-Antworten landen als Link im Dokument;
  `Links.safe()` lässt nur `https://` durch – beim Holen **und** beim Lesen
  aus dem Cache, denn `songrate:links` kann jeder Tab beschreiben. Ein
  `javascript:`-Link von dort wäre sonst ein Klick zur Codeausführung.
- **Das Spotify-Token geht nur an `api.spotify.com`.** `page.next` kommt aus
  der Antwort und wird als Adresse weiterverwendet – `api()` weigert sich,
  wenn sie nicht mit der API-Basis beginnt.
- **Tokens und Zugangsdaten liegen im localStorage**, unverschlüsselt
  (Spotify-Tokens, Mediathek-Passwort oder -Token). Mit CSP und ohne
  `innerHTML` ist das die übliche Lage einer statischen Seite; wer den
  Browser teilt, nutzt *Zugang vergessen* und *Bei Spotify abmelden*.
- **PKCE sauber:** Verifier und State liegen nur bis zur Rückkehr im
  Speicher, der State wird verglichen, die Adresse danach bereinigt, ein Code
  wird nie zweimal eingelöst. Die Client ID ist öffentlich und darf es sein.
- **Eigene Dateien** werden nur gelesen, nie hochgeladen. `tags.js` liest
  Längenfelder aus der Datei – eine negative WAV-INFO-Länge (`0x80000000`)
  hat die Schleife vorher **30 Sekunden** festgehalten, jetzt bricht sie ab.
  Alle anderen Parser haben Längenprüfungen und Schleifenwächter (`guard`).
- **Was an Dritte geht:** Titel und Künstler der eigenen Playlist an Apples
  Suche, Apples Track-IDs an song.link, nichts an sonst wen. Das steht so
  auch in der README.

### Was die Prüfung sonst gefunden hat

- **Speicherleck:** `Audio2.load()` hat jede dekodierte Preview für immer
  behalten – rund 10 MB je Song. Nach zwanzig Runden 1 GB; auf dem iPhone
  stirbt der Tab früher. Jetzt `CACHE_MAX` 12 (die Runde hält ihre fünf
  Puffer selbst).
- **Leertaste im Textfeld der Playlist** hat den Song abgespielt und
  Ziffern haben den Platz gewechselt – der globale Handler kannte nur
  `INPUT`, nicht `TEXTAREA`. Jetzt `closest('input, textarea, …')`.
- **Startfehler:** ohne `songs.json` pulsierte der Startbildschirm stumm
  weiter. Jetzt steht eine Meldung da.
- **Kaputte gespeicherte Grenzen** (`settings.tiers`) laufen beim Laden
  durch `cleanCuts()`.
- **Stufenlabel** eines fertigen Platzes jenseits einer kürzer gewordenen
  Leiter zeigte `undefineds`.
- **Leistung:** `Artist.all()` parste bei jedem Zeichnen der Panelzeilen
  zwölf Kataloge aus dem localStorage, `Filters.options()` sortierte bei
  jedem Filterklick 3000 Namen – beides jetzt gemerkt.
- **Spotify-Feld** für die eigene Client ID war mit der eingebauten
  vorbelegt; ein Klick auf *Anmelden* hätte sie als „eigene" gespeichert.

## Fallstricke im Frontend

0. **Einspaltige Raster brauchen `minmax(0,1fr)`, nicht `1fr`.** `1fr` heißt
   `minmax(auto,1fr)`: die Spalte nimmt die Breite vom längsten Inhalt ohne
   Umbruch. Zweimal passiert – in `.reveal` drückte „Moves Like Jagger -
   Studio Recording From …" die Titelliste über den Rand, und in `main` auf
   dem Handy machte die Panelzeile „Charts · Nur Hits · 595 Songs · 1 Regel"
   die ganze Seite 17 px zu breit. `width:100%` hilft dann nicht, es sind
   100 % einer zu breiten Spalte.
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
   `songrate:recent` (letzte 60 Songs, gegen Wiederholungen — als
   `songKey()`, **nicht** als Nummer im Pool: die verschiebt sich bei jedem
   Datenlauf, nach dem Update vom 13. September zeigten davon noch 26 von
   4222 auf denselben Song, und die Liste sperrte sechzig zufällige statt der
   gespielten),
   `songrate:playlist` (aufgelöste Playlist), `songrate:artists`
   (geladene Künstlerkataloge), `songrate:localmeta` (gelesene Tags der
   eigenen Musik), `songrate:server` (Zugang zum Mediathek-Server),
   `songrate:device` (Geräte-ID für Jellyfin), `songrate:links`
   (genaue Dienst-Links je Song), `songrate:plcache`
   (Titel → iTunes-Treffer, auch von Hand zugeordnete), `songrate:plqueue`
   (Titelliste des letzten Imports, auch fertig, mit `own` und den fehlenden),
   `songrate:spotify` (Client ID, Tokens, Verifier während der Anmeldung). Das Präfix bleibt
   `songrate:`, obwohl die Seite Songraten heißt — Umbenennen würde alle
   bereits gespeicherten Einstellungen und Statistiken verwerfen.

## Testen der Pipeline ohne Netz

`python3 tools/test_pipeline.py` baut nachgebaute Eingaben zusammen (Kataloge
wie von Apple, Kandidaten wie von kworb, zwei Jahrescharts-Zeilen), lässt
`match_local.py` darauf laufen und prüft das Ergebnis: Stufen aus den
Streamgrenzen, Jahrescharts-Songs ohne Stufe mit Jahresplatz, Künstler-IDs,
Bekanntheit, zusammengeführte Doppel. Dazu, dass ein Chartsneubau die
Jahrzehnt-Songs behält und ihre Künstler-IDs richtig umnummeriert. Dazu laufen die `--selftest`-Parser aller
Skripte. Beide Workflows starten damit, bevor sie irgendwo anfragen.

## Testen der Tags ohne Musikdateien

`node tools/test_tags.js` baut sich zu jedem Format eine Datei im Speicher
(ID3v2.2/2.3/2.4, ID3v1, M4A, FLAC, Ogg, Opus, WAV, dazu kaputte Tags und
Dateinamen) und prüft, was `assets/tags.js` daraus macht — auch, ob die
gemerkte Stelle des Titelbilds wirklich das Bild trifft. Läuft ohne jsdom.
Die Bausteine exportiert die Datei, `test_ui.js` baut damit die Testmediathek.

## Testen ohne Browser

jsdom reicht für die Logik und hat bisher fast jeden Fehler gefunden: `index.html` laden, `AudioContext` mocken,
`fetch` auf die lokale `songs.json` biegen, dann alle Skripte auswerten und
die Handler direkt aufrufen. Genau das macht `tools/test_ui.js` (`npm i
jsdom`, dann `node tools/test_ui.js`) — es spielt jeden Modus einmal durch.

Vier Stolpersteine dabei:

1. **Alle** Skripte müssen in **einem** `eval` zusammenhängen, sonst sieht
   `app.js` weder `Audio2` noch `Playlist`, `Filters`, `Links`, `Tags`,
   `Local` oder `Artist`.
2. `getContext` für das Konfetti-Canvas stubben.
3. `URL.createObjectURL` gibt es in jsdom nicht — der Test zählt stattdessen
   mit, was geöffnet und wieder freigegeben wurde.
4. `decodeAudioData` muss einen echten Puffer nachbilden (Kanäle, Rate,
   `getChannelData`), sonst lässt sich der Ausschnitt für eigene Dateien
   nicht prüfen. Am Byteumfang unterscheidet der Mock Preview von Datei.

**Für alles Sichtbare gibt es Chromium**: `/opt/pw-browsers`, Playwright
liegt global (`require('/opt/node22/lib/node_modules/playwright')`), nie
`playwright install`. Seite mit `python3 -m http.server` ausliefern, dann
Screenshots bei 1300 und 400 px Breite. So aufgefallen: das Play-Dreieck saß
6,8 px rechts der Mitte (jetzt über die viewBox `1 0 24 24` versetzt, halb
zwischen Kreismitte und Schwerpunkt), und die Titelliste lief auf dem Handy
über den Rand (Fallstrick 0). Netz hat auch Chromium hier nicht – Apple,
Spotify und song.link antworten nicht.

Vor jeder Auslieferung einmal durchspielen: Runde starten, raten,
überspringen, auflösen, neue Runde, Stufen umschalten, Neuwürfeln, Filter
setzen und entfernen, Playlist laden, im Playlist-Modus eine Runde beenden,
Künstler laden, eigene Musik einlesen, zurückschalten.

## Automatische Aktualisierung

`.github/workflows/update-songs.yml` läuft monatlich (und auf Knopfdruck über
*Actions → Songs aktualisieren → Run workflow*): Jahrescharts holen, Titel bei
Apple suchen, Doppelte zusammenführen, `data/` committen. `.cache` liegt im
Actions-Cache, ein Lauf macht also dort weiter, wo der letzte aufhörte.

Vor dem Commit prüft ein Schritt die Datei: mindestens 1900 Songs, jeder mit
Titel und Preview, und nie weniger als vorher. Lieber nichts committen als eine
halbe `songs.json` ausliefern — die Seite bliebe weiß.

**Er läuft.** Seit dem 5. September legt jeder Tag etwas nach. Der Guard hat
unterwegs nichts abgelehnt.

Eine Sache, die dabei aufgefallen ist: `built` blieb auf dem Tag des letzten
Chartsneubaus stehen, weil `add_decades.py` die Datei nur ergänzt. Setzt es
jetzt selbst.

**Stand nach dem Chartsneubau vom 13. September** (der erste, der
zusammenführt statt zu ersetzen):

| | 4. Sept. | 13. Sept. |
|---|---|---|
| Songs | 2733 | **5224** |
| davon mit Stufe | 1917 | **2977** |
| mit Track-ID `k` | 0 | **3679** |

Die 1950er bis 1990er liegen bei je 460 bis 490 statt bei 66 bis 174, und
jede Stufe hat zwischen 431 und 729 Songs. Die Track-ID fehlte den Chartsongs
vorher komplett, weil `match_local.py` sie erst seit der Änderung mitschreibt
und nur bei *Charts neu bauen* läuft — ohne sie gibt es nur Suchlinks statt
der genauen.

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

## Ein Chartsneubau darf nichts wegwerfen

`match_local.py` baut `songs.json` **komplett neu** — und kennt dabei nur, was
kworb und die Kataloge hergeben. Die über Wochen von `add_decades.py`
gesammelten Jahrzehnt-Songs (leeres `d`: keine Streamzahl, keine Stufe) stehen
dort nicht drin. Beim Stand vom 13. September wären das 2305 von 4222 Songs
gewesen, die ein Neubau stillschweigend verschluckt hätte.

Und es bleibt nicht dabei: auch **Chartsongs** verliert ein gedrosselter Lauf,
nämlich die, deren Künstlerkatalog nicht durchkam. Am 13. September waren das
54 von 1917 — genug, dass die Prüfung den Commit verweigerte.

Beides steht noch in der alten Datei. **`tools/keep_extras.py`** liest
`HEAD:data/songs.json` und übernimmt **jeden** Song, den der Neubau nicht
selbst gefunden hat, und bildet dabei die Künstler-IDs auf die neue
Künstlerliste ab — die Nummern zeigen in zwei Dateien woandershin, das ist die
Stelle, an der es sonst kaputtgeht. Danach `ensure_ids`, `merge_duplicates`,
`add_fame`.

**Damit ist ein Neubau kein Ersetzen mehr, sondern ein Zusammenführen:** was
der Lauf gefunden hat, gewinnt und bringt frische Streamzahlen mit; was er
nicht gefunden hat, bleibt mit seinen alten Werten stehen, statt zu
verschwinden. Genau deshalb kommt ein Neubau jetzt überhaupt durch — vorher
scheiterte er an seinen eigenen Lücken.

Der Schritt steht in `rebuild-charts.yml` **vor** `add_decades.py` (das holt
danach nur noch, was seitdem dazugekommen ist). Im Lauf vom 13. September hat
er getan, was er soll: aus 1863 frisch gebauten Chartsongs wurden 4032, statt
dass 2305 Songs verschwinden. Und die Prüfung vor dem Commit
verlangt jetzt auch für den **Gesamtbestand** mindestens 99 % des bisherigen,
nicht nur für die Chartsongs — genau dieser Fall wäre sonst durchgerutscht,
weil die Chartsongs ja vollzählig gewesen wären.

Zwei Actions-Caches, zwei Präfixe: `songraten-cache-` (täglicher Lauf, nur
`.cache`) und `songraten-charts-` (Neubau, `.cache` + `catalogs`). Der Neubau
sieht die Titelsuchen des täglichen Laufs also **nicht** — `restore-keys`
stellt immer nur einen Cache wieder her. Deshalb der Umweg über die alte
Datei statt über den Cache.

### Action-Versionen

`checkout@v7`, `setup-python@v7`, `cache/restore@v6` und `cache/save@v6` —
alle auf Node 24. Die Vorgänger (v4/v5) liefen noch auf Node 20 und wurden von
GitHub mit einer Warnung zwangsweise auf Node 24 gehoben; das funktionierte,
war aber auf Dauer keine Grundlage. Beim Anheben nachsehen, was aktuell ist,
statt eine Nummer zu raten.

### Ein gescheiterter Lauf muss seine Kataloge behalten

`actions/cache` sichert erst in seinem **Post-Schritt** — und der wird
übersprungen, wenn der Job fehlschlägt. Genau das ist im Lauf vom 13.
September passiert: 30 Minuten Kataloge geholt, danach an der Prüfung
gescheitert (1917 → 1863 Chartsongs), Cache verworfen. Der nächste Lauf hätte
wieder beim Stand vom 4. September angefangen und wäre genauso gescheitert —
eine Schleife ohne Fortschritt. Das erklärt rückblickend, warum „mehrere Läufe
hintereinander" als Rezept nie gegriffen hat.

Deshalb sind `restore` und `save` in beiden Workflows getrennt: *Cache holen*
(`actions/cache/restore`) am Anfang, *Kataloge sichern* (`actions/cache/save`,
`if: always()`) **vor** der Prüfung. Ein Lauf, der nichts committen darf, lässt
seine Kataloge trotzdem da, und der nächste baut darauf auf.

## Offene Punkte

1. **Apple drosselt den Katalog-Schritt** — in 30 bis 45 Minuten kommen nicht
   alle Kataloge zusammen. Das kostet jetzt keinen Bestand mehr (`keep_extras`
   trägt Fehlendes aus der alten Datei nach), aber die betroffenen Songs
   behalten ihre alten Streamzahlen, bis ihr Katalog einmal durchkommt. Über
   mehrere Läufe holt sich das ein, seit ein gescheiterter Lauf seine Kataloge
   im Cache lässt. Zeitbudget: 2700 s (45 min); mehr passt nicht ins Timeout
   von 90 Minuten, weil kworb 12 und `add_decades` 10 Minuten brauchen.

   Die Prüfung (99 % der Chartsongs, 99 % des Gesamtbestands) bleibt als Netz
   für echte Ausfälle — kworb baut seine Tabellen um, Apple antwortet gar
   nicht. Sie sollte jetzt nicht mehr regelmäßig auslösen; tut sie es doch,
   ist wirklich etwas kaputt.
2. **Playlist-Modus.** Steht (siehe oben). Die gestufte Suche ist gegen
   nachgebaute Apple-Antworten geprüft, nicht gegen echte – ob sie die
   Classics-Liste wirklich fast vollständig findet, zeigt der erste Lauf; was
   übrig bleibt, lässt sich in der Titelliste von Hand zuordnen. Wie lange
   Apple nach einem 403 wirklich dichthält, ist nicht dokumentiert — die
   Wartestufen sind geraten.
3. **Spotify** ist nur gegen nachgebaute Antworten geprüft (siehe oben).

## Deployment

Dateien liegen im Repo-Wurzelverzeichnis, GitHub Pages auf `main` / root,
`.nojekyll` ist vorhanden. `index.html` muss direkt im Wurzelverzeichnis
liegen, sonst bleibt die Seite weiß.
