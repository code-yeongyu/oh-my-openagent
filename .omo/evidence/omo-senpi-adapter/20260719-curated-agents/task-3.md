# Task 3 evidence - in-process option assembly and curated override

## What was tested

- A captured `CreateAgentSessionOptions` proves `options.tools` receives the child's allowlist while shared LSP definitions remain in `options.customTools`.
- A curated child receives exactly one custom tool named `bash`, and it is the restricted read-only broker.
- A non-curated child receives no injected bash override.
- The real `mergeChildCustomTools` path remains active in every test.

## What was observed

- `bun test packages/senpi-task/src/runners/in-process.test.ts` completed with 14 pass and 0 fail.
- Mutation proof from the original task: removing the `toolAllowlist` option spread failed the new seam assertion while the remaining runner cases stayed green.

## Why it is enough

The tests cover both independent Senpi option channels and the exact point where the curated broker replaces the unsafe builtin without changing non-curated execution.

## What was omitted

Installed-runtime activation is covered by the task 9 live child, including successful LSP invocation and rejected mutation calls.
