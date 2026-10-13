// Exercises and command drills for steps 04 to 08 (TLS, certificates, your own CA, production, mutual TLS).
(function () {
  var IA = window.IA, X = IA.exercises;
  IA.cmds = IA.cmds || {};
  var S = function (cmd, o) { return window.IACmdSpec.spec(IA.cmdFlags, cmd, o); };
  var pos = function (re, label, what, hint) { return { match: re, label: label, what: what, hint: hint }; };
  var url = /^https:\/\/localhost:5443\/?$/;
  function drill(id, prompt, specs, answer, hints, after, run) { IA.cmds[id] = { prompt: prompt, specs: specs, answer: answer, hints: hints || [], after: after || '', run: run || null }; }
  var CA = { '-CAfile': { value: /^root\.pem$/, what: 'trust this root certificate file' } };

  // ------------------------------------------------------------------ 04
  drill('t4-curlv', '<p>Call <code>https://localhost:5443/</code> with <code>curl</code>. Trust the root in <code>root.pem</code>, and print the handshake details (verbose).</p>',
    S('curl', { what: 'make an HTTP request', need: { '--verbose': { value: false, what: 'print what happens, including the TLS handshake' }, '--cacert': { value: /^root\.pem$/, what: 'trust the CA certificate in this file', bad: function (g) { return '<code>--cacert ' + g + '</code>: the root certificate file is <code>root.pem</code>.'; } } }, pos: [pos(url, 'the URL', 'what to call', 'https://localhost:5443/')] }),
    'curl -v --cacert root.pem https://localhost:5443/', ['Verbose is <code>-v</code>.', 'The flag that adds a CA certificate is <code>--cacert</code>.'], 'Look for the lines starting <code>* TLSv1.3 (IN)</code>: they are the handshake messages of the diagram, in order.', { expect: /TLSv1\.3/ });
  drill('t4-tls13', '<p>Call the same address, trusting <code>root.pem</code>, and make <code>curl</code> use <b>TLS 1.3 only</b>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--tlsv1.3': { value: false, what: 'allow TLS 1.3 or newer only' }, '--cacert': { value: /^root\.pem$/, what: 'trust this root certificate file' } }, pos: [pos(url, 'the URL', 'what to call')] }),
    'curl --tlsv1.3 --cacert root.pem https://localhost:5443/', ['The flag is named after the version: <code>--tlsv1.3</code>.'], 'This is how you prove a server really does TLS 1.3.', { expect: /./ });
  drill('t4-tls12', '<p>Now force <b>TLS 1.2 only</b>: allow nothing older and nothing newer. Trust <code>root.pem</code>, and print the verbose output.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--tlsv1.2': { value: false, what: 'allow TLS 1.2 or newer' }, '--tls-max': { value: /^1\.2$/, what: 'but no newer than 1.2' }, '--verbose': { value: false, what: 'print the handshake' }, '--cacert': { value: /^root\.pem$/, what: 'trust this root certificate file' } }, pos: [pos(url, 'the URL', 'what to call')] }),
    'curl -v --tlsv1.2 --tls-max 1.2 --cacert root.pem https://localhost:5443/', ['<code>--tlsv1.2</code> sets the minimum. A second flag sets the maximum: <code>--tls-max</code>.'], 'In the verbose output the lines now say <code>TLSv1.2</code> and the key exchange has no <code>X25519MLKEM768</code>: the hybrid group is TLS 1.3 only.', { expect: /TLSv1\.2/ });
  drill('t4-sclient', '<p>Open a TLS connection to <code>localhost</code> port <code>5443</code> with <code>openssl s_client</code>, trusting <code>root.pem</code>.</p>',
    S('openssl s_client', { what: 'open a TLS connection and show what happened', need: { '-connect': { value: /^localhost:5443$/, what: 'host and port to connect to' }, '-CAfile': { value: /^root\.pem$/, what: 'trust this root certificate file' } } }),
    'openssl s_client -connect localhost:5443 -CAfile root.pem', ['The flag that names the target is <code>-connect</code>, as <code>host:port</code>.', 'The trust file for OpenSSL is <code>-CAfile</code>.'], 'Read <code>Protocol</code>, <code>Cipher</code> and <code>Verify return code</code> in the output. Press Ctrl+D to leave.', { expect: /Verification: OK/ });
  drill('t4-sni', '<p>Do the same, and also send the <b>server name</b> <code>localhost</code> in the ClientHello.</p>',
    S('openssl s_client', { what: 'open a TLS connection', need: { '-connect': { value: /^localhost:5443$/, what: 'host and port' }, '-servername': { value: /^localhost$/, what: 'the server_name (SNI) to send' }, '-CAfile': { value: /^root\.pem$/, what: 'trust this root' } } }),
    'openssl s_client -connect localhost:5443 -servername localhost -CAfile root.pem', ['The SNI flag is <code>-servername</code>.'], 'One server can hold many certificates and use the name to choose the right one. That name is the part that Encrypted Client Hello hides.', { expect: /Verification: OK/ });

  X['t4-order'] = { kind: 'order', prompt: '<p>Put the TLS 1.3 handshake messages in the order they are sent.</p>',
    items: ['<code>ClientHello</code> (with the client\'s key share)', '<code>ServerHello</code> (with the server\'s key share)', '<code>Certificate</code> (the server\'s chain, encrypted)', '<code>CertificateVerify</code> (a signature with the private key)', 'Server <code>Finished</code>', 'Client <code>Finished</code>', 'Application data'],
    hints: ['Keys can only be shared after the ClientHello and ServerHello. The proof of identity comes after the encryption starts.'] };
  X['t4-hides'] = { kind: 'sort', prompt: '<p>Someone is watching the network between you and an HTTPS site, and Encrypted Client Hello is <b>not</b> in use. What can they see?</p>',
    groups: ['Hidden from them', 'Visible to them'],
    items: [
      { t: 'The text of the page.', g: 0, why: 'The HTTP response is inside the encrypted connection.' },
      { t: 'The <code>Authorization</code> header and cookies.', g: 0, why: 'Headers are part of the encrypted HTTP request.' },
      { t: 'The path and query string of the URL (<code>/api/todos?id=7</code>).', g: 0, why: 'Only the host name is used outside the encryption. The path travels inside.' },
      { t: 'The server name you are connecting to (SNI).', g: 1, why: 'It is in the ClientHello, before encryption starts. Encrypted Client Hello exists to hide it.' },
      { t: 'The IP address of the server.', g: 1, why: 'Packets must be routed to it.' },
      { t: 'Roughly how much data moves and when.', g: 1, why: 'TLS hides content, not volume and timing. RFC 9846 discusses this under traffic analysis and offers record padding to reduce it.' },
    ] };
  X['t4-0rtt'] = { kind: 'quiz', prompt: '<p>TLS 1.3 allows a returning client to send <b>early data</b> in its first flight, which a network attacker can replay. Which request is the one a client may safely send as early data?</p>',
    options: [
      { t: '<code>POST /api/payments</code> to charge a card.', ok: false, why: 'A replay would charge the card again.' },
      { t: '<code>GET /api/info</code>, which only reads.', ok: true, why: 'RFC 9846: clients must only send early data they deem safe to be replayed. A read that changes nothing is.' },
      { t: '<code>DELETE /api/todos/5</code>.', ok: false, why: 'Replaying a delete can remove something else, or the same thing twice with side effects.' },
    ] };

  // ------------------------------------------------------------------ 05
  drill('t5-text', '<p>Print everything in the certificate <code>api.pem</code> in readable text, and not the encoded certificate itself.</p>',
    S('openssl x509', { what: 'read a certificate', need: { '-in': { value: /^api\.pem$/, what: 'the certificate file' }, '-noout': { value: false, what: 'do not also print the encoded certificate' }, '-text': { value: false, what: 'print all fields as text' } } }),
    'openssl x509 -in api.pem -noout -text', ['<code>-text</code> prints the fields. <code>-noout</code> leaves out the base64 block.'], 'Find <code>Subject Alternative Name</code>, <code>Basic Constraints</code> and <code>Not After</code>.', { expect: /Subject Alternative Name/ });
  drill('t5-dates', '<p>Print only the <b>validity dates</b> of <code>api.pem</code>.</p>',
    S('openssl x509', { what: 'read a certificate', need: { '-in': { value: /^api\.pem$/, what: 'the certificate file' }, '-noout': { value: false, what: 'print no encoded certificate' }, '-dates': { value: false, what: 'print notBefore and notAfter' } } }),
    'openssl x509 -in api.pem -noout -dates', ['The flag is named after what it prints.'], 'You will use this the day a certificate "suddenly" stops working.', { expect: /notAfter=/ });
  drill('t5-san', '<p>Print only the <b>subject alternative names</b> of <code>api.pem</code>.</p>',
    S('openssl x509', { what: 'read a certificate', need: { '-in': { value: /^api\.pem$/, what: 'the certificate file' }, '-noout': { value: false, what: 'print no encoded certificate' }, '-ext': { value: /^subjectAltName$/i, what: 'print only this extension', bad: function () { return 'Name the extension: <code>subjectAltName</code>.'; } } } }),
    'openssl x509 -in api.pem -noout -ext subjectAltName', ['Extensions are printed with <code>-ext</code> and the extension\'s name.'], 'This is the list the host name is matched against.', { expect: /DNS:localhost/ });
  drill('t5-verify', '<p>Check that <code>api.pem</code> chains to the root in <code>root.pem</code>.</p>',
    S('openssl verify', { what: 'verify a certificate chain', need: { '-CAfile': { value: /^root\.pem$/, what: 'the trusted root' } }, pos: [pos(/^api\.pem$/, 'the certificate to check', 'the certificate', 'api.pem')] }),
    'openssl verify -CAfile root.pem api.pem', ['The file to check is a plain argument at the end.'], 'It prints <code>api.pem: OK</code>. Without <code>-CAfile</code> it fails with <code>unable to get local issuer certificate</code> because your system store does not hold this root.', { expect: /api\.pem: OK/ });
  drill('t5-showcerts', '<p>Connect to <code>localhost:5443</code> with <code>openssl s_client</code> and print <b>every certificate the server sends</b>.</p>',
    S('openssl s_client', { what: 'open a TLS connection', need: { '-connect': { value: /^localhost:5443$/, what: 'host and port' }, '-showcerts': { value: false, what: 'print the whole chain the server sent, in PEM' } } }),
    'openssl s_client -connect localhost:5443 -showcerts', ['One flag, named after what it does.'], 'This is how you find out whether a server sends its intermediates.', { expect: /BEGIN CERTIFICATE/ });

  X['t5-fields'] = { kind: 'inspect', prompt: '<p>Read this part of a certificate and answer.</p>',
    artifact: 'Subject:  CN=todo.example.com\nIssuer:   C=US, O=Example CA, CN=Example Issuing CA 1\nNot Before: 2026-09-01 00:00:00 UTC\nNot After:  2026-12-10 00:00:00 UTC\nX509v3 Subject Alternative Name:\n    DNS:todo.example.com, DNS:*.apps.example.com\nX509v3 Basic Constraints: critical\n    CA:FALSE\nX509v3 Extended Key Usage:\n    TLS Web Server Authentication',
    parts: [
      { kind: 'quiz', prompt: 'Is it valid for <code>shop.apps.example.com</code>?', options: [{ t: 'Yes, the wildcard covers one label.', ok: true, why: '<code>*.apps.example.com</code> matches exactly one label in front of <code>apps.example.com</code>.' }, { t: 'No, only <code>todo.example.com</code> is listed.', ok: false, why: 'The second SAN is a wildcard.' }] },
      { kind: 'quiz', prompt: 'Is it valid for <code>a.b.apps.example.com</code>?', options: [{ t: 'Yes, a wildcard covers any depth.', ok: false, why: 'A wildcard covers exactly one label.' }, { t: 'No, that has two labels before <code>apps.example.com</code>.', ok: true, why: 'One label only.' }] },
      { kind: 'quiz', prompt: 'May this certificate sign other certificates?', options: [{ t: 'Yes, it is signed by a CA.', ok: false, why: 'Being signed by a CA does not make it one.' }, { t: 'No, <code>CA:FALSE</code>.', ok: true, why: 'Basic constraints say it is not a CA.' }] },
      { kind: 'quiz', prompt: 'It is checked on 2027-01-15. Result?', options: [{ t: 'Expired.', ok: true, why: 'It ended on 2026-12-10.' }, { t: 'Still valid.', ok: false, why: 'The end date has passed.' }] },
    ] };
  X['t5-errors'] = { kind: 'sort', prompt: '<p>Match each message to its most likely cause.</p>',
    groups: ['The certificate is not trusted or the chain is incomplete', 'The name does not match', 'The dates are wrong'],
    items: [
      { t: '<code>unable to get local issuer certificate</code>', g: 0, why: 'The client could not build a path to a root it trusts.' },
      { t: '<code>no alternative certificate subject name matches target host name</code>', g: 1, why: 'The host name is not in the SAN.' },
      { t: '<code>certificate has expired</code>', g: 2, why: 'Past the not-after date.' },
      { t: '<code>self-signed certificate</code>', g: 0, why: 'The certificate is its own root, and that root is not in the trust store.' },
      { t: '<code>certificate is not yet valid</code>', g: 2, why: 'Before the not-before date. Often a wrong clock on the machine.' },
      { t: 'Works in the browser, fails in <code>curl</code> and .NET with the "issuer" error.', g: 0, why: 'The server probably did not send its intermediate. Browsers can often fetch it; most other clients do not.' },
    ] };
  X['t5-wild'] = { kind: 'sort', prompt: '<p>The certificate has the single name <code>*.example.com</code>. Does it cover each host?</p>',
    groups: ['Covered', 'Not covered'],
    items: [
      { t: '<code>shop.example.com</code>', g: 0, why: 'One label in front of <code>example.com</code>.' },
      { t: '<code>example.com</code>', g: 1, why: 'The wildcard needs a label. The bare domain must be its own name.' },
      { t: '<code>a.shop.example.com</code>', g: 1, why: 'Two labels.' },
      { t: '<code>api.example.com</code>', g: 0, why: 'One label.' },
      { t: '<code>example.org</code>', g: 1, why: 'A different domain.' },
    ] };

  // ------------------------------------------------------------------ 06
  var EC = { '-algorithm': { value: /^EC$/i, what: 'an elliptic curve key' }, '-pkeyopt': { value: /^ec_paramgen_curve:P-256$/, what: 'on the P-256 curve' } };
  drill('t6-rootkey', '<p>Create the root\'s private key: an <b>EC key on the P-256 curve</b>, written to <code>root.key</code>.</p>',
    S('openssl genpkey', { what: 'generate a private key', need: Object.assign({ '-out': { value: /^root\.key$/, what: 'write it to this file' } }, EC) }),
    'openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out root.key', ['The algorithm is named with <code>-algorithm</code>, the curve with <code>-pkeyopt ec_paramgen_curve:…</code>.'], 'Never share this file. Whoever has it can issue certificates that your machine trusts.', { expect: /^$/ });
  drill('t6-rootcert', '<p>Make the root certificate <code>root.pem</code> from <code>root.key</code>: self-signed, valid 3650 days, subject <code>/O=Lab Trust/CN=Lab Root CA</code>, marked <code>CA:TRUE</code> and allowed to sign certificates (<code>keyCertSign</code>).</p>',
    S('openssl req', { what: 'create a certificate request or self-signed certificate', need: {
      '-x509': { value: false, what: 'make a certificate directly instead of a request' }, '-new': { value: false, required: false, what: 'a new request' },
      '-key': { value: /^root\.key$/, what: 'sign with this private key' }, '-days': { value: /^\d+$/, what: 'valid for this many days' },
      '-subj': { value: /^\/.*CN=Lab Root CA/, what: 'the subject name' },
      '-addext': { value: true, repeat: true, what: 'add an extension', each: [{ match: /basicConstraints=.*CA:TRUE/i, missing: 'Mark it as a CA: <code>-addext "basicConstraints=critical,CA:TRUE"</code>.' }, { match: /keyUsage=.*keyCertSign/i, missing: 'Allow it to sign certificates: <code>-addext "keyUsage=critical,keyCertSign,cRLSign"</code>.' }] },
      '-out': { value: /^root\.pem$/, what: 'write the certificate to this file' } } }),
    'openssl req -x509 -new -key root.key -days 3650 -subj "/O=Lab Trust/CN=Lab Root CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out root.pem', ['<code>req -x509</code> makes a self-signed certificate. Extensions go in with <code>-addext</code>, once per extension.', 'The two extensions: <code>basicConstraints=critical,CA:TRUE</code> and <code>keyUsage=critical,keyCertSign,cRLSign</code>.'], 'The issuer and subject of this certificate are the same: it vouches for itself.', { expect: /^$/ });
  drill('t6-apikey', '<p>Create the API\'s own private key, on the same curve, written to <code>api.key</code>.</p>',
    S('openssl genpkey', { what: 'generate a private key', need: Object.assign({ '-out': { value: /^api\.key$/, what: 'write it to this file' } }, EC) }),
    'openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out api.key', ['The same command as for the root, with a different file name.'], 'This file belongs to the server and never goes to the CA.', { expect: /^$/ });
  drill('t6-csr', '<p>Make a certificate signing request <code>api.csr</code> for <code>api.key</code>, with the subject <code>/CN=localhost</code>.</p>',
    S('openssl req', { what: 'create a certificate request', need: { '-new': { value: false, what: 'a new request' }, '-key': { value: /^api\.key$/, what: 'the private key to build it from' }, '-subj': { value: /^\/CN=localhost$/, what: 'the subject name' }, '-out': { value: /^api\.csr$/, what: 'write the request here' } } }),
    'openssl req -new -key api.key -subj "/CN=localhost" -out api.csr', ['<code>req -new</code> without <code>-x509</code> makes a request, not a certificate.'], 'The request holds the public key and the names, signed with the private key to prove possession.', { expect: /^$/ });
  drill('t6-sign', '<p>Sign <code>api.csr</code> with the root: use <code>root.pem</code> and <code>root.key</code>, take the extensions from <code>api.ext</code>, make it valid for <b>90 days</b>, and write <code>api.pem</code>. Let OpenSSL create the serial number file.</p>',
    S('openssl x509', { what: 'sign a request', need: {
      '-req': { value: false, what: 'the input is a request' }, '-in': { value: /^api\.csr$/, what: 'the request to sign' },
      '-CA': { value: /^root\.pem$/, what: 'the CA certificate' }, '-CAkey': { value: /^root\.key$/, what: 'the CA private key' },
      '-CAcreateserial': { value: false, what: 'create the serial number file' },
      '-days': { value: function (v) { return /^\d+$/.test(v) && +v <= 200; }, what: 'valid for this many days', bad: function (g) { return '<code>-days ' + g + '</code>: use a number of days no larger than 200. Public CAs may not issue longer than that since March 2026, and short lives are the right habit for your own CA too.'; } },
      '-extfile': { value: /^api\.ext$/, what: 'take the extensions from this file' }, '-out': { value: /^api\.pem$/, what: 'write the certificate here' } } }),
    'openssl x509 -req -in api.csr -CA root.pem -CAkey root.key -CAcreateserial -days 90 -extfile api.ext -out api.pem', ['<code>x509 -req</code> signs a request. The CA is named with <code>-CA</code> and <code>-CAkey</code>.', 'Lifetime: <code>-days 90</code>. Extensions: <code>-extfile api.ext</code>.'], 'Without <code>-extfile</code> you would get a certificate with none of the constraints and no names, and clients would refuse it.', { expect: /Certificate request self-signature ok|subject=/ });
  drill('t6-inspect', '<p>Print the subject, the issuer, the dates and the subject alternative names of <code>api.pem</code> in one command.</p>',
    S('openssl x509', { what: 'read a certificate', need: { '-in': { value: /^api\.pem$/, what: 'the certificate' }, '-noout': { value: false, what: 'no encoded certificate' }, '-subject': { value: false, what: 'print the subject' }, '-issuer': { value: false, what: 'print the issuer' }, '-dates': { value: false, what: 'print the validity dates' }, '-ext': { value: /^subjectAltName$/i, what: 'print the names' } } }),
    'openssl x509 -in api.pem -noout -subject -issuer -dates -ext subjectAltName', ['Combine the flags from the last step: subject, issuer, dates, and the extension.'], 'The subject is <code>CN=localhost</code>, the issuer is <code>Lab Root CA</code>, and the names include <code>127.0.0.1</code>.', { expect: /issuer=.*Lab Root CA/ });
  drill('t6-serve', '<p>Start a test HTTPS server on port <code>5443</code> using <code>api.pem</code> and <code>api.key</code>, which also answers a plain GET with a small status page (<code>-www</code>).</p>',
    S('openssl s_server', { what: 'run a test TLS server', need: { '-accept': { value: /^5443$/, what: 'listen on this port' }, '-cert': { value: /^api\.pem$/, what: 'the certificate to present' }, '-key': { value: /^api\.key$/, what: 'its private key' }, '-www': { value: false, what: 'answer GET requests with a status page' } } }),
    'openssl s_server -accept 5443 -cert api.pem -key api.key -www', ['<code>s_server</code> takes the port with <code>-accept</code>.'], 'Leave it running and open a second terminal for the next commands.', { server: true });
  drill('t6-curl-fail', '<p>In another terminal, call <code>https://localhost:5443/</code> with <code>curl</code> and <b>no</b> trust file, to see what an untrusted root looks like.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--cacert': { required: false, forbidden: 'This step is about calling it <em>without</em> a trust file, so leave <code>--cacert</code> off.' }, '--insecure': { required: false, forbidden: 'Not <code>-k</code>: that switches the very check we want to see fail.' } }, pos: [pos(url, 'the URL', 'what to call')] }),
    'curl https://localhost:5443/', ['Just the command and the address.'], 'The error is <code>curl: (60) SSL certificate problem: unable to get local issuer certificate</code>. Your system store has no root for this chain.', { expectFail: /issuer certificate/ });
  drill('t6-curl-ok', '<p>Call it again, this time telling <code>curl</code> to trust <code>root.pem</code>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--cacert': { value: /^root\.pem$/, what: 'trust this root' } }, pos: [pos(url, 'the URL', 'what to call')] }),
    'curl --cacert root.pem https://localhost:5443/', ['<code>--cacert</code> and the file.'], 'It works, and nothing about the system trust store changed.', { expect: /./ });

  X['t6-who'] = { kind: 'sort', prompt: '<p>Who creates, who keeps, and who sees each item when you issue a certificate for a server?</p>',
    groups: ['Stays with the server only', 'Stays with the CA only', 'Travels between them (not secret)'],
    items: [
      { t: 'The server\'s private key (<code>api.key</code>)', g: 0, why: 'It never has to leave the server.' },
      { t: 'The root\'s private key (<code>root.key</code>)', g: 1, why: 'Whoever holds it can issue trusted certificates.' },
      { t: 'The certificate signing request (<code>api.csr</code>)', g: 2, why: 'Public key and names: nothing secret.' },
      { t: 'The signed certificate (<code>api.pem</code>)', g: 2, why: 'Certificates are public by design.' },
      { t: 'The root certificate (<code>root.pem</code>)', g: 2, why: 'Clients need it to trust the chain, so it is handed out freely.' },
    ] };
  X['t6-order'] = { kind: 'order', prompt: '<p>Put the steps of issuing a server certificate in order.</p>',
    items: ['The CA makes its key pair and a self-signed root certificate.', 'The server makes its own key pair.', 'The server builds a signing request from its public key and the names it wants.', 'The CA signs the request, setting the extensions it chooses.', 'The server installs the certificate with its private key.'] };
  X['t6-flaws'] = { kind: 'inspect', prompt: '<p>A colleague issued a certificate for the API with this extensions file and says "it works in my browser". Find the problems.</p>',
    artifact: 'basicConstraints = CA:TRUE\nkeyUsage = keyCertSign\nextendedKeyUsage = serverAuth\n# no subjectAltName; the subject is CN=api.internal',
    parts: [
      { kind: 'quiz', prompt: 'What is wrong with <code>basicConstraints</code> and <code>keyUsage</code>?', options: [{ t: 'A server certificate must not be a CA, and does not need <code>keyCertSign</code>. Anyone with its key could issue certificates.', ok: true, why: 'Leaf certificates are <code>CA:FALSE</code> with <code>digitalSignature</code>.' }, { t: 'Nothing, a CA certificate is more flexible.', ok: false, why: 'Flexibility is exactly the danger: the server key becomes a signing key.' }] },
      { kind: 'quiz', prompt: 'What is wrong with the names?', options: [{ t: 'Without a subject alternative name, modern clients refuse the certificate: the common name is not used to identify a service.', ok: true, why: 'RFC 9525 says the common name must not be used.' }, { t: 'Nothing, the common name is enough.', ok: false, why: 'It was in the past. It is not now.' }] },
    ] };

  // ------------------------------------------------------------------ 07
  drill('t7-get', '<p>List the <code>Certificate</code> objects in the namespace <code>todo</code>.</p>',
    S('kubectl get', { what: 'list resources', need: { '--namespace': { value: /^todo$/, what: 'in this namespace' } }, pos: [pos(/^certificates?$/, 'the resource type', 'Certificate objects', 'certificate')] }),
    'kubectl get certificate -n todo', ['The type is <code>certificate</code> and the namespace flag is <code>-n</code>.'], 'The <code>READY</code> column says whether cert-manager has issued it.', { noRun: 'needs a cluster' });
  drill('t7-describe', '<p>Show the details and recent events of the Certificate <code>todo-tls</code> in the namespace <code>todo</code>. This is the first thing to run when issuance is stuck.</p>',
    S('kubectl describe', { what: 'show details of one resource', need: { '--namespace': { value: /^todo$/, what: 'in this namespace' } }, pos: [pos(/^certificates?$/, 'the resource type', 'Certificate', 'certificate'), pos(/^todo-tls$/, 'the name', 'which Certificate', 'todo-tls')] }),
    'kubectl describe certificate todo-tls -n todo', ['<code>describe</code>, the type, the name, and the namespace.'], 'The <b>Events</b> at the bottom show the order, the challenge and any error from the CA.', { noRun: 'needs a cluster' });
  drill('t7-checkend', '<p>Ask <code>openssl</code> whether <code>api.pem</code> will <b>still be valid in 24 hours</b> (86400 seconds). It answers with its exit code, which is handy in a monitoring script.</p>',
    S('openssl x509', { what: 'read a certificate', need: { '-in': { value: /^api\.pem$/, what: 'the certificate' }, '-noout': { value: false, what: 'no encoded certificate' }, '-checkend': { value: /^86400$/, what: 'will it still be valid this many seconds from now?' } } }),
    'openssl x509 -in api.pem -noout -checkend 86400', ['The flag is <code>-checkend</code> with a number of seconds.'], 'Exit code 0 means "still valid then", 1 means "will have expired".', { expect: /Certificate will not expire/ });

  X['t7-challenge'] = { kind: 'sort', prompt: '<p>Which ACME challenge fits?</p>',
    groups: ['HTTP-01', 'DNS-01'],
    items: [
      { t: 'A normal public site on <code>todo.example.com</code>, reachable on port 80.', g: 0, why: 'Serve a file over HTTP. Simple.' },
      { t: 'A wildcard certificate for <code>*.example.com</code>.', g: 1, why: 'Wildcards require the DNS challenge.' },
      { t: 'An internal service with no route from the Internet, with a public domain name.', g: 1, why: 'The CA never has to reach the host: it reads a DNS record.' },
      { t: 'A test server on a public IP address where you can serve a file but do not control the DNS zone.', g: 0, why: 'Serving the token over HTTP needs no DNS access.' },
    ] };
  X['t7-order'] = { kind: 'order', prompt: '<p>Put an ACME issuance in order.</p>',
    items: ['The client asks the CA for a certificate for a name.', 'The CA sends a challenge with a random token.', 'The client publishes the token where only the name\'s owner could.', 'The CA checks the token from outside.', 'The client sends a CSR and receives the certificate.'] };
  X['t7-days'] = { kind: 'quiz', prompt: '<p>From 15 March 2027 the longest a public TLS certificate may last is 100 days. Your team renews by hand each year with a calendar reminder. What is the right response?</p>',
    options: [
      { t: 'Renew every 100 days by hand and add a second reminder.', ok: false, why: 'It will be 47 days by 2029, and a reminder is one forgotten email from an outage.' },
      { t: 'Automate it: ACME with cert-manager or the platform\'s own client, with monitoring on the expiry date.', ok: true, why: 'Automation is the only approach that survives the schedule.' },
      { t: 'Buy a longer certificate from a different CA.', ok: false, why: 'The limit is the same for every publicly trusted CA.' },
    ] };

  // ------------------------------------------------------------------ 08
  drill('t8-key', '<p>Make the client\'s private key: EC on P-256, written to <code>client.key</code>.</p>',
    S('openssl genpkey', { what: 'generate a private key', need: Object.assign({ '-out': { value: /^client\.key$/, what: 'write it here' } }, EC) }),
    'openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out client.key', ['As in step 06.'], '', { expect: /^$/ });
  drill('t8-csr', '<p>Make a request <code>client.csr</code> for <code>client.key</code>, with the subject <code>/CN=todo-reporter</code>.</p>',
    S('openssl req', { what: 'create a certificate request', need: { '-new': { value: false, what: 'a new request' }, '-key': { value: /^client\.key$/, what: 'the client\'s key' }, '-subj': { value: /^\/CN=todo-reporter$/, what: 'the service\'s name' }, '-out': { value: /^client\.csr$/, what: 'write the request here' } } }),
    'openssl req -new -key client.key -subj "/CN=todo-reporter" -out client.csr', ['As in step 06; the name says <em>which service</em> it is.'], '', { expect: /^$/ });
  drill('t8-sign', '<p>Sign <code>client.csr</code> with your root, using the extensions in <code>client.ext</code>, valid 90 days, writing <code>client.pem</code>.</p>',
    S('openssl x509', { what: 'sign a request', need: { '-req': { value: false, what: 'the input is a request' }, '-in': { value: /^client\.csr$/, what: 'the request' }, '-CA': { value: /^root\.pem$/, what: 'the CA certificate' }, '-CAkey': { value: /^root\.key$/, what: 'the CA key' }, '-CAcreateserial': { value: false, required: false, what: 'create the serial file if there is none' }, '-days': { value: function (v) { return /^\d+$/.test(v) && +v <= 200; }, what: 'valid for this many days' }, '-extfile': { value: /^client\.ext$/, what: 'the extensions' }, '-out': { value: /^client\.pem$/, what: 'write it here' } } }),
    'openssl x509 -req -in client.csr -CA root.pem -CAkey root.key -CAcreateserial -days 90 -extfile client.ext -out client.pem', ['The same command as step 06 with the client files.'], 'The certificate now carries <code>clientAuth</code>, which a server will check.', { expect: /subject=|Certificate request/ });
  drill('t8-curl', '<p>Call <code>https://localhost:5443/</code>, trusting <code>root.pem</code> and presenting <code>client.pem</code> with its key <code>client.key</code>.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--cacert': { value: /^root\.pem$/, what: 'trust this root' }, '--cert': { value: /^client\.pem$/, what: 'present this client certificate' }, '--key': { value: /^client\.key$/, what: 'and prove it with this key' } }, pos: [pos(url, 'the URL', 'what to call')] }),
    'curl --cacert root.pem --cert client.pem --key client.key https://localhost:5443/', ['<code>--cert</code> and <code>--key</code> are the client\'s side.'], 'The server now knows this is <code>todo-reporter</code>.', { expect: /./, mtls: true });
  drill('t8-nocert', '<p>Call it once <b>without</b> a client certificate, trusting <code>root.pem</code>, to see what a refused caller sees.</p>',
    S('curl', { what: 'make an HTTP request', need: { '--cacert': { value: /^root\.pem$/, what: 'trust this root' }, '--cert': { required: false, forbidden: 'This step is about <em>not</em> presenting a certificate.' } }, pos: [pos(url, 'the URL', 'what to call')] }),
    'curl --cacert root.pem https://localhost:5443/', ['Leave out the client flags.'], 'The server refuses with a TLS alert: <code>tlsv13 alert certificate required</code>. No HTTP response comes back.', { expectFail: /certificate required/, mtls: true });

  X['t8-who'] = { kind: 'quiz', prompt: '<p>Service A calls the Todo API. The API must know <b>which service</b> is calling, and there is no user. Which fits best?</p>',
    options: [
      { t: 'Ask service A to send a username and password in a header.', ok: false, why: 'A shared secret in a configuration file can be copied, and the API cannot tell copies apart.' },
      { t: 'Mutual TLS: service A has a certificate from the organisation\'s CA, and proves its private key.', ok: true, why: 'The key never leaves service A, and the certificate names it.' },
      { t: 'Let anyone on the internal network call it.', ok: false, why: 'Network position is not identity.' },
    ] };
  X['t8-fail'] = { kind: 'quiz', prompt: '<p>The API requires a client certificate. A caller sends none. What does it get?</p>',
    options: [
      { t: 'An HTTP <code>401</code> with a <code>WWW-Authenticate</code> header.', ok: false, why: 'The refusal happens in TLS, below HTTP, so there is no HTTP response to carry a status code.' },
      { t: 'A TLS alert (<code>certificate required</code>) and no HTTP response.', ok: true, why: 'With <code>RequireCertificate</code> the TLS layer refuses the connection.' },
      { t: 'A <code>403</code> from the controller.', ok: false, why: 'The request never reaches a controller.' },
    ] };
  X['t8-proxy'] = { kind: 'quiz', prompt: '<p>A gateway in front of the API ends TLS. The API is configured to require client certificates, but every call now fails. Why?</p>',
    options: [
      { t: 'The API now sees a connection from the gateway, which has no client certificate for the caller. The gateway must authenticate the client and pass on the result.', ok: true, why: 'TLS terminates at the gateway, so the API cannot see the caller\'s certificate.' },
      { t: 'Gateways cannot carry client certificates in any form.', ok: false, why: 'They can: they authenticate the client themselves, or pass it in a trusted header that only they can set.' },
      { t: 'The root certificate expired.', ok: false, why: 'Nothing in the question points to that.' },
    ] };
})();
