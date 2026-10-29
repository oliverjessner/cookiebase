# CODEX MASTERPROMPT — COOKIEBASE

## Rolle und Auftrag

Du arbeitest als Senior Browser-Extension Engineer, Product Engineer, Security Engineer und UX Engineer an **Cookiebase** — einer modernen, werbefreien Chrome-Extension für Cookie Management, Cookie Debugging und Session Profiles.

**Implementiere eine tatsächlich nutzbare, stabile Chrome-Extension.** Schreibe nicht nur eine Analyse, einen Plan oder Mockups. Setze die Anforderungen im bestehenden Arbeits-Repository um, teste sie und committe sinnvolle, abgeschlossene Entwicklungsschritte. Das Produkt soll sämtliche unten aufgeführten konkreten Probleme aus ausgewerteten Nutzerreviews von Cookie-Editor adressieren. Die Review-Anforderungen sind bereits in diesem Prompt vollständig beschrieben; du brauchst die ursprüngliche Review-Datei nicht.

Produktversprechen: **Cookiebase — Your cookies. Your control.**

Die drei Produktbereiche heißen **Inspect · Control · Profiles**; **Debug** ist ein eigener vollwertiger Arbeitsbereich. Die Extension muss für gelegentliche Nutzer einfach und für Entwickler/QA leistungsfähig sein.

## 0. Bestehendes Repository prüfen, Designsystem verbindlich übernehmen

1. Analysiere zuerst das aktuelle Arbeits-Repository: vorhandene Dateien, Architektur, Package-Skripte, Manifest, Tests, Git-Status und dokumentierte Entscheidungen. Nichts blind überschreiben; vorhandene funktionierende Implementierungen erhalten und verbessern. Ist das Projekt leer, baue Cookiebase sauber von Grund auf.
2. **Verbindliches Designsystem:** https://github.com/oliverjessner/oj-designsystem — npm-Package **`oj-designsystem`** (Repository-Stand bei Erstellung dieses Prompts: `0.2.1`; installierbare Version/Exports im Projekt prüfen). Lies insbesondere `README.md`, `docs/AI-AGENTS.md`, `docs/COMPONENTS.md`, `docs/JS-API.md`, `docs/THEMING.md` und die relevanten Storybook-Beispiele.
3. Bevorzuge die dokumentierte Integration:
   - `import 'oj-designsystem/styles.css'`
   - `import { initOJ, toast, confirmDialog } from 'oj-designsystem'`
   - nach dem Mount `initOJ(root)` aufrufen; Cleanup bei Dispose.
   - Root `.oj-app` / `.oj-root`, Dark-first, Brand-Akzent über **`--oj-accent`** nach dem Import; CSS-Token statt kopierter Komponentenstile.
   - Bestehende Klassen und Patterns nutzen: `.oj-button`, `.oj-input`, `.oj-field`, `.oj-panel`, `.oj-table`, `.oj-tabs`, `.oj-badge`, `.oj-dialog`, `.oj-status`, `.oj-empty-state` usw. — Namen/Markup anhand Dokumentation verifizieren.
   - Comfortaa für UI, JetBrains Mono für technische Werte, im Package mitgelieferte Font-Awesome-Icons; keine CDN-Abhängigkeit, keine Emojis als Standard-Icons.
   - Fehlende Cookie-spezifische Darstellung ausschließlich im Cookiebase-UI-Styling ergänzen. Nicht `oj-*` kopieren oder fremde Designframeworks einführen. Kein React, Tailwind oder anderes UI-Framework, solange das bestehende Projekt nichts zwingend anderes erfordert. Bei einem neuen Projekt: Vanilla HTML/CSS und ESM-JavaScript (TypeScript nur, wenn bereits sinnvoll vorhanden), mit kleinem reproduzierbarem Build.
   - Ausreichende Kontraste, Fokuszustände, Tastatursteuerung, semantische Labels, WCAG-2.2-AA-orientierte Usability.
4. Verifiziere tatsächlich, dass OJ-CSS, JS, Fonts und Icons in einem gepackten MV3-Extension-Build lokal funktionieren. Keine Remote-Skripte, Inline-Skripte oder unerlaubte MV3-CSP-Workarounds.
5. Kein neues Designtoken-System, keine redundanten CSS-Bibliotheken, kein Designsystem-Fork.

## 1. Technische Leitplanken

