# Verification report — 29 October 2026

## Latest integrated result: all 43 UX findings

**63/63 Node unit/integration tests and 37/37 actual MV3 Chromium browser tests passed.** The final browser run had zero skipped, unexpected or flaky tests. Lint, local asset/CSP audit and build passed. This supersedes the initial 47/20 result and later two-test popup correction: the toolbar now opens the native side panel.

All 43 findings are mapped to implementation and executable evidence in [UX_IMPLEMENTATION.md](UX_IMPLEMENTATION.md). Shared UI uses pinned, locally bundled `oj-designsystem@0.2.1` only. No production cookie or permission API is mocked.

Environment: macOS arm64; Node `26.12.0`, npm `11.20.0`, Playwright `1.64.1`, standard Chromium revision `1248` / `156.0.8078.4`. Chrome 132 is the manifest baseline, not a separately tested engine. Tests use isolated browser profiles and controlled local HTTP/HTTPS sites; they do not access personal accounts or existing browser data.

Executed against the integrated code:

```sh
npm run build
npm run lint
npm test
npm run test:e2e
```

The final unit run took approximately 1.2 s. The browser run started at `2026-10-29T20:56:43.770Z` and took **60.94 s**. Machine-readable final counts/environment are preserved in [ux-verification-summary.json](evidence/ux-verification-summary.json). Focused intermediate runs are superseded by this complete run.

## Coverage

- Core/repository: PSL/private suffixes, complete cookie identity, stores/partitions, exact scopes, wildcard/value search, filters/sort, validation, host checks, read-back verification, protection and exact deletion preserving siblings. Unit adapter fixtures are test doubles; browser cases use actual Chrome APIs.
- Transfer/editor: native/Cookie-Editor JSON and Netscape, file picker/drop/clipboard/download, per-record validation, explicit destination independent of manager scope, confirmed remapping, three strategies, permission preflight, protected changes, mandatory Replace backup, complete actual attributes and redacted-versus-working export.
- Vault/profiles/recovery: PBKDF2/AES-GCM/tampering, wrong-passphrase/Enter-submit feedback, encrypted metadata at rest, explicit source counts, update comparisons, one preview/apply flow, service-enforced protected-change approval, busy controls, complete-versus-partial restore and disabled-cookie recovery.
- History/rules/settings: recording scope enforced before persistence and separate from view filters, normalized URL context, HMAC diffs, bounded/redacted events, live/pause/stop semantics, valid before/after prerequisites, structured rule editing/matching/enabling/removal/Undo, readable jobs and own-data reset preserving browser cookies.
- Cookie workspace: compact table, read-only inspector, conditional bulk controls, mixed page selection, hidden selection count, export selection independent of filters, resettable filters, observation guidance, specific empty states, scope drafts, pin/follow and safe reload binding.
- Native panel: actual `sidePanel` surface opened and its target inspected without setting a viewport. Compact rows, no horizontal document overflow, following active websites and scope/filter/selection handoff to Manager are verified.
- Accessibility/lifecycle: serious/critical axe checks in all five manager workspaces and compact sidepanel view; keyboard focus containment, Escape and opener restoration; local fonts/resources; 2,500 actual cookies; responsive status during 4,000 writes; accepted operations after their view closes; metadata-only interrupted-job recovery without replay.
- Actual private context/persistence: Chrome's normal extension settings enables incognito; genuine off-the-record writes/deletion, cross-store refusal, no persistent private vault and unchanged normal cookie. A complete browser close/restart verifies regular-profile encryption, locked state, unlock and Apply.

Browser files cover 6 core, 4 transfer, 3 profile/debug lifecycle, 3 history/recovery, 1 incognito, 3 reliability, 1 native-panel, 3 cookie UX, 3 debug/rules UX, 5 profile UX and 5 transfer/editor UX cases: **37 total**.

## Measured performance and recovery

Final-run measurements are single-run observations, not hardware-independent guarantees:

| Measurement | Result |
| --- | ---: |
| Actual fixture | 2,500 cookies across 25 registrable domains |
| Fixture writes | 112.3 ms |
| Manager load/render | 116.4 ms |
| Debounced search through actual UI | 235.6 ms |
| Rendered cookie rows per page | 50 |
| Maximum sampled animation-frame gap | 16.8 ms |
| Actual event burst | 4,000 writes, 25 domains |
| Concurrent status during burst | 265 ms |
| Burst dropped-event disclosure | 4,647 events |
| Retained observations at burst check | 75; configured limit 200 |
| Interrupted import | 5 of 100 cookies written before stopping worker |
| Recovered journal | `interrupted`; no success reply |
| Automatic replay after Manager reload | 0 writes |
| Native panel viewport | 360 × 865 px |
| Native panel document width | 360 px; no horizontal document overflow |

