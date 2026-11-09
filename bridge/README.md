# OpenLobs Bridge

A small program that connects a computer to OpenLobs so OpenLobs can ask it to do approved things. **Version 0.5: it can answer a ping, look at web pages, let OpenLobs use a browser, and work on spreadsheets in one folder, each only if you allow it.** It is the base for later steps (other apps).

## What it will and will not do

- It only **calls out** to your OpenLobs address. It opens no port and runs no commands. The only programs it starts are your browser (for a browser job you allowed) and, for spreadsheet work you allowed, Microsoft Excel or LibreOffice, driven by two fixed scripts that nothing from OpenLobs is ever written into (`sheets/engine.ts`; `process.ts` is the single place that starts a program).
- It has a fixed list of jobs (`HANDLERS` in `core.ts`). A job not on the list is refused on this computer even if the server sends it.
- It says what it is doing, can be stopped with Ctrl+C, and stops by itself if you disconnect it in OpenLobs.
- The token that proves this computer's identity is stored in a file only your user can read (`%APPDATA%\OpenLobsBridge\config.json` on Windows, `~/.openlobs-bridge/config.json` elsewhere).

## Install on Windows (no terminal)

Download `OpenLobs-Bridge-Setup.exe` (the Computers page links to it when your OpenLobs has one; otherwise it is the `OpenLobs-Bridge-Setup` artifact of the `bridge-windows` GitHub Actions run). Run it. Windows may say the publisher is unknown, because it is not signed yet: choose "More info", then "Run anyway". It asks for your OpenLobs address and the pairing code from the Computers page, and whether OpenLobs may look at web pages. That is all: it connects, and starts by itself whenever you sign in. Start menu, "OpenLobs Bridge": status, connect again, allow or stop web page looks, recent activity. Uninstall from Windows Settings; this also disconnects the computer in OpenLobs.

## Use from source (developers)

You need Node.js 22 or newer and this repository.

1. In OpenLobs, open **Computers** and press **Add a computer**. You get a code like `K7M2QX4R`.
2. In a terminal in this folder: `npm run bridge -- pair K7M2QX4R --server https://your-openlobs-address` (add `--name "My PC"` to name it).
3. Start it: `npm run bridge -- run`. The Computers page shows it as online.
4. Press **Test** on the page: the Bridge answers with its version and Windows version.

5. To let OpenLobs look at web pages (for example a site you are building on `localhost`), run `npm run bridge -- allow browser`. This needs Microsoft Edge or Google Chrome (Windows has Edge) and a one-time `npm install`. A running Bridge picks the change up within a minute. Turn it off with `npm run bridge -- deny browser`. On the Computers page, "Look at a page" then works, and so does "look at my site on my computer" in chat.

A browser look opens the page in a fresh, empty browser (no logins, nothing remembered), takes a picture, and reports page errors. It never clicks or types. Pages on this computer and the public internet are opened; private-network addresses (router, intranet), local files, and anything a page tries to load from them are refused.

### Letting OpenLobs use a browser (browser use)

`bridge allow browser_use` (Start menu: "Allow OpenLobs to use a browser"). Then, in OpenLobs, turn on **Settings > Assistant browser > Use the browser on my computer**. The chat and Tasks then do their browser work on this computer instead of in the cloud.

- **Its own profile.** It uses Edge or Chrome, in a profile of its own (`%LOCALAPPDATA%\OpenLobsBridge\browser-profile`), never the one you browse with: it has none of your history, bookmarks or logins, only what you sign in to for OpenLobs. Sign in yourself once with `bridge browser login https://the-site` (Start menu: "Sign in to sites for OpenLobs"): a normal window opens on that profile and nothing you type goes through OpenLobs. Sites that keep you signed in for days stay signed in; sites that sign you out when the browser closes will ask again after an hour with no use (the browser closes itself then). `bridge browser forget` signs out of everything.
- **Same rules as the cloud browser.** The same engine runs here: OpenLobs asks you before anything that sends, pays, posts or deletes (the decision is made on this computer from the live page); it never types passwords, card numbers or codes (you take over for those); it stops when it is going in circles; you can take over the page at any time from the chat.
- **Cannot reach your network.** Every connection the browser makes goes through a small local guard that refuses private-network addresses (router, intranet, other computers), this computer itself, and non-web ports, at every redirect. It does not open a port you can reach.
- **One at a time.** One browser session at a time; a new chat replaces the old page.
- **Stopping.** Pause (tray icon or `bridge pause`) closes the browser at once. So does quitting the Bridge or switching browser use off.
- If the computer is off, asleep or the Bridge is not running, the chat says so; it does not quietly switch to the cloud (that browser has none of your sign-ins).

