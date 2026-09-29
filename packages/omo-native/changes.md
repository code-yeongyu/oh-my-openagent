## 2026-10-01 - The gateway hook's integrity check and its tests agree on Windows paths (follow-up to #9243)

`verifyGatewayPackage` (`bin/lib/gateway.js`) resolves the package directory and its host entry with
`realpathSync.native` instead of `realpathSync`. On Windows, `realpathSync` can keep an 8.3 short name
(`C:\Users\RUNNER~1\...`) while the module loader hands back the long name for the same directory. That made the
two sides of the containment check spell one directory two ways, which can falsely refuse a valid install reached
through a short path. `.native` returns the canonical long name on both sides, and on POSIX it changes nothing. The test
fixtures (`test/gateway.test-support.ts`) create their temp roots with `realpathSync.native` too, so the paths they
expect match what the hook reports. That fixes the eight Windows-only failures in `test/gateway.test.ts` and
`test/gateway-integrity.test.ts` on dev.

## 2026-10-01 - A `bun add -g` update leaves an `omo` that starts without node (#9293)

`bun add -g omo-ai` links `<bun root>/bin/omo` (and `install/global/node_modules/.bin/omo`) back to `bin/omo.js`,
whose `#!/usr/bin/env node` cannot start where node is not on PATH: a launchd job, cron, a bun-only machine, or node
only through nvm. The bun launcher shim that avoids node was only written back by a launch under node, so on such a
machine `omo` failed with `env: node: No such file or directory` (exit 127) after every update and could not repair
itself. `ensureBunBinShim` (`bin/lib/bun-bin-shim.js`) no longer skips when it runs on bun, and postinstall
(`bin/senpi-patch.mjs`) calls it first, before the engine preparation. Bun links the bin and then runs a trusted
postinstall, on bun itself when node is missing, so the shim is back before anything launches `omo`. A launch on bun
(`bun .../bin/omo.js`, the shim itself) also repairs a stock link it finds, at the cost of the same lstat and small
read a node launch already pays. Outside a POSIX bun-global install the call is the same no-op as at launch. A blocked
(untrusted) postinstall still leaves the stock link until the next launch under node or bun.

## 2026-09-30 - `omo daemon attach` is removed with the engine's shared-host join (#9143)

senpi 2026.9.29-4 removed the interactive shared-host join, so the environment `omo daemon attach` printed (`OMO_ENABLE_SHARED_HOST=1` plus `OMO_RPC_SOCKET`) and its `attach <launch args>` passthrough no longer put a terminal on a host. `attach` is gone from `daemon.js` (subcommand set, usage, engine mapping, `attachEnv`), from `daemon-args.js` (`attachLaunchArgs` and the flag sets only it read) and from the launcher's passthrough branch; `omo daemon attach` now exits 2 with the unknown-subcommand usage on stderr, prints nothing on stdout and never calls the engine. `omo daemon run` still ensures the operator daemon on `rpc.sock`, and `status`, `stop`, `handoff`, `gc` and `rollback-prepare` are unchanged. `docs/reference/omo-daemon.md` and the package AGENTS.md drop the attach rows, and the dependency-audit sandbox stops setting the two shared-host variables. `test/daemon.test.ts` replaces the four attach cases with one that pins the usage exit, the empty stdout and the untouched engine.

## 2026-09-30 - Eval release smoke covers every executable target (#9291, follow-up to #9250)

### What changed

The packaged-binary RPC smoke now verifies JavaScript and Python arithmetic, cell listing,
and exactly one real file read through the before/after tool hooks. Its fixture contains a
random marker; execution runs while the source checkout is renamed, then shuts down the
isolated task hosts and checks for surviving processes and sockets. The release workflow
executes it on nine native targets, provisioning Python, Node and process tools inside each
of the three Alpine musl legs. Seven legs smoke before upload; the linux-arm64 and
linux-arm64-musl smokes run after build in parallel with the npm platform publish and fail
the reusable workflow result. Cross-compiled Darwin x64 and Windows arm64 retain digest/manifest
coverage. Twelve platform manifests are compared against the derived codemode sidecar set.
Every wasm in the runtime closure also has a required file entry. The build-only
`OMO_SIDECAR_EXCLUDE` fixture permits a missing-package RED smoke without a dependency list.

### Why

#9250 restored eval registration but tested only one JavaScript cell on Darwin arm64.
It could not detect a broken Python bridge, host tool pipeline, missing target assets,
or a release leg bypassing the smoke.

### Why an extension could not handle it

These checks exercise the compiled payload inside the release workflow. An extension
cannot repair an asset absent from that payload or enforce a gate on another release leg.

### Expected merge conflict zones

The engine-sidecar resolver, binary staging fixture, and release smoke workflow.

## 2026-09-30 - The gateway host receives omo's plugin root and the thread SDK URL (#9243)

`runGatewayCommand` and the doctor call into the installed gateway now also pass `pluginRoot`, omo's staged plugin
payload (`<packageRoot>/plugin`, from `package-paths.js` as doctor resolves it), and `threadSdkUrl`, the `file:` URL of
`<pluginRoot>/runtime/thread-sdk/sdk.js`, so the gateway neither derives the install from `argv[1]` nor knows the
payload layout. Both come from the hook's own module URL, so a symlinked install hands over the real install's paths.
The SDK file ships with the thread SDK (#9222); until then the URL names a file that does not exist yet, and omo does
not check it, so `omo gateway` behaves as before. `test/gateway.test.ts` covers the command (plain and symlinked
install) and the doctor call; each case fails with its field removed.

## 2026-09-30 - The gateway hook verifies the installed package before importing it (#9243)

Before `bin/lib/gateway.js` imports `@oh-my-opencode/omo-gateway/host`, `verifyGatewayPackage` finds the package's
`package.json` on the same resolver search paths the import walks and refuses the package, as `broken` with a reason that
names its directory, unless the manifest `name` is exactly `@oh-my-opencode/omo-gateway`, it declares
`omoGateway.hostContract` equal to 1 (the runtime `HOST_CONTRACT_VERSION` check stays), and the host entry the import
resolves stays inside the package directory once symlinks are resolved on both sides. A refused package never runs:
`omo gateway` prints the reason and exits 1, the doctor gateway row is `FAIL`. No package directory is still `missing`, and
nothing changes for an install without the package. `test/gateway-integrity.test.ts` (5 cases) covers a foreign name, a
missing and a mismatched manifest contract, a host entry symlinked out of the package, and a verified package reached
through a symlinked package directory; each fails with its check removed.

## 2026-09-30 - `omo gateway` and the doctor gateway rows load a separately installed gateway package (#9243)

`bin/lib/gateway.js` is a hook, not a gateway: `omo gateway <args>` imports `@oh-my-opencode/omo-gateway/host` by bare
name from omo's own install (the resolution the gateway itself uses for adapter packages), checks its
`HOST_CONTRACT_VERSION` (1), and calls its `runGatewayCommand` with argv, stdio, env, cwd, the canonical agent dir,
home and the argv that relaunches `omo gateway connect`. Without the package it prints one line, `omo gateway: the omo
gateway is not installed: ...`, and exits 1; a package that fails to load or speaks another contract is named as
such and also exits 1. `omo doctor` adds gateway rows only when the user config (`~/.omo/omo.jsonc` or `omo.json`) sets
`gateway` at its top level or in `[native]`: one `WARN gateway:` row when the package is missing, `FAIL gateway:` when
it is broken, otherwise `PASS gateway: installed` followed by the package's own rows, and a package `FAIL` row fails
doctor. Without a `gateway` section nothing is imported and doctor output is unchanged. The launcher imports the hook
lazily, so the startup path does not load it. `omo-config-core` accepts `gateway` as an open object in the root, layer
and harness-block schemas so a config carrying it loads without an unknown-key diagnostic; omo never reads it.
`test/gateway.test.ts` (9 cases) drives a packaged copy of `bin/` with and without a fixture package installed beside it;
`omo-config-core` `src/schema/gateway.test.ts` (3 cases) fails on dev.

## 2026-09-30 - The compiled binary hands a downloaded Claude Code to the engine at startup (#9276)

`compile-entry.ts` calls `applyCachedClaudeCode` (omo-senpi `claude-code/index.ts`) right after
`remapSenpiEnvironment`, so a Claude Code downloaded in an earlier session reaches the engine through
`CLAUDE_CODE_EXECUTABLE` before its startup availability probe, every turn's auth check, and task children. An explicit
`CLAUDE_CODE_EXECUTABLE` or `claude` on PATH still wins, and nothing happens before the first download.

## 2026-09-30 - The standalone binary downloads Claude Code on the first anthropic-subscription turn (#9262)

A release binary embeds no Claude Code executable, because the platform package's `claude` alone (226 MB on
darwin-arm64) exceeds the 150 MB binary budget. With no `claude` on PATH, every anthropic-subscription turn failed with
`Claude Code executable not found`, while an npm install gets it from the SDK's optional platform package. The build now
stages `claude-code-pin.json` (`script/claude-code-pin.ts`): the platform package the engine's claude-agent-sdk pins,
and its sha512 integrity from `bun.lock`. The new omo-senpi `claude-code` component reads that pin beside the
provisioned runtime. On the first turn whose model is anthropic-subscription, it downloads that exact tarball
(`acquire.ts`), checks the integrity, extracts only the executable into
`<runtime>/claude-code/<package>/<version>/` with an atomic rename, and hands it to the engine through
`CLAUDE_CODE_EXECUTABLE` before the turn starts. A notice is shown while it downloads. With no network, the error names
the alternatives. An explicit `CLAUDE_CODE_EXECUTABLE` or `claude` on PATH wins and nothing is downloaded. An npm
install has no pin, so the component does nothing there. `omo doctor` on the binary reports the executable
(`claude-code-doctor.ts`): present, on PATH, overridden, or not downloaded yet.

