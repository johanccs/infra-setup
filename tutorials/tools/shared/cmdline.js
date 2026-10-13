// The command judge: checks a typed command line (gh, git, curl, openssl, kubectl, dotnet) against a spec of the flags
// and arguments it must have. Pure JavaScript with no DOM; shared by the GitHub Actions lab and the Identity and Access lab.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GACmdline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- the command judge (gh and git)
  // Splits a line the way a shell would: quotes group words, a backslash before a newline continues the line.
  function shellSplit(line) {
    const out = []; let cur = '', q = null, has = false;
    const s = line.replace(/\\\r?\n/g, ' ');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && /["\\$`]/.test(s[i + 1] || '')) cur += s[++i]; else cur += c; continue; }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
      if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
      if ((c === '&' && s[i + 1] === '&') || c === ';' || c === '|') {
        if (cur || has) { out.push(cur); cur = ''; has = false; }
        if (c === '&') i++;
        out.push({ sep: c === '&' ? '&&' : c }); continue;
      }
      cur += c; has = true;
    }
    if (q) return { error: 'a quote is not closed' };
    if (cur || has) out.push(cur);
    return { words: out };
  }
  function splitCommands(line) {
    const sp = shellSplit(line);
    if (sp.error) return sp;
    const cmds = [[]];
    for (const w of sp.words) { if (typeof w === 'object') cmds.push([]); else cmds[cmds.length - 1].push(w); }
    return { commands: cmds.filter((c) => c.length) };
  }
  // spec = { cmd: ['gh','workflow','run'], positionals: [ 'deploy.yml' | /re/ | fn ], flags: { '--ref': { alias: ['-r'], value: 'main'|/re/|fn|true|false, required: true, repeat: true } }, note }
  // Judge one command's words against a spec. Returns { ok, problems: [html], tokens: [{t, why}] }.
  function judgeCommand(words, spec) {
    const problems = [], tokens = [];
    const cmd = spec.cmd;
    for (let i = 0; i < cmd.length; i++) {
      if (words[i] !== cmd[i]) {
        const got = words.slice(0, cmd.length).join(' ');
        return { ok: false, problems: [`This should start with <code>${cmd.join(' ')}</code>${got ? `, not <code>${escHtml(got)}</code>` : ''}.`], tokens };
      }
    }
    tokens.push({ t: cmd.join(' '), why: spec.what || 'the command' });
    const flagDefs = spec.flags || {};
    const byName = {};
    for (const [name, def] of Object.entries(flagDefs)) { byName[name] = name; for (const a of def.alias || []) byName[a] = name; }
    const seen = {}, pos = [];
    const rest = words.slice(cmd.length);
    for (let i = 0; i < rest.length; i++) {
      let w = rest[i], val = null, hasVal = false;
      if (/^--?[A-Za-z]/.test(w)) {
        const eq = w.indexOf('=');
        if (w.startsWith('--') && eq > 0) { val = w.slice(eq + 1); hasVal = true; w = w.slice(0, eq); }
        let canon = byName[w];
        // -fkey=value: a short flag with its value attached
        if (!canon && /^-[A-Za-z]./.test(w) && !w.startsWith('--') && byName[w.slice(0, 2)] && flagDefs[byName[w.slice(0, 2)]].value !== false) { val = w.slice(2); hasVal = true; w = w.slice(0, 2); canon = byName[w]; }
        if (!canon) {
          const names = Object.keys(byName);
          const near = names.filter((n) => n.startsWith('--') === w.startsWith('--')).sort((a, b) => lev(a, w) - lev(b, w))[0];
          problems.push(`<code>${escHtml(w)}</code> is not a flag of <code>${cmd.join(' ')}</code>${near && lev(near, w) <= 4 ? `. Did you mean <code>${near}</code>?` : '.'}`);
          continue;
        }
        const def = flagDefs[canon];
        const wantsValue = def.value !== false;
        if (wantsValue && !hasVal) { val = rest[++i]; hasVal = val !== undefined; if (!hasVal) { problems.push(`<code>${w}</code> needs a value after it.`); continue; } }
        (seen[canon] = seen[canon] || []).push(val);
        tokens.push({ t: wantsValue ? `${w} ${shQuote(val)}` : w, why: def.what || canon });
      } else { pos.push(w); }
    }
    const posSpec = spec.positionals || [];
    posSpec.forEach((p, i) => {
      const got = pos[i];
      if (got === undefined) { problems.push(`Missing ${p.label || 'an argument'}${p.hint ? ': ' + p.hint : ''}.`); return; }
      if (!testVal(p.match, got)) problems.push(p.bad ? p.bad : `<code>${escHtml(got)}</code> is not what this command needs here${p.hint ? ': ' + p.hint : ''}.`);
      else tokens.splice(1 + i, 0, { t: shQuote(got), why: p.what || p.label || 'argument' });
    });
    if (pos.length > posSpec.length) problems.push(`Too many arguments: <code>${escHtml(pos.slice(posSpec.length).join(' '))}</code> is not needed.`);
    for (const [name, def] of Object.entries(flagDefs)) {
      const got = seen[name] || [];
      if (def.required && !got.length) problems.push(def.missing || `Missing <code>${name}</code>${def.hint ? ': ' + def.hint : ''}.`);
      if (got.length > 1 && !def.repeat) problems.push(`<code>${name}</code> appears more than once, and only the last would be used.`);
      if (def.forbidden && got.length) problems.push(def.forbidden);
      for (const g of got) if (def.value !== false && def.value !== true && def.value !== undefined && !testVal(def.value, g)) problems.push(def.bad ? def.bad(g) : `<code>${name} ${escHtml(g)}</code> is not right here${def.hint ? ': ' + def.hint : ''}.`);
      if (def.each && got.length) { for (const need of def.each) if (!got.some((g) => testVal(need.match, g))) problems.push(need.missing); }
    }
    if (spec.check) problems.push(...spec.check({ pos, seen }));
    return { ok: problems.length === 0, problems, tokens };
  }
  function testVal(m, v) { return m === undefined || m === true ? true : typeof m === 'string' ? v === m : m instanceof RegExp ? m.test(v) : typeof m === 'function' ? m(v) : false; }
  function shQuote(s) { return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s}'`; }
  function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  // specs: one spec, or an array of specs for a line like "git tag v1 && git push origin v1"
  function judgeLine(line, specs) {
    specs = Array.isArray(specs) ? specs : [specs];
    const sp = splitCommands(line);
    if (sp.error) return { ok: false, problems: [sp.error], tokens: [] };
    if (!sp.commands.length) return { ok: false, problems: [], tokens: [], empty: true };
    const problems = [], tokens = [];
    if (sp.commands.length < specs.length) problems.push(`This takes ${specs.length} commands joined with <code>&amp;&amp;</code>; you have ${sp.commands.length}.`);
    if (sp.commands.length > specs.length) problems.push(`Only ${specs.length} command${specs.length > 1 ? 's are' : ' is'} needed here.`);
    specs.forEach((spec, i) => {
      if (!sp.commands[i]) return;
      const r = judgeCommand(sp.commands[i], spec);
      problems.push(...r.problems); tokens.push(...r.tokens);
    });
    return { ok: problems.length === 0, problems, tokens };
  }

  return { shellSplit, splitCommands, judgeCommand, judgeLine, escHtml };
});
