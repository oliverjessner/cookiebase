# Changelog

## Unreleased — UX implementation

- Implement all 43 findings from `analyse.md` with OJ-only shared UI, compact site context, independent workspaces and a table/inspector manager.
- Replace toolbar popup with a native side panel; follow/pin website context, validate reload targets and hand off scope/filter/selection to Manager.
- Make selection/export/profile data sources explicit, add visible resettable filters, configurable columns, stable grouping and scoped disabled-cookie recovery.
- Separate Import and Export, guide import source/destination/preview, expose only distinct strategies and require actual permission/backup readiness. Optional domain remapping is explicit and confirmed.
- Add context-preserving Vault forms, one profile Apply route, protected-change consent, profile-state updates and clear partial-versus-complete restore semantics.
- Enforce recording scope before history persistence; add live/pause timeline, guided snapshot comparison, rule match previews, toggles and undoable rule removal.
- Show local form errors, actual operation progress/counters and human partial-success/recovery states; improve keyboard focus containment and OJ ARIA associations.
- Schema remains backwards compatible. Legacy partial snapshots cannot perform full-scope replacement. Reload an existing unpacked extension for the new `sidePanel` permission/entry point; no new global host access is requested.

## 0.1.0 — 2026-10-29

Initial working Manifest V3 implementation.

- Fixed native toolbar popup sizing: explicit 560 px document width prevents the initial narrow viewport from locking the popup to 178 px. Added an actual native-popup regression test.

- Local OJ popup/manager, optional host grants, PSL scopes, mask/reveal, complete attribute inspection and bounded paginated search.
- Verified cookie creation/editing, safe same-name/path deletion, allowlist rules, delete previews, encrypted restore snapshots and Disable/Enable.
- Versioned Cookiebase/Cookie-Editor JSON and Netscape file/drop/paste import, per-cookie reports, verified writes, clipboard/download export and secret warnings.
- AES-256-GCM / PBKDF2-SHA-256 session vault, profile CRUD/search/duplicate/import/export, QA switching, scope-restricted previews and best-effort backup rollback.
- Opt-in redacted debugger, overwrite-pair correlation, retention, memory-only snapshot diffs and observed reload/redirect diagnostics.
- Bounded event queue, durable secret-free operation recovery, split incognito isolation and separate Cookiebase data reset.
- Unit and actual MV3 Chromium integration tests, local fixture server, accessibility/performance evidence and documented manual/browser limits.

No existing API/data format existed before this version. No release has been published.