## 2026-09-30 - The standalone binary reports and reaps its own stale engines (#9252 follow-up)

`omo doctor --reap <pid>` on the standalone binary printed the regular report and reaped nothing, because the compiled
doctor never read its arguments. The stale-engine report could not see a binary engine either: `ENGINE_MARKERS` in
`bin/lib/doctor.js` match only the npm engine paths, and a binary engine runs as
`~/.omo/binary-runtime/<version>/omo`. `isEngine` now also accepts that executable when it runs a session: a bare
launch or engine flags. The same executable serving omo's own commands (`doctor`, `setup`, `daemon`, `host`, ...),
its internal hosts (`--internal-*`) or a bundled script (the LSP daemon) is never an engine, and `--mode` keeps it
managed. `runCompiledDoctor` takes the doctor arguments and routes `--reap` to `reapStaleEngines`, with the npm
refusals unchanged, and prints `staleEngineReport`.

## 2026-09-30 - standalone binaries stage codemode's external runtime closure and smoke eval (#9248)

### What changed

The release-binary sidecar resolver now reads codemode's own dependency manifest, excludes direct
dependencies already supplied by the senpi engine host, and recursively stages every remaining runtime
dependency under codemode's package-local `node_modules`. The platform release workflow runs a freshly
built Darwin arm64 binary through an isolated local-provider RPC smoke that requires `eval` to register
and return `42`. Every Darwin, Linux and Windows target manifest is checked for the same closure.

### Why

OmO 5.1.3 and 5.1.4 copied the codemode package without `@babel/parser`, so codemode failed during
extension loading and both JavaScript and Python eval disappeared from every standalone binary.

### Why an extension could not handle it

The extension cannot register when its own import graph is incomplete. The dependency closure must be
present in the compiled binary's provisioned runtime before extension loading begins.

### Expected merge conflict zones

`script/engine-sidecar-sources.ts`, the platform release smoke steps, and sidecar manifest tests.

## 2026-09-30 - The Windows release exe runs from its download folder instead of dying on the pi-pty package version (#7485)

A raw `omo-windows-*.exe` launched from an empty folder provisioned `~/.omo/binary-runtime/<version>/` and then
ran the engine in-process, because `shouldReexecAfterProvisioning()` was false on win32 since #7447. `process.execPath`
stayed in the download folder, so every engine lookup beside it failed: the pi-pty loader's `package.json` first, then
the built-in themes and native prebuilds. `OMO_PACKAGE_DIR` (#7487's superseding fix) covers only the lookups that
read it. The new `provisioned-handoff.ts` makes every platform hand a launch off to the provisioned executable when it
is not already that executable: POSIX keeps `execve`, Windows runs it through `runChild` and passes its exit code
through. The child is told it is the provisioned runtime through `OMO_PROVISIONED_HANDOFF` (the path the parent
spawned), so it never provisions or re-execs again even if its own executable identity is misreported, the loop that
made #7445/#7447 turn the handoff off; the marker is removed before the engine starts. While the child runs, the
Windows parent holds `SIGINT` so Ctrl+C does not return the prompt before the child exits. `compile-entry.ts` only
calls `planProvisionedLaunch` and `handOffToProvisionedRuntime`. `test/provisioned-handoff.test.ts` compiles a fixture
that runs the same launch sequence and reads `package.json` beside `process.execPath` like the pi-pty loader, copies it
into an empty download folder with an isolated home, and runs it three times (first launch, already provisioned, the
provisioned exe directly); on the Windows CI shard it failed before this change and passes after it.

## 2026-09-30 - The standalone binary runs the same omo setup import and omo doctor sections as the npm launcher (#9252)

The compiled entry (`compile-entry.ts`) answered `omo setup` with the inventory table only (`printSetupReport`), while
`bin/omo.js` runs `runSetup`: summary, consent and the import. Its hand-kept `runCompiledDoctor` never received the
`Update:` line, the computer-use section (#8939) or the task-category coverage section (#8858). `setup` now dispatches
to `runSetup`. The doctor moved to `compiled-doctor.ts` and prints those three sections plus the settings and memory-identity lines
(`warningsForSettings`, `transientMemoryReport`, now exported from `bin/lib/doctor.js`); a computer-use `FAIL` sets
exit code 1, as on npm. The helpers behind the new lines load their runtime from the npm layout, which the binary does
not have, and they fail open, so wiring them in alone would print nothing. `compiled-diagnostic-runtime.ts` gives them
the provisioned `plugin/runtime/category-coverage/index.js` and the engine modules compiled into the binary (relative
literal imports so bun traces them). `computer-use-doctor.js` accepts `packageRoot` and `version`, and
`setup-import.js` forwards `loadCoverageEngine`. `setup-credentials.js` and `setup-opencode-providers.js` import
`provider-map.json` statically instead of reading it beside the module URL, which the binary cannot serve.
Supersedes #7489, which re-dispatched `setup` on a base whose `setup-import.js` has since been rewritten.

## 2026-09-29 - A umask 002 install no longer breaks every process child and team; a refused launch spec names itself (#9208)

npm and bun extract `plugin/daemon-launch-spec.json` with the installing user's umask, so under `umask 002` (the Ubuntu
default for users with a private group) it lands 0664. The task host refuses a group- or world-writable spec
(`launch_spec_insecure`, unchanged), so every process-mode child and every `team_create` failed. New
`bin/lib/launch-spec-mode.js` `normalizeLaunchSpecMode` removes only the group and world write bits, only from a regular
file owned by the current user, using `lstat` so a symlink is never followed: a link or a file owned by another user is
left as it is, and the host still refuses it. `engine-prepare.js` `preparePluginLaunchSpec` runs it fail-open (a failed
chmod warns with `chmod 644 <path>` and never blocks the launch), and the launcher calls it on every launch through
`preparedSenpi()` and before `omo doctor`, not behind the engine stamp, because reinstalling omo-ai rewrites the plugin
while the engine keeps its stamp. postinstall (`senpi-patch.mjs`) runs it too, for installs whose scripts run. On
Windows it does nothing: the host does not check modes there. The compiled binary needs no normalization, since its
runtime extraction already sets each file to the mode recorded in its manifest (0644 for the spec).
`launchSpecDoctorLines` applies the host's own rule (following symlinks, as the reader does) and `omo doctor`, npm and
compiled, prints `FAIL launch spec: launch_spec_insecure: <path> ...` with `chmod 644 <path>` (or the ownership fix)
and exits 1 when the spec would still be refused.

## 2026-09-29 - `omo update --help` prints usage and an unknown flag is a usage error instead of an update (#9207)

`isSelfUpdate()` routes `update` to the launcher whenever every argument after it is a flag or a self/senpi/omo target,
and `runSelfUpdate()` only knew `--dry-run` and `--print`, so `omo update --help`, `-h` or a mistyped flag such as
`--forse` ran the package-manager install. The routing and a new `updateUsageAnswer()` now live in
`bin/lib/update-args.js`, shared by `launcher.js`, `self-update.js`, `compile-entry.ts` and `compiled-update.ts`.
`--help` / `-h` print the `omo update` usage and exit 0; any other flag besides `--dry-run`, `--print` and the documented
`--self` exits 2 with `omo update: unknown option <flag>` on stderr. Both answers come before the registry lookup, so
nothing is fetched or installed. The compiled binary answers the same way before its GitHub release lookup; that path
only ever prints the replace command, and its `--dry-run` / `--print` output is unchanged. Plain `omo update`,
`--dry-run`, `--print`, `--self` and the self/senpi/omo targets behave as before, and `update --extensions` /
`update --models` still go to the engine. `test/self-update-usage.test.ts` and `test/compiled-update-usage.test.ts`
cover both paths with installer and release-lookup spies; on dev 16 of their 33 cases failed, all of them the help and
unknown-flag cases.

## 2026-09-29 - `omo update` installs the exact published version and fails when the install did not move (#9198)

On a Bun-global install, `omo update` could exit 0 with the old version still installed: `updateTarget()` spawned the
unpinned `bun add -g omo-ai` (or `omo-ai@beta`), and `runSelfUpdate()` counted any manager exit 0 as success, so
`omo 5.1.1 -> 5.1.1` read as an update. `runSelfUpdate()` now reads the running version's channel dist-tag (`latest` or
`beta`) through the same registry lookup `omo doctor` uses for `Latest`, which moved from `doctor.js` into
`bin/lib/npm-dist-tags.js`, and `updateTarget()` takes that version and installs the exact spec for every layout it
handles: `bun add -g omo-ai@<version>` for Bun global and legacy Bun home-root installs, `npm i -g omo-ai@<version>` for
npm. Already on that version, `omo update` says `omo <version> is up to date` and installs nothing. After a manager exit
0 it re-reads the installed version; if it is not the target it prints `omo is still <version>; <target> is published`
with the exact retry command and exits 1. `--dry-run` and `--print` show the pinned command. When the registry cannot be
reached it says it could not confirm the version and runs the unpinned channel spec as before. The `INFO Update:` line
of `omo doctor` and the engine's update hint keep the unpinned channel spec.

