# Live Senpi driver proof for the DAG dependency-frontier PR

Slug resolved with the sanctioned script (`.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs --repo-root <worktree> --slug 20260825-dag-dep-frontier`).

## WHAT WAS TESTED

`packages/omo-senpi/scripts/qa/drive.mjs` (plus `--self-test`) from the branch worktree
after the tracked `omo-task.js` extension bundle was regenerated for the scheduler change:
a REAL `senpi` session loading the plugin, in the driver's own isolated sandbox.

## WHAT WAS OBSERVED

`drive-self-test.txt`: `SELF-TEST OK`.
`drive-live.txt`:

```json
{"result":"PASS","ultraworkInjected":true,"commentChecker":"PASS","realSenpiUntouched":true,"providedSenpiCodingAgentDir":"IGNORED","sandboxAgentDir":".../omo-senpi-qa-GAEzts/agent","sandboxCwd":".../omo-senpi-qa-GAEzts/project"}
```

- `realSenpiUntouched: true` - the real `~/.senpi/agent` was not written.
- The driver-ignored caller-provided `SENPI_CODING_AGENT_DIR` behaved as designed.
- Cleanup: the task-owned sandbox `omo-senpi-qa-GAEzts` was deleted after the run; the
  driver had already exited (result printed), so no child PID of this QA run remains. The
  long-lived `senpi` processes on this host belong to the user's global omo-ai install
  (`~/.bun/install/global/...`), not this QA.

## WHY IT IS ENOUGH

The regenerated bundle is the shipped surface for the scheduler change; a real senpi process
loading it end-to-end proves the bundle is loadable and the adapter still functions on the
live harness. Admission semantics themselves are engine-level and are proven by the
failing-first regression in `../../20260825-dag-dep-frontier/` (the senpi-qa router maps
"DAG state machine / runners" to the package suite; no dedicated live DAG-admission driver
exists).

## WHAT WAS OMITTED

- `task-e2e.mjs` / `team-e2e.mjs` were not run: they exercise the task/team engine, which
  this PR does not modify (the DAG drives it through the unchanged `startOwned` contract,
  covered by `bun test packages/senpi-task` and the consumer gate).
- No secrets, tokens, or credentials appear in the captured JSON.
