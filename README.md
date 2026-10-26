# Tennis-Turnierplaner · RSV Finningen

Browseranwendung zum Planen und Durchführen von Tennisturnieren: Teilnehmer eintragen, Spiele auf Plätze verteilen, Ergebnisse erfassen und die Rangliste verfolgen. Die Anwendung besteht aus HTML, CSS und JavaScript und benötigt keinen Build-Schritt.

## Funktionen

- Einzel, feste Doppel-Teams und Doppel mit wechselnden Partnern.
- Einstellbare Plätze, Startzeit, Spiel- und Pausendauer.
- Berücksichtigung von Spielstärken beim Partnerwechsel.
- Spielplan mit Ergebniseingabe, Rangliste und Rundentimer.
- Mehrere lokal gespeicherte Turniere; nach Anmeldung private Online-Synchronisierung.
- Öffentliche Teilnehmeransicht über Live-Link und QR-Code.

### Runden hinzufügen

**„Runde hinzufügen“** ergänzt für jeden Spieler beziehungsweise jedes feste Team genau ein Spiel. Bestehende Ergebnisse bleiben erhalten. Rückspiele sind möglich.

Bei Einzel und festen Teams muss die Teilnehmerzahl gerade sein; beim Partnerwechsel muss die Spielerzahl durch vier teilbar sein. Bei zu wenigen Plätzen verteilt sich die zusätzliche Runde auf mehrere Zeitblöcke.

Freie Plätze im letzten Zeitblock können mit passenden neuen Spielen aufgefüllt werden, solange dort noch keine Ergebnisse eingetragen sind. Spieler werden nicht gleichzeitig doppelt eingeplant. Beim Partnerwechsel mit zwölf Spielern und zwei Plätzen füllen zwei zusätzliche Runden zusammen drei neue Zeitblöcke, wenn sie an einen vollständig belegten Block anschließen.

### Rotationen entfernen

**„Rotation entfernen“** sucht die kleinste zusammenhängende Folge von Runden, die die ausgewählte Runde enthält und jedem Teilnehmer gleich viele Spiele wegnimmt. Je nach Pausenverteilung kann das eine einzelne Runde oder mehrere Runden sein.

Vor dem Entfernen nennt der Bestätigungsdialog die betroffenen Runden und die Anzahl der Spiele pro Teilnehmer. Bereits vorhandene Ergebnisse, auch Teilstände, lösen einen ausdrücklichen Warnhinweis aus. Ohne vollständige Rotation wird nichts gelöscht.

Die übrigen Runden behalten ihre Zeiten und Ergebnisse. Bereits bestehende Unterschiede in der Spielanzahl werden durch das Entfernen nicht ausgeglichen. Wenn zwei Runden einen Zeitblock teilen, gibt es für beide eine eigene Entfernen-Schaltfläche.

## Drei Königsturnier (erster testbarer Entwurf)

In der Vorbereitung „Drei Königsturnier“ auswählen und alle Personen einzeln eintragen. Gespielt wird in allen drei Disziplinen Doppel mit wechselnden Partnern. Tennisplätze, Badmintonfelder und Tischtennisplatten lassen sich jeweils unabhängig von 1 bis 12 einstellen; dazu je Disziplin 1 bis 48 Spiele pro Person.

Ein Vorschlag zeigt automatisch die **kleinste gültige Spielkombination im Verhältnis der Platzanzahlen**. Zuerst wird das Platzverhältnis gekürzt, dann der kleinste Faktor für vollständige Doppel mit gleichen Einsätzen je Disziplin gewählt. Beispiel: 12 Spieler und 1/2/3 Plätze ergeben 1/2/3 Spiele pro Person; 9 Spieler ergeben 4/8/12. Bei gleichen Platzanzahlen empfiehlt das System je Disziplin ein Spiel bei durch vier teilbarer Spielerzahl, zwei Spiele bei sonst gerader Spielerzahl oder vier Spiele bei ungerader Spielerzahl. Leere Namensfelder zählen nicht mit. „Vorschlag übernehmen“ setzt die Spielanzahlen ein; bestehende Spielpläne und Ergebnisse werden erst beim erneuten Erstellen geändert.

