# PR 7072 killed terminal reconciliation QA

## What was tested

- `bun test packages/senpi-task/src/lifecycle/reconcile.test.ts`
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bun run test:senpi`
- `node packages/omo-senpi/scripts/qa/task-e2e.mjs --self-test`
- Two isolated live runs of `TASK_E2E_OUT_DIR=<resolved evidence dir> SENPI_BIN=/opt/homebrew/bin/omo node packages/omo-senpi/scripts/qa/task-e2e.mjs` against omo 5.0.0-0.beta.21 (senpi 2026.8.26).

## What was observed

- Focused reconciliation suite: 36 pass, 0 fail. The new regression proves a killed terminal resident with a persisted child session is disposed, retains `killed: true`, and starts zero replacement children.
- Senpi TypeScript check: pass.
- Senpi package gate: 2307 pass, 1 Windows-only skip, 0 fail; evidence-resolver tests: 10 pass, 0 fail.
- Driver self-test: pass.
- Both live runs reported `realSenpiUntouched=true`, `no_leaked_pids=PASS`, and the directly relevant `resume_killed_not_revived=PASS`.
- Both full live verdicts remained FAIL on the same three resume race checks: `resume_revived_resident`, `resume_finished_steerable`, and `resume_ttl_not_revived`. Their stderr reported `Agent is already processing`; this is outside the killed-terminal branch changed here, but prevents treating the full live gate as green.

## Why this is enough for the review fix

The failing-first unit regression exercises the exact legacy transcript branch from the review and proves the new guard runs before reattachment. The live killed-task resume check independently confirms killed work is not revived in the real isolated harness. The full-driver failures are retained as a merge blocker rather than hidden.

## What was omitted

Raw live logs, sandbox paths/tokens, process IDs, and the concurrent real-home path were removed. The sanitized verdict preserves all check outcomes and isolation conclusions without committing local paths or secret-bearing transcripts.
