---
name: build-spreadsheet-model
description: Build a working spreadsheet with inputs, live formulas and checks, such as a budget, forecast, tracker, loan or pricing model. Use when the user asks for a spreadsheet, model, calculator, budget, schedule or tracker they will keep using.
---

Goal: a workbook that still works when the user changes a number, and that shows its own working.

**Steps**
1. Clarify what the user will do with it and who else will read it. Ask for the inputs and the time span (monthly for a year, say) if they are not given. Decide the units and currency and state them.
2. Plan the sheets before building: an inputs sheet (every assumption in one place, labelled, with units), a calculation sheet or area, and a summary or dashboard with the few numbers that matter and a chart. Tell the user the plan in a few lines.
3. Build it with `create_spreadsheet`. Every calculated cell is a formula that points at the inputs; no typed-in numbers inside formulas, no copied values. Use clear headers, consistent formats (dates, currency, percent) and frozen header rows.
4. Add checks: totals that must match, balances that must be zero, a visible "OK" or "Check" cell. A model with no checks is not finished.
5. Test it before you hand it over: with a simple input where you know the answer, compare with `calculator`. Say what you tested.
6. Add a short notes area: what it does, how to change it, and what is assumed.

**Output**
- The workbook, then a short summary: what each sheet is for, the main assumptions, and the result at the current inputs.

**Rules**
- Do not hide assumptions. Put real, sourced numbers in inputs; mark any placeholders clearly. Look up rates and prices with `web_search` and cite them; do not recall them from memory.
- Keep formulas simple enough for the user to follow.
- Never overwrite the user's own file; save a new one.
- Never invent figures. Use the user's numbers or sourced ones, and mark every placeholder.
