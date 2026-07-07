# Task 27 - Live rpc-process e2e (spawn / steer / completion / kill / reconcile)

Base: branch `code-yeongyu/senpi-task-w4-rpc-e2e`, HEAD `10b0865c9` + the rpc-child-spawn fix.

## WHAT WAS TESTED

The committed todo-27 driver `packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs` drives the REAL `senpi`
binary in a per-scenario isolated sandbox (own `SENPI_CODING_AGENT_DIR` + session dir under `mktemp`,
project `omo.json`) with a LOCAL mock provider loaded via `-e` (no API keys, no network). Eight checks,
each asserting a REAL fact:

1. `real_credentials_untouched_and_caller_env_ignored` - the real `~/.senpi/agent` credential/config
   files (`auth.json`/`models.json`/`settings.json`/`trust.json`) are byte-identical before/after and the
   caller's `SENPI_CODING_AGENT_DIR` is ignored in favour of the sandbox agent dir.
2. `process_mode_routes_to_rpc_runner` - `execution_mode:"process"` reaches the rpc runner (recorded pid).
3. `spawn_process_pid_and_session_jsonl` - a real detached rpc child spawned: `execution_mode=process`,
   a numeric pid, and a child session JSONL transcript under `children/<id>/sessions/<id>/`.
4. `steer_ack_mid_run` - a `task_send deliver_as:"steer"` is acked and reaches the child.
5. `completion_push_arrives` - the background process task reaches a completed terminal.
6. `kill_marks_error_killed_true` - a HANGING background child (record stays `running`) is `kill -9`'d and
   the parent records `status=error` with the `killed:true` FACT (todo-8 kill contract).
7. `reconcile_lost_terminates_orphan` - a HANGING child's PARENT is crashed (SIGKILL) while the child is
   live; on the next `session_start` the reconcile pass marks the orphan `lost` with a pid breadcrumb AND
   terminates it (orphan pid dead afterwards).
8. `no_leaked_rpc_child_pids` - no `senpi --mode rpc` child that appeared during the run survives it.

## THE DEFECT AND THE FIX

The engine wiring at `10b0865c9` routed `process` mode to `RpcProcessRunner`, but the rpc CHILD spawn was
broken, so no real detached child booted (`spawn_process` observed `pid=absent sessionJsonl=false`):

- SPAWN STRATEGY: `buildRpcSpawn` resolved `require.resolve("@code-yeongyu/senpi/rpc-entry")`. When omo
  runs AS an extension inside senpi, senpi's loader alias hijacks that specifier to the running dist
  entry, so the child never boots. FIX (`packages/senpi-task/src/runners/rpc/spawn.ts`): resolve and
  spawn the senpi EXECUTABLE (`<exe> --mode rpc`) - `SENPI_BIN` override, then the Bun sibling binary,
  then a PATH scan - for BOTH node and bun; the `execPath + rpc-entry` path remains a documented fallback.
- MODEL + PROVIDER THREADING: a separate OS process cannot share the parent's in-memory registry. The
  child is now spawned with `--no-extensions`, the parent's `-e` extensions forwarded explicitly
  (`RpcProcessRunner.inheritedExtensions` <- `parseExtensionEntries(process.argv)` in
  `omo-senpi/src/components/task/engine.ts`), and the resolved `--model` threaded through `RpcRunnerSpec`
  (`createRpcManagedRunner`). A keyless local mock child now boots and runs a turn.
- KILL FACT: `mapExitOutcomeToError` already computed `killed:true`, but it was dropped. It is now threaded
  outcome -> `fail` transition -> record, and `parseTaskRecord` preserves `killed` so a later residency
  (`dispose`) reload does not strip it.

## WHAT WAS OBSERVED

- RED (pre-fix source, clean rebuild): `spawn_process_pid_and_session_jsonl` FAIL, reason
  `execution_mode=process pid=absent sessionJsonl=false residency=resident` - no real child.
- POST-FIX full run: `result=PASS`, all 8 checks PASS, `leakedPids=0`, `realCredentialsUntouched=true`.
  Reproduced PASS on three consecutive full runs. Verdict: `full-run-verdict.json`. Self-test:
  `self-test.txt`. Gates: `gates.txt` (tsgo x2 exit 0, `test:senpi` 144/0, `bun test packages/senpi-task`
  539/0, bundle 510919 <= 700000, 0 leaked procs). Unit tests for the fixed seams: `unit-tests.txt`
  (44/0, incl. executable-vs-fallback spawn, model/extension threading, `killed` transition + parse
  round-trip). Isolation: `credential-isolation-shasum.txt`.

Note on `spawn_process` residency fact: a background child that finished its turn is honestly reclaimed to
`disposed` by the time the driver reads the record, so the spawn proof gates on `pid + real child JSONL`
(the substantive evidence a detached rpc process spawned and ran), per plan todo-27 scenario 1; residency
is surfaced as an informational fact. The kill/reconcile scenarios use a HANGING child so their records
stay `running`, giving a genuinely live, non-terminal process to signal / reconcile.

## WHY IT IS ENOUGH

Every check asserts a REAL on-disk/OS fact against the live `senpi` binary: a recorded child pid, a real
JSONL transcript, a real `kill -9` producing `error+killed:true`, and a real parent crash producing a
reconciled+terminated orphan. RED-first unit tests pin each fixed seam. Isolation is gated (real
credential files byte-unchanged; caller env ignored), and 0 pids leak.

## WHAT WAS OMITTED

The whole-dir digest of `~/.senpi/agent` is informational only (a live dev machine churns ambient files
like `senpi-debug.log` that ignore `SENPI_CODING_AGENT_DIR`); the GATED isolation proof is the
credential/config file digest, which is byte-stable. Raw child transcripts and env dumps are not copied to
avoid leaking machine-local paths / tokens; the verdict JSON carries only sandbox paths and pids.
