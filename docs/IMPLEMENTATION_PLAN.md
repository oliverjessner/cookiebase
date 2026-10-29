# Cookiebase implementation record

## Baseline — 29 October 2026

Repository `/Users/oli/github/oj/cookiebase`, branch `main`, HEAD `a84d6ce`.
Only the one-line README was tracked. The user-supplied masterprompt was untracked and is preserved verbatim. No working implementation, manifest, scripts, tests or licence existed. Current instruction explicitly authorizes tests, builds and local commits; no push or publication is authorized.

## Architecture

Current architecture after the UX follow-up: Vanilla ESM UI shared between a native side panel and a full manager tab. `oj-designsystem@0.2.1` is the sole shared UI basis, pinned in the lockfile. esbuild packages CSS/JS/WOFF2 locally. No UI framework or remote code. Chrome 132+ MV3, `cookies`, `storage`, `activeTab`, `sidePanel`; optional HTTP(S) hosts requested directly by user gesture. Manager does not depend on an open target site. The original eight phases initially shipped a compact toolbar popup; the later native-panel change is recorded below.

- `src/core`: PSL-backed scope/identity, permission service, verified Chrome cookie adapter and protection rules.
- `src/services`: parsers/exporters and verified import plans; AES-GCM/PBKDF2 vault; encrypted profiles/backups; redacted event history/diffs.
- `src/storage.js`: versioned IndexedDB key/value storage and metadata; quota errors propagate.
- `src/worker.js`: top-level listeners, serialized mutations, concurrent read-only status/progress, persistent value-free operation journal; interruption is reported, never presumed successful. Keys exist in worker memory only.
- `src/ui`: safe DOM components and dialogs; explicit scope/selection model; separate editor, transfer, profile, vault and rules/debug/settings modules; masked secrets, OJ controls, table/inspector in Manager and compact list/details in the side panel.

## Eight phases

This table preserves the original phase-level results. The subsequent 43-point UX implementation and its latest complete verification are recorded in the addendum below.

| Phase | Work / verification | State |
| --- | --- | --- |
| 1 Audit & Plan | Full prompt read, baseline, architecture and requirement matrix; `npm run check:plan` | Verified: plan check passed |
| 2 Core & UI | MV3, OJ assets, PSL scopes, stores, permissions, paginated inspection; unit tests/build | Verified: 40 unit tests, lint/build, real core Chromium 4/4; service foundations integrated early |
| 3 Control & Editing | Verified CRUD, rules, delete preview, encrypted Undo/Disable; unit/integration tests | Verified: 17 core tests + 6 real Chromium cases; exact deletion, advanced editor, protection, disable/restore |
| 4 Import & Export | JSON/Netscape parser, previews and reports, copy/download, fixtures roundtrip | Verified: 14 parser/protection tests + 3 real Chromium transfer cases; clipboard/file/redirect roundtrip |
| 5 Session Profiles | Vault encryption, CRUD, apply/verify/rollback, persistence and failure tests | Verified: encrypted CRUD/apply/rollback unit tests and 3 real Chromium profile/debug cases incl full browser restart |
| 6 Debugger | Redacted event timeline, correlation, snapshots/diffs, retention, observed diagnoses | Verified: observed events, overwrite correlation, retention and snapshot diffs in unit/real Chromium tests; bounded worker queue |
| 7 Reliability & Security | Worker interruption, isolation, CSP/assets, accessibility and performance checks | Verified: 47 unit + 20 real Chromium tests, actual private-store isolation, interrupted import, axe and 2,500-cookie performance |
| 8 Verification & Release Readiness | Full lint/unit/build/real Chromium E2E, docs, evidence, release artifact | Verified: full commands pass, evidence reviewed, docs complete, local ZIP and checksum verified; native prompt manual boundary documented |

Each completed phase receives a local commit after relevant verification. Integration defects are corrected in later verified commits. No implementation is counted verified from mocks alone.

## Acceptance strategy

Unit tests use Node's test runner. Chrome adapter tests exercise errors and exact verification; parser tests cover realistic fixtures, identity/PSL, encryption, isolation and history correlation. Persistent-context Playwright Chromium loads the actual MV3 build. A local HTTP/HTTPS fixture server sets real cookies, including redirects and subdomains. E2E checks native side-panel/manager assets, host grants where automation permits, cookie control/import/export/profiles/history, worker restart, safe data persistence and accessibility. The native panel test opens Chrome's actual panel target without prescribing a page viewport and verifies responsive rows plus scope/selection handoff. Performance uses thousands of synthetic records for pure search/render timing plus real browser APIs for representative cookie operations; measurements are recorded separately.

Limitations must remain visible in UI and final docs: inaccessible hosts/stores, unknown CHIPS partitions, browser policy, rejected writes, invalidated sessions, no other-browser access, incognito opt-in, and no observable network rejection reason without a network integration. Native optional-host acceptance/denial is reported honestly and has manual acceptance steps. Incognito enablement and separate stores were subsequently verified through actual browser UI.

## Integration note

The worker/UI service contracts were integrated together during Phase 2 so the committed MV3 build is self-contained. Later phases separately verify and harden control, transfer, profiles and debugger with their dedicated browser acceptance suites. Phase 2 found a real Chrome same-name/path deletion hazard; exact-identity expiration plus sibling verification resolves it and the real-browser regression passes.

## Phase 7 evidence

