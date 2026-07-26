# Task 1 evidence - builtin curated agent fallback chains

## What was tested

- The five mirrored chains are keyed only by `explore`, `librarian`, `metis`, `momus`, and `oracle`.
- The test contains an independent literal transcription of every provider list, model, variant, and array position. It does not import `@oh-my-opencode/model-core`.
- Mutation proof: changing the non-head Explore Qwen entry while retaining the same chain length failed the literal table assertion; the mutation was reverted.

## What was observed

- `bun test packages/senpi-task/src/agents/builtin/fallback-chains.test.ts` completed with 5 pass and 0 fail.
- The Oracle head remains the hand-transcribed GPT-5.5 high entry required by the plan.

## Why it is enough

The complete independent value table fails on entry drift that length-only checks cannot detect, while keeping the package decoupled from model-core.

## What was omitted

Runtime registry resolution belongs to task 4 and is covered there.
