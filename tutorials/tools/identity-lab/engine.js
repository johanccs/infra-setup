// The exercise engine of the Identity and Access Lab. Pure JavaScript with no DOM, so the same file runs in the page and
// in the tests. An exercise is data; judge() says whether an answer is right and why, and solution() gives the answer.
//
//   quiz     { kind, prompt, options: [{ t, ok, why }], multi? }                      answer: [indexes]
//   order    { kind, prompt, items: [text in the correct order] }                     answer: [indexes into items, in the order chosen]
//   sort     { kind, prompt, groups: [names], items: [{ t, g (index of its group), why? }] }   answer: [group index per item]
//   inspect  { kind, prompt, artifact (text), parts: [quiz, quiz, ...] }              answer: [answer per part]
// Every exercise may have hints: [html], after: html (shown when it is passed).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IAEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  function judge(ex, answer) {
    switch (ex.kind) {
      case 'quiz': {
        const want = ex.options.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
        const got = Array.isArray(answer) ? answer : [];
        const items = ex.options.map((o, i) => ({ ok: !!o.ok === got.includes(i), chosen: got.includes(i), why: o.why || '' }));
        if (!got.length) return { ok: false, empty: true, items, message: 'Choose an answer.' };
        const ok = sameSet(want, got);
        return { ok, items, message: ok ? 'Correct.' : ex.multi ? 'Not quite: check every option you ticked, and every one you left.' : 'Not that one. Read why each option is right or wrong.' };
      }
      case 'order': {
        const got = Array.isArray(answer) ? answer : [];
        const valid = got.length === ex.items.length && sameSet(got.slice().sort((a, b) => a - b), ex.items.map((_, i) => i));
        const items = (valid ? got : []).map((idx, pos) => ({ ok: idx === pos, text: ex.items[idx] }));
        const ok = valid && got.every((idx, pos) => idx === pos);
        return { ok, items, message: ok ? 'Correct order.' : `${items.filter((x) => x.ok).length} of ${ex.items.length} are in the right place.` };
      }
      case 'sort': {
        const got = Array.isArray(answer) ? answer : [];
        const items = ex.items.map((it, i) => ({ ok: got[i] === it.g, why: it.why || '', chosen: got[i] }));
        const done = got.length === ex.items.length && got.every((g) => Number.isInteger(g));
        const ok = done && items.every((x) => x.ok);
        return { ok, items, message: ok ? 'Everything is in the right group.' : done ? `${items.filter((x) => x.ok).length} of ${ex.items.length} are right.` : 'Put every item in a group.' };
      }
      case 'inspect': {
        const got = Array.isArray(answer) ? answer : [];
        const parts = ex.parts.map((p, i) => judge(p, got[i]));
        const ok = parts.every((p) => p.ok);
        return { ok, parts, items: [], message: ok ? 'All correct.' : `${parts.filter((p) => p.ok).length} of ${parts.length} questions are right.` };
      }
      default: throw new Error('unknown exercise kind ' + ex.kind);
    }
  }
  function solution(ex) {
    switch (ex.kind) {
      case 'quiz': return ex.options.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
      case 'order': return ex.items.map((_, i) => i);
      case 'sort': return ex.items.map((it) => it.g);
      case 'inspect': return ex.parts.map(solution);
      default: throw new Error('unknown exercise kind ' + ex.kind);
    }
  }
  // A wrong answer for each exercise, used by the tests to prove that the check can fail.
  function wrongAnswer(ex) {
    switch (ex.kind) {
      case 'quiz': { const want = solution(ex); const all = ex.options.map((_, i) => i); const other = all.filter((i) => !want.includes(i)); return other.length ? [other[0]] : want.slice(1); }
      case 'order': { const a = ex.items.map((_, i) => i); [a[0], a[1]] = [a[1], a[0]]; return a; }
      case 'sort': return ex.items.map((it) => (it.g + 1) % ex.groups.length);
      case 'inspect': return ex.parts.map((p, i) => (i === 0 ? wrongAnswer(p) : solution(p)));
      default: throw new Error('unknown exercise kind ' + ex.kind);
    }
  }
  return { judge, solution, wrongAnswer };
});