Die Spielanzahl wird **innerhalb jeder Disziplin exakt eingehalten**. Beispielsweise erhält bei zwölf Personen jede Person zwei Tennis-, drei Badminton- und ein Tischtennisspiel. Disziplinen dürfen unterschiedliche Spielanzahlen haben. Wiederholte Partner und Gegner sind möglich; die Planung bevorzugt abwechslungsreiche Paarungen und berücksichtigt die eingetragenen Spielstärken.

Vollständige Doppel benötigen je vier Einsätze: `Spielerzahl × Spiele pro Person` muss je Disziplin durch vier teilbar sein. Bei neun Personen sind deshalb beispielsweise vier oder acht Spiele je Disziplin möglich; bei sechs Personen zwei, vier oder sechs. Unmögliche Einstellungen werden mit passenden Alternativen gemeldet, ohne einen bestehenden Plan zu ersetzen.

**Optionale Einzel und Dreierrunden:** Für Tennis, Badminton und Tischtennis gibt es jeweils eine eigene Option „Einzel und Dreierrunden bei Bedarf erlauben“. Alle drei Optionen sind standardmäßig ausgeschaltet und werden getrennt gespeichert. Nach Aktivierung bevorzugt der Planer in der betreffenden Disziplin weiterhin Doppel, darf dort aber auch Einzel und Dreierrunden einsetzen. Nicht aktivierte Disziplinen bleiben beim Doppel. Die Empfehlung berücksichtigt jede Option separat: In einer flexiblen Disziplin muss die Gesamtzahl der Einsätze nur noch gerade sein; pro Person bleiben die Spielanzahlen exakt gleich. Beispielsweise werden bei sechs Personen und 2/2/1 Plätzen mit flexibler dritter Disziplin 2/2/1 Spiele pro Person möglich.

In einer Dreierrunde spielen drei Personen reihum drei Einzel auf demselben Platz, Feld oder derselben Platte. Jede Person hat dadurch zwei Spiele, die einzeln erfasst und gewertet werden. Die drei Einzel teilen sich einen Zeitblock gleichmäßig; im Spielplan stehen Reihenfolge und Zeitabschnitte relativ zum Blockbeginn. Der Spielort und alle drei Personen bleiben für diesen Zeitblock reserviert. Die Live-Ansicht zeigt alle drei Begegnungen. Gleiche Spielanzahl bedeutet bei dieser Option nicht gleiche Spielminuten, da die Einzel einer Dreierrunde jeweils nur ein Drittel des Blocks dauern.

Alle Disziplinen laufen in gemeinsamen Zeitblöcken mit derselben Spieldauer und Wechselpause. Spieler werden nie gleichzeitig auf mehreren Plätzen eingeplant. Der Algorithmus hält die Einsatzanzahlen exakt ein; eine minimal mögliche Gesamtdauer oder vollständig gefüllte Plätze sind nicht garantiert.

Im Spielplan zeigt „Geplante Einsätze pro Person“ die Verteilung. In allen drei Disziplinen werden kurze **Sätze bis 7 Punkte ohne Zwei-Punkte-Abstand** gespielt. Abgeschlossene Sätze werden mit ihrem Ergebnis nachgetragen, zum Beispiel 7:6. Es gibt keinen Punkt-für-Punkt-Zähler. Beim Tennis entfallen 15/30/40 und Spiele innerhalb eines Satzes; nach jedem Satz beginnt die Zählung auf dem Platz wieder bei 0:0.

