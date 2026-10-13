// The attack labs of step 10: a simulated API with a token validator that has one classic flaw each.
// The flaws are the ones RFC 8725 (JSON Web Token Best Current Practices) section 2 describes; the fixed validator is what
// its section 3 asks for. This is a simulation written for the lesson, not a real library. Pure JavaScript with no DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crypto.js'));
  else root.IAAttack = factory(root.IACrypto);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const ISS = 'https://login.lab.test', AUD = 'todo-api';
  const LABS = {
    'alg-none': {
      title: 'Lab 1: the token that needs no signature',
      story: 'The API\'s library reads the <code>alg</code> from the token\'s own header and does what it says. You hold a valid token for a normal user.',
      flaw: 'It trusts the <code>alg</code> header, including <code>none</code>.',
      fix: 'Give the library an allow-list of algorithms (here only <code>RS256</code>) and never let the token choose. <code>none</code> is never on the list. (RFC 8725, 3.1 and 3.2)',
    },
    'alg-confusion': {
      title: 'Lab 2: swap RS256 for HS256',
      story: 'The API verifies RS256 tokens with its RSA <b>public</b> key, which it publishes for anyone. You hold a valid user token and the public key.',
      flaw: 'The library takes the algorithm from the header. For <code>HS256</code> it uses the configured key as the HMAC <em>secret</em>, and the configured key is the public key, which you have.',
      fix: 'Each key may be used with exactly one algorithm, checked when verifying: an RSA public key is only ever used with <code>RS256</code>. (RFC 8725, 3.1)',
    },
    'weak-secret': {
      title: 'Lab 3: the guessable secret',
      story: 'This API signs its tokens with <code>HS256</code> and one shared secret. You hold a valid user token. The secret was chosen by a person.',
      flaw: 'The secret is a short common word, so it can be found by trying words from a list, offline, without ever touching the API.',
      fix: 'A symmetric key must have as much entropy as the hash: for HS256 at least 256 random bits, from a secure random generator, never a word. Better: use asymmetric signing. (RFC 8725, 2.2 and 3.5)',
    },
    'no-verify': {
      title: 'Lab 4: decoded, never verified',
      story: 'A developer needed the claims quickly and used the library\'s <em>decode</em> call, not its <em>verify</em> call. You hold a valid user token.',
      flaw: 'It reads the payload and trusts it without checking the signature at all.',
      fix: 'Always verify (signature, issuer, audience, expiry) before reading any claim. Decoding is for debugging, never for decisions. (RFC 8725, 3.3)',
    },
    'no-audience': {
      title: 'Lab 5: a token meant for someone else',
      story: 'The same identity provider also serves the <code>reports-api</code>. You are an admin there and hold a perfectly valid token for it. The Todo API checks the signature, issuer and expiry.',
      flaw: 'It never checks that the token was issued <em>for it</em> (<code>aud</code>).',
      fix: 'Validate the audience: reject any token whose <code>aud</code> does not include this API. (RFC 8725, 3.9; RFC 9068)',
    },
    'no-expiry': {
      title: 'Lab 6: the token that never dies',
      story: 'An admin\'s token leaked months ago. It has long expired. The signature, issuer and audience are all genuine.',
      flaw: 'The expiry (<code>exp</code>) is never checked.',
      fix: 'Reject tokens past <code>exp</code> (with a small clock allowance), and require <code>exp</code> to be present. (RFC 7519, 4.1.4 and 7.2)',
    },
  };
  const ORDER = Object.keys(LABS);

  // Everything a lab needs: a key pair, the token the learner holds, and the API's secrets. Built once per page.
  async function setup(now) {
    now = now || Math.floor(Date.now() / 1000);
    const kp = await C.generateKeyPair('RS256');
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', await crypto.subtle.importKey('jwk', kp.publicJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify'])));
    let bin = ''; spki.forEach((b) => { bin += String.fromCharCode(b); });
    const pem = '-----BEGIN PUBLIC KEY-----\n' + btoa(bin).replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END PUBLIC KEY-----\n';
    const weak = 'sunshine';
    const strong = C.b64uEnc(C.random(32));
    const env = { now, rsa: { publicJwk: kp.publicJwk, privateJwk: kp.privateJwk, pem }, weakSecret: weak, strongSecret: strong, wordlist: ['password', 'secret', 'letmein', 'sunshine', 'qwerty', 'changeme'] };
    const userClaims = { iss: ISS, sub: 'alice', aud: AUD, role: 'user', iat: now - 60, exp: now + 3600 };
    const rs = (claims) => C.sign({ alg: 'RS256', typ: 'JWT', kid: 'lab-1' }, claims, kp.privateJwk);
    const hs = (claims, secret) => C.sign({ alg: 'HS256', typ: 'JWT' }, claims, { kty: 'oct', k: C.b64uEnc(C.utf8(secret)) });
    env.tokens = {
      'alg-none': await rs(userClaims),
      'alg-confusion': await rs(userClaims),
      'weak-secret': await hs(userClaims, weak),
      'no-verify': await rs(userClaims),
      'no-audience': await rs({ iss: ISS, sub: 'carol', aud: 'reports-api', role: 'admin', iat: now - 60, exp: now + 3600 }),
      'no-expiry': await rs({ iss: ISS, sub: 'dave', aud: AUD, role: 'admin', iat: now - 7 * 86400, exp: now - 86400 }),
    };
    return env;
  }

  // The API's check. `fixed` switches the lab's flaw off. Returns { accepted, admin, claims, steps: [html] }.
  async function validate(labId, env, token, fixed) {
    const steps = []; const out = (accepted, claims) => ({ accepted, admin: !!(accepted && claims && claims.role === 'admin'), claims: claims || null, steps });
    const p = C.parse(token);
    if (p.errors.length || !p.header || !p.payload) { steps.push('Rejected: ' + p.errors.join(' ')); return out(false); }
    const alg = p.header.alg, now = env.now;
    const full = async (algs, key, o) => {
      const r = await C.verify(token, Object.assign({ algorithms: algs, key, issuer: ISS, audience: AUD, now, requireExp: true }, o || {}));
      r.checks.forEach((c) => steps.push((c.ok ? '✓ ' : '✗ ') + c.name + ': ' + c.detail));
      return r;
    };
    const rsKey = env.rsa.publicJwk;
    if (labId === 'weak-secret') {
      const secret = fixed ? env.strongSecret : env.weakSecret;
      const r = await full(['HS256'], { kty: 'oct', k: C.b64uEnc(C.utf8(secret)) });
      return out(r.ok, r.parsed.payload);
    }
    if (fixed) { const r = await full(['RS256'], rsKey); return out(r.ok, r.parsed.payload); }
    // flawed behaviours
    if (labId === 'alg-none') {
      if (alg === 'none') { steps.push('The header says alg=none, so the library skipped the signature check.'); return out(!!p.payload && p.payload.iss === ISS, p.payload); }
      const r = await full(['RS256'], rsKey); return out(r.ok, r.parsed.payload);
    }
    if (labId === 'alg-confusion') {
      if (/^HS(256|384|512)$/.test(alg)) {
        const r = await full([alg], { kty: 'oct', k: C.b64uEnc(C.utf8(env.rsa.pem)) });
        steps.push('The library verified an HMAC with the configured key text as the secret.');
        return out(r.ok, r.parsed.payload);
      }
      const r = await full(['RS256'], rsKey); return out(r.ok, r.parsed.payload);
    }
    if (labId === 'no-verify') {
      steps.push('The library only decoded the token. It did not check the signature.');
      return out(p.payload.iss === ISS && p.payload.aud === AUD, p.payload);
    }
    if (labId === 'no-audience') {
      const r = await C.verify(token, { algorithms: ['RS256'], key: rsKey, issuer: ISS, now, requireExp: true });
      r.checks.forEach((c) => steps.push((c.ok ? '✓ ' : '✗ ') + c.name + ': ' + c.detail)); steps.push('(The audience was not checked.)');
      return out(r.ok, r.parsed.payload);
    }
    if (labId === 'no-expiry') {
      const r = await C.verify(token, { algorithms: ['RS256'], key: rsKey, issuer: ISS, audience: AUD, now: p.payload.exp ? p.payload.exp - 1 : now });
      r.checks.forEach((c) => steps.push((c.ok ? '✓ ' : '✗ ') + c.name + ': ' + c.detail)); steps.push('(The expiry was not checked.)');
      return out(r.ok, r.parsed.payload);
    }
    throw new Error('unknown lab ' + labId);
  }

  // One working forgery for each lab: used by "Show answer" and by the tests, so the lab is proved solvable.
  async function forge(labId, env) {
    const held = env.tokens[labId]; const p = C.parse(held);
    const admin = Object.assign({}, p.payload, { role: 'admin' });
    switch (labId) {
      case 'alg-none': return C.sign({ alg: 'none', typ: 'JWT' }, admin);
      case 'alg-confusion': return C.sign({ alg: 'HS256', typ: 'JWT' }, admin, { kty: 'oct', k: C.b64uEnc(C.utf8(env.rsa.pem)) });
      case 'weak-secret': {
        for (const w of env.wordlist) { const r = await C.verify(held, { algorithms: ['HS256'], key: { kty: 'oct', k: C.b64uEnc(C.utf8(w)) }, now: env.now }); if (r.ok) return C.sign({ alg: 'HS256', typ: 'JWT' }, admin, { kty: 'oct', k: C.b64uEnc(C.utf8(w)) }); }
        throw new Error('the secret is not in the list');
      }
      case 'no-verify': return C.b64uEnc(C.utf8(JSON.stringify(p.header))) + '.' + C.b64uEnc(C.utf8(JSON.stringify(admin))) + '.' + p.parts[2];
      case 'no-audience': case 'no-expiry': return held;
      default: throw new Error('unknown lab ' + labId);
    }
  }
  return { LABS, ORDER, ISS, AUD, setup, validate, forge };
});
