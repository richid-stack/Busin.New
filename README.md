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
| `SEARCH_PROVIDERS` | Optional comma-separated order for search providers (default `parallel,tavily,firecrawl,duckduckgo`). |

## Skills

A skill is a folder `skills/<name>/SKILL.md`: a short YAML header (`name`, `description`) and plain-language instructions. The chat sees the list of names and descriptions, and when a request matches one it calls `load_skill` and follows the instructions. Skills are text only: they can tell the assistant how to use the tools it already has, but they cannot run code.

To add one, create the folder and file (the folder name must equal `name`), then run `npm test`: it checks the format and that the skill only mentions tools that exist. A broken skill is skipped with a warning, never a crash. Skills are bundled at build time, so a new one needs a rebuild.

Skills from other projects follow the same format ([agentskills.io](https://agentskills.io)). Check the licence before copying one in.

## Attached files

Chat accepts images, PDFs, Word (`.docx`), CSV, Markdown, JSON and text files. Images (and PDFs, for Google, Anthropic and OpenAI models) go to the model directly; everything else is read on demand by the `read_document` tool, in parts for long files. Scanned PDFs, legacy `.doc` and Excel files are not read yet. Only uploaded files are accepted: an attachment that points at a web address is dropped rather than fetched, and Word files are checked for oversized contents before they are opened.

## Deploying to Google Cloud

- The server uses Application Default Credentials: the attached service account needs Firestore access (and Firebase Auth token verification).
- Firestore is only accessed through the Admin SDK; `firestore.rules` denies all direct client access. Deploy with `firebase deploy --only firestore:rules`.
- Workflow webhooks require the per-workflow secret (`x-webhook-secret` header or `?secret=`).

## Notes

- Rate limits are held in memory per server instance.
- Chat messages are stored one document each (Firestore 1 MiB limit), so attachments are capped.
