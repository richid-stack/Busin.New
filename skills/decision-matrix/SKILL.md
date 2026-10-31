---
name: decision-matrix
description: Help choose between options with criteria, weights and honest trade-offs, and give a recommendation. Use when the user is deciding between options (tools, suppliers, jobs, plans, places) or asks which to pick and why.
---

Goal: a decision the user can explain, with the trade-offs in plain view, not a hidden score.

**Steps**
1. Find out the decision, the real options (include "do nothing" if it is a real choice), the deadline, and what matters most to the user. Ask at most three questions.
2. Agree the criteria: 4 to 7 things that actually decide it (cost, risk, time, quality, fit, reversibility). Ask the user to rank them or give weights that add up to 100. If they prefer, propose weights and say why.
3. Gather facts for each option. For things that change (prices, features, availability) use `web_search` and `web_fetch` and cite the source. Mark any score that is a judgement rather than a fact.
4. Score each option on each criterion from 1 to 5 with a short reason. Compute the weighted totals with `calculator`.
5. Test the result: would a different weight flip the winner? Which single criterion does the win depend on? Say so.
6. Give a recommendation in plain words, and what would change it.

**Output**
- A table: options in columns, criteria and weights in rows, scores, and the totals.
- **Recommendation** in 2 or 3 sentences, **Why it is not obvious** (the closest competitor and its strongest point), **What would change my mind**.

**Rules**
- Do not fake precision. Close totals mean it is close: say that and use the tie-breaker the user cares about.
- Never invent a fact to score an option. If you could not find it, say so and score it neutral, flagged.
- The decision is the user's. Make your recommendation clear but leave the choice with them.
