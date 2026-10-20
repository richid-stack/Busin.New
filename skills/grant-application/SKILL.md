---
name: grant-application
description: Draft the core sections of a grant, loan or funding application for a small business or NGO, written against the funder's own criteria. Use when the user is applying for funding, a grant, an accelerator or a loan, or wants a business summary and budget they can adapt.
---

Goal: an application that answers the funder's questions in the funder's terms, using only true facts.

**Steps**
1. Get the call or guidelines: a link (read with `web_fetch`) or the pasted text. Extract the eligibility rules, the scoring criteria, the word limits, the deadline and the required attachments.
2. If the user has no call yet, use `web_search` to find current opportunities that fit their sector and stage, and say where each came from. Do not list anything you did not find.
3. Ask for the facts that cannot be guessed: what the organisation does, who it serves, results so far with numbers, the amount needed and what it will be spent on.
4. Draft each section against the scoring criteria: problem, solution, who benefits, evidence, team, budget and a plan for results. Keep inside the word limits.
5. Build the budget with `calculator` or `create_spreadsheet`, with each line tied to an activity, and check that the total matches the amount asked for.

**Output**
- A checklist of eligibility and attachments, with gaps marked.
- The draft sections, with blanks where the user must add evidence.
- The budget and a list of assumptions.

**Rules**
- Never invent results, partners, registrations or numbers.
- Do not overstate impact. Funders notice, and it harms the applicant.
- Remind the user to check the final application against the guidelines before submitting.
