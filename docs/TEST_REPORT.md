# Verification report — 29 October 2026

## Final integrated result

**47/47 Node unit/integration tests and 20/20 actual MV3 Chromium E2E tests passed.** No skipped or failing test in the final integrated run. Lint, local asset/CSP audit and build passed. The source uses the published/pinned `oj-designsystem@0.2.1`; no other UI framework.

Environment: macOS arm64; Node `26.12.0`, npm `11.20.0`, Playwright `1.64.1`, its standard Chromium revision `1248` / `156.0.8078.4`. Target minimum Chrome 132 is documented, not tested as a second engine. No personal logins, production websites or existing browser profiles were used.

Actual commands executed:

```sh
npm run check:plan
npm install
npm run lint
npm test
npm run build
npm run test:e2e
```

Final unit run: 47 pass, 0 fail, 0 skipped, approximately 0.86 s. Final Chromium run: 20 pass, 0 fail, 0 skipped, approximately 31.1 s. Targeted phase tests were also run during implementation; the final integrated result supersedes intermediate failures. Packaging and archive-integrity checks also passed as recorded below.

## What was tested

- `tests/core.test.js`, `repository.test.js`: PSL/private suffixes, identities across paths/stores/partitions, scopes, wildcard/optional-value search, boolean/date filters, validation, synchronous permission calls, real-adapter reread/error paths and protection matching. Adapter unit fixtures are test doubles, clearly separate from the real-browser suite.
- `tests/transfer.test.js`, `transferProtection.test.js`: Cookie-Editor/native JSON, Netscape, absolute/relative expiration, per-record validation, replace preflight, correct conflicts, protected replacement, incognito refusal, redacted/lossy formats, verified result accounting.
- `tests/vault.test.js`, `profiles.test.js`, `history.test.js`: PBKDF2/AES-GCM/tamper/wrong-passphrase/concurrent writes, encrypted metadata, failed storage, CRUD, A/B apply/verify/rollback, original-scope intersection, expired/stale-preview preflight, correlated and redacted events, retention and HMAC diffs.
- `tests/e2e/core.spec.js` (6): unchanged no-host production build popup/manager and local OJ assets; actual same-name/path protection and deletion; actual Disable/restore and CHIPS/unpartitioned separation; rejected host/store writes; server Set-Cookie on three related/unrelated hosts; all CREATE advanced controls, secret reveal/remask, actual saved attrs, wildcard search and Escape.
- `tests/e2e/transfer.spec.js` (4): actual file picker/drop, previews and per-record errors; clipboard contents and distinct feedback; real downloaded JSON/Netscape roundtrip; controlled OAuth-like redirect, later server overwrite, explicit target independent of active tab; invalid replace preserves unrelated hosts; protected replacement and explicit override.
- `tests/e2e/profiles-debug.spec.js` (3): actual A/B application, backup restore, wrong passphrase, profile CRUD/export/import; raw IDB/storage contains neither secrets nor encrypted profile metadata; actual events/overwrite/diff/retention/stop; actual complete Chromium close/restart with same disk profile, locked vault, unlock and apply.
- `tests/e2e/history-recovery.spec.js` (3): 4,000 actual writes with responsive UI and bounded/redacted history; actual import interrupted after real writes with no success reply/no replay; generic JSON/Netscape profile file UI and direct QA apply.
- `tests/e2e/incognito.spec.js` (1): normal `chrome://extensions` UI toggles Developer mode/Allow in incognito; genuine off-the-record context, separate stores, actual private set/delete, refused cross-store writes, unavailable private vault and unchanged normal cookie.
- `tests/e2e/reliability.spec.js` (3): axe serious/critical checks for all six manager workspaces + popup, keyboard-only dialog trap/Escape/focus return and search; local fonts/resources; actual 2,500-cookie search/render; popup-close accepted operation completes in worker, metadata-only journal and all-own-data reset leaves browser cookies.

## Measured performance and recovery

Final-run measurements (single run, not hardware-independent guarantees):