- **Manifest V3**, Chrome Desktop als primäre Zielplattform; aktuelle Chrome-Extension-APIs nutzen und Kompatibilität dokumentieren. Feature Detection und sinnvoller Mindest-Chrome-Stand statt unzutreffender Browser-Versprechen.
- Chrome API `chrome.cookies` inkl. `onChanged`, `getAll`, `getAllCookieStores`, `set`, `remove` und, falls vorhanden und zweckmäßig, `getPartitionKey`. Die tatsächlichen Rechte/Parameter zur Laufzeit prüfen.
- `cookies` plus minimale notwendige weitere API-Permissions; Hostzugriff nach Möglichkeit über `optional_host_permissions` und nutzerinitiierte, erklärende Freigabe **für aktuelle Site, definierte Sites oder alle Sites**. Keine stillschweigende Komplettfreigabe.
- Für einen echten globalen Cookie Manager kann Zugriff auf alle Sites nötig sein: das verständlich anzeigen und nur auf explizite Aktion anfordern. Ohne Vollzugriff den Umfang ehrlich als eingeschränkt darstellen.
- **Service Worker ist kurzlebig**: Event-Listener top-level registrieren, Arbeit resumierbar/persistierbar machen, keine Zuverlässigkeit von langlebigem In-Memory-State abhängig machen. `chrome.storage.local` für Einstellungen/Metadaten, geeignete lokale Datenbank (z. B. IndexedDB) für strukturierte Datensätze; `chrome.storage.session` nur für kurzlebige Nicht-Persistenz. Quoten, Migrationen, Versionierung und Fehler behandeln.
- Privacy-by-design: sämtliche Cookie-Verarbeitung lokal, kein Server, kein Tracking, keine Telemetrie, keine Werbung, keine Remote-Fonts, keine externe Analyse. Kein Ändern von Suchmaschine/Browser-Startseite. Keine Third-Party-Datenweitergabe.
- Sicherheitsgrundsatz: **Cookie-Werte sind häufig Sitzungsschlüssel bzw. Zugangsdaten.** Standardmäßig maskieren; explizites Reveal/Copy/Export nur nach bewusster Benutzeraktion. Niemals in Fehlerlogs oder Analytics ausgeben. Sichere Textausgabe, keine ungeprüfte HTML-Injektion, CSP und Input-Validierung.
- Keine magischen Browser-Fähigkeiten behaupten: Die Extension kann keine Cookies fremder Chrome-Profile direkt lesen, keine vom Server ungültig gemachten Sitzungen reaktivieren, kann nicht jedes Third-Party-/CHIPS-Cookie ohne Partition-/Hostkontext enumerieren und kann Chrome-Richtlinien nicht umgehen.
- Browser-Unterstützung klar ausweisen: Chrome Desktop offiziell; Edge/Brave nur als getestet, wenn wirklich getestet; Chrome Android unterstützt reguläre Chrome-Extensions nicht. Inkognito erfordert browserseitig explizite Erlaubnis und getrennte Cookie-Stores.

## 2. UI / Informationsarchitektur

Erstelle ein kompaktes **Popup** für die aktuelle Site und eine vollwertige **Manager-Ansicht als Extension-Tab** für große Datenmengen. Eine Side-Panel- oder DevTools-Oberfläche nur dann ergänzen, wenn sie für den Debug-Workflow echte Vorteile bietet; Debugging muss zumindest über die Manager-Ansicht benutzbar sein.

Navigation: **Overview / Cookies / Rules / Profiles / Debug / Settings** (logisch überschaubar, nicht alles im Popup verstecken).

Popup: aktuelle Site, klarer Status zu Berechtigungen und Cookie-Anzahl; Suche, einzelne Cookies ansehen/bearbeiten, ausgewählte Cookies löschen, geschützte Cookies respektieren; Shortcuts zu Manager/Profiles/Debug; eindeutige Leer- und Fehlerzustände.

Manager: Tabelle mit Spalten Name, Domain, Path, Value (maskiert), Expires/Session, SameSite, Secure, HttpOnly, HostOnly, Partition, Store sowie Protection/Status. Sortierung, Suchfeld, Filter, Auswahl und Bulk-Actions. Lange Werte vollständig und sicher über Detailansicht; keine abgeschnittenen Informationen ohne Möglichkeit zum Anzeigen/Kopieren.

Gestaltungsregeln: OJ-Designsystem, kompakt und hochwertig, keine unnötigen modalen Dialoge, responsive auch bei schmalen Popups, konsistente Feedback-Zustände, keine Werbung. Nutzerfreundliche Sprache; UI zunächst konsistent auf Englisch, Architektur leicht lokalisierbar. Visual Design darf Einfachheit der bisherigen Cookie-Editor-Nutzung nicht verlieren.

## 3. REQUIREMENTS — JEDER PUNKT IST PFLICHT

### CB-01: Alle erreichbaren Cookies zentral finden

