// DPoP proofs (RFC 9449): build one, and check one the way a server must. Pure functions over IACrypto.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crypto.js'));
  else root.IADpop = factory(root.IACrypto);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const PUBLIC_MEMBERS = { EC: ['kty', 'crv', 'x', 'y'], OKP: ['kty', 'crv', 'x'], RSA: ['kty', 'n', 'e'] };
  const publicOnly = (jwk) => { const o = {}; for (const m of PUBLIC_MEMBERS[jwk.kty] || []) o[m] = jwk[m]; return o; };
  // htu is the target URI without its query and fragment (RFC 9449 section 4.2)
  const htuOf = (url) => { const u = new URL(url); return u.origin + u.pathname; };
  async function makeProof(o) {
    const header = { typ: 'dpop+jwt', alg: o.alg || 'ES256', jwk: publicOnly(o.publicJwk) };
    const payload = { jti: o.jti || C.b64uEnc(C.random(12)), htm: o.htm, htu: htuOf(o.htu), iat: o.iat === undefined ? Math.floor(Date.now() / 1000) : o.iat };
    if (o.accessToken) payload.ath = C.b64uEnc(await C.sha('SHA-256', o.accessToken));
    if (o.nonce) payload.nonce = o.nonce;
    return C.sign(header, payload, o.privateJwk);
  }
  // opts: { htm, htu, accessToken, boundJkt, now, maxAgeSeconds, seenJti: Set, nonce }
  async function checkProof(proof, opts) {
    const checks = []; const add = (name, ok, detail) => checks.push({ name, ok, detail });
    const p = C.parse(proof);
    if (p.errors.length || !p.header || !p.payload) { add('Well formed', false, p.errors.join(' ')); return { ok: false, checks }; }
    add('Well formed', true, 'a JWT with a header and a payload');
    const h = p.header, c = p.payload;
    add('typ is dpop+jwt', h.typ === 'dpop+jwt', `typ=${JSON.stringify(h.typ)}`);
    const asym = typeof h.alg === 'string' && h.alg !== 'none' && !/^HS/.test(h.alg) && !!C.ALGS[h.alg];
    add('alg is an asymmetric signature algorithm', asym, `alg=${JSON.stringify(h.alg)}`);
    const jwkOk = h.jwk && typeof h.jwk === 'object' && !('d' in h.jwk) && !('k' in h.jwk) && !!PUBLIC_MEMBERS[h.jwk.kty];
    add('header has a public key (jwk) with no private part', !!jwkOk, jwkOk ? 'kty=' + h.jwk.kty : 'a DPoP proof carries the public key it is signed with');
    let sigOk = false;
    if (asym && jwkOk) { try { const k = await C.importKey(h.jwk, h.alg, 'verify'); sigOk = await crypto.subtle.verify(C.ALGS[h.alg].sign, k, p.signature, C.utf8(p.signingInput)); } catch (e) { sigOk = false; } }
    add('signature verifies with that key', sigOk, sigOk ? 'the sender holds the private key' : 'the signature does not match the header and payload');
    add('htm is the request method', c.htm === opts.htm, `htm=${JSON.stringify(c.htm)}; request is ${opts.htm}`);
    add('htu is the request URI without query and fragment', c.htu === htuOf(opts.htu), `htu=${JSON.stringify(c.htu)}; request is ${htuOf(opts.htu)}`);
    const now = opts.now === undefined ? Math.floor(Date.now() / 1000) : opts.now, age = opts.maxAgeSeconds || 300;
    add('iat is recent', typeof c.iat === 'number' && Math.abs(now - c.iat) <= age, `iat=${c.iat}; now=${now}; window ±${age}s`);
    const fresh = typeof c.jti === 'string' && c.jti.length > 0 && !(opts.seenJti && opts.seenJti.has(c.jti));
    add('jti is present and not seen before', fresh, fresh ? 'a unique id lets the server refuse a replay' : 'missing or already used');
    if (opts.accessToken !== undefined) { const ath = C.b64uEnc(await C.sha('SHA-256', opts.accessToken)); add('ath is the hash of the access token', c.ath === ath, `ath=${JSON.stringify(c.ath)}`); }
    if (opts.boundJkt !== undefined && jwkOk) { let t = ''; try { t = await C.thumbprint(h.jwk); } catch (e) { /* mismatch below */ } add('the key matches the one the token is bound to (cnf.jkt)', t === opts.boundJkt, `thumbprint of the proof key ${t}; token bound to ${opts.boundJkt}`); }
    if (opts.nonce !== undefined) add('nonce is the one the server issued', c.nonce === opts.nonce, `nonce=${JSON.stringify(c.nonce)}`);
    return { ok: checks.every((x) => x.ok), checks, parsed: p };
  }
  return { makeProof, checkProof, htuOf, publicOnly };
});
