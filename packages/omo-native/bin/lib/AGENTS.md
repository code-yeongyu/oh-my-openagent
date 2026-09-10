# bin/lib

## OVERVIEW
Implementation modules behind the launcher: runtime selection, child-process handling, agent state, harness setup, diagnostics, and package path resolution. Parent covers policy; this file covers what is specific to these modules.

## WHERE TO LOOK

| Area | Files | Notes |
|------|-------|-------|
| Agent state | `agent-dir.js` | Canonical directory, env overrides, and the one-time legacy flat-state adoption with its marker file. |
| Runtime and process | `bun-runtime.js`, `child-process.js` | Bun discovery/probe/re-exec decisions, async child lifecycle, signal handling, exit propagation. |
| Launcher wiring | `launcher.js`, `package-paths.js` | Command dispatch, brand profile, engine resolution, and module-relative package paths. |
| Setup | `setup-detect.js`, `setup-detect-cache.js`, `setup-detect-refresh.js`, `setup-import.js`, `setup-models.js`, `setup-report.js` | Live detection, cached launch hint, credential import, provider mapping, reporting. |
| Credential mapping | `provider-map.json` | Builtin ids, excluded hosted gateway ids, and legacy-to-target provider mapping used by the import. |
| Diagnostics | `doctor.js` | Engine classification (stale/attached/managed), retired-payload detection, explicit pid reaping. |
| Small boundaries | `bun-bin-shim.js`, `legacy-bun-global-migration.js`, `sqlite-rows.js` | Bun-global shim upkeep, manifest migration, statement-free SQLite reads. |

## CONVENTIONS

- Behavior that touches process, env, home, spawn, or clock takes an injectable options bag, so every module here is testable without reaching the real machine.
- Credential import is read-only at the source and consent-gated at the destination: OAuth entries are reported and never copied, unmapped providers are skipped, and the target file is backed up then written via a private-mode temp file and rename.
- SQLite reads deliberately avoid prepared statements; a statement-free read is what lets the database handle close cleanly and keeps Windows teardown from failing on a locked file.
- The interactive launch hint is answered from a fingerprinted, TTL-bounded cache; only the detached refresh child writes it, while `setup` and `doctor` always run live detection.
- Advisory helpers fail open: a missing or corrupt cache, an unavailable process listing, or a failed shim repair degrades to a neutral answer instead of blocking a launch.

## ANTI-PATTERNS

- Never reintroduce synchronous spawning in these spawn layers; a blocked event loop turns a signaled launcher into an orphaned engine.
- Never terminate engine processes by pattern or heuristic; only explicitly named pids that are still orphaned interactive engines at request time may be signaled.
- Never write to an imported harness store, and never import a credential without the accept-list check and user consent.
- Do not recompose the agent directory default in another module or resurrect the legacy flat layout beyond the one-time adoption.
- Do not let diagnostics, cache reads, or shim maintenance throw into the launch path.
