# QA Summary

## What Was Tested
- Failing-first regression: `PATH="$HOME/.bun/bin:$PATH" bun test packages/model-core` after adding only the `claude-sonnet-5` assertion.
- Real resolver surface before fix: `PATH="$HOME/.bun/bin:$PATH" bun .omo/evidence/20260704-fix-5788/resolve-sonnet-limit.mts`.
- Product fix verification: `PATH="$HOME/.bun/bin:$PATH" bun test packages/model-core`.
- Type verification: `PATH="$HOME/.bun/bin:$PATH" bun run typecheck`.
- Strict-rule and size checks: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts ...` and pure LOC measurement for the touched TypeScript files.

## What Was Observed
- `red-bun-test-packages-model-core.txt`: the new regression failed before product code changes with `Expected: 1000000` and `Received: 200000`.
- `before-resolver-output.txt`: `anthropic/claude-sonnet-5 actualLimit=200000`.
- `after-resolver-output.txt`: `anthropic/claude-sonnet-5 actualLimit=1000000`.
- `green-bun-test-packages-model-core.txt`: `284 pass`, `0 fail`, `exit_code=0`.
- `typecheck.txt`: full repo typecheck exited `0`.
- `no-excuse-rules.txt`: no violations in the three touched TypeScript files.
- `loc-check.txt`: touched files are 40, 131, and 7 pure LOC.

## Why It Is Enough
- The red regression proves the exact reported defect on this HEAD before the production edit.
- The one-line regex change is the same local gate exercised by both the regression and resolver-output script.
- The resolver-output script imports the workspace source and demonstrates the user-visible context-limit value changing from `200000` to `1000000` for the affected provider/model pair.
- `opencode-qa` was consulted: no OpenCode process, hook, server, TUI, installer, or DB surface is changed. A broader OpenCode harness run would not exercise additional behavior beyond this pure model-core resolver path.

## What Was Omitted
- No live Anthropic API call: the defect is in local context-limit resolution before any provider request.
- No OpenCode TUI/server QA: this change does not touch OpenCode hook/action/event/TUI surfaces.
- `script/agent/setup.sh` was run first as requested, but its build phase failed because strict Codex plugin materialization retried local `file` submodule transport for shared-skill upstreams. The failure was scoped to bootstrap/materialization and did not affect the model-core test/typecheck proof.
