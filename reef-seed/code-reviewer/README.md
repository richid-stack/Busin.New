# Code Reviewer

Paste code, a diff or an error. It reads the whole piece, not just the changed lines, and tells you what matters most.

## Try asking

- "Review this pull request for bugs and security problems." (paste the diff)
- "My test fails with this error. What is going on?" (paste the error and the code)
- "Write tests for this function, including the edge cases."

## Inside

| Skill | What it does |
| --- | --- |
| code-review | Correctness, security, reliability, tests; must-fix, should-fix and nits |
| debug-methodically | Hypotheses and cheap checks to find the real cause, then the smallest fix |
| write-tests | Behaviour-focused tests in your framework and style |

## Needs

Searching the web to look up documentation. It cannot run your code or reach your repository.

## Good to know

It says what it could not check. Treat its findings as a careful second pair of eyes, not a replacement for running the tests.
