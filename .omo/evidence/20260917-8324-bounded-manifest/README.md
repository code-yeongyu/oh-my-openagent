# Bounded installer manifest fixture — QA evidence

The existing test still reads the actual shipped `plugin/.mcp.json`, runs the real installer, and checks all five installed manifest/configuration assertions. The fixture uses the existing component-bin/Git Bash test helper plus an inert LSP runtime. No production change, timeout increase, or platform skip.

## Observed checks

- Target test: 1 passed, 5 assertions, 516.54 ms. An earlier local checkout-backed execution took 4872.51 ms. These individual observations do not establish Windows performance.
- Full `bun run typecheck`: passed.
- Repository isolated install verification: cached plugin 5.0.0-beta.68 present, plugin enabled, 9 component bins and agent TOMLs linked; real configuration unchanged.
- Real Codex app-server with local plugin and local mock model: turn completed, `sessionStart`, `userPromptSubmit`, and `stop` hooks observed; real configuration unchanged.
- Real tmux TUI: booted, rendered, survived the five-second smoke, at the trust prompt. This is startup coverage; app-server provides actual hook execution evidence.

The first compatibility invocation overlapped the isolated install rebuilding its generated skills directory and failed with an ENOENT for a skill data file. It is retained as a failed run. The final invocation is run only after all QA installers have finished to remove that execution interference.

## Source and limits

[Windows release job](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/35136328378/job/104929627029) timed out in this existing test at 30 seconds. The failure did not include internal stage timings. Bounding unrelated file copies removes checkout payload size from this test's workload, but Windows CI must validate the change; this is not a claim that all rotating failures in #8324 are fixed.

Raw local transcripts contain machine paths and are retained privately; `results.json` contains the sanitized outcomes.

## Final compatibility result

`bun run test:codex` exited 1. Both Vitest groups passed (97 and 671 tests), Bun passed 475 with one skip and no failures, and Node passed 497 with two failures. One startup migration test expected a cleanup notice but received none; the other failed when the sandbox denied creating the default data directory (EPERM). The earlier overlapping-build ENOENT did not recur. No matching-baseline claim is made for the two remaining Node failures.
