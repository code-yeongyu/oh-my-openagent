# PR 5931 P1 follow-up: callable planner delegation

## What was tested

Changed the OpenCode ultrawork prompt variants to avoid direct
`task(subagent_type="prometheus", ...)` planner delegation. Prometheus is a
coordinator/primary agent and is rejected by the task validator. The prompts now
route planning through `task(category="ultrabrain", ...)`, which is the
task-callable category path, and the prompt export test now rejects both
`subagent_type="plan"` and `subagent_type="prometheus"` in non-planner OpenCode
ultrawork variants.

Captured commands:

- `rg -n 'subagent_type="prometheus"|subagent_type="plan"|Prometheus planner|MUST call Prometheus' packages/prompts-core/prompts/ultrawork -g '!planner.md'`
- `bun test packages/prompts-core/src/ultrawork-prompts.test.ts`
- `bun test packages/prompts-core/src/ultrawork-prompts.test.ts packages/omo-opencode/src/hooks/keyword-detector/ultrawork/ultrawork-source-routing.test.ts`
- `bun test packages/omo-opencode/src/hooks/keyword-detector`
- `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/prompts-core/src/ultrawork-prompts.test.ts`
- `bun run typecheck`
- `git diff --check && git diff --stat`
- `.agents/skills/opencode-qa/scripts/lib/common.sh --self-check`

## What was observed

- `stale-delegation-search.exit`: `0`; no stale non-callable planner strings
  found outside `planner.md`.
- `ultrawork-prompts-test.exit`: `0`; 2 tests passed.
- `prompt-source-routing-test.exit`: `0`; 3 tests passed.
- `keyword-detector-test.exit`: `0`; 89 tests passed.
- `typescript-no-excuse.exit`: `0`; no violations in the changed TypeScript
  test file.
- `typecheck.exit`: `0`; repository typecheck passed.
- `git-diff-check.exit`: `0`; whitespace check passed.
- `opencode-common-self-check.exit`: `1`; live OpenCode QA harness is blocked
  on this Windows host because `jq` and `tmux` are missing, and the helper's
  Python free-port probe failed.

## Why it is enough

The failing reviewer case was a prompt/runtime-contract mismatch: non-planner
ultrawork prompts named a coordinator agent in `task(subagent_type=...)`. The
focused search and regression test prove the non-planner prompt variants no
longer contain either native Plan-mode delegation or direct Prometheus
delegation. The keyword-detector suite proves the prompt variants still load and
inject through the OpenCode keyword path, and typecheck covers package exports.

## What was omitted

Full live OpenCode smoke/SSE/TUI QA was not run because the required local QA
harness dependencies are absent on this host: `jq` and `tmux` are not on PATH,
Docker is not on PATH, and the shared helper reports a Windows Python
free-port-probe failure. No secrets, tokens, auth headers, or private env dumps
were copied into this evidence directory.

## P2 follow-up: stale planner label

After the first P1 fix, Codex review found that `default.md` still said
`PROMETHEUS PLANNER SPAWN` in the final checklist, and `gemini.md` had the same
stale label. The follow-up adds a regression assertion rejecting
`PROMETHEUS PLANNER` in all non-planner variants and changes both checklist
labels to `CALLABLE PLANNING DELEGATION`.

Additional captured commands:

- RED: `bun test packages/prompts-core/src/ultrawork-prompts.test.ts`
- GREEN: `bun test packages/prompts-core/src/ultrawork-prompts.test.ts`
- GREEN routing: `bun test packages/prompts-core/src/ultrawork-prompts.test.ts packages/omo-opencode/src/hooks/keyword-detector/ultrawork/ultrawork-source-routing.test.ts`
- Prompt-only stale scan: `rg -n 'PROMETHEUS PLANNER|subagent_type="prometheus"|subagent_type="plan"' packages/prompts-core/prompts/ultrawork/default.md packages/prompts-core/prompts/ultrawork/gemini.md packages/prompts-core/prompts/ultrawork/gpt.md packages/prompts-core/prompts/ultrawork/glm.md`
- `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/prompts-core/src/ultrawork-prompts.test.ts`
- `bun run typecheck`
- `git diff --check`
