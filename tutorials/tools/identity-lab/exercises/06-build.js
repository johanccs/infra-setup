// Exercises for steps 19 to 24 (run Keycloak, protect the API, roles and owners, BFF sign-in, Google through Keycloak,
// service calls). The facts behind every answer were observed on a real Keycloak 26.8.1, ASP.NET Core 10 and PostgreSQL 18
// by tests/identity-app.test.js.
(function () {
  var IA = window.IA, X = IA.exercises;
  var S = function (cmd, o) { return window.IACmdSpec.spec(IA.cmdFlags, cmd, o); };
  var pos = function (re, label, what, hint) { return { match: re, label: label, what: what, hint: hint }; };
  function drill(id, prompt, specs, answer, hints, after) { IA.cmds[id] = { prompt: prompt, specs: specs, answer: answer, hints: hints || [], after: after || '', run: { noRun: 'needs a running Keycloak' } }; }
  // quiz: options as [text, ok, why]
  function quiz(id, prompt, opts, hints) { X[id] = { kind: 'quiz', prompt: '<p>' + prompt + '</p>', options: opts.map(function (o) { return { t: o[0], ok: !!o[1], why: o[2] }; }), hints: hints || [] }; }
  function sort(id, prompt, groups, items, hints) { X[id] = { kind: 'sort', prompt: '<p>' + prompt + '</p>', groups: groups, items: items.map(function (i) { return { t: i[0], g: i[1], why: i[2] }; }), hints: hints || [] }; }

  var K = 'http://localhost:8180/realms/todo';
  var kurl = function (path) { return new RegExp('^' + (K + path).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '$'); };

  // ---------------- 19
  drill('a19-discovery', '<p>Fetch the <b>discovery document</b> of the realm <code>todo</code> on <code>http://localhost:8180</code>, quietly (no progress meter).</p>',
    S('curl', { what: 'make an HTTP request', need: { '--silent': { value: false, what: 'no progress meter' } }, pos: [pos(kurl('/.well-known/openid-configuration'), 'the discovery address', 'where it lives', K + '/.well-known/openid-configuration')] }),
    'curl -s ' + K + '/.well-known/openid-configuration',
    ['Every OpenID Connect issuer serves it at the issuer address plus <code>/.well-known/openid-configuration</code>.', 'Quiet is <code>-s</code>.'],
    'Read <code>jwks_uri</code>, <code>token_endpoint</code>, <code>authorization_endpoint</code> and <code>code_challenge_methods_supported</code>. A client library needs nothing else.');
  drill('a19-jwks', '<p>Fetch the realm\'s <b>signing keys</b> (the JWKS) quietly, from the address the discovery document gives as <code>jwks_uri</code>: the realm address followed by <code>/protocol/openid-connect/certs</code>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--silent': { value: false, what: 'no progress meter' } }, pos: [pos(kurl('/protocol/openid-connect/certs'), 'the JWKS address', 'where the keys are', K + '/protocol/openid-connect/certs')] }),
    'curl -s ' + K + '/protocol/openid-connect/certs',
    ['It is the realm address plus <code>/protocol/openid-connect/certs</code>.'],
    'Each key has a <code>kid</code>, an <code>alg</code> and <code>use: "sig"</code>. A token names the key it was signed with in its own <code>kid</code> header.');
  drill('a19-gettoken', '<p>Get an access token for the machine client <code>todo-reporter</code> with the client credentials grant. Send the client ID as <code>client_id</code> and the secret from the shell variable <code>$REPORTER_SECRET</code> as <code>client_secret</code>, in a form post to the realm\'s token endpoint (<code>/protocol/openid-connect/token</code>). Print nothing but the response (quiet).</p>',
    S('curl', { what: 'make an HTTP request', need: { '--silent': { value: false, what: 'no progress meter' }, '--data': { value: true, repeat: true, what: 'a form field', each: [
      { match: /^grant_type=client_credentials$/, missing: 'Add <code>-d grant_type=client_credentials</code>.' },
      { match: /^client_id=todo-reporter$/, missing: 'Add <code>-d client_id=todo-reporter</code>.' },
      { match: /^client_secret=\$\{?REPORTER_SECRET\}?$|^client_secret=/, missing: 'Add the secret as <code>-d client_secret="$REPORTER_SECRET"</code>.' }] } }, pos: [pos(kurl('/protocol/openid-connect/token'), 'the token endpoint', 'where to send it', K + '/protocol/openid-connect/token')] }),
    'curl -s -d grant_type=client_credentials -d client_id=todo-reporter -d client_secret="$REPORTER_SECRET" ' + K + '/protocol/openid-connect/token',
    ['A form field is <code>-d name=value</code>; <code>-d</code> makes <code>curl</code> send a POST.', 'You need three fields: the grant, the client ID and the secret.'],
    'The answer is JSON with <code>access_token</code>, <code>expires_in</code> (300) and <code>token_type</code>. There is no refresh token: a machine just asks again.');

  quiz('a19-realm', 'You want a new Todo API to accept tokens from Keycloak, but the API keeps answering <code>401</code> with <code>The audience \'empty\' is invalid</code> for a valid, unexpired token. What is missing?', [
    ['An audience mapper, so that <code>todo-api</code> is in the token\'s <code>aud</code> claim.', true, 'The token had no <code>aud</code> at all. The API refuses tokens that do not name it, which is correct. The fix is in the identity provider, not the API.'],
    ['Raise <code>ClockSkew</code> in the API so that slightly different clocks stop mattering for this token.', false, 'Clock skew is about <code>exp</code> and <code>nbf</code>. The message names the audience.'],
    ['Set <code>RequireHttpsMetadata = false</code> so that the handler can read the discovery document over HTTP.', false, 'That only controls whether the discovery document may be fetched over HTTP.'],
    ['The user needs the <code>todo-api</code> role.', false, 'Roles are checked after the token is accepted. This token is refused before that.']]);
  quiz('a19-token', 'The access token for the <code>todo-reporter</code> client has <code>sub</code> equal to a UUID and <code>preferred_username</code> equal to <code>service-account-todo-reporter</code>. Who is that?', [
    ['The service account user Keycloak created for the machine client. No person signed in.', true, 'Each client with service accounts enabled gets a hidden user. That is why the realm file lists it, to give it a role.'],
    ['Alice, signed in through the reporter.', false, 'Alice would have her own <code>sub</code> and <code>preferred_username</code>.'],
    ['A random user created by the discovery document.', false, 'The discovery document only describes the server. It does not create users.'],
    ['An admin who used the admin console.', false, 'Admins sign in to the <code>master</code> realm with the admin console client.']]);
  quiz('a19-issuer', 'You open the realm at <code>http://127.0.0.1:8180/realms/todo</code> to get a token and run the API with <code>Auth__Authority=http://localhost:8180/realms/todo</code>. What happens?', [
    ['The API refuses the token: its <code>iss</code> is the 127.0.0.1 address, and the API expects the localhost one.', true, 'Keycloak builds the issuer from the address the request used. The API compares it exactly, so use one name everywhere.'],
    ['It works, because 127.0.0.1 and localhost are the same machine, so the handler treats the two issuer addresses as equal.', false, 'The issuer is a string compared exactly. Machines do not matter.'],
    ['It works but logs a warning that the issuer differs from the configured authority; set the log level higher to hide it.', false, 'There is no warning mode for the issuer check.'],
    ['Keycloak refuses to issue the token.', false, 'Keycloak happily issues it, for the address you used.']]);
  X['a19-order'] = { kind: 'order', prompt: '<p>Put these in the order you do them to get a protected Todo API working with a fresh Keycloak.</p>',
    items: ['Write the realm file: roles, users, clients and mappers.', 'Start Keycloak so that it imports the realm file.', 'Fetch the discovery document and check the issuer and <code>jwks_uri</code>.', 'Get a token and check <code>iss</code>, <code>aud</code> and <code>roles</code> in it.', 'Point the API at the issuer and call it with the token.'],
    hints: ['You cannot check the token before the server runs, and you cannot point the API before you know the issuer is what you expect.'] };

  // ---------------- 20
  sort('a20-status', 'What does the API answer?', ['401', '403', '200'], [
    ['A request with no <code>Authorization</code> header to <code>/api/todos</code>.', 0, 'The fallback policy requires a signed-in caller, and there is none.'],
    ['A token whose signature was changed by one character.', 0, 'Invalid tokens are not authenticated: <code>invalid_token</code>.'],
    ['A valid token for another API (wrong audience).', 0, 'The audience check fails, so the caller is not authenticated for this API.'],
    ['A valid token for the reporter machine on <code>/api/todos</code>.', 1, 'Authenticated, but without the <code>todo-user</code> role.'],
    ['Alice\'s valid token on <code>/api/admin/todos</code>.', 1, 'Authenticated, but not an admin.'],
    ['<code>/healthz</code> with no token.', 2, 'It is marked <code>AllowAnonymous</code> so the platform can probe it.'],
    ['Alice\'s valid token on <code>/api/todos</code>.', 2, 'Authenticated and in the right role.']]);
  quiz('a20-probe', 'After you add the fallback policy, the pods keep restarting and the Deployment never becomes ready. <code>kubectl describe</code> shows the probes failing with <code>401</code>. What is the fix?', [
    ['Mark <code>/healthz</code> and <code>/readyz</code> as <code>AllowAnonymous</code>.', true, 'Kubernetes probes do not carry tokens. Health endpoints must be open, and they must reveal nothing sensitive.'],
    ['Remove the fallback policy.', false, 'That reopens every endpoint you forget to protect.'],
    ['Give the probes a bearer token in the Deployment.', false, 'A token expires, and a probe with a static one fails an hour later. Open the health endpoint instead.'],
    ['Raise <code>initialDelaySeconds</code>.', false, 'The probe fails every time, not only early on.']]);
  quiz('a20-skew', 'Access tokens live five minutes. You leave <code>ClockSkew</code> at its default. How long after <code>exp</code> does the API still accept a token?', [
    ['Five more minutes.', true, 'The default <code>ClockSkew</code> is five minutes. The token\'s real life is up to ten minutes. This was observed: a five-second token was still accepted well after expiry until the skew was set to 30 seconds.'],
    ['Not at all: <code>exp</code> is exact.', false, 'The handler adds the skew to allow for clock drift between servers.'],
    ['Thirty seconds.', false, 'That is the value this lesson sets, not the default.'],
    ['Until the next key rotation.', false, 'Keys have nothing to do with expiry.']]);
  quiz('a20-claims', 'With <code>MapInboundClaims = false</code>, which line reads the user\'s id?', [
    ['<code>user.FindFirstValue("sub")</code>', true, 'The claim keeps its name from the token.'],
    ['<code>user.FindFirstValue(ClaimTypes.NameIdentifier)</code>', false, 'That is the long URI the default mapping would have produced. With mapping off, it finds nothing.'],
    ['<code>user.Identity.Name</code>', false, 'That is the name claim you configured (<code>preferred_username</code>), a display name, not the id.'],
    ['<code>user.FindFirstValue("id")</code>', false, 'There is no <code>id</code> claim in a Keycloak token.']]);
  quiz('a20-log', 'The API returns <code>WWW-Authenticate: Bearer error="invalid_token", error_description="The signature is invalid"</code>. Where is it safe to show the description?', [
    ['In your development console and logs. A stranger should only see a plain 401.', true, 'The description tells an attacker which check failed, and so what to try next.'],
    ['In the response to anyone who calls, because a clear message helps honest client developers find their mistake quickly.', false, 'Helpful to attackers too.'],
    ['Nowhere: always send a bare <code>Bearer</code> header, even in development, so that behavior never differs.', false, 'The RFC defines <code>error</code> for clients, and it is useful in development. Control exposure, do not remove the mechanism.'],
    ['In the page of your Angular app.', false, 'It is for developers, not for users.']]);

  // ---------------- 21
  sort('a21-table', 'Alice and Bob are users, Bob is also an admin. Todo 2 belongs to Bob. What does each call answer?', ['200 or 204', '403', '404'], [
    ['Alice toggles todo 2.', 2, 'The query includes the owner, so Bob\'s todo is not found for her.'],
    ['Bob toggles todo 2.', 0, 'It is his.'],
    ['Alice calls <code>GET /api/admin/todos</code>.', 1, 'Signed in, but without <code>todo-admin</code>.'],
    ['Bob calls <code>GET /api/admin/todos</code>.', 0, 'He holds <code>todo-admin</code>.'],
    ['Bob (admin) deletes Alice\'s todo 1.', 2, 'Admin opens the admin <em>read</em> route. It does not remove the owner filter from delete.'],
    ['The reporter calls <code>GET /api/admin/stats</code>.', 0, 'The <code>Statistics</code> policy accepts <code>todo-reporter</code>.'],
    ['The reporter calls <code>GET /api/todos</code>.', 1, 'It does not have <code>todo-user</code>.']]);
  quiz('a21-owner', 'A teammate writes <code>todos.MapDelete("/{id:int}", async (int id, TodoStore s) => await s.RemoveAsync(id) ? Results.NoContent() : Results.NotFound())</code> after you added owners. The tests for the rest pass. What is wrong?', [
    ['Any signed-in user can delete anyone\'s todo by id: the owner is never checked.', true, 'The code compiles without the owner, which is why the table of cases must be a test, not a document.'],
    ['It returns 204 for a todo that does not exist, which leaks which ids are taken to every caller.', false, 'It returns 404 for that.'],
    ['It is missing <code>AllowAnonymous</code>.', false, 'That would open it, not close it.'],
    ['Nothing: the group policy <code>TodoUser</code> checks that the caller owns the todo before the handler runs.', false, 'A role policy checks the role. Only the query can check the owner.']]);
  quiz('a21-role', 'Bob\'s admin role is removed in Keycloak at 10:00. His token was issued at 09:57 and lives five minutes. When does <code>/api/admin/todos</code> start refusing him?', [
    ['At about 10:02, when that token expires and his next token has no admin role.', true, 'The API trusts what is in the token. It does not call Keycloak per request, so a role change takes effect when a new token is issued.'],
    ['At once, at 10:00.', false, 'The API has no way to know unless it asks Keycloak each time.'],
    ['At 10:05.', false, 'The token was issued at 09:57 and expires at 10:02.'],
    ['Never, until the API restarts.', false, 'Tokens expire, and keys are cached, not roles.']]);
  quiz('a21-admin', 'Should <code>todo-admin</code> be allowed to toggle and delete other people\'s todos, so support can help?', [
    ['No. Give it the read route, and add an explicit, audited support action if the job needs it.', true, 'Least privilege: a role should open what its job needs. "Admin can do everything" is how a stolen admin token becomes a total loss.'],
    ['Yes. Admin means everything, and a support person who cannot fix a customer\'s list is not an admin.', false, '"Everything" is rarely the job, and it makes every admin token a master key.'],
    ['Yes, but only during working hours, so that a stolen token is useless at night when nobody is watching.', false, 'A time rule does not narrow what is possible when it is allowed.'],
    ['Yes, because the owner check is only a UI feature.', false, 'The owner check is in the query on the server.']]);

  // ---------------- 22
  sort('a22-patterns', 'Which browser pattern does each statement describe?', ['BFF', 'Token-mediating backend', 'Browser-based OAuth client'], [
    ['The browser holds only an HttpOnly session cookie. No token ever reaches the page.', 0, 'RFC 10017 pattern 1.'],
    ['The server keeps the refresh token; the browser asks it for short-lived access tokens and calls other APIs directly.', 1, 'RFC 10017 pattern 2. XSS can steal the access token but not the refresh token.'],
    ['The Angular app runs the code flow itself and keeps tokens in memory.', 2, 'RFC 10017 pattern 3: the app is the OAuth client.'],
    ['An injected script cannot read anything that lets it work from another machine.', 0, 'There is nothing to carry away; it can still act while the page is open.'],
    ['Stolen refresh tokens work from anywhere until they are rotated or revoked.', 2, 'That is the cost of keeping them in the browser.']]);
  quiz('a22-xss', 'A script injected into the Todo page runs <code>fetch("/api/todos")</code> in the BFF setup and sends the answer to an attacker. Is the BFF broken?', [
    ['No, but it shows the BFF does not prevent XSS: it only keeps tokens and the cookie value out of reach. Fix the injection too.', true, 'The browser still sends the cookie with a same-site fetch. The attacker cannot use it from their own machine, only while the page is open.'],
    ['Yes: the cookie is HttpOnly, so this should be impossible.', false, 'HttpOnly stops <em>reading</em> the cookie, not using it.'],
    ['No: SameSite=Strict blocks it.', false, 'The request is same-site, so Strict allows it.'],
    ['Yes: tokens are in the page.', false, 'There are none.']]);
  quiz('a22-csrf', 'A page on <code>evil.example</code> contains a form that posts to <code>http://localhost:4200/api/todos</code>. With the BFF, which defenses stop it?', [
    ['SameSite=Strict (the cookie is not sent from another site) and the missing <code>X-Todo-Csrf</code> header (a form cannot set it).', true, 'Two independent layers. Observed: a forged form post added nothing to the list.'],
    ['Only HttpOnly: the cookie cannot be read by the other site\'s script, so the post is harmless.', false, 'HttpOnly does not stop the browser from sending the cookie.'],
    ['Only the audience check on the API, which makes sure the request was meant for this service.', false, 'That is for bearer tokens, not cookies.'],
    ['Nothing: forms cannot be stopped.', false, 'They can, and this is how.']]);
  quiz('a22-login', 'A developer replaces the sign-in link with <code>fetch("/api/auth/login")</code> to avoid a page reload. Sign-in stops working. Why?', [
    ['The response is a redirect to another origin, which script cannot follow like a navigation. The browser has to navigate.', true, 'Keycloak\'s login page is for a person in a browser window, not for <code>fetch</code>.'],
    ['<code>fetch</code> never sends cookies to an API, so the session cannot be established from script at all.', false, 'It can, on same-origin requests.'],
    ['The API only allows GET requests from a browser, and the login endpoint is not a GET in the generated code.', false, 'Method is not the problem.'],
    ['Angular blocks it.', false, 'Angular does not.']]);
  quiz('a22-cookie', 'Which cookie options are right for the BFF session cookie?', [
    ['<code>__Host-</code> prefix, HttpOnly, Secure, SameSite=Strict, Path=/.', true, 'Each one closes something: sibling sub-domains, script reading, plain HTTP, cross-site sending.'],
    ['Any name, SameSite=None so that Keycloak\'s redirect can set it.', false, '<code>None</code> sends it everywhere. The cookie can be <em>set</em> by a response to a cross-site navigation under Strict.'],
    ['Not HttpOnly, so the Angular app can read the user name from it.', false, 'That is what <code>/api/auth/me</code> is for.'],
    ['A long <code>Domain</code> attribute so every sub-domain shares it.', false, '<code>__Host-</code> forbids <code>Domain</code>, on purpose.']]);

  // ---------------- 23
  X['a23-order'] = { kind: 'order', prompt: '<p>Put these in the order they happen when a person clicks "Google" on Keycloak\'s login page.</p>',
    items: ['The browser is redirected to <code>accounts.google.com</code> by Keycloak, with Keycloak\'s own client ID.', 'The person signs in and consents at Google.', 'Google redirects the browser to Keycloak\'s <code>/broker/google/endpoint</code> with a code.', 'Keycloak redeems the code, reads the Google ID token and finds or creates a local user.', 'Keycloak redirects the browser to the Todo app\'s callback with a code <em>of its own</em>.'],
    hints: ['Keycloak is both an OAuth server (to the app) and an OAuth client (to Google).'] };
  quiz('a23-link', 'Another identity provider you added does not verify email addresses. A person registers there with <code>bob@example.test</code> and signs in. Automatic account linking by email is on. What can happen?', [
    ['They are linked to Bob\'s real account and become him, including his <code>todo-admin</code> role.', true, 'Linking by an unverified email is account takeover. Link only on verified addresses, and ask for a password first.'],
    ['Nothing: emails are unique.', false, 'Uniqueness in Keycloak does not mean the other provider checked the address.'],
    ['Keycloak refuses because the realm is closed.', false, 'It is not closed to that provider.'],
    ['They get a new empty account.', false, 'Automatic linking is what changes that outcome.']]);
  quiz('a23-role', 'A new person signs in with Google for the first time. Which role does the Todo API see in their token?', [
    ['Only what Keycloak gives a new user: no <code>todo-user</code> unless you set a default role or a mapper.', true, 'The role is Keycloak\'s decision. The person arrives with an identity, not with permissions.'],
    ['The roles Google says they have.', false, 'Google has no idea about <code>todo-user</code>.'],
    ['<code>todo-admin</code>, because the first person to sign in to an empty realm becomes its administrator.', false, 'Nothing is granted by order of arrival.'],
    ['Whatever the email domain suggests, because Keycloak maps a company domain to a role automatically for every provider.', false, 'Only if you write a rule for it, and then only on a verified address.']]);

  // ---------------- 24
  drill('a24-token', '<p>Get a token for the machine client <code>todo-reporter</code> with client credentials, as in step 19, but authenticate with <b>HTTP basic authentication</b> (<code>-u</code>, secret in <code>$REPORTER_SECRET</code>) instead of putting the secret in the form body.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--silent': { value: false, what: 'no progress meter' }, '--user': { value: /^todo-reporter:/, what: 'authenticate as the client with HTTP basic', bad: function () { return 'Authenticate as <code>todo-reporter</code>: <code>-u todo-reporter:"$REPORTER_SECRET"</code>.'; } }, '--data': { value: /^grant_type=client_credentials$/, what: 'the grant', missing: 'Add <code>-d grant_type=client_credentials</code>.' } }, pos: [pos(kurl('/protocol/openid-connect/token'), 'the token endpoint', 'where to send it', K + '/protocol/openid-connect/token')] }),
    'curl -s -u todo-reporter:"$REPORTER_SECRET" -d grant_type=client_credentials ' + K + '/protocol/openid-connect/token',
    ['<code>-u name:password</code> sends HTTP basic authentication.'], 'Keycloak accepts the client\'s credentials either way. Basic is the form the OAuth specification defines first (RFC 6749 section 2.3.1).');
  quiz('a24-cache', 'A reporting job calls the API 10,000 times an hour and fetches a new token before every call. The tokens live five minutes. What is wrong?', [
    ['It makes 10,000 token requests an hour for no reason, loading Keycloak. Cache the token until shortly before it expires: about 12 requests an hour.', true, 'The token request is the expensive, rate-limited, audited step. The call itself is cheap.'],
    ['Nothing: fresh tokens are safer.', false, 'A cached token is just as valid until <code>exp</code>, and is not exposed to anyone more often.'],
    ['It should use a refresh token.', false, 'Client credentials issues none, and does not need one.'],
    ['It should ask for tokens that never expire.', false, 'That makes a leak permanent.']]);
  sort('a24-secret', 'Where may the reporter\'s client secret live?', ['Acceptable', 'Never'], [
    ['A Kubernetes Secret mounted as an environment variable, created outside the repository.', 0, 'Not perfect, but out of the source.'],
    ['In <code>appsettings.json</code> committed to the repository.', 1, 'Anyone with the repository, now or in its history, has it.'],
    ['An environment variable set by your secret store at start-up.', 0, 'Out of the source and rotatable.'],
    ['In the command: <code>-d client_secret=abc123</code> typed in a shell.', 1, 'It lands in the shell history and the process list.'],
    ['In a front-end bundle, so the browser can ask for tokens.', 1, 'A confidential client\'s secret is useless in the one place everyone can read.']]);
  quiz('a24-role', 'The reporter needs the daily numbers. Which setup is least privilege?', [
    ['Its own client with only <code>todo-reporter</code>, which the <code>Statistics</code> policy accepts and the todos policy does not.', true, 'One client per service, one role per job. A leak of this secret reads numbers and nothing more.'],
    ['Reuse <code>todo-web</code>\'s client and secret.', false, 'Then a leak of one is a leak of both, and the logs cannot tell them apart.'],
    ['Make it <code>todo-admin</code> so that it never gets a 403 and nobody has to maintain a separate role for it.', false, 'It then reads everyone\'s todos too.'],
    ['Let it use a dedicated user account with a long random password, signed in through the browser flow each day.', false, 'A person\'s credentials are not a service identity.']]);
})();
