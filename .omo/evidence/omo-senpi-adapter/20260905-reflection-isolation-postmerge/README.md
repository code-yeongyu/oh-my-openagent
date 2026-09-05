# Post-merge Reflection Isolation QA

## What Was Tested

- `bun run test:senpi` after merging `origin/dev` into the task branch.
- `bun packages/omo-senpi/scripts/qa/memory-reflection-isolation-e2e.mjs --self-test`.
- `bun packages/omo-senpi/scripts/qa/memory-reflection-isolation-e2e.mjs --evidence-slug 20260905-reflection-isolation-postmerge`.
- The live driver launched the worktree-local real Senpi CLI through a PTY, explicitly loaded the rebuilt local extension, and used a localhost scripted model.

## What Was Observed

- The Senpi gate completed with 2,683 passes, 32 capability skips, and zero failures.
- The live driver returned `PASS` with 25 successful checks and no errors.
- Reflection `reflection-run-1` merged in 1,309 ms.
- The child argv contained the isolated system prompt, `bash,edit`, disabled extension/skill/template/context discovery, a run-local session directory, the quick model, and the run-local task payload. It contained no `--fork`.
- The parent-only marker was sent to the parent but absent from both child requests. No `ModelUsabilityBudgetError` appeared.
- Three consumed historical failures produced no health entry in a fresh session. One newly pending failure produced exactly one `senpi-memory.health` entry while identity status remained available.
- The protected real Senpi state was complete and unchanged. Concurrent real-memory writes belonged to the active primary session, not the QA sandbox. No QA-attributed or unclassified real-memory path changed.
- Every owned process exited, no survivor remained, and the sandbox was removed.

## Why It Is Enough

The unit gate verifies the full Senpi adapter after integration with the latest `dev`. The live lane exercises the actual PTY/TUI, detached child process, HTTP model boundary, durable completion files, health delivery, identity status, protected-state observation, and cleanup. Together they cover the changed launch and alert paths through their real user-facing surface.

## What Was Omitted

- No external provider or real credential was used; the model endpoint was localhost and deterministic.
- Raw environment dumps, auth material, and secrets were not captured.
- Concurrent memory changes from the active primary session are listed in `result.json` but are not copied into this evidence directory.
