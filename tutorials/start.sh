#!/usr/bin/env bash
# Start the tutorial server from Ubuntu, then open the page in your Windows browser.
#   ./start.sh            serve on http://localhost:8788
# Asking questions needs OPENAI_API_KEY in the environment. It is never written to disk. The desktop shortcut passes the
# Windows variable to Ubuntu for that launch only. From a terminal you can do the same with:
#   cmd.exe /c 'set "WSLENV=OPENAI_API_KEY/u:%WSLENV%" && wsl.exe -d Ubuntu-26.04 --cd ~/platform_engineering/infra-setup/tutorials -- bash -lc ./start.sh'
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8788}"
URL="http://localhost:$PORT"
PIDFILE="/tmp/tutorial-server.pid"
ai_on() { curl -s "$URL/api/status" | grep -q '"ai":true'; }
stop_server() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then kill "$(cat "$PIDFILE")"; else pkill -f '^node server.js$' 2>/dev/null; fi
  for _ in 1 2 3 4 5; do curl -s -o /dev/null "$URL/api/status" || return 0; sleep 1; done
}
command -v node >/dev/null || { echo "Node.js was not found. Install it with: sudo apt install nodejs"; exit 1; }
if curl -s -o /dev/null "$URL/api/status"; then
  # A server started without the key keeps running without it. Restart it once the key is available.
  if [ -n "$OPENAI_API_KEY" ] && ! ai_on; then echo "Restarting the server so it can use your OpenAI key."; stop_server; fi
fi
if curl -s -o /dev/null "$URL/api/status"; then
  echo "A tutorial server is already running on $URL"
else
  [ -n "$OPENAI_API_KEY" ] || echo "Note: OPENAI_API_KEY is not set, so asking the AI tutor is off (notes and bookmarks still work)."
  # Fully detached (no inherited input or output), so a launcher window can close while the server keeps running.
  PORT="$PORT" setsid -f bash -c 'echo $$ > "$0"; exec node server.js' "$PIDFILE" > /tmp/tutorial-server.log 2>&1 < /dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "$URL/api/status" && break; sleep 1; done
  curl -s -o /dev/null "$URL/api/status" || { echo "The server did not start:"; cat /tmp/tutorial-server.log; exit 1; }
  echo "Server running on $URL (log: /tmp/tutorial-server.log, stop it with: kill \$(cat $PIDFILE))"
fi
[ "${NO_BROWSER:-0}" = 1 ] && exit 0
(command -v wslview >/dev/null && wslview "$URL/") || (command -v explorer.exe >/dev/null && explorer.exe "$URL/") || echo "Open $URL/ in your browser."
