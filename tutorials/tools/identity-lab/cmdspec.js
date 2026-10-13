// Builds the specs the command judge (tools/shared/cmdline.js) checks typed commands against, from the real flag tables
// of curl, openssl and kubectl (vendor/cmd-flags.json, written by gen-cmdflags.js). A flag the real tool has is never rejected.
// Pure JavaScript with no DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IACmdSpec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // cmd: 'curl' | 'openssl s_client' | 'kubectl get' ... ; o: { what, need: { '-connect': { value, required, what } }, pos: [{ match, label, what, hint }], check }
  function spec(table, cmd, o) {
    o = o || {};
    const t = table[cmd] || {};
    const flags = {};
    for (const [n, f] of Object.entries(t)) flags[n] = { alias: f.short ? [f.short] : [], value: f.value ? true : false };
    for (const [n, d] of Object.entries(o.need || {})) {
      if (!flags[n]) throw new Error(`${cmd} has no flag ${n}`);
      flags[n] = Object.assign({}, flags[n], d, { required: d.required !== false });
    }
    return { cmd: cmd.split(' '), what: o.what, positionals: o.pos || [], flags, check: o.check };
  }
  return { spec };
});
