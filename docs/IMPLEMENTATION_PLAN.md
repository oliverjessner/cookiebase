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
| 4 Import & Export | JSON/Netscape parser, previews and reports, copy/download, fixtures roundtrip | Pending |
| 5 Session Profiles | Vault encryption, CRUD, apply/verify/rollback, persistence and failure tests | Pending |
| 6 Debugger | Redacted event timeline, correlation, snapshots/diffs, retention, observed diagnoses | Pending |
| 7 Reliability & Security | Worker interruption, isolation, CSP/assets, accessibility and performance checks | Pending |
| 8 Verification & Release Readiness | Full lint/unit/build/real Chromium E2E, docs, evidence, release artifact | Pending |

Each completed phase receives a local commit after relevant verification. Integration defects are corrected in later verified commits. No implementation is counted verified from mocks alone.

## Acceptance strategy

Unit tests use Node's test runner. Chrome adapter tests exercise errors and exact verification; parser tests cover realistic fixtures, identity/PSL, encryption, isolation and history correlation. Persistent-context Playwright Chromium loads the actual MV3 build. A local HTTP/HTTPS fixture server sets real cookies, including redirects and subdomains. E2E checks popup/manager assets, host grants where automation permits, cookie control/import/export/profiles/history, worker restart, safe data persistence and accessibility. Performance uses thousands of synthetic records for pure search/render timing plus real browser APIs for representative cookie operations; measurements are recorded separately.

Limitations must remain visible in UI and final docs: inaccessible hosts/stores, unknown CHIPS partitions, browser policy, rejected writes, invalidated sessions, no other-browser access, incognito opt-in, and no observable network rejection reason without a network integration. Unautomatable permission dialogs and incognito enablement are reported honestly and have manual acceptance steps.

## Integration note

The worker/UI service contracts were integrated together during Phase 2 so the committed MV3 build is self-contained. Later phases separately verify and harden control, transfer, profiles and debugger with their dedicated browser acceptance suites. Phase 2 found a real Chrome same-name/path deletion hazard; exact-identity expiration plus sibling verification resolves it and the real-browser regression passes.
