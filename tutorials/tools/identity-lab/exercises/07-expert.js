// Exercises for steps 25 to 31 (MFA and passkeys, hardening, the capstone review and troubleshooting).
(function () {
  var IA = window.IA, X = IA.exercises;
  function quiz(id, prompt, opts, hints, multi) { X[id] = { kind: 'quiz', multi: !!multi, prompt: '<p>' + prompt + '</p>', options: opts.map(function (o) { return { t: o[0], ok: !!o[1], why: o[2] }; }), hints: hints || [] }; }
  function sort(id, prompt, groups, items, hints) { X[id] = { kind: 'sort', prompt: '<p>' + prompt + '</p>', groups: groups, items: items.map(function (i) { return { t: i[0], g: i[1], why: i[2] }; }), hints: hints || [] }; }
  function order(id, prompt, items, hints) { X[id] = { kind: 'order', prompt: '<p>' + prompt + '</p>', items: items, hints: hints || [] }; }

  // ---------------- 25
  sort('a25-rank', 'Can a fake sign-in page that looks exactly like the real one use this method against the person?', ['Phishable', 'Phishing-resistant'], [
    ['A password.', 0, 'Typed into whatever page asks.'],
    ['A six-digit code from an authenticator app.', 0, 'Typed into the fake page, then used within 30 seconds on the real one.'],
    ['An SMS code.', 0, 'Typed like any other code, and the phone network can also be attacked.'],
    ['A push notification with "Approve?".', 0, 'The person approves the attacker\'s login: MFA fatigue.'],
    ['A passkey.', 1, 'The browser signs for the real origin only; on a look-alike there is no credential to offer.'],
    ['A hardware security key (FIDO2).', 1, 'Same mechanism, with the key never leaving the device.']]);
  quiz('a25-origin', 'In a passkey sign-in, which party writes the page\'s origin into the signed data, and why does that matter?', [
    ['The browser. A fake site cannot make it say the real origin, so the server rejects the signature.', true, 'The page\'s own JavaScript cannot set <code>clientDataJSON.origin</code>.'],
    ['The page\'s own script, which reads the address bar and copies it into the signed data before asking for the signature.', false, 'If a page could write it, a fake page would write the real one.'],
    ['The server, from the request.', false, 'The server <em>checks</em> it; it does not make it.'],
    ['The authenticator, from the password.', false, 'There is no password in a passkey sign-in.']]);
  quiz('a25-fatigue', 'Attackers with a stolen password trigger push approvals at 2 a.m. until a person taps Approve. What stops this?', [
    ['A phishing-resistant factor, so that nothing can be approved by someone who does not have the passkey.', true, 'Removing the weak factor is better than making people more careful. Number matching helps but is still a person deciding.'],
    ['Training users to look carefully at every prompt and to deny anything they did not start themselves.', false, 'It relies on the vigilance that phishing resistance is defined not to need.'],
    ['Longer passwords.', false, 'The attacker already has the password.'],
    ['Sending the prompt more slowly.', false, 'It only delays the same attack.']]);
  quiz('a25-recovery', 'The app requires a passkey, but "I lost my device" sends an email link that signs the person in. What is the real strength of the sign-in?', [
    ['That of the email account: an attacker takes the recovery path instead of the passkey.', true, 'Recovery is the weakest path, so it sets the bar. Add a second passkey or offline recovery codes, delay and notify.'],
    ['That of the passkey itself, because the passkey is the primary method and the recovery path is rarely used.', false, 'An attacker uses whichever path is easier.'],
    ['Stronger than a password, because a link expires.', false, 'The email account is a single, often weak, factor.'],
    ['Unaffected, because recovery is rare.', false, 'Attackers deliberately choose rare, under-protected paths.']]);
  quiz('a25-stepup', 'A signed-in user clicks "Delete my account". The API wants a fresh strong sign-in even though a session exists. What does it do?', [
    ['Answers 401 with <code>error="insufficient_user_authentication"</code> and the <code>acr_values</code> or <code>max_age</code> it needs, so the client can start a new sign-in.', true, 'That is step-up authentication in RFC 9470.'],
    ['Answers 403 and shows an error.', false, '403 says "no, whoever you are"; step-up says "prove it again, more strongly".'],
    ['Silently allows it, because the session is valid.', false, 'A session says who, not how recently or how strongly.'],
    ['Asks for the password in a pop-up inside the app.', false, 'The app should never collect credentials: the identity provider does.']]);

  // ---------------- 26
  sort('a26-layers', 'Which measure closes this gap?', ['PAR (RFC 9126)', '<code>iss</code> parameter (RFC 9207)', 'Resource indicators (RFC 8707)', 'Refresh token rotation'], [
    ['Parameters of the authorize request being read or changed in the address bar or history.', 0, 'The request is pushed over the back channel; the browser carries only a <code>request_uri</code>.'],
    ['A client tricked into sending a code to the wrong authorization server.', 1, 'The response names its issuer, and the client compares.'],
    ['A token for one API being replayed at a different API.', 2, 'The client names the target and the audience is narrowed to it.'],
    ['A stolen refresh token used again and again.', 3, 'Each use returns a new token; reuse of an old one revokes the whole family.']]);
  quiz('a26-dpop', 'An attacker copies a DPoP-bound access token from a proxy log and calls the API with it, adding a DPoP proof they signed with their own new key. What happens?', [
    ['Refused: the proof\'s key does not match the key the token is bound to (<code>cnf.jkt</code>).', true, 'The token is useless without the original private key.'],
    ['Accepted: the proof carries a valid signature, so the server has no reason to look at who made the key.', false, 'A valid signature is not enough: it must be by <em>the bound</em> key.'],
    ['Accepted, because the token is still valid.', false, 'Validity of the token is one check; the binding is another.'],
    ['Refused only after the token expires.', false, 'The proof check fails immediately.']]);
  quiz('a26-refresh', 'A refresh token with rotation is used by a thief, then by the real client. What should the authorization server do on the second use?', [
    ['Treat it as reuse: refuse it and revoke the whole token family, so both parties must sign in again.', true, 'Reuse of a rotated token means a copy exists. RFC 9700 section 4.14.'],
    ['Accept it and issue a new one, because the token is well formed, signed and has not expired yet.', false, 'It was already used; a second use is the signal.'],
    ['Accept it and email the user.', false, 'Then the thief and the client both stay signed in.'],
    ['Return a new token, but only to the older client.', false, 'The server cannot tell which one is genuine.']]);
  order('a26-rotate', 'Put a signing key rotation (no leak) in order.', ['Publish the new key in the key set, not yet used for signing.', 'Start signing new tokens with the new key.', 'Wait for tokens signed with the old key, and verifier caches, to expire.', 'Remove the old key from the key set.'], ['Verifiers must be able to find a key before it is used, and must keep the old one while tokens exist.']);
  sort('a26-oauth21', 'According to the OAuth 2.1 draft\'s own list of changes from OAuth 2.0, is this removed or required?', ['Removed', 'Required'], [
    ['The implicit grant (<code>response_type=token</code>).', 0, 'Omitted, as RFC 9700 deprecated it.'],
    ['The resource owner password credentials grant.', 0, 'Omitted, as RFC 9700 section 2.4.'],
    ['Bearer tokens in the URI query string.', 0, 'Omitted, as RFC 9700 section 4.3.2.'],
    ['The PKCE <code>plain</code> method.', 0, 'Removed.'],
    ['PKCE parameters in the authorization code grant.', 1, 'The default way to use the grant needs them.'],
    ['Exact string matching of redirect URIs.', 1, 'Required, as RFC 9700 section 4.1.3.'],
    ['Sender-constrained or one-time-use refresh tokens for public clients.', 1, 'Required, as RFC 9700 section 4.14.2.']]);

  // ---------------- 28
  quiz('a28-flaws', 'Tick every statement about Notely that is a <b>flaw</b>. Leave the sound ones.', [
    ['Access and refresh tokens are kept in <code>localStorage</code>.', true, 'Step 22: script can read them. Use a BFF or at least keep them out of storage.'],
    ['The sign-in has no PKCE, a fixed <code>state</code> and a wildcard redirect URI.', true, 'Steps 12 and 22: every one of those removes a defence of the code flow.'],
    ['The app identifies the user by the ID token\'s <code>email</code> and does not check <code>nonce</code>.', true, 'Steps 14 and 15: the key is issuer plus <code>sub</code>, and the nonce binds the token to the session.'],
    ['The API accepts any <code>alg</code>, does not check <code>aud</code>, allows five minutes of skew and tokens live 24 hours.', true, 'Steps 10 and 20.'],
    ['The session cookie has <code>Domain=notely.example</code> and is shared with the marketing site.', true, 'Step 03 and 22: use <code>__Host-</code>, HttpOnly, Secure and SameSite.'],
    ['<code>GET /api/notes/{id}</code> returns the note whenever the caller is signed in.', true, 'Step 17: object-level authorization is missing (IDOR).'],
    ['The admin delete endpoint is only hidden in the UI.', true, 'Step 17: hiding a button is not access control.'],
    ['The nightly job uses the admin\'s client secret, committed to the repository.', true, 'Step 24: its own client, least privilege, secret out of the source.'],
    ['"Forgot password" emails a link that signs the person in and never expires.', true, 'Step 25: a bearer credential that lives forever, on a weak channel.'],
    ['Google accounts are linked to local ones by an unverified email.', true, 'Step 23: account takeover by claiming an address.'],
    ['The application\'s service account is bound to <code>cluster-admin</code>.', true, 'Step 18: least privilege.'],
    ['Certificates for the internal site come from the company\'s own CA, which employees\' browsers trust.', false, 'Sound for internal sites: a private CA is normal and step 06 builds one. The flaw would be the staging site on plain HTTP, which is also listed separately.']], [], true);
  quiz('a28-worst', 'Which single flaw should be fixed <em>first</em>?', [
    ['The admin client secret in the repository: it gives every admin power to anyone who can read the code, and it is already leaked.', true, 'An exposed credential with full power is an incident, not a design improvement: rotate it now, then fix the design.'],
    ['The 24-hour token lifetime.', false, 'Important, but not already exposed.'],
    ['The missing <code>nonce</code> check.', false, 'A narrower attack, and it needs more to go wrong.'],
    ['The cookie domain.', false, 'Worth fixing, and not an exposed credential.']]);
  sort('a28-fixes', 'Which step teaches the fix?', ['Step 12 or 22 (the code flow, the BFF)', 'Step 17 (object-level access)', 'Step 20 (validation)', 'Step 24 (service identity)'], [
    ['Add PKCE, a random <code>state</code> and exact redirect URIs.', 0, 'The flow of step 12.'],
    ['Put the owner into the query so another user\'s note is not found.', 1, 'The fix for broken object-level authorization.'],
    ['Pin the algorithm, check the audience, shorten the skew and lifetime.', 2, 'The validator of step 20.'],
    ['Give the export job its own client with only the role it needs.', 3, 'The reporter pattern.']]);

  // ---------------- 30
  quiz('a30-find', 'Everything returns 401 for tokens that decode fine and have not expired. The API\'s Authority is <code>http://localhost:8180/realms/todo</code>, and the token\'s <code>iss</code> is <code>http://127.0.0.1:8180/realms/todo</code>. Cause?', [
    ['The issuer in the token is built from the host name used to get it, and the API compares it exactly.', true, 'Use one name everywhere (step 19).'],
    ['The signature is invalid.', false, 'The message would say so. The issuer check fails first and is a different one.'],
    ['The token is for another audience.', false, 'The message would name the audience.'],
    ['The clock skew is too small.', false, 'Skew is about expiry, not the issuer.']]);
  order('a30-order', 'Put these in the order a sensible person works through a "401 from my API" report.', ['Read the exact <code>WWW-Authenticate</code> value.', 'Decode the token and read <code>iss</code>, <code>aud</code>, <code>exp</code> and <code>roles</code>.', 'Compare them with the API\'s Authority and audience, and the clock.', 'Fix one thing, then try again.'], ['Information first, then the comparison, then the change.']);
})();
