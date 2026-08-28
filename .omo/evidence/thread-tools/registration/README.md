# Thread registration evidence

Authoritative PASS artifacts:

- `qa-thread-tools-main.txt`: official thread-tools run-all, executed against a throwaway Senpi `origin/main` build at 498281a0d; all four scenarios passed.
- `qa-task-14-main.txt`: official task-14 run-all against the same throwaway build; all resilience scenarios passed.
- `real-surface-raw4.txt`: direct live host proof of six registered tools, one family guideline, create/send target transcript assertion, and typed not_found.
- `cleanup-receipt.txt`: throwaway host/worktree cleanup and ambient-process handling.

Earlier `qa-*.txt`/`*-rerun.txt` files were superseded: the first runs used stale Senpi dist or a removed checkout; `real-surface-raw.txt` and `raw2` failed during harness setup/scope selection, while `raw3` passed create/send but used the wrong transcript-length assertion. They are removed to avoid contradictory evidence.
