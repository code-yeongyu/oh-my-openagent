# DAG scheduler: dependency-frontier admission replaces the strict wave barrier

Incident: `dag_530ad299` (sisyphuslabs "omo startup fixes PR wave"), 2026-08-25.
Branch: `fix/dag-dep-frontier`. Baseline: `origin/dev` @ `76e713247` (includes sibling
PR #7320 `fix/dag-recovery-nonblocking`, which is preserved untouched).

## WHAT WAS TESTED

The DAG scheduler's admission loop (`packages/senpi-task/src/dag/scheduler.ts`):
node admission keyed on per-node dependency readiness (every `dependsOn` node `completed`
plus a free resident slot) instead of full-settle wave barriers, while preserving residency
batching, the `residency_denied` retry loop, the failure skip-cascade (now gated at frontier
quiescence to keep the revive window open), cancellation semantics, retry/send/amend, and an
informational `dag.wave.started` / `dag.wave.completed` grouping vocabulary.

| Command | Purpose |
|---------|---------|
| `bun test packages/senpi-task/src/dag/scheduler-frontier.test.ts` on pristine `origin/dev` | RED: adapted R2 regression fails on the barrier |
| `bun test packages/senpi-task/src/dag/scheduler-frontier.test.ts` on this branch | GREEN: same test passes |
| `bun test packages/senpi-task` (twice) | Package gate |
| `tsgo --noEmit -p packages/senpi-task/tsconfig.json` | Type gate |
| `bun test packages/omo-senpi/src/components/task` | Consumer wiring (dag tool + runtime) |
| `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` + `bun test packages/omo-senpi/src/bundle-size.test.ts` | Adapter type gate + regenerated bundle size |
| `node packages/omo-senpi/scripts/qa/drive.mjs` (+ `--self-test`) | Live senpi session with the regenerated `omo-task.js` bundle; isolation proof |

Artifacts: `red-origin-dev.txt`, `green-branch.txt`, `gate-senpi-task.txt`,
`gate-typecheck.txt`, `gate-omo-senpi-task-component.txt`, plus
`../../omo-senpi-adapter/20260825-dag-dep-frontier/` for the live driver JSON.

## WHAT WAS OBSERVED

### The defect, on pristine `origin/dev` (`red-origin-dev.txt`)

The strict barrier held wave N+1 behind wave N's slowest node. The adapted R2 regression
(the `dag_530ad299` shape: lane-a + lane-c share wave 0, lane-b depends only on lane-a)
TIMES OUT: `manager.whenStarted("lane-b")` never resolves while lane-c runs, because
`runWaves` only scans wave 1 after `admitAndSettleWave` fully settles wave 0. Two more
frontier tests fail on the same code (residency FIFO behind the barrier; informational wave
grouping). The dependency-gate test passes on both old and new code - that half of the
contract never changed.

### After the change (`green-branch.txt`)

- lane-b is admitted the moment lane-a completes, while lane-c keeps running (production:
  hours). `starts == [lane-a, lane-c, lane-b]` and lane-c's task is still `running`.
- A dependent still waits for ITS dependencies (`b` never starts while `a` runs).
- Residency batching is preserved: a freed slot goes to the OLDEST denial before newer ready
  nodes; denial with nothing attached still fails `residency_denied` exactly as before.
- `dag.wave.started` groups each admission pass by wave index (a staggered wave index can
  appear in several started events); `dag.wave.completed` fires once per index with the FULL
  wave membership when every member is terminal. Wave 1's grouping can precede wave 0's.
- The failure skip-cascade now runs at frontier quiescence (nothing attached), which is what
  keeps the mid-flight revive window open: `e2e-failure`'s "revive-inside-live-wave"
  (dag_2d12c2f7) still passes unmodified - a failed node revived via `send` before its
  sibling settles still unblocks the dependent after the revival completes.
- Every pre-existing scheduler/e2e/recovery test passes without weakening, except the ones
  this PR consciously re-pins (see FILES): the old barrier test at `scheduler.test.ts:840`
  is replaced by the frontier contract pair, the cancellation test now expects `next`
  admitted before the cancel (frontier), and `e2e-happy` mixed-eight pins the new
  deterministic interleaving (`expectedFrontierSequence`) plus the frontier launch order.

### Fingerprint policy change

`SCHEDULER_FINGERPRINT_INPUT.waveAdmission` moved `strict-barrier` -> `dependency-frontier`
(`manager.ts`, typed in `fingerprint.ts`). The fingerprint input must change when admission
semantics change, so runs keyed under the old fingerprint are deliberately not reused -
re-submitting the same definition under the same key raises `definition_conflict` until the
7-day retention prunes the key. `fingerprint.test.ts` pins updated to the new input.

### Gates

| Gate | Result | Artifact |
|------|--------|----------|
| `bun test packages/senpi-task` (run 2x) | 1749 pass / 1 skip / **0 fail** (1750 across 248 files) | `gate-senpi-task.txt` |
| `tsgo --noEmit -p packages/senpi-task/tsconfig.json` | clean, exit 0 | `gate-typecheck.txt` |
| `bun test packages/omo-senpi/src/components/task` | 483 pass / **0 fail** | `gate-omo-senpi-task-component.txt` |
| `bun test packages/omo-senpi/src/bundle-size.test.ts` | 1 pass / 0 fail | (inline above) |
| `drive.mjs` live senpi | `{"result":"PASS",...,"realSenpiUntouched":true}` | `omo-senpi-adapter/20260825-dag-dep-frontier/drive-live.txt` |

## WHY IT IS ENOUGH

The regression pins the exact production symptom (ready dependent starved behind an
unrelated running sibling) at the exact seam that produced it, event-driven (journal-backed
`whenStarted`/state subscription, no sleeps), so it cannot pass by timing luck. It is RED on
pristine `origin/dev` and GREEN on the branch. The three preserved invariants that could
silently regress (residency batching, revive window, cancellation) each have a pre-existing
test that passes unmodified, and the new residency-FIFO test pins slot fairness explicitly.
Docs now agree with code: `dag-tool.ts`'s first line, both AGENTS.md DAG rows, and the
scheduler header all describe dependency semantics.

## WHAT WAS OMITTED

- No dedicated live DAG-admission driver exists (`dag-gate-proof.ts` is manager-level start
  validation). Live proof is `drive.mjs` (real senpi process, regenerated bundle loaded,
  isolated sandbox); admission semantics are proven at the engine seam, same scope decision
  as the sibling PR #7320.
- `bun test packages/omo-senpi` full-adapter suite carries pre-existing failures documented
  by the sibling PR's evidence (init-deep-advisor, cli-local, product identity, session_start
  ordering); the DAG consumer directory is 0 fail and was run instead.