- Vollständige, durch **tatsächliche Berechtigungen gedeckte** globale Cookie-Übersicht über zugängliche Domains und Cookie-Stores.
- Scope-Wahl: Current URL, Current Host, Registrable Domain inkl. Subdomains, ausgewählte Domains, All Accessible Sites; Scope **vor** Löschung und Export immer explizit sichtbar.
- Cookies gruppieren nach Domain/Subdomain; korrektes eTLD+1 mit Public-Suffix-List (keine naive `split('.')`-Heuristik).
- Suche nach Cookie-Name, Domain, Path und optional Cookie-Wert (Wertesuche als bewusst gewählte, sensitive Option), case-insensitive Textsuche, Wildcard oder sinnvolle Filterbedingungen.
- Filter: Secure, HttpOnly, SameSite, Session/Persistent, HostOnly, geschützt/nicht geschützt, Store, partitioniert/unpartitioniert, Ablaufdatum/Zeitraum, zuletzt **von Cookiebase beobachtete** Änderungen. Sortierung Name/Domain/Expiration/Observed Change.
- **Nicht fälschlich ein Browser-Cookie-Creation-Date behaupten:** Wenn Chrome keine Erstellungszeit liefert, nur Ablaufdatum bzw. von Cookiebase selbst beobachtete Events anzeigen.
- Anzeige der Gesamtzahl, gefilterten Zahl, tatsächlich erfassten Stores/Scopes und fehlender Zugriffsrechte. Zustand „Keine Cookies“ von „Kein Zugriff“ unterscheiden.
- Auch bei tausenden Cookies flüssig bleiben (Pagination/Virtualisierung oder effiziente inkrementelle Anzeige, debounced Search, messbare Performance-Tests).

### CB-02: Kein Cookie übersehen / echte Attributunterstützung

- Korrekte Enumeration und Identität über Name + Domain + Path + StoreId + (falls verfügbar) PartitionKey; HostOnly, Secure, HttpOnly, SameSite und Session/Persistent anzeigen.
- Partitionierte Cookies (CHIPS): unterstützte PartitionKeys berücksichtigen, insbesondere aktuelle Tab-/Frame-Kontexte; getrennt von unpartitionierten Cookies darstellen. **Nicht behaupten, alle Partitionen global sehen zu können, wenn die API das nicht hergibt.** Abdeckung und technische Grenzen transparent ausweisen.
- Bei Abweichungen zu Chrome DevTools gezielte Diagnose: fehlende Hostberechtigung, anderer Store/Inkognito, Partitionierung, HostOnly, Domain/Subdomain, abgelaufen/überschrieben, Browser-/Enterprise-Policy.
- Authentische Status- und Permission-Diagnose statt leerer oder irreführender Liste.

### CB-03: Granulare Löschung und Cookie Protection

- Löschen einzelner, ausgewählter, gefilterter oder aller Cookies im **explizit angezeigten Scope**.
- Erstellbare und bearbeitbare **Protected Cookie Rules / Allowlist** mit Domain-Pattern, Name, Path, optional Store/Partition und Subdomain-Einschluss/Ausschluss. Regeln können pro Site oder global gelten.
- „Delete all except protected“ und „Preserve subdomain cookies“ als verständliche Optionen.
- Vorschau vor destruktiven Bulk-Aktionen: wie viele werden gelöscht, wie viele bleiben durch Regeln erhalten, welche Domains/Stores sind betroffen. Sicherer Default respektiert Schutzregeln.
- Regelkonflikte vorhersagbar und nachvollziehbar auflösen; eindeutig vor riskanten Overrides warnen.
- Wiederherstellung/Undo über **vorherigen Snapshot**, soweit technisch und sicher möglich; best effort und keine atomare Erfolgsgarantie behaupten.
- Szenario aus Review muss in zwei Klicks möglich sein: alle unnötigen Cookies einer Website entfernen, Consent-Cookie dauerhaft behalten.

### CB-04: Cookie erstellen, bearbeiten, deaktivieren/reaktivieren

- Vollständiger Editor für Name, Value, Domain, Path, Secure, HttpOnly, SameSite, Expiration/Session, HostOnly, Store und unterstützte Partition-Attribute.
- **Alle relevanten Advanced Options bereits bei CREATE**, nicht nur im Edit-Modus. Pflichtfelder und Browserregeln validieren (`Secure`/`SameSite=None`, `__Host-`/`__Secure-`, Domain-/Path-Gültigkeit, HTTPS, abgelaufene Werte etc.).
- Änderungen durchführen, Ergebnis gegen tatsächliche `chrome.cookies`-Daten verifizieren; erfolgreiche UI-Meldung nur bei nachweislichem Erfolg.
- Individuelles **Disable/Enable** anbieten: technisch ehrlich als „temporarily remove and restore from local snapshot“ implementieren, da Cookies keine native Enabled-Eigenschaft haben. Restore-Einschränkungen klar kommunizieren.
- Nicht zulässige Browser-Attribute und policy-gesperrte Aktionen mit präzisem Grund erklären.

