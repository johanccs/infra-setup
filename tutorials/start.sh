#!/usr/bin/env bash
# Start the tutorial server from Ubuntu, then open the page in your Windows browser.
#   ./start.sh            serve on http://localhost:8788
# Asking questions needs OPENAI_API_KEY in the environment. It is never written to disk. To share the
# Windows variable with Ubuntu for this session only, add it to WSLENV in Windows (one time):
#   setx WSLENV "OPENAI_API_KEY/u:%WSLENV%"
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8788}"
URL="http://localhost:$PORT"
command -v node >/dev/null || { echo "Node.js was not found. Install it with: sudo apt install nodejs"; exit 1; }
if curl -s -o /dev/null "$URL/api/status"; then
  echo "A tutorial server is already running on $URL"
else
  [ -n "$OPENAI_API_KEY" ] || echo "Note: OPENAI_API_KEY is not set, so asking the AI tutor is off (notes and bookmarks still work)."
  PORT="$PORT" node server.js > /tmp/tutorial-server.log 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "$URL/api/status" && break; sleep 1; done
  curl -s -o /dev/null "$URL/api/status" || { echo "The server did not start:"; cat /tmp/tutorial-server.log; exit 1; }
  echo "Server running on $URL (log: /tmp/tutorial-server.log, stop it with: pkill -f 'node server.js')"
fi
(command -v wslview >/dev/null && wslview "$URL/") || (command -v explorer.exe >/dev/null && explorer.exe "$URL/") || echo "Open $URL/ in your browser."
