---
name: write-tests
description: Write useful automated tests for code or a function, covering normal cases, edges, errors and the bug that was fixed. Use when the user asks for tests, test cases, unit tests, or more coverage for code they share.
---

Goal: tests that fail when the behaviour is wrong and pass when it is right, and that read like a description of the behaviour.

**Steps**
1. Read the code and state what it promises: inputs, outputs, side effects, errors. Ask which test framework and style the project already uses; match it. If unknown, choose the common one for the language and say so.
2. List the cases before writing code: the normal path, boundaries (zero, one, many, maximum, empty, null), invalid input, error handling, repeated or concurrent calls where relevant, and each branch of the logic. For a bug fix, a test that fails without the fix.
3. Write each test to check one behaviour, with a name that says what should happen ("returns an error when the amount is negative"). Arrange, act, assert, with clear data.
4. Test behaviour and results, not internal details that change with a refactor. Use fakes for the network, time and randomness so tests are fast and repeatable; do not call real services.
5. Check the tests are meaningful: would each fail if the code were broken in the way it is meant to guard against? Remove tests that assert nothing.

**Output**
- The test file, ready to paste, then a short list of the cases covered and the ones deliberately left out, with the reason.
- Say how to run it.

**Rules**
- You cannot run the tests here; say they are untested and what to expect.
- Do not change the code under test to make tests pass without saying so.
- No real secrets, personal data or production addresses in test data.
- Never invent behaviour the code does not have. If the intended behaviour is unclear, ask or state your assumption.
