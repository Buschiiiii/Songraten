# Songraten

Erkenne den Song in 0,01 Sekunden. Fünf Songs pro Runde, von Easy bis Impossible,
nach echten Spotify-Streamzahlen sortiert.

Die Seite ist reines HTML/CSS/JavaScript. Kein Server, kein Build, keine Anmeldung,
keine Bibliotheken. Alles läuft im Browser.

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