### CB-05: Zuverlässiger Import — keine falschen Success-Meldungen

- Unterstütze Dateiauswahl/Drag & Drop und Paste/Clipboard.
- Mindestens: Cookie-Editor-kompatible JSON-Exporte, sinnvoll dokumentiertes natives Cookiebase-JSON, Netscape cookies.txt; weitere eindeutig identifizierbare JSON-Schemata nach Prüfung.
- Datei oder Clipboard-Inhalt **vor** Änderungen parsen, validieren und in einer Preview zeigen: enthaltene Cookies, Ziele, Stores, benötigte Hostpermissions, Konflikte, ungültige Datensätze, riskante Session-Cookies.
- Importmodus: Merge, Replace within chosen scope, Skip duplicates, Overwrite conflicts. Bei Replace vorher einen wiederherstellbaren Snapshot anbieten und nur ausdrücklich gewählten Scope ändern.
- Attribute soweit API-unterstützt unverändert erhalten; absolute/relative Expiration korrekt; HostOnly vs Domain Cookies, HTTPOnly, SameSite, Secure, PartitionKey und StoreId sachgerecht behandeln.
- Einzel-Ergebnisse zählen: processed / imported / overwritten / skipped / failed; konkrete Fehlermeldung **pro Cookie** statt „Unknown Error“. Nach `set()` ein passendes `get`/`getAll` zur tatsächlichen Verifikation, kein Erfolg allein wegen resolved Promise.
- Import muss funktionieren, wenn die Zielwebsite noch nicht offen ist oder die Seite zu OAuth/ADFS weiterleitet: Ziel-URL/Domain explizit wählen, Hostpermission für Zielhost anfordern, Import aus Extension-Manager durchführen; Session-Verhalten anschließend erklären.
- Bei Reload können Cookies durch Server/JavaScript geändert werden: nicht als „Import gescheitert“ ausgeben, sondern Cookiebase-Erfolg vs. spätere Änderung unterscheiden.
- Browser-übergreifender Import ist Dateiaustausch, **kein direkter Zugriff auf andere Browser oder Profile**.

### CB-06: Verständlicher Export und Backups

- Scope: aktiver Host / aktuelle Site inkl. Subdomains / Auswahl / alle zugänglichen Cookies; sichtbare Scope-Angabe.
- Formate: JSON und Netscape `cookies.txt`, sowohl **Copy to Clipboard** als auch **Download File**. Geeignet für reguläre Entwickler-Workflows einschließlich yt-dlp, soweit das Format die erforderlichen Daten darstellen kann.
- Spezifisches Feedback: „Copied 37 cookies to clipboard“ vs. „Saved cookies-2026-..json to Downloads“. Nie so tun, als sei eine Datei gespeichert worden, wenn nur die Zwischenablage gefüllt wurde.
- JSON-Format versionieren und mit Cookie-Metadaten sauber dokumentieren; Netscape-Limitierungen (z. B. nicht alle neueren Attribute/Partition-Metadaten) offen angeben.
- Vor Export von Werten: klare Sicherheitswarnung wegen potenzieller Sessionübernahme; bewusste Bestätigung. Zusätzlich redacted export ohne Werte anbieten.
- Import/Export-Roundtrip auf realistischem Fixture testen; unverschlüsselte Exportdateien nie ohne Hinweis als „sicher“ bezeichnen.

### CB-07: Session Profiles — gleichrangiges Kernfeature