## 2026-09-29 - The launch banner and routine launch notices print without Bun's error color (#8442)

`bin/lib/launcher.js` writes the interactive version banner, the `sibling credentials detected` hint and the `carried forward settings from the legacy ~/.omo layout` notice with `process.stderr.write` instead of `console.error`, and `compile-entry.ts` does the same for `compiledBannerLines`. Under Bun, `console.error` wraps every line in ANSI red on a color terminal, so a healthy start looked like a failure. The lines stay on stderr with the same text; real error lines (`could not adopt legacy state`, the `ulw-loop` refusal) keep `console.error`. Measured on a PTY with `FORCE_COLOR=1` and the pinned engine: dev printed `\e[0m\e[31momo (omo-ai 5.1.2)\e[0m`, this change prints `omo (omo-ai 5.1.2)`, and the color-stripped `omo --help` output is byte-identical (228 lines, exit 0). `test/launcher-banner-color.test.ts` fails on dev and passes here. Contributed by @cynkai.

## 2026-09-29 - `omo daemon` reads its settings through the omo config loader (#9192)

`bin/lib/daemon-config.js` resolves `task.host_engine_policy` and `task.host_idle_exit_ms` (the only two keys `omo daemon`
reads) through omo-config-core's `loadOmoConfig` (JSONC, `~/.omo/omo.jsonc` or `~/.omo/omo.json` plus project `.omo`
layers, the same view and precedence the extension's task runner reads), reached from the plain-JS launcher through the new
staged `plugin/runtime/task-config/index.js` bundle (`task-config-entry.ts`, built by `script/build-omo-native.ts` and
required by the payload gate). A value set in the documented file is no longer ignored. `<agentDir>/omo.json` is the
deprecated fallback per key: it supplies a key only when no config layer sets it, and then `omo doctor` prints one
`WARN task.<key>: read from deprecated <path>; ...` line. The advice never changes behavior when followed: a legacy
`"never"` policy is told to pass `--no-upgrade` (the config key accepts only `upgrade|fallback`), every other value to move
to `~/.omo/omo.jsonc`. `--no-upgrade` still wins. A payload without the runtime reads only the legacy file, as before.

## 2026-09-29 - `omo doctor` names the active config dir and flags edits left in ~/.pi/agent (#9173)

`bin/lib/doctor-pi-config.js` adds two kinds of lines to both doctor paths (`bin/lib/doctor.js` and the compiled
`compile-entry.ts`): `INFO config dir: <agent dir>` always, and one `WARN You edited ~/.pi/agent/<file> after omo moved
to <agent dir>; omo reads <agent dir>/<file>. Copy your change there (or run: omo config import-pi <file>).` for each of
`auth.json`, `keybindings.json`, `models.json`, `settings.json` changed in `~/.pi/agent` after the engine copied it and
different from the agent dir's copy. The rule mirrors the engine's startup notice (senpi `src/legacy-pi-edits.ts`): it
reads the `legacyPiAgentDir.copiedAt` the engine records in `migrations-state.json` and, for installs copied before that
record existed, falls back to the agent copy's preserved mtime. Unlike the engine notice, doctor reports every such edit
on every run. `~/.pi/agent` is only read.

## 2026-09-29 - `omo thread` CLI, `omo daemon adopt`, and terminal rows in `omo daemon status`

- `bin/lib/thread.js` (+ `thread-args.js`, `thread-output.js`): `omo thread list|send|read|bind|unbind|rebind|bindings|report|answer|outbox|ack [--json]`
  over the plugin's thread SDK (`plugin/runtime/thread-sdk/sdk.js`) as `cli:<uid>`, wired in `launcher.js` and
  `compile-entry.ts`. Exit codes: 0 ok, 1 refused as data, 2 usage, 3 `host_unavailable`, 4 win32 or no `node:sqlite`
  (probed lazily), 5 `internal_error`. `--json` shapes and the connector loop: `docs/reference/omo-thread.md`.
- `bin/lib/daemon-adopt.js`: `omo daemon adopt <session> [--interrupt] [--force] [--json]` releases a host session
  (senpi `release_session`, reason `takeover`) and resumes it in this terminal with `--session <path>` in the
  session's directory; user input an `--interrupt` took out becomes the first prompts, or is printed when the
  release is refused. Refusals exit 4 (`turn_active`, `attached`, ..., already a terminal session), a session no
  host serves exits 3, `release_failed` twice exits 5 (`release_failed` then `unknown_session` counts as released).
- `daemon-status.js`: `endpoint_kind: "tui"` rows print `tui <name> pid <n> cwd <path>` (an unresponsive one with its
  reason) and count in `aggregate.terminals`, not as live hosts. `daemon-operations.js`: handoff, `stop --all` and its
  `--wait` never act on a terminal endpoint; handoff lists them as skipped.
- Tests: `thread.test.ts`, `daemon-adopt.test.ts`, `daemon-operations.test.ts` (mixed host/live tui/dead tui fixture),
  `sqlite-import-discipline.test.ts` covers `thread.js`.

## 2026-09-28 - The compiled binary enters a shard supervisor without the engine CLI graph

`compile-entry.ts` routes an `--internal-rpc-host-supervisor` launch through `supervisor-fast-path.ts`, which applies
the engine CLI's pre-`main()` process setup (deleted-cwd guard, process title, agent markers, silenced warnings) and
imports the engine's own `modes/rpc/supervisor-route.js` instead of `dist/cli.js`. The supervisor of every task shard
and Desktop thread host therefore no longer evaluates the engine's `main.js` graph. An argv the engine declines falls
through to the full CLI as before. Measured on the compiled binary (1 parent x 4 children): supervisor physical
footprint 70.7 -> 49.4 MB, RSS 123.3 -> 102.9 MB; children, host and topology unchanged.

