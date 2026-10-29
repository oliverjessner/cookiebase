import { cookieId, inScope, validateCookie, cookieUrl, normalizeCookie } from '../core/cookies.js';

export const FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_COOKIES = 10000;
const FIELDS = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'session', 'expirationDate', 'hostOnly', 'storeId', 'partitionKey', 'incognito'];

function safeRecord(cookie) {
  return Object.fromEntries(FIELDS.filter(key => cookie[key] !== undefined).map(key => [key, structuredClone(cookie[key])]));
}

function issue(index, cookie, error) {
  return { index, name: typeof cookie?.name === 'string' ? cookie.name : '', domain: typeof cookie?.domain === 'string' ? cookie.domain : '', error };
}

function normalise(input, options) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Each cookie must be an object.');
  const output = {};
  for (const key of FIELDS) if (Object.hasOwn(input, key)) output[key] = structuredClone(input[key]);
  if (typeof output.name !== 'string') throw new Error('Cookie name must be a string.');
  if (typeof output.value !== 'string') throw new Error('Cookie value must be a string; redacted exports cannot be restored.');
  if (!output.domain && options.targetUrl) output.domain = new URL(options.targetUrl).hostname;
  if (typeof output.domain !== 'string') throw new Error('Cookie domain is missing. Supply a target URL or a domain.');
  output.domain = output.domain.toLowerCase();
  output.path ??= '/';
  output.secure ??= false;
  output.httpOnly ??= false;
  output.hostOnly ??= !output.domain.startsWith('.');
  output.sameSite ??= 'unspecified';
  const sameSites = { Lax: 'lax', Strict: 'strict', None: 'no_restriction', none: 'no_restriction' };
  output.sameSite = sameSites[output.sameSite] ?? output.sameSite;
  // Playwright-compatible JSON uses an absolute epoch in `expires`; -1 is session.
  if (output.expirationDate === undefined && typeof input.expires === 'number' && input.expires > 0) output.expirationDate = input.expires;
  if (input.maxAge !== undefined) {
    if (output.expirationDate !== undefined) throw new Error('Supply either absolute expirationDate or relative maxAge, not both.');
    if (typeof input.maxAge !== 'number' || !Number.isFinite(input.maxAge) || input.maxAge <= 0) throw new Error('maxAge must be a positive number of seconds.');
    output.expirationDate = (options.now ?? Date.now() / 1000) + input.maxAge;
  }
  output.session ??= output.expirationDate === undefined;
  if (output.session) delete output.expirationDate;
  output.storeId = String(output.storeId ?? options.storeId ?? '0');
  if (output.incognito !== undefined && typeof output.incognito !== 'boolean') throw new Error('Incognito context must be an explicit boolean.');
  if (output.partitionKey && (typeof output.partitionKey !== 'object' || Array.isArray(output.partitionKey) || typeof output.partitionKey.topLevelSite !== 'string')) throw new Error('Partition key must contain a topLevelSite HTTP(S) origin.');
  if (input.partitioned === true && !output.partitionKey) throw new Error('Partitioned cookie requires an explicit partitionKey; it cannot be inferred.');
  const errors = validateCookie(output);
  if (errors.length) throw new Error(errors.join(' '));
  return normalizeCookie(output);
}

