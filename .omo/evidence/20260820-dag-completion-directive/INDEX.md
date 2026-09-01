# DAG completion verification directive — QA evidence index

- Worktree: `/private/tmp/ulw-wt-dag-directive`
- Branch: `feat/dag-completion-verification-directive`
- Base commit: `5d2742bf7232bb8a8691936d06c043b5d81d4cea`
- Live Senpi QA (skill-mandated separate path):
  `/private/tmp/ulw-wt-dag-directive/.omo/evidence/omo-senpi-adapter/20260820-dag-completion-directive/README.md`

**The change:** DAG-owned task completions and DAG-run terminal wakes append
`DAG_VERIFICATION_DIRECTIVE` ("DAG SUBAGENT COMPLETION - TREAT AS FALSE UNTIL YOU PROVE IT") to the
model-facing notification content. Non-DAG completions and paused DAG runs are unchanged.

---

## 1. RED-first proof (the tests failed before the production code existed)

| Artifact | WHAT WAS TESTED | WHAT WAS OBSERVED |
|---|---|---|
| `red-notification.txt` | `bun test packages/senpi-task/src/completion/notification.test.ts` with the new assertions in place but `dag-verification-directive.ts` not yet created | **FAIL for the right reason**: `error: Cannot find module './dag-verification-directive'` — 0 pass / 1 fail / 1 error. Not a syntax or typo failure. |
| `red-dag-wake.txt` | `bun test packages/omo-senpi/src/components/task/dag-wake.test.ts` before the symbol was re-exported | **FAIL for the right reason**: `SyntaxError: Export named 'DAG_VERIFICATION_DIRECTIVE' not found in module .../senpi-task/src/index.ts` — 0 pass / 1 fail / 1 error. |

Why it is enough: each red run names the exact missing artifact the change is supposed to add, so the
later green cannot be a vacuous pass.

## 2. Directive text byte-equality

| Artifact | WHAT WAS TESTED | WHAT WAS OBSERVED |
|---|---|---|
| `expected-directive.txt` | the specified directive text, compared against the exported `DAG_VERIFICATION_DIRECTIVE` | exact match, no trailing-newline drift |

## 3. GREEN results

| Artifact | WHAT WAS TESTED | WHAT WAS OBSERVED |
|---|---|---|
| `green-completion.txt` | `bun test packages/senpi-task/src/completion/` — the notification builder surface | **62 pass / 0 fail** |
| `green-dag-wake.txt` | `bun test packages/omo-senpi/src/components/task/dag-wake.test.ts` — the DAG wake injection surface | **10 pass / 0 fail** |
| `green-senpi-task-full.txt` | `bun test` in `packages/senpi-task` — whole task/DAG engine | **1686 pass / 1 skip / 0 fail** |
| `green-omo-senpi-full.txt` | `bun test` from inside `packages/omo-senpi` (package CWD) | 2090 pass / 1 skip / **27 fail** — CWD-sensitive, see §4 |
| `green-omo-senpi-rootcwd.txt` | `bun test packages/omo-senpi` from the repo root (CI-accurate CWD) | 2104 pass / 1 skip / **13 fail** — see §4 |
| `typecheck-senpi-task.txt` | `bun run typecheck` (`tsgo --noEmit -p tsconfig.json`) in `packages/senpi-task` | exit 0, clean |
| `typecheck-omo-senpi.txt` | `bun run typecheck` (`tsgo --noEmit -p tsconfig.json`) in `packages/omo-senpi` | exit 0, clean |
| `gate-tsgo-omo-senpi.txt` | `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` from the repo root (senpi gate step 1) | **exit 0, clean** |
| `gate-test-senpi.txt` | `bun run test:senpi` from the repo root (senpi gate step 2: build plugin + tsgo + `bun test packages/omo-senpi` + resolver test) | **2104 pass / 1 skip / 13 fail**, exit 1 — every failure pre-existing, see §4 |
| `gate-fails.txt` | sorted unique `(fail)` names from the gate run | 13 names, `comm`-identical to `rootcwd-fails.txt` |

## 4. Baseline attribution method (how "not my fault" was proven, not asserted)

Two independent baselines were measured, both at base commit `5d2742bf7` with the production change
absent, on the same host with the same toolchain.

**Method.** Collect sorted-unique `(fail)` test names from each run, then compute
`comm -13 <baseline> <mine>` — the set of failures present in MY run and absent from BASELINE, i.e.
MINE-ONLY regressions. A non-empty result means the change broke something. Verified numbers:

```
green-fails.txt   (mine, package CWD) : 27 failures
rootcwd-fails.txt (mine, repo-root CWD): 13 failures
baseline-fails.txt (baseline, package CWD): 40 failures

comm -13 baseline-fails.txt green-fails.txt    -> EMPTY   (0 MINE-ONLY)
comm -13 baseline-fails.txt rootcwd-fails.txt  -> EMPTY   (0 MINE-ONLY)
comm -23 baseline-fails.txt green-fails.txt    -> 13      (baseline-only)
reconciliation: 27 (mine) + 13 (baseline-only) = 40 (baseline total)  EXACT
```

