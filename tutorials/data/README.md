# data/

`tutorial.db` is a SQLite file that `server.js` keeps up to date with your notes, bookmarks, the place you stopped and the steps you ticked, for every tutorial page. It is the backup behind the browser's own storage.

- It is checked in on purpose, so the repository holds a copy of your notes. Keep the repository private.
- To save a snapshot: `git add data/tutorial.db && git commit -m "Back up notes" && git push`.
- To read it as text: `node tools/export-notes.js > my-notes.md`.
- To start from nothing, stop the server and delete the file. It is created again on the next start.
