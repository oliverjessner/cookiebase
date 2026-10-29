# Security

Cookie values frequently act as login credentials. Cookiebase can read and change cookies only after the relevant host permission, but that access can include HttpOnly session cookies. Do not grant access or import/export sessions unless you intend to handle those credentials.

## Threat model and controls

| Threat | Implemented control | Remaining boundary |
| --- | --- | --- |
| A cookie value enables session takeover | Values masked in tables and password fields; explicit reveal/copy actions; secret-export warning and confirmation; redacted exports available | An explicit reveal, clipboard write or plaintext file intentionally exposes values outside the vault. Server-side session controls determine whether a stolen value is usable. |
| Extension storage copied while the vault is locked | Profiles and restore snapshots, including sensitive profile metadata, use authenticated AES-GCM encryption and a passphrase-derived key | Offline passphrase guessing remains possible. A weak passphrase, compromised browser/OS, unlocked worker or plaintext export bypasses this protection. Chrome's own live cookie store is not encrypted by Cookiebase's vault. |
| Malicious import or cookie text injects HTML/code | Safe DOM creation/text nodes; explicit schema parsing, size limits and cookie validation; no production `innerHTML`, remote script, `eval` or dynamic-code workaround | Imported session credentials are still powerful data. Their source and intended account must be trusted. Input validation is not a claim of independent security certification. |
| Cleanup removes a login or consent state | Allowlist protection by default, visible scopes, deletion preview, preserve-subdomain option and optional encrypted Undo | Explicit protection overrides and profile state application can change protected identities after a displayed warning. Browser operations are best effort and may race with websites. |
| Import/Apply reports success for rejected attributes | Exact identity and attribute read-back after writes; per-cookie reports; invalid Replace preflight; stale-removal preview check | Websites, redirects, policies or expiry can change cookies after verification. An observed later change is distinct from the earlier verified write. |
| Incognito state leaks to regular storage or a profile | Split extension context; store/context checks on access; memory-only incognito metadata/history/jobs; persistent incognito profiles/backups disabled | Chrome must explicitly allow incognito extension access. Memory-only incognito state is lost on worker restart. Manual clipboard/download actions are still outside incognito storage protections. |
| Debugging retains credentials or grows without bound | Debug OFF by default; persisted events omit values/fingerprints; bounded count/age; 256-event pending queue and dropped-event reporting; memory-only comparison snapshots | Names, domains, paths and attributes can reveal browsing activity. Queue overflow or worker termination can lose observations. Event metadata does not reveal a server's internal authentication decisions. |
| A page submits privileged commands | No content script or externally connectable endpoint; runtime sender restricted to this extension's own pages; optional host permissions | The extension's own unlocked UI and worker remain privileged. A compromised extension build or browser is outside this boundary. |

## Vault format and key handling

The version 1 vault derives a non-exportable AES-256-GCM key with Web Crypto **PBKDF2-SHA-256, 600,000 iterations and a fresh 16-byte random salt per vault**. Each write uses a fresh **12-byte random IV**, a **128-bit authentication tag** and version-bound additional authenticated data `cookiebase:vault:1`. Salt, KDF settings, IV and ciphertext are persisted; the passphrase and derived key are not.

All profile names, descriptions, tags, scopes, timestamps, cookie values and restore snapshots are contained inside the authenticated ciphertext. Wrong passphrases and damaged ciphertext produce the same safe unlock failure. Unsupported formats/KDF settings are refused. A failed storage write leaves the previous successfully stored vault intact; no success is shown for a failed persistence operation.

Passphrases must have at least 12 characters. Use a strong unique passphrase: there is no account, recovery service or password reset. The implementation has no passphrase-change workflow. Keep any intentional external backup private and account for its plaintext contents.

An unlocked vault exists in worker memory and is available to this extension's UI. Explicit Lock clears its references; worker/browser restart loses the key and requires Unlock again. There is no separate inactivity timeout, guaranteed memory zeroization, or protection against a compromised operating system, browser, devtools session or unlocked extension context.

## Plaintext and local metadata

