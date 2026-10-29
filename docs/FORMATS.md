# Cookie interchange

Exports contain session credentials unless the **Redacted export** option is enabled. JSON and Netscape downloads and clipboard output are plaintext, outside the encrypted vault. A redacted export is informational and cannot be imported to restore cookies.

Cookiebase reads Cookie-Editor JSON arrays, versioned Cookiebase JSON, and Netscape `cookies.txt`. It also accepts an object containing a `cookies` array with the same per-cookie schema; Playwright-style absolute `expires` and `sameSite: "Lax" | "Strict" | "None"` are normalized. Browser profile databases are not imported directly.

## Cookiebase JSON version 1

```json
{
  "format": "cookiebase",
  "version": 1,
  "generatedAt": "2026-10-29T12:00:00.000Z",
  "scope": { "type": "host", "url": "https://example.test/", "storeId": "0", "incognito": false },
  "redacted": false,
  "cookies": [
    {
      "name": "consent",
      "value": "essential",
      "domain": "example.test",
      "path": "/",
      "hostOnly": true,
      "secure": true,
      "httpOnly": false,
      "sameSite": "lax",
      "session": false,
      "expirationDate": 1893456000,
      "storeId": "0"
    }
  ]
}
```

The cookie schema mirrors supported Chrome attributes. `partitionKey` may contain `topLevelSite` (an HTTP(S) origin) and `hasCrossSiteAncestor` (boolean). `sameSite` is `unspecified`, `lax`, `strict` or `no_restriction`. `expirationDate` is an absolute UNIX timestamp in **seconds**. Import also accepts a positive relative `maxAge` in seconds; supplying both is an error. Session cookies omit expiration. Unknown attributes are ignored, never treated as browser capabilities. Export includes only documented cookie fields, excluding observation fingerprints or unrelated source properties.

Cookie identity consists of name, canonical domain, path, store ID and partition key. HostOnly/domain semantics are preserved; the canonical domain of a domain cookie starts with a dot. Supplied stores and domains are preserved. The import target URL fills a **missing** domain; the chosen target store fills a **missing** store. Neither silently remaps an explicit source domain/store. Out-of-scope records are reported as invalid. Cross-incognito transfers are refused by default.

Native profile interchange uses the separate `cookiebase-profile` format implemented by the profile service. Profile exports are also plaintext and require explicit secret-export consent.

## Netscape cookies.txt

Each cookie has seven tab-separated fields: domain, include-subdomains (`TRUE`/`FALSE`), path, secure (`TRUE`/`FALSE`), expiration epoch seconds (`0` for session), name and value. The `#HttpOnly_` domain prefix is retained. Empty values are supported.

Netscape cannot preserve SameSite, store identity, partition metadata or observation metadata. **Partitioned cookies require JSON**; Cookiebase refuses a Netscape export containing them. Tabs or newlines in fields also require JSON. The exported file carries these limitations in comments. It can be supplied to tools accepting Netscape files, such as `yt-dlp --cookies cookies.txt`; whether it authenticates depends on the target server and its current session requirements.

## Import execution

Parsing and preview never change browser cookies. Preview shows domains, stores, required origin grants, conflicts, invalid rows and session risks. Merge and Overwrite set valid incoming cookies and replace exact-identity conflicts. Skip leaves exact-identity conflicts unchanged. Replace removes only cookies inside the explicitly chosen scope which are absent from the incoming snapshot; **any invalid or out-of-scope record blocks the entire Replace operation**. An empty valid input can intentionally clear a scope, subject to the displayed preview and encrypted backup requirement in the manager.

The report records imported, overwritten, skipped, failed and removed operations. A successful write requires a real Chrome API read-back verification. One failed cookie does not turn other failed cookies into successes. Restore/import is best effort: Chrome policies, unsupported contexts, expired credentials and subsequent server or JavaScript changes can prevent or undo the desired state. Cookiebase does not perform a transactional rollback of browser cookies.

The parser rejects inputs over 10 MiB or 10,000 cookie records. Netscape input is additionally limited to 20,000 physical lines, including comments, to bound error-report memory. File inputs in the manager are capped at 5 MiB. JSON parsing errors are reported without echoing source text or cookie values.
