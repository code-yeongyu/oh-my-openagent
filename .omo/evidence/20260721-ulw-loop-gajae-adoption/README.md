# ulw-loop gajae adoption evidence

## What was tested
This directory records evidence for the approved ulw-loop gajae-adoption plan:
1. checkpoint auto-advance,
2. atomic `steer --proposals-json`,
3. validation-batch schema,
4. validation-batch checkpoint/steering enforcement,
5. docs/help sync,
6. full gates and built-CLI QA,
7. final verification wave F1-F4.

## What was observed so far
- Todos 1-5 were already completed by prior commits and have evidence files `task-1.md` through `task-5.md`.
- Todo 6 was resumed from durable state, the leftover uncommitted diff was inspected and salvaged, two real bugs were found by focused QA and fixed with TDD, and the full built CLI lifecycle passed in an isolated temp git repo.
- The real `~/.codex/config.toml` SHA-256 was unchanged by the built-CLI QA.
- Temporary QA repos were removed; cleanup receipts are in `task-6.md` and `task-6-e2e-transcript.txt`.

## Why it is enough
The artifacts cover the unit/component gates, the repo Codex gate, and real local-build CLI behavior for all three adopted features, plus fail-closed validation-batch behavior and isolation/cleanup requirements.

## What was omitted
No PR was opened/pushed/merged. No published package was used. No real Codex plugin cache was used. Live app-server/TUI Codex QA was omitted because the approved todo-6 QA surface is the component's built CLI in an isolated temp git repo.

## Artifact index
- `task-1.md`
- `task-2.md`
- `task-3.md`
- `task-4.md`
- `task-5.md`
- `task-6.md`
- `task-6-component-gate.txt`
- `task-6-codex-gate.txt`
- `task-6-e2e-transcript.txt`
- `uncommitted-diff-salvage.md`
- `f1.md`
- `f2.md`
- `f3.md`
- `f4.md`
