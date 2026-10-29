# Privacy

Cookiebase processes cookies locally inside the current Chrome browser profile. It has no account system, server, telemetry, analytics, advertising, sponsor panel, external beacon, remote font or remote script. It does not change the search engine, homepage or browser startup settings. The runtime does not send cookie data to a third party.

## Data used and retained

| Data | Purpose | Where it stays |
| --- | --- | --- |
| Accessible live browser cookies | Inspect, edit, delete, import/export and apply a user-selected state | Chrome's cookie store; transient extension/UI memory. Host permissions and cookie-store context limit access. |
| Protection rules and onboarding choice | Preserve selected cookies and remember the introductory warning acknowledgement | Regular extension `chrome.storage.local`. Rules can contain domains, cookie names, paths and store/partition restrictions. |
| Profiles and restore snapshots | Save named QA/session states, Undo and Disable/Enable | Local IndexedDB as an authenticated encrypted vault. Cookie values and profile metadata are encrypted with the user's passphrase-derived key. |
| Optional Debug history | Show observed cookie changes and their attributes | Local redacted IndexedDB history when enabled; no persisted values or value fingerprints. Default OFF. |
| Debug snapshots/value comparisons | Compare added, removed and changed state | Worker memory only, discarded on worker restart. They cannot restore cookies. |
| Recovery journal | Distinguish completed, failed and interrupted operations | Up to 30 local command IDs/types/states/timestamps and generic recovery messages; no cookie payload or passphrase. |
| Explicit clipboard/download export | Transfer the selected cookie scope outside Cookiebase | The system clipboard or a user-requested browser download. These copies are plaintext and are not managed or deleted by the vault. |

Cookiebase reads no website LocalStorage, IndexedDB, password manager or other Chrome/browser profile database as part of a cookie profile. Browser-to-browser transfer is an explicit file exchange. It never directly reads cookies from another Chrome profile.

## Choices and retention

Host access starts optional. Grant only sites you need, or deliberately choose all-sites access for the broadest available global view. Settings shows granted origins and permits revocation. Missing permission is reported as limited coverage rather than an invented empty global cookie state.

Debug recording is OFF until started. Default retention is 1,000 events and 24 hours; the controls allow 1–10,000 events and 1–168 hours. Views exclude expired events. Physical trimming occurs when Cookiebase initializes, changes history configuration or records new events, rather than through a deletion clock while the browser is unused. Clear History removes saved events and in-memory snapshots. Pending event ingestion is bounded; overload is reported as dropped observations.

Profiles and restore snapshots stay until deleted or until their documented vault limits remove the oldest restore snapshots. The vault supports 200 profiles, the latest 50 restore snapshots and a 25 MiB plaintext safety limit. It locks on explicit Lock and loss of worker memory. The passphrase is never stored and cannot be recovered.

## Incognito

Chrome must explicitly enable **Allow in incognito**. Cookiebase uses a split extension context and separately established cookie stores. Incognito rules, job information, configuration and history are memory-only. Persistent profiles, encrypted Undo snapshots and vault initialization are disabled in incognito. Closing/restarting the worker can lose that temporary state. Cross-store application is refused; a regular workspace does not silently read/write the incognito store.

Explicit downloads and clipboard copies can still persist outside incognito. Chrome's incognito mode does not protect an exported credential from other applications, recipients or file backups.

## Deleting data

Settings provides separate deletion actions for Rules, History, Vault and all Cookiebase data. Clearing the vault permanently removes encrypted profiles and Undo/disabled-cookie snapshots unless you intentionally kept an external export. App-data deletion does not delete Chrome cookies: browser cookie removal requires the separate Cookies deletion workflow and its displayed scope.

Downloaded exports and clipboard history remain under browser/operating-system control. Delete them separately if no longer needed. Cookiebase does not promise forensic erasure of browser storage or disk backups. Review [SECURITY.md](SECURITY.md) before revealing, copying or exporting sessions.

## Source and third-party assets

The implementation is inspectable in this repository. At this initial implementation, **no Cookiebase project `LICENSE` file has been supplied**, so the project does not assert an OSI-approved licence or an unrestricted redistribution grant. OJ Designsystem and its bundled fonts/icons retain their own licences and notices in the generated build's `licenses/` directory. Those notices do not determine the licence of Cookiebase's original code.

Development installation and browser-test tooling may download npm dependencies or Playwright browsers. Those build-time operations are separate from the installed extension's local runtime. Current execution evidence and remaining verification limits are recorded in [TEST_REPORT.md](TEST_REPORT.md).