/** Parse without changing browser state. Errors intentionally never include input values. */
export function parseImport(text, options = {}) {
  const result = { format: 'unknown', cookies: [], invalid: [], warnings: [], metadata: {} };
  if (typeof text !== 'string' || !text.trim()) {
    result.invalid.push(issue(0, null, 'Import is empty. Choose a file or paste cookies.'));
    return result;
  }
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    result.invalid.push(issue(0, null, 'Import exceeds the 10 MiB limit. Split the file into smaller scopes.'));
    return result;
  }
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (/^# REDACTED:/m.test(cleaned)) {
    result.invalid.push(issue(0, null, 'This Netscape export is redacted and cannot restore cookie values.'));
    return result;
  }
  let records;
  if (['[', '{'].includes(cleaned[0])) {
    result.format = 'json';
    let data;
    try { data = JSON.parse(cleaned); } catch {
      result.invalid.push(issue(0, null, 'Invalid JSON syntax. Check commas, quoting and closing brackets.'));
      return result;
    }
    if (Array.isArray(data)) records = data;
    else if (data && data.format === 'cookiebase' && data.version === FORMAT_VERSION && Array.isArray(data.cookies)) {
      records = data.cookies;
      result.metadata = { scope: data.scope, profile: data.profile, generatedAt: data.generatedAt, redacted: data.redacted === true };
      if (data.redacted) {
        result.invalid.push(issue(0, null, 'This export is redacted and cannot restore cookie values.'));
        return result;
      }
    } else if (data && data.format === 'cookiebase') {
      result.invalid.push(issue(0, null, 'Unsupported Cookiebase format version or missing cookies array.'));
      return result;
    } else if (data && Array.isArray(data.cookies) && !data.format) {
      records = data.cookies;
      result.warnings.push('Imported a cookies-array JSON envelope. Only documented cookie attributes are used.');
    } else {
      result.invalid.push(issue(0, null, 'Unsupported JSON schema. Use a Cookie-Editor array or versioned Cookiebase export.'));
      return result;
    }
  } else {
    result.format = 'netscape';
    records = [];
    let physicalLines = 1;
    for (const char of text) {
      if (char === '\n' && ++physicalLines > MAX_IMPORT_COOKIES * 2) {
        result.invalid.push(issue(0, null, 'Netscape input exceeds 20,000 physical lines. Split the file into smaller scopes.'));
        return result;
      }
    }
    for (const [lineIndex, original] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
      if (!original.trim() || (original.startsWith('#') && !original.startsWith('#HttpOnly_'))) continue;
      if (records.length + result.invalid.length >= MAX_IMPORT_COOKIES) {
        result.invalid.push(issue(lineIndex + 1, null, 'Import exceeds 10,000 cookie records. Split the file into smaller scopes.'));
        return result;
      }
      const httpOnly = original.startsWith('#HttpOnly_');
      const line = httpOnly ? original.slice('#HttpOnly_'.length) : original;
      const parts = line.split('\t');
      if (parts.length !== 7 || !['TRUE', 'FALSE'].includes(parts[1]) || !['TRUE', 'FALSE'].includes(parts[3]) || !/^\d+$/.test(parts[4])) {
        result.invalid.push(issue(lineIndex + 1, null, 'Netscape row must contain seven tab-separated fields with TRUE/FALSE flags and epoch expiration.'));
        continue;
      }
      const expiration = Number(parts[4]);
      const record = { domain: parts[0], hostOnly: parts[1] === 'FALSE', path: parts[2], secure: parts[3] === 'TRUE', httpOnly, name: parts[5], value: parts[6], session: expiration === 0, sameSite: 'unspecified' };
      if (expiration) record.expirationDate = expiration;
      records.push(record);
    }
    result.warnings.push('Netscape cookies.txt cannot retain SameSite, partition keys, store identity or observation metadata.');
  }
  if (records.length > MAX_IMPORT_COOKIES) {
    result.invalid.push(issue(0, null, 'Import exceeds 10,000 cookies. Split the file into smaller scopes.'));
    return result;
  }
  for (const [index, record] of records.entries()) {
    try { result.cookies.push(normalise(record, options)); }
    catch (error) { result.invalid.push(issue(index + 1, record, error.message)); }
  }
  if (!records.length && !result.invalid.length) result.warnings.push('The import contains no cookies. An empty replace clears the explicitly chosen scope.');
  if (result.cookies.some(cookie => cookie.session)) result.warnings.push('Session cookies may grant account access. Servers can invalidate sessions after import.');
  return result;
}

