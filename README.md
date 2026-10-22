# OpenLobs 🦞

AI chat assistant plus a visual workflow studio. Vue 3 + Vite front end, Nitro server routes, Firebase Auth + Firestore, AI SDK v7, and Composio for connecting Google Workspace and third-party apps.

## Run locally

```bash
npm install
cp .env.example .env   # fill in at least one AI key
gcloud auth application-default login   # lets the server reach Firestore/Auth locally
npm run dev
```

`npm test` runs the unit tests, `npm run typecheck:server` typechecks the server, `npm run build` builds.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` (or `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) | At least one model provider key. The server falls back to whichever provider has a key. |
| `SESSION_SECRET` | **Required in production.** 32+ random characters for the session cookie. |
| `COMPOSIO_API_KEY` | Enables app integrations (Gmail, Drive, Slack, Notion, ...). Without it integrations are disabled, never simulated. |
| `CORS_ALLOWED_ORIGINS` | Optional comma-separated extra browser origins. Same-origin is always allowed. |
| `ALLOW_ANONYMOUS_CHAT` | Chat requires sign-in by default. Set to `true` to allow anonymous (rate-limited) chats, e.g. local demos. |
| `TRUSTED_PROXY_HOPS` | Reverse proxies in front of the app (default `1`, matching Cloud Run). Used to read the real client address for rate limiting. |
| `FIRECRAWL_API_KEY`, `PARALLEL_API_KEY`, `TAVILY_API_KEY` | Optional web tool keys. Without them, search uses DuckDuckGo and pages are read by the built-in reader. Each key you add switches that provider on. |
| `CRON_SECRET` | Enables scheduled workflows. 16+ random characters; the timer endpoint does not exist without it. See "Scheduled workflows". |
| `SCHEDULE_MIN_MINUTES` | Shortest gap allowed between two runs of a scheduled workflow (default `15`). |
| `SEARCH_PROVIDERS` | Optional comma-separated order for search providers (default `parallel,tavily,firecrawl,duckduckgo`). |

## Skills

A skill is a folder `skills/<name>/SKILL.md`: a short YAML header (`name`, `description`) and plain-language instructions. The chat sees the list of names and descriptions, and when a request matches one it calls `load_skill` and follows the instructions. Skills are text only: they can tell the assistant how to use the tools it already has, but they cannot run code.

To add one, create the folder and file (the folder name must equal `name`), then run `npm test`: it checks the format and that the skill only mentions tools that exist. A broken skill is skipped with a warning, never a crash. Skills are bundled at build time, so a new one needs a rebuild.

Ships with general skills (research, meeting notes, inbox triage, proposals) and 18 for small businesses in Ghana: invoices, tax and VAT lookups, payroll estimates, payment reminders and reconciliation, registration, bookkeeping, cash flow, pricing, import costing, tenders, hiring, grants, content plans, data protection and a weekly review. The ones that involve tax, duty or deadlines tell the assistant to look the current rule up and cite it; a test fails if one carries a hard-coded rate. Each skill adds one line to what the chat reads on every message, so add skills that earn their place.

