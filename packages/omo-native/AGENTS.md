# packages/omo-native

**Role:** Adapter - distribution package for the senpi-based omo native edition.

Publishes npm package `omo-ai` (bin `omo`) on the BETA channel only. The launcher in `bin/` spawns the
exact-pinned `@code-yeongyu/senpi` CLI with `--extension <pkgRoot>/plugin`, where `plugin/` is the staged
omo-senpi plugin payload produced by `bun run build:omo-native` (gitignored, never committed).

- `bin/omo.js` - launcher entry (dispatch, doctor, setup, senpi passthrough)
- brand: the launcher injects a `SENPI_BRAND` profile (name, `~/.omo/agent` home, `OMO_*` env prefix, wire identity, omo-ai beta update channel) so the pinned engine presents as omo; `--version` and every self-update spelling are answered by the launcher. See `docs/reference/omo-ai-publishing.md`.
- `bin/lib/` - launcher modules:
  - `launcher.js` — `runLauncher()` dispatch, senpi environment/brand/update routing
  - `agent-dir.js` — `canonicalAgentDir()`, `adoptLegacyFlatState()`, legacy flat-dir migration
  - `setup-detect.js` / `setup-import.js` / `setup-models.js` / `setup-report.js` — harness detection, SQLite read-only import, provider mapping, report rendering
  - `setup-detect-cache.js` / `setup-detect-refresh.js` — the interactive launch's setup-suggestion cache: a
    synchronous, fail-open read of `harness-detect-cache.json` in the canonical agent dir, fingerprinted over
    every detection input (`detectedFilePaths`, mtime+size) with a TTL; a stale or missing cache never blocks
    the engine spawn - it is rebuilt by a detached, unref'd refresh child (`setup-detect-refresh.js`, the only
    writer) while the launch answers from the cached or empty value. `omo setup` and `omo doctor` always run
    full live detection and never read the cache.
  - `bun-runtime.js` / `child-process.js` — `maybeReexecUnderBun`, `findBunBinary`, `probeBunVersion`,
    `spawnNode`/`runChild`. Runtime policy: a machine with bun runs omo on bun, no config needed - a
    bun-global install trusts the bun that installed it, every other install (npm, project-local,
    bunx) probes the discovered bun once per node boot and hands over when it is >= `BUN_MIN_VERSION`
    (1.4.0); `OMO_RUNTIME=node` always stays on node, `OMO_RUNTIME=bun` always re-execs (no floor).
    Both spawn layers are ASYNC on purpose: `spawnSync` blocks the event loop, so a signaled launcher
    dies before any handler runs and orphans the engine. `runChild` forwards `SIGTERM`/`SIGHUP` to the
    child, waits out a bounded grace window (`OMO_SIGNAL_GRACE_MS`, default 10s) and re-raises the
    signal on itself if the child ignores it; `SIGINT` is never forwarded (the tty already delivers it
    to the whole foreground process group) but is still waited out. Never reintroduce `spawnSync` here.
  - `bun-bin-shim.js` — `ensureBunBinShim`: keeps the user-facing bun-global bin an sh shim that
    execs bun directly (POSIX only, self-healing across `bun add -g` updates, fail-open)
  - `doctor.js` — diagnostics plus stale-orphan detection: `classifyEngineProcesses` splits live
    engines into stale (interactive, PPID 1), attached and managed (`--mode`), and
    `reapStaleEngines` terminates ONLY explicitly named pids that are still stale at request time.
    Pattern-killing is forbidden.
  - `package-paths.js`, `provider-map.json`, `legacy-bun-global-migration.js`
- **agent state lives in ONE canonical directory: `~/.omo/agent`.** `bin/lib/agent-dir.js` owns that answer (`canonicalAgentDir`), and the launcher, `omo doctor`, `omo setup` and the locally installed launcher (`packages/omo-senpi/src/install/local-launcher.ts`) all resolve it from there - never by composing their own default. An explicit `OMO_CODING_AGENT_DIR` (or legacy `SENPI_CODING_AGENT_DIR` / `PI_CODING_AGENT_DIR`) still wins, and `adoptLegacyFlatState` carries state left in the pre-unification flat `~/.omo` layout forward once, so unifying the location never reads as another reset.
- `bin/omo-agent-toolkit.js` - internal delegate to the staged toolkit runtime, NOT an npm bin
- `test/` - package-contract and launcher tests; `pty-signal-qa.py` is the real-surface QA harness
  (boots the real chain on a pty whose session leader outlives the launcher, SIGTERMs the launcher,
  asserts the engine ran its own graceful shutdown and left no survivor)

## CONVENTIONS

- ESM (`"type": "module"`); local JS imports use explicit `.js` extensions; Node built-ins via `node:` prefix.
- Runtime requires Node >= 24; tests run under Bun.
- Paths derive from `import.meta.url` + the agent-dir helpers — never recompose home-directory defaults elsewhere.
- Setup is plan/classify/consent/write oriented; SQLite stores are read-only inputs.

## COMMANDS

```bash
bun run build:omo-native                 # stage plugin payload (repo root)
bun test packages/omo-native/test        # package tests (repo root)
bunx tsc -p packages/omo-native/tsconfig.json --noEmit
node packages/omo-native/bin/omo.js --version   # entry smoke check
python3 packages/omo-native/test/pty-signal-qa.py packages/omo-native/bin/omo.js /tmp/qa.txt   # launcher signal QA (bun chain wherever bun is installed; OMO_RUNTIME=node for the node chain)
```

Release mechanics and the beta-channel contract: `docs/reference/omo-ai-publishing.md`.
