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

Skills from other projects follow the same format ([agentskills.io](https://agentskills.io)). Check the licence before copying one in.

## Attached files

Chat accepts images, PDFs, Word (`.docx`), CSV, Markdown, JSON and text files. Images (and PDFs, for Google, Anthropic and OpenAI models) go to the model directly; everything else is read on demand by the `read_document` tool, in parts for long files. Scanned PDFs, legacy `.doc` and Excel files are not read yet. Only uploaded files are accepted: an attachment that points at a web address is dropped rather than fetched, and Word files are checked for oversized contents before they are opened.

## Creating files

Signed-in users can ask chat for finished files: Word or PDF (`create_document`), Excel (`create_spreadsheet`) and PowerPoint (`create_presentation`). The content is plain text, lists, tables and numbers only: no images, links or macros, and spreadsheet formulas are limited to ordinary calculation functions. PDFs use the bundled Noto Sans font (Latin and Latin Extended, so the cedi sign and Twi letters work); run `npm run fonts` to rebuild `fonts.generated.ts`.

Files are stored in the Firestore collection `generated_files` (each at most 700 KB, readable only by the user who created it through `GET /api/files/:id`) and expire after 30 days. Expired files are refused and deleted when someone asks for them. To also clean them up automatically, add a free Firestore TTL policy on the `expiresAt` field of `generated_files` (Firebase console, Firestore, TTL).

## Workflow steps

Besides AI agents, approvals and connected apps, workflows have these steps:

- **HTTP Request**: GET, POST, PUT, PATCH or DELETE to a public web address, with headers and a body. Local and private addresses, non-standard ports and redirects are refused. Headers are stored with the workflow.
- **Read Web Page**: a page as text (uses Firecrawl when `FIRECRAWL_API_KEY` is set).
- **Set Fields**: build new values from earlier steps (text with placeholders, a formula, or JSON).
- **Loop**: runs one small step (read a page, send a request, set fields or ask the AI) for each item of a list, three at a time, with `{{item}}` and `{{index}}`. At most 50 items (10 for AI steps). Failed items are reported without stopping the rest, unless "stop on first error" is on.

Every connected-app, AI, HTTP, page, Set and Loop step also has **If this step fails** settings: retry up to 3 times (waits double each time; setup mistakes are never retried, and a loop is never retried as a whole), then either stop the run, carry on with the error as the step's output, or follow the red **ERROR** connector to a different step. Each user can send 300 workflow web requests per 10 minutes.

## Agents

An agent is a saved assistant: a name, instructions, an optional fixed model, the tools it may use, the skills it may load and a limit on steps per reply. Make them on the **Agents** page (start from Research assistant, Inbox helper or Document drafter, or blank), then pick one next to the model menu when you start a chat, or press **Chat** on its card. A chat keeps its agent; the link is stored on the chat on the server, so it cannot be swapped from the browser.

- Tools come in groups (web, reading files, creating files, small helpers, connected apps, workflows). An agent only gets the groups switched on; the two that act in your accounts (apps and workflows) start off and carry a warning.
- Deleting an agent leaves its chats in place; they carry on as the standard assistant.
- Each person can keep 10 agents. Steps per reply: 1 to 15. Agents are stored in the Firestore collection `agents` and are private to their owner.
- Each reply already has an **Agent Activity & Timeline** view (message menu) that lists the steps, tools and sources it used.

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

- The server uses Application Default Credentials: the attached service account needs Firestore access (and Firebase Auth token verification).
- Firestore is only accessed through the Admin SDK; `firestore.rules` denies all direct client access. Deploy with `firebase deploy --only firestore:rules`.
- Workflow webhooks require the per-workflow secret (`x-webhook-secret` header or `?secret=`).

## Notes

- Rate limits are held in memory per server instance.
- Chat messages are stored one document each (Firestore 1 MiB limit), so attachments are capped.
