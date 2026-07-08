# Todo 5 Agent Loader Repair Evidence

## What Was Tested
- `bun test packages/senpi-task/src/agents`: focused loader regressions for symlinked scan roots, recursive symlink entries, config read failures, existing override/tool semantics.
- `bun test packages/senpi-task --bail`: full `senpi-task` package suite.
- `bun run typecheck`: root TypeScript gate including `packages/senpi-task/tsconfig.json`.
- `bun run packages/senpi-task/scripts/manual-agents-qa.ts .omo/evidence/senpi-task/task-5-agents`: real loader fixture exercise.
- `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts ...`: no-excuse TypeScript checker on touched files.
- Static guard scan: no `omo-opencode`, `.claude`, or opencode agent-path coupling in agent-loader files.

## What Was Observed
- RED captured the original blockers: symlinked external `linked.md` loaded, broken symlink produced no diagnostic, and directory `.omo/omo.json` threw `EISDIR`.
- GREEN focused suite: 10 pass, 0 fail.
- Full package suite: 39 pass, 0 fail.
- Typecheck exited 0.
- Manual QA loaded only `finder`; `omo.json` override won; malformed frontmatter emitted a diagnostic; symlinked external agent did not load; symlink/config read diagnostics were returned; fixture cleanup removed the temp root.
- Evidence zero-byte check passed.

## Why It Is Enough
- The original security blocker is covered by a unit regression and manual filesystem fixture proving symlinked scan roots are refused.
- Recursive symlink and config read failures are covered by tests and manual QA while valid sibling agents continue loading.
- Existing tool rule behavior and `executionMode` normalization tests remain green; no new imports couple `senpi-task` to OpenCode or `.claude` agent paths.

## Adversarial Classes
- malformed_input: malformed frontmatter and unreadable config/path return diagnostics while valid agents load.
- stale_state: symlinked external/out-of-root agent is not loaded.
- dirty_worktree: cleanup receipt records intended touched files before commit; post-commit status was checked separately.
- misleading_success_output: raw non-empty artifacts are recorded and zero-byte check passed.
- flaky_tests: fixtures use directory-as-file `EISDIR` and symlink checks, not chmod-only permission assumptions.
- hung_or_long_commands: all commands were bounded one-shot Bun/git/rg invocations; no long-lived process used.
- prompt_injection: not applicable; loader consumes local structured files, not model-authored commands.
- cancel_resume: not applicable; no resumable external process or queue was used.
- repeated_interruptions: not applicable; single local worktree repair with deterministic commands.

## Artifact Index
- `repair1-red.txt`
- `repair1-green-focused-agents-tests.txt`
- `repair1-full-package-tests.txt`
- `repair1-typecheck.txt`
- `repair1-manual-agents-qa.txt`
- `repair1-no-excuse-rules.txt`
- `repair1-loc-pure-count.txt`
- `repair1-static-guards.txt`
- `repair1-cleanup-and-status.txt`
