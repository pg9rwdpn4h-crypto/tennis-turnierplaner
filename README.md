# Tennis-Turnierplaner · RSV Finningen

Browseranwendung zum Planen und Durchführen von Tennisturnieren: Teilnehmer eintragen, Spiele auf Plätze verteilen, Ergebnisse erfassen und die Rangliste verfolgen. Die Anwendung besteht aus HTML, CSS und JavaScript und benötigt keinen Build-Schritt.

## Funktionen

- Einzel, feste Doppel-Teams und Doppel mit wechselnden Partnern.
- Einstellbare Plätze, Startzeit, Spiel- und Pausendauer.
- Berücksichtigung von Spielstärken beim Partnerwechsel.
- Spielplan mit Ergebniseingabe, Rangliste, Rundentimer und PDF-Export.
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
node --test tests/tournament.test.cjs tests/live-sharing.test.cjs
```

Geprüft werden unter anderem Spielanzahlen, Pausen, Platzbelegung, zusätzliche Runden, das Entfernen vollständiger Rotationen, Ergebniswarnungen, Ranglisten und Live-Links. Die Tests ersetzen keine vollständige Browserprüfung oder Prüfung gegen ein echtes Firebase-Projekt.

## Projektstruktur

| Datei | Aufgabe |
| --- | --- |
| `index.html` | Oberfläche für die Turnierleitung |
| `app.js` | Turnierplanung, lokale Speicherung, Ergebnisse, Timer und PDF-Export |
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
