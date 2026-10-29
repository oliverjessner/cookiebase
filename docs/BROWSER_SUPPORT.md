# Browser and API support

**Chrome Desktop is the target platform.** The manifest declares Chrome 132 as the minimum API baseline. This is not a claim that every Chrome release or operating system from that version onward has been independently tested. The actual automated browser version, commands and remaining manual checks are recorded in [TEST_REPORT.md](TEST_REPORT.md).

| Environment | Status and boundary |
| --- | --- |
| Chrome Desktop | Targeted MV3 platform. Load the generated `dist/` directory as an unpacked extension. Cookies require the relevant host grants. |
| Playwright-bundled Chromium | Real persistent-context extension test engine; actual `chrome.cookies`, local HTTP/HTTPS server responses, extension worker and UI. The lockfile fixes the tooling; final engine/results are in the test report. |
| Chrome 132 minimum baseline | Enables the chosen partition/context API baseline; features are detected and unsupported/inaccessible partition contexts are reported. Minimum-version execution itself is not implied by testing a newer Chromium. |
| Edge / Brave | Not independently verified in this implementation. Chromium similarity does not establish cookie-policy, permissions, partitioning or incognito compatibility. |
| Firefox / Safari | Unsupported build/API targets. No compatibility claim. |
| Chrome Android | Regular Chrome extensions are not supported by Chrome Android; Cookiebase does not claim Android support. |
| Managed/enterprise browser | Administrative policy may block installation, host access, stores or cookie writes. Cookiebase explains observable failures and cannot bypass policy. |
| Incognito | Requires Chrome's explicit extension opt-in. Split context and store isolation; temporary memory-only Cookiebase data; no persistent incognito profile/vault/Undo workflow. See the test report for the exact tested path. |

## Permissions and surfaces

The extension needs `cookies`, `storage` and `activeTab`. Host permissions are optional HTTP(S) origins: current site, chosen domains, a site including subdomains, or all sites after an explicit user action. The source manifest has no required global host grant. All Accessible Sites covers granted hosts in the current browser context, not inaccessible cookies elsewhere.

The popup operates on the active site. Restricted schemes such as `chrome://`, a closed tab, or an unavailable URL are explained, and the manager lets you enter a separate HTTP(S) target. Manager import/Apply does not require that website to be open, so an OAuth/ADFS-style redirect does not force the destination to follow the current tab. A later server/script change can still replace a successfully imported cookie.

The compact popup and standalone manager are supported surfaces. Debug events and snapshots work in the manager without DevTools. There is no Side Panel or DevTools/network-header extension in this version; no unsupported API is simulated to invent a rejection reason.

## Cookie capabilities and limits

Cookiebase displays Name, Domain, Path, masked Value, Expiration/Session, SameSite, Secure, HttpOnly, HostOnly, Partition and Store. Create and Edit expose supported advanced attributes. It validates prefixes, Secure/SameSite requirements, future expiration and explicit stores before calling Chrome, then verifies the actual result. Chrome can reject or adjust attributes and may cap persistent expiration; a verified result is only a point-in-time state.

The identity includes name, domain, path, store and partition. Public-suffix grouping comes from the locally bundled PSL via `tldts`; it does not use a naive last-two-labels heuristic. Exact-host and site/subdomain scopes are deliberately different. Chrome does not expose a cookie creation timestamp here: the UI reports expiration and Cookiebase's own observed-change time only.

`getAllCookieStores` and tab context establish accessible regular/incognito stores. An unknown or inaccessible context is withheld and explained. The extension cannot read another Chrome browser profile, another installed browser, or an incognito store without the required browser configuration.

Partition coverage is best effort. Cookiebase queries API-accessible partitions, supported wildcard partition queries and feature-detected active top-frame `getPartitionKey` context. It does not enumerate every hidden frame/top-level partition or promise DevTools parity. Supply a supported explicit partition key in the advanced cookie editor when needed. Browser/enterprise third-party-cookie restrictions remain authoritative.

Cookiebase profiles restore cookies only. They do not restore server-side sessions, MFA state, CSRF validity, rotated credentials, website LocalStorage, website IndexedDB or saved passwords. Disable/Enable temporarily removes/restores a cookie from an encrypted snapshot; Chrome has no native cookie Enabled property.

## Observability

Debug captures permitted `cookies.onChanged` events with their observed time and Chrome cause. It can show an add/remove/overwrite/expiration/eviction observation, correlate overwrite pairs and compare two captured states. It cannot prove which server/user action caused an event, disclose a server's internal session decision, or provide every browser `Set-Cookie` rejection reason through the cookies API. Those reasons are displayed as **not observable** where no evidence exists. No HAR or request/response-header collection is enabled.

Debug events can be lost on browser/worker termination or queue overload; the queue is bounded and reports dropped observations while the worker remains active. Redacted diff snapshots are memory-only and disappear on restart. Persistent encrypted profiles/backups remain locked until the user unlocks the vault again.

## Automated permission-test boundary and manual acceptance

Headless Playwright cannot operate Chrome's native optional-host acceptance/denial dialog. The suite therefore separates unchanged-production-manifest no-access tests from cookie-operation tests that add **only controlled fixture origins** to a temporary manifest copy. Actual cookie APIs, host-permission checks and browser stores remain in use; production source and API responses are not mocked. This setup does not prove native dialog acceptance or denial.

For that final manual path, load the unchanged `dist/` extension into Chrome, open a site you control, and choose **Grant access to this site**. Verify the native prompt names the intended origin, then accept and Retry. Repeat with a fresh optional origin and decline: Cookiebase should explain the denial and remain usable for previously granted sites. Revoke the origin in Settings or Chrome's extension controls and verify coverage decreases. Test all-sites access separately only when you intend to grant that wider access.

Chrome's official references describe the [cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies), [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). The test harness follows Playwright's [persistent-context extension guidance](https://playwright.dev/docs/chrome-extensions).
