# OpenLobs Bridge

A small program that connects a computer to OpenLobs so OpenLobs can ask it to do approved things. **Version 0.1: it can answer a ping, nothing else.** It is the base for later steps (a real browser, Excel), built first so the connection and the safety rules can be checked before anything risky depends on them.

## What it will and will not do

- It only **calls out** to your OpenLobs address. It opens no port and starts no other program.
- It has a fixed list of jobs (`HANDLERS` in `core.ts`). A job not on the list is refused on this computer even if the server sends it.
- It says what it is doing, can be stopped with Ctrl+C, and stops by itself if you disconnect it in OpenLobs.
- The token that proves this computer's identity is stored in a file only your user can read (`%APPDATA%\OpenLobsBridge\config.json` on Windows, `~/.openlobs-bridge/config.json` elsewhere).

## Use (Windows first)

You need Node.js 22 or newer and this repository.

1. In OpenLobs, open **Computers** and press **Add a computer**. You get a code like `K7M2QX4R`.
2. In a terminal in this folder: `npm run bridge -- pair K7M2QX4R --server https://your-openlobs-address` (add `--name "My PC"` to name it).
3. Start it: `npm run bridge -- run`. The Computers page shows it as online.
4. Press **Test** on the page: the Bridge answers with its version and Windows version.

Other commands: `npm run bridge -- status` (is it paired and can it reach the server), `npm run bridge -- disconnect` (forget the pairing on this computer; also disconnect it on the Computers page).

The server address must be `https://`; plain `http://` is accepted only for `localhost`.

## Not built yet

- An installer or a single `.exe` (today it runs with Node).
- A tray icon or window to start and stop it.
- Storing the token in the Windows credential store (DPAPI) instead of a protected file.
- Mac and Linux are untested.
- Any job other than `ping`.

## Tests

`tests/bridge.test.mts` runs the real pairing, polling and result logic end to end with an in-memory database.