/** Immutable in-memory preview. No mutation is performed until executeImport. */
export function previewImport(parsed, existing, options = {}) {
  const { scope, mode = 'merge', allowIncognitoTransfer = false } = options;
  if (!scope?.type) throw new Error('Choose an explicit import scope before previewing.');
  if (!['merge', 'replace', 'skip', 'overwrite'].includes(mode)) throw new Error('Unsupported import mode.');
  const plan = {
    scope: structuredClone(scope), mode, cookies: [], invalid: [...parsed.invalid], warnings: [...parsed.warnings], actions: [], removals: [], requiredOrigins: [], counts: {},
  };
  const current = new Map(existing.filter(cookie => inScope(cookie, scope)).map(cookie => [cookieId(cookie), cookie]));
  const incoming = new Map();
  const incognitoSource = parsed.metadata?.scope?.incognito === true;
  for (const [index, cookie] of parsed.cookies.entries()) {
    let error;
    if ((incognitoSource || cookie.incognito === true || cookie.storeId === '1') && !allowIncognitoTransfer && scope.incognito !== true) error = 'Incognito cookies cannot be imported into the regular store without explicit transfer consent.';
    else if (scope.incognito === true && !allowIncognitoTransfer && !incognitoSource) error = 'Regular-to-incognito transfer requires explicit consent.';
    else if (!inScope(cookie, scope)) error = 'Cookie is outside the chosen scope or store. Change the scope explicitly; no cookie was remapped.';
    if (error) { plan.invalid.push(issue(index + 1, cookie, error)); continue; }
    const id = cookieId(cookie);
    if (incoming.has(id)) {
      plan.invalid.push(issue(index + 1, cookie, 'Duplicate identity in import (name, domain, path, store and partition). Remove the duplicate before applying.'));
      continue;
    }
    incoming.set(id, cookie);
    plan.cookies.push(cookie);
    const exists = current.has(id);
    plan.actions.push({ cookie, previous: current.get(id), action: exists && mode === 'skip' ? 'skip' : exists ? 'overwrite' : 'import' });
    const url = new URL(cookieUrl(cookie));
    plan.requiredOrigins.push(`${url.protocol}//${url.hostname}/*`);
  }
  plan.requiredOrigins = [...new Set(plan.requiredOrigins)].sort();
  if (mode === 'replace') plan.removals = [...current.values()].filter(cookie => !incoming.has(cookieId(cookie)));
  plan.snapshotCookies = [...current.values()].filter(cookie => mode === 'replace' || plan.actions.some(action => action.action === 'overwrite' && cookieId(action.cookie) === cookieId(cookie)));
  plan.counts = { valid: plan.cookies.length, invalid: plan.invalid.length, imported: plan.actions.filter(a => a.action === 'import').length, overwritten: plan.actions.filter(a => a.action === 'overwrite').length, skipped: plan.actions.filter(a => a.action === 'skip').length, removed: plan.removals.length };
  if (plan.invalid.length && mode === 'replace') plan.warnings.push('Replace is blocked until all invalid or out-of-scope records are resolved. No removals will run.');
  if (plan.removals.length) plan.warnings.push(`Replace removes ${plan.removals.length} cookies inside the chosen scope. Create an encrypted snapshot first.`);
  return plan;
}

/** Each write must pass the repository's real read-back verification. */
export async function executeImport(plan, { repository, snapshot } = {}) {
  if (!repository || !plan?.scope?.type) throw new Error('A repository and explicit preview scope are required.');
  const report = { processed: 0, imported: 0, overwritten: 0, skipped: 0, failed: 0, removed: 0, results: [] };
  const record = result => {
    report.processed++;
    report.results.push(result);
    if (result.status === 'failed') report.failed++;
    else if (result.status === 'skipped') report.skipped++;
    else if (result.status === 'imported') report.imported++;
    else if (result.status === 'overwritten') report.overwritten++;
  };
  for (const invalid of plan.invalid) record({ ...invalid, status: 'failed' });
  if (plan.mode === 'replace' && plan.invalid.length) {
    report.aborted = true;
    for (const action of plan.actions) record({ name: action.cookie.name, domain: action.cookie.domain, status: 'skipped', reason: 'Replace preflight failed; browser state is unchanged.' });
    return report;
  }
  if (snapshot && plan.snapshotCookies.length) report.snapshotId = await snapshot(plan.snapshotCookies, { scope: plan.scope, reason: 'Before import' });
  // The full plan is checked again before any destructive operation, so a caller
  // cannot accidentally widen a preview after it was displayed.
  if ([...plan.actions.map(a => a.cookie), ...plan.removals].some(cookie => !inScope(cookie, plan.scope))) throw new Error('Preview scope changed. Preview the import again.');
  for (const cookie of plan.removals) {
    try {
      await repository.remove(cookie);
      report.removed++;
      report.results.push({ name: cookie.name, domain: cookie.domain, status: 'removed' });
    } catch (error) {
      // API messages may include the submitted cookie. Keep transfer reports
      // value-free; repository diagnostics remain available in the action view.
      record({ name: cookie.name, domain: cookie.domain, status: 'failed', error: safeOperationError(error, cookie, 'removed') });
    }
  }
  if (report.failed && plan.mode === 'replace') {
    report.aborted = true;
    for (const action of plan.actions) record({ name: action.cookie.name, domain: action.cookie.domain, status: 'skipped', reason: 'Replacement stopped after a removal failure. Restore the snapshot if needed.' });
    return report;
  }
  for (const action of plan.actions) {
    const { cookie } = action;
    const identity = { name: cookie.name, domain: cookie.domain, storeId: cookie.storeId, partitionKey: cookie.partitionKey };
    if (action.action === 'skip') { record({ ...identity, status: 'skipped', reason: 'Duplicate identity already exists.' }); continue; }
    try {
      await repository.set(cookie);
      await repository.verify(cookie);
      record({ ...identity, status: action.action === 'overwrite' ? 'overwritten' : 'imported', verified: true });
    } catch (error) {
      record({ ...identity, status: 'failed', error: safeOperationError(error, cookie) });
    }
  }
  report.note = 'Verified at import time. A later reload, redirect, server response or script can change cookies. Cookiebase does not restore server-side sessions.';
  return report;
}

