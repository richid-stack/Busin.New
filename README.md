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
| `ALLOW_ANONYMOUS_CHAT` | Set to `false` to require sign-in for chat (default: anonymous chats allowed, rate-limited). |

## Deploying to Google Cloud

- The server uses Application Default Credentials: the attached service account needs Firestore access (and Firebase Auth token verification).
- Firestore is only accessed through the Admin SDK; `firestore.rules` denies all direct client access. Deploy with `firebase deploy --only firestore:rules`.
- Workflow webhooks require the per-workflow secret (`x-webhook-secret` header or `?secret=`).

## Notes

- Rate limits are held in memory per server instance.
- Chat messages are stored one document each (Firestore 1 MiB limit), so attachments are capped.
