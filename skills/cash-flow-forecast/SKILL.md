---
name: cash-flow-forecast
description: Build a simple 13-week cash flow forecast for a small business from its current cash, expected receipts and known bills, and show when it might run short. Use when the user asks whether they can afford something, how long their money will last, or wants to plan cash for the coming months.
---

Goal: show week by week whether there will be enough cash, and what to do if there is not.

**Steps**
1. Ask for the opening cash (bank plus mobile money plus cash in hand), expected money in by week (with how sure each is), and bills by week: rent, salaries, suppliers, loan repayments and taxes.
2. For taxes and levies due in the period, look up current dates with the `ghana-tax-lookup` skill rather than guessing.
3. Build the forecast with `create_spreadsheet` using formulas: opening balance, receipts, payments, closing balance for each of 13 weeks. Use `calculator` to check the first and last week.
4. Run a cautious case where late payers pay a few weeks late and a fifth less comes in, and show the lowest closing balance in each case.
5. Suggest actions for the weeks that go negative: chase specific invoices, delay a purchase, split a payment.

**Output**
- The lowest balance and the week it happens, in the base and cautious cases.
- A short list of actions ranked by how much they help.
- The spreadsheet, with the assumptions written beside it.

**Rules**
- Mark every figure as the user's or as an assumption.
- Do not promise outcomes. It is a plan based on what was provided.