- Nutzer können **benannte Session Profiles** pro Site / Domain-Gruppe erstellen, aus aktuell ausgewählten Cookies oder aus Importdatei; Profilname, Beschreibung, Erstellungs-/Änderungszeit, Domain-Scope, Cookie-Anzahl und optionale Tags.
- Profile erstellen, bearbeiten, duplizieren, löschen, umbenennen, suchen, auswählen, exportieren und importieren.
- Anwendung: **Preview / Apply / Verify / Report**. Vor Apply Scope, betroffene Cookies, Overwrites/Removals und Sicherheitsrisiken anzeigen. Optionale Backup-Erstellung des aktuellen Zustands; „Merge“ vs. „Replace only within chosen scope“.
- Ein-Klick-Wechsel zwischen selbst angelegten QA-Testzuständen, beispielsweise „Logged out“, „Test User“, „Admin“, „Staging“. Keine automatische Anmeldung versprechen: Server können Sessions invalidieren, MFA/CSRF/Rotation kann Restore verhindern.
- Nach Apply prüfen, welche Cookies wirklich gesetzt wurden; optionale Page Reload; per Cookie Fehler darstellen. Best-Effort-Restore des Backups bei Problemen, ausdrücklich nicht als echte ACID-Transaktion verkaufen.
- Profiles sicher persistent speichern: **Cookie-Werte und sensible Profildaten verschlüsselt at rest**, etwa Web Crypto AES-GCM mit per Vault abgeleitetem Schlüssel (sichere KDF, Salt, Versionierung), Passwort/Passphrase beim Unlock, kein Schlüssel im Klartext persistent. Umgang mit Browser-Neustart, verlorener Passphrase und gesperrtem Vault klar gestalten. Keine pseudo-sichere Verschlüsselung.
- Keine unverschlüsselte Speicherung sensibler Session-Werte in Debug-History, App-Logs, `chrome.storage.sync` oder versehentlichen IndexedDB-Feldern.
- Browser-Profile voneinander getrennt behandeln: ein Profil in Cookiebase ist ein **Cookie-Snapshot innerhalb des aktuellen Chrome-Browserprofils**, kein freier Zugriff auf andere Chrome-Profile. Übertragung nur durch bewussten Export/Import.
- Inkognito standardmäßig nicht in persistente Profile aufnehmen; bei ausdrücklich gewähltem Inkognito-Workflow getrennte Stores und klare Zustimmung respektieren.
- Keine automatische Sicherung der Website-LocalStorage/IndexedDB oder Passwörter als Teil eines „Cookie Profile“ behaupten. Scope bleibt Cookies; optionale Erweiterungen nicht heimlich aktivieren.

### CB-08: Cookie Debugger und Change History

- Über `chrome.cookies.onChanged` Änderungen überwachen, soweit Berechtigung/Browser-API reicht: add, remove, overwrite, expire, evict; `cause` und Zeitpunkt der **Beobachtung** anzeigen.
- Chronologische Timeline mit Scope-/Domain-/Name-Filtern und klarer Start/Stop-Steuerung; Debugging default OFF, solange kein explizites Benutzerinteresse besteht. Begrenzte Aufbewahrung/konfigurierbares Retention-Policy. Kein dauerhaftes Aufzeichnen von Cookie-Werten im Klartext.
- Snapshots vor/nach Reload, Login und Import erstellen, vergleichen und anzeigen: added / removed / changed attributes / changed value (Wert standardmäßig maskiert).
- Besonderheiten der `onChanged`-Overwrite-Events (Remove/Set-Paar) korrekt korrelieren; keine Doppelzählung als zwei unabhängige Nutzeraktionen.
- Diagnose für „Cookie verschwindet nach Reload“, „Import success, dann unknown error“, „OAuth-/ADFS-Redirect“ anhand **beobachtbarer** Fakten. Keine erfundenen Kausalitäten.
- Wenn technisch machbar: optionale DevTools-Integration für Request/Response-Header-Analyse mittels dokumentierter API; Netzwerk-/HAR-Daten nur bei ausdrücklicher Aktivierung, keine unkontrollierte Speicherung, sensible Header/Werte standardmäßig redigieren. Fehlt eine API oder verhindert Chrome eine echte `Set-Cookie`-Ablehnungsursache, sichtbar „not observable“ statt Fake-Diagnose.
- Debugging muss ohne offene DevTools mindestens Cookie-Events/Snapshots können.

### CB-09: Berechtigungen und Fehlerbehandlung

- Erkläre Berechtigungen in verständlicher Sprache; Aktionen „Grant access to this site“, „Grant access to all sites“, „Manage granted sites“, „Retry“; Systemdialog **direkt** aus einer echten nutzerinitiierten Aktion aufrufen, kein kaputter Button.
- Checke `chrome.permissions.contains` oder passende APIs und zeige aktuellen Status, inkl. vererbter/entzogener Zugriffe.
- Tastaturbedienbare und fokussierbare Buttons; Permission-Denial, geschlossene Tabs, Browser-restricted Schemes, Admin Policies, leere Seite, Cookie-Store-Kontext und nicht unterstützte Browser erklären.
- Die App darf wegen fehlender Berechtigung, einer fehlerhaften Importdatei oder einer einzelnen Cookie-Operation nicht komplett unbenutzbar werden.
- Keine generische „Unknown error“-Meldung, wenn technisch eine konkrete Fehlerursache ermittelbar ist; interner Debug-Log darf keine Cookie-Werte enthalten.

### CB-10: Stabilität, Integrität und Performance

