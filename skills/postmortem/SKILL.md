---
name: postmortem
description: Write a blameless review of something that went wrong or right (an outage, missed deadline, failed launch or lost client) with timeline, causes and fixes. Use when the user wants a postmortem, retrospective, lessons learned or incident report.
---

Goal: the team learns what to change, without finding someone to blame.

**Steps**
1. Collect what happened: the event, the times, what people saw and did, the impact (who, how long, how much), and how it was fixed. Ask for logs, messages or notes; do not fill gaps with guesses.
2. Build a timeline of facts in time order, each with its source. Mark gaps as unknown.
3. Describe the impact in numbers where they exist: customers affected, time down, money lost, hours spent.
4. Find causes by asking why repeatedly, until you reach things the team can change (a missing check, an unclear handover, a tool that fails silently). Separate the trigger (what set it off) from the contributing causes (why it was possible and why it was not caught sooner). People's actions are explained by the situation they were in, not their character.
5. Write what went well, what went badly and where luck helped.
6. Turn lessons into action items: specific, with an owner and a date, the kind that will actually be done. Prefer a few that remove the cause over many reminders to be careful.

**Output**
- **Summary** (3 sentences), **Impact**, **Timeline**, **Causes**, **What went well**, **What went badly**, **Actions** (owner, date), and **Open questions**.

**Rules**
- No names as causes. Use roles ("the on-call engineer") and describe decisions in context.
- Facts and opinions are labelled separately. Never invent times or numbers.
- If the facts are not enough for a conclusion, say what to find out.
