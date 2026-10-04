# Songraten

Erkenne den Song in 0,01 Sekunden. Fünf Songs pro Runde, von Easy bis Impossible,
nach echten Spotify-Streamzahlen sortiert.

Die Seite ist reines HTML/CSS/JavaScript. Kein Server, kein Build, keine
Bibliotheken. Alles läuft im Browser – anmelden musst du dich nur, wenn du
Playlists direkt von Spotify holen willst, und auch das ohne Server.

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
kombinieren lassen, **Nur Hits** für Erfolgserlebnisse und eine einstellbare
**Schwierigkeit**.

---

## Nur Hits

Für Erfolgserlebnisse: rechts unter **Modus** den Schalter *Nur Hits*
anmachen. Dann kommen in **jedem** Modus nur noch die bekanntesten Songs dran
– voreingestellt die obersten 20 % nach Streams, fünf gleichwertige Plätze
„Hit 1" bis „Hit 5", keine Stufen. Wie viel Prozent, stellst du unter
**Schwierigkeit** ein.

| Modus | Was bei „Nur Hits" übrig bleibt |
|---|---|
| Charts | die meistgestreamten 20 % (rund 600 Songs ab 1,3 Mrd. Streams) |
| Jahrzehnte, Genres | die bekanntesten 20 % des Jahrzehnts bzw. Genres |
| Künstler | seine größten Hits laut Songliste, sonst Apples Reihenfolge |
| Eigene Playlist, eigene Musik | was die Songliste als Hit kennt, zuerst |

Es gilt ab der nächsten Runde – *Alle neu würfeln* startet sie sofort. In der
Statistik bekommt „Nur Hits" eine eigene Zeile.

## Schwierigkeit: wie tief die Stufen reichen

Links unter **Schwierigkeit** legst du fest, welcher Anteil der bekanntesten
Songs auf welche Stufe kommt. Fünf Zahlen in Prozent, kumulativ: *Easy = Top
15 %, Medium bis 35 %, Hard bis 55 %, Expert bis 75 %, Impossible bis 100 %*
ist **Normal** und entspricht den alten festen Grenzen der Charts (Easy ab
1,5 Mrd. Streams, Impossible ab 130 Mio.). Neben jedem Feld steht, wie viele
Songs das gerade sind und ab wie vielen Streams.

- **Leicht** nimmt nur die obere Hälfte des Pools, Easy sind die obersten 5 %.
- **Schwer** schiebt alle Stufen nach unten: Easy reicht bis 25 %.
- Oder du tippst eigene Zahlen – zum Beispiel *Easy = Top 1 %, Impossible bis
  20 %*. Was unter der letzten Grenze liegt, kommt mit Stufen nicht dran.

Die Einstellung gilt überall. Mit **Eigene Grenzen für …** bekommt der Bereich,
in dem du gerade spielst – die Charts, die 2010er, Hip-Hop – seine eigenen
Zahlen; alles andere bleibt bei der globalen Einstellung. So kannst du die
1950er anders schneiden als die 2010er.

Die Reihenfolge ist in jedem Modus dieselbe: **nach Streams.** Ein Song mit
mehr Streams steht nie in einer schwereren Stufe als einer mit weniger – auch
in Genres, wo das früher nicht so war. Songs aus den Jahrescharts, die keine
Streamzahl haben, werden aus ihrem Chartplatz geschätzt und dazwischen
einsortiert; ein ≈ in der Anzeige sagt es.

Damit es für „tiefer" Nachschub gibt, holt die Pipeline künftig Songs ab 50
Mio. Streams statt 130 Mio. Das greift nach dem nächsten *Charts neu bauen*
(Actions).

## Nachsehen, was drin ist

Links unter den Rundenpunkten (und unten in der Songauswahl) steht **Songs
ansehen**. Die Liste zeigt genau die Songs, aus denen im aktuellen Modus
gezogen wird, und lädt beim Scrollen nach. Oben ein Suchfeld, je Zeile drei
Knöpfe:

| | |
|---|---|
| ▶ | zehn Sekunden reinhören |
| ↗ | die Streamingdienste aufklappen |
| ✕ | den Song aus der Auswahl nehmen |

Entfernte Songs sind **in jedem Modus** weg – auch in der eigenen Playlist.
Der Reiter *Entfernt* zeigt sie, ↺ holt einen zurück, und
*Alle entfernten zurückholen* setzt alles wieder auf Anfang.