- Manifest-V3-Lifecycle: SW Neustart, Popup-Schließen, Background-Suspension und Browser-Neustart überstehen (wo Persistenz vorgesehen); verlaufende Jobs mit eindeutigen Ergebnissen und Resume/Recovery-Konzept.
- Kein unkontrolliertes Speicherwachstum/Leck bei Events, keine mehrfach registrierten Listener, keine Dead-Buttons, kein Absturz in Incognito-Kontexten.
- Trennung regulär/Inkognito sowohl bei Lesen/Schreiben/Löschen als auch History/Profile/Backups. Benutzer entscheidet ausdrücklich über Transfers; keine unbeabsichtigten Incognito->Regular-Imports.
- Robuste Eingabevalidierung, sichere Header-/URL-Verarbeitung, stabile Suche/Filterung, bei großen Datenmengen gutes Rendering; keine Browser-Settings-Manipulation.
- Teste soweit machbar auch Chrome/Edge/Brave, aber behaupte keine unterstützte Funktion ohne Test. Keine Zusage für Chrome Android.

### CB-11: Vertrauen, klare Kommunikation und Datenschutz

- Keine Ads, keine Sponsor-Panels, kein Tracking, keine Telemetrie, keine externen Beacons; lokale Nutzung muss ohne Konto und ohne Backend funktionieren.
- Security-Onboarding: Session-Cookies sind Geheimnisse; nicht an Dritte versenden; Export-/Clipboard-/Profile-Risiken und Grenzen erklären.
- Review-Vorwürfe („Hacking durch Extension“, „ändert Suchmaschine“) **nicht** als nachgewiesene Fakten über Konkurrenz behandeln. Cookiebase muss solche Risiken konstruktiv minimieren, keine Browser-Einstellungen manipulieren und durch nachvollziehbare Architektur Vertrauen ermöglichen.
- Option zum Löschen aller Cookiebase-eigenen Daten (Rules, Snapshots, Vault, History, Settings) mit getrennten, klaren Scopes; Löschen von Browser-Cookies ist eine **separate, explizite** Aktion.
- Quelloffenes Projekt und Datenschutzdokumentation entsprechend der tatsächlich vorhandenen Lizenz/Implementierung; nichts versprechen, was die Software nicht leistet.

## 4. Review-to-requirement Traceability (PFLICHT)

Pflege `docs/REVIEW_REQUIREMENTS.md` mit folgender nachvollziehbarer Matrix und ergänze pro ID Implementierung, Test(s) und Status:

| Review-Kritik / Wunsch | Umsetzung |
| --- | --- |
| Nur Cookies der aktiven Website, keine globale Suche | CB-01, CB-02 |
| Kein Cookie-Name-/Domain-/Zeitfilter | CB-01 (Zeitfilter nur für verfügbare Daten) |
| Nicht alle Cookies sichtbar, DevTools zeigt mehr | CB-02, CB-09 |
| HttpOnly / partitioned / enterprise browser unklar | CB-02, CB-04, CB-09 |
| Delete All löscht wichtige Cookies | CB-03 |
| Subdomain-Cookies nicht gezielt erhalten | CB-03 |
| Einzelne Cookies deaktivieren/reaktivieren | CB-04 |
| Domain/Advanced Properties bei Cookie-Erstellung fehlen | CB-04 |
| Import funktioniert nicht / Unknown Error / falsche Erfolgsmeldung | CB-05, CB-08, CB-09 |
| Cookies gehen nach Reload verloren | CB-05, CB-08 |
| Import bei OAuth/ADFS-Redirect schwierig | CB-05, CB-08 |
| Dateiin-/export, Clipboard und Ausgabepfad unverständlich | CB-05, CB-06 |
| Alle Cookies als JSON exportieren | CB-06 |
| Netscape cookies.txt / yt-dlp | CB-06 |
| Browserprofile/Testsessions wiederverwenden | CB-07 |
| Inkognito importiert versehentlich in normales Profil | CB-07, CB-10 |
| Permission-Buttons ohne Funktion / Tab nicht erreichbar | CB-09 |
| Manifest-V3-Probleme, allgemeine Instabilität / Chrome-Crash | CB-09, CB-10 |
| Langsame Öffnung | CB-01, CB-10 |
| Werbung / Sicherheitsbedenken | CB-11 |
| Einfachheit und gutes Import/Export sind positive Eigenschaften | CB-05, CB-06 sowie UI-Grundsätze |
| Mobile Chrome, Brave, Firefox und Managed Browsers werden verwechselt | CB-09, CB-10 und klare Support-Grenzen |

Jede Zeile muss einen Abnahmetest oder eine dokumentierte technische Einschränkung haben. Nichts als „done“ markieren, wenn nicht implementiert und überprüft.

## 5. Umsetzung / Module

