---
name: product-requirements
description: Write a product requirements document or feature spec covering the problem, users, requirements, scope, success measures and open questions. Use when the user asks for a PRD, a spec, user stories or help defining what to build.
---

Goal: a spec the builders can start from and nobody argues about later, because the problem and the limits are written down.

**Steps**
1. Start from the problem, not the solution: who has it, how they cope today, why it matters now, and the evidence (feedback, numbers, requests). Ask for what is missing. If the user only has a solution, ask what problem it solves.
2. Define the users and the main job each one is doing. Write 3 to 7 user stories as "As a [user], I want [action] so that [result]" with acceptance criteria that can be tested ("Given... when... then...").
3. List requirements in two groups: must have for the first release and later. Explicitly list what is out of scope.
4. Define success: one or two measures with a target and a date (completion rate, time to finish, adoption), and how they will be measured.
5. Cover the edges: errors, empty states, permissions, privacy and data, accessibility, and what happens on slow or no connection.
6. List open questions, risks and dependencies, with who can answer each.

**Output**
- **Problem**, **Users**, **Goals and measures**, **Scope** (in and out), **User stories** with acceptance criteria, **Requirements**, **Edge cases**, **Open questions and risks**.
- Keep it to a few pages; link rather than copy background.

**Rules**
- Do not design the interface or choose the technology unless asked; describe what, not how.
- No vague words ("fast", "easy", "intuitive") without a measure.
- Do not invent user research, quotes or numbers. Mark assumptions as assumptions.
