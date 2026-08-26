# Live Senpi QA — DAG completion verification directive

Change under QA: DAG-owned task completions and DAG-run terminal wakes append
`DAG_VERIFICATION_DIRECTIVE` ("TREAT AS FALSE UNTIL YOU PROVE IT") to the model-facing
notification content.

- Worktree: `/private/tmp/ulw-wt-dag-directive`
- Branch: `feat/dag-completion-verification-directive`
- Base commit: `5d2742bf7232bb8a8691936d06c043b5d81d4cea`
- Evidence dir resolved ONLY via the skill script:
  `node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs --repo-root /private/tmp/ulw-wt-dag-directive --slug 20260820-dag-completion-directive`
  → `/private/tmp/ulw-wt-dag-directive/.omo/evidence/omo-senpi-adapter/20260820-dag-completion-directive` (exit 0)
- Real senpi binary used: `/Users/yeongyu/.local/bin/senpi` (present — **no SKIP was accepted**)

## Expected impact scope (mapped BEFORE running)

| Surface | Expected AFTER behavior |
|---|---|
| `buildCompletionMessage` (senpi-task) | appends the directive **only** when some detail carries `dag` |
| `buildCompletionDetails` (senpi-task) | emits `dag: {run_id, node_id}` **only** for `record.owner.kind === "dag"` |
| `dag-wake.ts` terminal injection (`dag.run.completed/failed/cancelled`) | run summary + directive |
| `dag-wake.ts` paused injection (`dag.run.paused`) | summary only, **no** directive (a pause is not a completion claim) |
| plain (non-DAG) task completion wake | unchanged, **no** directive |
| every other adapter path | unchanged |

Regression risk being hunted: the directive leaking into non-DAG completions, into paused DAG runs,
or duplicating in mixed batches; and any disturbance of the live task completion/wake path.

## WHAT WAS TESTED

1. **`node packages/omo-senpi/scripts/qa/drive.mjs --self-test`**
   Surface: the driver + isolation harness itself. Proves the sandbox builds its own
   `SENPI_CODING_AGENT_DIR`/XDG and refuses to reuse the caller's, i.e. the precondition that makes
   every later run trustworthy. → `driver-drive-selftest.txt`

2. **`SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs`**
   Surface: a real `senpi` session with the omo plugin loaded in an isolated agent dir. Proves the
   adapter carrying this change still boots and wires into a live session. → `driver-drive-live.json`

3. **`TASK_E2E_OUT_DIR=$ev/live-task-completion SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs`**
   Surface: the live model-facing task completion / wake-notification path — the exact path
   `buildCompletionMessage` feeds. Drives real `senpi` processes (main background-spawn flow, batch
   fanout, sync inline, negative category, and the full quit/resume revival matrix) and captures the
   real `omo-senpi:wake` messages the model received.
   Proves (a) the completion notification path still works end-to-end with the change, and (b) the
   NEGATIVE half of this change: plain non-DAG completions carry **no** directive.
   → `driver-task-e2e.json`, `live-task-completion/*.log`, `live-task-completion/verdict.json`

4. **Baseline attribution run of the same driver** at base commit `5d2742bf7` (pristine
   `git archive` extract at `/tmp/ulw-dag-baseline-e2e`, node_modules symlinked, no git-state
   mutation), same host, same binary, same driver.
   → `baseline-driver-task-e2e.json`, comparison in `driver-attribution.txt`

5. **`bun run /tmp/ulw-dag-directive-evidence/aux-dag-wake-real-surface.ts`**
   Surface: the real `createDagWake` + the real `IdleInjectionCoordinator`, i.e. the actual DAG
   terminal-wake injection path, printing the exact model-facing message. Covers the half that no
   shipped live driver reaches (no driver spawns a real DAG run).
   → `aux-dag-wake-real-surface.ts`, `aux-dag-wake-real-surface-output.txt`

6. **Senpi hermetic gate**: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`, then
   `bun run test:senpi`. → `gate-tsgo-omo-senpi.txt`, `gate-test-senpi.txt`, `gate-fails.txt`

## WHAT WAS OBSERVED

### Driver results

| Driver | Result | realSenpiUntouched | Isolation fields |
|---|---|---|---|
| `drive.mjs --self-test` | **PASS** (`SELF-TEST OK`, exit 0) | n/a | asserts sandbox agent dir != caller's |
| `drive.mjs` (live) | **PASS** | **`true`** | `providedSenpiCodingAgentDir: "IGNORED"`, sandbox `/private/var/folders/.../omo-senpi-qa-TOvdwq/agent` |
| `task-e2e.mjs` (live) | **FAIL overall** — 21 PASS / 6 FAIL, **all 6 identical at baseline** | **`true`** | `providedAgentDir: "IGNORED"`, `realSenpiChangedPaths: []`, `allRealSenpiChangedPaths: []`, 9 isolated sandbox agent dirs |
| `task-e2e.mjs` (baseline `5d2742bf7`) | **FAIL overall** — same 6 FAIL checks | **`true`** | `realSenpiChangedPaths: []` |

`task-e2e.mjs` failing checks, mine vs baseline (`driver-attribution.txt`):

```
MINE   FAIL (6): followup_revive, jsonl_sequence, resume_finished_steerable,
                 resume_revived_resident, resume_ttl_not_revived, task_output_peek
BASE   FAIL (6): followup_revive, jsonl_sequence, resume_finished_steerable,
                 resume_revived_resident, resume_ttl_not_revived, task_output_peek