Schlage zu Beginn kurz eine Architektur im Repository vor, implementiere sie aber anschließend **direkt**. Kernmodule sollten sinnvoll getrennt sein:

- `cookieRepository` / Chrome-API-Adapter (get/set/remove, normalisieren, stores, partitions, permissions)
- `cookieIdentityAndScope` (Scope, PSL, Normalisierung, Store-/Partition-Isolation)
- `ruleEngine` (Allowlist, Delete Preview, protected matches)
- `importers` / `exporters` (JSON, Netscape, Preview, Mapping, Validierung, Result Report)
- `sessionVault` / `profileService` (verschlüsselte Profiles, Snapshot, Apply, Rollback-Best-Effort)
- `historyService` / `debugService` (onChanged, Timeline, Snapshot Diff, Retention)
- `permissionService` (request/contains/revoke status, Diagnostics)
- `storage` mit Schema-Versionen/Migrations und Datenminimierung
- Popup-/Manager-/Debug-UI mit OJ-Designsystem und solider Datenfluss-/Fehlergrenzenlogik

Der genaue Dateibaum ist deine technische Entscheidung. Keine überflüssigen Abstraktionen oder Abhängigkeiten. UI, Browser-API, Business Rules, Vault-Krypto und Persistenz sauber trennen.

## 6. Umsetzung in nachvollziehbaren Phasen mit Commits

1. **Audit & Plan** — Repository prüfen, fehlende Anforderungen identifizieren, `docs/IMPLEMENTATION_PLAN.md` mit Architektur/Review-Matrix/Tests erstellen; Startzustand dokumentieren. Danach weiterarbeiten, nicht nur planen.
2. **Core & UI** — MV3, OJ-Designsystem-Integration, Popup, Manager, Berechtigungen, Scope, globale Suche, Attribute und Performance.
3. **Control & Editing** — Cookie-CRUD, Protected Rules, selektives Löschen, Vorschau, Subdomain-Scope, Disable/Restore.
4. **Import & Export** — JSON/Netscape, Datei/Clipboard, Preview, Validierung, Import Results, Roundtrip.
5. **Session Profiles** — Vault, Profile-Verwaltung, Apply/Verify, Snapshots, Rollback, sichere Transfers.
6. **Debugger** — Event-Timeline, Diff, Reload/OAuth-Diagnostik, optionale DevTools-Anbindung soweit sauber umsetzbar.
7. **Reliability & Security** — Service-Worker-Lifecycle, Inkognito-Isolation, Browsergrenzen, Sicherheitsprüfung, Accessibility, Performance.
8. **Verification & Release Readiness** — E2E, reale Chromium-Extension-Tests, README, Security/Privacy, Changelog, Testreport, Release-Build.

Nach jeder **fertig umgesetzten und überprüften** Phase einen kleinen sinnvollen Git-Commit erzeugen (z. B. `feat(cookiebase): add protected cookie rules`). Keine Änderungen an anderen Repositories ohne explizite Freigabe. Alle Änderungen gehören ins aktuelle Arbeits-Repository.

## 7. Teststrategie und messbare Abnahmekriterien

Nutze Unit- und Integrationstests für Parser, Scope/PSL, Rule Engine, Cookie-ID, Profile-Krypto, Fehlerbehandlung und Event-Diffs. Ergänze **echte MV3-Chromium-E2E-Tests** mit Playwright/Persistent Context und geladenem Extension-Build; die standardmäßige Playwright-Chromium-Installation verwenden und die offizielle Extension-Testdokumentation beachten. Testserver mit lokalen HTTP-/HTTPS-Fixtures und kontrollierten `Set-Cookie`-Antworten verwenden, keine echten Logins in fremde Services oder privaten Accounts.

Mindestens diese E2E-Fälle:

