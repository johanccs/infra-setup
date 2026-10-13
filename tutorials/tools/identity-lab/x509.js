// A small X.509 certificate reader for the Identity and Access Lab: PEM and DER in, fields, chain and host-name checks out.
// Pure JavaScript on the Web Crypto API (no DOM). Anything it does not decode is reported as "not decoded", never guessed.
// Formats: RFC 5280 (certificates), RFC 7468 (PEM), RFC 9525 (matching a name), RFC 4055 and RFC 8410 (algorithm identifiers).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis.crypto);
  else root.IAX509 = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';
  const subtle = webcrypto.subtle;

  // ---------------------------------------------------------------- PEM
  function pemBlocks(text) {
    const out = []; const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g; let m;
    while ((m = re.exec(text))) {
      const body = m[2].replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) throw new Error('A ' + m[1] + ' block contains characters that are not base64.');
      const bin = atob(body); const der = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
      out.push({ label: m[1], der });
    }
    return out;
  }
  function toPem(der, label = 'CERTIFICATE') {
    let s = ''; for (let i = 0; i < der.length; i++) s += String.fromCharCode(der[i]);
    return `-----BEGIN ${label}-----\n${btoa(s).replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;
  }

  // ---------------------------------------------------------------- DER (ITU-T X.690) reader
  function tlv(buf, off) {
    if (off + 2 > buf.length) throw new Error('DER ends too early');
    const tag = buf[off]; let len = buf[off + 1], hdr = 2;
    if (len & 0x80) {
      const n = len & 0x7f; if (n === 0 || n > 4) throw new Error('unsupported DER length');
      len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i]; hdr = 2 + n;
    }
    if (off + hdr + len > buf.length) throw new Error('DER element runs past the end');
    return { tag, off, hdr, len, start: off + hdr, end: off + hdr + len };
  }
  function kids(buf, node) { const out = []; let o = node.start; while (o < node.end) { const t = tlv(buf, o); out.push(t); o = t.end; } return out; }
  const slice = (buf, n) => buf.subarray(n.start, n.end);
  const whole = (buf, n) => buf.subarray(n.off, n.end);
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  function oid(buf, n) {
    const b = slice(buf, n); const parts = []; let v = 0;
    for (let i = 0; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0; } }
    const first = parts.shift(); return [Math.min(2, Math.floor(first / 40)), first - 40 * Math.min(2, Math.floor(first / 40)), ...parts].join('.');
  }
  function str(buf, n) {
    const b = slice(buf, n);
    if (n.tag === 0x1e) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] * 256 + b[i + 1]); return s; }
    if (n.tag === 0x0c) return new TextDecoder().decode(b);
    return String.fromCharCode(...b);   // PrintableString, IA5String, T61String
  }
  function time(buf, n) {
    const s = String.fromCharCode(...slice(buf, n));
    let m;
    if (n.tag === 0x17 && (m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s))) { const y = +m[1]; return new Date(Date.UTC(y >= 50 ? 1900 + y : 2000 + y, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))); }
    if (n.tag === 0x18 && (m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s))) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    throw new Error('unsupported time ' + s);
  }
  function int(buf, n) { const b = slice(buf, n); let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; }

  // ---------------------------------------------------------------- names for object identifiers
  const DN = { '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber', '1.2.840.113549.1.9.1': 'emailAddress', '0.9.2342.19200300.100.1.25': 'DC' };
  const SIG = {
    '1.2.840.113549.1.1.5': { name: 'sha1WithRSAEncryption', kind: 'rsa', hash: 'SHA-1', weak: true },
    '1.2.840.113549.1.1.11': { name: 'sha256WithRSAEncryption', kind: 'rsa', hash: 'SHA-256' },
    '1.2.840.113549.1.1.12': { name: 'sha384WithRSAEncryption', kind: 'rsa', hash: 'SHA-384' },
    '1.2.840.113549.1.1.13': { name: 'sha512WithRSAEncryption', kind: 'rsa', hash: 'SHA-512' },
    '1.2.840.113549.1.1.10': { name: 'rsassaPss', kind: 'pss' },
    '1.2.840.10045.4.1': { name: 'ecdsa-with-SHA1', kind: 'ecdsa', hash: 'SHA-1', weak: true },
    '1.2.840.10045.4.3.2': { name: 'ecdsa-with-SHA256', kind: 'ecdsa', hash: 'SHA-256' },
    '1.2.840.10045.4.3.3': { name: 'ecdsa-with-SHA384', kind: 'ecdsa', hash: 'SHA-384' },
    '1.2.840.10045.4.3.4': { name: 'ecdsa-with-SHA512', kind: 'ecdsa', hash: 'SHA-512' },
    '1.3.101.112': { name: 'Ed25519', kind: 'ed25519' },
  };
  const CURVE = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521' };
  const HASH_OID = { '1.3.14.3.2.26': 'SHA-1', '2.16.840.1.101.3.4.2.1': 'SHA-256', '2.16.840.1.101.3.4.2.2': 'SHA-384', '2.16.840.1.101.3.4.2.3': 'SHA-512' };
  const EKU = { '1.3.6.1.5.5.7.3.1': 'serverAuth', '1.3.6.1.5.5.7.3.2': 'clientAuth', '1.3.6.1.5.5.7.3.3': 'codeSigning', '1.3.6.1.5.5.7.3.4': 'emailProtection', '1.3.6.1.5.5.7.3.8': 'timeStamping', '1.3.6.1.5.5.7.3.9': 'OCSPSigning', '2.5.29.37.0': 'anyExtendedKeyUsage' };
  const KU = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];
  const EXT = { '2.5.29.14': 'subjectKeyIdentifier', '2.5.29.15': 'keyUsage', '2.5.29.17': 'subjectAltName', '2.5.29.19': 'basicConstraints', '2.5.29.31': 'cRLDistributionPoints', '2.5.29.32': 'certificatePolicies', '2.5.29.35': 'authorityKeyIdentifier', '2.5.29.37': 'extKeyUsage', '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess', '1.3.6.1.4.1.11129.2.4.2': 'signedCertificateTimestamps', '2.5.29.30': 'nameConstraints' };

  function name(buf, n) {
    const rdns = [];
    for (const set of kids(buf, n)) for (const atv of kids(buf, set)) {
      const [o, v] = kids(buf, atv); const id = oid(buf, o);
      rdns.push({ oid: id, type: DN[id] || id, value: str(buf, v) });
    }
    return { rdns, text: rdns.map((r) => `${r.type}=${r.value}`).join(', '), der: whole(buf, n) };
  }
  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function algId(buf, n) { const [o, p] = kids(buf, n); return { oid: oid(buf, o), params: p || null }; }

  // ---------------------------------------------------------------- one certificate
  function parseCertificate(der) {
    const cert = { der, notDecoded: [] };
    const top = tlv(der, 0);
    if (top.tag !== 0x30 || top.end !== der.length) throw new Error('This is not one DER-encoded certificate (it must be a single SEQUENCE).');
    const [tbs, sigAlg, sigVal] = kids(der, top);
    cert.tbsDer = whole(der, tbs);
    const f = kids(der, tbs); let i = 0;
    cert.version = 1;
    if (f[i].tag === 0xa0) { cert.version = Number(int(der, kids(der, f[i])[0])) + 1; i++; }
    cert.serial = hex(slice(der, f[i++])).replace(/^(00)+(?=.)/, '');
    const inner = algId(der, f[i++]);
    cert.issuer = name(der, f[i++]);
    const [nb, na] = kids(der, f[i++]);
    cert.notBefore = time(der, nb); cert.notAfter = time(der, na);
    cert.subject = name(der, f[i++]);
    const spki = f[i++]; cert.spkiDer = whole(der, spki);
    const [spkiAlg, spkiBits] = kids(der, spki);
    const ka = algId(der, spkiAlg);
    cert.publicKey = { oid: ka.oid, type: 'unknown' };
    const keyBytes = slice(der, spkiBits).subarray(1);
    if (ka.oid === '1.2.840.113549.1.1.1') {
      const [n] = kids(keyBytes, tlv(keyBytes, 0)); let nb2 = keyBytes.subarray(n.start, n.end);
      while (nb2.length > 1 && nb2[0] === 0) nb2 = nb2.subarray(1);
      const bits = (nb2.length - 1) * 8 + (8 - (Math.clz32(nb2[0]) - 24));
      cert.publicKey = { oid: ka.oid, type: 'RSA', bits };
    } else if (ka.oid === '1.2.840.10045.2.1') {
      const curve = ka.params && ka.params.tag === 0x06 ? CURVE[oid(der, ka.params)] : undefined;
      cert.publicKey = { oid: ka.oid, type: 'EC', curve: curve || 'unknown curve', bits: { 'P-256': 256, 'P-384': 384, 'P-521': 521 }[curve] };
    } else if (ka.oid === '1.3.101.112') cert.publicKey = { oid: ka.oid, type: 'Ed25519', bits: 256 };
    else cert.notDecoded.push('public key type ' + ka.oid);
    cert.signatureAlgorithm = Object.assign({ oid: inner.oid }, SIG[inner.oid] || { name: inner.oid, kind: 'unknown' });
    if (cert.signatureAlgorithm.kind === 'pss' && inner.params) {
      const p = { hash: 'SHA-1', saltLength: 20 };
      for (const c of kids(der, inner.params)) {
        const k = kids(der, c)[0];
        if (c.tag === 0xa0) p.hash = HASH_OID[oid(der, kids(der, k)[0])] || 'unknown';
        if (c.tag === 0xa2) p.saltLength = Number(int(der, k));
      }
      cert.signatureAlgorithm.pss = p; cert.signatureAlgorithm.name = `rsassaPss (${p.hash}, salt ${p.saltLength})`;
    }
    cert.signature = slice(der, sigVal).subarray(1);
    cert.san = { dns: [], ip: [], email: [], uri: [] };
    cert.extensions = []; cert.basicConstraints = null; cert.keyUsage = null; cert.extKeyUsage = null;
    for (; i < f.length; i++) {
      if (f[i].tag !== 0xa3) continue;
      for (const e of kids(der, kids(der, f[i])[0])) {
        const p = kids(der, e); const id = oid(der, p[0]);
        const critical = p.length === 3 && p[1].tag === 0x01 && der[p[1].start] !== 0;
        const val = p[p.length - 1];
        const ext = { oid: id, name: EXT[id] || id, critical, value: slice(der, val) };
        cert.extensions.push(ext);
        const v = ext.value;
        try {
          if (id === '2.5.29.17') {
            for (const g of kids(v, tlv(v, 0))) {
              const b = v.subarray(g.start, g.end);
              if (g.tag === 0x82) cert.san.dns.push(String.fromCharCode(...b));
              else if (g.tag === 0x87) cert.san.ip.push(b.length === 4 ? Array.from(b).join('.') : Array.from({ length: 8 }, (_, k) => ((b[2 * k] << 8) | b[2 * k + 1]).toString(16)).join(':'));
              else if (g.tag === 0x81) cert.san.email.push(String.fromCharCode(...b));
              else if (g.tag === 0x86) cert.san.uri.push(String.fromCharCode(...b));
            }
          } else if (id === '2.5.29.19') {
            const seq = tlv(v, 0); const k = kids(v, seq); let ca = false, pathLen = null;
            for (const x of k) { if (x.tag === 0x01) ca = v[x.start] !== 0; if (x.tag === 0x02) pathLen = Number(int(v, x)); }
            cert.basicConstraints = { ca, pathLen };
          } else if (id === '2.5.29.15') {
            const bs = tlv(v, 0); const unused = v[bs.start]; const bits = v.subarray(bs.start + 1, bs.end);
            cert.keyUsage = KU.filter((_, k) => k < bits.length * 8 - unused && (bits[k >> 3] & (0x80 >> (k & 7))));
          } else if (id === '2.5.29.37') {
            cert.extKeyUsage = kids(v, tlv(v, 0)).map((x) => EKU[oid(v, x)] || oid(v, x));
          } else if (id === '2.5.29.14') {
            const o = tlv(v, 0); cert.subjectKeyId = hex(v.subarray(o.start, o.end));
          } else if (id === '2.5.29.35') {
            const seq = tlv(v, 0); const first = kids(v, seq).find((x) => x.tag === 0x80);
            if (first) cert.authorityKeyId = hex(v.subarray(first.start, first.end));
          }
        } catch (err) { cert.notDecoded.push(ext.name + ' (' + err.message + ')'); }
      }
    }
    cert.selfIssued = sameBytes(cert.issuer.der, cert.subject.der);
    return cert;
  }

  // Everything found in some text: PEM certificates (one or many), or a single base64/DER blob.
  function parseAll(text) {
    const blocks = pemBlocks(text);
    const certs = blocks.filter((b) => b.label === 'CERTIFICATE' || b.label === 'TRUSTED CERTIFICATE').map((b) => parseCertificate(b.der));
    const ignored = blocks.filter((b) => !/CERTIFICATE/.test(b.label)).map((b) => b.label);
    return { certs, ignored };
  }

  // ---------------------------------------------------------------- signatures
  // ECDSA signatures inside a certificate are DER SEQUENCE { r, s }; Web Crypto wants r || s, each padded to the curve size.
  function ecdsaToRaw(sig, size) {
    const seq = tlv(sig, 0); const [r, s] = kids(sig, seq); const out = new Uint8Array(size * 2);
    for (const [part, off] of [[r, 0], [s, size]]) { let b = sig.subarray(part.start, part.end); while (b.length > size && b[0] === 0) b = b.subarray(1); if (b.length > size) throw new Error('ECDSA value too long'); out.set(b, off + size - b.length); }
    return out;
  }
  // Is `cert` signed by the key in `issuer`? Returns { ok, reason }.
  async function verifySignature(cert, issuer) {
    const a = cert.signatureAlgorithm, k = issuer.publicKey;
    try {
      if (a.kind === 'rsa' || a.kind === 'pss') {
        if (k.type !== 'RSA') return { ok: false, reason: `the signature is ${a.name} but the issuer's key is ${k.type}` };
        const hash = a.kind === 'pss' ? a.pss.hash : a.hash;
        const alg = a.kind === 'pss' ? { name: 'RSA-PSS', hash } : { name: 'RSASSA-PKCS1-v1_5', hash };
        const key = await subtle.importKey('spki', issuer.spkiDer, alg, false, ['verify']);
        const ok = await subtle.verify(a.kind === 'pss' ? { name: 'RSA-PSS', saltLength: a.pss.saltLength } : alg, key, cert.signature, cert.tbsDer);
        return { ok, reason: ok ? 'valid' : 'the signature does not match this certificate for the issuer\'s key' };
      }
      if (a.kind === 'ecdsa') {
        if (k.type !== 'EC') return { ok: false, reason: `the signature is ${a.name} but the issuer's key is ${k.type}` };
        const size = Math.ceil(k.bits / 8);
        const key = await subtle.importKey('spki', issuer.spkiDer, { name: 'ECDSA', namedCurve: k.curve }, false, ['verify']);
        const ok = await subtle.verify({ name: 'ECDSA', hash: a.hash }, key, ecdsaToRaw(cert.signature, size), cert.tbsDer);
        return { ok, reason: ok ? 'valid' : 'the signature does not match this certificate for the issuer\'s key' };
      }
      if (a.kind === 'ed25519') {
        if (k.type !== 'Ed25519') return { ok: false, reason: `the signature is Ed25519 but the issuer's key is ${k.type}` };
        const key = await subtle.importKey('spki', issuer.spkiDer, { name: 'Ed25519' }, false, ['verify']);
        const ok = await subtle.verify({ name: 'Ed25519' }, key, cert.signature, cert.tbsDer);
        return { ok, reason: ok ? 'valid' : 'the signature does not match this certificate for the issuer\'s key' };
      }
    } catch (e) { return { ok: false, reason: 'could not check it: ' + e.message }; }
    return { ok: false, reason: 'unsupported signature algorithm ' + a.name };
  }

  // ---------------------------------------------------------------- matching a host name (RFC 9525)
  // Only subject alternative names identify a service. The common name is never used (RFC 9525, section 2).
  function matchHost(cert, host) {
    const h = host.trim().toLowerCase().replace(/\.$/, '');
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
    if (isIp) { const ok = cert.san.ip.includes(h); return { ok, reason: ok ? `matches the IP address ${h} in the subject alternative names` : `${h} is not one of the IP addresses in the subject alternative names (${cert.san.ip.join(', ') || 'none'})` }; }
    if (!cert.san.dns.length) return { ok: false, reason: 'the certificate has no DNS names in a subject alternative name extension, and the common name is not used to identify a service (RFC 9525)' };
    const hl = h.split('.');
    for (const p0 of cert.san.dns) {
      const p = p0.toLowerCase().replace(/\.$/, ''); const pl = p.split('.');
      if (pl.length !== hl.length) continue;
      const okLabels = pl.every((lab, k) => (k === 0 && lab === '*') ? hl[0].length > 0 : lab === hl[k]);
      if (okLabels) return { ok: true, reason: p === h ? `matches the name ${p0}` : `matches the wildcard ${p0} (one label only)` };
    }
    return { ok: false, reason: `${h} is not covered by ${cert.san.dns.join(', ')}` };
  }

  // ---------------------------------------------------------------- chains
  // Put certificates in order from the one that identifies the service up to the root. Returns { chain, extra }.
  function order(certs) {
    const issuerOf = (c, pool) => pool.find((x) => x !== c && sameBytes(x.subject.der, c.issuer.der) && (!c.authorityKeyId || !x.subjectKeyId || c.authorityKeyId === x.subjectKeyId));
    const isIssuerOfSomething = (c) => certs.some((x) => x !== c && !x.selfIssued && sameBytes(x.issuer.der, c.subject.der));
    const leaf = certs.find((c) => !isIssuerOfSomething(c)) || certs[0];
    const chain = [leaf]; const seen = new Set([leaf]);
    while (chain.length < certs.length) {
      const last = chain[chain.length - 1]; if (last.selfIssued) break;
      const nxt = issuerOf(last, certs); if (!nxt || seen.has(nxt)) break;
      chain.push(nxt); seen.add(nxt);
    }
    return { chain, extra: certs.filter((c) => !seen.has(c)) };
  }
  // opts: { host, now (Date), trusted: [certs] }. Each problem is { cert: index, level: 'error'|'warn', text }.
  async function checkChain(certs, opts = {}) {
    const now = opts.now || new Date(); const { chain, extra } = order(certs); const problems = []; const steps = [];
    const add = (i, level, text) => problems.push({ cert: i, level, text });
    for (let i = 0; i < chain.length; i++) {
      const c = chain[i], issuer = chain[i + 1] || (c.selfIssued ? c : (opts.trusted || []).find((t) => sameBytes(t.subject.der, c.issuer.der)));
      const role = i === 0 ? 'leaf' : c.selfIssued ? 'root' : 'intermediate';
      if (now < c.notBefore) add(i, 'error', `is not valid yet (starts ${c.notBefore.toISOString().slice(0, 10)})`);
      if (now > c.notAfter) add(i, 'error', `has expired (ended ${c.notAfter.toISOString().slice(0, 10)})`);
      if (c.signatureAlgorithm.weak) add(i, 'error', `is signed with ${c.signatureAlgorithm.name}, which is no longer accepted`);
      if (c.publicKey.type === 'RSA' && c.publicKey.bits < 2048) add(i, 'error', `has a ${c.publicKey.bits}-bit RSA key; 2048 bits is the minimum`);
      if (i === 0) {
        if (c.basicConstraints && c.basicConstraints.ca) add(i, 'warn', 'is marked as a CA, but it identifies the service');
        if (c.extKeyUsage && !c.extKeyUsage.includes('serverAuth') && !c.extKeyUsage.includes('anyExtendedKeyUsage')) add(i, 'error', `is not allowed to be a TLS server certificate (extended key usage: ${c.extKeyUsage.join(', ')})`);
        if (opts.host) { const m = matchHost(c, opts.host); if (!m.ok) add(i, 'error', `does not match ${opts.host}: ${m.reason}`); }
      } else {
        if (!c.basicConstraints || !c.basicConstraints.ca) add(i, 'error', 'signs another certificate but is not marked CA:TRUE');
        if (c.keyUsage && !c.keyUsage.includes('keyCertSign')) add(i, 'error', 'signs another certificate but its key usage does not include keyCertSign');
        if (c.basicConstraints && c.basicConstraints.pathLen !== null && c.basicConstraints.pathLen < i - 1) add(i, 'error', `allows at most ${c.basicConstraints.pathLen} CA below it, but there are ${i - 1}`);
      }
      let sig;
      if (issuer) { sig = await verifySignature(c, issuer); if (!sig.ok) add(i, 'error', `signature check against ${issuer === c ? 'its own key' : 'the next certificate'} fails: ${sig.reason}`); }
      steps.push({ index: i, role, subject: c.subject.text, issuer: c.issuer.text, signature: issuer ? sig : null, signedBy: issuer ? (issuer === c ? 'itself' : issuer.subject.text) : null });
    }
    const top = chain[chain.length - 1];
    const anchored = top.selfIssued || (opts.trusted || []).some((t) => sameBytes(t.subject.der, top.issuer.der));
    if (!anchored) add(chain.length - 1, 'error', `its issuer (${top.issuer.text}) is not in what was supplied: the chain is incomplete, or a server that sends it forgot an intermediate`);
    return { chain, extra, steps, problems, ok: !problems.some((p) => p.level === 'error') };
  }

  return { pemBlocks, toPem, parseCertificate, parseAll, verifySignature, matchHost, order, checkChain };
});
