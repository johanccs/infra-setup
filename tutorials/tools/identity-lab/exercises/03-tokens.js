// Exercises for steps 09 and 10 (tokens, JWT validation and the attack labs).
(function () {
  var X = window.IA.exercises;
  var TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6IjIwMjYtMTAifQ.eyJpc3MiOiJodHRwczovL2xvZ2luLmxhYi50ZXN0Iiwic3ViIjoiOGYxYzJkN2UiLCJhdWQiOiJ0b2RvLWFwaSIsInNjb3BlIjoidG9kb3MucmVhZCB0b2Rvcy53cml0ZSIsImNsaWVudF9pZCI6InRvZG8td2ViIiwiaWF0IjoxNzkxODkwNDAwLCJleHAiOjE3OTE4OTQwMDAsImp0aSI6ImI3YzVhMSJ9.bm90LWEtcmVhbC1zaWduYXR1cmUtZm9yLXJlYWRpbmctb25seQ';

  // The facts the questions rely on, which the tests check against the token itself.
  X['j9-read'] = { kind: 'inspect', prompt: '<p>Decode this token (paste it into the workbench above, or read the claims below it) and answer. Its signature is a placeholder, so only reading is possible.</p>',
    artifact: TOKEN,
    facts: [
      { token: TOKEN, path: 'header.alg', equals: 'RS256' }, { token: TOKEN, path: 'header.typ', equals: 'at+jwt' }, { token: TOKEN, path: 'payload.aud', equals: 'todo-api' },
      { token: TOKEN, path: 'payload.client_id', equals: 'todo-web' }, { token: TOKEN, path: 'lifetime', equals: 3600 }, { token: TOKEN, path: 'payload.scope', equals: 'todos.read todos.write' },
    ],
    parts: [
      { kind: 'quiz', prompt: 'Which API is this token meant for?', options: [{ t: '<code>todo-web</code>', ok: false, why: 'That is <code>client_id</code>: the app that asked for the token.' }, { t: '<code>todo-api</code>', ok: true, why: '<code>aud</code> is the audience: the API that must accept it.' }, { t: '<code>login.lab.test</code>', ok: false, why: 'That is the issuer, who made it.' }] },
      { kind: 'quiz', prompt: 'How long is the token valid for?', options: [{ t: '1 hour', ok: true, why: '<code>exp</code> is 3600 seconds after <code>iat</code>.' }, { t: '1 day', ok: false, why: 'That would be 86400 seconds.' }, { t: 'It never expires', ok: false, why: 'There is an <code>exp</code> claim.' }] },
      { kind: 'quiz', prompt: 'Which algorithm signed it, and what kind of token is it?', options: [{ t: 'RS256 (an RSA signature), and a JWT access token (<code>at+jwt</code>).', ok: true, why: 'The header says so: <code>alg</code> and <code>typ</code>.' }, { t: 'HS256, and an ID token.', ok: false, why: 'The header says RS256 and <code>at+jwt</code>.' }] },
      { kind: 'quiz', prompt: 'Which key does the API need to check the signature?', options: [{ t: 'The issuer\'s public key whose <code>kid</code> is <code>2026-10</code>.', ok: true, why: 'RS256 is verified with the public key the <code>kid</code> names.' }, { t: 'The issuer\'s private key.', ok: false, why: 'An API must never hold the private key: it could then make tokens.' }, { t: 'A secret shared with the client.', ok: false, why: 'That would be HS256.' }] },
    ] };

  X['j9-alg'] = { kind: 'sort', prompt: '<p>Which kind of algorithm fits each situation?</p>',
    groups: ['A shared secret (HS256) is acceptable', 'An asymmetric algorithm (RS256, ES256, Ed25519) is needed'],
    items: [
      { t: 'One service makes a token and the same service is the only one that ever checks it.', g: 0, why: 'Nobody else needs to verify, so nobody else needs the key.' },
      { t: 'An identity provider issues tokens that ten different APIs verify.', g: 1, why: 'With a shared secret every API could forge tokens. With a public key they can only check.' },
      { t: 'Partner companies must be able to verify your tokens.', g: 1, why: 'You cannot hand a secret to every partner and keep it a secret.' },
      { t: 'A checker must be able to verify but must not be able to create tokens.', g: 1, why: 'That separation is exactly what a public key gives.' },
    ] };

  X['j9-order'] = { kind: 'order', prompt: '<p>Put a signing key rotation in a safe order.</p>',
    items: ['Publish the new public key in the key set next to the old one.', 'Start signing new tokens with the new key (a new <code>kid</code>).', 'Wait until every token signed with the old key has expired.', 'Remove the old key from the key set.'],
    hints: ['Verifiers must be able to find a key before anyone uses it, and must keep the old one until its tokens are gone.'] };

  X['j9-readable'] = { kind: 'quiz', prompt: '<p>A developer puts a customer\'s home address in a JWT payload "because the token is signed, so it is safe". What is the problem?</p>',
    options: [
      { t: 'The signature protects the content from being read, so there is no problem.', ok: false, why: 'A signature protects against <em>change</em>, not against reading.' },
      { t: 'Anyone who holds the token can read it, since it is only base64url text.', ok: true, why: 'A normal JWT is signed, not encrypted.' },
      { t: 'The token becomes invalid when it contains an address.', ok: false, why: 'Any claims are allowed.' },
    ] };

  // ---- 10: the attack labs
  var lab = function (id, prompt) { X[id] = { kind: 'attack', lab: id.replace('j10-', '') === 'none' ? 'alg-none' : null, prompt: prompt }; };
  X['j10-none'] = { kind: 'attack', lab: 'alg-none', prompt: '<h4>Lab 1: the token that needs no signature</h4>' };
  X['j10-confusion'] = { kind: 'attack', lab: 'alg-confusion', prompt: '<h4>Lab 2: swap RS256 for HS256</h4>' };
  X['j10-weak'] = { kind: 'attack', lab: 'weak-secret', prompt: '<h4>Lab 3: the guessable secret</h4>' };
  X['j10-noverify'] = { kind: 'attack', lab: 'no-verify', prompt: '<h4>Lab 4: decoded, never verified</h4>' };
  X['j10-noaud'] = { kind: 'attack', lab: 'no-audience', prompt: '<h4>Lab 5: a token meant for someone else</h4>' };
  X['j10-noexp'] = { kind: 'attack', lab: 'no-expiry', prompt: '<h4>Lab 6: the token that never dies</h4>' };

  X['j10-checks'] = { kind: 'sort', prompt: '<p>Which of these must an API do <b>before it trusts a token\'s claims</b>, and which is not a validity check at all?</p>',
    groups: ['A required check', 'Not a validity check'],
    items: [
      { t: 'Compare <code>alg</code> with the list of algorithms the API accepts.', g: 0, why: 'The verifier decides. RFC 8725, 3.1.' },
      { t: 'Verify the signature with a key from the issuer\'s published set.', g: 0, why: 'Without it the claims are just text.' },
      { t: 'Check that <code>aud</code> includes this API.', g: 0, why: 'Otherwise a token for another service works here (3.9).' },
      { t: 'Check that <code>exp</code> has not passed.', g: 0, why: 'Tokens cannot be recalled, so the expiry is the limit.' },
      { t: 'Decode the payload and read <code>role</code>.', g: 1, why: 'That is reading, which comes after every check.' },
      { t: 'Check that the token is long.', g: 1, why: 'Length says nothing about validity.' },
    ] };
  X['j10-config'] = { kind: 'quiz', prompt: '<p>An API accepts tokens from one identity provider that signs with RS256. Which configuration is right?</p>',
    options: [
      { t: 'Accept any algorithm that appears in the token, as long as the signature verifies.', ok: false, why: 'The token then chooses the algorithm, which is the root of both the <code>none</code> and the key confusion attacks.' },
      { t: 'Accept only RS256, verify with the issuer\'s published keys, and require issuer, audience and expiry to match.', ok: true, why: 'An allow-list, a trusted key source, and every claim you rely on checked.' },
      { t: 'Skip the audience check, because the signature already proves the token is genuine.', ok: false, why: 'A genuine token for another API is still not meant for this one.' },
    ] };
})();
