Project: modules src/a01.ts through src/aNN.ts (N varies), each exporting `export const V: number = <n>`.
Values are RANDOM; file names carry NO information about the values, and several files share the same value.

Implement src/sum.ts with:
- `total: number` — the sum of V across ALL files
- `modalCount: number` — how many files contain the MOST FREQUENT value

Requirements:
1. Read EVERY file yourself. Never guess a value from a file name.
2. Run `bun test` and confirm green.
3. Report the total you computed.