function safeOperationError(error, cookie, operation = 'set') {
  // Only allow known value-free diagnostics. An arbitrary Chrome/provider error
  // is never serialized, since it could echo set() input or credentials.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/permission|host access|not allowed|access denied/i.test(message)) return 'Host permission is missing or access is blocked by browser policy. Grant the target host and retry.';
  if (/store|incognito/i.test(message)) return 'Cookie store is unavailable or belongs to another browsing context. Choose the correct store.';
  if (/partition/i.test(message)) return 'Partition context is invalid or unavailable. Supply the supported partition key and host permissions.';
  if (/expir/i.test(message)) return 'Cookie expiration is invalid, expired or was changed by the browser.';
  if (/verif|read.?back|mismatch/i.test(message)) return 'Read-back verification failed. The browser rejected, adjusted or immediately changed this cookie.';
  if (validateCookie(cookie).length) return validateCookie(cookie).join(' ');
  return `Cookie could not be ${operation} and verified. Check domain/path, Secure/SameSite rules, target permission, partition, store and browser policy.`;
}

export function exportCookies(cookies, { format = 'json', redacted = false, scope, profile } = {}) {
  if (!scope?.type) throw new Error('Choose an explicit export scope.');
  if (cookies.some(cookie => !inScope(cookie, scope))) throw new Error('Export contains cookies outside the chosen scope or store.');
  const records = cookies.map(safeRecord);
  if (format === 'json') {
    if (redacted) for (const cookie of records) delete cookie.value;
    return JSON.stringify({ format: 'cookiebase', version: FORMAT_VERSION, generatedAt: new Date().toISOString(), scope, redacted, ...(profile ? { profile } : {}), cookies: records }, null, 2);
  }
  if (format !== 'netscape') throw new Error('Choose JSON or Netscape export.');
  if (records.some(cookie => cookie.partitionKey)) throw new Error('Netscape cannot represent partitioned cookies safely. Choose JSON to retain partition identity.');
  const rows = records.map(cookie => {
    const domain = cookie.hostOnly ? cookie.domain.replace(/^\./, '') : `.${cookie.domain.replace(/^\./, '')}`;
    const fields = [`${cookie.httpOnly ? '#HttpOnly_' : ''}${domain}`, cookie.hostOnly ? 'FALSE' : 'TRUE', cookie.path, cookie.secure ? 'TRUE' : 'FALSE', cookie.session ? '0' : String(Math.floor(cookie.expirationDate)), cookie.name, redacted ? '[REDACTED]' : cookie.value];
    if (fields.some(field => /[\t\r\n]/.test(field))) throw new Error('Netscape cannot represent tabs or newlines in cookie attributes. Choose JSON.');
    return fields.join('\t');
  });
  return ['# Netscape HTTP Cookie File', '# Cookiebase export. Cookie values can grant account access. Keep this file private.', '# Netscape loses SameSite, store IDs and modern metadata. Partitioned cookies require JSON.', ...(redacted ? ['# REDACTED: informational only; do not import as working credentials.'] : []), ...rows, ''].join('\n');
}