Skills from other projects follow the same format ([agentskills.io](https://agentskills.io)). Check the licence before copying one in.

## Attached files

Chat accepts images, PDFs, Word (`.docx`), CSV, Markdown, JSON and text files. Images (and PDFs, for Google, Anthropic and OpenAI models) go to the model directly; everything else is read on demand by the `read_document` tool, in parts for long files. Scanned PDFs, legacy `.doc` and Excel files are not read yet. Only uploaded files are accepted: an attachment that points at a web address is dropped rather than fetched, and Word files are checked for oversized contents before they are opened.

## Creating files

Signed-in users can ask chat for finished files: Word or PDF (`create_document`), Excel (`create_spreadsheet`) and PowerPoint (`create_presentation`). The content is plain text, lists, tables and numbers only: no images, links or macros, and spreadsheet formulas are limited to ordinary calculation functions. PDFs use the bundled Noto Sans font (Latin and Latin Extended, so the cedi sign and Twi letters work); run `npm run fonts` to rebuild `fonts.generated.ts`.

Files are stored in the Firestore collection `generated_files` (each at most 700 KB, readable only by the user who created it through `GET /api/files/:id`) and expire after 30 days. Expired files are refused and deleted when someone asks for them. To also clean them up automatically, add a free Firestore TTL policy on the `expiresAt` field of `generated_files` (Firebase console, Firestore, TTL).

## Tasks

A task (the **Tasks** page, `/api/tasks`) is a goal plus the ways you will know it worked. It runs on its own in the background, then every criterion is checked and the task ends as `done`, `partly done`, `not done` or `needs your review`: never `done` on the agent's say-so.

- **Checks:** a file exists (exact), a page looks right (screenshot judged by a vision model, see Visual checks), an AI judges the result from the tool log and files (labelled "Judged by an AI model"), or you check it yourself. What cannot be checked is left for you, not marked as met.
- **Retries:** if something is not met and attempts remain (default 2, at most 3), the next attempt is told exactly what the check found. Limits: attempts, steps (3-15), minutes (1-10), 3 tasks running or waiting per person, one credit per attempt (refunded if the model fails).
- **Tools:** only those in `server/services/tasks/registry.ts` that may run without you watching (reading, searching, making files, looking at pages). Anything that acts in your accounts, workflows and MCP servers are left out for now. A test fails if a chat tool is missing from the registry.
- **Durability:** tasks are claimed with a lease, so a worker that stops is replaced by the next timer call; Stop reaches the running model call; late writes from a replaced worker are refused.
- **From chat:** the assistant can draft a task (`task_propose`) as a card with a Start button; nothing runs until you press it.
- **Email:** a task that ran two minutes or more emails you when it ends (Settings, Notifications; off switch; once per task; never for cancelled ones).
- Tasks and their logs are part of the account export and erase.

## Bridge (computers)

The **Computers** page connects your own computer to OpenLobs through the Bridge (`bridge/`), a small program you run there. This is the base for working with desktop apps later (a real browser, Excel); today it does one harmless thing, answer a ping, so the connection can be proven before anything riskier is built on it.

- **Pairing:** the page makes an 8-character code (valid 10 minutes, usable once, stored hashed, one open code per person). `npm run bridge -- pair CODE --server https://your-openlobs` trades it for a device token, which the server keeps only as a hash. Up to 3 computers per person.
- **Only calls out:** the Bridge long-polls `POST /api/bridge/poll` with its token. It opens no port and starts no program on its own (a test scans its source for that).
- **A fixed list:** the server only creates jobs from `JOB_KINDS` in `server/services/bridge/model.ts` (today `ping`), and the Bridge refuses anything not in its own `HANDLERS` list, so a hacked server still cannot make it run arbitrary commands. Results are checked with a strict schema. Jobs expire after 2 minutes, at most 5 are open per computer.
- **Control:** Test connection, Stop, and Disconnect (the token stops working at once and open jobs are cancelled). The Bridge says what it is doing, backs off when the server is unreachable, and stops on its own if it is disconnected.
- Computers, their logs and jobs are part of the account export (never the token) and the erase.

Not built yet: an installer or `.exe`, a tray icon, storing the token in the Windows credential store (it is a file only you can read, in `%APPDATA%\OpenLobsBridge`), and Mac or Linux testing. Windows with Node 22 is the target. See `bridge/README.md`.

## Visual checks

Chat has an `inspect_design` tool (agent tool group "Check designs and pages") and workflows have a **Visual Check** step. Both screenshot a web address with a real browser, or look at a picture the user attached, and a vision model reports defects against the requirements (blocker, major or minor, with where it is and how to fix it). Called again with the earlier defects, it says which are fixed, still there or unclear, so "build, look, fix, look again" is a loop an agent can run (see the `visual-qa` skill). It works for any page or screen, not only code an agent wrote, and the result is advice from a model: it cannot judge hover states, animation or other pages.

Screenshots are taken by a separate worker (`inspector/server.ts`, image built from `Dockerfile.inspector`) so the app stays small; set `INSPECTOR_URL` and `INSPECTOR_SECRET` (see `docs/deploy.md`). For development, `INSPECTOR_LOCAL=1` runs the browser inside the app (set `INSPECT_ALLOW_LOCAL=1` to allow `http://localhost` pages and `INSPECTOR_CHROMIUM_PATH` if Playwright's browser is not installed). The in-app browser is never used when `NODE_ENV=production`. Without a worker, attached screenshots still work. A model that reads images is needed (not the Groq models).

## Workflow steps

Besides AI agents, approvals and connected apps, workflows have these steps:

- **HTTP Request**: GET, POST, PUT, PATCH or DELETE to a public web address, with headers and a body. Local and private addresses, non-standard ports and redirects are refused. Headers are stored with the workflow.
- **Read Web Page**: a page as text (uses Firecrawl when `FIRECRAWL_API_KEY` is set).
- **Visual Check**: takes a screenshot of a public page, has a vision model judge it against requirements you write, and outputs `passed`, `verdict`, `score`, `defects` (each with severity, area, problem and a suggested fix) and the saved screenshot. A failing verdict is data, not an error, so a later step (an AI agent, a message, an approval) can act on the defects. Pass `{{check.defects}}` as "earlier problems" on a second Visual Check to see which are fixed. Costs credits like one chat message.
- **Set Fields**: build new values from earlier steps (text with placeholders, a formula, or JSON).
- **Loop**: runs one small step (read a page, send a request, set fields or ask the AI) for each item of a list, three at a time, with `{{item}}` and `{{index}}`. At most 50 items (10 for AI steps). Failed items are reported without stopping the rest, unless "stop on first error" is on.

Every connected-app, AI, HTTP, page, Set and Loop step also has **If this step fails** settings: retry up to 3 times (waits double each time; setup mistakes are never retried, and a loop is never retried as a whole), then either stop the run, carry on with the error as the step's output, or follow the red **ERROR** connector to a different step. Each user can send 300 workflow web requests per 10 minutes.

## Agents

An agent is a saved assistant: a name, instructions, an optional fixed model, the tools it may use, the skills it may load and a limit on steps per reply. Make them on the **Agents** page (start from Research assistant, Inbox helper or Document drafter, or blank), then pick one next to the model menu when you start a chat, or press **Chat** on its card. A chat keeps its agent; the link is stored on the chat on the server, so it cannot be swapped from the browser.

- Tools come in groups (web, reading files, creating files, small helpers, connected apps, workflows). An agent only gets the groups switched on; the two that act in your accounts (apps and workflows) start off and carry a warning.
- Deleting an agent leaves its chats in place; they carry on as the standard assistant.
- Each person can keep 10 agents. Steps per reply: 1 to 15. Agents are stored in the Firestore collection `agents` and are private to their owner.
- Each reply already has an **Agent Activity & Timeline** view (message menu) that lists the steps, tools and sources it used.

**Suggestions.** Two small helpers, neither of which makes an extra model call:
- *A hint for agents you already have.* While typing a new chat, if the words clearly fit one of your agents (and no other as well), a bar offers "This looks like a job for <agent>" with Use it / dismiss. It compares words locally and never switches on its own.
- *A draft for a new one.* In a standard chat the assistant can call `propose_agent` when you ask for an agent or describe a repeated job. You get a card with its name, tools and full instructions and a **Save agent** button; nothing is saved until you click. Groups that act in your accounts (connected apps, workflows, MCP) can never be proposed; you switch those on yourself in the editor. Agents do not propose agents.

## MCP servers

People can add tools from their own MCP servers on **Integrations → MCP servers**. It is built so a server can never quietly gain power:

- **Public https only.** Addresses go through the same checks as web fetching (public IPs only, checked when connecting, no redirects, no query strings). Set `MCP_ALLOWED_HOSTS` (comma-separated, a leading `.` allows subdomains) to restrict a deployment to a list.
- **Approval per tool.** Connecting adds nothing. The person reads each tool's description and inputs and ticks the ones to allow (at most 5 servers, 15 tools per server, 25 in total). The model is shown the stored, approved description, never what the server says today.
- **Changes switch a tool off.** A tool is fingerprinted (name + description + input schema). Before each call the server is asked again; if it no longer matches, the call is refused and the server is flagged for review. The address cannot be edited after adding.
- **Tokens are encrypted.** Access tokens are sealed with AES-256-GCM using `SECRETS_KEY` (or `SESSION_SECRET` if that is all that is set) and never sent back to the browser.
- **Results are untrusted data.** Each result is labelled so, size-capped, rate-limited per person and cut off after a timeout. Images and other non-text content are not passed to the model.
- **Agents.** The "Use your MCP servers" group switches an agent's approved MCP tools on. It is not on by default and does not include connected apps.

## Memory

**Memory** (sidebar) holds short notes OpenLobs keeps about a person so they do not have to repeat themselves. There are no extra model calls: nothing is learned in the background.

- **Only what the person asks for.** Notes come from the Memory page, or from chat when the person says "remember that…" / "forget that…". The `remember` and `forget_memory` tools refuse unless the person's own latest message asks for it, so text on a web page, in a file or in a tool result cannot plant a memory.
- **No secrets.** Passwords, keys, tokens and card numbers are refused, on the page and in chat.
- **Small on purpose.** At most 30 notes of 240 characters, sent with each message, which keeps the cost predictable.
- **In control.** Add, edit, delete or forget everything, or switch memory off (nothing is shared or saved while off; stored notes stay).
- **Agents** only see memory when the "Remember things about you" group is on for them (off by default).
- Stored in the `memories` and `memory_settings` collections, private to each person (the server enforces ownership; client access is denied by `firestore.rules`).

## Usage limits

Every model call costs **credits**, counted per person per day and per month (UTC, which is Ghana time).

| Plan | Daily | Monthly |
| --- | --- | --- |
| Guest (not signed in) | 5 | 5 |
| Free | 30 | 400 |
| Pro | 300 | 5000 |

- **What costs credits:** a chat message, an AI step in a workflow (including scheduled runs), a workflow integration action, and the workflow assistant. A model can cost more than 1 (`MODEL_COST` in `server/services/usage/plans.ts`).
- **Friendly stops.** Over the limit, the request is refused with a plain message that says which limit and when it resets; the chat shows it as a toast. A request that fails before any work is refunded.
- **No double spending.** The check and the count are one Firestore transaction, so requests sent at the same moment cannot slip past the limit.
- **Never locks people out by accident.** If usage counting itself is unavailable the request is allowed (and logged); a real limit always applies.
- **Plans.** `user_plans/{userId}` holds `{plan, endsAt}`; an ended Pro plan counts as Free. Billing (Paystack) will write it.
- `GET /api/usage` returns the signed-in person's plan, use and reset times. Tune limits with `USAGE_<GUEST|FREE|PRO>_<DAILY|MONTHLY>`; list owners and testers in `USAGE_UNLIMITED_USER_IDS`.
- Stored in `usage` (one document per person per month) and `user_plans`, server-only like the rest.

## Settings and your data

**Settings** (name menu, bottom of the sidebar) has the person's profile (display name), plan and usage, shortcuts to Memory, Agents, Connected apps, MCP servers and Workflows, theme, security (sign-in method, password reset, log out) and their data.

- **Download your data** (`GET /api/account/export`): chats with messages, workflows with runs, agents, memory, MCP servers, files (listed, not embedded), plan, usage and connected app names, as one JSON file. MCP tokens and other secrets are never included.
- **Delete account** (`DELETE /api/account`): the person types `DELETE` and signs in again first (the server rejects a sign-in older than 10 minutes). Connected apps are disconnected first, and if that fails nothing is deleted, so a retry starts clean. Then chats (with messages and votes), workflows (with runs), agents, memory, MCP servers, files, usage, plan and the sign-in account are removed. A half-finished attempt can be run again.
- The list of what is exported and deleted lives in one place, `server/services/account/account.ts`; a new collection that holds personal data must be added there.
- Email notifications are not in Settings yet; they arrive with email sending.

## Payments and email

**Pro** is sold as prepaid periods (1 or 12 months) through Paystack, by card or mobile money. Mobile money in Ghana needs the person to approve each payment on their phone, so nothing renews by itself; a reminder email goes out before Pro ends instead.

- **Off until configured.** Without `PAYSTACK_SECRET_KEY` and at least one price (`PRO_PRICE_MONTH`, `PRO_PRICE_YEAR`) Settings says "Pro plans are coming soon" and checkout refuses.
- **The server decides.** Checkout records the expected amount first; Pro is granted only when Paystack confirms (`transaction/verify`) a successful payment of exactly that amount and currency. A browser or a webhook alone never grants anything. A wrong amount or currency grants nothing and is flagged `mismatch`.
- **Two ways in, applied once.** The person's return page (`/billing/callback`) and Paystack's webhook (`POST /api/webhooks/paystack`, HMAC-SHA512 signature checked) both call the same function; a transaction makes sure only the first one counts. Paying while on Pro adds time to what is left.
- **Receipts and reminders** go through Resend (`RESEND_API_KEY`, `EMAIL_FROM`); without them nothing is sent and nothing breaks. `POST /api/cron/billing` (same `CRON_SECRET` as the workflow timer) sends one reminder 3 days before Pro ends. Scheduled workflow failures can email the owner, at most once a day per workflow. People switch these off in Settings → Notifications.
- Payment records are kept for the books but anonymised when an account is deleted (see Settings and your data).
- Collections: `payments`, `user_plans`, `user_settings`, `notification_log`.

## Connectors for Ghana (your own key)

Some services are connected with a key the person pastes in, not through Composio. Today that is **Paystack** (balance, payments, customers, payment links in cedis) and **Arkesel** (SMS). Each is a short declarative definition in `server/services/connectors/definitions.ts`: a fixed https host, how the key is sent, and the few actions allowed, with their parameters. There is no per-service code.

- **Keys** are stored sealed (`SECRETS_KEY`), tied to the person, never sent back to the browser, never put in a result or a log, and only sent to the connector's own host (redirects are not followed).
- **Parameters** are checked against what each action declares. Nothing undeclared goes through, amounts are in cedis with at most two decimals, and a model can only choose from the declared actions.
- **Limits**: actions that cost money or reach other people have a daily limit per person (payment links 50, SMS 200 recipients), taken in a transaction and given back if the call fails. Every such send is recorded in `connector_audit` (no message text), which is part of the account export and is erased with the account.
- Paystack here **cannot** send money, refund or change settings. Use a test key (`sk_test_…`) first.
- Works in chat (`integration_execute`), as a workflow action node, and for agents. In a workflow, set `action` and `params` in the node config to run one exact action with no model involved.

To add a service (Hubtel, mNotify, MTN MoMo…), add a definition from its API reference, add it to `CONNECTORS`, a showcase entry in `src/utils/integrationShowcase.ts`, and a test. Also new in the catalogue: Google Slides, Google Meet, Microsoft SharePoint and OneNote (the two Microsoft ones need your own Microsoft Entra app set up once in Composio).

## Workflow templates

The Workflows page has a gallery of ready-made workflows (digest of links, weekly competitor snapshot, website uptime check, morning inbox digest, new inquiry with approval, hot lead router, Friday status report). A template opens in a dialog that shows how it works, which apps it needs (and whether they are connected) and what to change before switching it on. Using it saves a **draft** copy with your chosen AI model and your time zone, so nothing runs and no schedule starts until you deploy it.

Templates live in `src/utils/workflowTemplates.ts`. To add one, add an entry there (step ids are letters and numbers only, because formulas like `check.ok` cannot read ids with hyphens); `npm test` checks that every template is wired correctly and runs each one through the workflow engine with the AI steps stubbed.

## Scheduled workflows

Add a **Schedule** trigger and pick when it runs (every 15 minutes, hourly, daily, weekdays, weekly, monthly, or a custom five-field cron such as `0 9 * * 1-5`) and the time zone. The form shows the next five run times. It runs only while the workflow is **active** (Deploy).

The app has no background process of its own, so a timer outside it calls the app. With Google Cloud this is one free Cloud Scheduler job:

```sh
gcloud scheduler jobs create http openlobs-tick \
  --schedule="*/5 * * * *" \
  --uri="https://<your-app>/api/cron/workflows" \
  --http-method=POST \
  --headers="Authorization=Bearer <CRON_SECRET>"
```

Set the same `CRON_SECRET` on the app (the secret is also accepted as an `x-cron-secret` header). Each call starts every workflow whose time has come, so a schedule is checked every 5 minutes in this setup. A few rules keep a free tier safe:

- The shortest gap between runs is 15 minutes (`SCHEDULE_MIN_MINUTES`), and each user can have 5 scheduled workflows on at once.
- A run is claimed in a Firestore transaction, so overlapping calls start it once. After downtime a missed schedule runs once, not once per missed slot.
- After 5 failed scheduled runs in a row the workflow is paused and the reason is shown on the Schedule step. A run waiting for approval does not count as a failure.
- The trigger's output has `event`, `scheduledFor`, `firedAt`, `cron` and `timezone`, available to later steps like any other trigger output.

## Deploying to Google Cloud

Step-by-step (Cloud Run, secrets, scheduler, backups, file expiry, alerts): [docs/deploy.md](docs/deploy.md). A `Dockerfile` and `cloudbuild.yaml` are included, and `GET /api/health` is the health check.

- The server uses Application Default Credentials: the attached service account needs Firestore access (and Firebase Auth token verification).
- Firestore is only accessed through the Admin SDK; `firestore.rules` denies all direct client access. Deploy with `firebase deploy --only firestore:rules`.
- Unexpected server errors are logged as JSON for Cloud Error Reporting (message, stack, method and path only; secrets scrubbed). Browsers report their own errors to `POST /api/client-errors` (rate limited, logged as warnings).
- Workflow webhooks require the per-workflow secret (`x-webhook-secret` header or `?secret=`).

## Notes

- Rate limits are held in memory per server instance.
- Chat messages are stored one document each (Firestore 1 MiB limit), so attachments are capped.
