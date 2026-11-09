# OpenLobs Bridge

A small program that connects a computer to OpenLobs so OpenLobs can ask it to do approved things. **Version 0.2: it can answer a ping and, if you allow it, look at web pages.** It is the base for later steps (Excel, other apps).

## What it will and will not do

- It only **calls out** to your OpenLobs address. It opens no port and runs no commands. The one program it starts is your browser, and only for a browser job you allowed.
- It has a fixed list of jobs (`HANDLERS` in `core.ts`). A job not on the list is refused on this computer even if the server sends it.
- It says what it is doing, can be stopped with Ctrl+C, and stops by itself if you disconnect it in OpenLobs.
- The token that proves this computer's identity is stored in a file only your user can read (`%APPDATA%\OpenLobsBridge\config.json` on Windows, `~/.openlobs-bridge/config.json` elsewhere).

## Use (Windows first)

You need Node.js 22 or newer and this repository.

1. In OpenLobs, open **Computers** and press **Add a computer**. You get a code like `K7M2QX4R`.
2. In a terminal in this folder: `npm run bridge -- pair K7M2QX4R --server https://your-openlobs-address` (add `--name "My PC"` to name it).
3. Start it: `npm run bridge -- run`. The Computers page shows it as online.
4. Press **Test** on the page: the Bridge answers with its version and Windows version.

5. To let OpenLobs look at web pages (for example a site you are building on `localhost`), run `npm run bridge -- allow browser`. This needs Microsoft Edge or Google Chrome (Windows has Edge) and a one-time `npm install`. A running Bridge picks the change up within a minute. Turn it off with `npm run bridge -- deny browser`. On the Computers page, "Look at a page" then works, and so does "look at my site on my computer" in chat.

A browser look opens the page in a fresh, empty browser (no logins, nothing remembered), takes a picture, and reports page errors. It never clicks or types. Pages on this computer and the public internet are opened; private-network addresses (router, intranet), local files, and anything a page tries to load from them are refused.

Other commands: `npm run bridge -- status` (is it paired and can it reach the server), `npm run bridge -- disconnect` (forget the pairing on this computer; also disconnect it on the Computers page).

The server address must be `https://`; plain `http://` is accepted only for `localhost`.

## Not built yet

- An installer or a single `.exe` (today it runs with Node).
- A tray icon or window to start and stop it.
- Storing the token in the Windows credential store (DPAPI) instead of a protected file.
- Mac and Linux are untested.
- Any job other than `ping` and `browser_look`: no clicking, typing, signed-in browsing, Excel or other apps yet.

## Tests

`tests/bridge.test.mts` runs the real pairing, polling and result logic end to end with an in-memory database.
