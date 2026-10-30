# Browser use

The assistant can operate websites for you: open a page, read it, click, type, choose, scroll, and carry on until the job is done or it needs you. You watch it live in a card in the chat, and you can take over at any moment.

It is a real browser, not a simulation. Everything here was built against a real Chromium and a test shop, and the tests in `tests/browserSession.test.mts` and `tests/browserTool.test.mts` run that browser.

## What you see

It looks like the rest of the chat, nothing new to learn:

- **One line per step**, like every other tool call, with the same shimmer while it works ("Opening shop.example…", then "Opened shop.example"). Click a line to see what is behind it: the page it landed on, what was typed, anything that went wrong.
- **One short rectangle for the live page, framed like a browser**: a tab for each open page (the one you see is raised), an address bar with the site, and the page below. **Take over** (then **Hand back**) and **close** sit in the address bar. Only the site name is shown, never the full address of other tabs.
- **Approvals use the same gradient card** as every other approval, naming the control and the site ("Clicking “Place order” on shop.example").

## The rules it works by

| Situation | What happens |
| --- | --- |
| A step sends, buys, deletes, changes or posts something (a "Place order" or "Delete account" button, a form submit, Enter in a form or in a message box) | The standard approval card asks you first, naming the control and the site. Decline and nothing is done. |
| Search boxes, "Next", "Read more", scrolling, opening a page | No question asked. |
| A password, a one-time code or a card number | The assistant never types it and never sees it. It tells you to press **Take over**. |
| A sign-in page or a "verify you are human" page | It stops and tells you to take over. It does not try to get past it. |
| A page that tells the assistant to do something | Page text is marked untrusted. It is information, never instructions. |
| A link or redirect to a private address (your network, `localhost`, a cloud metadata address, `file://`) | Refused, and the page is left blank. |
| A download, an upload, the camera, microphone or location | Blocked. |
| Another tab opens | The assistant moves to it (up to 4 tabs). |

**Who decides what needs your OK.** Not the assistant. The browser looks at the live page and decides from what is really there. The tool only asks it. Even if the assistant skipped the question and called the worker directly, the worker refuses a step like that unless it was approved. And if a page changes what a button says between the moment the assistant read it and the moment it clicks, the click is not done and the page is read again.

**Taking over.** You click the picture and type, or type in the box under it (works on a phone too; the eye shows or hides what you type). What you type goes straight to the page. It is not saved, not logged, and not given to the assistant. "Hand back" gives the page back and the assistant reads what is there now.

## Limits

One browser per person (opening one in another chat closes the first). Per session: 80 steps, 10 minutes idle, 20 minutes in all, 4 tabs, 1,000 characters per typed step. Per person: 40 steps a minute, 400 steps and 60 opened pages a day. A busy worker answers "try again in a minute" rather than piling up browsers.

## Where it runs

On the browser worker (`inspector/server.ts`, the same service that takes screenshots for visual checks). Set `INSPECTOR_URL` and `INSPECTOR_SECRET` and the tool appears; without them it is not offered, so the assistant is never told about a tool that cannot work. See `docs/deploy.md`, section 5c.

For development, `INSPECTOR_LOCAL=1` runs the browser inside the app (never when `NODE_ENV=production`). Add `INSPECT_ALLOW_LOCAL=1` to let it open `http://localhost` pages. `INSPECTOR_CHROMIUM_PATH` or `OPENLOBS_BROWSER_PATH` points at a browser if Playwright's is not installed.

It is a sensitive tool group ("Use a browser for you") in the agent builder. It is never offered to agents proposed by the assistant, it is withheld from agents shared in the Reef unless the person allows it, and it never runs in an unattended task, because a person has to be there for the questions.

## How it is built

| Part | File |
| --- | --- |
| Actions, limits, which steps need an OK | `server/services/browser/model.ts` |
| The script that reads a page and numbers its controls | `server/services/browser/snapshot.ts` |
| One browser session | `server/services/browser/session.ts` |
| Sessions on one machine (one per chat, a cap, a sweep) | `server/services/browser/manager.ts` |
| The same service in the app, over HTTP, and the worker's answers | `server/services/browser/service.ts` |
| The proxy every connection goes through | `server/utils/guardProxy.ts` |
| The assistant's tool and what it is shown | `server/utils/tools/browser.ts`, `server/services/browser/format.ts` |
| Routes for the live card | `server/routes/api/browser/[chatId]/*` |
| The card | `src/components/chat/tool/Browser.vue`, `src/composables/useBrowserView.ts` |

The proxy is also what keeps the screenshot worker safe: Chromium follows redirects by itself and never shows them to a per-request check, so a public page that redirected to a private address used to slip through. Now every connection is checked where it is made.

## Not done yet

- It runs on the hosted worker only. The same engine is meant to run on your own computer through the Bridge, so it can use your own signed-in browser. That needs its own permission design.
- Pages inside frames (some payment forms) are not numbered; take over for those.
- No file downloads or uploads, by design for now.
- No metering in credits yet (only the daily and per-minute limits above). Decide whether a browsing session should cost credits before opening it to everyone.
- Sessions live in the worker's memory, so the worker must run as one instance. Past a few people at once it needs a session store and routing.