The 27/13 split is a pure CWD artifact, not a behavior difference: 14 of the 27 package-CWD failures
are tests that resolve paths relative to the repo root (e.g. `packages/omo-senpi/packages/omo-senpi/
scripts/qa/drive.mjs` ENOENT, `scandir 'packages/omo-senpi/src/components/lsp'`, root `package.json`
workspaces read). CI runs the senpi gate from the repo root, which is why `rootcwd` is the
authoritative list — and the gate run in §3 reproduces exactly those 13.

Second, fresher baseline (`gate-baseline-fails.txt`, from a pristine `git archive` extract of
`5d2742bf7` at `/tmp/ulw-dag-baseline-e2e`, node_modules symlinked, **no git-state mutation**):
25 failures, and `comm -13 gate-baseline-fails.txt gate-fails.txt` is likewise **EMPTY**. The 12
extra baseline-extract failures (skill-sync, installer source-refresh, palace entry collector,
assembled-DAG-runtime shipped-RPC) are artifacts of the archive copy lacking `build:senpi-plugin`
output and untracked generated files; none appear in my run.

Zero DAG-, completion-, or wake-related failures in any run. All 13 authoritative failures are
`cli-local` install/uninstall, `createInitDeepAdvisorComponent` (11), `OmO Native product identity`,
and `session_start component ordering` — untouched by this change.

| Artifact | Contents |
|---|---|
| `baseline-fails.txt` / `baseline-omo-senpi-full.txt` | baseline failure names + full log (2075 pass / 1 skip / 40 fail) |
| `green-fails.txt`, `rootcwd-fails.txt` | my failure names in both CWDs |
| `gate-fails.txt`, `gate-baseline-fails.txt` | gate-run vs fresh-baseline-extract failure names |
| `driver-attribution.txt` | live-driver check-level attribution (see §6) |

## 5. Aux real-surface prints (the model-facing text, printed from real code)

| Artifact | WHAT WAS TESTED | WHAT WAS OBSERVED |
|---|---|---|
| `aux-real-surface.ts` + `aux-real-surface-output.txt` | drives the real `buildCompletionDetails` / `buildCompletionMessage` for a DAG-owned record, a plain record, and a mixed batch, printing the literal model-facing content | DAG-owned content = completion lines + blank line + full directive; `dag` detail = `{"run_id":"dag_run_demo","node_id":"impl"}`; plain content contains directive → **false**; mixed batch directive occurrences → **1** (no duplication) |
| `aux-dag-wake-real-surface.ts` + `aux-dag-wake-real-surface-output.txt` | drives the real `createDagWake` through the real `IdleInjectionCoordinator`, printing the injected `omo-senpi:wake` message | `dag.run.completed` → summary + directive, `deliverAs: "steer"`, details `customType: "omo-senpi.dag-run"`; `dag.run.failed` → directive **and** the preserved `First failure at impl [node_failed]: ...` line; `dag.run.paused` → **no** directive, 0 occurrences |

Why it is enough: the positive case is shown at the actual injection/notification objects senpi
consumes, and both negative cases (plain completion, paused run) are shown directive-free, so a leak
would have been visible rather than inferred.

## 6. Live Senpi QA (real binary) — summary; full detail in the adapter slug

Drivers run against the real binary `/Users/yeongyu/.local/bin/senpi` (present — **no SKIP was
accepted as a pass**):

- `drive.mjs --self-test` → **PASS** (harness/isolation precondition)
- `drive.mjs` live → **PASS**, `realSenpiUntouched: true`, caller agent dir `IGNORED`
- `task-e2e.mjs` live (the model-facing completion/wake path) → 21 PASS / 6 FAIL,
  `realSenpiUntouched: true`, `realSenpiChangedPaths: []`, 0 leaked PIDs
- `task-e2e.mjs` at baseline `5d2742bf7` → **the same 6 checks FAIL**; `driver-attribution.txt`
  shows MINE-ONLY = NONE, BASE-ONLY = NONE, identical sets, all 27 checks verdict-for-verdict equal

Live wire capture (`../omo-senpi-adapter/20260820-dag-completion-directive/live-task-completion/main.stdout.json.log`)
shows a real `omo-senpi:wake` completion message for task `st_01a0219a` with **no** `TREAT AS FALSE`
text and **no** `dag` detail — the non-DAG negative path proven on a genuine senpi session.

## 7. What was omitted

- No real DAG run was driven through the `senpi` CLI: no shipped driver spawns one, and adding one
  would require modifying repo scripts, which this assignment forbids. Closed instead at the real
  wake/injection objects (§5).
- Pre-existing failures (6 driver checks, 13 gate tests) were attributed, not fixed — out of scope.
- No secrets, tokens, auth headers, or env dumps are included; only file listings and digests of
  `~/.senpi/agent` were recorded, never credential contents.
- Nothing was committed, staged, or pushed; no production, test, or `changes.md` file was modified.

## 8. Cleanup receipt

All driver-spawned senpi processes reaped by the drivers themselves (`no_leaked_pids: PASS`, `leakedPids: 0` in both live runs, 16 + 16 tracked PIDs verified terminal); the 9 + 9 isolated sandbox roots under `/private/var/folders/.../omo-senpi-qa-*` and the baseline extract `/tmp/ulw-dag-baseline-e2e` were removed, `pgrep -f 'omo-senpi-qa|senpi' ` shows no residual QA process, and the real `~/.senpi/agent` had zero QA-attributed changes.