Der letzte unvollständige Satz kann optional mit dem Stand bei Abpfiff eingetragen werden. „Spiel bei Zeitende abschließen“ beendet die Begegnung. Dieser letzte Satz zählt nur, wenn **zusammen mindestens vier Ballwechselpunkte** gespielt wurden und eine Seite führt: 3:1 und 4:0 zählen, 2:1 und 2:2 nicht. Ohne begonnenen letzten Satz bleiben beide Felder leer. Die App erklärt die Entscheidung. Die Seite mit mehr gewonnenen Sätzen gewinnt die Begegnung, bei gleich vielen gewonnenen Sätzen ist sie unentschieden. Der letzte Abschluss oder die letzte Satzeingabe kann rückgängig gemacht werden. In Dreierrunden gilt diese Regel für jedes der drei Einzel separat und für dessen eigenes Zeitende.

Neue Begegnungen und bisher vollständig leere Spiele verwenden die Satzwertung. Bereits vorhandene Ballwechselergebnisse werden nicht nachträglich als Sätze interpretiert; sie bleiben mit ihrer bisherigen Eingabe erhalten. Alle erfassten Sätze, der Entwurf des letzten Satzstands und die Abschlussentscheidung werden lokal gespeichert und mit dem Turnier synchronisiert. Die öffentliche Ansicht zeigt erfasste Sätze und abgeschlossene Ergebnisse, ohne laufenden Punktestand.

**Einheitliche Wertung im Drei Königsturnier:** Ein Sieg gibt jeder beteiligten Person der Gewinnerseite zwei Tabellenpunkte, ein Unentschieden allen Beteiligten einen Punkt und eine Niederlage null Punkte. Auch ein bei Zeitende bestätigtes 0:0 nach Sätzen zählt als Unentschieden. Vor dem ausdrücklichen Spielabschluss gehen laufende Satzbegegnungen noch nicht als Ergebnisse in die Tabelle ein. Jedes Einzel einer Dreierrunde wird separat gewertet. Je Disziplin gilt: `100 × erreichte Tabellenpunkte / (2 × geplante Spiele pro Person)`. Der Durchschnitt der drei Disziplinwertungen ergibt die Gesamtwertung; unterschiedliche Spielanzahlen verändern das Gewicht einer Sportart nicht. Ballwechselpunkte und Punktdifferenzen entscheiden nicht über die Platzierung. Gleiche ungerundete Gesamtwertungen teilen sich denselben Rang; nach zwei Erstplatzierten folgt Rang drei.

Die Tabelle zeigt je Disziplin die Prozentwertung, erreichte und maximal mögliche Tabellenpunkte und abgeschlossene Spiele. Ein Klick auf einen Namen erklärt die Beiträge zur Gesamtwertung. Offene und unvollständige Ergebnisse bringen noch keine Tabellenpunkte; das Maximum enthält weiterhin alle geplanten Spiele. Die Anzeige bleibt bis zum Abschluss aller Spiele als Zwischenstand gekennzeichnet. Fehlen geplante Spiele in einer Disziplin, gibt es noch keine Gesamtwertung. Die Live-Ansicht verwendet dieselbe Berechnung und dieselbe persönliche Detailansicht. Andere Turnierformate behalten ihre bisherige Wertung.

Im Entwurf lassen sich einzelne Zeitblöcke nicht entfernen oder nachträglich anhängen, da das die Gleichverteilung je Disziplin verletzen könnte. Für andere Einsatzanzahlen die Vorbereitung ändern und den Plan neu erstellen; vorhandene Ergebnisse lösen eine Bestätigung aus.

