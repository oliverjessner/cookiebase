export function siteOrigin(url, { subdomains = false } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Chrome blocks cookie access for this page. Choose an HTTP(S) site.');
  return `${parsed.protocol}//${subdomains ? '*.' : ''}${parsed.hostname}/*`;
}
export function createPermissionService(api = globalThis.chrome) {
  function request(origins) {
    // Deliberately call request before any asynchronous work, preserving the click gesture.
    return api.permissions.request({ origins });
  }
  return {
    contains(url) { return api.permissions.contains({ origins: [siteOrigin(url)] }); },
    requestSite(url, options) {
      const origin = siteOrigin(url, options);
      return request([origin.replace(/^https?:/, 'http:'), origin.replace(/^https?:/, 'https:')]);
    },
    requestDomains(domains) { return request(domains.flatMap((domain) => [`http://${domain}/*`, `https://${domain}/*`])); },
    requestAll() { return request(['http://*/*', 'https://*/*']); },
    revoke(origin) { return api.permissions.remove({ origins: [origin] }); },
    async granted() { return (await api.permissions.getAll()).origins || []; },
    async status(url) {
      const grants = await api.permissions.getAll();
      const all = await api.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
      let current = false;
      let reason = '';
      try { current = url ? await api.permissions.contains({ origins: [siteOrigin(url)] }) : false; }
      catch { reason = 'This page is restricted or has no reachable HTTP(S) URL. Choose a target site in the manager.'; }
      return { origins: grants.origins || [], all, current, reason, limited: !all };
    },
  };
}
