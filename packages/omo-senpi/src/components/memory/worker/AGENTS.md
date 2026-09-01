# memory worker

Detached `senpi -p` reflection/dream/facts child execution and the durable run lifecycle for the memory component: supervision, finalization claims, crash reconciliation, model resolution, health, and completion delivery. Children never touch git; the parent applies writes. Score ~28 (103 files, own barrel, high export/reference density).

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | Barrel: completion, health, health-alert, remediation, resolve-model, runner, run-reconciliation, spawn. |
| `memory-run-supervisor.ts` | Child lifecycle: launch manifest + gated bootstrap handshake, durable run ledger, absolute hard deadline (SIGTERM->SIGKILL process group; win32 spawns non-detached with null process identity, `taskkill /T /F` tree kill, abrupt-death reconciliation resolves through the non-destructive UNKNOWN path to `abandoned.json`), `outcome.json`/`final.json` sentinels. `*.ic8.test.ts` + `memory-run-supervisor-ic8-*.ts` pin process-group/resource behavior. |
| `runner*.ts` | Reflection run execution: preflight, spawn, supervision, publication, settlement. `ReflectionRunner` / `SenpiSubprocessRunnerOptions` / `ExecutionResult` ports are injectable for tests. |
| `spawn.ts` / `spawn-supervisor.ts` / `spawn-payload.ts` / `reflection-spawn-input.ts` | Spawn contracts (`ReflectionSpawnArgs`, `FactsSpawnArgs`, sandbox prep, env/path contracts and cleanup). `spawn.ts` is a thin re-export surface consumed by memory wiring and tests. |
| `create-run-worktree.ts` | Isolated git worktree per reflection run. |
| `run-artifacts.ts` | Atomic JSON/text/ledger writes: temp+rename, mode 0600. `writeRunJsonAtomic` / `readRunJson` / `updateRunLedger` are the most-imported symbols here. |
| `run-finalization*.ts` | Terminal-state machine: claim (`-claim.ts`), gate/settlement (`-settlement.ts`), git decision (`-git.ts`), types. Matching published outcomes win races; abandoned runs are never published; inactive runs must not complete. |
| `run-reconciliation.ts` | Startup scan: run directories, process liveness, sentinel waiting, state repair. |
| `run-liveness.ts` / `run-sentinel.ts` | Liveness probes and sentinel waits; the sentinel basename never fires on the relevant watcher path, so waiting degrades to a bounded timeout. |
| `resolve-model.ts` / `model-miss.ts` / `model-preflight.ts` / `model-cost.ts` / `fork-cost.ts` / `registry-fallback.ts` / `memory-launch-preflight.ts` | Model ladder: ordered candidates with cost-aware routing (`chooseMemoryLaunchRoute`), session/thinking inheritance, preflight caching, retry classification (`classifyRetryableModelMiss`). |
| `completion*.ts` | Durable completion records (`runtime/reflection/completions/`): record, deliver, render; `REFLECTION_*_ENTRY_TYPE` constants and renderer registration. |
| `health.ts` / `health-alert.ts` | READ-ONLY derived health over completion records (failure streak, fingerprint, last outcome; `senpi-memory.health` entries). A trailing streak whose newest failure is older than `REFLECTION_HEALTH_STALE_MS` (7 days) reports streak 0 so dormant identities stop alerting; historical fields stay intact. |
| `remediation.ts` | Failure-reason -> user-facing hint mapping. |
| `entry-renderers.ts` | Notice-box renderer contract: fields joined with `" · "` (`FIELD_SEPARATOR`), normalized/truncated text, outcome glyph/color/label helpers. |
| `facts-child-launch.ts` | Facts extractor child launch path. |

## Conventions

- Durable state transitions are separated from side effects: claim -> gate -> settle -> reconcile, each behind injectable seams (`now`, process checks, writer locks, reservation ports, subprocess runners).
- Atomic writes everywhere (temp + rename, 0600); tests use `tmpdir()` fixtures with explicit cleanup, real subprocess/filesystem/git seams, and `setDefaultTimeout` for integration cases.
- Races, crash windows, and terminal precedence are pinned by dedicated tests (`run-finalization-race`, `run-finalization-crash`, `run-terminal-precedence*`, `run-reconciliation-handoff`).

## Anti-patterns

- `health.ts` must never write - no transcript entries, no notifications, no nagging from a frozen burst.
- Never hide a pre-spawn resolution cause behind `child-stderr.log`; no child ran in that path.
- Never publish failed-child output into the memory repository; keep the cursor retryable.
- Abandoned runs must never be published; matching published outcomes win races.
- Non-retryable model failures must not consume the model chain. Provider names are assumed `/`-free; model ids may contain `/` (`model-preflight.ts`).

## Commands

```bash
bun test packages/omo-senpi/src/components/memory/worker
tsgo --noEmit -p packages/omo-senpi/tsconfig.json
```
