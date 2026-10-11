@echo off
rem Double-click this file to open the tutorial.
rem It starts the local server (server.js) if it isn't already running, then opens the page in your browser.
rem The server runs in a minimized window called "Tutorial server". Close that window to stop it.

setlocal
cd /d "%~dp0"
set "URL=http://localhost:8788"

where node >nul 2>&1 || set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>&1 || (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

curl -s -o nul %URL%/api/status
if not errorlevel 1 goto open

start "Tutorial server" /min node server.js

rem Wait up to 10 seconds for the server to answer.
for /l %%i in (1,1,10) do (
  curl -s -o nul %URL%/api/status && goto open
  timeout /t 1 /nobreak >nul
)
echo The server did not start. Run "node server.js" in this folder to see the error.
pause
exit /b 1

:open
start "" %URL%/
