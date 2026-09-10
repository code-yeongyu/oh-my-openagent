# test — ulw-loop Vitest suite (70 files, ~10.4k LOC)

**Score 15** (70 files, >70% code, fixture barrel imported by most suites; distinct domain: the executable contract for the state machine in [`../src`](../src/AGENTS.md)). Runner, style, and forbidden constructs are in the [component AGENTS.md](../AGENTS.md).

## SUITE FAMILIES

| Family | Suites |
|--------|--------|
| Plan/lock | `plan-io`, `plan-io-cross-process`, `plan-crud`, `state-lock`, `paths` |
| Checkpoint | `checkpoint`, `-continuation`, `-final`, `-status`, `-template`, `cli-checkpoint*`, `validation-batch-checkpoint` |
| Quality gate | `quality-gate` + `-roles`, `-blockers`, `-cap-and-dedupe`, `-poisoning-cascades`, `-single-report`, `-fields-messages`, `-aggregate-basics`, `-doc`, `-lazycodex-surface`, `-senpi-surface` |
| Steering | `steering`, `steering-batch`, `steering-snapshot`, `cli-steering*` |
| Hooks/guards | `spawn-guard` (665 LOC, largest), `codex-hook`, `stop-resume-hook`, `guided-recovery` |
| CLI surface | `cli-commands`, `cli-entrypoint`, `cli-json-errors`, `cli-scope-required`, `cli-create-goals`, `cli-complete-goals`, `cli-status-next-actions`, `cli-helpers` |
| Codex integration | `codex-goal-snapshot`, `codex-goal-instruction`, `surface`, `ultrawork-directive`, `package-smoke` |

## FIXTURES (`test/fixtures/`)

| File | Exports |
|------|---------|
| `checkpoint-builders.ts` | `criterion`, `goal`, `passGoal`, `plan`, `repoWith`, `snapshot`, `lastLedger`, `expectCode`, `NOW` |
| `quality-gate-builder.ts` | `qualityGateJson`, `writeQualityGateArtifacts`, `qaDirFor`, `QA_DIR`, per-artifact paths |
| `cli-session.ts` | `CLI_TEST_SESSION_ID`, `CLI_TEST_SCOPE` |
| `sample-*.json`, `artifacts/*` | realistic plan / gate / artifact payloads referenced by path |

## CONVENTIONS

- Filesystem isolation is real, not mocked: `mkdtemp` roots per test, cleaned in `afterEach`; fixtures write actual `goals.json`, ledgers, evidence trees, and gate artifacts.
- Import specifiers mix `.js` (production-style) and `.ts` (direct Vitest execution); both are intentional here.
- Env mutation (`OMO_SPAWN_FANOUT_LIMIT`, `OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT`, `OMO_AGENT_TOOLKIT_SURFACE`, `PLUGIN_DATA`) is captured in `beforeEach` and restored in `afterEach`; never leak a surface override into a sibling suite.
- Root-only cases use `it.skipIf(process.getuid?.() === 0)` rather than assuming an unprivileged runner.
- Error assertions go through `expectCode` on `UlwLoopError` codes, not on message prose.

## CONTRACTS THESE TESTS PIN

- Gate: the `omo-senpi` surface rejects a `codeReview` lane; non-gate reviewers are never denied by the gate-artifact rule; artifact kind/surface compatibility and attempt-dir containment are enforced.
- Lock: a live owner is never reclaimed by age; contention fails closed; atomic writes leave no temp files.
- Spawn guard: the admission breaker denies before artifact, quota, and state-lock guards; a denied spawn charges no reviewer quota; both flattened and dotted v2 spawn tokens count.
- Deprecated steering markers must keep parsing to `null` — do not re-enable them to make a suite pass.

## ANTI-PATTERNS

- No fixed sleeps or polling for lock/async behavior; drive the real lock file and assert its observable state.
- Do not weaken a fixture to green a failing suite; the fixtures encode the shipped state layout.
- Do not assert on directive or help prose beyond the byte-identity pins that already exist.
