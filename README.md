# Cookiebase

**Your cookies. Your control.**

A local Chrome Desktop extension for cookie inspection, protected cleanup, encrypted QA session profiles and observed change debugging. No account, backend, advertising or telemetry.

- **Inspect:** popup for the current host and a full manager with global search, PSL site scopes, complete cookie attributes, store/partition context and paginated results.
- **Control:** verified editing and creation, protection rules, selective cleanup previews, encrypted Undo and temporary Disable/Enable.
- **Profiles:** named, searchable encrypted cookie states, import/export, preview/apply/verify, backups and best-effort rollback.
- **Debug:** opt-in redacted event timeline, overwrite correlation and before/after snapshots. Times represent observation, never browser cookie creation.

Cookie values are masked until explicitly revealed. **Session cookies can grant account access.** Clipboard content and exported files are unencrypted. Do not share them with untrusted recipients. Cookiebase cannot restore server-invalidated sessions, MFA, passwords, localStorage or another Chrome browser profile.

## Build and install

Node 22.12+ and npm are required.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome Desktop 132+.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's **`dist/`** directory.
4. Open a normal HTTP(S) website, then open Cookiebase from the extension toolbar.
5. Choose **Grant access to this site** and accept Chrome's native permission dialog. Global access is optional.
6. Choose **Open Manager** for Rules, Profiles, Debug and Settings. A manager can also import to an explicit target URL without opening that site.

There is no application server to start. Refresh/Retry loads a changed scope. Browsing restrictions and access denial are shown rather than interpreted as an empty browser.

Create or unlock the vault in Profiles before encrypted snapshots or Disable. A passphrase needs at least 12 characters and cannot be recovered. Manual locking, worker suspension or browser restart requires Unlock again. Cleanup without a vault requires explicit confirmation that Undo is unavailable.

To keep a consent cookie, choose **Protect** beside it, then use **Delete filtered except protected** and review the preview. For a QA switch, save a profile, inspect its displayed replacement preview and choose **Apply this QA state**. Replacement is restricted to the intersection of its saved scope and the chosen manager scope.

## Verify

```sh
npx playwright install chromium
npm run lint
npm test
npm run build
npm run test:e2e
npm run package
```

Tests use local HTTP/HTTPS fixtures and Playwright's standard Chromium persistent context. They never access personal accounts. The HTTPS certificate/private key in `tests/fixtures` is public test-only material, not a deployment credential. Test contexts ignore that fixture certificate only.

Cookie-operation browser tests add **only fixture hosts** to a temporary manifest copy and exercise real Chrome APIs. Fresh-install/no-access tests load the unchanged production manifest. Native optional-permission dialog acceptance/denial requires the manual procedure in [the test report](docs/TEST_REPORT.md); it is not presented as automated success.

`npm run package` builds an unpacked extension and writes `artifacts/cookiebase-0.1.0.zip` plus its SHA-256 checksum. No publication, upload, push or Web Store installation is performed.

## Support and boundaries

Chrome Desktop 132+ is the target. Automated verification uses Chromium; a minimum-version Chrome matrix, Edge and Brave have not been tested. Firefox and Chrome Android are unsupported. Incognito requires Chrome's explicit permission and uses a separate store/workspace; persistent incognito vaults/profiles are disabled. Cookies outside granted hosts, unavailable stores and hidden partition contexts may be inaccessible. Cookiebase cannot bypass enterprise policy or explain every server/network rejection.

All common UI uses the pinned, locally bundled `oj-designsystem` package: Comfortaa, JetBrains Mono and Font Awesome assets are included in the extension. No remote scripts, fonts or UI frameworks.

See [requirements and evidence](docs/REVIEW_REQUIREMENTS.md), [test report](docs/TEST_REPORT.md), [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [privacy](docs/PRIVACY.md), [formats](docs/FORMATS.md), [browser support](docs/BROWSER_SUPPORT.md), [implementation record](docs/IMPLEMENTATION_PLAN.md) and [changelog](CHANGELOG.md).

The complete Cookiebase source is included in this repository. The initial repository had no project license; no new license grant is implied. Dependency licences/notices are included in `dist/licenses`. A project license and Web Store publication remain owner decisions.
