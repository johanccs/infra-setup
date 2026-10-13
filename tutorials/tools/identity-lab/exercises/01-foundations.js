// Exercises for steps 01 to 03.
(function () {
  var X = window.IA.exercises;

  // ---- 01
  X['f1-sort'] = { kind: 'sort', prompt: '<p>Put each statement in the right group: is it <b>authentication</b> (who are you?) or <b>authorization</b> (what may you do?).</p>',
    groups: ['Authentication', 'Authorization'],
    items: [
      { t: 'The API checks the password the user typed.', g: 0, why: 'It establishes who the caller is.' },
      { t: 'The API checks that the signed-in user has the <code>admin</code> role.', g: 1, why: 'The user is already known. This decides what they may do.' },
      { t: 'The server verifies the signature of a token.', g: 0, why: 'It checks that the token is genuine, which backs the claim of who the caller is.' },
      { t: 'Only the owner of a todo may delete it.', g: 1, why: 'A rule about what an identified user may do to a resource.' },
      { t: 'A passkey on the phone proves the user is Alice.', g: 0, why: 'Proof of identity.' },
      { t: 'A manager may approve expenses up to 500.', g: 1, why: 'A limit on what a known person may do.' },
      { t: 'The browser shows a login page.', g: 0, why: 'A login page exists to establish identity.' },
      { t: 'A reader of a document may view it but not edit it.', g: 1, why: 'A permission on a resource.' },
    ],
    hints: ['Ask: does this statement establish <em>who</em> someone is, or decide what they <em>may do</em>?'],
    after: 'Authentication first, then authorization.' };

  X['f1-codes'] = { kind: 'inspect', prompt: '<p>Three requests reach an API. What status code should each get?</p>',
    artifact: 'A)  GET    /api/todos\n    (no Authorization header)\n\nB)  GET    /api/todos\n    Authorization: Bearer <a token that expired yesterday>\n\nC)  DELETE /api/admin/users/7\n    Authorization: Bearer <a valid token for alice, role: user>',
    parts: [
      { kind: 'quiz', prompt: 'Request A gets:', options: [{ t: '<code>401</code>', ok: true, why: 'No credentials at all: the caller is unknown.' }, { t: '<code>403</code>', ok: false, why: '403 is for a known caller who is not allowed.' }, { t: '<code>404</code>', ok: false, why: 'The resource is not the problem here.' }] },
      { kind: 'quiz', prompt: 'Request B gets:', options: [{ t: '<code>401</code>', ok: true, why: 'The credentials are not valid (expired), so the caller is still unknown.' }, { t: '<code>403</code>', ok: false, why: 'The server cannot trust the token, so it does not know who this is.' }, { t: '<code>404</code>', ok: false, why: 'Nothing is missing.' }] },
      { kind: 'quiz', prompt: 'Request C gets:', options: [{ t: '<code>401</code>', ok: false, why: 'The token is valid, so the caller is known.' }, { t: '<code>403</code>', ok: true, why: 'Alice is known, and her role may not do this.' }, { t: '<code>200</code>', ok: false, why: 'A user must not be able to call an admin function.' }] },
    ],
    hints: ['Is the caller known? If not, 401. If known but not allowed, 403.'] };

  X['f1-client'] = { kind: 'quiz', prompt: '<p>The Todo app hides the <b>Delete user</b> button for people who are not admins, but the API has no check. What is the problem?</p>',
    options: [
      { t: 'Nothing is wrong: with the button hidden, ordinary users cannot reach the delete function through the page.', ok: false, why: 'Anyone can send the request without the button, with <code>curl</code> or the browser tools.' },
      { t: 'The server must check the role itself.', ok: true, why: 'Hiding a button is a convenience, not access control. The server enforces, on every request.' },
      { t: 'The API should answer 401 to non-admins.', ok: false, why: 'A signed-in non-admin is known; the right answer is 403.' },
    ] };

  // ---- 02
  X['f2-tools'] = { kind: 'sort', prompt: '<p>Which tool fits each job?</p>',
    groups: ['Hash', 'MAC (HMAC)', 'Encryption', 'Digital signature'],
    items: [
      { t: 'Check a downloaded installer against the SHA-256 value published next to it.', g: 0, why: 'Anyone can compute a hash. No secret is needed.' },
      { t: 'Two services that share a secret check that a webhook body was not changed.', g: 1, why: 'A shared secret plus a hash: a MAC.' },
      { t: 'Keep a backup file unreadable to anyone without the key.', g: 2, why: 'Secrecy is encryption’s job.' },
      { t: 'Anyone can check that a token came from the identity provider, but only the provider can make one.', g: 3, why: 'A private key signs, and the public key verifies.' },
      { t: 'A browser checks that a server’s certificate was issued by a certificate authority.', g: 3, why: 'A certificate carries the authority’s signature.' },
      { t: 'Detect that a stored file was changed, with no secret involved.', g: 0, why: 'A fingerprint is enough to notice a change.' },
    ],
    hints: ['Does it need a secret? Does anyone need to <em>verify</em> without being able to <em>create</em>? Does it need to hide the content?'] };

  X['f2-order'] = { kind: 'order', prompt: '<p>Put the steps of signing and verifying in order.</p>',
    items: ['The signer makes a key pair and keeps the private key secret.', 'The signer signs the message with the private key.', 'The message and the signature are sent to the verifier.', 'The verifier checks the signature with the public key.'],
    hints: ['The key pair exists before anything can be signed. The check is last.'] };

  X['f2-key'] = { kind: 'quiz', prompt: '<p>Which key makes a signature, and which one checks it?</p>',
    options: [
      { t: 'The public key signs, and the private key verifies, because the public one is the one everybody already holds.', ok: false, why: 'The public key is shared with everyone. If it could sign, anyone could forge signatures.' },
      { t: 'The private key signs, and the public key verifies.', ok: true, why: 'Only the holder of the private key can sign, and anyone with the public key can check.' },
      { t: 'The same shared key does both.', ok: false, why: 'That is a MAC (a shared secret), not a public-key signature.' },
    ] };

  X['f2-b64'] = { kind: 'quiz', prompt: '<p>A colleague says: "The token payload is base64url, so nobody can read it." Is that right?</p>',
    options: [
      { t: 'Yes. Base64url is a form of encryption, so without the key nobody can read the payload.', ok: false, why: 'It is an encoding. It has no key.' },
      { t: 'No. Anyone can decode it, and a signature does not hide the payload.', ok: true, why: 'Never put a secret in a JWT payload unless the token is encrypted.' },
      { t: 'Yes, but only because the token is signed.', ok: false, why: 'Signing and encoding are different things, and signing never hides content.' },
    ] };

  // ---- 03
  X['f3-cookie'] = { kind: 'inspect', prompt: '<p>The server sets this cookie. Answer three questions about it.</p>',
    artifact: 'Set-Cookie: sid=9f2c41b7e0aa; Path=/; Domain=example.com',
    parts: [
      { kind: 'quiz', prompt: 'Can JavaScript running on the page read it?', options: [{ t: 'Yes, there is no <code>HttpOnly</code>.', ok: true, why: 'Without HttpOnly, <code>document.cookie</code> shows it.' }, { t: 'No, because it is a session id.', ok: false, why: 'What the cookie is for does not matter. Only <code>HttpOnly</code> hides it from script.' }] },
      { kind: 'quiz', prompt: 'Will it be sent on a plain <code>http://</code> request to the same host?', options: [{ t: 'Yes, there is no <code>Secure</code>.', ok: true, why: 'Anyone on the network could read it.' }, { t: 'No, it is a login cookie.', ok: false, why: 'Only <code>Secure</code> keeps a cookie off plain HTTP.' }] },
      { kind: 'quiz', prompt: 'Is it sent to <code>api.example.com</code>?', options: [{ t: 'Yes, because of <code>Domain=example.com</code>.', ok: true, why: 'Setting Domain makes the cookie available to all subdomains. Leaving it off keeps it to the host that set it.' }, { t: 'No, it was set by <code>app.example.com</code>.', ok: false, why: 'That would be true without the Domain attribute.' }] },
    ],
    hints: ['Look at which attributes are present, and what each one changes.'] };

  X['f3-store'] = { kind: 'quiz', prompt: '<p>How should the Todo app store a user’s password?</p>',
    options: [
      { t: 'Store the password as typed, in a column that only the app can read.', ok: false, why: 'A database leak or a backup in the wrong hands exposes every password, and people reuse them.' },
      { t: 'Store a plain SHA-256 hash of the password.', ok: false, why: 'SHA-256 is fast, so guesses are cheap, and with no salt identical passwords give identical hashes.' },
      { t: 'Encrypt it with AES and keep the key in the app’s configuration, so it can be decrypted when the user signs in.', ok: false, why: 'Encryption can be reversed. Whoever gets the key gets every password.' },
      { t: 'Store a salted hash from Argon2id or another slow password hashing function.', ok: true, why: 'Slow and salted: each guess is expensive and tables are useless.' },
    ] };

  X['f3-rules'] = { kind: 'sort', prompt: '<p>NIST SP 800-63B (revision 4) on passwords. Which of these does it <b>ask for</b>, and which does it <b>forbid as a requirement</b>?</p>',
    groups: ['Ask for it', 'Do not require it'],
    items: [
      { t: 'Accept passwords of at least 64 characters.', g: 0, why: 'Verifiers should permit a maximum length of at least 64 characters.' },
      { t: 'Require at least one capital letter, one digit and one symbol.', g: 1, why: 'Composition rules are not to be imposed.' },
      { t: 'Check new passwords against a blocklist of common and breached passwords.', g: 0, why: 'Required: compare against known commonly used, expected or compromised passwords.' },
      { t: 'Make everyone change their password every 90 days.', g: 1, why: 'Periodic changes are not to be required.' },
      { t: 'Ask a security question such as “your mother’s maiden name”.', g: 1, why: 'Knowledge-based security questions are not to be used.' },
      { t: 'Limit the number of failed attempts on an account.', g: 0, why: 'Rate limiting of failed attempts is required.' },
    ] };

  X['f3-csrf'] = { kind: 'quiz', prompt: '<p>Alice is signed in at <code>app.example.com</code>. She opens <code>evil.test</code>, which auto-submits a form that POSTs to <code>app.example.com/api/todos</code>. The session cookie is <code>SameSite=Strict</code>. What happens?</p>',
    options: [
      { t: 'The browser attaches the cookie, because the request goes to the right host and the cookie is valid for it.', ok: false, why: 'The request starts on another site, and Strict forbids attaching the cookie to those.' },
      { t: 'The request is sent without the cookie, so the server sees an anonymous caller and refuses it.', ok: true, why: 'This is what SameSite is for. Keep a real CSRF defense as well.' },
      { t: 'The browser blocks the request entirely.', ok: false, why: 'The request is still sent. Only the cookie is withheld.' },
    ] };

  X['f3-fix'] = { kind: 'quiz', prompt: '<p>Which change to the login handler prevents <b>session fixation</b>?</p>',
    options: [
      { t: 'Make the session id much longer, so an attacker cannot guess it before the user signs in.', ok: false, why: 'A long id is good, but fixation works with an id the attacker already knows, however long.' },
      { t: 'Create a new session id after login and destroy the old one.', ok: true, why: 'An id the attacker planted before login becomes worthless.' },
      { t: 'Set the cookie to <code>HttpOnly</code>.', ok: false, why: 'HttpOnly stops script reading the cookie. It does not stop a pre-planted id.' },
    ] };
})();