## 2026-09-28 - `omo daemon run --foreground` exits 2; `--persistent` is accepted and ignored

`bin/lib/daemon.js`: `--foreground` on any `omo daemon` subcommand exits 2 with "the engine host always
detaches", before the engine is called. `--persistent` is still accepted but no longer passed to the engine; the
launch spec's `coldStart` tunable decides. `docs/reference/omo-daemon.md` documents both, lists the exit-3 cases of
`stop --all`, `handoff` and `rollback-prepare`, and carries the rollback runbook built on `stop --drain --all --wait`
and `rollback-prepare`.

## 2026-09-28 - Native daemon commands cover every session host

`omo daemon status` and `omo doctor` now enumerate the operator daemon, task
shards, Desktop thread hosts, and other discovered endpoints in one read-only
engine sweep. Text output joins shard owner sidecars, reports concurrent
generations, memory, descriptors and crash counts, and ends with a machine
aggregate; JSON preserves the engine rows and adds owner and aggregate fields.

`omo daemon gc` reaps only endpoint state the engine proves dead, `handoff` walks
every live endpoint through the engine's upgrade gate, and `stop --all` applies
the existing refusal and drain rules per endpoint. `stop --drain --all --wait`
waits for both generation pids and live session-path claims before authorizing a
downgrade. `rollback-prepare` discovers every durable task store, refuses partial
coverage or a live endpoint, and migrates retained host-session records back to
`rpc.sock` through the locked task-store mutation path.

The focused Native and senpi-task suites cover endpoint rendering and JSON
preservation, gc sidecar ownership, upgrade/refusal fan-out, drain completion and
timeout, rollback preflight and record events, plus shard naming parity with the
adopted engine.

## 2026-09-28 - omo app-server loads the OmO plugin (#9117)

### What changed

- `bin/lib/launcher.js`: `omo app-server ...` (server and every `daemon` verb) appends `--extension <package>/plugin` after the subcommand instead of passing through bare. The engine's app-server reads `--extension` only there (senpi #2313); a leading flag never reaches its dispatch. `--no-extensions` still leaves the list to the caller.
- `compile-entry.ts` `buildSenpiArgs`: the same placement for the compiled binary.

### Tests

`test/launcher.test.ts` asserts the server and `daemon start` argv end with the plugin extension and that `--no-extensions` passes through; `app-server` left the early-command passthrough table. `test/compile-entry.test.ts` covers the compiled path.

## 2026-09-28 - The doctor recognizes a Bun-installed omo on Windows (#8909)

### What changed

- `bin/lib/doctor-migration.js`: Bun's Windows global bin is a copied `omo.exe` plus an `omo.bunx` sidecar. The owner resolver now reads that sidecar (UTF-16LE, target up to `"` + NUL) and resolves the target against the bin dir's parent, the way Bun's shim does (`install\global\node_modules\omo-ai\bin\omo.js` from `~/.bun`, `..\node_modules\...` for a home-root install). Ownership still requires that file to exist inside an installed package, so the omo.exe is `native` and the "another omo precedes omo-ai on PATH" warning no longer fires for omo-ai's own launcher.
- `bin/lib/package-paths.js` `updateTarget()`: a legacy Bun home-root install (`<home>/node_modules/omo-ai` next to `<home>/bun.lock` or `bun.lockb`) is updated with `bun add -g` under the user's own Bun configuration. The default `install/global` layout keeps its `BUN_INSTALL` overlay; every other layout still gets the npm command.
- The native installer's PATH check (`packages/omo-opencode/src/cli/install-native/legacy-omo-bin.ts`) reads the same sidecar, so `install --platform=native` on Windows verifies the Bun-installed omo instead of reporting that no omo-ai command exists.

### Tests

`test/doctor-migration.test.ts` writes the sidecar bytes a real `bun add -g omo-ai` produced on a windows-latest runner (default layout behind a legacy `omo.cmd`, and a home-root install reached through `..\node_modules`) and covers the home-root update target with and without a Bun lockfile. `legacy-omo-bin.test.ts` covers the installer scan over the same bytes.

## 2026-09-27 - Native doctor reports computer-use readiness (#8939)

### What changed

- `computer-use-doctor-runtime.ts` is bundled into the existing Native doctor runtime. It loads the effective `[native]` computer config, honors `computer.engine_path`, otherwise follows the desktop locator and versioned release acquisition path, and preserves `native-unavailable`, `quarantined`, and ABI/handshake diagnostics with every attempted path.
- The probe starts the engine under a five-second bound and sends only `engine.hello` and `capabilities`. It never sends `session.open`, so it does not create a desktop session, arm input, or trigger an OS permission request.
- `bin/lib/computer-use-doctor.js` renders enabled/supported state, engine path plus version/ABI/protocol, backend and capture/input/accessibility permissions, display count and lock state, and stop-path availability as `INFO` / `PASS` / `WARN` / `FAIL` lines. `launcher.js` computes those lines alongside task-category coverage and `doctor.js` includes them in its existing exit status.

### Tests

`test/computer-use-doctor.test.ts` covers the healthy output, degraded permission/display/stop-path warnings, quarantined paths, disabled config, explicit engine-path precedence, and the exact prompt-free request sequence (`engine.hello`, `capabilities`, no `session.open`).

## 2026-09-24 - omo doctor and omo setup report task-category coverage (#8858)

### What changed

- `bin/lib/category-coverage.js` (new): `engineAvailableModels` builds the pinned engine's `ModelRuntime` the way the engine's `auth-check --no-refresh` does (`ReadOnlyAuthStorage`, `InMemoryCodingAgentModelsStore`, `allowModelNetwork: false`) and returns `getAvailable()`; `anthropic-subscription` (an extension provider, not in the catalog) is registered on that runtime from the engine's own builtin extension, so the extension's availability check decides it as in a session (stored accounts, `CLAUDE_CODE_OAUTH_TOKEN*` env tokens, an opted-in ambient login; settings read from the inspected agent dir). A setup plan passes its post-import `auth.json` entries (in-memory `AuthStorage.inMemory`) and `models.json` document (a 0600 file in a temp dir removed right after). `categoryCoverage` classifies through the bundled runtime; `doctorCoverageLines` / `setupCoverage` are fail-open (no lines / `undefined`) and import the runtime before the engine so a payload without it costs nothing.
- `category-coverage-entry.ts` (new): the bundled runtime. It loads omo.json the way the extension does (`loadOmoConfig`, harness `senpi`), counts setup's pending category pins as user-configured, and calls `resolveCategoryCoverage`.
- `script/build-omo-native.ts`: bundles that entry into `plugin/runtime/category-coverage/index.js` (node target, ESM, node builtins only) and requires it in the payload completeness check (`NATIVE_REQUIRED_ARTIFACTS`; the omo-senpi install list is unchanged).
- `bin/lib/launcher.js` computes the doctor lines (not for `--reap`) and passes them to `runDoctor`, which stays synchronous and prints them after the daemon line. `bin/lib/setup-import.js` computes the plan's coverage before the summary; `bin/lib/setup-summary.js` renders it as a `categories` row after the found rows.

### Tests

`test/category-coverage.test.ts` (new): the real engine and the real entry over a zai-only and an anthropic-only agent dir (1 and 7 usable, agent dir untouched), an env-token-only and a non-login `anthropic-subscription` entry, `runDoctor` printing the launcher's lines and `runSetup --dry-run` carrying the `categories` row, a setup plan whose imported key, custom provider and category pin all count, fail-open for doctor and setup (no `categories` row), and the line/row shape. `test/payload.test.ts` requires the new artifact.

## 2026-09-24 - omo setup prints one migration summary and asks one consent for the whole plan (#8851)

### What changed

Every setup stage is now a pure plan builder plus a separate writer, so all plans exist before anything is asked or written:

