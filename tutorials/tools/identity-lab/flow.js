// The OAuth 2.0 authorization code flow with PKCE, as data: every message with its real parameters, and what each attack
// does when the protection is switched off. Plus the grant chooser and a URL judge for the "build the request" drills.
// Sources: RFC 6749 (4.1, 5), RFC 7636, RFC 9700 (2.1 and 4), RFC 9207, OpenID Connect Core 1.0. Pure JavaScript with no DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crypto.js'));
  else root.IAFlow = factory(root.IACrypto);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const D = { client: 'todo-web', redirect: 'https://app.example.com/callback', authz: 'https://login.example.com/authorize', token: 'https://login.example.com/token', api: 'https://api.example.com/todos', scope: 'openid todos.read' };
  const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // opts: { pkce, state, oidc, iss }. Random values are made here, so each run shows different ones.
  async function build(opts) {
    opts = Object.assign({ pkce: true, state: true, oidc: true, iss: true }, opts || {});
    const verifier = C.pkceVerifier(), challenge = await C.pkceChallenge(verifier);
    const state = C.b64uEnc(C.random(16)), nonce = C.b64uEnc(C.random(16)), code = C.b64uEnc(C.random(24));
    const scope = opts.oidc ? D.scope : 'todos.read';
    const auth = { response_type: 'code', client_id: D.client, redirect_uri: D.redirect, scope };
    if (opts.state) auth.state = state;
    if (opts.oidc) auth.nonce = nonce;
    if (opts.pkce) { auth.code_challenge = challenge; auth.code_challenge_method = 'S256'; }
    const back = { code }; if (opts.state) back.state = state; if (opts.iss) back.iss = 'https://login.example.com';
    const tokenReq = { grant_type: 'authorization_code', code, redirect_uri: D.redirect, client_id: D.client };
    if (opts.pkce) tokenReq.code_verifier = verifier;
    const resp = { access_token: 'eyJhbGciOi…', token_type: 'Bearer', expires_in: 600, refresh_token: 'tGzv3JOkF0…', scope };
    if (opts.oidc) resp.id_token = 'eyJhbGciOi…';
    const steps = [
      { n: 1, channel: 'browser', from: 'You', to: 'Client app', title: 'You choose to sign in', http: 'GET /login HTTP/1.1\nHost: app.example.com',
        note: 'The client makes up three one-time values for this attempt: <code>state</code>' + (opts.pkce ? ', a <code>code_verifier</code>' : '') + (opts.oidc ? ' and a <code>nonce</code>' : '') + '. It keeps them in your session.' + (opts.pkce ? ' Only a hash of the verifier leaves the client now.' : '') },
      { n: 2, channel: 'front', from: 'Client app', to: 'Authorization server', title: 'Redirect to the authorization endpoint', http: 'HTTP/1.1 302 Found\nLocation: ' + D.authz + '?' + q(auth),
        note: 'Everything here travels in the browser\'s address bar, so anyone watching the browser can see it. That is why nothing secret may be in it: the <code>code_challenge</code> is a hash.' },
      { n: 3, channel: 'user', from: 'You', to: 'Authorization server', title: 'You sign in and consent', http: '(a login page and a consent screen: the client never sees this)',
        note: 'The authorization server checks your password or passkey and shows what the client asks for (<code>' + scope + '</code>). Your credentials never go to the client.' },
      { n: 4, channel: 'front', from: 'Authorization server', to: 'Client app', title: 'Redirect back with a code', http: 'HTTP/1.1 302 Found\nLocation: ' + D.redirect + '?' + q(back),
        note: 'The <code>code</code> is short-lived and single-use. It is <em>not</em> a token: on its own it opens nothing, but it passes through the browser, where it can leak.' + (opts.iss ? ' The <code>iss</code> parameter (RFC 9207) tells the client which server answered.' : '') },
      { n: 5, channel: 'browser', from: 'Browser', to: 'Client app', title: 'The client checks the callback', http: 'GET /callback?' + q(back) + ' HTTP/1.1\nHost: app.example.com',
        note: (opts.state ? 'It compares <code>state</code> with the value it stored for this browser and rejects the request if they differ.' : '<b>No <code>state</code> was sent, so there is nothing to compare.</b>') + (opts.iss ? ' It also checks <code>iss</code>.' : '') },
      { n: 6, channel: 'back', from: 'Client app', to: 'Authorization server', title: 'Exchange the code for tokens', http: 'POST /token HTTP/1.1\nHost: login.example.com\nContent-Type: application/x-www-form-urlencoded\n\n' + q(tokenReq),
        note: 'This request goes straight from the client to the server, over TLS, not through the browser. ' + (opts.pkce ? 'The server hashes <code>code_verifier</code> and compares it with the <code>code_challenge</code> it stored at step 2.' : 'There is no verifier to prove the caller is the one who started the flow.') + ' A confidential client also authenticates here (a secret or a key).' },
      { n: 7, channel: 'back', from: 'Authorization server', to: 'Client app', title: 'The tokens', http: 'HTTP/1.1 200 OK\nContent-Type: application/json\nCache-Control: no-store\n\n' + JSON.stringify(resp, null, 2),
        note: (opts.oidc ? 'Because <code>openid</code> was in the scope there is also an <code>id_token</code>: proof of who signed in, for the client (step 14). ' : '') + 'The <code>access_token</code> is for the API. The <code>refresh_token</code> is for getting a new access token later (step 13).' },
      { n: 8, channel: 'api', from: 'Client app', to: 'API', title: 'Call the API', http: 'GET /todos HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer eyJhbGciOi…',
        note: 'The API checks the token as in step 10 and answers.' },
    ];
    // What each protection stops. `on` says whether the protection is present in this run.
    const attacks = [
      { id: 'code-theft', protection: 'PKCE', on: opts.pkce, name: 'A stolen authorization code',
        story: 'A malicious app on the same device, a log, or a hostile proxy gets the <code>code</code> from step 4 and sends it to the token endpoint first.',
        without: '<b>Tokens are issued to the attacker.</b> The code is all the server asked for. This is the authorization code interception attack that PKCE (RFC 7636) was written for.',
        with: 'The attacker has the code but not the <code>code_verifier</code>, which never left the client. The server answers <code>invalid_grant</code>.' },
      { id: 'login-csrf', protection: 'state', on: opts.state, name: 'A forged callback (login CSRF)',
        story: 'The attacker starts a flow with their own account, stops before the callback, and gets your browser to open the callback URL with <em>their</em> code.',
        without: '<b>The client completes the attacker\'s flow in your session.</b> It cannot tell that this browser never started it, so you end up signed in to, or linked to, the attacker\'s account.',
        with: 'The callback carries a <code>state</code> this browser never stored. The client rejects it. (RFC 9700 says PKCE can serve instead, and that the OIDC <code>nonce</code> protects against CSRF as well.)' },
      { id: 'mix-up', protection: 'iss parameter', on: opts.iss, name: 'A mix-up between two servers',
        story: 'The client supports several authorization servers, and an attacker runs one of them. The attacker tricks it into sending the real server\'s code to the attacker\'s token endpoint.',
        without: '<b>The attacker gets a code for the real server.</b> The client cannot tell which server the response came from.',
        with: 'The response names its issuer, which does not match the server the client started with. It rejects it. (RFC 9207; RFC 9700 4.4)' },
    ];
    return { opts, values: { verifier, challenge, state, nonce, code }, auth, steps, attacks, defaults: D };
  }

  // "Which grant?" (RFC 6749 section 4, RFC 8628, RFC 9700 2.1 and 2.4). answers: { hasUser, device, clientKind }
  function chooseGrant(a) {
    if (!a.hasUser) return { grant: 'client_credentials', title: 'Client credentials', why: 'No person is involved, so the client authenticates as itself (RFC 6749, 4.4). Use a key or a mutual-TLS certificate rather than a long-lived secret where you can.' };
    if (a.device === 'limited') return { grant: 'device_code', title: 'Device authorization grant', why: 'The device has no browser or no keyboard, so the user finishes on another device with a short code (RFC 8628).' };
    if (a.legacyPassword) return { grant: 'authorization_code', title: 'Authorization code with PKCE', why: 'Not the password grant: RFC 9700 says it MUST NOT be used. Move the sign-in to the authorization server and use the code flow.' };
    return { grant: 'authorization_code', title: 'Authorization code with PKCE', why: 'A person signs in through a browser. Use the code flow with PKCE for every kind of client, public or confidential (RFC 9700, 2.1.1).' };
  }

  // Judge a URL: origin and path, then required parameters. spec: { origin, path, params: { name: value | RegExp | true }, forbid: [names] }
  function judgeUrl(text, spec) {
    const problems = [];
    let u; try { u = new URL(text.trim()); } catch (e) { return { ok: false, problems: ['That is not a complete URL (it needs https:// and a host).'] }; }
    if (u.origin + u.pathname !== spec.origin + spec.path) problems.push(`The address should be <code>${spec.origin}${spec.path}</code>.`);
    for (const [k, want] of Object.entries(spec.params)) {
      const vs = u.searchParams.getAll(k);
      if (!vs.length) { problems.push(`Missing <code>${k}</code>${spec.why && spec.why[k] ? ': ' + spec.why[k] : ''}.`); continue; }
      if (vs.length > 1) problems.push(`<code>${k}</code> appears more than once.`);
      const ok = want === true || (want instanceof RegExp ? want.test(vs[0]) : vs[0] === want);
      if (!ok) problems.push(`<code>${k}=${vs[0].replace(/[<>&"]/g, '')}</code> is not right${spec.why && spec.why[k] ? ': ' + spec.why[k] : ''}.`);
    }
    for (const k of spec.forbid || []) if (u.searchParams.has(k)) problems.push(`<code>${k}</code> must not be in this request.`);
    return { ok: problems.length === 0, problems, params: Object.fromEntries(u.searchParams) };
  }
  return { build, chooseGrant, judgeUrl, defaults: D };
});
