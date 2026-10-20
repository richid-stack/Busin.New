---
name: import-costing
description: Estimate the landed cost of goods imported into Ghana, adding shipping, duty, taxes and clearing costs, and work out a selling price. Use when the user is buying stock from abroad, comparing suppliers, or asks what an import will really cost them.
---

Goal: the true cost per unit when the goods are in the shop, so the price covers it.

**Steps**
1. Ask for: the goods and their HS code if known, the supplier price and currency, quantity, weight or volume, shipping method and quote, and insurance.
2. Look up the current exchange rate and the current import duty and levies for that product with `web_search` and `web_fetch`, preferring the Ghana Revenue Authority customs pages and a bank or central bank rate. Note the date. Never use a duty or tax rate from memory.
3. Convert to GH₵ and add each cost with `calculator`: goods, freight, insurance, duty, other levies and taxes the sources list, clearing agent, port charges and local transport.
4. Divide by the number of units for the landed cost per unit, then work out the price needed for the margin the user wants (use the `pricing-and-margins` skill).
5. Show how sensitive the result is: what happens if the cedi weakens or freight rises.

**Output**
- **Landed cost per unit** and in total, in GH₵.
- A table of every cost with its source or "user supplied".
- The price for the target margin, and the sensitivity line.
- What to confirm with a clearing agent before paying.

**Rules**
- Classification and valuation decide the duty. Say that the figure is an estimate until a clearing agent confirms it.
- Show every assumption, especially the exchange rate and its date.