Original Phase 7 integrated run: lint, 47/47 unit tests, build and 20/20 real MV3 Chromium E2E cases passed. A real in-flight import was interrupted by forcibly stopping the worker: no success reply, durable interrupted status, and no automatic replay. The incognito case enables browser Developer mode and Allow in incognito using normal Chrome UI, then verifies actual separate stores and refused cross-store writes. Axe serious/critical checks covered all six workspaces and popup in that version. Real 2,500-cookie load 136.1 ms/search 195.3 ms in that historical run, 50 cookie rows plus one group row, maximum frame gap 16.7 ms. The latest side-panel run is recorded in the UX addendum and [TEST_REPORT.md](TEST_REPORT.md). Native optional-host permission accept/deny still requires manual browser confirmation, precisely separated from real-cookie tests with fixture grants.

## Release readiness and remaining boundaries

The complete mandatory documentation, native JSON/Netscape format contract and permanent genuine screenshot/measurement evidence are present. Local release commands: `npm run package`, `unzip -t artifacts/cookiebase-0.1.0.zip`, `npm run lint`, `npm run check:plan`, `git diff --check`. No push, publication, release tag, Web Store upload or external repository change occurred.

Remaining boundaries are explicit in the requirement matrix and test report: new native host-permission acceptance/denial is manual and not yet performed; Chrome132/current stable/Edge/Brave/enterprise matrices are not executed; hidden partition/store access is browser-limited; server sessions cannot be revived; Undo/apply is best effort; debug snapshots/drop counters and all incognito extension data are memory-only; optional network/HAR integration is not implemented. Renaming/changing a cookie identity uses explicit Create then Delete rather than a silent move. Cookiebase has no owner-selected project licence yet. None of these is represented as an automated green check.

## Phase commits

1. `a53fe8f` — audit and traceability plan.
2. `2f91836` — self-contained MV3/OJ UI and module foundations.
3. `1c44b34` — verified advanced control/protected cleanup.
4. `a757722` — hardened imports and deliberate secret exports.
5. `77464cf` — encrypted reusable QA profile workflows.
6. `5f01d2f` — bounded debugger and profile scope safeguards.
7. `82db400` — lifecycle, incognito, responsive UI and regression evidence.
8. `f3ec75b` — documentation, evidence, packaging and final verification.

## UX follow-up — 43 findings implemented and verified

The user requested implementation of [analyse.md](../analyse.md). All 43 points are now implemented; [UX_IMPLEMENTATION.md](UX_IMPLEMENTATION.md) maps each point to production code, browser/unit evidence and remaining browser boundaries.

- Native side panel replaces the toolbar popup. Manager retains the wider table/inspector, and one-use session handoff preserves scope, filters and selected identities without cookie values. Follow/pin modes and reload revalidate browser window, site and privacy context.
- Compact context, on-demand scope/access editing, explicit selection/source counts, visible filter chips, four default columns, independent grouping/sorting and specific empty states keep cookie work prominent.
- Readonly inspection precedes Edit/Duplicate. Import and Export have separate flows; destination, confirmed remapping, three strategies, backup prerequisites, export purpose and secret consent are explicit. Stale previews cannot be applied.
- Profile save uses explicit sources. One Merge-default preview/apply flow guards protected changes. Complete snapshots alone can restore previous site state; saved-cookie restore is explicitly Merge. Vault prerequisites preserve the active workflow, and busy controls prevent repeated mutations.
- Rules expose structured advanced options and match counts. Debug records its explicit scope before persistence, separates recording from paused viewing, updates the live timeline and guides before/after comparison. Settings separates access, vault, activity, privacy and About.
- Value-free progress is visible globally and in active dialogs; partial errors and interruptions remain distinct. Shared dialog focus, keyboard handling, OJ tab IDs and nullable DOM children were corrected during actual-browser validation.

The latest complete integrated run on 29 October 2026 passed `npm run lint`, `npm test` (**63/63**), `npm run build` and `npm run test:e2e` (**37/37 real MV3 Chromium cases**, zero skipped, unexpected or flaky). It includes native panel layout/handoff, all five manager workspaces, actual cookie/import/export/profile/debug operations, dialog accessibility, incognito isolation, full browser restart, interrupted writes and the 2,500-cookie performance case. See [TEST_REPORT.md](TEST_REPORT.md) for current measurements, screenshots and manual boundaries. Test fixtures use real Chrome cookie APIs; no private user account data is used.

Implementation commits:

1. `3f706f0` — explicit recording/import/profile scopes, protection and accurate restore semantics.
2. `d5f4c3e` — focused modular OJ workspaces, native side panel and UX/browser regressions.

The original eight-phase record remains historical evidence; these 63/37 results supersede its earlier 47/20 totals as the current verification status. Native new-host prompt acceptance/denial and untested browser/version/policy matrices remain manual boundaries, not incomplete implementations or automated passes. No push or publication is authorized by this follow-up.

Final local delivery checks passed: `npm run package`, ZIP integrity, SHA-256 verification, final lint/asset audit, plan traceability, all 287 relative documentation links and `git diff --check`. The unpacked `dist/` and `artifacts/cookiebase-0.1.0.zip` are ready locally. Final native-panel/manager screenshots were opened and reviewed; current performance/recovery JSON is preserved under `docs/evidence/ux-*`. The original input analyses are preserved alongside the implementation matrix. Existing installed extensions still require Reload in Chrome to adopt the changed manifest.
