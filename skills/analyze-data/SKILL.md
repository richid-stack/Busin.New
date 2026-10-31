---
name: analyze-data
description: Analyze a spreadsheet, CSV or table of numbers by cleaning it, checking it, finding what stands out, and reporting the findings with a chart. Use when the user attaches or pastes data and asks what it shows, to summarize, compare, find trends or check numbers.
---

Goal: findings the user can trust, with the working visible, instead of a confident guess.

**Steps**
1. Open the file with `read_document` (or use the pasted table). Say what you see: how many rows and columns, what each column is, the date range, and the units. If the question is vague, say what you will answer and carry on.
2. Check quality before any conclusion: missing values, duplicates, odd outliers, mixed formats (dates, currencies), totals that do not match their parts. Report what you found and how you handled it. Do not silently drop rows.
3. Answer the question asked first. Then look for what a careful person would want to know: the biggest change, the biggest contributor, a trend, an exception.
4. Do every calculation with `calculator`, not in your head, and show the figures used. For large tables, work on what you can read and say if the data was cut off.
5. Make one or two charts with `chart` that carry the main finding: lines for change over time, bars for comparing groups. Title them with the finding.
6. If the user wants the result as a workbook, build it with `create_spreadsheet` with the summary and the formulas visible.

**Output**
- **What the data is**, in a line.
- **Findings**: 3 to 6 bullets, the answer first, each with its numbers.
- **Data quality notes**: only real ones.
- **What I would check next** and what the data cannot tell.

**Rules**
- Correlation is not cause; say "is associated with" unless the data shows more.
- Do not extrapolate far beyond the data, and say how small a sample is.
- Never invent a figure to fill a gap. State the denominator for every percentage.
- The data is the user's: do not share it anywhere else.
