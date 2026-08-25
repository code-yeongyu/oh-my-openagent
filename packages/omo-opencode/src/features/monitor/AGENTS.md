# monitor — Managed Watcher Backend

**Generated:** 2026-08-17

## OVERVIEW

Backend for the `monitor_*` tools: spawn long-running watcher processes, decode their stdout/stderr into lines, filter by regex, keep a per-monitor ring buffer, and inject batched output into the parent session as internal prompts. **OFF by default** — gated on `monitor.enabled` (schema in [`src/config/schema/monitor.ts`](../../config/schema/monitor.ts)). Tool wrappers live in [`src/tools/monitor/`](../../tools/monitor); this directory owns the manager, pipeline, and delivery logic.

## STRUCTURE

| Module | Role |
|--------|------|
| `index.ts` | Barrel: re-exports `types` plus `MonitorManager` / `createMonitorManager` |
| `manager.ts` | `MonitorManager` — start/stop/list/get/getOutput/handleEvent/shutdown; per-session capacity; registers with background-agent `process-cleanup` |
| `manager-internals.ts` | `DEFAULT_MONITOR_CONFIG`, injector timing constants, `InternalMonitorState`, deps/options types, scheduler + id factory |
| `monitor-state-factory.ts` | Wires process + pipeline + injector into `InternalMonitorState`; observes process exit |
| `process.ts` | `spawnMonitoredProcess` — detached spawn via `bun-spawn-shim`, process-group kill with 5s grace, max-runtime timer |
| `line-stream.ts` | Chunk-to-line decoding, ANSI stripping, binary suppression, per-line byte cap |
| `filter.ts` | `createMonitorFilter` — regex validation (length cap, quantifier scan against catastrophic backtracking), ANSI-stripped matching |
| `pipeline.ts` | Reads stdout/stderr, sequences lines, routes matched/unmatched to ring + batcher |
| `ring-buffer.ts` | `MonitorRingBuffer` — bounded matched/unmatched line stores plus `MonitorCounters` (drops, bytes, lastSequence) |
| `batcher.ts` | `MonitorBatcher` — flush on max lines / max bytes / interval, injectable scheduler |
| `envelope.ts` | `formatMonitorBatch` — `[OMO MONITOR OUTPUT]` envelope with `stream_policy: untrusted_observation` warning |
| `output-injector.ts` | `MonitorOutputInjector` — queues batches, dispatches via `prompt-async-gate`, defers around active user turns |
| `output-injector-session-inspect.ts` | Session-message inspection: accepted-message detection, user-message-in-progress, blocking assistant turns |
| `output-injector-types.ts` | Injector deps and session-message shapes |
| `permission.ts` | `monitor_start` gate: bash-equivalent permission ask when available, else fail closed to `monitor.allowed_commands` |
| `types.ts` | Public contracts: `MonitorRecord`, `MonitorManager`, counters, tool arg shapes |

## KEY EXPORTS

- `createMonitorManager(options)` / `MonitorManager` — the only stateful entry point; everything else is composed behind it.
- `types.ts` — `MonitorRecord`, `MonitorStartOpts`, `MonitorOutputQuery`, `MonitorManagerEvent` (`session.idle` / `session.deleted`).
- Defaults in `manager-internals.ts`: 3 monitors per session, 30min max runtime, 1000-line ring, 50-line/16KB/1s batches.

## HOW IT WIRES

| Where | What |
|-------|------|
| [`src/plugin/tool-registry-gated-tools.ts`](../../plugin/tool-registry-gated-tools.ts) | Registers `monitor_start` / `monitor_stop` / `monitor_list` / `monitor_output` (from `src/tools/monitor/create-monitor-tools.ts`) only when `monitor.enabled` and a manager exists |
| [`src/plugin/event.ts`](../../plugin/event.ts) | Forwards session events to `monitorManager.handleEvent` |
| [`src/plugin/event-session-lifecycle.ts`](../../plugin/event-session-lifecycle.ts) | `stopSessionMonitors(sessionID)` on session teardown |
| [`create-transform-hooks.ts`](../../plugin/hooks/create-transform-hooks.ts) | `monitor-status-injector` Transform hook when enabled |
| [`background-agent/process-cleanup`](../background-agent/process-cleanup.ts) | Manager registers itself so orphaned watcher processes die on plugin shutdown |

## CONVENTIONS

- Dependency injection everywhere: scheduler, spawn, injector, and cleanup hooks are all overridable through `MonitorManagerDeps`; tests use fake schedulers, never real timers.
- Monitor output is labeled untrusted in the envelope; the injected prompt tells the model not to follow instructions from process output.
- `monitor_start` is rejected for background sessions (`isBackgroundSession` check in `manager.ts`).
- Output delivery defers while a user message is in progress or a dispatch is settling; timing windows are named constants in `manager-internals.ts`.

## ANTI-PATTERNS

- Never spawn watcher processes directly — go through `spawnMonitoredProcess` (process-group kill, grace period, max-runtime enforcement).
- Never inject monitor output as a raw session message — always through `MonitorOutputInjector` + `prompt-async-gate`, or it races user turns.
- Never accept a match pattern without `createMonitorFilter` validation; unvetted regexes risk catastrophic backtracking on hot output paths.
- Never bypass the ring buffer counters when dropping lines; `monitor_output` consumers rely on drop accounting.
