# Ultrawork notepad handoff: nested Senpi reconciliation storm

Full live notepad:
`/tmp/ulw-20260908-reconcile-storm.omo874d.md`

## Goal and stop condition

Open an upstream PR against `code-yeongyu/oh-my-openagent` `dev` that prevents
marked process-mode RPC children from automatically reconciling and respawning
their own persisted child-task trees, while preserving unmarked root recovery
and explicit detached-RPC `task_send` revival.

Stop only after tests, production-bundle QA, cleanup, diagnostics, package
gates, review, atomic commit, push, and remote PR verification are complete.

## Root cause and decision

- A live incident reached roughly 170 RPC processes and 37.1 GiB RSS.
- Every process carried `OMO_SENPI_TASK_RPC_CHILD=1`.
- Persisted records reported local depth 1 while OS ancestry reached depth 36,
  so per-manager depth enforcement could not bound the restored process tree.
- The adapter returned early only when a marked child had no captured session.
  A restored marked child therefore called `reconcileOnSessionStart` with its
  own session id and recursively rebuilt its historical child tree.
- Decision: every marked RPC child captures live context and then skips only
  automatic session-start recovery. Unmarked roots retain the complete ordered
  recovery chain. Explicit detached-RPC `task_send` revival remains in the
  separate steering path.

## RED evidence captured before production

- Root PIN:
  `/tmp/ulw-reconcile-evidence/pin-root.txt` — 2 pass, 0 fail.
- Marked-child unit RED:
  `/tmp/ulw-reconcile-evidence/red-rpc-child.txt` — expected zero reconcile
  calls, observed one.
- Production-process RED:
  `red/task-child-reconcile-summary.json` — task `st_01a081ab` changed from
  PID `2946015` to `2946525`; driver exited 1.
- RED cleanup:
  `/tmp/ulw-reconcile-evidence/cleanup-red.txt` — both PIDs absent,
  `leakedPids=[]`, sandbox removed.

## Implementation

- `event-bridge.ts`: after `captureFrom`, return whenever
  `OMO_SENPI_TASK_RPC_CHILD === "1"`.
- The focused test now makes the marked restored-session contract explicit:
  order is only `["capture"]`; reconciliation and notification calls are zero.
- `task-child-reconcile-e2e.mjs` seeds one nested process task, hard-stops and
  resumes its marked parent, and treats any PID replacement or reconcile event
  as failure.
- Generated Senpi extension bundles were rebuilt.

## GREEN and mutation evidence

- Marked-child focused GREEN:
  `/tmp/ulw-reconcile-evidence/green-rpc-child.txt` — 2 pass, 0 fail.
- Root mutation RED:
  `/tmp/ulw-reconcile-evidence/mutation-root-red.txt` — temporary unconditional
  startup skip left only `["capture"]` and failed the required root chain.
- Restored root GREEN:
  `/tmp/ulw-reconcile-evidence/green-root.txt` — 2 pass, 0 fail.
- Production-process GREEN:
  `green/task-child-reconcile-summary.json` — nested PID remained `3011916`,
  no recursive reconcile and no reconcile event.
- Real root restart GREEN:
  `root-green/parent-restart-summary.json` — replacement root continued the
  same child task.
- Explicit detached-RPC `task_send`:
  `task-send-focused-green.txt` — exactly one RPC respawn and one message
  delivery; 2 pass, 0 fail.

## Isolation and cleanup

- The final marked-child QA used
  `/tmp/omo-senpi-qa-AQOpk4/agent`; before/after tree digests recorded the real
  `/home/thewind/.senpi/agent` as untouched.
- RED, marked-child GREEN, and root GREEN reported no leaked PIDs and removed
  sandboxes.
- Post-run probes found none of the recorded PIDs, no RPC launcher, and no
  retained QA sandbox.
- An extra unchanged broad task driver emitted unrelated FAIL checks caused by
  stale direct-`bash` scripts and a documented suspended-child contract
  mismatch. It is not counted as a pass. Its 16 PIDs and nine sandboxes were
  cleaned.

## Verification

- Changed-code LSP diagnostics: clean.
- `omo-senpi` and `senpi-task` typechecks: exit 0.
- Full `senpi-task`: 1969 pass, 1 platform skip, 0 fail.
- `bun run test:senpi`: 3032 pass, 3 platform skips, 0 fail; evidence resolver
  10 pass, 0 fail.
- Generated bundle freshness: exit 0.
- Intended diff whitespace check: clean.
- Durable lifecycle facts are recorded in memory
  `notes/facts/2026-09.md`.

## Commit scope

Include only the intended source, test, QA driver/support, generated Senpi
extensions, and this task's canonical evidence. Exclude the three unrelated
pre-existing ANSI evidence changes and generated Codex installer drift.