MINE-ONLY failures: NONE
BASE-ONLY failures: NONE
IDENTICAL failure sets: True
```

All 27 checks match verdict-for-verdict between the two runs. **Zero failures are attributable to
this change**; these six are a pre-existing defect of the driver's revival scenarios on this host.
The checks that matter for this change all PASS in both: `unconditional_wake`, `spawn_background`,
`sync_inline_no_notification`, `batch_fanout_two_children`, `real_senpi_untouched`, `no_leaked_pids`.

### The live model-facing completion message (non-DAG negative proof)

Captured verbatim from a real senpi run (`live-task-completion/main.stdout.json.log`,
`customType: "omo-senpi:wake"`, task `st_01a0219a`):

```
task completion name:e2echild id:st_01a0219a category:mockcat(omo-mock/mock-1)
fallback:omo-mock/mock-1->mock-1 status:completed duration:397ms tools:0
result:"omo e2e child first unit complete"
next:Use task_send({ to: "st_01a0219a", message: "..." }) to continue.
```

`grep -c "TREAT AS FALSE" live-task-completion/main.stdout.json.log` → **0**, and the completion
detail carries **no** `dag` field. A plain task is not DAG-owned, so the directive MUST be absent —
observed absent on the real wire. This is the leak-check for the change, not just a unit assertion.

### The DAG terminal wake (positive proof, real coordinator)

`aux-dag-wake-real-surface-output.txt`:

- `dag.run.completed` → injected `omo-senpi:wake` content = run summary + blank line + the full
  directive; `deliverAs: "steer"`; details `customType: "omo-senpi.dag-run"` with runId/counts.
  `carries directive? true`
- `dag.run.failed` → summary **with the first-failure line preserved**
  (`First failure at impl [node_failed]: impl node never produced plan.md`) + directive.
  `carries directive? true`
- `dag.run.paused` → `DAG "verification-demo" paused (session shutdown): it will resume when the
  session restarts.` — `carries directive? false`, directive occurrences `0`. The pause exemption
  holds on the real surface.

DAG-owned **completion** content (same directive, via `buildCompletionMessage`) is printed in the
general slug's `aux-real-surface-output.txt`, including `dag detail field
{"run_id":"dag_run_demo","node_id":"impl"}`, plain-path `false`, and mixed-batch directive count `1`.

### Senpi hermetic gate

- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` → **exit 0, clean**.
- `bun run test:senpi` → **2104 pass / 1 skip / 13 fail**, exit 1 (`Ran 2118 tests across 293 files`).
  The 13 failures are `comm`-identical to the recorded pre-existing root-CWD baseline set
  (`gate-fails.txt` vs `rootcwd-fails.txt` in the general slug → MINE-ONLY **empty**), and also a
  subset of the freshly measured baseline extract run (`gate-baseline-fails.txt`, 25 fails →
  MINE-ONLY **empty**). They are `cli-local` install/uninstall, `createInitDeepAdvisorComponent`
  (11), `OmO Native product identity`, `session_start component ordering` — none DAG-, completion-,
  or wake-related. The extra 12 in the baseline extract are artifacts of the `git archive` copy
  (no `build:senpi-plugin`, no untracked generated skill/bundle files) and are absent from my run.

### Real `~/.senpi/agent` isolation

- Both live drivers: `realSenpiUntouched: true`, `realSenpiChangedPaths: []`,
  `allRealSenpiChangedPaths: []`, `providedAgentDir: "IGNORED"`.
- Whole-directory digest DID change (`real-senpi-before.txt` `5db1af9b…` →
  `real-senpi-after.txt` `5c73fa2c…`). Per the skill this digest is supporting evidence only: the
  only moved path is the shared live `senpi-debug.log` (mtime 09:19, see
  `real-senpi-agent-listing-after.txt`), written by the concurrently running real session, and the
  driver's own path attribution reports nothing QA-attributed. Isolation proof is the driver's
  empty changed-path list, not the digest.
- `/Users/yeongyu/local-workspaces/omo` was never written; all work stayed in the worktree,
  `/tmp/ulw-dag-directive-evidence`, and `/tmp/ulw-dag-baseline-e2e`.

## WHY IT IS ENOUGH

Both directions of the change are proven on real surfaces, not only in unit tests:
the positive path (DAG terminal wake + DAG-owned completion carry the directive, once, with the
failure line and node addressing intact) through the real `createDagWake` + real
`IdleInjectionCoordinator` and the real `buildCompletionMessage`; the negative path (plain
completions and paused runs stay directive-free) on a genuine live `senpi` wire capture. The live
adapter still boots and delivers completions (`drive.mjs` PASS, `unconditional_wake` PASS). Every
red check and every gate failure is reproduced name-for-name at the base commit with the same
binary on the same host, so nothing red is attributable to this change.

## WHAT WAS OMITTED

- No real DAG run was driven through the `senpi` CLI: no shipped driver spawns one, and adding a
  driver would mean modifying repo scripts, which this assignment forbids. The gap is closed at the
  next-best real surface — the actual wake/injection objects — rather than left unproven.
- The 6 pre-existing `task-e2e.mjs` revival failures and the 13 pre-existing gate failures were
  attributed, not fixed; they are outside this change's scope.
- No secrets, tokens, auth headers, or env dumps are included; `auth.json` / `models-store.json`
  contents were never read, only file listings and digests.
