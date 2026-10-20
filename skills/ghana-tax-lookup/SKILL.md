---
name: ghana-tax-lookup
description: Work out VAT, levies, withholding or filing dates for a Ghanaian business by looking up the current official rules first. Use when the user asks what tax applies, how much VAT to add or remove, when a return is due, or what a rate currently is.
---

Goal: a correct answer based on today's official rules, not on memory, because rates and deadlines change.

**Steps**
1. Work out exactly what is being asked: which tax or levy, what kind of business, what kind of sale or payment, and what period.
2. Look the current rule up with `web_search`, preferring the Ghana Revenue Authority (gra.gov.gh) and the Ministry of Finance. Read the page with `web_fetch` before quoting anything. Note the date of the page or notice.
3. If sources disagree or the rule changed recently, say so and show both.
4. Do the arithmetic with `calculator`. For VAT-inclusive prices, show how you separated the tax from the price. For a VAT-exclusive price, show the tax and the total.
5. Give dates as calendar dates and say which period they relate to.

**Output**
- **Answer** in one or two sentences with the figure or date.
- **How it was worked out**, with the numbers.
- **Source**: the page and its date.
- **Check with**: when a registered accountant or the GRA should confirm, for example thresholds, exemptions, flat-rate schemes or anything involving penalties.

**Rules**
- Never state a rate, threshold or deadline you did not read in a source during this conversation.
- If you cannot find an official source, say so and do not give a figure.
- This is information, not tax advice. Be plain about that without lecturing.