Live steps (the picture of the page, a click) travel through the same calls the Bridge already makes to OpenLobs, are held in memory on the server and are never stored.

### Emergency stop and tray icon

On Windows the Bridge shows a small icon by the clock: green when connected, orange while it is working, grey when it cannot reach OpenLobs, red when paused. Its menu has **Pause everything now** (also Resume), **Show recent activity**, **Open OpenLobs Computers page** and **Quit the Bridge**. Pausing stops whatever is running within a second, tells OpenLobs this computer can do nothing, and refuses anything that still arrives, even a ping. The same switch is `bridge pause` / `bridge resume` (and Start menu entries), and works without the icon. The icon talks to the Bridge only through small files in its own folder (`paused.flag`, `quit.flag`, `state.json`); it opens no port. If the Bridge stops, the icon removes itself within 20 seconds. Not verified yet by a person looking at a real desktop.

### Spreadsheets (Excel)

`bridge allow excel --folder "C:\Users\you\Documents\OpenLobs"` (on Windows, leave out `--folder` to pick the folder in a window; the Start menu entry "Allow spreadsheet work in one folder" does this). OpenLobs can then list the `.xlsx`/`.csv` files in that folder (one level of sub-folders), read their sheets, headers and first rows, and save a **new copy** with changes made from a fixed list of steps: fill formulas, set cells, clean text and numbers, sort, summarize into a new sheet (live formulas), format, add a chart, rename/add/delete sheets, optionally save a PDF.

- The original is never changed, an existing file is never replaced (a number is added to the name), and nothing outside the chosen folder can be reached: `..`, other drives, network paths and shortcuts that lead out are refused here, on this computer.
- A file that has charts, pivot tables, pictures or macros is not copied through unless the person agreed to lose them.
- Formulas that reach outside the spreadsheet (web, other files, other programs) are refused.
- Excel is used when installed (through its own automation); otherwise LibreOffice. Either recalculates every formula, draws the charts, reports any cell showing an error, and can save a PDF. With neither, simple changes still work but are not recalculated, and charts/PDFs are refused.
- `bridge selftest` checks all of this on the spot in a throwaway folder (Start menu: "Check that spreadsheets work").
- Pivot tables cannot be created yet.

Other commands: `npm run bridge -- status` (is it paired and can it reach the server), `npm run bridge -- disconnect` (forget the pairing on this computer; also disconnect it on the Computers page).

The server address must be `https://`; plain `http://` is accepted only for `localhost`.

## Not built yet

- Signing the installer, automatic updates, and a release process (the installer is built by CI).
- A settings window (the tray menu and Start menu entries cover pause, activity and quit).
- Storing the token in the Windows credential store (DPAPI) instead of a protected file.
- Mac and Linux are untested.
- Other apps. (Browser use exists; the `browser_look` job itself still never clicks or types.)
- Browser use has been tested here against real Chromium and a fake OpenLobs, not yet on a Windows computer with Edge.
- Saved sign-ins kept in a vault, skills learned from your corrections, and more than one browser session at a time.
- The Microsoft Excel engine is written but has only been tested against LibreOffice; run `bridge selftest` on a PC with Excel to confirm it there.

## Tests

`tests/bridge.test.mts` runs the real pairing, polling and result logic end to end with an in-memory database.
