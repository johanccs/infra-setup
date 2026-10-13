// Exercises and drills for steps 11 to 15 (OAuth 2.0, the code flow, other grants, OpenID Connect, Google).
(function () {
  var IA = window.IA, X = IA.exercises;
  IA.cmds = IA.cmds || {}; IA.urls = IA.urls || {};
  var S = function (cmd, o) { return window.IACmdSpec.spec(IA.cmdFlags, cmd, o); };
  var pos = function (re, label, what, hint) { return { match: re, label: label, what: what, hint: hint }; };
  var tokenUrl = /^https:\/\/login\.example\.com\/token$/;
  function drill(id, prompt, specs, answer, hints, after) { IA.cmds[id] = { prompt: prompt, specs: specs, answer: answer, hints: hints || [], after: after || '', run: { noRun: 'needs an authorization server' } }; }
  var form = function (re, missing) { return { match: re, missing: missing }; };

  // ---- 11
  X['o11-roles'] = { kind: 'sort', prompt: '<p>Name the OAuth role of each.</p>',
    groups: ['Resource owner', 'Client', 'Authorization server', 'Resource server'],
    items: [
      { t: 'Alice, who owns the todos.', g: 0, why: 'The entity able to grant access to the resource.' },
      { t: 'The Angular app that wants to read Alice\'s todos.', g: 1, why: 'The application making requests on the owner\'s behalf.' },
      { t: 'Keycloak, which signs Alice in and issues tokens.', g: 2, why: 'It issues access tokens after authenticating the owner.' },
      { t: 'The Todo API, which holds the todos.', g: 3, why: 'It hosts the protected resources and accepts access tokens.' },
      { t: 'A photo-printing website that you let read your photos at a photo-sharing site.', g: 1, why: 'The printing site is the client, acting for you.' },
      { t: 'Google, when an app offers "Log in with Google".', g: 2, why: 'Google authenticates the user and issues the tokens.' },
    ] };
  X['o11-channel'] = { kind: 'sort', prompt: '<p>Which channel does each message use?</p>',
    groups: ['Front channel (through the browser)', 'Back channel (server to server)'],
    items: [
      { t: 'The redirect to the authorization endpoint.', g: 0, why: 'A redirect travels through the user\'s browser.' },
      { t: 'The <code>code</code> in <code>?code=…</code> in the address bar.', g: 0, why: 'It is in the browser\'s address.' },
      { t: 'The POST that exchanges the code for tokens.', g: 1, why: 'It goes directly from the client\'s server to the token endpoint.' },
      { t: 'The JSON containing the access token.', g: 1, why: 'Tokens come back on the direct response, never through the browser.' },
      { t: 'The consent screen.', g: 0, why: 'The user sees it in their browser.' },
    ] };
  X['o11-login'] = { kind: 'quiz', prompt: '<p>An app receives an OAuth access token for Alice\'s calendar. Does that, by itself, tell the app <b>who Alice is</b>?</p>',
    options: [
      { t: 'Yes: the token was issued for Alice, so it identifies her.', ok: false, why: 'A token says what may be done. OAuth defines no way to read an identity from it.' },
      { t: 'No. OAuth is about permission. OpenID Connect adds an ID token for identity.', ok: true, why: 'This is why "log in with" is built on OpenID Connect and not on bare OAuth.' },
      { t: 'Yes, if the token is a JWT.', ok: false, why: 'A JWT access token has claims, but what they mean is up to the API. It is not a sign-in.' },
    ] };

  // ---- 12
  IA.urls['o12-authz'] = { prompt: '<p>Build the authorization request. The client is <code>todo-web</code>, its registered redirect URI is <code>https://app.example.com/callback</code>, and the authorization endpoint is <code>https://login.example.com/authorize</code>. Ask for the scopes <code>openid todos.read</code> with the <b>code</b> flow. Use <code>state</code> <code>xyz789</code> and the PKCE challenge <code>E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM</code> with the S256 method. Write it as one URL (spaces become <code>%20</code>).</p>',
    spec: { origin: 'https://login.example.com', path: '/authorize', params: { response_type: 'code', client_id: 'todo-web', redirect_uri: 'https://app.example.com/callback', scope: /^(openid todos\.read|todos\.read openid)$/, state: 'xyz789', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256' },
      why: { response_type: 'the authorization code flow', redirect_uri: 'the registered one, exactly', scope: 'both scopes, space separated', code_challenge_method: 'S256, not plain' }, forbid: ['code_verifier', 'client_secret'] },
    answer: 'https://login.example.com/authorize?response_type=code&client_id=todo-web&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&scope=openid%20todos.read&state=xyz789&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256',
    hints: ['The query parameters are <code>response_type</code>, <code>client_id</code>, <code>redirect_uri</code>, <code>scope</code>, <code>state</code>, <code>code_challenge</code> and <code>code_challenge_method</code>.', 'Never put the <code>code_verifier</code> or a secret in this address: it is in the front channel.'],
    after: 'Notice what is not here: the verifier and any secret. Only the hash of the verifier is in the front channel.' };
  drill('o12-token', '<p>Exchange the code at <code>https://login.example.com/token</code> with <code>curl</code>. Send, form-encoded with <code>-d</code>: <code>grant_type=authorization_code</code>, <code>code=SplxlOBeZQQYbYS6WxSbIA</code>, the same <code>redirect_uri=https://app.example.com/callback</code>, <code>client_id=todo-web</code>, and your <code>code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk</code>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--data': { value: true, repeat: true, what: 'a form field', each: [
      form(/^grant_type=authorization_code$/, 'Add <code>-d grant_type=authorization_code</code>.'), form(/^code=SplxlOBeZQQYbYS6WxSbIA$/, 'Add the code: <code>-d code=SplxlOBeZQQYbYS6WxSbIA</code>.'),
      form(/^redirect_uri=https:\/\/app\.example\.com\/callback$/, 'Send the same <code>redirect_uri</code> as in the first request.'), form(/^client_id=todo-web$/, 'Add <code>-d client_id=todo-web</code>.'),
      form(/^code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk$/, 'Add the PKCE verifier: <code>-d code_verifier=…</code>.')] } }, pos: [pos(tokenUrl, 'the token endpoint', 'where to send it', 'https://login.example.com/token')] }),
    'curl -d grant_type=authorization_code -d code=SplxlOBeZQQYbYS6WxSbIA -d redirect_uri=https://app.example.com/callback -d client_id=todo-web -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk https://login.example.com/token',
    ['Each field is one <code>-d name=value</code>. <code>curl</code> sends them form-encoded as a POST.'], 'The server hashes <code>code_verifier</code> and compares it with the <code>code_challenge</code> from the first request. A mismatch is <code>invalid_grant</code>.');
  X['o12-order'] = { kind: 'order', prompt: '<p>Put the authorization code flow in order.</p>',
    items: ['The client makes <code>state</code> and a <code>code_verifier</code>, and redirects the user to the authorization endpoint with the <code>code_challenge</code>.', 'The user signs in and consents at the authorization server.', 'The authorization server redirects back to the client with <code>code</code> and <code>state</code>.', 'The client checks that <code>state</code> matches the one it stored.', 'The client posts the code and the <code>code_verifier</code> to the token endpoint.', 'The authorization server returns the access token (and ID and refresh tokens).', 'The client calls the API with <code>Authorization: Bearer</code>.'] };
  X['o12-protect'] = { kind: 'sort', prompt: '<p>Which protection stops each attack?</p>',
    groups: ['PKCE', '<code>state</code>', 'Exact <code>redirect_uri</code> matching', '<code>iss</code> in the response'],
    items: [
      { t: 'A malicious app on the phone exchanges a code it intercepted.', g: 0, why: 'It lacks the code verifier.' },
      { t: 'An attacker makes your browser complete a flow the attacker started.', g: 1, why: 'The callback carries a state this browser never stored.' },
      { t: 'The code is sent to <code>https://app.example.com.evil.test/callback</code>.', g: 2, why: 'That is not the registered string.' },
      { t: 'A client of two authorization servers is tricked into sending a code to the wrong one.', g: 3, why: 'The response names the server it came from, and it does not match.' },
    ] };
  X['o12-redirect'] = { kind: 'quiz', multi: true, prompt: '<p>The registered redirect URI is <code>https://app.example.com/callback</code>. With <b>exact string matching</b>, which of these requests does the authorization server accept? Tick all that apply.</p>',
    options: [
      { t: '<code>https://app.example.com/callback</code>', ok: true, why: 'An exact match.' },
      { t: '<code>https://app.example.com/callback/</code>', ok: false, why: 'A trailing slash makes it a different string.' },
      { t: '<code>https://app.example.com/callback?next=/admin</code>', ok: false, why: 'Extra query parameters are not an exact match.' },
      { t: '<code>https://evil.app.example.com/callback</code>', ok: false, why: 'A different host.' },
      { t: '<code>http://app.example.com/callback</code>', ok: false, why: 'A different scheme. Plain http is not allowed for a web client at all.' },
    ] };

  // ---- 13
  drill('o13-cc', '<p>Get a token for the service <code>todo-reporter</code> with the <b>client credentials</b> grant. Authenticate with HTTP basic authentication as <code>todo-reporter</code> (<code>-u</code>, with the secret in the shell variable <code>$REPORTER_SECRET</code>), ask for the scope <code>todos.stats</code>, and post to <code>https://login.example.com/token</code>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--user': { value: /^todo-reporter:/, what: 'authenticate as the client with HTTP basic', bad: function () { return 'Authenticate as <code>todo-reporter</code>: <code>-u todo-reporter:"$REPORTER_SECRET"</code>.'; } }, '--data': { value: true, repeat: true, what: 'a form field', each: [form(/^grant_type=client_credentials$/, 'Add <code>-d grant_type=client_credentials</code>.'), form(/^scope=todos\.stats$/, 'Add <code>-d scope=todos.stats</code>.')] } }, pos: [pos(tokenUrl, 'the token endpoint', 'where to send it')] }),
    'curl -u todo-reporter:"$REPORTER_SECRET" -d grant_type=client_credentials -d scope=todos.stats https://login.example.com/token',
    ['<code>-u name:password</code> sends HTTP basic authentication.', 'The grant is a form field: <code>-d grant_type=client_credentials</code>.'], 'Do not type the secret into the command: it would land in your shell history. A variable, a file or a secret store keeps it out.');
  drill('o13-refresh', '<p>Use the refresh token in <code>$REFRESH</code> to get a new access token for the client <code>todo-web</code> at <code>https://login.example.com/token</code>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--data': { value: true, repeat: true, what: 'a form field', each: [form(/^grant_type=refresh_token$/, 'Add <code>-d grant_type=refresh_token</code>.'), form(/^refresh_token=\$REFRESH$|^refresh_token=.+/, 'Send the refresh token: <code>-d refresh_token="$REFRESH"</code>.'), form(/^client_id=todo-web$/, 'Add <code>-d client_id=todo-web</code>.')] } }, pos: [pos(tokenUrl, 'the token endpoint', 'where to send it')] }),
    'curl -d grant_type=refresh_token -d refresh_token="$REFRESH" -d client_id=todo-web https://login.example.com/token',
    ['The grant type for this is <code>refresh_token</code>, and the token goes in a field of the same name.'], 'If the server rotates refresh tokens the response contains a <b>new</b> refresh token. Store it and drop the old one at once.');
  X['o13-choose'] = { kind: 'sort', prompt: '<p>Which grant does each caller use?</p>',
    groups: ['Authorization code with PKCE', 'Client credentials', 'Device authorization'],
    items: [
      { t: 'A nightly report job that reads the Todo API with its own identity.', g: 1, why: 'No user: the program acts for itself.' },
      { t: 'An Angular app where a person signs in.', g: 0, why: 'A person in a browser: code with PKCE (through the BFF, step 22).' },
      { t: 'A smart TV app asking you to sign in from your phone.', g: 2, why: 'No keyboard or browser: the device flow.' },
      { t: 'A command-line tool run on a headless server.', g: 2, why: 'There is no browser on the box. The user approves on another device.' },
      { t: 'A mobile app with a sign-in button.', g: 0, why: 'A person with a browser: code with PKCE, as a public client.' },
      { t: 'One microservice calling another with its own service account.', g: 1, why: 'No person involved.' },
    ] };
  X['o13-implicit'] = { kind: 'quiz', prompt: '<p>A review finds a single-page app that signs in with <code>response_type=token</code> (the implicit grant). What does RFC 9700 recommend?</p>',
    options: [
      { t: 'Keep it, but shorten the token lifetime.', ok: false, why: 'The token still appears in the address bar, history and logs.' },
      { t: 'Move to the authorization code grant with PKCE, so that access tokens are not issued in the authorization response.', ok: true, why: 'RFC 9700 2.1.2: clients SHOULD NOT use the implicit grant.' },
      { t: 'Switch to the password grant, which is more direct.', ok: false, why: 'The password grant MUST NOT be used (RFC 9700 2.4).' },
    ] };
  X['o13-device'] = { kind: 'order', prompt: '<p>Put the device flow in order.</p>',
    items: ['The device asks the device authorization endpoint for a device code.', 'The device shows the short user code and the address.', 'The user opens the address on a phone, enters the code, signs in and approves.', 'Meanwhile the device polls the token endpoint with the device code.', 'The token endpoint answers <code>authorization_pending</code> until the user approves, then returns tokens.'] };

  // ---- 14
  X['o14-discovery'] = { kind: 'inspect', prompt: '<p>A provider\'s discovery document (shortened). Answer from it.</p>',
    artifact: '{\n  "issuer": "https://login.lab.test/realms/todo",\n  "authorization_endpoint": "https://login.lab.test/realms/todo/protocol/openid-connect/auth",\n  "token_endpoint": "https://login.lab.test/realms/todo/protocol/openid-connect/token",\n  "userinfo_endpoint": "https://login.lab.test/realms/todo/protocol/openid-connect/userinfo",\n  "end_session_endpoint": "https://login.lab.test/realms/todo/protocol/openid-connect/logout",\n  "jwks_uri": "https://login.lab.test/realms/todo/protocol/openid-connect/certs",\n  "id_token_signing_alg_values_supported": ["RS256", "ES256"],\n  "code_challenge_methods_supported": ["S256"],\n  "response_types_supported": ["code", "id_token"]\n}',
    parts: [
      { kind: 'quiz', prompt: 'Where do you send the user to sign in?', options: [{ t: 'The <code>authorization_endpoint</code>.', ok: true, why: 'The front-channel redirect goes there.' }, { t: 'The <code>token_endpoint</code>.', ok: false, why: 'That is the back-channel endpoint where the code is exchanged.' }, { t: 'The <code>jwks_uri</code>.', ok: false, why: 'That publishes keys.' }] },
      { kind: 'quiz', prompt: 'Where does an API get the keys to verify the signature?', options: [{ t: 'The <code>jwks_uri</code>.', ok: true, why: 'It holds the provider\'s public keys.' }, { t: 'The <code>userinfo_endpoint</code>.', ok: false, why: 'That returns claims about a user.' }] },
      { kind: 'quiz', prompt: 'Which PKCE method may you use here?', options: [{ t: 'Only <code>S256</code>.', ok: true, why: 'It is the only one in <code>code_challenge_methods_supported</code>.' }, { t: '<code>plain</code> and <code>S256</code>.', ok: false, why: 'The list has only S256.' }] },
      { kind: 'quiz', prompt: 'What must the <code>iss</code> of every ID token equal?', options: [{ t: 'The <code>issuer</code> value: <code>https://login.lab.test/realms/todo</code>, exactly.', ok: true, why: 'OIDC Core 3.1.3.7: the issuer identifier must exactly match the <code>iss</code> claim.' }, { t: 'The host of the token endpoint.', ok: false, why: 'The comparison is with the <code>issuer</code> string, not a host.' }] },
    ] };
  X['o14-validate'] = { kind: 'sort', prompt: '<p>Your client is <code>todo-web</code>. It sent <code>nonce=n-4821</code> and expects the issuer <code>https://login.lab.test</code>. Should it <b>accept</b> each ID token?</p>',
    groups: ['Accept', 'Reject'],
    items: [
      { t: 'iss <code>https://login.lab.test</code>, aud <code>todo-web</code>, not expired, nonce <code>n-4821</code>, signature valid with the provider\'s key.', g: 0, why: 'Everything checks out.' },
      { t: 'Everything is right, but <code>aud</code> is only <code>reports-web</code>.', g: 1, why: 'The token was issued for another client.' },
      { t: 'Everything is right, but <code>nonce</code> is <code>n-9000</code>.', g: 1, why: 'It does not match what this client sent: possibly a replayed token.' },
      { t: 'Everything is right, but <code>exp</code> was an hour ago.', g: 1, why: 'The time must be before <code>exp</code>.' },
      { t: 'iss is <code>https://login.lab.test.evil.example</code>.', g: 1, why: 'The issuer must match exactly, not just start the same.' },
      { t: 'The header says <code>alg: none</code>.', g: 1, why: 'An unsigned token is not acceptable when the client expects signed ones.' },
      { t: 'The ID token came straight from the token endpoint, over TLS, in the response to your own code exchange, and every claim checks out (the signature was not separately verified).', g: 0, why: 'OpenID Connect Core allows the TLS server validation to stand in for the signature check in this one case.' },
    ] };
  X['o14-which'] = { kind: 'sort', prompt: '<p>Which token do you use?</p>',
    groups: ['ID token', 'Access token', 'Refresh token'],
    items: [
      { t: 'Put it in <code>Authorization: Bearer …</code> on a call to the Todo API.', g: 1, why: 'It is the token for the resource server.' },
      { t: 'Find out which user just signed in, to show their name.', g: 0, why: 'The ID token is the proof of authentication, for the client.' },
      { t: 'Send it to the token endpoint to get a new access token.', g: 2, why: 'Only the authorization server ever sees it.' },
      { t: 'Check <code>nonce</code> and <code>aud</code> against what this client sent.', g: 0, why: 'ID token validation.' },
    ] };
  X['o14-key'] = { kind: 'quiz', prompt: '<p>What should the Todo app use to recognize a returning user from an ID token?</p>',
    options: [
      { t: 'The <code>email</code> claim: it is easy to read and unique.', ok: false, why: 'Emails change and may be reassigned. Google says plainly not to use it as the identifier.' },
      { t: 'The pair <code>iss</code> and <code>sub</code>.', ok: true, why: '<code>sub</code> is unique and never reassigned within an issuer, so the pair is a stable key.' },
      { t: 'The <code>name</code> claim.', ok: false, why: 'Names are not unique.' },
    ] };

  // ---- 15
  X['o15-claims'] = { kind: 'inspect', prompt: '<p>A decoded Google ID token payload (made-up values). Answer from it.</p>',
    artifact: '{\n  "iss": "https://accounts.google.com",\n  "azp": "123456789012-abc.apps.googleusercontent.com",\n  "aud": "123456789012-abc.apps.googleusercontent.com",\n  "sub": "110169484474386276334",\n  "hd": "example.com",\n  "email": "alice@example.com",\n  "email_verified": true,\n  "nonce": "n-4821",\n  "iat": 1791890400,\n  "exp": 1791894000\n}',
    parts: [
      { kind: 'quiz', prompt: 'What identifies this user, for good?', options: [{ t: '<code>iss</code> with <code>sub</code>.', ok: true, why: 'Stable and never reassigned.' }, { t: '<code>email</code>.', ok: false, why: 'It can change.' }] },
      { kind: 'quiz', prompt: 'Which value must equal the one you generated before sending the user to Google?', options: [{ t: '<code>nonce</code>.', ok: true, why: 'It ties this ID token to your request.' }, { t: '<code>azp</code>.', ok: false, why: 'That is your client ID, not a per-request value.' }] },
      { kind: 'quiz', prompt: 'Your app is only for people at <code>example.com</code>. What do you check on the server?', options: [{ t: 'The <code>hd</code> claim in the verified ID token (and <code>email_verified</code> if you use the email).', ok: true, why: 'Checked on your server, from a token whose signature you verified.' }, { t: 'That you added <code>hd=example.com</code> to the sign-in request.', ok: false, why: 'The request parameter is only a hint for the login screen and can be changed by the client.' }] },
    ] };
  X['o15-store'] = { kind: 'quiz', prompt: '<p>Alice changes her Google email address from <code>alice@old.example</code> to <code>alice@new.example</code>. Your app keyed users by email. What happens?</p>',
    options: [
      { t: 'Nothing: Google keeps the old email in the token.', ok: false, why: 'The email claim shows the current address.' },
      { t: 'She appears as a new user and loses her data, or worse, another person who later gets the old address is treated as her.', ok: true, why: 'This is exactly why Google says to use <code>sub</code>.' },
      { t: 'Her <code>sub</code> changes too, so it is the same problem.', ok: false, why: '<code>sub</code> stays the same for a Google Account.' },
    ] };
  X['o15-hd'] = { kind: 'quiz', prompt: '<p>You add <code>hd=example.com</code> to the authorization request, so that the Google account chooser only offers company accounts. Is that enough to keep other people out?</p>',
    options: [
      { t: 'Yes, Google refuses other domains.', ok: false, why: 'It is a user interface optimization, and request parameters can be edited by the client.' },
      { t: 'No. Check the <code>hd</code> claim of the verified ID token on your server.', ok: true, why: 'Google: do not rely on this optimization to control access.' },
    ] };
})();
