# Contributing to OpenLobs

Thank you for wanting to help. OpenLobs is an AI assistant that acts in your apps, checks its own work and asks before it changes anything. It is built in the open, from Ghana, and it gets better when more people use it, break it and fix it. You do not need to be an expert. A fixed typo, a better skill or a clear bug report all count.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. It is short.

## Ways to help

| If you like... | You could... | Needs |
| --- | --- | --- |
| Writing | Improve a [skill](skills) (plain text, no code), write a new one, fix the docs | Just a text editor and `npm test` |
| Testing | Use OpenLobs for real work and [report what broke](../../issues/new/choose) | Nothing |
| Product ideas | Propose a feature or a better way to do something | Nothing |
| Front end | Polish a screen in `src/` (Vue 3, Nuxt UI) | Node 22 |
| Back end | Work on `server/` (Nitro, Firebase, AI SDK) | Node 22 |
| Integrations | Check and add an MCP server to the shelf (`shared/mcpCatalog.ts`) | Reading the maker's docs |
| Windows | Try the Bridge on a real PC (`bridge/`) and tell us what happened | A Windows PC |

Good first contributions: a skill for a job you know well, a clearer error message, a test for something you found confusing, a missing logo.

## Before you start

- **Small change** (typo, wording, a bug with an obvious fix): just open a pull request.
- **Anything bigger** (a new feature, a new screen, a change to how something works): open an [idea](../../issues/new/choose) first and say what you want to build. We will tell you quickly whether it fits, so you do not spend a weekend on something we would have to decline.
- **Security problem:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Set it up

You need **Node 22** and Git.

```bash
git clone https://github.com/richid-stack/Busin.New.git openlobs   # the repository is being renamed to OpenLobs
cd openlobs
npm install
npm test            # runs without any account or key
```

`npm test` uses an in-memory stand-in for the database, so you can work on skills, docs, tests and most of the server without any account.

To run the whole app you need a Firebase project (a free one is enough) and at least one AI key. The steps are in [docs/reference.md](docs/reference.md#run-locally). We know this is the hardest part for a newcomer. A one-command Docker setup is planned so that you will not need your own Firebase project to try things.

## Make a change

1. Fork the repository and make a branch from `main`: `git checkout -b fix-invoice-wording`.
2. Make your change. Keep it focused: one idea per pull request.
3. Run the checks (CI runs the same ones):

   ```bash
   npm test
   npm run lint
   npm run typecheck
   npm run typecheck:server
   npm run build
   ```

   If you added or changed an icon, run `npm run icons` and commit `src/generated/icons.json`. CI fails if it is out of date.
4. Commit with a message that says what changed and why, in plain words ("Skip a run while the last one is still going", not "fix stuff").
5. Open a pull request. Say what you changed, why, and how you checked it. Screenshots help for anything visual.

A maintainer will review it. Expect questions and small requests; they are about the code, not about you.

## What we look for

These are the rules the project holds itself to. They are why people can trust it.

- **Real, not pretend.** No fake data, no simulated results, no buttons that do nothing. If something is not finished or could not be tested, the pull request says so.
- **Honest limits.** If a feature needs a key, an account or a certain system, the screen says so, and the app fails with a clear message, never silently.
- **Asks before it changes things.** Anything that creates, sends, deletes or pays goes through the approval gate. Reading is free; changing is asked.
- **Secrets stay secret.** Never commit a key, token or `.env` file. Keys are stored sealed and are never returned to the browser or put in logs.
- **Tests with the change.** A bug fix includes a test that fails without it. A new rule includes a test of the rule. The tests describe behaviour in plain sentences; follow that style.
- **Plain language in the app.** Messages and screens are written for people who are not technical.
- **Looks like the rest.** New screens follow the existing design: calm, spacious, no heavy boxes. Cards are used where they help, not everywhere.
- **Light and dark.** Check both. Check a phone-width screen too.

### Skills

A skill is `skills/<name>/SKILL.md`: a short header (`name`, `description`) and plain instructions. Skills are text and cannot run code. Rules for tax, duty or deadlines must tell the assistant to look the current rule up and cite it; never write a rate into a skill (a test fails if you do). `npm test` checks the format and that the skill only mentions tools that exist.

### MCP shelf entries

An entry in `shared/mcpCatalog.ts` must be checked against the maker's own documentation: a public https address, how it signs in, and whether it only reads or can change things. Add the date you checked and a link. We do not add servers we could not verify.

## Where things are

| Folder | What is in it |
| --- | --- |
| `src/` | The web app (Vue 3, Vite, Nuxt UI) |
| `server/` | The API and services (Nitro, Firebase, AI SDK) |
| `shared/` | Code used by both |
| `skills/` | Skills the assistant can load |
| `bridge/` | The Windows companion (browser look, spreadsheets, tray) |
| `inspector/` | The screenshot worker |
| `tests/` | The test suite |
| `docs/` | Reference and deployment notes |

[docs/reference.md](docs/reference.md) explains each feature and the safety rule behind it.

## Licence

OpenLobs is released under the [MIT licence](LICENSE). By sending a contribution you agree that it is released under the same licence.

## Questions

Ask in GitHub Discussions (Q&A). There are no silly questions, and answering someone else's is also a contribution.
