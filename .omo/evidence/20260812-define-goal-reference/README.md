# 20260812-define-goal-reference

Change: rewrite the upstream openai/skills `define-goal` skill into a detailed, prompt-engineering-grounded goal-definition reference shipped ONLY as `references/define-goal.md` under each ulw-loop skill, and wire every ulw-loop goal-creation surface (omo-senpi, omo-codex, omo-opencode) to create the goal through it.

## What was tested

1. `bun test tests/ulw-loop-define-goal-reference.test.ts`: the new cross-package invariant. Asserts `references/define-goal.md` exists beside both tracked ulw-loop SKILL.md files, that each SKILL.md and full-workflow.md routes goal creation through it, and that the senpi and codex copies are byte-identical (single `toBe` equality between the two shipped artifacts).
2. `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` and `node packages/omo-codex/plugin/scripts/sync-skills.mjs`: the real distribution pipelines that ship skills to installed harnesses.
3. `bun test packages/prompts-core`: the loader suite over the 5 edited ultrawork prompt variants (opencode's ulw goal-creation surface; `codex.md` is also the Light-edition directive via the secondary export path).
4. `bun run test:codex` and `bun run test:senpi`: the hermetic harness gates (`test-codex-gate.txt`, `test-senpi-gate.txt`).

## What was observed

- `red-test.txt`: 6 fail / 1 pass BEFORE the codex copy and wiring existed, each failing for the missing-artifact reason (not syntax/import errors).
- `green-test.txt`: 7 pass / 0 fail after authoring + wiring.
- `sync-skills-output.txt`: both generated plugin trees ship `plugin/skills/ulw-loop/references/define-goal.md`, and both generated SKILL.md copies carry the `define-goal.md` pointer (2 mentions each).
- `prompts-core-tests.txt`: 26 pass / 0 fail.
- Byte identity: md5 `9353d881e2424f01ab5507046ef8f76e` for both copies.
- Postinstall-rewritten generated bundles (`codegraph/dist/cli.js`, `codegraph/dist/serve.js`, `omo-senpi/plugin/extensions/omo-task.js`) were restored via `git restore` before staging, so no local-bun bundle drift ships.

## Why it is enough

No executable code path changed: the change set is skill/prompt content plus one new repo-level test. The content reaches each harness through existing, already-tested loaders (senpi/codex sync-skills pipelines, prompts-core bundled `.md` loader with its variant-routing suite). The generated-tree listings prove the exact files an installed harness reads; the byte-equality test prevents the two shipped copies from drifting; the harness gates prove no regression in the surrounding component suites. Hook wiring, installers, and runtime behavior are untouched, so live app-server/SSE hook drives would exercise unchanged code.

## What was omitted

- Raw `bun install` output and environment dumps (no secrets involved; only the tail is relevant and summarized above).
- Full gate logs are kept verbatim in this directory; nothing was redacted because these suites emit no credentials.
