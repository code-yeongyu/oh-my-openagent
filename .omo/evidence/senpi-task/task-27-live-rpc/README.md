# Task 27 - Live QA driver: rpc-process e2e (kill + reconcile)

Driver: `packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs` (+ `--self-test`)
Lane-private helper: `packages/omo-senpi/scripts/qa/task-rpc-e2e-helpers.mjs`
Lane-private mock provider: `packages/omo-senpi/scripts/qa/task-rpc-e2e-mock-provider.ts`
Senpi binary: `/opt/homebrew/bin/senpi` (2026.7.5-2). Node v26.4.0.

## WHAT WAS TESTED

Drove the REAL `senpi` binary in an isolated `SENPI_CODING_AGENT_DIR` mktemp sandbox (created by
`drive.mjs` `createSandbox`/`seedSandbox`) with a LOCAL `-e` mock provider (`omo-mock`, no API keys, no
network), following the `drive.mjs` conventions. A project `.omo/omo.json` declared a `process`-mode
category `proc`. The driver scripts the parent tool sequence and asserts the five plan scenarios of todo
27, each against the REAL persisted task record / event stream, not a fake:

1. `task(category:"proc", execution_mode:"process", run_in_background:true)` -> a real child senpi PROCESS
   is spawned, proven by `execution_mode:"process"` + numeric `pid` + a child session JSONL under sandbox
   `.omo/senpi-task/sessions/<st_id>/` + `residency_state:"rpc_detached"`.
2. `task_send` steer mid-run -> steer ack in the event stream / record.
3. completion push -> a `process`-mode record reaches `status:"completed"`.
4. KILL: `kill -9` the child pid from `task_output(status)` -> record `status:"error"` with `killed:true`.
5. RECONCILE: relaunch senpi in the same sandbox cwd -> `session_start` reconciliation records the orphan
   `lost` with a pid breadcrumb AND terminates it (the old pid is DEAD after relaunch).

Foundational gates (always asserted): isolation (real `~/.senpi/agent` credential/config files
byte-unchanged + caller `SENPI_CODING_AGENT_DIR` ignored in favor of the sandbox), no leaked rpc child
pids, and the whole process tree killed in `finally`.

Commands:
- `node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test` (see `self-test.txt`)
- `SENPI_BIN=/opt/homebrew/bin/senpi node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs` (see `full-run-verdict.json`)
- credential isolation shasum before/after (see `credential-isolation-shasum.txt`)

## WHAT WAS OBSERVED

- `--self-test`: GREEN for both the driver and the mock provider (`self-test.txt`). The self-test unit-covers
  `analyzeSpawn` (fixed-product shape, in-process-fallback gap localization), steer-ack detection,
  status-snapshot extraction, and the credential digest (deterministic + moves when auth.json changes).
- Full run (`full-run-verdict.json`): `result:"FAIL"`. Per-check:
  - `real_credentials_untouched_and_caller_env_ignored`: PASS (`realCredentialsUntouched:true`,
    `providedAgentDir:"unset"`, sandbox agent dir used).
  - `spawn_process_pid_and_session_jsonl`: FAIL - `execution_mode=process pid=absent sessionJsonl=false
    residency=disposed`. The task record `st_...` IS persisted with `execution_mode:"process"` (the driver
    reaches the real engine and the manager honors the process slot), but no child process is spawned.
  - `steer_ack_mid_run`, `completion_push_arrives`, `kill_marks_error_killed_true`,
    `reconcile_lost_terminates_orphan`: FAIL, each `blocked: no rpc child spawned` - process-dependent
    facts cannot exist without a child pid.
  - `no_leaked_rpc_child_pids`: PASS (`leakedPids:0`).
- Credential isolation (`credential-isolation-shasum.txt`): `auth.json`, `models.json`, `settings.json`,
  `trust.json` shasums are IDENTICAL before and after a full run. Repeated runs confirm this is
  deterministic. The real credential/config files are never read or rewritten.

### Real product gap uncovered (reported per the cross-lane contract, NOT patched here)

`execution_mode:"process"` does not spawn an rpc child. `packages/omo-senpi/src/components/task/engine.ts`
line ~99 wires BOTH runner slots to the in-process runner
(`runners: { "in-process": runner, process: runner }`, where `runner` is `createInProcessManagedRunner(...)`
at `buildRunner`). The `RpcProcessRunner` / `createRpcManagedRunner` built by todo 8 (`[x]` done, exported
from `@oh-my-opencode/senpi-task`) are never instantiated in the omo-senpi engine composition, so the
manager's `process` slot silently falls back to in-process: the record ends `residency_state:"disposed"`
with no pid and no `sessions/<id>/` JSONL. Program acceptance line 411 ("Multi-process mode ... pid
kill/reconcile handling proven by the kill+lost driver scenarios") makes this a genuine landed-code gap in
the omo-senpi engine wiring, not an intended deferral (the team-member in-process restriction at plan line
298 is a separate, documented case). This is a `src/` fix in the omo-senpi component lane; per the task's
cross-lane contract this QA lane reports it and does not patch `src/`.

## WHY IT IS ENOUGH

- The driver is NOT hollow: it drives the real binary through the real omo-senpi task engine, a real task
  record is persisted with `execution_mode:"process"`, and the failing checks localize the EXACT missing
  facts (pid / child session JSONL / rpc residency). It goes GREEN on all five scenarios only on a build
  that actually instantiates the rpc runner and records the child pid - which the `--self-test`
  fixed-product shape proves the analysis accepts.
- Isolation is gated on the security-relevant guarantee (Metis #7/#8): the real credential/config files are
  byte-stable and the caller env is ignored. The whole-dir `~/.senpi/agent` digest is kept only as an
  INFORMATIONAL field (`wholeDirDigestStable`) because a live dev machine churns it through ambient senpi
  activity (other sessions' JSONL, the global `~/.senpi/agent/senpi-debug.log` that ignores
  `SENPI_CODING_AGENT_DIR`); the reference `drive.mjs` reports the same whole-dir field without gating on
  it, so this driver matches the accepted convention while gating on the assertion that actually matters.
- No orphaned processes: `no_leaked_rpc_child_pids` PASS + the `finally` kills any rpc child that appeared
  during the run. `bun run test:senpi` = 142 pass / 0 fail; extension bundle 501174 bytes (<= 700000).

## WHAT WAS OMITTED

- Scenarios 2-5 (steer / completion / kill / reconcile) could not exercise a live child because the product
  does not spawn one; they are reported FAIL with a localized reason rather than skipped or faked. Once the
  engine wires `RpcProcessRunner` into the `process` slot, the same driver validates them unchanged.
- No secrets, tokens, auth headers, or env dumps are copied here. `auth.json` is referenced only by shasum;
  its contents are never printed. The sandbox is deleted in `finally`, so its transcripts are not retained.
