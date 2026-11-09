> **Status: plan agreed (26 Oct 2026), nothing built yet.** Phase 9 of the big score. It reuses what OpenLobs already has (agents, skills, workflows, MCP approvals, the account export and delete) and is written so each slice can be tried on its own.

# Phase 9: The Reef (the OpenLobs community)

## The idea

A place where people share what they build with OpenLobs, and build on each other's work: **a hub of small repos, called The Reef** (an agent, a skill, a workflow, a pack of them), each with a README, versions, forks, discussions and stars. Think Hugging Face's way of working (everything is a repo you can read, fork and discuss) applied to the things OpenLobs people actually make.

The shape that fits OpenLobs and Ghana: **small-business playbooks and automations** that someone else can copy in one click and make their own ("Ghana invoice + VAT agent", "Weekly client digest workflow", "Payment reminder pack").

## What can be shared

| Thing | What is shared | What is never shared |
| --- | --- | --- |
| Agent | name, instructions, tool groups, skills, step limit | the model key, chats, memory |
| Skill | the `SKILL.md` folder (same format as agentskills.io) | nothing hidden: it is plain text |
| Workflow | the graph, step settings, placeholders | connections, tokens, webhook secrets, run history |
| MCP recipe | the server's public address and a note on which tools to approve | tokens; every tool is still approved by the person who installs it |
| Task template | goal and "how you will know it worked" | outputs and files |
| Pack | a bundle of the above, e.g. "Small shop in Accra" | whatever its parts never share |

Each thing is a **repo**: a page with a README (the "card"), tags, the apps it needs, a licence, a version history, a fork button and a discussion tab.

## Features, by what people want to do

**Find things**
- Search and tags; "works with Gmail / Slack / Paystack" filters; newest, most forked, most starred.
- Profiles and organisations (a shop, a school, a community group).
- Collections ("everything for a restaurant").
- Verified publisher badge; "made by OpenLobs" for our own.

**Use things**
- **Install** adds a copy to your account and shows what it needs before it does ("this agent can read Gmail and change Google Docs"). Nothing starts until you connect those apps yourself.
- **Try it first** with sample input and no connections, so a stranger's workflow never touches your accounts to be previewed.

**Build on things**
- **Fork**: your own copy that remembers where it came from ("forked from Ama/invoice-helper"), with a link back.
- **Pull requests**: suggest your improvement to the original. The owner sees a side-by-side change (instructions, steps, tools added or removed) and merges or declines.
- **Versions**: each publish is a numbered version; people who installed it are told, and choose when to update. An update that asks for new permissions is shown as such.

**Ask and answer**
- **Questions**: anyone signed in can ask a question ("how do I connect Paystack to the invoice workflow?"); anyone can answer. The asker marks the answer that worked; it floats to the top. Questions can be tagged to a repo or to a part of OpenLobs, and search finds earlier answers first so the same question is not asked twice.
- Plain, no points or ranks at first. Helpful answers get a thanks; that is all.

**Talk about things**
- **Discussions** on every repo (questions, ideas, show-and-tell). Comments with threads.
- Issues for "this broke for me" with the version and (opt-in) a redacted run trace attached.
- Stars, follows and a simple activity feed.

**Later**
- Teams with private repos (share inside a company without publishing).
- Paid listings and tips with Paystack, with a revenue split to the maker.
- Bounties ("build a payroll agent for Ghana, GH₵500").
- Learning: guided builds, a weekly "built this week" showcase.

## The part that decides whether it works: safety

Community skill registries are a known target. OpenClaw's ClawHub had [malicious skills uploaded that targeted crypto users](https://tomshardware.com/tech-industry/cyber-security/malicious-moltbot-skill-targets-crypto-users-on-clawhub), and security teams (for example [Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)) have written about the supply-chain risk. Our design starts from that:

