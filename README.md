# Songraten

Erkenne den Song in 0,01 Sekunden. Fünf Songs pro Runde, von Easy bis Impossible,
nach echten Spotify-Streamzahlen sortiert.

Die Seite ist reines HTML/CSS/JavaScript. Kein Server, kein Build, keine Anmeldung,
keine Bibliotheken. Alles läuft im Browser.

**Sechs Arten zu spielen**

| Modus | Woraus gespielt wird |
|---|---|
| Charts & Stufen | die ganze Songliste, Easy bis Impossible nach Spotify-Streams |
| Jahrzehnte | ein Jahrzehnt, Stufen relativ dazu vergeben |
| Genres | ein Genre, Stufen relativ dazu vergeben |
| Künstler | alle Songs eines Künstlers samt Gastauftritten, fünf zufällige davon |
| Eigene Playlist | ein eigener Export, fünf zufällige Songs daraus |
| Eigene Musik | Dateien vom eigenen Gerät oder die Mediathek vom eigenen Server |

Dazu Filter für Genre, Künstler, Jahrzehnt und Instrumentals, die sich
kombinieren lassen.

---

## Website online stellen

1. Auf [github.com](https://github.com) einloggen, oben rechts **+** → **New repository**.
2. Namen vergeben, z. B. `songraten`. **Public** auswählen, sonst gibt es keine Pages.
   Kein Häkchen bei „Add a README file". Dann **Create repository**.
3. Auf der leeren Repo-Seite auf **uploading an existing file** klicken.
4. Das ZIP entpacken, den Ordner öffnen und **den Inhalt** in das Browserfenster ziehen —
   also `index.html`, `assets`, `data`, `tools`, `README.md`, `.nojekyll`.
   Nicht den umschließenden Ordner selbst, sonst liegt alles eine Ebene zu tief.
5. Unten auf **Commit changes** klicken und warten, bis alle Dateien hochgeladen sind
   (`data/songs.json` ist die größte Datei und braucht am längsten).
6. Oben im Repo auf **Settings** → links **Pages** → unter *Build and deployment*
   bei *Source* **Deploy from a branch**, darunter **main** und **/ (root)** wählen → **Save**.
7. Ein bis zwei Minuten warten, Seite neu laden. Oben steht dann die Adresse:

   ```
   https://DEIN-NAME.github.io/songraten/
   ```

Fertig. Jede spätere Änderung im Repo ist nach etwa einer Minute live.

## Nach Jahrzehnten oder Genres spielen

Rechts unter **Modus** auf *Jahrzehnte* oder *Genres*. Oben erscheinen dann
Pfeile, mit denen du durchspringst – gespielt wird nur aus dem Gewählten, und
die fünf Stufen werden **innerhalb** der Auswahl vergeben: Easy sind die
bekanntesten 20 % der 80er, nicht die meistgestreamten Songs überhaupt. Mit
Shift und den Pfeiltasten geht das auch über die Tastatur.

Sind zu wenige Songs da, um fünf Stufen zu füllen, wird ohne Stufen gespielt:
fünf zufällige Songs aus der Auswahl. Die Leiste schreibt es dazu.

Zu dünn besetzte Jahrzehnte und Genres stehen gar nicht erst zur Wahl. Wie du
mehr Songs bekommst, steht unter *Songs nachladen*.

## Nach einem Künstler spielen

Rechts im Feld **Künstler** den Namen eintippen und Enter drücken. Es kommt
eine Auswahl, ein Klick darauf lädt den Katalog direkt bei Apple – den eigenen
und die Gastauftritte, also auch das Feature auf einer fremden Platte. Remixe,
Live- und Karaokefassungen bleiben draußen, von mehreren Ausgaben desselben
Songs bleibt die älteste.

Gespielt werden **fünf zufällige Songs ohne Stufen**. Bei einem Künstler mit
einem einzigen großen Hit wäre der als Easy sonst sofort geraten. Wer weniger
als fünf brauchbare Songs hat, lässt sich nicht auswählen.

Die letzten zwölf Kataloge bleiben im Browser gespeichert, ein zweiter Besuch
geht ohne Warten. Mit den Pfeilen oben springst du zwischen ihnen hin und her.

## Mit der eigenen Musik spielen

Rechts unter **Eigene Musik** auf *Ordner wählen* – oder den Ordner einfach
ins Fenster ziehen. **Hochgeladen wird nichts**: die Dateien bleiben auf dem
Gerät, der Browser darf sie nur lesen. Gelesen werden MP3, M4A/AAC, FLAC,
Ogg, Opus, WAV und AIFF; Titel, Künstler, Album, Jahr, Genre und Titelbild
kommen aus den Tags, notfalls aus dem Dateinamen und dem Ordner
(„Künstler/Album/03 - Titel.flac").

Gespielt werden fünf zufällige Songs, ohne Stufen. Die Filter gelten hier
genauso und mit eigenen Regeln – die Voreinstellung räumt Karaoke- und
Instrumentalfassungen weg, die ein gezogenes Album gern mitbringt. Unter fünf
Songs bleibt der Modus gesperrt. Die Auflösung zeigt die Datei und öffnet sie
auf Klick.

Als einziger Modus fängt dieser wirklich **am Anfang des Songs** an (die
Stille davor wird übersprungen) – Apples Previews sind Ausschnitte aus der
Mitte, da geht das nicht. Unter *Songstart* lässt sich stattdessen eine
zufällige Stelle wählen.

**Bleibt die Musik nach dem Neuladen da?** In Chrome und Edge ja: der Ordner
wird gemerkt, beim nächsten Besuch fragt die Seite höchstens einmal nach der
Freigabe. Safari und Firefox erlauben das nicht – dort den Ordner erneut
wählen. Die gelesenen Tags bleiben trotzdem gespeichert, deshalb dauert das
zweite Mal Sekunden statt Minuten.

## Die eigene Mediathek vom Server

Unter **Eigene Musik → Vom eigenen Server** lassen sich **Subsonic**
(Navidrome, Airsonic, Gonic), **Jellyfin/Emby** und **Plex** eintragen.
Adresse, Benutzername und Passwort – bei Plex stattdessen der
X-Plex-Token – und *Mediathek laden*. Danach wird daraus gespielt wie aus
eigenen Dateien.

Zwei Dinge müssen stimmen, sonst kommt nichts an:

- **Der Server braucht eine https-Adresse.** Diese Seite läuft über https und
  darf nichts von http nachladen; der Browser blockt das. `http://192.168.…`
  geht also nicht – nötig ist ein Reverse Proxy mit Zertifikat, Tailscale,
  ein Cloudflare Tunnel, oder bei Plex die Adresse auf `*.plex.direct`.
- **Der Server muss Zugriffe von fremden Seiten erlauben (CORS).** Navidrome,
  Jellyfin und Plex tun das von Haus aus, ältere Airsonic-Versionen nicht.

Geht etwas schief, steht in der Meldung, woran es vermutlich liegt.

Gespielt wird bei Subsonic und Jellyfin ein umgerechnetes MP3, nicht die
ganze FLAC – der Server macht das selbst. Zugangsdaten bleiben im Browser
(unverschlüsselt); *Zugang vergessen* räumt sie weg.

## Nachhören, egal bei welchem Dienst

Unter jeder Auflösung steht eine Reihe von Links: Apple Music, Spotify,
YouTube Music, YouTube, Deezer, Tidal, Qobuz, Amazon Music, SoundCloud,
Bandcamp und Discogs. Welcher davon vorn steht – und an der Ergebnisliste
hängt – wählst du rechts unter **Nachhören bei**.

Kennt die Songliste Apples Track-ID, kommt zusätzlich ein grüner Knopf
*Alle Dienste*. Der geht über song.link und landet nicht auf einer Suche,
sondern auf genau dieser Aufnahme – beim Dienst, den du dort anklickst.

## Songs nachladen (alte Jahrzehnte)

Die mitgelieferte Songliste kommt aus Spotify-Streamzahlen – und Spotify gibt
es erst seit 2008. Deshalb sind die 60er bis 90er dünn besetzt. Zwei Skripte
holen die alten Hits über die Billboard-Jahrescharts nach.

**Lokal geht es am schnellsten** (Python 3, keine Pakete nötig):

```
python3 tools/fetch_yearcharts.py     # Jahrescharts von Wikipedia, ~3 Minuten
python3 tools/add_decades.py 900      # 15 Minuten lang Titel bei Apple suchen
```

Das zweite Skript darfst du ruhig mehrfach starten: Apple bremst nach einigen
hundert Anfragen, aber alles Gefundene liegt im Cache, und der nächste Lauf
macht dort weiter. Danach `data/` committen – fertig.

**Oder über GitHub:** im Repo auf **Actions** → *Songs aktualisieren* →
**Run workflow**. Das läuft täglich auch von selbst und committet die neuen
Songs direkt. Nur: Apple lässt aus GitHubs Rechenzentren kaum etwas durch – im
ersten Lauf waren es 56 Songs in 17 Minuten, der Rest der Zeit ging fürs
Warten drauf. Von zu Hause kommen in derselben Zeit einige hundert zusammen.

Daneben gibt es *Charts neu bauen* – das holt die Spotify-Streamzahlen frisch
von kworb und baut den ganzen Bestand des Standardmodus neu. Das dauert bis zu
einer Stunde und läuft nur auf Knopfdruck. Kommt dabei zu wenig zusammen, wird
nichts committet und die alte Liste bleibt stehen.

## Songauswahl einstellen

Rechts unter **Songauswahl** legst du fest, woraus gezogen wird — alles per
Klick, getippt wird nur der Künstlername:

1. **Instrumentals ausblenden** ist ein Schalter und von Haus aus an.
2. Darunter wählst du die **Wirkung** – *nur*, *ohne* oder *dazu*.
3. Dann klappst du **Genres**, **Jahrzehnte** oder **Künstler** auf und setzt
   Häkchen. Neben jedem Eintrag steht, wie viele Songs daran hängen. Künstler
   suchst du im Feld, die Vorschläge kommen aus der Songliste – so kann man
   sich nicht vertippen.

Oben stehen alle aktiven Regeln als farbige Chips: grün *nur*, rot *ohne*,
gelb *dazu*. Ein Klick auf das × wirft eine raus, *Alle Filter zurücksetzen*
stellt den Ausgangszustand her. „Nur Songs von Sia, aber ohne Instrumentals"
ist also: Schalter an, Wirkung *nur*, Künstler *Sia* anhaken.

Die drei Wirkungen im Einzelnen:

- **nur** – schränkt ein: *nur 2010er* spielt nur Songs aus den 2010ern.
  Mehrere Regeln derselben Art gelten zusammen (*nur 2000er* + *nur 2010er*
  = beide Jahrzehnte), Regeln verschiedener Art müssen alle passen.
- **ohne** – wirft raus: *ohne Hip-Hop/Rap*.
- **dazu** – holt dazu und sticht die anderen: *dazu Billie Eilish* bringt alle
  ihre Songs mit, auch wenn sie sonst durch die Filter fallen würden.

Unter den Chips steht, wie viele Songs übrig sind. Bei weniger als 30 kommt
eine Warnung: dann wiederholt sich die Runde schnell und wird vorhersehbar.
Läuft eine Schwierigkeitsstufe leer, zieht sie Ersatz aus dem Rest.

Filter wirken ab der nächsten Runde – die laufende bleibt stehen. Mit **Alle
neu würfeln** greifen sie sofort.

Im Playlist-Modus gilt dasselbe Panel, aber mit **eigenen Regeln** für die
Playlist – die Überschrift sagt dir, worauf sie gerade wirken, und die Listen
zeigen die Genres, Jahrzehnte und Künstler deiner Playlist. Praktisch, wenn du
ein ganzes Album hineinziehst: die Instrumental- und Karaokefassungen sind
damit von Haus aus draußen. Bleiben weniger als fünf Songs übrig, sagt die
Warnung Bescheid.

## Eigene Playlist spielen

Rechts unter **Modus** auf *Playlist laden* — oder die Datei einfach irgendwo
aufs Fenster ziehen. Danach werden fünf zufällige Songs aus der Liste gespielt,
ohne Schwierigkeitsstufen.

Woher die Datei kommt:

| Dienst | Weg |
|---|---|
| Spotify | [Exportify](https://exportify.net) → CSV je Playlist |
| Apple Music | Musik-App am Mac: Playlist auswählen → *Ablage → Exportieren* (TXT) |
| YouTube Music | [Google Takeout](https://takeout.google.com) → YouTube → Playlists (CSV) |
| Deezer, Tidal, Amazon | TuneMyMusic oder Soundiiz, beide exportieren CSV |
| Lokale Dateien | M3U-Playlist aus dem Musikprogramm |
| Irgendwas anderes | *oder Liste einfügen*: eine Zeile pro Song, `Titel – Künstler` |

Titel und Künstler werden automatisch erkannt, egal wie die Spalten heißen.
Anschließend sucht die Seite jeden Titel bei Apple – rechne mit gut vier
Sekunden pro zehn Songs. Das passiert nur einmal, danach liegt die Playlist im
Browser. Songs, die Apple nicht findet, fallen raus; wie viele es waren, steht
unter dem Knopf. Für eine Runde braucht es mindestens fünf gefundene Songs.

Bei langen Listen bremst Apple irgendwann und schickt ein paar Minuten lang
nur noch Absagen. Dann steht im Status **„Apple bremst – weiter in … s"** und
die Suche macht von selbst weiter, sobald die Zeit um ist; bis dahin kannst du
mit **Abbrechen** anhalten. Bereits gefundene Songs sind gespeichert, und
**Weiter suchen** setzt genau dort wieder an – auch nach dem Schließen der
Seite.

### Wenn die Seite leer bleibt

Fast immer liegt `index.html` dann nicht direkt im Repo-Hauptverzeichnis, sondern in
einem Unterordner. In der Dateiliste des Repos muss `index.html` direkt sichtbar sein.

---

## Spielen

Pro Runde werden fünf Songs gezogen, einer je Stufe. Oben wechselst du zwischen ihnen,
jeder Song hat seinen eigenen Fortschritt.

- **Abspielen** spielt den Ausschnitt in der aktuellen Länge. Die Leiste oben
  zeigt dabei mit, wie weit er läuft: der helle Balken wandert bis ans Ende
  des Abschnitts, der zur aktuellen Stufe gehört.
- **Suchen und Raten**: tippen, Vorschlag auswählen, *Raten*.
- Falsch geraten oder *Überspringen* → nächstlängere Stufe.
- Nach der letzten Stufe wird aufgelöst. Dann läuft der Ausschnitt in voller
  Länge; ein Klick aufs Cover spielt ihn nochmal.

Rückmeldung zu jedem Versuch:

| | |
|---|---|
| grün | richtiger Song |
| **gelb** | falscher Song, aber richtiger Künstler |
| grau | daneben |

Bei Songs mit mehreren Künstlern zählt jeder einzeln. Rätst du bei einem Song von
Charli xcx und Billie Eilish irgendeinen Song von einer der beiden, wird es gelb.

**Tasten:** Der Cursor steht immer im Suchfeld, damit du sofort tippen kannst.
Die Kürzel sind deshalb keine Schriftzeichen.

| Taste | |
|---|---|
| ↑ | Ausschnitt abspielen |
| ↑ ↓ | im Vorschlagsfeld auswählen, solange es offen ist |
| Enter | Vorschlag übernehmen, dann raten |
| Shift + Enter | überspringen |
| ← → | Stufe wechseln, solange das Suchfeld leer ist |
| Cmd/Strg + Enter | alle neu würfeln |

Klickst du irgendwo neben das Suchfeld, funktionieren zusätzlich Leertaste,
S, R und 1–5 wie gewohnt.

### Stufen einstellen

Rechts unter *Stufen* schaltest du einzelne Längen ab. Ist 0,01s aus, startet jeder
Song bei 0,1s. Umschalten mitten im Spiel wirft die Runde nicht weg — du bleibst
beim selben Song und an derselben Stelle, nur das Raster ändert sich. Die Anzahl der Versuche entspricht der Anzahl aktiver Stufen — eine
Stufe abzuschalten kostet also auch einen Versuch.

### Punkte

Es zählt, nach wie vielen Sekunden du den Song erkannt hast, multipliziert mit der
Stufe: Impossible bringt gut das Doppelte von Easy. Statistik und Einstellungen
liegen lokal im Browser.

---

## Woher die Songs kommen

`data/songs.json` enthält 1945 Songs mit Titel, Künstlern, Album, Jahr,
Streamzahl, Stufe sowie Links auf Apples 30-Sekunden-Preview und das Cover.
Es liegen keine Audiodateien im Repo — die Ausschnitte kommen beim Spielen direkt
vom Apple-Preview-Server.

Die Stufen richten sich nach den Spotify-Streams des Songs:

| Stufe | Streams | Beispiel |
|---|---|---|
| Easy | ab 1,5 Mrd. | Sia – Unstoppable |
| Medium | 800 Mio. – 1,5 Mrd. | Sia – Elastic Heart |
| Hard | 450 – 800 Mio. | Linkin Park – One More Light |
| Expert | 280 – 450 Mio. | Sia – Breathe Me |
| Impossible | 130 – 280 Mio. | Britney Spears – Stronger |

## Songliste erneuern

Optional. Die mitgelieferte Liste funktioniert ohne weiteres Zutun.

```
cd tools
python3 fetch_catalogs.py 600
python3 match_local.py
```

Der erste Befehl lädt die Künstlerkataloge (Apple drosselt, deshalb ein Zeitbudget
in Sekunden als Argument — einfach mehrfach aufrufen, bis nichts mehr offen ist).
Der zweite baut daraus in wenigen Sekunden eine neue `songs.json`, die du nach
`data/` kopierst. Oben in `match_local.py` stehen die Grenzwerte der Stufen und
die Anzahl Songs pro Stufe, alles frei änderbar.

## Anpassen

- **Stufenlängen**: `assets/app.js`, ganz oben `STAGES`.
- **Punkte**: ebenfalls oben, `POINTS` und der Faktor `mult` je Stufe.
- **Farben**: `assets/style.css`, Block `:root`.
- **Name**: `index.html`, Überschrift `brand`, und `<title>`.

## Bekannte Eigenheiten

- Der erste Klick auf Abspielen aktiviert die Audioausgabe des Browsers.
  Vorher spielt aus Sicherheitsgründen kein Ton, das ist so gewollt.
- Apple tauscht gelegentlich Preview-Adressen aus. Lässt sich ein Song nicht laden,
  hilft eine neue Runde; bei mehreren Ausfällen die Songliste neu bauen.
- Für Aufnahmen: Systemton mitschneiden, nicht das Mikrofon — sonst gehen 0,01s
  im Raumhall unter.