- Bundle regeneration (`packages/omo-senpi/plugin/extensions/omo-task.js`, minified rewrite
  + build marker) is INTENTIONAL: the scheduler change is bundled there. Verified no other
  extension drifted (`git status` showed only omo-task.js).
- `bun run build` root-plugin drift: not run; no opencode surface changed.

## FILES

| Path | Contents |
|------|----------|
| `plan.md` | The change plan written before the first edit |
| `baseline-repro/dag-stall-repro.test.ts`, `red-output.txt` | Original failing-first repro (R1+R2) copied from the parent lane's evidence |
| `red-origin-dev.txt` | Adapted regression failing on pristine `origin/dev` @ `76e713247` |
| `green-branch.txt` | Same tests passing on this branch |
| `gate-senpi-task.txt` | Package gate output |
| `gate-typecheck.txt` | Type gate output |
| `gate-omo-senpi-task-component.txt` | Consumer wiring gate output |
| `omo-senpi-adapter/20260825-dag-dep-frontier/` | Live senpi driver evidence (sanctioned path) |

## Post-rebase re-verification (2026-08-25, dev moved to f91a4c252)

`perf/senpi-task-lazy-barrel` (#7274) landed mid-flight and made the PR DIRTY. Rebased onto
`origin/dev` @ `f91a4c252`: the fix commit applied cleanly; the bundle commit conflicted on
`omo-task.js` (expected - the barrel perf also flows into the bundle) and was resolved by
REGENERATING via `build-extension.mjs`, never hand-merging minified output. Re-run gates on
the rebased tree: `bun test packages/senpi-task` = 1753 pass / 1 skip / 0 fail (the +3 tests
vs the first capture are #7274's new file); dag suite 250 pass / 0 fail. Auto-merge re-armed.
