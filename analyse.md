# Cookiebase UX-Analyse — 29. Oktober 2026

Der Manager braucht eine klarere Aufgabenhierarchie und ein eindeutiges Modell für Website, Scope, Filter, Auswahl und Aktion. Viele Funktionen sind vorhanden, werden jedoch gleichzeitig angeboten oder wirken anders, als ihre Beschriftung erwarten lässt. Der größte Nutzen entsteht durch nachvollziehbare Abläufe und weniger dauerhaft sichtbare Bedienelemente.

Prüfbasis: aktueller Repository-Stand `0f5161d`, `src/ui/app.js`, `app.css`, relevante Worker-/Service-Verträge und die vorhandenen echten Screenshots in `docs/evidence/`. Der vom Nutzer genannte `chrome-extension://`-Link wurde vom Browserzugriff aus Sicherheitsgründen blockiert. Die konkrete geöffnete Browserinstanz, ihre Cookie-Liste und der aktuelle Vault-/Permission-Status wurden deshalb nicht live beurteilt. Aussagen über Verhalten sind anhand des Codes belegt; vorgeschlagene Layouts sind Empfehlungen, keine bereits gemessenen Verbesserungen. Es wurden keine Cookies verändert, Berechtigungen erteilt oder Implementierungen geändert.

OJ wurde gegen das installierte `oj-designsystem@0.2.1` und die aktuellen Repository-Dokumente geprüft. Die meisten vorgeschlagenen Bausteine sind bereits vorhanden. Maßgeblich sind [Component contracts](https://github.com/oliverjessner/oj-designsystem/blob/main/docs/COMPONENTS.md), [JS API](https://github.com/oliverjessner/oj-designsystem/blob/main/docs/JS-API.md) und [Theming](https://github.com/oliverjessner/oj-designsystem/blob/main/docs/THEMING.md). Es wird kein zusätzliches UI-Framework benötigt.

Prioritäten: **Hoch** bedeutet missverständliche Wirkung, fehlende Kontrolle oder einen blockierten Ablauf. **Mittel** bedeutet unnötige Komplexität oder schlechte Auffindbarkeit. **Feinschliff** betrifft Darstellung und Sprache. Diese Einstufung ersetzt keinen unabhängigen Sicherheitsaudit.

1. **Cookies stehen zu weit unten — Mittel.** Im vorhandenen Erststart-Screenshot nehmen Marke, Navigation, Status, Scope-Formular und Einführung viel Höhe ein, bevor die eigentliche Cookie-Arbeit beginnt. Der Nutzer muss sich durch Voraussetzungen arbeiten, statt sofort die Zielsite und Ergebnisse zu sehen.

   Verbesserung: Oben ein kompakter Kontextkopf `chatgpt.com · This site · Access granted`, direkt darunter Suche und Cookie-Liste. Seltene Optionen werden auf Abruf geöffnet. Ziel: Bei normaler Desktophöhe sind Ergebnisse oder ein handlungsfähiger Leerzustand ohne vorheriges Scrollen sichtbar. OJ: `oj-section-header`, `oj-toolbar`, `oj-panel-compact`, `oj-status`. Grundlage: [Render/Scope](src/ui/app.js#L85), [Screenshot](docs/evidence/manager.png).

2. **Dasselbe Scope-Formular erscheint in jedem Workspace — Mittel.** Auch Settings, Vault-Unlock und allgemeine Regelverwaltung beginnen mit URL, Cookie-Scope, Store, Domain-Liste und Grant-Buttons. Das suggeriert, diese Voraussetzungen seien für jede Tätigkeit notwendig.

   Verbesserung: Gemeinsamen Site-Kontext klein halten; umfangreiche Scope-Einstellungen nur bei Lesen, Export, Apply oder anderen tatsächlich scopebezogenen Aktionen öffnen. Settings bleibt eine unabhängige Verwaltungsseite. OJ: kompakte Navigation, `oj-badge`, `oj-accordion`. Ziel: Der Nutzer kann Einstellungen oder den Vault bedienen, ohne zuerst einen Cookie-Scope konfigurieren zu müssen. Grundlage: [commonScope in render](src/ui/app.js#L92).

3. **Scope-Änderungen deaktivieren fachfremde Buttons — Hoch.** `invalidateScope()` leert die Cookie-Liste und deaktiviert alle Buttons in `#main`. Damit können auch Vault-Unlock, Debug-Stop oder Settings-Aktionen bis zum Klick auf Refresh unbedienbar werden.

   Verbesserung: Entweder den neuen Scope automatisch laden oder einen sichtbaren Entwurf mit `Apply scope` anbieten. Nur Aktionen auf veralteten Cookie-Ergebnissen sperren; Debug-Stop und Verwaltung bleiben erreichbar. OJ: `oj-inline-message`, `oj-spinner`, gezieltes `disabled`. Ziel: Eine Site-Änderung kann niemals den Stop-Button der Aufzeichnung sperren. Grundlage: [invalidateScope](src/ui/app.js#L112).

4. **„Current“ bezeichnet nicht zuverlässig den aktuellen Tab — Hoch.** Die URL wird beim Öffnen übernommen oder manuell verändert. Danach ist sie ein gespeichertes Ziel; die Oberfläche erklärt weder diesen Zustand noch den Unterschied zur gerade aktiven Browserseite.

   Verbesserung: Zwei ausdrücklich bezeichnete Modi `Follow active tab` und `Pinned site`. Im Manager die Site als Domain anzeigen, die vollständige URL bei Bedarf bearbeiten. Scope-Texte konkret formulieren: `This page`, `chatgpt.com only`, `chatgpt.com + subdomains`, `Selected sites`, `All granted sites`. OJ: `oj-segmented`, `oj-select`, `oj-helper`, `oj-badge`. Ziel: Es ist jederzeit erkennbar, auf welche Website die nächste Aktion wirkt. Grundlage: [scope state](src/ui/app.js#L13), [boot](src/ui/app.js#L330).

5. **Zielsite und Reload-Tab können auseinanderlaufen — Hoch.** Eine manuell geänderte URL aktualisiert `state.url`, aber nicht den beim Öffnen übergebenen `tabId`. `Reload target page` kann deshalb weiterhin den ursprünglichen Tab neu laden.

   Verbesserung: Tab-Bindung getrennt anzeigen, etwa `Reload ChatGPT tab`. Reload nur aktivieren, wenn der gebundene Tab vorhanden ist und zum angezeigten Ziel passt. Bei einem rein manuell gewählten Importziel `Open site` anbieten. Ziel: Die Oberfläche kann keine andere Site neu laden, als ihr Kontext erwarten lässt. OJ: `oj-status`, `oj-inline-message`, beschrifteter Button. Grundlage: [URL change](src/ui/app.js#L101), [reloadTarget](src/ui/app.js#L313).

6. **Fünf Zugriffsaktionen konkurrieren ständig miteinander — Mittel.** Grant site, all sites, selected domains und site including subdomains stehen neben Refresh, auch wenn die benötigte Site bereits freigegeben ist.

   Verbesserung: Bei fehlendem Zugriff genau eine primäre Aktion `Allow access to chatgpt.com`. Bei vorhandenem Zugriff ein Status `Access granted`; weitere Optionen unter `Manage access`. Die systemseitige Anfrage bleibt direkt an einen bewussten Klick gebunden. OJ: `oj-status`, `oj-dropdown`/`oj-menu`, `oj-alert`. Ziel: Kein dominanter Grant-Button für eine bereits erlaubte Site. Grundlage: [permission actions](src/ui/app.js#L107).

7. **„Limited access“ klingt auch bei ausreichendem Site-Zugriff nach einem Problem — Mittel.** Die Meldung beschreibt die fehlende globale Freigabe, nicht zwingend eine Einschränkung der gerade angezeigten Website. Dazu kommen wiederholte Store-/Scope-Angaben.

   Verbesserung: Site-Zugriff und globale Abdeckung getrennt benennen: `Access granted for this site` sowie bei globaler Suche `Results cover 4 granted sites`. Stores als verständlichen Kontext, nicht als mehrfach wiederholte ID darstellen. OJ: `oj-status`, `oj-badge`, `oj-helper`. Ziel: Für normales Site-Editing wird keine unnötige All-sites-Freigabe nahegelegt. Grundlage: [scope summary](src/ui/app.js#L110).

8. **Navigation und Produktbegriffe bilden kein klares gemeinsames Modell — Mittel.** Sechs Workspaces stehen neben `Inspect · Control · Profiles`, obwohl die meisten Aktionen in Cookies liegen. Overview enthält hauptsächlich erklärenden Text und dupliziert Navigation.

   Verbesserung: Manager mit stabiler Seitennavigation für `Cookies`, `Rules`, `Profiles`, `Debug`; Settings sekundär. Overview entweder mit tatsächlich nützlichen Einstiegen ausbauen oder zugunsten des direkten Cookie-Einstiegs entfernen. Die Produktbereiche müssen nicht als zweite Navigation erscheinen. OJ: `oj-sidebar-nav`, `oj-nav`, `oj-metric` für echte Übersichtszahlen. Ziel: Ein Nutzer erkennt ohne Produkttext den richtigen Einstieg. Grundlage: [navigation/overview](src/ui/app.js#L88).

9. **Sicherheitshinweise beanspruchen zu viel dauerhafte Fläche — Mittel.** Ein globaler Datenschutzsatz, eine große Erststart-Erklärung, technische Hilfetexte und Coverage-Warnungen konkurrieren mit Arbeitsdaten. Viele gleichförmige Hinweise erschweren das Erkennen einer tatsächlichen Gefahr.

   Verbesserung: Einmalige kurze Einführung; ausführliche Erklärung über `Learn more`. Dauerhaft nur knapper Vault-/Access-Status. Situative Warnungen direkt bei Secret-Export, Replace oder Protection-Override. OJ: `oj-alert`, `oj-accordion`, `oj-status`. Ziel: Sicherheitsinformationen bleiben erhalten und erhalten genau dann visuelles Gewicht, wenn sie eine Entscheidung beeinflussen. Grundlage: [onboarding](src/ui/app.js#L94), [warnings](src/ui/app.js#L173).

10. **Die Tabelle zeigt zu viele gleichwertige Spalten — Mittel.** 13 Spalten einschließlich Auswahl zeigen zahlreiche Yes/No-Werte, durchgehend maskierte Values, technische Store-IDs und komplette Partition-Objekte. Wichtige Zeilenaktionen stehen weit rechts.

    Verbesserung: Standardmäßig Name, Domain/Path, Lifetime, Security/Protection und eine kompakte Aktionsspalte. Weitere Spalten über `Columns` auswählbar; alle Attribute bleiben in Details zugänglich. Die komplett maskierte Value-Spalte liefert im Standardzustand wenig zusätzliche Information. OJ: `oj-table`, `oj-table-sticky`, `createMultiselect`, `oj-badge`, `oj-key-value`. Ziel: Die üblichen Inspektionsaufgaben benötigen keine horizontale Suche über 13 Spalten. Grundlage: [table](src/ui/app.js#L156).

11. **Inspektion führt sofort in einen Edit-Dialog — Mittel.** Ein Klick auf den Namen öffnet ein umfangreiches Formular. Reines Lesen, Vergleichen und Bearbeiten sind dadurch kaum getrennt.

    Verbesserung: Im Manager eine Detailfläche neben der Tabelle; im Sidepanel eine eigene Detailansicht mit Zurück-Navigation. Erst `Edit` aktiviert Eingabefelder. Ein Wert wird nur ausdrücklich sichtbar gemacht. OJ: `oj-panel`, `oj-key-value`, `oj-split`; die Anordnung ist Cookiebase-Layout. Ziel: Attribute können gelesen werden, ohne versehentlich in einem Schreibablauf zu landen. Grundlage: [row/name action](src/ui/app.js#L163).

12. **Zeilenaktionen sind zu zahlreich und nicht zustandsabhängig — Mittel.** Neben jedem Cookie stehen Schutzstatus, Protect und Disable. Protect bleibt auch bei vorhandenem Schutz verfügbar und erzeugt erneut eine Regel.

    Verbesserung: Ungeschützt: `Protect`. Geschützt: `Protected by 1 rule` und `View rule`. Seltene Aktionen wie Duplicate, Disable oder Delete in ein Aktionsmenü. Leicht verständliche Icons erhalten Namen und sichtbaren Fokus. OJ: `oj-badge`, `oj-icon-button`, `oj-dropdown`, `oj-menu-item-danger`. Ziel: Wiederholtes Protect erzeugt keine versehentlichen doppelten Regeln. Grundlage: [row actions](src/ui/app.js#L163), [quickProtect](src/ui/app.js#L175).

13. **Sortierung und Gruppierung arbeiten gegeneinander — Mittel.** Bei Sortierung nach Name oder Ablauf wird bei jeder Domain-Unterbrechung eine neue Gruppenzeile erzeugt. Dieselbe Domain kann daher mehrfach auftauchen. Gleichzeitig sind die Tabellenköpfe nicht als Sortieraktionen ausgeführt.

    Verbesserung: Gruppierung separat schalten. Gruppierte Ansicht sortiert innerhalb einer Domain; flache Ansicht sortiert über alle Ergebnisse. Sortierbare Header mit sichtbarer Richtung. OJ: `oj-table-sort` und `aria-sort`, `oj-switch`, `oj-table-sticky`. Ziel: Eindeutige, vorhersehbare Reihenfolge ohne wiederholte Scheingruppen. Grundlage: [sort/group](src/ui/app.js#L128), [group rows](src/ui/app.js#L159).

14. **Bulk-Aktionen erscheinen unabhängig von Auswahl und Ergebnissen — Mittel.** Delete selected und Save selection sind auch ohne Auswahl präsent. Cleanup konkurriert als rote Aktion dauerhaft mit Routinefunktionen.

    Verbesserung: Im Normalzustand Suche, New cookie, Import und More. Bei Auswahl eine Leiste `7 selected · Export · Save profile · Delete · Clear`. Site-Cleanup als bewusst aufgerufenen Ablauf anbieten. OJ: `oj-toolbar`, `oj-dropdown`, `oj-badge`, `oj-button-danger`. Ziel: Keine Fehlermeldung erst nach Klick auf eine Aktion, die vorher offensichtlich nicht möglich war. Grundlage: [action bar](src/ui/app.js#L144).

15. **Die Auswahl über Seiten und Filter ist schwer nachvollziehbar — Mittel.** Die Kopfcheckbox kennt keinen gemischten Zustand. Einzelne Auswahländerungen entfernen die Seiteninformation aus dem Zähler. Versteckte ausgewählte Cookies bleiben in der Gesamtzahl enthalten.

    Verbesserung: Ergebniszahl, Seite und Auswahl separat darstellen. `indeterminate` für Teilauswahl. Unterschied zwischen `Select this page` und `Select all 240 results` ausdrücklich anbieten. Versteckte Auswahl sichtbar machen. OJ: native `oj-checkbox`, `oj-pagination`, `oj-inline-message`. Ziel: Vor einer Bulk-Aktion ist exakt klar, welche Menge ausgewählt ist. Grundlage: [selection/count](src/ui/app.js#L151).

16. **Aktive Filter verschwinden hinter einem geschlossenen Bereich — Mittel.** Viele Filter wirken weiter, obwohl ihr Details-Bereich geschlossen ist. Es gibt keine Übersicht aktiver Filter und keinen Reset. Zusätzlich verwendet der Code `oj-details`; dokumentiert ist `oj-accordion`.

    Verbesserung: `Filters (3)` anzeigen, aktive Filter mit Label und Entfernen-Button über den Ergebnissen darstellen, `Reset filters` anbieten. Den vorhandenen OJ-Accordion mit Body verwenden. Zeitfilter als zweite Ebene. OJ: `oj-accordion`, `oj-accordion-body`, `oj-tag`, `oj-icon-button`. Tags liefern Darstellung; Remove-Logik gehört zur App. Ziel: Jede Einschränkung ist sichtbar und mit höchstens einer Aktion entfernbar. Grundlage: [filters](src/ui/app.js#L130).

17. **Observed-time-Filter erklären ihre Voraussetzung nicht an Ort und Stelle — Mittel.** Sie werden wie normale Datumsfilter angeboten, obwohl passende Beobachtungsdaten erst durch Debug-Aufzeichnung entstehen. Ein leeres Ergebnis kann daher falsch als „keine Cookies“ verstanden werden.

    Verbesserung: Direkt am Filter `Available for changes observed while recording` und den vorhandenen Beobachtungszeitraum anzeigen. Ohne Daten eine passende Erklärung und den Einstieg zu Debug geben. OJ: `oj-helper`, `oj-inline-message`, `oj-badge`. Ziel: Fehlende Messdaten und echte Nulltreffer sind unterscheidbar. Grundlage: [observed filters](src/ui/app.js#L138), [observed metadata](src/worker.js#L45).

18. **Leere Zustände sind nur Text in einer großen Tabelle — Mittel.** Keine Zugriffsrechte, eine Site ohne Cookies und keine passenden Suchtreffer unterscheiden sich hauptsächlich durch einen Satz. Eine passende nächste Aktion fehlt im direkten Blickfeld.

    Verbesserung: Eigenständige Zustände: `No access` mit Allow; `No cookies on this site` mit Create/Import; `No matches` mit Reset filters. Leere Tabellenköpfe und Pagination dafür ausblenden. OJ: `oj-empty-state` mit passenden Aktionen. Ziel: Jeder Leerzustand erklärt Ursache und nächsten Schritt. Grundlage: [empty result](src/ui/app.js#L165).

19. **Editierbare Identitätsfelder versprechen nicht unterstützte Änderungen — Hoch.** Name, Domain, Path und Store sehen im Edit-Modus frei veränderbar aus. Der Worker lehnt einen Identitätswechsel erst beim Save ab.

    Verbesserung: Identität im Edit-Modus readonly erklären und `Duplicate as new cookie` anbieten. Ein späterer Move wäre ein eigener, bewusst bestätigter Ablauf. Beim Erstellen bleiben sämtliche unterstützten Attribute erreichbar. OJ: `oj-key-value`, readonly `oj-input`, `oj-dropdown`. Ziel: Kein erlaubter Formulareintrag führt erst nach Save zu einem prinzipiellen Verbot. Grundlage: [editor](src/ui/app.js#L194), [worker guard](src/worker.js#L59).

20. **Abhängigkeiten zwischen Editorfeldern sind nicht dargestellt — Mittel.** Session und Expiration sind gleichzeitig bedienbar. Cross-site ancestor bleibt ohne Partition aktiv. Store ist ein Freitextfeld, obwohl gültige Stores bekannt sind.

    Verbesserung: Lifetime als `Session / Expires`; Datum nur beim zweiten Modus. Partition als eigene Gruppe mit abhängigen Optionen. Store als geprüfte Auswahl mit Regular/Incognito-Kontext. Advanced bleibt auch bei Create verfügbar, kann aber aufgeklappt werden. OJ: `oj-segmented`, `oj-field`, `oj-select`, `oj-accordion`, `oj-helper`. Ziel: Ungültige oder wirkungslose Kombinationen werden bereits im Formular vermieden. Grundlage: [advanced editor](src/ui/app.js#L197).

21. **Formularfehler erscheinen außerhalb des geöffneten Dialogs — Hoch.** `showError()` schreibt an den globalen Seitenkopf und erzeugt einen Dokument-Toast. Während eines nativen Modals liegen diese Rückmeldungen außerhalb des fokussierten Arbeitsbereichs. Feldzuordnung fehlt.

    Verbesserung: Fehlerzusammenfassung im aktuellen Dialog, Feldfehler mit `aria-invalid` und `aria-describedby`, Fokus auf das erste fehlerhafte Feld. Eingaben erhalten. Toast nur ergänzend innerhalb des passenden Roots. OJ: `oj-helper-error`, `oj-inline-message`, `oj-alert`, `toast` mit Dialog-Root. Ziel: Nach einem fehlgeschlagenen Save weiß der Nutzer sofort, welches Feld wie korrigiert werden muss. Grundlage: [showError](src/ui/app.js#L53), [editor catch](src/ui/app.js#L213).

22. **API-Begriffe und Secret-Editor erschweren das Lesen — Feinschliff.** Begriffe wie `no_restriction`, `hostOnly` und `httpOnly` werden teilweise unverändert angezeigt. Lange Values sind nur über ein einzeiliges Passwortfeld zugänglich.

    Verbesserung: Sichtbar `SameSite: None`, `HTTP only`, `Exact host only`, `Session cookie`; kurze feldnahe Hilfen. Für ausdrücklich enthüllte lange Werte eine vollständige, umbrechende technische Darstellung mit Copy und Remask anbieten. JSON-Anzeige nur bei tatsächlich gültigem JSON. OJ: `oj-label`, `oj-helper`, `oj-key-value`, `oj-code-block`, Font-Awesome-Icons mit Namen. Ziel: Lesbarkeit steigt, während Werte standardmäßig maskiert bleiben. Grundlage: [table/editor labels](src/ui/app.js#L163).

23. **Import und Export teilen sich einen überlangen Dialog — Mittel.** Beide Aufgaben samt Datei, Paste, Modus, Ziel, Store, Backup, Override und Preview stehen untereinander. Beim Import muss zuerst ein Exportbereich überblickt werden.

    Verbesserung: Getrennte Einstiege oder OJ-Tabs. Import führt durch Quelle → Ziel/Modus → Vorschau → Ergebnis. Export zeigt nur Umfang, Werte-Option, Format und Ausgabeziel. OJ: `oj-tabs`, `initTabs`, `oj-dropzone`, `oj-panel`. Die Workflow-Steuerung gehört zur App; `oj-steps` ist kein fertiger interaktiver Form-Stepper. Ziel: Pro Schritt ist nur die gerade relevante Entscheidung sichtbar. Grundlage: [transferDialog](src/ui/app.js#L232).

24. **Import-Ziel und tatsächlicher Scope widersprechen der sichtbaren Erwartung — Hoch.** Eine Ziel-URL kann im Dialog geändert werden, ausgeführt wird weiterhin im äußeren Manager-Scope. Außerdem füllt die URL nur fehlende Domains; vorhandene Domain-/Store-Angaben werden nicht automatisch umgeschrieben.

    Verbesserung: Der Import erhält einen eigenen, einzigen sichtbaren Ziel-Scope. Pro Cookie Quell- und Ziel-Domain/Store darstellen. `Keep domains from file` und ein bewusstes Remapping klar unterscheiden. Ein Zielwechsel muss im Import möglich sein, ohne die Quelldaten zu verlieren. OJ: `oj-select`, `oj-key-value`, `oj-table`, `oj-helper`. Ziel: Kein Import wird wegen eines unsichtbaren äußeren Scopes unerwartet abgewiesen oder anders verstanden. Grundlage: [target/options](src/ui/app.js#L240), [execution scope](src/ui/app.js#L249).

25. **Zwei Importmodi haben dieselbe Bedeutung — Mittel.** Merge und Overwrite setzen beide valide neue Cookies und überschreiben Konflikte derselben Identität. Die vier angebotenen Namen suggerieren mehr unterschiedliche Strategien als vorhanden.

    Verbesserung: Drei konkrete Modi: `Add missing only`, `Add and overwrite matching`, `Replace chosen scope`. Je Modus die tatsächlichen Add/Overwrite/Remove-Zahlen aus der Preview zeigen. OJ: Radios oder `oj-segmented`, `oj-helper`, `oj-key-value`. Ziel: Jeder angebotene Modus hat eine unterscheidbare Wirkung. Grundlage: [mode names](src/ui/app.js#L239), [transfer planning](src/services/transfer.js).

26. **Die Backup-Checkbox entspricht bei Replace nicht dem Verhalten — Hoch.** Sie kann aus sein, während der Worker für Replace trotzdem einen Vault-Snapshot anfordert. Der Nutzer erfährt eine zwingende Voraussetzung erst durch einen späteren Fehler.

    Verbesserung: Bei Replace `Backup required` sichtbar aktiviert und nicht abschaltbar darstellen. Fehlenden Vault vor Apply kontextbezogen entsperren; danach dieselbe Importquelle/Preview fortsetzen. OJ: `oj-check`, `oj-inline-message`, `oj-dialog`. Ziel: Sichtbare Konfiguration und tatsächliche Ausführung stimmen überein. Grundlage: [backup control](src/ui/app.js#L242), [forced snapshot](src/worker.js#L119).

27. **Preview und Apply haben keinen klaren Gültigkeitszustand — Hoch.** Nach einer Änderung bleiben Apply-Aktionen teilweise klickbar; erst der Klick erklärt, dass erneut geprüft werden muss. Eine Profil-Preview wird asynchron geladen, ohne die Apply-Aktion anfangs sichtbar daran zu binden.

    Verbesserung: Zustände `Loading preview`, `Ready`, `Out of date`, `Blocked`. Änderungen an Quelle, Ziel oder Modus invalidieren die Preview sofort. Apply erst nach abgeschlossener gültiger Prüfung aktivieren; null importierbare Cookies passend behandeln. OJ: `oj-status`, `oj-inline-message`, `oj-spinner`, echtes `disabled`. Ziel: Jede aktive Apply-Aktion besitzt eine aktuelle Vorschau. Grundlage: [import preview](src/ui/app.js#L247), [profile preview](src/ui/app.js#L304).

28. **Exportierte Auswahl und angezeigte Auswahl können unterschiedlich sein — Hoch.** Der Auswahlzähler erfasst alle gewählten Cookies, exportiert wird aber die Schnittmenge aus Auswahl und aktuellen Filtern. Damit kann aus `10 selected` ein Export mit null Cookies entstehen.

    Verbesserung: Exportumfang ausdrücklich wählen: `Selected cookies (10)`, `Filtered results (42)` oder `Current site (67)`. Die Preview zählt exakt die gewählte Menge. Eine versteckte Auswahl wird erklärt und nicht stillschweigend anders interpretiert. OJ: `oj-segmented`, `oj-badge`, `oj-key-value`. Ziel: Angezeigte Exportzahl und tatsächlich ausgegebene Cookiezahl sind identisch. Grundlage: [selection count](src/ui/app.js#L151), [export intersection](src/ui/app.js#L236).

29. **Redacted-Export ist sicher voreingestellt, sein Verwendungszweck aber zu leicht zu verwechseln — Mittel.** Ein Export ohne Values ist kein wiederherstellbarer Session-Export. Ein Nutzer mit Backup-/yt-dlp-Ziel kann trotzdem ein scheinbar passendes Format wählen und erhält eine dafür unbrauchbare Datei.

    Verbesserung: Zuerst die Absicht benennen: `Share a redacted report` oder `Export working cookies — contains secrets`. Danach Format und `Copy`/`Download`. Secret-Bestätigung und klare Ausgabe-Rückmeldung beibehalten. OJ: `oj-segmented`, `oj-alert`, `oj-helper`. Ziel: Vor der Ausgabe ist klar, ob die Datei Cookies wiederherstellen kann. Grundlage: [export options](src/ui/app.js#L235).

30. **JSON ist an vielen Stellen die primäre Oberfläche — Mittel.** Import-/Apply-Vorschau, Resultate, Debug-Events und Recovery zeigen umfangreiche serialisierte Objekte. Der Nutzer muss Zähler, Fehler und Konsequenzen selbst herauslesen.

    Verbesserung: Zusammenfassung `34 imported · 2 skipped · 1 failed`, darunter eine lesbare Liste mit Cookie, Site, Grund und nächstem Schritt. Diffs als Added/Removed/Changed; Rohdaten nur unter `Technical details`. OJ: `oj-metric`, `oj-status`, `oj-table-compact`, `oj-key-value`, `oj-accordion`, `oj-code-block`. Ziel: Die nächste Handlung ist ohne JSON-Lesen erkennbar. Grundlage: [report](src/ui/app.js#L75), [preview](src/ui/app.js#L250), [debug/settings](src/ui/app.js#L314).

31. **Vault-Voraussetzungen sind weit vom eigentlichen Vorhaben entfernt — Hoch.** Disable und Profile-Speichern können erst nach mehreren Schritten am gesperrten Vault scheitern. Unlock ist hauptsächlich in Profiles sichtbar; das Eingabefeld ist nicht in einen Submit-Formularablauf eingebunden.

    Verbesserung: Global kompakter Vault-Status. Aktionen öffnen bei Bedarf `Unlock to continue` und werden danach mit erhaltenen Eingaben fortgesetzt. Unlock als echtes Formular mit Enter, Inline-Fehler und klarer Lock-Meldung nach Worker-Neustart. KDF-Details bleiben abrufbar. OJ: `oj-status`, `oj-dialog`, `oj-field`, `oj-helper-error`. Ziel: Der Nutzer muss nicht erst selbst den Workspace wechseln und seine ursprüngliche Aufgabe rekonstruieren. Grundlage: [vault UI](src/ui/app.js#L255), [disable prerequisite](src/worker.js#L80).

32. **„Save current scope as profile“ speichert versteckt gefilterte Ergebnisse — Hoch.** Der Button übergibt `filtered()`. Ein vorheriger Cookie-Filter kann dadurch ein Profil verkleinern, obwohl die Beschriftung den ganzen Scope verspricht.

    Verbesserung: Vor Save eine ausdrückliche Quelle `All 37 site cookies / 4 filtered / 2 selected` anbieten. Anzahl, Site und Quelle im Profil-Dialog sichtbar halten. Eine reine Scope-Sicherung darf keine verborgenen Suchfilter übernehmen. OJ: `oj-segmented`, `oj-key-value`, `oj-badge`. Ziel: Profilname und sichtbarer Erstellungsumfang entsprechen dem gespeicherten Zustand. Grundlage: [profile creation button](src/ui/app.js#L289).

33. **Zwei Profile-Apply-Wege haben unterschiedliche Standardwirkungen — Hoch.** `Preview / Apply` beginnt mit Merge; `Apply this QA state` führt Replace aus. Gleichzeitig dürfen Profile geschützte Cookies verändern, während Cleanup und Import diese grundsätzlich erhalten. Die Ausnahme steht hauptsächlich im Fließtext.

    Verbesserung: Einen primären Apply-Weg mit klar benanntem Modus. In der Preview geschützte Änderungen separat aufführen: `3 protected cookies will change`. Schnellwechsel erst nach bewusst gewählter Strategie; risikoreiche Ausnahme entsprechend bestätigen. OJ: `oj-segmented`, `oj-alert`, `oj-badge`, `confirmDialog`. Ziel: Ähnlich beschriftete Buttons lösen keine überraschend unterschiedliche Entfernung aus. Grundlage: [profile cards](src/ui/app.js#L265), [apply dialog](src/ui/app.js#L304).

34. **Profilkarten sind zu groß, und „Edit“ bearbeitet nur Metadaten — Mittel.** Jede Karte enthält zahlreiche Aktionen, Zeitstempel, Warnungen und eine Vorschau. Alle sichtbaren Profile erhalten bereits beim Laden/Suchen eine Apply-Preview. Der gespeicherte Cookiezustand ist über Edit nicht aktualisierbar.

    Verbesserung: Kompakte Liste mit Name, Site, Cookiezahl und letzter Änderung; Details/Preview für ein gewähltes Profil. Edit/Duplicate/Export/Delete in ein Menü. `Edit details` und `Update from current cookies` klar trennen, letzteres mit Vergleich. OJ: `oj-list-interactive` oder `oj-table`, `oj-tag`, `oj-dropdown`, `oj-spinner`. Ziel: Viele Profile bleiben überschaubar und ein bestehender QA-Zustand lässt sich nachvollziehbar aktualisieren. Das Lastproblem ist eine Codeableitung, kein hier gemessener Benchmark. Grundlage: [profile list](src/ui/app.js#L265), [metadata save](src/ui/app.js#L301).

35. **„Undo“ verspricht mehr als eine Merge-Wiederherstellung — Hoch.** Snapshot-Restore läuft als Merge. Gespeicherte Cookies werden wieder gesetzt, zwischenzeitlich neu hinzugekommene Cookies aber nicht zwingend entfernt. Ein vollständiger alter Zustand entsteht dadurch nicht immer.

    Verbesserung: Entweder ehrlich `Restore saved cookies` benennen oder einen eigenen `Restore previous site state`-Ablauf mit Diff und Scope-Preview anbieten. Teilweises Zurücksetzen und vollständiges Zustands-Restore unterscheiden. OJ: `oj-segmented`, `oj-table`, `oj-key-value`, `confirmDialog`. Ziel: Der Nutzer kennt vor Restore exakt Adds, Overwrites und Removals. Grundlage: [Undo labels](src/ui/app.js#L291), [merge restore](src/worker.js#L109).

36. **Enable und Wiederherstellung sind schlecht auffindbar und ihr Zustand bleibt unklar — Mittel.** Ein deaktiviertes Cookie verschwindet aus Cookies und wird unten in Profiles als Snapshot sichtbar. Nach Enable bleibt der Eintrag erneut aktivierbar; der reguläre Cookie-State wird in diesem Ablauf nicht explizit aktualisiert. Snapshot-Löschung erfolgt unmittelbar.

    Verbesserung: In Cookies einen Bereich/Filter `Disabled`, dort Enable. Nach Delete ein direkt erreichbares Restore-Angebot. Automatic backups und disabled cookies als unterschiedliche Typen verwalten; nach Restore frischen Zustand und `Restored just now` anzeigen. Unwiederbringliches Löschen bestätigen oder echtes Undo ermöglichen. OJ: `oj-tabs`, `oj-list-interactive`, `oj-badge`, `oj-alert`, `confirmDialog`. Ziel: Enable ist ohne Kenntnis des Snapshot-Speichermodells auffindbar. Grundlage: [snapshot list/actions](src/ui/app.js#L291).

37. **Schutzregeln werden als technisches Datenmodell dargestellt — Mittel.** Domain-/Name-/Path-Patterns, Store und Partition-JSON verlangen Wissen über die interne Matching-Logik. Eine Vorschau passender Cookies fehlt. Entfernen verändert den Schutz sofort; ein Toggle ist nur über Edit erreichbar.

    Verbesserung: Basis Site + Cookie name + Include subdomains; Advanced für Path/Store/Partition. Partition als überprüfte Eingabe statt rohem JSON. Vor Save `Matches 3 current cookies`; bei vorhandener Regel betroffene Cookies anzeigen. Enabled direkt schalten und nach Remove eine klare Wirkung mit Undo anbieten. OJ: `oj-accordion`, `oj-select`, `oj-switch`, `oj-badge`, `oj-key-value`. Ziel: Breite Schutzregeln lassen sich ohne Trial-and-error verstehen. Grundlage: [rules](src/ui/app.js#L216).

38. **Debug-Aufzeichnungs-Scope und Anzeige-Scope sind verschieden — Hoch.** Die Oberfläche zeigt den aktuellen Scope, die Recording-Konfiguration enthält aber nur enabled/count/age. Der Worker zeichnet alle zugänglichen Events des aktuellen Browserkontexts auf; erst die Timeline wird auf den UI-Scope gefiltert.

    Verbesserung: Vor Start einen ausdrücklich benannten `Recording scope` auswählen und tatsächlich bei der Erfassung anwenden. Alternativ unübersehbar `Recording all granted sites` anzeigen. Anzeigefilter separat benennen. OJ: `oj-select`, `oj-status`, `oj-badge`, `oj-alert`. Ziel: Bei ausgewähltem chatgpt.com kann niemand versehentlich annehmen, dass ausschließlich diese Site beobachtet wird. Grundlage: [recording policy](src/services/history.js), [event forwarding](src/worker.js#L163), [timeline filter](src/ui/app.js#L322).

39. **Der Debugger zeigt Einstellungen vor den eigentlichen Ereignissen — Mittel.** Retention, technische Erklärungen und Snapshot-Formulare stehen vor der Timeline. Recording ON erweckt eine Live-Erwartung, die sichtbare Liste wird jedoch über Refresh aktualisiert.

    Verbesserung: Oben Record/Stop, Aufzeichnungs-Scope und Live-Status; unmittelbar darunter Ereignisse als kompakte Zeilen mit Zeit, Cookie, Änderung und Cause. Neue Events inkrementell ergänzen; `Pause view` getrennt von `Stop recording`. Aufbewahrung in Recording settings, Vergleich in eigenen Tab. OJ: `oj-toolbar`, `oj-status`, `oj-table`, `oj-badge`, `oj-tabs`, `oj-accordion`. Ziel: Der Nutzer erkennt sofort, was gerade beobachtet wird und ob die Anzeige live ist. Grundlage: [debugView](src/ui/app.js#L314).

40. **Snapshot-Vergleich wird ohne ausreichende Voraussetzungen angeboten — Mittel.** Compare ist auch ohne zwei unterschiedliche geeignete Snapshots aktiv. Der manuelle Vorher-/Nachher-Ablauf und das Verschwinden flüchtiger Snapshots nach einem Worker-Neustart verlangen viel Vorwissen.

    Verbesserung: Geführter Ablauf `Capture before → Perform action/reload → Capture after → Compare`. Compare erst mit zwei unterschiedlichen kompatiblen Snapshots aktivieren. Site, Zeitpunkt, Cookiezahl und flüchtige Lebensdauer deutlich anzeigen. OJ: `oj-empty-state`, `oj-select`, `oj-key-value`, Buttons mit echten Zuständen. Ziel: Es gibt keinen vermeidbaren Fehler erst nach Klick auf Compare. Grundlage: [capture/compare](src/ui/app.js#L318).

41. **Settings verbindet Routineverwaltung und destruktive Funktionen ohne klare Gewichtung — Mittel.** Lange Support-/Privacy-Texte, rohe Permission-Originlisten, Job-JSON und vier rote Datenlöschaktionen stehen auf derselben Ebene.

    Verbesserung: Bereiche `Site access`, `Security & vault`, `Activity/recovery`, `Data & privacy`, `About`. Datenlöschung in eine klar abgegrenzte Gefahrensektion; vor Bestätigung konkrete Auswirkungen und Profil-/Backup-Anzahlen zeigen. Zugriff als Site-Liste statt API-Pattern präsentieren, das Pattern auf Abruf. OJ: `oj-sidebar-nav` oder Tabs, `oj-accordion`, `oj-alert`, `oj-table`, `oj-status`. Ziel: Alltagsverwaltung wirkt nicht wie eine Sammlung von Reset-Buttons. Grundlage: [settingsView](src/ui/app.js#L325).

42. **Fortschritt, Recovery und Erfolg sind zu technisch oder zu wenig sichtbar — Hoch.** Buttons werden deaktiviert, behalten aber weitgehend ihre Beschriftung. Jobs zeigen technische Typen und `completed`, obwohl ein zurückgegebener Report einzelne Cookiefehler enthalten kann. Rückmeldungen gehen durch vollständiges Neurendern leicht aus dem unmittelbaren Arbeitskontext verloren.

    Verbesserung: `Importing…`, `aria-busy`, bei echten Zählern `24 of 87 verified`; sonst ehrlicher Spinner. Ergebnis `Finished with 3 errors` statt bloß completed. Unterbrochene Aktion mit Site, Zeit und nächstem Schritt darstellen. Nur unkritische Resultatzähler persistieren, keine Values. OJ: `oj-button-loading`, `oj-spinner`, `oj-progress`, `oj-status`, `oj-table`, `oj-accordion`. Ziel: Akzeptiert, noch laufend, teilweise fehlgeschlagen und vollständig erfolgreich sind unterscheidbar. Grundlage: [button wrapper](src/ui/app.js#L29), [journal completion](src/worker.js#L147), [settings jobs](src/ui/app.js#L328).

43. **Popup, Sidepanel und Manager brauchen unterschiedliche Darstellungen — Mittel.** Die aktuelle Popup-/Manager-Architektur teilt nahezu dieselbe Oberfläche. Ein Wechsel ins Sidepanel allein löst die Informationsdichte nicht; breite Tabellen passen auch dort schlecht.

    Verbesserung: Sidepanel als Begleiter der aktuellen Site mit Suche, kompakter Liste, Details und schnellen Aktionen. Manager-Tab für globale Suche, konfigurierbare Tabelle, große Imports und Profilvergleiche. Toolbar öffnet das Sidepanel; ein gut sichtbarer Link öffnet den passenden Manager-Kontext. OJ: `oj-list-interactive`, `oj-panel`, `oj-key-value`, kompakte Navigation; im Manager `oj-table` und `oj-sidebar-nav`. Ziel: Jede Oberfläche nutzt ihre verfügbare Fläche, und Scope/Auswahl werden beim Übergang nachvollziehbar übergeben. Sidepanel-Umstellung ist hier eine Empfehlung, nicht bereits implementiert.

Die vorhandenen OJ-Bausteine lassen sich dafür so einsetzen:

| Aufgabe | Verifizierte OJ-Basis | Zusätzliche Cookiebase-Verantwortung |
| --- | --- | --- |
| Manager-Navigation | `oj-sidebar-nav`, `oj-nav` | Routing, Erhalt des Arbeitszustands |
| Kontext und Zustand | `oj-section-header`, `oj-status`, `oj-badge`, `oj-key-value` | Eindeutiges Site-/Scope-/Store-Modell |
| Suche, Filter, Auswahl | `oj-toolbar`, `oj-input`, `oj-select`, `createMultiselect`, `oj-tag` | Filterzustand, Entfernen-Buttons, präzise Mengen |
| Tabelle | `oj-table`, `oj-table-sticky`, `oj-table-sort` | Datenhaltung, Gruppierung, Sortierung, Spaltenwahl |
| Details | `oj-panel`, `oj-key-value`, `oj-split`, `oj-list-interactive` | Auswahl und Layout; kein erfundener Drawer-Controller |
| Nebenaktionen | `oj-dropdown`, `oj-menu`, `oj-icon-button` | Zustandsabhängige Aktionslogik |
| Progressive Offenlegung | `oj-accordion`, `oj-accordion-body`, `oj-tabs` | Sinnvolle Zusammenfassung und Workflow-Steuerung |
| Fehler/Leerzustände | `oj-helper-error`, `oj-inline-message`, `oj-alert`, `oj-empty-state` | Konkrete Ursache und passende nächste Aktion |
| Fortschritt/Ergebnisse | `oj-spinner`, `oj-skeleton`, `oj-progress`, `oj-metric` | Echte Fortschrittsdaten und fachliche Erfolgskriterien |
| Bestätigung/Feedback | `oj-dialog`, `confirmDialog`, `toast` | Risikogerechte Bestätigung und erreichbare Wiederherstellung |

Kein dokumentierter generischer `oj-drawer` oder fertiger interaktiver Import-Stepper wurde verifiziert. `oj-steps` ist eine inhaltliche Schrittfolge; Tabellen- und Tag-Komponenten liefern ebenfalls nicht automatisch die Business-Logik. Der Aufbau bleibt eine Cookiebase-Komposition aus OJ-Bausteinen. Farben, Typografie und Icons sollten weiter den vorhandenen OJ-Tokens folgen.

Als Zielaufbau für den Manager empfiehlt sich eine stabile Navigation links, daneben ein kompakter Site-/Scope-Kopf, Suche und Filter, dann die Ergebnistabelle. Eine Detailfläche ist für die gewählte Zeile verfügbar. Eine Auswahlleiste erscheint nur bei Auswahl. Berechtigungsaufforderung, Unlock und Warnungen erscheinen am jeweiligen Entscheidungspunkt. In einer schmaleren Managerbreite wechseln Details in eine eigene Ansicht. Das Sidepanel verwendet dieselben Daten/Regeln, erhält jedoch eine Listendarstellung.

Die sinnvolle Umsetzungsreihenfolge beginnt mit den Wirkungswidersprüchen: Scope-Sperren, Tab-Bindung, Export-/Profilumfang, Recording-Scope, Restore-Semantik, Apply-Modi, Import-Ziel und Dialogfehler. Danach folgen kompakter Kontext, Tabelle/Details, Filter- und Auswahlleiste. Anschließend werden Import, Profiles und Debug als zusammenhängende Abläufe überarbeitet. Sprachlicher und visueller Feinschliff kommt auf diese stabile Bedienlogik.

Für die Abnahme eines UX-Umbaus reichen bestehende API-/Accessibility-Checks allein nicht. Zusätzlich sollten realistische Aufgaben geprüft werden: Consent-Cookie schützen und Site bereinigen; Auswahl über Filter/Seiten hinweg exportieren; nach Cookie-Suche ein vollständiges Profil speichern; nur eine Site debuggen; aus einer gesperrten Aktion entsperren und fortsetzen; einen expliziten Import auf einer anderen Zielsite durchführen; Restore-Auswirkung vor Ausführung erkennen; nach Scope-Wechsel weiterhin Debug stoppen können. Native Oberflächen brauchen Tests mit ihrer tatsächlichen Größe. Diese Analyse hat keine neuen Tests ausgeführt und bewertet keine gemessene Verbesserung eines noch nicht umgesetzten Entwurfs.
