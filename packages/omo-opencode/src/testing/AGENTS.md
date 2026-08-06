# src/testing/ — Plugin Module Factory + Test Infrastructure

**Generated:** 2026-07-03

## OVERVIEW

Naming gotcha: despite the directory name, this is PRODUCTION init code. `create-plugin-module.ts` hosts `createPluginModule()` whose inner `serverPlugin` runs the real staged plugin init (installAgentSortShim → initConfigContext → … → dispose; full sequence documented in root AGENTS.md INITIALIZATION FLOW). `src/index.ts`, the build entry, is a thin re-export of `createPluginModule()`. It lives here because the factory takes a `Partial<PluginModuleDeps>` overrides bag (~30 injectable dependencies), letting tests swap any init stage without `mock.module()`. The other resident, `module-mock-lifecycle.ts`, is the repo-wide `bun:test` mock hygiene layer preloaded by root `test-setup.ts`. No barrel `index.ts`; consumers import file paths directly.

## KEY FILES

| File | Role |
|------|------|
| `create-plugin-module.ts` | `createPluginModule(overrides)` → `PluginModule { id: "oh-my-openagent", server }`. Real init sequence + `PluginModuleDeps` DI record (defaults bound to the real implementations) |
| `module-mock-lifecycle.ts` | Wraps `mock.module`/`mock.restore`: snapshots original exports per resolved specifier, tracks active mocks per owning test file, restores/replays on `mock.restore()`. Exports `installModuleMockLifecycle()` (called from root `test-setup.ts`) + `preserveModuleMocksForTestFile()`/`restoreModuleMocksForTestFile()` global hooks |
| `create-plugin-module.test.ts` | DI-based init tests: i18n locale, server auth injection, runtime security-skill source (enabled/disabled), duplicate-plugin early exit |
| `create-plugin-module-live-route.test.ts` | Live-server-route wiring: `initLiveServerRoute` args, `warmLiveServerProbe` fire-and-forget (never-resolving probe must not block init), `experimental.disable_live_parent_wake_routing` flag, duplicate-plugin skip |
| `module-mock-lifecycle.test.ts` | Lifecycle behavior: snapshot/restore ordering, per-file ownership, Windows stack-path normalization (`getCallerUrlFromStack`, `normalizeStackPath`) |

## WHAT IS WIRED ONLY HERE (not in plugin-interface.ts)

- `experimental.session.compacting` + `experimental.compaction.autocontinue` — the 2 hook handlers beyond the 12 in `src/plugin-interface.ts`, built via `createSessionCompactingHandler(hooks)` / `createCompactionAutocontinueHandler(hooks)` from `src/plugin/session-compacting`.
- `dispose` — stops the runtime skill-source server, then `createPluginDispose()` (backgroundManager shutdown + skillMcpManager disconnect + disposeHooks).
- `recordPluginTelemetry({ configEnabled })` — try/catch-wrapped PostHog call right after `loadPluginConfig()`.
- `ensureTuiPluginEntry()` — tui.json self-heal unless `tui.sidebar.enabled === false`.
- `initLiveServerRoute` / `setLiveParentWakeRoutingDisabled` / `warmLiveServerProbe` — live-listener wake routing (`src/shared/live-server-route`); disable via `experimental.disable_live_parent_wake_routing`.
- Duplicate-plugin guard: `detectDuplicateOmoPlugin()` detected → warn + return `{}` (plugin no-ops).
- Team-mode init via dynamic imports (`checkTeamModeDependencies` + `ensureBaseDirs`), warn-only on failure.
- `disabled_hooks` → `isHookEnabled`; `experimental.safe_hook_creation` defaults true.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Change plugin init order / add an init stage | `serverPlugin` in `create-plugin-module.ts`; keep root AGENTS.md INITIALIZATION FLOW in sync |
| Test an init stage without module mocks | Pass the stage's key in `createPluginModule({ ...overrides })`; see both `create-plugin-module*.test.ts` |
| Add a new injectable init dependency | Extend `PluginModuleDeps` + `defaultPluginModuleDeps` in lockstep |
| `mock.module()` leaking across test files | `module-mock-lifecycle.ts`; audit enforced by `src/shared/mock-module-lifecycle-audit.test.ts` |
| Compaction handlers' logic (not wiring) | `src/plugin/session-compacting.ts` |

## NOTES

- The `PluginModuleDeps` overrides bag is the sanctioned way to unit-test init; the zauc-mocks sort-order hack is for modules without DI seams.
- `module-mock-lifecycle.ts` preserve semantics: mocks owned by `zauc-mocks-*`-style long-lived owners survive `test-setup.ts`-driven restores via `preserveModuleMocksForTestFile()`; everything else is rolled back to the snapshotted original exports.
- Caller attribution uses stack parsing (`getCallerUrlFromStack`), skipping frames from `test-setup.ts` and this file; Windows drive paths are normalized to `file://` URLs.
