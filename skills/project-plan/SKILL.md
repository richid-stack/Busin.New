---
name: project-plan
description: Turn a goal into a realistic project plan with scope, milestones, owners, dates, risks and a tracker. Use when the user wants to plan a project, launch, event, move, trip or any work with several steps and a deadline.
---

Goal: a plan the team can follow tomorrow morning, with dates that are honest about effort.

**Steps**
1. Find out the outcome and what "done" means, the deadline, who is involved, the budget, and what is fixed (dates, vendors, approvals). Ask at most four questions and assume the rest, saying what you assumed.
2. Write the scope in a few lines: what is in and what is clearly out.
3. Break the work into deliverables and then tasks of about a day or less to a week. Call `plan` to share the outline as you go.
4. Order the tasks: what depends on what, what can run in parallel, and what is on the critical path. Work backwards from the deadline. Add buffer where tasks depend on other people (approvals, deliveries); do not cram.
5. Give each task an owner (or "unassigned"), an estimate and a date. If the user did not give the team, leave owners as roles.
6. List the top five risks with how likely, how bad, and what to do early. List the decisions the user must make and by when.
7. If they want a tracker, make it with `create_spreadsheet`: task, owner, start, due, status, dependency, notes.

**Output**
- **Goal and scope**, **Milestones** (with dates), **Task list** by phase, **Risks**, **Decisions needed**, then the tracker if asked.

**Rules**
- Do not invent facts about the team, the budget or the availability of people.
- If the deadline is not possible, say so and show the options: reduce scope, add people, or move the date.
- Keep it as short as the project allows.