Live cookie data must pass through extension memory to inspect, edit or apply it. Pending commands and the bounded event queue may temporarily contain values. Durable extension-owned cookie values belong only in the encrypted vault. Cookiebase does not use `chrome.storage.sync`, telemetry, application value logs or persisted debug value hashes.

Rules, redacted history and operation timestamps are local plaintext metadata. They can reveal sites, cookie names and usage patterns. Debug comparison uses a random, worker-local HMAC key; value fingerprints and comparison snapshots disappear on restart. Persisted overwrite correlation may report an unknown value-change result when the original in-memory fingerprint is unavailable.

Clipboard output and JSON/Netscape/profile files are **unencrypted**. Other software, clipboard history, cloud clipboard synchronization, file backups and people with access to Downloads may read them. The manager differentiates clipboard copy from a requested file download; it cannot guarantee a final filesystem location or erase external copies. Redacted exports omit or replace values and are rejected as restore sources.

## Permissions and browser policy

Required permissions are `cookies`, `storage`, `activeTab` and `sidePanel`. HTTP(S) hosts are optional and requested from a user gesture: exact site, selected domains, a site including subdomains, or all sites. All-sites access is never silently granted. Settings lists granted origins and offers revocation. Permission loss reduces coverage immediately; an empty list is not proof that Chrome contains no cookies.

The build has no content scripts, network inspection permission, `debugger`, `webRequest`, browser-settings overrides or remote backend. Extension-page CSP is `script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'; frame-ancestors 'none'`. Host permission enables cookie operations, not a promise to bypass enterprise policies, restricted browser pages, third-party-cookie rules or hidden partition contexts.

## Safe operations and recovery

Cookie identity includes domain, name, path, store and partition. All destructive UI actions show their scope. The manager checks the removal identity set against the latest preview for import/profile Replace; it requires a new preview when that set changes. Protected cookies survive ordinary cleanup and imports. Profile Apply and full-state restore enumerate protected changes and require an explicit override, enforced by the service. Deliberate profile state changes display their own overwrite warning.

Browser cookie APIs offer no ACID transaction. A mutation can partially succeed before a storage error, policy rejection, server overwrite, side-panel/manager closure or worker termination. Before a regular-context bulk deletion, disable operation, Replace import or profile Apply, the available backup workflow stores a prior encrypted snapshot. Deletion without Undo requires explicit UI acknowledgement when the vault is locked. Disable/Enable means remove/restore from a snapshot, not a native browser Enabled flag. Restore cannot revive a server-invalidated session, expired cookie, revoked permission or unavailable store.

The last 30 operations retain a secret-free recovery journal. In-progress jobs found after restart are marked interrupted and never blindly replayed. The journal does not retain detailed per-cookie reports; reopen the manager and inspect real cookies if the originating UI closed. Partial per-cookie failures produce `completed_with_errors` with numeric counts; a completed handler still does not guarantee that a website will accept the resulting session.

## Deletion and reporting

Settings can clear rules, history, the vault or all Cookiebase-owned data. Browser cookie deletion is a separate explicit workflow. Clearing the vault destroys profiles and encrypted Undo/disabled-cookie snapshots; losing a passphrase has the same practical recovery limit without an external export. Clearing app data does not erase browser cookies, clipboard history or downloaded files, and does not claim forensic disk erasure.

For a security report, use the repository owner's configured private reporting channel if one exists; no dedicated security mailbox is provided by this project. Do not attach real cookies, passphrases, plaintext vault exports or private account details to a public issue. A minimal local-fixture reproduction and value-redacted diagnostics are sufficient for initial investigation.

See [PRIVACY.md](PRIVACY.md), [ARCHITECTURE.md](ARCHITECTURE.md), [BROWSER_SUPPORT.md](BROWSER_SUPPORT.md) and the actual verification record in [TEST_REPORT.md](TEST_REPORT.md).

UX-specific boundaries: the side panel records no headers or network traffic. Its site scope can follow the active permitted website or be pinned; reload validates the actual tab origin and privacy context again. Recording scope is enforced before storing events, separately from the timeline filter. Partial snapshot restore is named as a merge; exact replacement requires a complete backup. Progress/recovery persistence contains counters only. Context handoff uses one-use `storage.session` metadata, not persistent cookie values.