- `bin/lib/setup-credentials.js` (new; the credential stage moved out of `setup-import.js` unchanged): `planCredentials` / `applyCredentials`, plus `credentialPlanLines` (`planned-add`, `skipped-*`), `credentialCounts` (`imported: N`, `skipped-*: N`) and `credentialQuestion`.
- `bin/lib/setup-assets-import.js`: `planAssets` / `applyAssets` replace `importOpencodeAssets`; the malformed-`mcp.json` warning becomes a plan notice. `setup-opencode-assets.js` `planOpencodeAssets` also returns `refusedServers` and `skippedSkills` (`{ name, reason }`) next to the notices it already pushed.
- `bin/lib/setup-providers-import.js`: `planProviders` / `applyProviders` replace `importOpencodeProviders`. `applyProviders` re-reads `auth.json` before adding keys, since the credential stage of the same run may have just written it (its ids are builtin, these are custom, so the plan-time classification still holds). `setup-opencode-providers.js` also returns the declared ids it did not carry (`skipped`).
- `bin/lib/setup-model-choices-import.js`: `planModelChoices` / `applyModelChoices` replace `importModelChoices`. The plan always validates against the providers the provider stage will add in this run (previously only a dry run did; a real run re-read models.json after the write, which holds the same providers). Dropped choices and blocked targets become plan notices with the same `model choice not carried: ...` / `WARN senpi: ...` text; the per-item `model choice <label>: ...` preview lines are gone.
- `bin/lib/setup-guidance.js`: `credentialGuidance` returns structured OAuth logins (`login` / `signed-in` / `unsupported`, with the `/login` target) and unmapped ids instead of formatted text.
- `bin/lib/setup-summary.js` (new): `formatSetupSummary` renders the inventory plus every plan (installed harnesses only; the notes of every stage de-duplicated, plus the detect notices of omo's own store) and holds `TELEMETRY_NOTICE`, copied word for word from omo-opencode `cli-installer.ts` / `tui-installer.ts`.
- `bin/lib/setup-models.js`: only the guide line and the placeholder template remain; the template prints only when no class has anything to report.
- `bin/lib/setup-import.js`: `runSetup` plans everything, prints the summary and the telemetry line once, then: `--dry-run` prints the `planned-*` lines and returns; nothing pending prints `Nothing new to import.` and the counts; otherwise one `[Y/n]` consent (Enter accepts) or, with `--ask-each`, the old per-stage `[y/N]` questions. A declined provider stage under `--ask-each` re-plans the model choices against the real models.json and prints the notices that changed. After the writes, one counts block for the stages that ran.

`setup-report.js` (`formatSetupReport`) is unchanged: the launcher and the compiled entry still print it.

### Tests

`test/setup-summary.test.ts` (new): a PTY run pressing Enter imports every class behind one `[Y/n]` with no `[y/N]`, telemetry printed once, no uninstalled-harness names and no template; `--dry-run --yes` writes nothing and asks nothing; a non-interactive run refuses once and `--ask-each` refuses per class; a second run has nothing to consent to and changes no file. Layout-only updates elsewhere: the PTY marker is `[Y/n]`; asserts on `planned-*` lines in non-dry runs moved to the counters (`providers-imported: acme`, `providers-skipped-existing: 2`, `skills-skipped-bundled: 1`, `model-choices-carried: none`); the cache test asserts live provider ids and no `senpi | no` row; the guidance test asserts the structured result; the empty-plan shape includes `refusedServers` / `skippedSkills`.

## 2026-09-24 - omo setup carries OpenCode model choices into settings.json and the [native] block (#8846)

### What changed

`bin/lib/setup-opencode-models.js` (new, read-only) reads opencode's `model`, `small_model` and `agent` through `readOpencodeConfig` - a whole-document variant `setup-opencode-assets.js` now exports next to `readOpencodeSection`, both built on one file reader - and the OpenCode edition's `categories` / `agents` from the legacy plugin files (`OPENCODE_CONFIG_DIR` before the global dir, `CONFIG_FILE_NAMES` order), overlaid by the `[opencode]` block of the user omo.json[c]. A legacy file the unification migration already moved is read from the newest `~/.omo/migration-backup-*-opencode-config/<path relative to home>` copy, with a notice naming it. Each `provider/model[:level]` (also the legacy `model(level)`) is translated with `provider-map.json` (for a provider opencode's auth.json holds as an OAuth login, `oauthLogins` first when that provider serves the model, so `openai/gpt-5.5` on a ChatGPT login becomes `chatgpt-subscription/gpt-5.5`) and checked against `bin/lib/engine-models.js` (new): the model ids of `@earendil-works/pi-ai/providers/all` `builtinProviders()`, the catalog model-runtime.js composes the engine from, loaded from the installed senpi without starting it; `anthropic-subscription` mirrors the anthropic catalog as its extension does; plus `<agentDir>/models.json` providers and, on a dry run, the custom providers the provider stage would add. A provider that lists models only at runtime (`refreshModels`) is reported, not trusted. Entries become the native shape: `model`, `models` (a `fallback_models` chain folded behind `model`), `reasoning` (from `reasoning` / `reasoningEffort` / `variant`) and `temperature`; an entry whose every model failed is dropped whole. Agents are carried only for names in senpi-task's `BUILTIN_AGENTS` (pinned by a test), because any other name would become a new promptless agent; `deep` is carried as `deep-low` as the loader canonicalizes it.

`bin/lib/setup-model-choices-import.js` (new) is the stage, the same detect -> preview -> consent -> write shape and `confirm` as the others, run last in `runSetup`. Targets: `<agentDir>/settings.jsonc`, else `settings.json` (settings-manager.js `resolveSettingsSource`), `defaultProvider` + `defaultModel`; the user omo config (`omo.jsonc`, else `omo.json`, else a new `omo.jsonc`, loader/paths.ts) `[native]` block, or `[senpi]` when only that legacy spelling exists: `model_profile`, `categories.<name>`, `agents.<name>`. A key present in the block or the shared base is `skipped-existing`, or `already-carried` when equal. `bin/lib/jsonc-edit.js` (new) inserts each member into the file's own text, so comments and order survive, and refuses (the stage reports, writes nothing to that file) whenever the edited text does not parse back to exactly the intended document. Each edited file gets a `.bak-<timestamp>` copy and an atomic write through a symlink.

### Why

The engine starts an interactive session on the saved settings default (model-resolver.js `findInitialModel` step 3; recommended-models leaves a `settings` provenance alone), while the omo-senpi model-profile component applies Recommended to every fresh headless or desktop session unless `model_profile` is set, and a `provider/model` value there is a pin. Writing only one of the two left the other surface on Recommended.

### Expected merge conflict zones

`bin/lib/setup-import.js` `runSetup` (one added stage call), `bin/lib/setup-opencode-assets.js` (the reader split).

## 2026-09-24 - omo setup carries OpenCode custom providers into models.json and auth.json (#8836)

### What changed

`bin/lib/setup-opencode-providers.js` (new, read-only) reads the `provider` section of the OpenCode user config through the MCP reader's own resolution and merge (`setup-opencode-assets.js` now exports that reader as `readOpencodeSection(files, section, label, notices)`, plus `convertPlaceholders` / `unconvertedPlaceholder`; the MCP path calls it with `"mcp"` and keeps its notices). Each custom provider becomes the engine's `models.json` entry in the shape `model-config-schema.js` `ProviderConfigSchema` validates and `provider-composer.js` `modelFromJson` composes: `name`, `baseUrl`, `api` at provider level, `headers` from `options.headers`, and `models[]` with `id`, `name`, `contextWindow` / `maxTokens` from `limit.context` / `limit.output`, `reasoning`, `input` from `modalities.input` (text/image/video), a per-model `api` when a model names its own `provider.npm`, and `upstreamModelId` when an OpenCode model `id` differs from its key (the engine sends it as the request model id, `model-runtime.js`). The key follows OpenCode's own order (`provider.ts`): `options.apiKey`, else the opencode `auth.json` `api` entry, else the single env var `env` names. A key is escaped with the engine's literal escapes (`$$`, `$!`) and `{env:NAME}` becomes `${NAME}`, so the engine resolves to the bytes OpenCode would have sent.

Two conversions exist because the SDKs disagree about the base URL. `@ai-sdk/anthropic` posts to `<baseURL>/messages` (default `https://api.anthropic.com/v1`) while the engine's Anthropic client appends `/v1/messages` (its builtin base is `https://api.anthropic.com`), so the trailing `/v1` is removed, and an Anthropic base without one is reported instead of guessed. A baseURL that is itself a `{env:...}` or `{file:...}` placeholder has no engine spelling and is also reported.

`bin/lib/setup-providers-import.js` (new) is the stage itself, with the credential and asset stages' detect -> preview -> consent -> write shape and the same `confirm`. A provider id already in `models.json` is `providers-skipped-existing` and its key is not written either, because a key only rides with the provider it belongs to. A key id already in `auth.json` is kept. `models.json` is read comment-tolerant like the engine reads it, left untouched when `providers` is not an object, and written atomically at 0600 with a `.bak-` copy; every other top-level key (`disabledProviders`, ...) is preserved.

`bin/lib/auth-store.js` (new) takes the auth.json read/escape/backup/write code verbatim out of `setup-import.js`, so both stages write keys the same way. `setup-import.js` plans the providers once up front, passes `customProviders` to `printModelReport`, which drops only the placeholder template when a real provider was found, passes the planned ids to the credential stage, which stops listing them as `skipped-unmapped`, and runs the provider stage after the asset stage.

### Why

After #8799 and #8803, custom providers were the one hand-configured OpenCode asset setup did not carry. Once they had been set up by hand, the user was left reading the engine's `models.json` schema.

### Expected merge conflict zones

`bin/lib/setup-import.js` `runSetup` (every setup stage lands there), `bin/lib/setup-models.js` (the report rewrite lane).

## 2026-09-24 - omo doctor reports the OpenCode-edition migration leftovers (#8831)

`omo doctor` said nothing about the machine it had just been migrated from: an `omo` earlier on PATH than omo-ai's, the legacy `oh-my-openagent` / `oh-my-opencode` package still installed globally (the one whose `npm uninstall -g` can take omo-ai's `omo` with it, #8793), and the OpenCode plugin still registered in the OpenCode config. `packages/omo-native/bin/lib/doctor-migration.js` is new and adds three report-only checks, printed right after the `INFO Update:` line; `doctor.js` only imports and calls it.

- PATH: every absolute PATH dir except a project `node_modules/.bin` is scanned for `omo` (plus `.cmd`/`.ps1`/`.exe` on Windows). Each entry's owner is the nearest `package.json` above its resolved symlink or above the package path its launcher shim names; a Codex Light wrapper (`# OMO_GENERATED_RUNTIME_WRAPPER`) is `lazycodex@<cached version>`. Every entry before omo-ai's own, or every entry when omo-ai is not on PATH, gets a `WARN another omo precedes omo-ai on PATH: <file> (<owner>)`. The fix is `bunx oh-my-openagent@beta install --platform=native` when the installer repairs that owner (oh-my-openagent / oh-my-opencode / lazycodex); otherwise it is "remove that file, or move <omo-ai bin dir> ahead of <dir> on PATH". The owner rules mirror `packages/omo-opencode/src/cli/install-native/legacy-omo-bin.ts`, which omo-native cannot import.
- Legacy package: `oh-my-openagent` / `oh-my-opencode` under an npm global prefix (`npm_config_prefix`, `~/.npmrc` `prefix=`, and the prefix implied by every PATH bin dir) or under the bun global tree (`$BUN_INSTALL/install/global/node_modules`, default `~/.bun`). The warning names the package dir. For npm the remove command is `npm uninstall -g <pkg>`, followed by the doctor's own update command if `omo` disappears; for bun it is `bun remove -g <pkg>`.
- OpenCode registration: every server config file `bin/lib/setup-opencode-assets.js` `opencodeConfigSources` names (the global dir's `config.json` / `opencode.json` / `opencode.jsonc`, `$OPENCODE_CONFIG`, then `~/.opencode` and `$OPENCODE_CONFIG_DIR`, layered the way OpenCode reads them), plus `tui.json` / `tui.jsonc` in each of those dirs, is parsed with `bin/lib/jsonc.js`. Any `plugin` entry naming a legacy package (`<pkg>`, `<pkg>@...`, `<pkg>/tui...`, string or `[name, options]` tuple) yields one `INFO OpenCode still loads the <pkg> plugin (<files>)` line. An unparsable file is skipped because OpenCode reports its own config errors.

Nothing is deleted or rewritten. `runDoctor` options gain `env` / `homeDir` / `platform`, following the existing `env` injection, so `test/doctor-migration.test.ts` runs every check against fixture trees and never reads the real PATH or home.

## 2026-09-24 - omo update runs the detected package-manager command (#8830)

### What changed

`bin/lib/package-paths.js` `updateTarget()` keeps `manager` and `command` and adds `argv` plus, for a bun-global layout, `env.BUN_INSTALL`. The printed bun command is `bun add -g omo-ai@beta`; the `--cwd <package dir>` form is dropped because bun ignores `--cwd` for `-g` and still installs into the ambient `BUN_INSTALL` / `~/.bun`. `bin/lib/self-update.js` is new: it prints the command, returns on `--dry-run`/`--print`, otherwise spawns through `runChild` (injectable `run` for tests), streams stdio, and reports before/after versions or a non-zero retry line. `bin/lib/launcher.js` `isSelfUpdate` calls it. Tests in `test/self-update.test.ts` and `test/launcher.test.ts`.

### Why

`omo update` did not update. The copy-paste command was also wrong for bun-global installs that were not the ambient prefix.

### Why an extension could not handle it

Self-update is answered in the launcher before the engine is spawned, so the product package (not the pinned engine) is what moves.
## 2026-09-24 - omo setup imports every OpenCode key an omo provider can serve, and names the real sign-in command (#8799)

### What changed

`bin/lib/provider-map.json` drops `excludedHostedGatewayIds` entirely and re-derives `builtinProviderIds` from the pinned engine's `builtinProviders()` verbatim (45 -> 47 ids: `opencode` and `opencode-go` were being filtered out). `providers` gains `zai-coding-plan -> zai`. Two new fields carry the OAuth story: `oauthProviderIds` (the engine's builtin OAuth providers, verbatim) and `oauthLogins` (a source OAuth id -> the omo provider to run `/login` for, for the ids that differ: `openai`/`openai-codex` -> `chatgpt-subscription`, `claude-sdk-oauth` -> `anthropic-subscription`, `kimi-for-coding` -> `kimi-coding`).

`bin/lib/setup-guidance.js` is new and owns one thing: what to tell the user about credentials setup found but could not copy. It replaces the single closing line that told the user to run `omo auth` to sign in - `omo auth` has no sign-in, it only prints or checks credentials that already exist. Each skipped OAuth id now gets its own line naming the interactive command (run `omo`, then `/login <provider>`), and each unmapped API key gets the reason plus the next step (define the provider and baseUrl in the engine's `models.json`, then `/login` it). `bin/lib/setup-import.js` reads the provider map once in `runSetup` and threads it into the plan build and both printers, so the dry-run preview shows the same guidance the real run does.

`test/setup-guidance.test.ts` is new (guidance rendering + the provider-id resolution table). `test/provider-map-registry.test.ts` drops its `EXCLUDED_BUILTIN_PROVIDER_IDS` filter, so the map is now pinned equal to the engine registry, and adds an OAuth-map contract test. `test/setup-import.test.ts` covers the wider import set end to end and asserts the `omo auth` string is gone.

### Why

An OpenCode user whose credentials were only `zai-coding-plan`, `opencode-go` and an OAuth login finished `omo setup` with zero usable providers and an instruction that goes nowhere. The engine evidence contradicts the exclusion: `opencode` ("OpenCode Zen", baseUrl `https://opencode.ai/zen`) and `opencode-go` ("OpenCode Go", `https://opencode.ai/zen/go`) are first-class builtin providers authenticating with the same `OPENCODE_API_KEY` the source file holds, and the engine's `zai` baseUrl (`https://api.z.ai/api/coding/paas/v4`) is byte-identical to models.dev's `zai-coding-plan` endpoint. None of the three can fail for an endpoint reason, so none of them belongs on an exclusion list; the list is now empty and gone. The downstream cost of under-importing is real: with only `kimi-coding` present, the default `quick` category has no model in its chain, so memory and `task(category=quick)` fail at runtime.

### Why an extension could not handle it

The provider map and the setup import flow are this package's own surface; the engine has no view of another harness's auth file.

### Expected merge conflict zones

`bin/lib/provider-map.json` (every senpi pin bump re-derives it), `bin/lib/setup-import.js` print helpers.

## 2026-09-24 - omo setup carries over OpenCode MCP servers and global skills, not just credentials

### What changed

`bin/lib/setup-opencode-assets.js` (new) reads the OpenCode user-scope config the way opencode 1.18 loads it: `config.json`, `opencode.json` and `opencode.jsonc` in `$XDG_CONFIG_HOME/opencode` (else `~/.config/opencode`) deep-merged in that order, then `$OPENCODE_CONFIG`, then `opencode.json[c]` in `~/.opencode` and `$OPENCODE_CONFIG_DIR` (a layer on top of the global dir, not a replacement for it), plus the skill trees (`skills/`, then `skill/`) of each of those directories, and converts what it finds to the shapes the engine reads. `type: "local"` becomes `type: "stdio"` with the head of `command[]` as `command` and the tail as `args`, `environment` becomes `env`, `cwd` carries over, `type: "remote"` becomes `type: "http"`, `oauth: false` becomes `auth: false`, and an `oauth` client becomes the engine's `oauth` (`clientId`, `callbackPort`, space-separated `scope` as `scopes`; a `clientSecret` or `redirectUri` has no engine field and is reported). OpenCode's `{env:NAME}` placeholders become the engine's `${NAME}`; a server left with a `{file:...}` or non-identifier `{env:...}` placeholder is refused with a notice, as is one the engine's interpolation rejects (`$(` anywhere, or a value starting with `!`). A skill dir without a `SKILL.md`, or whose frontmatter has no `description` (the engine drops those), is reported and skipped. `bin/lib/jsonc.js` (new) is the string-aware comment and trailing-comma stripper the `.jsonc` path needs - a `,}` inside a string is data - and it drops a UTF-8 byte order mark; strict JSON is tried first so the common file pays nothing.

`bin/lib/setup-assets-import.js` (new) owns the asset stage end to end: classify against what the target already has, print the preview, ask, write. MCP servers merge into the engine's GLOBAL `<agentDir>/mcp.json` under `mcpServers`, preserving every other key in that document, with a timestamped `.bak-` copy and an atomic 0600 write; skills are copied into the GLOBAL `<agentDir>/skills/<name>/`. An existing server name or skill directory is never overwritten - it is reported as `mcp-skipped-existing` / `skills-skipped-existing` - and a skill named like one in the plugin's `plugin/skills` is reported as `skills-skipped-bundled`, because the engine loads the user root first and the first skill of a name wins, so the copy would replace the bundled skill. An existing `mcp.json` that does not parse, or whose `mcpServers` is not an object, is left untouched.

`bin/lib/setup-import.js` splits the credential stage into `importCredentials` and calls the new asset stage after it, passing its own consent prompt so both stages ask the same way. `--dry-run` previews assets and writes nothing; `--yes` accepts both stages.

`test/setup-opencode-assets.test.ts` and `test/setup-assets-import.test.ts` are new: the first pins the conversions, the jsonc edge cases and the refusal rule, the second drives the real launcher end to end for import, no-overwrite, bundled-name skills, a malformed target, dry-run and idempotency, and loads the written `mcp.json` through the pinned engine's own `loadMcpConfig` so any field the engine rejects fails the test.

### Why

An OpenCode user's MCP servers and skills are most of their setup, and `omo setup` imported none of it. The onboarding skill's migration lane filled the gap by hand and filled it wrong: it wrote a GLOBAL OpenCode MCP server into the PROJECT `.mcp.json`, so a fresh session in any other directory could not see it. The engine reads global servers from `<agentDir>/mcp.json` (always trusted) and global skills from `<agentDir>/skills`, which is where a global server and a global skill belong.

A server whose config contains shell command substitution is deliberately dropped with a notice rather than copied: the engine's MCP interpolation rejects `$(` and throws for the whole file, so copying one such value would take every other server down with it.

### Why an extension could not handle it

Reading another harness's config directory and writing the engine's own global config before the engine starts is the launcher's job; an extension only runs once the engine is already up.

### Expected merge conflict zones

`bin/lib/setup-import.js` `runSetup` tail.

Follow-up: the sign-in guidance is printed once, with the plan. `printCounts` used to repeat it, so a `--yes` run showed the same `/login` lines twice (pinned by two `setup-import.test.ts` cases, both RED at `Received: 2` before the change).

Review follow-ups: an imported opencode key is written with `$` and `!` escaped (`$$`, `$!`). The engine resolves every stored `api_key` as a config value - a leading `!` runs a shell command, `$NAME` / `${NAME}` interpolate the environment - while opencode keeps the key verbatim, so a key holding either character was rewritten or executed at read time; `setup-import.test.ts` now resolves the stored value through the engine's own `resolveConfigValue` and expects the source bytes back. The OAuth guidance reads the engine's auth store and says a login is already done when an OAuth entry exists under the target provider, so a re-run no longer repeats `/login` for it. `provider-map-registry.test.ts` reads `ANTHROPIC_SUBSCRIPTION_PROVIDER_ID` from the engine instead of hand-typing it.

## 2026-09-23 - the comment-checker runtime dependency is removed again; the extension downloads the pinned release (#8247)

### What changed

`package.json` drops the `@code-yeongyu/comment-checker` runtime dependency that #8745 (below) declared earlier today and that shipped in 5.0.0-beta.87, and `bun.lock` loses its record. `test/package-shape.test.ts` replaces the "declares comment-checker" and "pin is exact" assertions with the inverse: the dependency is absent while asserting that the shipped extension bundle (`packages/omo-senpi/plugin/extensions/omo.js`) carries the pinned-release downloader (`code-yeongyu/go-claude-code-comment-checker`, `/releases/download/v`, `comment-checker_v`). `test/packed-install.test.ts` asserts, on the packed consumer, that `@code-yeongyu/comment-checker` is installed nowhere in the consumer tree and is not resolvable from the installed extension's directory (the plugin payload itself is a `build:omo-native` output, absent in the root test shard, so the downloader-in-bundle assertion lives only in `package-shape.test.ts`).

### Why

A native install had no checker at all, and on a 1.3.x bun the miss escaped as `Extension error (...omo.js): ResolveMessage: Cannot find module '@code-yeongyu/comment-checker'` after every successful write-like tool result. #8248 and #8745 declared the package; it unpacks to 267,670,796 bytes (every platform's binary, 261,416 KiB on disk against 274,732 KiB for the whole engine), which is why #8256 removed it from the OpenCode edition on 2026-09-14. #8745 also left the Bun 1.3.x `ResolveMessage` leak in place, reasoning from Bun 1.4.x where the value is an `Error`; on Bun 1.3.14 it is not, and `bun add -g` installs re-execute under the bun that installed them with no version floor. The fix lives in `packages/omo-senpi` (lazy pinned-release download into the cache both editions share, plus the ResolveMessage predicate); these tests are the guard that keeps the native package on that path.

### Why an extension could not handle it

The package manifest and the packed-install contract are this package's own surface.

### Expected merge conflict zones

`test/package-shape.test.ts` (dependencies block), `test/packed-install.test.ts` (first test's tail).

## 2026-09-23 - omo-ai declares the comment-checker runtime dependency (#8247)

### What changed

`package.json` lists `@code-yeongyu/comment-checker` at an exact version alongside the engine and the
codemode parser. The shipped extension resolves that package after a write-like tool result, so an
install that had no other copy of it raised `Cannot find module '@code-yeongyu/comment-checker'`.

### Why

The dependency was implicit: it resolved on machines where another workspace or a global install
happened to provide it, and failed on a clean global install of the published package.

### Verification

`bun test packages/omo-native/test/package-shape.test.ts` pins the declaration and its exact pin
(12 pass). A clean `npm i omo-ai@5.0.0-0.beta.86` prefix resolves the package only once the
declaration is present.

## 2026-09-23 - the launcher prepares an engine postinstall never touched (#8713)

### What changed

`bin/senpi-patch.mjs` keeps resolving the engine root and now only calls `prepareInstalledEngine` and writes the stamp. The preparation moved into `bin/lib/engine-prepare.js` (orchestrator plus the `.omo-engine-prepared` stamp, holding the omo-ai package version, inside the engine tree) and `bin/lib/claude-code-floor.js` (the Claude Code UA floor, unchanged logic). `launcher.js` routes every engine start (`spawnSenpi`, `engineHostCall`, `omo daemon attach`) through `preparedSenpi()`, which calls `ensureEnginePrepared`: a matching stamp costs one small read; a missing or foreign stamp prepares and restamps; a failure prints `omo: could not prepare the installed engine (...); reinstall with: ...` and the launch continues.

### Why

postinstall is skipped under `ignore-scripts=true` and by Bun's untrusted-postinstall default, and nothing noticed: beta.85 installed that way ran without the RPC stream guard and advertised `claude-cli/2.1.251`.

### Why an extension could not handle it

The preparation rewrites the installed engine's files before the engine starts; no extension runs that early.

### Expected merge conflict zones

`bin/senpi-patch.mjs`, `bin/lib/engine-prepare.js`, `bin/lib/claude-code-floor.js`, the engine-start call sites in `bin/lib/launcher.js`, `test/packed-install.test.ts`.

## 2026-09-23 - Claude Code UA floor reaches the bundled engine and rises to 2.1.280

### What changed

`bin/senpi-patch.mjs` raises `claudeCodeVersionFloor` from `2.1.251` to `2.1.280` and applies the
floor to every `claudeCodeVersion` declaration under the engine's `dist/bundle/` as well as the
existing `@earendil-works/pi-ai/dist/api/anthropic-messages.js` target. Only the version string of a
below-floor declaration is rewritten; at-or-above declarations stay byte-identical, and a bundle
with no declaration fails installation with `omo-ai: unsupported Senpi dist/bundle`.

### Why

Claude Opus 5.5 rejects OAuth requests advertising Claude Code below 2.1.280
(`claude_code_version_too_old`), and senpi 2026.9.22-4 made `claude-opus-5-5` the recommended
Anthropic model and the first rung of the Fable fallback ladders. The launcher runs the engine's
pre-linked `dist/bundle/cli.js` whenever it exists, and that bundle inlines its own
`claudeCodeVersion`, so the pi-ai-only floor never reached the running engine: raising the floor
alone still advertised `claude-cli/2.1.251`.

### Why an extension could not handle it

The header is assembled inside the engine's Anthropic client before any extension hook runs; the
postinstall preparation of the installed engine is the only omo-owned point that reaches it.

### Expected merge conflict zones

`bin/senpi-patch.mjs` floor constant and the bundle pass; `test/senpi-patch.test.ts`.

## 2026-09-21 - POSIX launchers replace themselves with the engine (#8560)

### What changed

The Node-to-Bun handoff, engine launch and provisioned executable handoff use
`execve` on POSIX, with argv[0] included and the existing environment preserved.
Windows, unavailable execve and thrown execve keep the async child fallback.
Daemon attach remains spawn-based. The PTY probe now checks the launcher PID
itself for engine identity before looking at descendants.

### Why

The previous spawn-and-wait paths kept redundant runtime processes alive for
the whole session. Replacing the process preserves its PID and stdio without
retaining that wrapper.

### Why an extension could not handle it

These handoffs run before the engine loads extensions.

### Expected merge conflict zones

`bin/lib/launcher.js`, `bin/lib/bun-runtime.js`, `compile-entry.ts`, their focused
tests, the PTY QA script and the runtime-policy paragraph in `AGENTS.md`.

## omo daemon reaches the launcher, the compiled entry and doctor

`omo daemon attach <launch args>` continues as a normal launch whose environment points the engine at
the shared socket. `omo doctor` gains one `INFO Daemon:` line (not running / pid, instance, engine,
sessions, zombies) - never a FAIL, since a machine without a daemon is healthy. The compiled binary
reaches the engine's host CLI by re-running ITSELF with `host ...` (an early command that goes to the
engine untouched); spawning a node path there would re-enter omo and leave a phantom session.

## omo daemon - the operator's view of the shared engine host

`omo daemon run|attach|status|stop|handoff` (`bin/lib/daemon.js`) wraps the engine's `senpi host`.
The wrapper owns three things and deliberately nothing else: the launch spec under the plugin root
is the argv source, `omo.json` `task.host_engine_policy` / `task.host_idle_exit_ms` is where the
policy comes from, and every outcome has a named exit code (2 usage, 3 not running, 4 win32,
5 the engine refused) so a script never parses prose. `run` and `attach` are omo's words for the
engine's `ensure`; `status` and `stop` do not need a launch spec and still work without one.

## 2026-09-17 — stamp the engine build epoch into compiled binaries

`build-info.ts` derives `EngineBuildStamp { scheme, epoch, sha7, source }` from omob
`OmoBuildInfo.engine` (commit + committedAt) or, for a release compile, from the pinned
`@code-yeongyu/senpi` package.json (`gitHead` plus `committedAt` / `gitCommittedAt` /
`gitHeadCommittedAt`). A missing timestamp is scheme `nodef` with epoch 0 — never `Date.now()`.

`compile-entry.ts` `versionLine` records which path the build took: omob `--version` includes
`+<epoch>.<sha7> (scheme epoch)`; a define-less release prints `scheme nodef`.

`script/engine-build-defines.ts` turns an epoch stamp into bun `--define SENPI_BUILD_EPOCH=…`
`--define SENPI_BUILD_SHA7="…"` and omits both for `nodef`. `script/build-omo-binary.ts` passes
those defines on every `bun build --compile` that has a stamp; `build-omob.ts` inherits them
through `--build-info`. Correctness of handoff does not depend on the define: a missing define
is scheme `nodef`, which per I2 never initiates a handoff.

Refs #8415.

## 2026-09-21 - Remove unused compiled-launcher import after #8568

### What changed

Removed the unused `spawn` import from `compile-entry.ts`. The `spawnSync`
import and signal-aware `runChild` fallback remain.

### Why

The imported binding had no references outside its declaration. Keeping it
suggested that the compiled launcher still used that child-process API.

### Why an extension could not handle it

This is a source cleanup in the compiled launcher, before extension loading.

### Expected merge conflict zones

The import list in `compile-entry.ts`. No runtime behavior or Windows paths changed.

## 2026-09-28 - compiled omo update resolves channel, flavor and destination

### What changed

`omo update` on a compiled release binary now asks GitHub for the newest release on the build's
own channel (stable builds only move to stable releases, betas follow the newest release of either
kind), picks the asset the binary was built as, and prints a version-pinned command that downloads
beside the running executable and swaps it in (`mv` on POSIX, `Move-Item` on Windows, no
`chmod` there). An up-to-date binary says so; a failed lookup exits 1 with the releases page.
`script/build-omo-binary.ts` stamps `releaseTarget` (for example `linux-x64-musl`) into the
embedded runtime-manifest.json, outside the payload digest. The TUI update notice of a compiled
release build now says `omo update`. Logic lives in `compiled-update.ts`.

### Why

The old line always fetched `releases/latest/download/omo-<os>-<arch>` into the current
directory: musl and baseline builds got the glibc / AVX2 asset, the running binary was never
replaced, the GitHub Latest badge (which betas also receive) moved stable users to betas, and the
Windows line ended in `chmod`.

### Why an extension could not handle it

`omo update` is answered by the compiled entry before any extension loads.

### Expected merge conflict zones

`updateHint` / the `main()` fast path in `compile-entry.ts`, and the manifest write in
`script/build-omo-binary.ts`.

## 2026-09-28 - doctor recognizes a standalone omo binary

### What changed

`omo doctor` classifies an `omo` on PATH as a standalone OmO binary when it resolves to
`~/.omo/binary-runtime/<version>/omo` or is byte-identical to that provisioned copy (size plus a
64 KiB head and tail sample; the binaries are ~100 MB). Standalone binaries and omo-ai are both
OmO installs: when both are on PATH one warning names the one that runs, the one that never runs,
and how to keep one. Legacy or foreign `omo` files ahead of the first OmO install keep their
warning, now naming that install. The compiled binary's `omo doctor` prints the same migration
section, without the npm restore note. Detection lives in `bin/lib/standalone-binary.js`.

### Why

A curl-installed release binary had no npm owner, so the npm doctor called it an "unknown owner"
file to delete, and the compiled doctor never reported an omo-ai install shadowed by it.

### Why an extension could not handle it

Doctor runs from the launcher and the compiled entry, before extensions load.

### Expected merge conflict zones

`runCompiledDoctor` in `compile-entry.ts` and `formatMigrationLines` in `bin/lib/doctor-migration.js`.
