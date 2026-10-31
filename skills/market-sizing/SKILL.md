---
name: market-sizing
description: Estimate how big a market is (total, reachable and realistic share) using cited data and clear assumptions. Use when the user asks about market size, demand, TAM, how many customers there could be, or whether an idea is big enough.
---

Goal: a defensible estimate where every number has a source or a stated assumption the user can change.

**Steps**
1. Pin down the product, the customer, the place and the year. Ask for what is missing in one message. "Everyone in Africa" is not a customer; narrow it.
2. Size it two ways and compare. Top-down: start from a published market or population figure and narrow by place, segment and need. Bottom-up: number of likely customers times how often they buy times the price they would pay.
3. Find the inputs with `web_search` and `web_fetch`: population, number of businesses, spending, adoption rates, competitor prices. Prefer official statistics and company filings. Cite every number with its year.
4. Do the sums with `calculator` and show each step. Put the assumptions in a short list, each with a low, likely and high value.
5. Compare the two methods. If they differ by more than about 3 times, find out why before presenting either.
6. Give three numbers: the whole market, the part the user can reach with their model, and what share is realistic in the first one to three years, with the reason.

**Output**
- A small table of the steps and numbers, then the three results in plain words, the main assumptions, and what would most change the answer.
- If a spreadsheet is useful, build it with `create_spreadsheet` so the user can change the assumptions.

**Rules**
- Never present a guess as a measured figure. Label estimates.
- Do not use a market-research headline ("a 50 billion market") without saying who is counted.
- Convert currencies and years consistently, and state the rate and date used.
- Do not invent statistics, sources or years. If a figure cannot be found, say so and show the assumption you used instead.
