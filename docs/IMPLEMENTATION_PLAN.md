# Cookiebase implementation record

## Baseline — 29 October 2026

Repository `/Users/oli/github/oj/cookiebase`, branch `main`, HEAD `a84d6ce`.
Only the one-line README was tracked. The user-supplied masterprompt was untracked and is preserved verbatim. No working implementation, manifest, scripts, tests or licence existed. Current instruction explicitly authorizes tests, builds and local commits; no push or publication is authorized.

## Architecture

Vanilla ESM UI shared between a compact popup and a full manager tab. `oj-designsystem@0.2.1` is the published package, pinned in the lockfile. esbuild packages CSS/JS/WOFF2 locally. No UI framework or remote code. Chrome 132+ MV3, `cookies`, `storage`, `activeTab`; optional HTTP(S) hosts requested directly by user gesture. Manager does not depend on an open target site.

- `src/core`: PSL-backed scope/identity, permission service, verified Chrome cookie adapter and protection rules.
- `src/services`: parsers/exporters and verified import plans; AES-GCM/PBKDF2 vault; encrypted profiles/backups; redacted event history/diffs.
- `src/storage.js`: versioned IndexedDB key/value storage and metadata; quota errors propagate.
- `src/worker.js`: top-level listeners, serialized commands, persistent operation journal; interruption is reported, never presumed successful. Keys exist in worker memory only.
- `src/ui`: safe DOM output, masked secrets, explicit scopes, OJ controls, page-sized cookie rendering, keyboard-accessible native dialogs.

## Eight phases

| Phase | Work / verification | State |
| --- | --- | --- |
| 1 Audit & Plan | Full prompt read, baseline, architecture and requirement matrix; `npm run check:plan` | Verified: plan check passed |
| 2 Core & UI | MV3, OJ assets, PSL scopes, stores, permissions, paginated inspection; unit tests/build | Verified: 40 unit tests, lint/build, real core Chromium 4/4; service foundations integrated early |
| 3 Control & Editing | Verified CRUD, rules, delete preview, encrypted Undo/Disable; unit/integration tests | Verified: 17 core tests + 6 real Chromium cases; exact deletion, advanced editor, protection, disable/restore |
| 4 Import & Export | JSON/Netscape parser, previews and reports, copy/download, fixtures roundtrip | Verified: 14 parser/protection tests + 3 real Chromium transfer cases; clipboard/file/redirect roundtrip |
| 5 Session Profiles | Vault encryption, CRUD, apply/verify/rollback, persistence and failure tests | Verified: encrypted CRUD/apply/rollback unit tests and 3 real Chromium profile/debug cases incl full browser restart |
| 6 Debugger | Redacted event timeline, correlation, snapshots/diffs, retention, observed diagnoses | Verified: observed events, overwrite correlation, retention and snapshot diffs in unit/real Chromium tests; bounded worker queue |
| 7 Reliability & Security | Worker interruption, isolation, CSP/assets, accessibility and performance checks | Verified: 47 unit + 20 real Chromium tests, actual private-store isolation, interrupted import, axe and 2,500-cookie performance |
| 8 Verification & Release Readiness | Full lint/unit/build/real Chromium E2E, docs, evidence, release artifact | Pending |

Each completed phase receives a local commit after relevant verification. Integration defects are corrected in later verified commits. No implementation is counted verified from mocks alone.

## Acceptance strategy

Unit tests use Node's test runner. Chrome adapter tests exercise errors and exact verification; parser tests cover realistic fixtures, identity/PSL, encryption, isolation and history correlation. Persistent-context Playwright Chromium loads the actual MV3 build. A local HTTP/HTTPS fixture server sets real cookies, including redirects and subdomains. E2E checks popup/manager assets, host grants where automation permits, cookie control/import/export/profiles/history, worker restart, safe data persistence and accessibility. Performance uses thousands of synthetic records for pure search/render timing plus real browser APIs for representative cookie operations; measurements are recorded separately.

Limitations must remain visible in UI and final docs: inaccessible hosts/stores, unknown CHIPS partitions, browser policy, rejected writes, invalidated sessions, no other-browser access, incognito opt-in, and no observable network rejection reason without a network integration. Unautomatable permission dialogs and incognito enablement are reported honestly and have manual acceptance steps.

## Integration note

The worker/UI service contracts were integrated together during Phase 2 so the committed MV3 build is self-contained. Later phases separately verify and harden control, transfer, profiles and debugger with their dedicated browser acceptance suites. Phase 2 found a real Chrome same-name/path deletion hazard; exact-identity expiration plus sibling verification resolves it and the real-browser regression passes.

## Phase 7 evidence

Final integrated run: lint, 47/47 unit tests, build and 20/20 real MV3 Chromium E2E cases passed. A real in-flight import was interrupted by forcibly stopping the worker: no success reply, durable interrupted status, and no automatic replay. The incognito case enables browser Developer mode and Allow in incognito using normal Chrome UI, then verifies actual separate stores and refused cross-store writes. Axe serious/critical checks cover all six workspaces and popup. Real 2,500-cookie load 149.8 ms/search 201.2 ms in this run, 50 cookie rows plus one group row, maximum frame gap 16.7 ms. Native optional-host permission accept/deny still requires manual browser confirmation, precisely separated from real-cookie tests with fixture grants.
