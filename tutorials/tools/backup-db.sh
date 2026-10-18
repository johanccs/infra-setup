#!/usr/bin/env bash
# Checks the backup database and stages it for a commit. It does not commit or push.
#   tutorials/tools/backup-db.sh        (from anywhere inside the repository)
# Prints SUMMARY, then NO_CHANGES (nothing to commit) or STAGED plus the commit message to use.
# Exit codes: 0 done (or nothing to do), 1 problem with the database, 2 the database is being written right now.
set -euo pipefail
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
DB="${TUTORIAL_DB:-tutorials/data/tutorial.db}"
[ -f "$DB" ] || { echo "No database at $ROOT/$DB. Start the tutorial server first (tutorials/start.sh) and use a page."; exit 1; }
if [ -e "$DB-journal" ]; then echo "The database is being written right now ($DB-journal exists). Run this again in a moment."; exit 2; fi
SUMMARY="$(node "$TOOLS/db-summary.js" "$DB")" || { echo "The database failed its check: $SUMMARY"; exit 1; }
read -r NOTES BOOKMARKS TICKED PAGES < <(node -e 'const s=JSON.parse(process.argv[1]);console.log(s.notes,s.bookmarks,s.ticked,s.pages)' "$SUMMARY")
echo "SUMMARY $NOTES notes, $BOOKMARKS bookmarks, $TICKED steps ticked, across $PAGES pages"
if [ -z "$(git status --porcelain -- "$DB")" ]; then echo "NO_CHANGES"; exit 0; fi
git add -- "$DB"
echo "STAGED $DB"
echo "MESSAGE Back up notes: $NOTES notes, $BOOKMARKS bookmarks, $TICKED steps ticked across $PAGES pages"