## Gestuft oder einfach fünf zufällige

Unter **Spielweise** steht, wie eine Runde gezogen wird: *Nach Seltenheit
gestuft* (Easy bis Impossible, wie bisher) oder *Fünf zufällige*. Zufällig
spielen im Chartsmodus auch die Songs mit, die keine Streamzahl haben und
deshalb in keine Stufe passen – aus rund 1900 werden über 4000. Die laufende
Runde bleibt, die Umstellung gilt ab der nächsten.

## Aufgeräumt: alles klappt zu

Rechts und links stehen die Einstellungen in Panels, die **zugeklappt**
anfangen. In jeder Zeile steht trotzdem, was drinsteht – „Nachhören bei ·
Spotify", „Eigene Musik · 1240 Songs", „Songauswahl · Charts · 1913 Songs".
Aufgeklappt bleibt nur, was du wirklich brauchst; die Seite merkt es sich.
Offen bleibt von Anfang an nur *Modus*. Auf dem Handy passt damit alles auf
wenige Bildschirme.

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
bekanntesten 15 % der 80er, nicht die meistgestreamten Songs überhaupt (die
Prozente stehen unter *Schwierigkeit*). Mit Shift und den Pfeiltasten geht das
auch über die Tastatur.

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
X-Plex-Token – und *Mediathek laden*. Unter den Feldern steht je nach Art,
was genau dort hingehört.

**Woher der Plex-Token kommt:** in der Plex-Weboberfläche einen Song
auswählen, dann ⋮ → *Informationen* → *XML anzeigen*. Es öffnet sich ein neuer
Tab, und ganz am Ende der Adresse steht `X-Plex-Token=…`. **Welche Adresse:**
die, unter der du deinen Server erreichst – wenn du ihn über app.plex.tv
benutzt, ist das meist eine auf `.plex.direct:32400` (steht in derselben
XML-Adresse davor). Danach wird daraus gespielt wie aus
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

## Einzelne Songs und Alben hinzufügen

Im Panel **Eigene Playlist** gibt es ein Suchfeld – zwischen *Songs* und
*Alben* umschalten, Namen eintippen, Enter. „Loud Rihanna" unter *Alben*
anklicken, und das ganze Album liegt in der Playlist. Gibt es noch keine
Playlist, entsteht sie dabei; Doppelte fallen weg.

## Nachhören, egal bei welchem Dienst

Unter der Auflösung steht **dein** Dienst – welcher das ist, wählst du rechts
unter **Nachhören bei**. Ein Klick auf *+ n weitere* holt die anderen dazu und
merkt sich das: Apple Music, Spotify, YouTube Music, YouTube, Deezer, Tidal,
Qobuz, Amazon Music, SoundCloud – dazu Bandcamp, der Qobuz-Shop und Discogs
zum Kaufen und Nachschlagen.

Kennt die Songliste Apples Track-ID, kommt zusätzlich ein grüner Knopf
*Alle Dienste*. Der geht über song.link und landet nicht auf einer Suche,
sondern auf genau dieser Aufnahme – beim Dienst, den du dort anklickst.

**Angemeldet bist du dabei schon.** Der Link öffnet sich in deinem Browser,
und dort läuft deine Sitzung bei Spotify, Tidal oder Qobuz weiter – du landest
im Player, bei der Suche nach dem Song, und drückst Play. Früher hat die Seite
die genauen Adressen je Dienst bei song.link geholt; diese Schnittstelle ist
seit Herbst 2025 ohne Schlüssel abgeschaltet. Was davon noch im Browser
gespeichert ist, wird weiter genutzt (grüner Punkt am Dienst).

**Innerhalb des Spiels abspielen geht nur mit der eigenen Musik.** Spotify und
Apple Music bräuchten dafür eine registrierte App und einen Server – und
selbst dann könnte ihr Player keine 0,01 Sekunden schneiden. Wer den Ton aus
der Seite selbst hören will: eigene Dateien oder der eigene Mediathek-Server,
beides weiter oben.

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

Rechts im Panel **Eigene Playlist** auf *Playlist laden* – oder die Datei
einfach irgendwo aufs Fenster ziehen. Danach werden fünf zufällige Songs aus
der Liste gespielt, ohne Schwierigkeitsstufen.

Woher die Datei kommt:

