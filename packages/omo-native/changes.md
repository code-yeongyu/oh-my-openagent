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
