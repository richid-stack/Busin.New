---
name: payroll-estimate
description: Estimate monthly take-home pay or the total cost of an employee in Ghana from a gross salary, using current PAYE bands and SSNIT rates that you look up. Use when the user asks what to pay someone, what an employee will take home, or what a staff member really costs.
---

Goal: a transparent estimate the owner can check with their accountant, built from current official rules.

**Steps**
1. Ask only for what is missing: gross monthly pay, allowances, whether the employee is resident, and whether any pay is a bonus or overtime.
2. Look up the current income tax (PAYE) bands and the current SSNIT employee and employer contribution rates with `web_search`, preferring the Ghana Revenue Authority and SSNIT. Read the page with `web_fetch` and note its date.
3. Calculate step by step with `calculator`: the SSNIT base, the employee deduction, the taxable income, the tax by band, and take-home pay. Then the employer's cost: gross plus the employer contribution.
4. Show a small table for each stage so the owner can follow it.

**Output**
- **Take-home** and **total cost to the business**, in GH₵ per month.
- The table of working.
- **Sources and dates** for every rate used.
- A short note on what is not covered, such as Tier 2 pension arrangements, loans or other deductions, unless the user gave them.

**Rules**
- Do not use a rate from memory. If the sources cannot be read, say so and stop.
- Do not give an annual figure by multiplying a month if bonuses or changing bands make that wrong.
- This is an estimate for planning, not a payslip. Say it once.
