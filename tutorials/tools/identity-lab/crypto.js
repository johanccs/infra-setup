// Cryptography helpers for the Identity and Access Lab: base64url, hashes, HMAC, JWT and JWK, PKCE and TOTP.
// Pure JavaScript on the Web Crypto API (no DOM), so the same file runs in the page and in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis.crypto);
  else root.IACrypto = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';
  const subtle = webcrypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true });
  const utf8 = (s) => te.encode(s);
  const fromUtf8 = (b) => td.decode(b);

  // ---------------------------------------------------------------- encodings (RFC 4648)
  function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function b64uEnc(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  // Strict: base64url without padding, only the 64 characters, and a length that can be decoded.
  function b64uDec(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) throw new Error('not base64url');
    const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const hexEnc = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  function hexDec(h) { h = h.replace(/\s+/g, ''); if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new Error('not hex'); return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16)); }
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32Dec(s) {
    s = s.replace(/[\s=]/g, '').toUpperCase(); let bits = 0, val = 0; const out = [];
    for (const c of s) { const i = B32.indexOf(c); if (i < 0) throw new Error('not base32'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
    return Uint8Array.from(out);
  }
  function concat(...arrs) { const n = arrs.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
  const random = (n) => webcrypto.getRandomValues(new Uint8Array(n));

  // ---------------------------------------------------------------- hashes and MACs
  const HASH = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-384': 'SHA-384', 'SHA-512': 'SHA-512' };
  async function sha(alg, data) { return new Uint8Array(await subtle.digest(HASH[alg], typeof data === 'string' ? utf8(data) : data)); }
  async function hmac(alg, key, data) {
    const k = await subtle.importKey('raw', typeof key === 'string' ? utf8(key) : key, { name: 'HMAC', hash: HASH[alg] }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, typeof data === 'string' ? utf8(data) : data));
  }

  // ---------------------------------------------------------------- JOSE algorithms (RFC 7518, RFC 8037, RFC 9864)
  const ALGS = {
    HS256: { kty: 'oct', hash: 'SHA-256', import: { name: 'HMAC', hash: 'SHA-256' }, sign: { name: 'HMAC' } },
    HS384: { kty: 'oct', hash: 'SHA-384', import: { name: 'HMAC', hash: 'SHA-384' }, sign: { name: 'HMAC' } },
    HS512: { kty: 'oct', hash: 'SHA-512', import: { name: 'HMAC', hash: 'SHA-512' }, sign: { name: 'HMAC' } },
    RS256: { kty: 'RSA', hash: 'SHA-256', import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, sign: { name: 'RSASSA-PKCS1-v1_5' } },
    RS384: { kty: 'RSA', hash: 'SHA-384', import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, sign: { name: 'RSASSA-PKCS1-v1_5' } },
    RS512: { kty: 'RSA', hash: 'SHA-512', import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, sign: { name: 'RSASSA-PKCS1-v1_5' } },
    PS256: { kty: 'RSA', hash: 'SHA-256', import: { name: 'RSA-PSS', hash: 'SHA-256' }, sign: { name: 'RSA-PSS', saltLength: 32 } },
    PS384: { kty: 'RSA', hash: 'SHA-384', import: { name: 'RSA-PSS', hash: 'SHA-384' }, sign: { name: 'RSA-PSS', saltLength: 48 } },
    PS512: { kty: 'RSA', hash: 'SHA-512', import: { name: 'RSA-PSS', hash: 'SHA-512' }, sign: { name: 'RSA-PSS', saltLength: 64 } },
    ES256: { kty: 'EC', crv: 'P-256', hash: 'SHA-256', import: { name: 'ECDSA', namedCurve: 'P-256' }, sign: { name: 'ECDSA', hash: 'SHA-256' } },
    ES384: { kty: 'EC', crv: 'P-384', hash: 'SHA-384', import: { name: 'ECDSA', namedCurve: 'P-384' }, sign: { name: 'ECDSA', hash: 'SHA-384' } },
    ES512: { kty: 'EC', crv: 'P-521', hash: 'SHA-512', import: { name: 'ECDSA', namedCurve: 'P-521' }, sign: { name: 'ECDSA', hash: 'SHA-512' } },
    // RFC 9864: "Ed25519" is the fully-specified name; "EdDSA" (RFC 8037) is deprecated but still seen.
    Ed25519: { kty: 'OKP', crv: 'Ed25519', import: { name: 'Ed25519' }, sign: { name: 'Ed25519' } },
    EdDSA: { kty: 'OKP', crv: 'Ed25519', import: { name: 'Ed25519' }, sign: { name: 'Ed25519' }, deprecated: 'EdDSA is deprecated by RFC 9864; use Ed25519.' },
  };

  async function importKey(jwk, alg, usage) {
    const a = ALGS[alg]; if (!a) throw new Error('unsupported algorithm ' + alg);
    if (jwk.kty !== a.kty) throw new Error(`a ${alg} key must have kty ${a.kty}, this has ${jwk.kty}`);
    const clean = Object.assign({}, jwk); delete clean.alg; delete clean.use; delete clean.key_ops; delete clean.kid;
    return subtle.importKey('jwk', clean, a.import, true, [usage]);
  }
  async function generateKeyPair(alg) {
    const a = ALGS[alg]; if (!a) throw new Error('unsupported algorithm ' + alg);
    if (a.kty === 'oct') { const k = random(32); return { jwk: { kty: 'oct', k: b64uEnc(k) } }; }
    const params = a.kty === 'RSA' ? Object.assign({ modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1])}, a.import) : a.import;
    const kp = await subtle.generateKey(params, true, ['sign', 'verify']);
    return { privateJwk: await subtle.exportKey('jwk', kp.privateKey), publicJwk: await subtle.exportKey('jwk', kp.publicKey) };
  }
  // RFC 7638: the SHA-256 of the required members in lexicographic order, with no whitespace.
  async function thumbprint(jwk) {
    const members = { EC: ['crv', 'kty', 'x', 'y'], RSA: ['e', 'kty', 'n'], OKP: ['crv', 'kty', 'x'], oct: ['k', 'kty'] }[jwk.kty];
    if (!members) throw new Error('unknown key type ' + jwk.kty);
    const o = {}; for (const m of members) { if (jwk[m] === undefined) throw new Error('missing ' + m); o[m] = jwk[m]; }
    return b64uEnc(await sha('SHA-256', JSON.stringify(o)));
  }

  // ---------------------------------------------------------------- JWT / JWS compact serialization (RFC 7519, RFC 7515)
  // Reading a token never verifies it. parse() only splits and decodes, and says what could not be decoded.
  function parse(token) {
    const out = { token, parts: null, header: null, payload: null, signature: null, signingInput: null, errors: [] };
    const parts = String(token).trim().split('.');
    if (parts.length !== 3) { out.errors.push(`A JWS in compact form has 3 parts separated by dots; this has ${parts.length}.`); return out; }
    out.parts = parts; out.signingInput = parts[0] + '.' + parts[1];
    for (const [i, name] of [[0, 'header'], [1, 'payload']]) {
      try { out[name] = JSON.parse(fromUtf8(b64uDec(parts[i]))); }
      catch (e) { out.errors.push(`The ${name} is not base64url-encoded JSON (${e.message}).`); }
    }
    try { out.signature = b64uDec(parts[2]); } catch (e) { out.errors.push('The signature is not base64url.'); }
    return out;
  }
  async function sign(header, payload, key) {
    const alg = header.alg; const a = ALGS[alg];
    if (alg === 'none') return b64uEnc(utf8(JSON.stringify(header))) + '.' + b64uEnc(utf8(JSON.stringify(payload))) + '.';
    if (!a) throw new Error('unsupported algorithm ' + alg);
    const input = b64uEnc(utf8(JSON.stringify(header))) + '.' + b64uEnc(utf8(JSON.stringify(payload)));
    let k = key;
    if (!(k && k.type)) k = await importKey(key, alg, 'sign');   // a JWK was given
    const sig = a.kty === 'oct' ? await subtle.sign(a.sign, k, utf8(input)) : await subtle.sign(a.sign, k, utf8(input));
    return input + '.' + b64uEnc(new Uint8Array(sig));
  }
  // The checks a validator must make, each reported on its own so a learner can see which one failed.
  // opts: { algorithms: ['RS256'], key (JWK), issuer, audience, now (seconds), leeway, requireExp }
  async function verify(token, opts) {
    const p = parse(token); const checks = []; const add = (name, ok, detail) => checks.push({ name, ok, detail });
    if (p.errors.length || !p.header || !p.payload) { add('Well formed', false, p.errors.join(' ')); return { ok: false, checks, parsed: p }; }
    add('Well formed', true, 'three base64url parts; header and payload are JSON');
    const alg = p.header.alg;
    const allowed = opts.algorithms || [];
    add('Algorithm is on the verifier’s allow-list', allowed.includes(alg), `token says alg=${alg}; allowed: ${allowed.join(', ') || '(none given)'}`);
    let sigOk = false;
    if (allowed.includes(alg) && ALGS[alg] && p.signature) {
      try {
        const k = await importKey(opts.key, alg, 'verify');
        sigOk = await subtle.verify(ALGS[alg].sign, k, p.signature, utf8(p.signingInput));
      } catch (e) { sigOk = false; add('Key fits the algorithm', false, e.message); }
    }
    add('Signature is valid', sigOk, sigOk ? 'recomputed with the key and it matches' : 'the signature does not match the header and payload for this key');
    const now = opts.now === undefined ? Math.floor(Date.now() / 1000) : opts.now, leeway = opts.leeway || 0;
    const c = p.payload;
    if (opts.issuer !== undefined) add('Issuer is the expected one', c.iss === opts.issuer, `iss=${JSON.stringify(c.iss)}; expected ${JSON.stringify(opts.issuer)}`);
    if (opts.audience !== undefined) { const aud = [].concat(c.aud === undefined ? [] : c.aud); add('Audience includes this API', aud.includes(opts.audience), `aud=${JSON.stringify(c.aud)}; expected ${JSON.stringify(opts.audience)}`); }
    if (c.exp !== undefined || opts.requireExp) add('Not expired', typeof c.exp === 'number' && now <= c.exp + leeway, `exp=${c.exp}; now=${now}`);
    if (c.nbf !== undefined) add('Already valid (nbf)', typeof c.nbf === 'number' && now + leeway >= c.nbf, `nbf=${c.nbf}; now=${now}`);
    return { ok: checks.every((x) => x.ok), checks, parsed: p };
  }

  // ---------------------------------------------------------------- PKCE (RFC 7636)
  const pkceVerifier = () => b64uEnc(random(32));
  const pkceChallenge = async (verifier) => b64uEnc(await sha('SHA-256', verifier));

  // ---------------------------------------------------------------- HOTP and TOTP (RFC 4226, RFC 6238)
  async function hotp(secret, counter, digits = 6, alg = 'SHA-1') {
    const msg = new Uint8Array(8); new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
    const h = await hmac(alg, secret, msg);
    const off = h[h.length - 1] & 0x0f;
    const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  }
  const totp = (secret, unixSeconds, opts = {}) => hotp(secret, Math.floor(unixSeconds / (opts.step || 30)), opts.digits || 6, opts.alg || 'SHA-1');

  return { utf8, fromUtf8, b64uEnc, b64uDec, hexEnc, hexDec, b32Dec, concat, random, sha, hmac, ALGS, importKey, generateKeyPair, thumbprint, parse, sign, verify, pkceVerifier, pkceChallenge, hotp, totp };
});