Lokale Vorschau mit Node.js: `node tools/preview.cjs`, danach [127.0.0.1:8000](http://127.0.0.1:8000) öffnen. Beenden mit Strg+C. Die Vorschau ist nur auf dem eigenen Computer erreichbar.

## Lokal starten

Das Repository mit einem statischen HTTP-Server bereitstellen. Beispielsweise mit installiertem Python im Projektordner:

```sh
python -m http.server 8000
```

Unter Windows ist alternativ `py -m http.server 8000` möglich. Danach [localhost:8000](http://localhost:8000) öffnen.

Ein aktueller Browser genügt für die Anwendung. Es gibt keine npm-Abhängigkeiten und keinen Installations- oder Build-Schritt. Online-Speicherung und Live-Freigabe benötigen eine Internetverbindung und die Firebase-Konfiguration.

## Speicherung und Firebase

Turniere werden zunächst im `localStorage` des Browsers gespeichert. Diese Daten sind an Browserprofil und Website-Adresse gebunden; das Löschen der Browserdaten entfernt auch lokale Turniere.

Die Online-Funktionen verwenden Firebase Authentication mit Google-Anmeldung und Cloud Firestore:

- Private Turniere: `organizers/{uid}/tournaments/{id}`.
- Veröffentlichte Spielpläne: `tournaments/{id}`.
- Die Teilnehmeransicht in `live.html` liest veröffentlichte Spielpläne über die ID im Link.
- Speicherkonflikte werden in „Meine Turniere“ angezeigt; eine lokale Kopie kann erhalten bleiben.

Für eine eigene Installation:

1. Eine Firebase-Web-App mit Firestore und Google-Anmeldung einrichten.
2. Die Web-Konfiguration in `firebase-config.js` anpassen.
3. Die verwendete Website-Domain und gegebenenfalls `localhost` für die Anmeldung autorisieren.
4. Die zugelassene Organisator-Adresse in `tournament-library.js` und in beiden Berechtigungsprüfungen von `firestore.rules` anpassen. Den angezeigten Kontohinweis in `index.html` ebenfalls aktualisieren.
5. Die Regeln aus `firestore.rules` im Firebase-Projekt veröffentlichen. Das Bereitstellen der Website allein aktualisiert diese Regeln nicht.

Die Firebase-Web-Konfiguration ist öffentlich; Schreibrechte werden durch Anmeldung und Firestore-Regeln geschützt. Wer einen veröffentlichten Live-Link hat, kann die darin enthaltenen Teilnehmernamen, Spielpläne und Ergebnisse sehen.

## Tests

Die Tests verwenden den integrierten Node.js-Test-Runner. Mit Node.js 24 geprüft:

```sh
node --test tests/tournament.test.cjs tests/live-sharing.test.cjs tests/three-kings-scoring.test.cjs
```

Geprüft werden unter anderem Spielanzahlen, Pausen, Platzbelegung, zusätzliche Runden, das Entfernen vollständiger Rotationen, Ergebniswarnungen, Ranglisten und Live-Links. Die Tests ersetzen keine vollständige Browserprüfung oder Prüfung gegen ein echtes Firebase-Projekt.

## Projektstruktur

| Datei | Aufgabe |
| --- | --- |
| `index.html` | Oberfläche für die Turnierleitung |
| `app.js` | Turnierplanung, lokale Speicherung, Ergebnisse und Timer |
| `three-kings-scoring.js` | Gemeinsame Drei-Könige-Wertung und Tabellenansicht für Turnierleitung und Live-Ansicht |
| `styles.css` | Darstellung und Druckansicht |
| `tournament-library.js` | Anmeldung und private Online-Turnierverwaltung |
| `live.html` | Öffentliche Teilnehmeransicht |
| `live-sharing.js` | Live-Freigabe, Synchronisierung und Teilnehmeransicht |
| `firebase-config.js` | Öffentliche Firebase-Web-Konfiguration |
| `firestore.rules` | Datenvalidierung und Zugriffsregeln |
| `tests/` | Automatisierte Tests |

## Bereitstellung

Die Website kann auf einem statischen Webserver bereitgestellt werden. HTML-, JavaScript-, CSS- und Bilddateien müssen unter ihren bisherigen relativen Pfaden erreichbar bleiben; insbesondere müssen `index.html` und `live.html` im selben Verzeichnis liegen. Für Online-Funktionen muss die Hosting-Domain in Firebase zugelassen sein.

## Drittanbieter

Für QR-Codes wird `qrcode.min.js` verwendet. Der zugehörige MIT-Lizenztext steht in [QR-CODE-LICENSE.txt](QR-CODE-LICENSE.txt).