Detailed evidence: [performance](evidence/ux-cookie-performance.json), [event burst](evidence/ux-event-storm.json), [actual interruption](evidence/ux-import-interruption.json). The queue is capped at 256 and independent of UI RPCs. Chrome emits removals/evictions as well as writes, so drops can exceed submitted writes. Drops are disclosed for the current worker session; history is not a complete browser audit log. Cookie quotas and hidden partitions remain browser constraints.

## Visual evidence

The final [Manager with fixture cookies/inspector](evidence/ux-manager.png) and [native Chrome side panel](evidence/ux-sidepanel.png) were opened and visually inspected. Values remain masked. The panel uses compact rows/details; Manager uses a table/inspector. Panel width is controlled by Chrome/the user. These are genuine local fixture screenshots.

Playwright also generates ignored `playwright-report/index.html`, `test-results/e2e-results.json` and attachments. Earlier `manager.png`, `popup.png`, `popup-native.png` and original measurement JSON in `docs/evidence/` are historical evidence of the initial implementation and popup correction, not the current UI.

## Failures corrected before the final run

1. Same-name/nested-path removal could delete protected siblings in Chrome. Exact-identity expiration plus sibling verification covers ambiguous/global-permission cases; actual-browser regression passes.
2. Performance fixtures hit per-site quotas until spread over 25 registrable domains. All 2,500 cookies are verified present before measuring.
3. Genuine incognito setup needed Developer mode enabled through normal browser controls before reload; store-isolation tests pass.
4. Whitespace in tab IDs broke tab/panel relationships. Stable valid IDs now pass axe in every tested workspace.
5. Native Tab navigation could escape dialogs. Shared modals contain focus in the topmost dialog, support Escape and restore the opener; keyboard regression passes.
6. Absent DOM children displayed literal `null`. Shared replacement omits absent children; real-cookie UI checks assert no such text.
7. Date filters formatted local inputs as UTC, and asynchronous profile configuration could re-enable accepted actions. Local-time roundtrip units and a busy-operation browser regression pass.

## Permission and browser boundaries

New host-permission prompts are native browser chrome outside the headless page harness. A probe confirmed they stay pending. No-access cases use the unchanged production manifest; operation cases grant **only controlled fixture hosts** in a temporary manifest copy. Cookie APIs, grants/status, already-granted requests and error paths remain actual browser behavior. **Acceptance/denial of a newly requested native prompt has not been automated or manually completed here.**

Remaining manual acceptance in ordinary Chrome:

1. Load/reload unchanged `dist/`, open a controlled HTTP(S) site and click Cookiebase to open the side panel.
2. Choose Grant access to this site and Cancel. Verify denial explanation and usable Manager/Retry.
3. Repeat and Allow, refresh, compare cookies with DevTools accounting for path/store/partition.
4. Grant chosen hosts/site including subdomains, revoke in Settings and verify reduced coverage. Exercise all-sites Cancel/Allow only when the wider grant is intended.

Installed Google Chrome 132/current stable, Edge, Brave, enterprise-policy combinations and personal OAuth/ADFS accounts are not claimed tested. Firefox/Safari/Chrome Android are unsupported. Axe results are not full WCAG certification; Web Crypto has no independent security audit. Server-invalidated sessions, quotas and inaccessible stores/partitions cannot be restored or bypassed.

## Local delivery

Executed `npm run package`: rebuilt `dist/` and created `artifacts/cookiebase-0.1.0.zip` plus SHA-256. `unzip -tq cookiebase-0.1.0.zip` and `shasum -a 256 -c cookiebase-0.1.0.zip.sha256` passed from `artifacts/`. Final `npm run lint`, `npm run check:plan`, 287 relative document links and `git diff --check` passed. The archive is approximately 760 KiB. No upload, push, Web Store installation or publication is performed. Existing installations require Reload in `chrome://extensions` for the new manifest. Dependency notices are bundled. The repository has no declared project license; choosing one remains an owner decision.
