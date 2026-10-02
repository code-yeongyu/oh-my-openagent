# packages/omo-native

**Role:** Adapter - distribution package for the senpi-based omo native edition.

Publishes npm package `omo-ai` (bin `omo`) on the channel its version names: a prerelease on `beta`, a stable release on `latest`. The launcher in `bin/` runs the
exact-pinned `@code-yeongyu/senpi` CLI with `--extension <pkgRoot>/plugin`, where `plugin/` is the staged
omo-senpi plugin payload produced by `bun run build:omo-native` (gitignored, never committed).

- `bin/omo.js` - launcher entry (dispatch, doctor, setup, senpi passthrough)
- brand: the launcher injects a `SENPI_BRAND` profile (name, `~/.omo/agent` home, `OMO_*` env prefix, wire identity, omo-ai update channel of the running version) so the pinned engine presents as omo; `--version` and every self-update spelling are answered by the launcher. See `docs/reference/omo-ai-publishing.md`.
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
    POSIX handoffs use `execve` with argv[0], preserving the PID, args and environment without a
    resident wrapper. Windows, missing execve and thrown execve retain async `runChild`. The fallback forwards `SIGTERM`/`SIGHUP`, waits up to
    `OMO_SIGNAL_GRACE_MS` (default 10s), then re-raises an ignored signal. It waits for `SIGINT`
    without forwarding it twice. Never use `spawnSync` for these long-lived handoffs.
  - `bun-bin-shim.js` — `ensureBunBinShim`: keeps the user-facing bun-global bin an sh shim that
    execs bun directly (POSIX only, fail-open). Every launch repairs it, under node or bun, and so
    does postinstall (`bin/senpi-patch.mjs`), which bun runs on itself right after `bun add -g`
    relinks the bin when node is not on PATH (#9293)
  - `doctor.js` — diagnostics plus stale-orphan detection: `classifyEngineProcesses` splits live
    engines into stale (interactive, PPID 1), attached and managed (`--mode`), and
    `reapStaleEngines` terminates ONLY explicitly named pids that are still stale at request time.
    Pattern-killing is forbidden.
  - `engine-prepare.js` / `claude-code-floor.js` - the installed-engine preparation (Claude Code UA floor, compile-safe css-tree data, RPC stream guard). postinstall (`bin/senpi-patch.mjs`) runs it and stamps the engine tree with `.omo-engine-prepared` (the omo-ai package version); the launcher runs `ensureEnginePrepared` before every engine start so an install whose scripts never ran (`ignore-scripts=true`, Bun's blocked postinstalls) is prepared on first launch (#8713). A failure warns with the reinstall command and never blocks the launch.
  - `launch-spec-mode.js` - `normalizeLaunchSpecMode` strips group/world write bits from `plugin/daemon-launch-spec.json` (regular file owned by this user only, `lstat`, never through a symlink; no-op on win32) because npm/bun extraction applies the installer's umask and the task host refuses a writable spec (#9208). `engine-prepare.js` `preparePluginLaunchSpec` runs it fail-open on every launch (`preparedSenpi()`, before `omo doctor`) and in postinstall; `launchSpecDoctorLines` gives `omo doctor` (npm and compiled) a FAIL line with the fix when the host would still refuse the spec.
  - `rpc-stream-errors.js` - postinstall/launch preparation of the installed engine's stdio RPC serializer. A malformed streamed event produces a failed `prompt` response with `errorCode: invalid_stream_event` and shuts down with exit 1. The same preparation runs after an omob engine swap; repeated preparation is idempotent, and a missing RPC target, missing required binding (including `shutdown`), or unsupported serializer shape fails installation rather than silently missing the guard. Binding checks also run on already-prepared code.
  - `category-coverage.js` - the task-category coverage lines of doctor and the setup summary: the pinned engine's
    offline ModelRuntime (read-only auth.json, models.json, env keys; nothing written) classified by the senpi-task
    resolver through `plugin/runtime/category-coverage/index.js`, which `build:omo-native` bundles from
    `category-coverage-entry.ts`. Fail-open: any error prints no line and omits the row.
  - `config-doctor.js` - doctor's `WARN config: <file>: <key> ignored (...)` lines, one per key the omo.json loader dropped and one per file it did not load, from `configDoctorLines` (`config-doctor-runtime.ts`) through the same staged runtime bundle; the compiled entry imports it directly. A runtime that cannot load prints `WARN config: diagnostics unavailable: <reason>`.
  - `gateway.js` - the hook for a separately installed chat-surface gateway: `omo gateway ...` and the doctor gateway rows import `@oh-my-opencode/omo-gateway/host` by name from omo's own install, lazily (only for `omo gateway`, or for doctor when the user config has a `gateway` section), check its `HOST_CONTRACT_VERSION`, and hand it argv, stdio, env, cwd, the agent dir, home, the relaunch argv, `pluginRoot` (`<packageRoot>/plugin`) and `threadSdkUrl` (the `file:` URL of `<pluginRoot>/runtime/thread-sdk/sdk.js`; the doctor call gets the last two as well). omo ships no gateway code; the package validates its own section, and omo-config-core keeps only a permissive `gateway` key.
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

## omo daemon

`bin/lib/daemon.js`: `omo daemon run|adopt|status|stop [--drain] [--all [--wait [--timeout <s>]]]|handoff|gc [--prune-store-index]|rollback-prepare`, a thin wrapper over the engine's `senpi host`. `run` maps to the engine's `ensure` of the operator daemon on `rpc.sock` (there is no `attach`: a terminal never joins a host, and `adopt` moves a host session into a terminal instead); `status`, `gc`, `handoff`, `stop --all` and `rollback-prepare` cover every endpoint (the operator daemon, each session's `p-*` task host, each Desktop `i-*` thread host) through `daemon-operations.js`, `daemon-status.js` and `daemon-rollback.js`. `--foreground` on any subcommand exits 2 before the engine is called (after the unknown-subcommand check and the win32 refusal, which exits 4), because the engine host always detaches; `--persistent` is accepted and ignored. Exit codes 2/3/4/5 live in `daemon-args.js` with the flag sets and argv helpers; the `omo doctor` lines come from `daemon-doctor-report.js`. The compiled entry re-runs ITSELF with `host ...` to reach the engine (process.execPath is omo there). Reference: `docs/reference/omo-daemon.md`.

Terminal (`endpoint_kind: "tui"`) rows: `daemon-status.js` renders them `tui <name> pid <n> cwd <path>` and counts them in `aggregate.terminals`, never as live hosts; `daemon-operations.js` `operable()` keeps every lifecycle command (handoff, `stop --all`, its wait) off them, and handoff prints them skipped. `gc` stays the plain `host gc`, which already reaps a dead terminal by evidence (senpi has no `--kinds` CLI option). `omo daemon adopt <session> [--interrupt] [--force] [--json]` (`daemon-adopt.js`): locate through the thread SDK (alive on an `rpc_host` endpoint), senpi `release_session`, refusal -> exit 4 (`turn_active`, `attached`, `session_busy`, ..., "already a terminal session"), 3 (not found, not served, `unknown_session`), 5 (`release_failed` twice); `release_failed` then `unknown_session` counts as released. The launcher then runs the interactive launch on `--session <path> [-- <dropped user messages>]` in the session's cwd (the `{ launch, cwd }` outcome); blank messages are dropped. Everything after `--` is message text: the compiled entry's argv scans (`compile-args.ts` `launchOptions`, used by `buildSenpiArgs`, the banner gate and `isInternalSupervisorLaunch`) read only the options before it, so a replayed `--no-extensions` cannot start the adopted session without the plugin.

## omo thread

`bin/lib/thread.js` (+ `thread-args.js` parser and `THREAD_EXIT`, `thread-output.js` human lines): `omo thread list|create|models|set-model|set-reasoning|send|read|bind|unbind|rebind|bindings|report|answer|outbox|ack [--json]`, a thin wrapper over the plugin's thread SDK (`plugin/runtime/thread-sdk/sdk.js`, omo-senpi `components/thread/sdk.ts`) run as `cli:<uid>`; it never starts a host, and endpoints are enumerated through the same engine call `omo daemon status` makes. `node:sqlite` is probed with a lazy import before the SDK loads (a runtime without it exits 4; `sqlite-import-discipline.test.ts` covers the file). An absent flag reaches the SDK as an `undefined` field, which every SDK method reads as absent. `--mode`/`--direction` values outside their sets and an empty `send` text are usage errors, and with `--json` every CLI-side failure (usage, win32, no `node:sqlite`) still prints one error JSON value. `answer` requires `--binding` (never inferred); `send --binding` is the connector inbound path, with `--mode auto|follow_up` (capped by the binding) and `--author-id`/`--author-name`/`--author-user-id` (also on `answer`; only with `--binding`). Exit codes: 0 ok, 1 refused as data, 2 usage, 3 `host_unavailable`, 4 win32 or no `node:sqlite`, 5 `internal_error`. The `--json` shapes are a contract: `docs/reference/omo-thread.md`.

`bin/lib/host-status.js`: `omo host status --all` (launcher and compiled entry) is the engine's inventory with `last_activity_at` added to each `tui` row (the plugin thread SDK's `readSessionFacts(owner.session.path).updated_at`, else `null`); the compiled entry marks its self re-run with `OMO_HOST_STATUS_RAW=1` so the engine call is not enriched again. Reference: `docs/reference/omo-daemon.md`.
