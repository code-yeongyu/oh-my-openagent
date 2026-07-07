# Task 27 - Live QA: rpc-process task e2e (`task-rpc-e2e.mjs`)

Refreshed after the STEP-1 product fixes landed. This directory records the live QA of process
execution mode for the omo senpi-task component.

## WHAT WAS TESTED

Driver: `packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs` (+ `-helpers.mjs`, `-mock-provider.ts`),
run in an isolated `mktemp` sandbox with its own `SENPI_CODING_AGENT_DIR` (caller env ignored) and a
LOCAL mock provider (no keys, no network). It drives the REAL `senpi` binary (`/opt/homebrew/bin/senpi`,
v2026.7.5-2) with the built omo plugin (`packages/omo-senpi/plugin`) loaded via the sandbox
`settings.json` `packages`.

Two product bugs were fixed (RED-first) and are exercised here:

1. `packages/omo-senpi/src/components/task/engine.ts` wired BOTH runner slots to the in-process runner
   (`runners:{"in-process":runner, process:runner}`), so `execution_mode:"process"` silently fell back
   to in-process and `RpcProcessRunner` was never instantiated. Now the process slot is
   `createRpcManagedRunner(new RpcProcessRunner())` via injectable `runnerFactories`.
2. `packages/senpi-task/src/manager/manager.ts` `#launch` recorded the `start` transition WITHOUT the
   spawned handle's pid, so `task_output(status)` and `session_start` reconciliation never saw a pid.
   Now `#recordSpawnFacts` persists the pid (pure decision in `manager-helpers.ts` `recordSpawnedPid`).

Unit RED-first proofs (`red-proof-engine.txt`, `red-proof-manager.txt`): reverting either fix flips the
corresponding unit test to FAIL; the fix flips it GREEN (`unit-tests.txt`, 7 pass).

## WHAT WAS OBSERVED

`full-run-verdict.json` (== `full-run.json`), captured live:

- `real_credentials_untouched_and_caller_env_ignored`: PASS - the 4 real `~/.senpi/agent`
  credential/config files are byte-identical before/after (`realCredentialsUntouched:true`,
  `credential-isolation-shasum.txt`). Caller `SENPI_CODING_AGENT_DIR` was ignored in favor of the
  sandbox agent dir.
- `process_mode_routes_to_rpc_runner`: PASS - the STEP-1 wiring fix, proven live. The `process` task
  record reaches the rpc child-spawn path (its `error_message` names the rpc child entry
  `@code-yeongyu/senpi/.../rpc-entry`), a fingerprint the OLD in-process fallback could NEVER produce
  (the fallback completes the mock child in-process with no rpc trace).
- `no_leaked_rpc_child_pids`: PASS - `leakedPids:0`; the process tree is killed in `finally` and no
  `senpi --mode rpc` pid survives.
- `spawn_process_pid_and_session_jsonl`, `steer_ack_mid_run`, `completion_push_arrives`,
  `kill_marks_error_killed_true`, `reconcile_lost_terminates_orphan`: FAIL (documented, NOT silent) -
  the full live child scenarios cannot complete headlessly. See `productGap` in the verdict.

## WHY IT IS ENOUGH (and what is NOT yet possible headlessly)

The two bugs the driver and this todo named are fixed and proven: unit-proven (RED-first, both
directions) AND live-proven for the wiring (the rpc-spawn path is reached only when the process slot is
the rpc runner). Isolation is proven (credential shasums unchanged) and there are zero leaked pids.

The remaining 5 checks require a live rpc CHILD to run to completion, which is blocked by a DEEPER
`todo 8` rpc-child-spawn defect that is OUT OF todo-27's "wire the runner slot" scope:

1. `packages/senpi-task/src/runners/rpc/spawn.ts` resolves the `@code-yeongyu/senpi/rpc-entry`
   specifier at spawn time, but when omo runs as a senpi extension that specifier is hijacked by
   senpi's OWN loader alias (`@code-yeongyu/senpi` -> the running senpi's `dist/index.js`), so the
   child entry never resolves under the node-based senpi. A correct fix must spawn the child via the
   senpi executable itself, not via module resolution.
2. Even past (1), the rpc child is spawned as a bare `senpi --mode rpc` WITHOUT the `-e` mock provider
   and WITHOUT a model threaded through `RpcRunnerSpec`, so a keyless/networkless mock child cannot run
   a turn under the QA no-keys/no-network law. Threading a model/provider into the rpc child is a
   `RpcRunnerSpec` + `buildRpcSpawn` product change owned by todo 8.

Both are spawn-strategy / model-threading changes, not runner wiring. They are recorded here as a live
QA finding rather than fixed in this pass to keep the change surgical to the two named bugs.

## WHAT WAS OMITTED

No secrets/tokens/auth headers are copied here. `credential-isolation-shasum.txt` records only SHA-256
digests of the real credential files, never their contents. `full-run.stderr` is empty. The
informational whole-dir digest (`wholeDirDigestStable`) is expected to move on a live dev machine
(senpi writes `senpi-debug.log` + concurrent session JSONL that ignore `SENPI_CODING_AGENT_DIR`); the
gated isolation check is the per-file credential digest, which held.

## Files

- `full-run-verdict.json` / `full-run.json` - live driver JSON verdict (result FAIL; wiring PASS)
- `full-run.stderr` - driver stderr (empty)
- `self-test.txt` - `--self-test` output (SELF-TEST OK)
- `unit-tests.txt` - the two RED-first unit suites, green (7 pass)
- `red-proof-engine.txt` / `red-proof-manager.txt` - reverting each fix flips its unit test to FAIL
- `credential-isolation-shasum.txt` - real `~/.senpi/agent` credential digests