- Frische Installation -> Popup/Manager funktionieren, OJ-CSS/Fonts/Icons sind vorhanden.
- Keine Permission -> sichtbare Erklärung, funktionierender Grant-Flow, Denial-Fallback und Erneut-Versuchen.
- Zwei Domains inkl. Subdomains, Cookies mit gleichen Namen und unterschiedlichen Pfaden -> richtige Suche, Scope und gezielte Löschung.
- Cookie mit HttpOnly/Secure/SameSite/Session -> korrekte Anzeige und dokumentiertes Bearbeitungsverhalten.
- Partitioned/Store-Kontext -> keine stillen Vermischungen; echte Einschränkungen angezeigt.
- Protected Rule + Bulk Delete -> geschützte Cookies bleiben, andere werden entfernt; Preview stimmt.
- Cookie-Create-Advanced-Options -> vollständig; Disable -> Restore -> tatsächliche Prüfung.
- JSON- und Netscape-Export -> Clipboard und Dateidownload unterscheiden sich; Roundtrip; ungültiger Import mit pro-Cookie-Fehlern.
- Import während Redirect-/OAuth-artigem Testablauf -> nicht vom aktiven Tab abhängig; spätere Cookie-Änderungen werden verständlich berichtet.
- Session Profile A/B -> Save, Apply, Compare, Restore, Verifikation, Reopen/Restart nach Vault-Unlock.
- Falsche Vault-Passphrase -> verständliche sichere Fehlermeldung ohne Datenleck.
- Cookie-Change-Events -> Timeline, Overwrite-Pair, Snapshot-Diff, Retention, keine Werte im Klartext in Logs.
- Inkognito mit verfügbarer Berechtigung -> Store-Trennung; regulärer Store unberührt.
- Große Cookie-Fixture -> UI responsiv und keine Freezes; Messwerte im Testbericht.
- Keyboard-Only/A11y -> Dialog, Tabs, Suchfeld, Checkboxen, Permissions vollständig bedienbar, keine kritischen Accessibility-Verstöße.
- Service-Worker-Suspension/Neustart und Popup-Close während Operation -> keine falschen Erfolgsmeldungen, Recovery-Status korrekt.

Nach jeder Veränderung passende Tests ausführen, am Ende vollständige Scripts `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e` (oder bestehende, dokumentierte Entsprechungen) aufrufen. Echte Browser-/Host-Permission-Tests nicht durch reine Mocks ersetzen. Wo lokale Testumgebung Grenzen hat, exakt aufschreiben, was nicht getestet wurde — nicht grünen Status erfinden.

### Definition of Done

Cookiebase kann bei korrekter Hostfreigabe Cookies tatsächlich auflisten/suchen/bearbeiten/löschen, selektiv schützen, JSON/Netscape korrekt importieren/exportieren, verschlüsselte Session Profiles verwalten/anwenden und Änderungen diagnostizieren. Die UI arbeitet ohne Ads, ohne Tracking und vollständig mit `oj-designsystem`; echte API-Fehler werden angezeigt statt verschluckt. Alle Review-Matrix-Punkte sind nachgewiesen implementiert oder ausdrücklich als technisch unerfüllbar/teilweise umgesetzt begründet. Der Extension-Build lässt sich als unpacked Extension in Chrome laden.

## 8. Dokumentation & Abschlussausgabe

Erstelle/aktualisiere mindestens:
- `README.md`: Produktnutzen, Feature-Screens/Übersicht (falls echte Screenshots vorhanden), Install/Build, Chrome `Load unpacked`, Test, Browser-Support und klare Sicherheitswarnungen.
- `docs/REVIEW_REQUIREMENTS.md`: komplette Matrix mit Links auf Code und Tests sowie finalem Status.
- `docs/ARCHITECTURE.md`: Schichten, Cookie-Identity/Scope, Browser-APIs, Storage-Schema, SW-Lifecycle.
- `docs/SECURITY.md`: Threat Model (Cookie-/Session-Diebstahl, unsichere Exporte, Vault/KDF, Clipboard, Inkognito, Permissions), tatsächliche Schutzmaßnahmen und Grenzen.
- `docs/TEST_REPORT.md`: tatsächlich ausgeführte Befehle, Ergebnisse, E2E-Screenshots soweit erzeugt, gemessene Einschränkungen.
- `docs/IMPLEMENTATION_PLAN.md`: initiale und abgeschlossene Phasen, verbleibende Risiken.
- `CHANGELOG.md`: neue Features und Breaking Changes.

**Arbeitsweise:** Nicht nach jedem Schritt Rückfragen stellen. Nutze den vorhandenen Code, überprüfe Browser/API-Dokumentation, entscheide pragmatisch, implementiere, teste, committe und arbeite die Phasen ab. Keine Dummy-Buttons, kein Fake-Import, keine gemockte Erfolgsanzeige in der Produktions-App. Wenn ein Feature technisch nur teilweise möglich ist, implementiere den maximal ehrlich unterstützten Teil mit gutem Nutzerfeedback und dokumentiere die Grenze. Lass den produktiven Code in einem überprüfbaren Zustand. Unterbrich die Umsetzung nicht nach dem Plan, solange Arbeit und Toolbudget zur Verfügung stehen.

**Deine finale Antwort:** 1. Was implementiert wurde (geordnet nach CB-01 bis CB-11). 2. Welche Tests tatsächlich bestanden/nicht bestanden. 3. Die erzeugten Commits. 4. Genaue Anleitung, wie ich Cookiebase lokal starte und als Chrome-Extension teste. 5. Verbleibende echte API-/Sicherheitsbeschränkungen und offene Punkte.
