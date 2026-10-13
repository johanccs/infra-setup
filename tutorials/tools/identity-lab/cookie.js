// Which requests carry a cookie? A small model of the browser's rules, for the cookie simulator.
// It follows RFC 6265 and the current RFC 6265bis draft (draft-ietf-httpbis-rfc6265bis, section 5): Secure, Domain, Path,
// SameSite Strict and Lax, and the __Host- prefix. Pure JavaScript with no DOM.
//
// A cookie was set by https://app.example.com. Its attributes:
//   { name, sameSite: 'Strict' | 'Lax' | 'None' | '' (not set), secure, httpOnly, domain: null | 'example.com', path: '/' }
// A request: { scheme, host, path, crossSite, topLevelNav, method }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IACookie = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SET_BY = 'app.example.com';
  const SAFE = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];

  // Would the browser keep this cookie at all? __Host- needs Secure, no Domain and Path=/ (draft section 4.1.3.2).
  function accepted(c) {
    const problems = [];
    if (/^__Host-/.test(c.name)) {
      if (!c.secure) problems.push('a __Host- cookie must have the Secure attribute');
      if (c.domain) problems.push('a __Host- cookie must not have a Domain attribute');
      if (c.path !== '/') problems.push('a __Host- cookie must have Path=/');
    } else if (/^__Secure-/.test(c.name) && !c.secure) problems.push('a __Secure- cookie must have the Secure attribute');
    return { ok: problems.length === 0, problems };
  }
  const domainMatches = (host, d) => host === d || host.endsWith('.' + d);
  function sent(c, r) {
    const acc = accepted(c);
    if (!acc.ok) return { sent: false, why: 'The browser refuses to store this cookie: ' + acc.problems.join('; ') + '.' };
    if (c.secure && r.scheme !== 'https') return { sent: false, why: 'The cookie is Secure, so it is sent only over HTTPS.' };
    if (c.domain ? !domainMatches(r.host, c.domain) : r.host !== SET_BY) return { sent: false, why: c.domain ? `Its Domain is ${c.domain}; ${r.host} is not inside it.` : `It has no Domain attribute, so it goes back only to the exact host that set it (${SET_BY}), not to ${r.host}.` };
    if (!(r.path === c.path || r.path.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'))) return { sent: false, why: `Its Path is ${c.path}; ${r.path} is not under it.` };
    if (r.crossSite) {
      const mode = c.sameSite || 'Lax';
      const note = c.sameSite ? '' : ' (SameSite is not set. Some browsers then treat the cookie as Lax. Do not rely on that.)';
      if (mode === 'Strict') return { sent: false, why: 'SameSite=Strict: never sent on a request that starts on another site.' };
      if (mode === 'Lax') {
        if (r.topLevelNav && SAFE.includes(r.method)) return { sent: true, why: 'SameSite=Lax allows it: a top-level navigation with a safe method (GET).' + note };
        return { sent: false, why: 'SameSite=Lax: on another site\'s request it is sent only for a top-level navigation with a safe method.' + note };
      }
      return { sent: true, why: 'SameSite=None: sent on cross-site requests too (and the Secure attribute must be set as well).' };
    }
    return { sent: true, why: 'The request starts on the same site, and Secure, Domain and Path all match.' };
  }
  // The eight situations the simulator shows. app.example.com is the site that set the cookie; evil.test is another site.
  const SCENARIOS = [
    { id: 'same-post', label: 'Your own page calls its API', detail: 'fetch POST https://app.example.com/api/todos from a page on app.example.com', scheme: 'https', host: 'app.example.com', path: '/api/todos', crossSite: false, topLevelNav: false, method: 'POST' },
    { id: 'same-sub', label: 'Your page calls a sibling subdomain', detail: 'fetch GET https://api.example.com/todos from a page on app.example.com (same site, different origin)', scheme: 'https', host: 'api.example.com', path: '/todos', crossSite: false, topLevelNav: false, method: 'GET' },
    { id: 'link', label: 'Someone clicks a link to your site', detail: 'a link on evil.test opens https://app.example.com/ (top-level GET navigation)', scheme: 'https', host: 'app.example.com', path: '/', crossSite: true, topLevelNav: true, method: 'GET' },
    { id: 'form', label: 'Another site auto-submits a form', detail: 'a hidden form on evil.test POSTs to https://app.example.com/api/todos', scheme: 'https', host: 'app.example.com', path: '/api/todos', crossSite: true, topLevelNav: true, method: 'POST' },
    { id: 'img', label: 'Another site loads an image from you', detail: 'an <img src="https://app.example.com/api/todos"> on evil.test', scheme: 'https', host: 'app.example.com', path: '/api/todos', crossSite: true, topLevelNav: false, method: 'GET' },
    { id: 'xfetch', label: 'Another site calls fetch() with credentials', detail: 'fetch POST https://app.example.com/api/todos, credentials: include, from evil.test', scheme: 'https', host: 'app.example.com', path: '/api/todos', crossSite: true, topLevelNav: false, method: 'POST' },
    { id: 'http', label: 'The same host over plain HTTP', detail: 'http://app.example.com/ (no TLS)', scheme: 'http', host: 'app.example.com', path: '/', crossSite: false, topLevelNav: true, method: 'GET' },
    { id: 'other-path', label: 'A different path on your site', detail: 'GET https://app.example.com/admin (try Path=/api)', scheme: 'https', host: 'app.example.com', path: '/admin', crossSite: false, topLevelNav: true, method: 'GET' },
  ];
  return { accepted, sent, SCENARIOS, SET_BY };
});