| Measurement | Result |
| --- | ---: |
| Pure PSL scope/wildcard search/sort, 10,000 records | 37.6 ms |
| Real browser fixture | 2,500 cookies, 25 distinct registrable domains |
| Actual fixture cookie writes | 119.1 ms |
| Manager load/render | 136.1 ms |
| Debounced search through actual UI | 195.3 ms |
| Rendered rows | 50 cookie rows + 1 domain-group row |
| Maximum sampled animation-frame gap | 16.7 ms |
| Event burst | 4,000 writes, 25 domains |
| Concurrent status during burst | 264 ms |
| Burst queue loss disclosure | 4,647 events dropped; browser emits removal/eviction events as well as writes |
| Retained events at burst check | 42, bounded by configured 200 |
| Actual interrupted import | 7 of 100 cookies written before stopping worker |
| Recovered journal state | `interrupted`; no success reply |
| Writes replayed after manager reload | 0 |

The event queue is capped at 256 and independent of UI RPCs. Drops are disclosed for the current worker session; history is not advertised as a complete browser audit log. Chrome cookie quotas evict records in burst tests; that is different from UI data loss. Snapshots and keys disappear on worker restart as designed.

## Evidence

Playwright writes its HTML report to `playwright-report/index.html`, machine result to `test-results/e2e-results.json`, and per-test screenshots/measurements to `test-results/`. Those generated directories are ignored by Git. Selected genuine screenshots and JSON measurements are preserved in [evidence](evidence/): [manager](evidence/manager.png), [popup](evidence/popup.png), [burst](evidence/event-storm-measurements.json), [interruption](evidence/actual-import-interruption.json). Both screenshots were opened and visually inspected; they show actual local first-run/restricted-access UI, not fabricated product data. The narrow popup intentionally scrolls within Chrome's popup height.

## Intermediate failures corrected

1. Real Chromium `cookies.remove` on a same-name/nested-path cookie also removed a protected sibling. Adapter now uses exact-identity expiration whenever siblings exist or global host permission is absent, then verifies target absence and siblings unchanged. `cookies.remove` is reserved for fully covered, unambiguous cases. Regression passes in real Chromium.
2. A 2,500-cookie fixture using subdomains of a single registrable site hit Chrome's per-site quota and left 175 records. The test now uses 25 distinct registrable local fixture domains and confirms all 2,500 are actually present.
3. Incognito toggle reloaded a forced-loaded unpacked extension with Developer mode OFF; the test enables Developer mode through normal browser UI before enabling incognito. Actual private-store test now passes.
4. Early ESLint regex/fixture warnings were fixed. No final lint failure remains.

## Permission testing boundary and manual acceptance

A newly requested extension host-permission prompt is native browser chrome, outside headless Playwright page automation. A real probe confirmed it stays pending. The unchanged production manifest is tested without hosts; cookie-operation contexts add only local fixture hosts in a temporary manifest copy. Their `chrome.cookies`, permission status, request-for-already-granted-host, revoke/error paths and all worker code remain actual browser APIs. This **does not verify accepting/denying a new native prompt**.

Manual, currently unexecuted acceptance steps in ordinary Chrome:

1. Load the unchanged `dist/` unpacked extension, visit a local or controlled HTTP(S) site and open toolbar popup.
2. Choose Grant access to this site, **Cancel** the native prompt; verify a specific denial explanation and usable Retry/Manager.
3. Repeat and **Allow**; refresh and compare the site's cookies with DevTools, taking store/path/partition into account.
4. Grant site including subdomains / selected hosts, then revoke them in Settings and verify reduced coverage.
5. Choose Grant access to all sites, test both Cancel and Allow, then inspect explicit all-access scope and revoke it.

No native prompt acceptance/denial, installed Google Chrome 132/current stable build, Edge, Brave, real enterprise policy or personal OAuth/ADFS account was claimed tested. Chrome Android/Firefox are unsupported. Accessibility testing found no serious/critical axe violations in tested views; this is not full WCAG certification. Crypto uses standard Web Crypto but has no independent security audit.

## Release checks

The release artifact is a locally generated ZIP plus unpacked `dist/`; it is not published. `npm run package` rebuilds and writes the archive and SHA-256. Executed `npm run package`, `unzip -t artifacts/cookiebase-0.1.0.zip`, `npm run lint`, `npm run check:plan` and `git diff --check`: all passed. The archive checksum is stored alongside the ZIP; the final commit sequence is in the implementation record. Dependency notices are included. Cookiebase itself has no declared project licence in the initial repository; choosing one remains an owner decision.