| Dienst | Weg |
|---|---|
| Spotify | direkt anmelden (siehe unten) – oder [Exportify](https://exportify.net) → CSV je Playlist |
| Apple Music | Musik-App am Mac: Playlist auswählen → *Ablage → Exportieren* (TXT) |
| YouTube Music | [Google Takeout](https://takeout.google.com) → YouTube → Playlists (CSV) |
| Deezer, Tidal, Amazon | TuneMyMusic oder Soundiiz, beide exportieren CSV |
| Lokale Dateien | M3U-Playlist aus dem Musikprogramm |
| Irgendwas anderes | *oder Liste einfügen*: eine Zeile pro Song, `Titel – Künstler` |

Titel und Künstler werden automatisch erkannt, egal wie die Spalten heißen.
Dann wird jeder Titel einem Song mit Hörprobe zugeordnet, schnellster Weg
zuerst:

1. **Sofort, ohne Anfrage:** was schon einmal gefunden wurde, und alles, was
   in der eingebauten Songliste steht. Bei einer Liste mit bekannten Hits ist
   das der größte Teil – von 233 Klassikern kamen so 149 in null Sekunden.
2. **Über die ISRC**, die Kennung der Aufnahme: Exportify, TuneMyMusic und
   Soundiiz schreiben sie in die Datei. Ein Nachschlag holt bis zu zwanzig
   Aufnahmen auf einmal, exakt – auch wenn der Titel bei Apple anders heißt.
   Das ist der schnellste Weg; Spotify selbst gibt die ISRC leider nicht mehr
   heraus.
3. **Ein Katalog statt vieler Suchen:** stehen zwei oder mehr Titel desselben
   Künstlers an, holt eine Anfrage seinen ganzen Katalog – und der bleibt im
   Browser, der nächste Import mit demselben Künstler kostet nichts.
4. **Einzeln bei Apple**, und zwar so, dass Apple es auch findet: ohne
   „- 2005 Remaster", nur mit dem ersten Künstler, „JAŸ-Z" und schräge
   Apostrophe geglättet. Klappt das nicht, sucht die Seite lockerer weiter.
5. **Über das Album** für den Rest: Apples Suche verschweigt seit Herbst
   2025 explizite Titel, und auch die ISRC findet sie dann nicht. Alben
   findet die Suche aber, und die Titelliste eines Albums kommt über einen
   Nachschlag ohne diese Lücke. Steht der Albumname in der Datei (Exportify,
   Spotify, die meisten Exporte), sucht die Seite das Album und nimmt den
   Titel daraus. Zwei Anfragen je Titel, nur für Titel, die sonst nirgends
   zu finden waren.

In der Auflösung gibt es **Ganzes Lied anhören**: ein kleiner Player von
Spotify oder Apple Music direkt auf der Seite. Bist du im Browser bei
Spotify (Premium) oder Apple Music angemeldet, spielt er das ganze Lied,
sonst 30 Sekunden. Spotify braucht dafür die Song-ID – die kommt aus dem
Import oder, angemeldet, über eine Suche; Apple reicht die Songliste.

**Nur Englisch, Deutsch und bekannte Hits.** Die Bekanntheit der Songs
hängt an weltweiten Streams – deshalb tauchten Bad Bunny, Arijit Singh und
BTS weit oben auf. Charts, Jahrzehnte und Genres spielen jetzt
standardmäßig nur englische und deutsche Songs und fremdsprachige, die man
in Deutschland kennt: mit mindestens 50 Mio. Spotify-Streams aus
Deutschland (kworb, deutsche Wochencharts), die großen K-Pop-Hits („How You
Like That“, „Pink Venom“) und Klassiker von vor Spotify (Macarena,
Despacito, Gangnam Style). Die Sprache wird aus Titel, Genre und Künstler
geraten; unter *Songauswahl → Sprachen* lässt sich jede Sprache einzeln
wieder dazunehmen, der Schalter *Nur Englisch, Deutsch und bekannte Hits*
nimmt alles auf einmal zurück.

Hinter jedem Panelnamen und an den wichtigen Schaltern steht ein kleines
**i** – antippen erklärt, was die Einstellung genau tut und wie sie rechnet.

Ganz unten auf der Seite steht klein die Fassung (`v2026-10-01.14`, also
Datum und Nummer des Patches an dem Tag) und von wann die Songliste ist –
so siehst du nach einer Änderung, ob dein Browser sie schon hat; wenn
nicht, hilft Neuladen oder ein paar Minuten warten.

Geht etwas schief, steht neben der Meldung ein kleines **?** – darüber
fahren oder antippen sagt, was genau passiert ist: welche Adresse, welcher
Fehler, woran es liegen kann. In der Titelliste steht bei jedem fehlenden
Titel, warum: „bei Apple nicht gefunden" (dann hilft die Lupe) oder
„Verbindungsproblem bei der Suche" (dann hilft ↻), und das ? zeigt, was
alles versucht wurde. Ein Verbindungsproblem wird außerdem von selbst
zweimal kurz hintereinander wiederholt, bevor der Titel als fehlend gilt.

Apple erlaubt nur rund zwanzig Anfragen pro Minute. Die Seite hält sich
daran, statt in die Sperre zu laufen: nach einer Sperre langsam, nach vierzig
sauberen Anfragen wieder schneller. Unter dem Fortschritt steht, wie lange es
noch dauert.

**Spielen kannst du, sobald fünf Songs gefunden sind** – der Rest kommt
während des Spielens dazu. Ist in der laufenden Runde noch nichts passiert,
wechselt die Seite von selbst in die Playlist.

Bei langen Listen bremst Apple irgendwann und schickt ein paar Minuten lang
nur noch Absagen. Der Fortschritt bleibt dabei stehen („161 von 233
durchsucht · 149 gefunden"), darunter steht **„Apple bremst – weiter in …
s"**, und die Suche macht von selbst weiter. **Abbrechen** hält an, **Weiter
suchen** setzt genau dort wieder an – auch nach dem Schließen der Seite.

### Was fehlt – und selbst nachhelfen

**Titelliste ansehen** zeigt die ganze Liste in drei Reitern:

| Reiter | Knöpfe je Titel |
|---|---|
| Gefunden | ▶ reinhören · Lupe: anderen Song zuordnen · ✕ falscher Treffer |
| Offen | Pfeil nach oben: **vorziehen** – wird als Nächstes gesucht |
| Fehlt | ↻ nochmal automatisch · Lupe: **selbst suchen** |

Die Lupe klappt unter der Zeile eine Suche auf, schon mit Titel und Künstler
ausgefüllt; meist reicht es, ein Wort zu ändern. Findet die Suche den Titel
partout nicht, auf *Alben* umschalten, das Album antippen und den Titel aus
der Albumliste nehmen – die kommt auf einem anderen Weg von Apple. Ein Tipp auf einen Treffer
ordnet ihn zu, ▶ daneben spielt ihn vorher an. Die Zuordnung bleibt
gespeichert. Mit dem Suchfeld oben lassen sich auch viele auf einmal
vorziehen („Rihanna" eintippen → *Diese 12 vorziehen*).

### Direkt von Spotify

Unter **Eigene Playlist → Von Spotify** meldest du dich bei Spotify an und
tippst eine deiner Playlists an – oder *Lieblingssongs*. Ohne Server geht das
über das PKCE-Verfahren. Die App des Seitenbesitzers ist eingebaut; Spotify
lässt dort aber nur eingetragene Nutzer hinein (höchstens fünf). Wer nicht
dazugehört, klickt *eigene App verwenden* und legt sich eine an:

1. [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) →
   *Create app*.
2. Als *Redirect URI* genau die Adresse eintragen, die im Panel steht
   (`https://DEIN-NAME.github.io/songraten/`, mit Schrägstrich am Ende).
3. *Web API* anhaken, speichern, die *Client ID* ins Panel kopieren,
   *Mit Spotify anmelden*.

Was Spotify dabei vorgibt, nicht die Seite:

- Die App braucht ein **Premium-Konto** ihres Besitzers; weitere Leute
  (höchstens fünf) trägst du im Dashboard unter *User Management* ein.
- Lesbar sind nur **eigene und gemeinsame Playlists** und die
  Lieblingssongs. Fremde – auch „Discover Weekly", die gehört Spotify –
  stehen abgeblendet da, mit dem Besitzer dahinter. Antippen kostet nichts;
  sagt Spotify nein, hilft *Zu Playlist hinzufügen* in eine eigene oder der
  Umweg über Exportify.
- **Spotify liefert nur die Titelliste, keinen Ton.** Hörproben gibt Spotify
  neuen Apps seit Ende 2024 nicht mehr. Gespielt wird deshalb weiter über
  Apples Hörproben, die Titel laufen durch dieselbe Suche wie ein Export.

Die Anmeldung bleibt im Browser gespeichert; *Bei Spotify abmelden* löscht sie.

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

**Vorschläge beim Raten:** Unter *Spielweise* wählst du, woraus die Liste
beim Tippen kommt – *alle bekannten Songs* (Songliste, Playlist, eigene
Musik, Künstler; die Liste verrät dann nicht, was gerade im Pool ist) oder
*nur aus der Auswahl* (kürzer, bei kleinen Pools aber fast die Lösung).

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

Klickst du irgendwo neben das Suchfeld, funktionieren zusätzlich Leertaste
und 1–5.

### Stufen einstellen

Links unter *Stufen* schaltest du einzelne Längen ab. Ist 0,01s aus, startet jeder
Song bei 0,1s. Umschalten mitten im Spiel wirft die Runde nicht weg — du bleibst
beim selben Song und an derselben Stelle, nur das Raster ändert sich. Die
Anzahl der Versuche entspricht der Anzahl aktiver Stufen — eine Stufe
abzuschalten kostet also auch einen Versuch.

**Längen anpassen** darunter tauscht die ganze Leiter: *Standard* (0,01 bis
15 s), *Sanft* (0,5 – 1 – 2 – 5 – 10 – 20 s), *Blitz* (0,01 bis 3 s), *Lang*
(1 bis 20 s) – oder eigene Zahlen, zwei bis acht Stufen zwischen 0,01 und 20
Sekunden, *+ Stufe* und *Übernehmen*. Auch das wirft die laufende Runde nicht
weg.

### Punkte

Es zählt, nach wie vielen Sekunden du den Song erkannt hast – unabhängig
davon, wie die Leiter aussieht: 1000 Punkte bei 0,01 s, 850 bei 0,1 s, 700
bei 0,5 s, 500 bei 2 s, 300 bei 8 s, 150 bei 15 s, 100 bei 20 s, dazwischen
wird interpoliert. Multipliziert mit der Stufe: Impossible bringt gut das
Doppelte von Easy. Statistik und Einstellungen liegen lokal im Browser.

---

## Woher die Songs kommen

`data/songs.json` enthält über 5000 Songs mit Titel, Künstlern, Album, Jahr,
Streamzahl, Stufe sowie Links auf Apples 30-Sekunden-Preview und das Cover.
Es liegen keine Audiodateien im Repo — die Ausschnitte kommen beim Spielen direkt
vom Apple-Preview-Server.

Die Stufen richten sich nach den Spotify-Streams des Songs – in Prozent des
Pools, einstellbar unter *Schwierigkeit*. Bei **Normal** heißt das in den Charts:

| Stufe | Anteil | Streams | Beispiel |
|---|---|---|---|
| Easy | Top 15 % | ab 1,5 Mrd. | Sia – Unstoppable |
| Medium | bis 35 % | 750 Mio. – 1,5 Mrd. | Sia – Elastic Heart |
| Hard | bis 55 % | 440 – 750 Mio. | Linkin Park – One More Light |
| Expert | bis 75 % | 280 – 440 Mio. | Sia – Breathe Me |
| Impossible | bis 100 % | 130 – 280 Mio. | Britney Spears – Stronger |

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

## Was die Seite nach außen schickt

Nichts, was nicht sein muss. Titel und Künstler einer Playlist gehen an
Apples Suche, damit es eine Hörprobe gibt; nach der Spotify-Anmeldung
holt die Seite deine Playlists direkt bei Spotify. song.link wird nur noch
verlinkt, nicht mehr abgefragt. Eigene Musikdateien
bleiben auf dem Gerät. Alles Gespeicherte – Einstellungen, Statistik,
Playlist, Spotify-Anmeldung, Zugang zum Mediathek-Server – liegt im Browser,
unverschlüsselt; *Zugang vergessen* und *Bei Spotify abmelden* räumen auf.
Eine Content-Security-Policy erlaubt nur eigene Skripte.

## Bekannte Eigenheiten

- Der erste Klick auf Abspielen aktiviert die Audioausgabe des Browsers.
  Vorher spielt aus Sicherheitsgründen kein Ton, das ist so gewollt.
- Apple tauscht gelegentlich Preview-Adressen aus. Lässt sich ein Song nicht laden,
  hilft eine neue Runde; bei mehreren Ausfällen die Songliste neu bauen.
- Für Aufnahmen: Systemton mitschneiden, nicht das Mikrofon — sonst gehen 0,01s
  im Raumhall unter.
