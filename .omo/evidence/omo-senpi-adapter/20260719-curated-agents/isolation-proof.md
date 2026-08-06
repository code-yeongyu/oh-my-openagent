# Curated-agent live E2E: isolation proof

## Curated scenario

- Isolated agent dir: `/Users/yeongyu/local-workspaces/omo/.local-ignore/worktrees/omo-senpi-curated-agents/.omo/tmp/omo-senpi-qa-tS82Sq/agent`.
- Isolated project: `/Users/yeongyu/local-workspaces/omo/.local-ignore/worktrees/omo-senpi-curated-agents/.omo/tmp/omo-senpi-qa-tS82Sq/project`.
- Isolated task state: `/Users/yeongyu/local-workspaces/omo/.local-ignore/worktrees/omo-senpi-curated-agents/.omo/tmp/omo-senpi-qa-tS82Sq/project/.omo/senpi-task`.
- The caller-provided `SENPI_CODING_AGENT_DIR` was unset; the driver supplied its newly created sandbox to the child.
- `realSenpiChangedPaths` is empty. One concurrent session JSONL changed during the snapshot and remains listed separately in `curated-agents-e2e.json`; it does not carry the sandbox token.

## Baseline scenarios

- Isolated tokens: `omo-senpi-qa-lPaFsI`, `omo-senpi-qa-ep2Knn`, `omo-senpi-qa-PHyjZq`, and `omo-senpi-qa-dgha8b`.
- Their agent/project directories are all under this worktree's `.omo/tmp` and are recorded in `baseline-task-e2e.json`.
- `realSenpiChangedPaths` is empty and `no_leaked_pids` is PASS.
- One concurrent Senpi session JSONL changed during the baseline snapshot; it remains under `concurrentRealSenpiChangedPaths` and does not carry any baseline sandbox token.

The whole real-agent-dir digest is marked changed because of those concurrent sessions. Causal isolation is stricter: any non-session path or session path carrying the active sandbox token is QA-attributed and would fail the driver. The evidence contains no credentials, auth headers, environment dumps, or raw transcript bodies.
