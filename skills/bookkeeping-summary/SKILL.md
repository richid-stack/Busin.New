---
name: bookkeeping-summary
description: Sort a pasted list of transactions, a mobile money statement or a spreadsheet into categories and produce a clear monthly income and expense summary for a small business. Use when the user shares sales or expense records, asks where their money went, or wants simple books or a profit figure.
---

Goal: a monthly picture the owner can understand, with every number traceable to the records.

**Steps**
1. Read what the user gave you. If it is a connected Google Sheet, read it with `integration_execute`. Ask which month and whether personal spending is mixed in.
2. Agree categories with the user in one line, or propose sensible ones: sales, cost of goods, transport, rent, utilities, salaries, airtime and data, marketing, fees and charges, owner's drawings, other.
3. Categorise each line. Flag the ones you are unsure of in a short list instead of guessing quietly.
4. Add up with `calculator`, or build a spreadsheet with `create_spreadsheet` that uses formulas so the owner can audit it.
5. Separate money in from profit: stock bought but not sold, loans received and owner's drawings are not income or expense in the same way.

**Output**
- **Month at a glance**: total in, total out, profit or loss, in GH₵.
- A table by category, biggest first.
- **Questions**: unclear lines and anything that looks like a duplicate.
- Optional: a small `chart` of spending by category.

**Rules**
- Never invent a transaction or round the numbers to look tidier.
- Mobile money fees and levies are real costs: show them as their own line.
- Say when the records look incomplete.
