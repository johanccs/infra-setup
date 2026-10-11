// Checks the one-command database backup: tools/backup-db.sh (run in a throwaway git repository) and the
// platform-engineering-gh skill that calls it.
//   node tests/skill.test.js
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, summary, run } = require('./lib');
const { DatabaseSync } = require('node:sqlite');

const TOOLS = path.join(__dirname, '..', 'tools');
const SKILL = path.join(TOOLS, 'skill', 'platform-engineering-gh', 'SKILL.md');
const INSTALLED = path.join(os.homedir(), '.claude', 'skills', 'platform-engineering-gh', 'SKILL.md');

// A repository shaped like the real one, with a database that already holds one note and two ticks.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-skill-'));
const git = (...a) => run('git', a, { cwd: repo });
git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'Test');
const dbFile = path.join(repo, 'tutorials', 'data', 'tutorial.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
function setState(rows) {
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE IF NOT EXISTS state (page TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated INTEGER NOT NULL, PRIMARY KEY (page, key))');
  for (const [page, key, value] of rows) db.prepare('INSERT OR REPLACE INTO state VALUES (?, ?, ?, ?)').run(page, key, JSON.stringify(value), Date.now());
  db.close();
}
setState([['a.html', 'notes', [{ id: 'n1' }]], ['a.html', 'done', { s1: true, s2: true, s3: false }]]);
git('add', '.'); git('commit', '-q', '-m', 'start');
const script = path.join(TOOLS, 'backup-db.sh');
const sh = (cwd = repo, env = {}) => run('bash', [script], { cwd, env: { ...process.env, ...env } });
const staged = () => git('diff', '--cached', '--name-only').stdout.trim();

let r = sh();
check(r.status === 0 && /SUMMARY 1 notes, 0 bookmarks, 2 steps ticked, across 1 pages/.test(r.stdout) && /NO_CHANGES/.test(r.stdout) && staged() === '', 'nothing changed: it says so and stages nothing');
fs.mkdirSync(path.join(repo, 'tutorials', 'docs'), { recursive: true });
setState([['a.html', 'notes', [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }]], ['a.html', 'bookmarks', [{ id: 'b1' }]], ['b.html', 'done', { x: true }]]);
fs.writeFileSync(path.join(repo, 'other.txt'), 'unrelated\n'); git('add', 'other.txt');   // something else already staged
r = sh(path.join(repo, 'tutorials', 'docs'));
check(r.status === 0 && /SUMMARY 3 notes, 1 bookmarks, 3 steps ticked, across 2 pages/.test(r.stdout) && /STAGED tutorials\/data\/tutorial\.db/.test(r.stdout) && /MESSAGE Back up notes: 3 notes, 1 bookmarks, 3 steps ticked across 2 pages/.test(r.stdout), 'run from a subfolder, it finds the repository, reports the counts and stages the database', r.stdout + r.stderr);
check(staged().split('\n').includes('tutorials/data/tutorial.db'), 'the database is staged');
const c = git('commit', '-q', '-m', 'Back up', '--', 'tutorials/data/tutorial.db');
check(c.status === 0 && git('show', '--name-only', '--format=', 'HEAD').stdout.trim() === 'tutorials/data/tutorial.db' && staged() === 'other.txt', 'committing with the path commits only the database and leaves the other staged file alone', c.stderr);
check(sh().stdout.includes('NO_CHANGES'), 'afterwards it reports nothing to commit');
fs.writeFileSync(dbFile + '-journal', 'x');
r = sh();
check(r.status === 2 && /being written right now/.test(r.stdout), 'a database that is being written right now is left alone (exit code 2)');
fs.rmSync(dbFile + '-journal');
const good = fs.readFileSync(dbFile); fs.writeFileSync(dbFile, Buffer.concat([good.subarray(0, 100), Buffer.alloc(good.length - 100, 7)]));
r = sh();
check(r.status === 1 && /failed its check/.test(r.stdout) && !/STAGED/.test(r.stdout), 'a damaged database is refused and not staged (exit code 1)', r.stdout + r.stderr);
fs.writeFileSync(dbFile, good); fs.rmSync(dbFile);
r = sh();
check(r.status === 1 && /No database/.test(r.stdout), 'a missing database is reported (exit code 1)');
fs.rmSync(repo, { recursive: true, force: true });

// the skill
const text = fs.readFileSync(SKILL, 'utf8');
const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
const field = (k) => ((new RegExp(`^${k}: (.*)$`, 'm')).exec(front[1]) || [])[1];
check(front && field('name') === 'platform-engineering-gh' && path.basename(path.dirname(SKILL)) === 'platform-engineering-gh' && field('description').length > 40, 'the skill is named platform-engineering-gh (the project name plus -gh), with a description');
check(field('disable-model-invocation') === 'true', 'it runs only when the user asks for it');
check(/Start \*\*every\*\* Bash command with `cd \/home\/user\/platform_engineering &&`/.test(text) && (text.match(/cd \/home\/user\/platform_engineering &&/g) || []).length >= 5, 'it moves to the project folder in every command, so it can be run from anywhere');
check(/isPrivate/.test(text) && /Never force-push/.test(text) && /tutorials\/data\/tutorial\.db/.test(text) && /backup-db\.sh/.test(text), 'it checks the repository is private, never force-pushes, and commits only the database');
check(fs.existsSync(path.join(TOOLS, '..', '..', 'tutorials', 'tools', 'backup-db.sh')) && fs.statSync(script).mode & 0o100, 'the script the skill calls exists and is executable');
if (fs.existsSync(INSTALLED)) check(fs.readFileSync(INSTALLED, 'utf8') === text, 'the installed skill (~/.claude/skills) is the same as the copy in the repository');
process.exit(summary());
