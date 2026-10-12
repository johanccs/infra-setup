---
name: platform-engineering-gh
description: Back up the platform_engineering tutorials' notes, bookmarks and progress to GitHub. Moves to the project folder first (so it can be run from any directory), checks the SQLite database tutorials/data/tutorial.db, commits only that file and pushes it. Use when the user runs /platform-engineering-gh.
disable-model-invocation: true
allowed-tools: Bash(cd /home/user/platform_engineering/infra-setup *) Bash(bash tutorials/tools/backup-db.sh) Bash(git *) Bash(gh repo view *)
---

# Back up the tutorial notes database to GitHub

The project is **`/home/user/platform_engineering/infra-setup`**. The user can run this skill from any folder in Ubuntu, so never assume the current directory. Start **every** Bash command with `cd /home/user/platform_engineering/infra-setup &&`.

## Steps

1. **Check the repository is private.** The database holds personal notes.
   `cd /home/user/platform_engineering/infra-setup && gh repo view --json isPrivate,nameWithOwner`
   If `isPrivate` is not `true`, stop and tell the user. Do not commit or push.

2. **Check and stage the database.**
   `cd /home/user/platform_engineering/infra-setup && bash tutorials/tools/backup-db.sh`
   - It prints a `SUMMARY` line (notes, bookmarks, steps ticked, pages).
   - `NO_CHANGES` means the database is already committed. Say so, show the summary, and stop.
   - Exit code 2 means the server is writing right now. Wait five seconds and run it once more. If it still says so, report that and stop.
   - Exit code 1 means a problem with the database (missing or failed its integrity check). Show the message and stop. Do not try to repair it.
   - `STAGED` is followed by a `MESSAGE` line: use it as the commit message subject.

3. **Commit only the database.** Other files may be changed or staged in this repository and must not be included.
   `cd /home/user/platform_engineering/infra-setup && git commit -m "<the MESSAGE line>" -m "<attribution lines>" -- tutorials/data/tutorial.db`
   End the message with the attribution lines your instructions give for commits.

4. **Push.**
   `cd /home/user/platform_engineering/infra-setup && git push`
   If the push is rejected because the remote has new commits, do **not** rebase, merge or force-push, because a binary database cannot be merged line by line. Report what happened and let the user decide.

5. **Report in a few lines:** the commit hash, the summary counts, and that it was pushed to `<nameWithOwner>`.

## Rules

- Commit and push only `tutorials/data/tutorial.db`. Never `git add -A` or `git commit -a`.
- Never force-push.
- Never print the contents of the database. The summary counts are enough.
- To read the notes as text, the user can run `node tutorials/tools/export-notes.js`.
