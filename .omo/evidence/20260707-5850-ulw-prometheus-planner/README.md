# Evidence: issue 5850 ultrawork Prometheus planner delegation

## What Was Tested

- `focused-tests.txt`: focused regression coverage for OpenCode ultrawork prompt variants and ultrawork source routing.
- `keyword-detector-tests.txt`: surrounding keyword detector suite.
- `prompts-core-tests.txt`: prompts-core ultrawork export and variant resolver suite.
- `typecheck.txt`: workspace TypeScript typecheck.
- `diff-check.txt`: git whitespace/conflict marker check.
- `host-dependencies.txt`: local live-QA dependency probe.
- `opencode-qa-self-check.txt`: OpenCode QA harness self-check from `.agents/skills/opencode-qa/scripts/lib/common.sh --self-check`.

## What Was Observed

- Focused regression tests passed: 3 tests, 14 assertions, exit code 0.
- Keyword detector tests passed: 89 tests, 268 assertions, exit code 0.
- Prompts-core tests passed: 11 tests, 18 assertions, exit code 0.
- `bun run typecheck` passed with exit code 0.
- `git diff --check` passed with exit code 0.
- Host dependency probe found `opencode 1.17.13` and `sqlite3 3.45.3`, but `jq` and `tmux` are not installed.
- OpenCode QA self-check failed before live harness execution because `jq` and `tmux` are missing, and the Python free-port helper returned an empty result. The self-check still proved sandbox cleanup and HOME isolation paths.

## Regression Shape

The red tests were added before the fix:

- Prompt invariant: non-planner OpenCode ultrawork variants must not contain `subagent_type="plan"`.
- Routing baseline: native OpenCode agent name `plan` must route to the default ultrawork source, not the planner source.

Before the implementation, the prompt invariant caught existing `subagent_type="plan"` examples in the default, GPT, and Gemini variants, and the routing baseline received `planner` for bare `plan`. After the fix, the captured focused test output shows both regressions are green.

## Why This Is Enough

The bug was caused by prompt instructions and routing classification that sent OpenCode ultrawork planning through the native Plan agent. The focused tests lock the exact failure mode: prompt variants cannot reintroduce the native `plan` subagent call, while bare `plan` no longer receives planner-source routing. The wider keyword detector and prompts-core tests cover existing planner-agent behavior, native Plan-agent skip behavior, variant selection, and exported prompt contents. Typecheck and diff check cover repository static correctness and patch hygiene.

## What Was Omitted

Live OpenCode CLI/server/TUI/SSE QA was not run because the local host is missing required `jq` and `tmux` dependencies, and the QA harness self-check also reports a Python free-port helper failure. No secret-bearing logs, environment dumps, tokens, or auth headers were copied.
