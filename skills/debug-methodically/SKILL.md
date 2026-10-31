---
name: debug-methodically
description: Find the cause of a bug or error by narrowing it down step by step instead of guessing. Use when the user shares an error message, a failing test, or says something does not work and asks why or how to fix it.
---

Goal: the real cause, shown by evidence, and a fix that does not break something else.

**Steps**
1. Get the facts: the exact error message and stack trace, what was expected and what happened, what changed recently, how to reproduce it, the versions and environment. Ask for the missing ones that matter; a pasted error beats a description.
2. Read the error from the top: which line and which kind of failure. Say in plain words what the message means.
3. Write two or three hypotheses, most likely first, each with how you would confirm or rule it out (a log line, a test, a quick check). Prefer cheap checks that split the problem in half.
4. Ask the user to run the check and report back, or reason through the code if it is given. Do one change at a time and observe, never several together.
5. When the cause is found, state it: what is wrong, why it produces this symptom, and why it did not show earlier.
6. Propose the smallest fix, then check it for side effects, other places with the same mistake, and the test that would have caught it. Offer the test.

**Output**
- **What the error means**, **Most likely causes** (ranked, with the check for each), then once found **Cause**, **Fix**, and **How to prevent it**.

**Rules**
- Do not claim to know the cause before the evidence supports it; say "most likely" and what would confirm it.
- Do not tell the user to disable a security check, delete data or run an unknown command from the internet as a fix. Warn about anything destructive before they run it.
- If a fix needs a secret or key, tell them to keep it out of code and chat.
- Do not invent error output, file names or behaviour you have not been shown.
