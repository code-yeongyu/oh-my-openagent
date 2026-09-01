You are orchestrating a TypeScript project with FOUR source files, each missing exported functions. The test suites already exist and currently FAIL.

Missing functions:
- src/math.ts:    multiply(a, b), power(a, n)
- src/strings.ts: reverse(s), countWords(s)
- src/arrays.ts:  last(xs), unique(xs)
- src/dates.ts:   daysInMonth(year, month)  — WARNING: this one has a leap-year trap; a naive implementation fails the tests.

Requirements:
1. Delegate EACH file's functions to a SEPARATE subagent via the task tool (category "quick"). 4 delegations. Do not write function bodies yourself.
2. After EACH subagent returns, verify by reading the file AND running the full `bun test` suite.
3. If any test fails, send the failing subagent back with the exact failure details; repeat until green.
4. Report: subagent session IDs, how many bounce-backs were needed, and the final test output.

Do not stop until `bun test` is fully green.
