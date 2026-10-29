# Review requirement traceability

Status starts pending; final evidence replaces this table after implementation. A real API limitation is documented separately from missing application work.

| Review criticism / request | Requirement | Acceptance / evidence | Status |
| --- | --- | --- | --- |
| Only active website, no global search | CB-01, CB-02 | All-access scope, stores, PSL, permission boundary | Pending |
| No name/domain/time filter | CB-01 | Search, attribute/date/observed filters | Pending |
| DevTools shows more cookies | CB-02, CB-09 | Partition/store/host diagnostics | Pending |
| HttpOnly, partitioned, enterprise unclear | CB-02, CB-04, CB-09 | Attribute editor, verified writes, limitations | Pending |
| Delete All removes important cookies | CB-03 | Protection rule and destructive preview | Pending |
| Preserve subdomains | CB-03 | Explicit preserve toggle in deletion plan | Pending |
| Disable/re-enable individual cookies | CB-04 | Encrypted snapshot remove/restore verification | Pending |
| Advanced creation fields absent | CB-04 | Same full editor for create/edit | Pending |
| Import unknown errors / false success | CB-05, CB-08, CB-09 | Parse/preview and verified per-cookie report | Pending |
| Cookies disappear on reload | CB-05, CB-08 | Observed event history, snapshot diff | Pending |
| OAuth/ADFS redirect imports | CB-05, CB-08 | Explicit target without active website | Pending |
| File/clipboard/path confusing | CB-05, CB-06 | Separate download and clipboard actions | Pending |
| Export all as JSON | CB-06 | Explicit all-access scope and secret consent | Pending |
| Netscape / yt-dlp | CB-06 | Netscape roundtrip, loss warning | Pending |
| Reusable browser/test sessions | CB-07 | Encrypted profile CRUD/apply/reopen | Pending |
| Accidental incognito to regular import | CB-07, CB-10 | Store/context guards, no persistent incognito vault | Pending |
| Permission buttons / closed tabs | CB-09 | Direct gesture requests, retry and diagnostics | Pending |
| MV3 stability/crash | CB-09, CB-10 | Top-level worker listener, durable journal | Pending |
| Slow opening | CB-01, CB-10 | Paginated rows, debounce, measured search/render | Pending |
| Ads/security concerns | CB-11 | Offline build audit, CSP, encrypted storage | Pending |
| Simplicity, import/export strengths | CB-05, CB-06 | Popup shortcuts + manager transfer workflow | Pending |
| Mobile/Brave/Firefox/managed confusion | CB-09, CB-10 | Explicit tested Chromium/support limitations | Pending |