1. **Shared things are text and settings, never code.** Skills are already text-only. Workflow steps are the app's own step types. There is no "run this script" in a pack.
2. **Permissions are shown, not assumed.** Every repo carries a generated list of the apps, actions and tools it needs. Installing shows it. Forks never inherit connections, keys or tokens.
3. **Nothing changes under you.** Installed versions are pinned. A new version that adds a permission or an MCP tool is a prompt, not an update.
4. **Scan on publish.** Secrets (keys, tokens, card numbers), hidden Unicode, links to look-alike domains, prompt-injection phrases in instructions, and instructions that ask the assistant to hide what it does. Failures block publishing with a reason; borderline ones go to review.
5. **Identity and brakes.** Signed-in publishers only, rate limits, a report button on everything, takedown that also warns people who installed it, a visible history of who changed what.
6. **Agents treat shared text as untrusted.** An installed skill or agent is the person's own copy, but anything it fetches stays "data, not instructions", as now.
7. **Privacy.** Publishing is explicit and per repo. Export and delete include a person's repos, stars and comments (deleting an account removes their repos and replaces their comments with "deleted").

## How it maps to what exists

- Agents: `agents` collection and the agent editor → "Publish" button and a repo view.
- Skills: `skills/<name>/SKILL.md` and its test → the publish scan reuses that check.
- Workflows: the graph JSON → strip connections and secrets, list required apps.
- MCP: the shelf and per-tool approval → recipes only point to a server; approval stays with the installer.
- Account export and deletion: already covers each collection; add the hub's.
- Cost: Firestore documents and one search index; images and binaries are not stored in the first slices.

## Build order (each slice can be tried alone)

| Slice | What you can do after it |
| --- | --- |
| 9.1 Share by link | Publish an agent or skill as unlisted; send the link; the other person previews it and installs a copy. No browsing yet. |
| 9.2 Hub, profiles, stars | Public listing, search, tags, profiles, stars, "works with" filters, the publish scan, reports. |
| 9.3 Forks and versions | Fork with lineage, numbered versions, update prompts with permission changes. |
| 9.4 Questions, discussions and pull requests | Ask and answer questions (with accepted answers and search), per-repo discussion, issues, and suggested changes with a readable diff. |
| 9.5 Workflows and packs | Share workflows and bundles; "try it" on sample input. |
| 9.6 Teams | Private repos and teams inside a company or school. |
| 9.7 Paying makers | Paystack listings, tips and bounties. |

## Not first

- Real git hosting. A repo here is versioned documents with export to a folder (and, later, sync with a GitHub repo). It is cheaper, safer to scan, and enough for fork, diff and history.
- Executable plugins or arbitrary code from strangers.
- A feed algorithm, reputation points or leaderboards, before there is anyone to rank.
- Model or dataset hosting (Hugging Face's core). OpenLobs shares ways of working, not weights.

## Decisions (26 Oct 2026)

1. **Open to read, sign in to post.** Anyone can read The Reef without an account. Posting, asking, answering, publishing and starring need a signed-in account. A short list of makers Richie knows gets a **verified** badge, handed out by hand.
2. **Free only, and open source.** No paid listings until slice 9.7. OpenLobs itself is open source (MIT today); the contributing guide is in the repository.
3. **Licences on repos: the maker chooses** from a short list: open (MIT), open with credit (CC BY 4.0), or all rights reserved. The default is open with credit, shown clearly before publishing.
4. **Name: The Reef.**
5. **Moderation: Richie, with a small review queue page.** The publish scan catches the obvious problems first (secrets, hidden text, look-alike links) so the queue stays short. More moderators can be added from the verified makers.
6. **Seed content: the Ghana small-business skills, as the first official repos.** Richie's note: the skill set is not yet strong enough and the most important ones are missing. A separate pass will find and write the skills that matter most before launch (see "Skill hunt" below). The seed does not go public until that is done.

## Skill hunt (before The Reef opens)

The 18 Ghana skills and the 7 general ones are a start, not a finished library. Before launch: list the jobs a small business in Ghana (and a student, a freelancer, a church or school office) does every week; check which ones have a skill; write the missing ones, each with a test that it never hard-codes a tax rate or deadline; and have real users try them. Contributors can help here with no code: this is the easiest first contribution.

## Open question for later
- How The Reef is moderated once it has more than a few hundred people. Not needed for 9.1 to 9.3.

## Sources
- [Hugging Face: Pull Requests and Discussions on the Hub](https://huggingface.co/blog/community-update)
- [Tom's Hardware: malicious skills on ClawHub](https://tomshardware.com/tech-industry/cyber-security/malicious-moltbot-skill-targets-crypto-users-on-clawhub)
- [Palo Alto Unit 42: OpenClaw AI supply-chain risk](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)

*Those sources were seen as search results only; their pages were not opened.*
