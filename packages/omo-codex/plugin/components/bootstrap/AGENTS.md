# bootstrap: Codex SessionStart Runtime Provisioner

**Generated:** 2026-07-03

## OVERVIEW

`@sisyphuslabs/codex-bootstrap` (private, engines node >=20). Runs on every Codex `SessionStart` via `hooks/hooks.json`: POSIX runs `node dist/cli.js hook session-start`, Windows runs `scripts/bootstrap.ps1` through `commandWindows` (30s timeout). The hook drains stdin, reads the plugin version from `<PLUGIN_ROOT>/.codex-plugin/plugin.json`, and skips when `state.json` already marks `completedForVersion` for that version, when a fresh lock exists, or when `PLUGIN_ROOT`/`PLUGIN_DATA` are missing. Otherwise it spawns a detached, unref'd worker (`process.execPath dist/cli.js worker`) and emits a `hookSpecificOutput.additionalContext` restart notice. Every path exits 0.

The worker acquires BOTH the bootstrap and auto-update locks under `PLUGIN_DATA`, re-checks completion under lock (TOCTOU), then runs two steps:
- `setup` (`src/setup.ts`): idempotent, degraded-not-fatal re-run of the installer surface: Git Bash preflight (win32), bundled agent TOML linking (staged under `PLUGIN_DATA`, never `PLUGIN_ROOT`), `config.toml` blocks + trusted-hook-hash re-stamp, `git_bash` MCP env stamp, version-aware component bin links plus the `omo` runtime wrapper.
- `sg` (`src/provision.ts`): pinned ast-grep binary into `<CODEX_HOME>/runtime/ast-grep/<slug>/`; skipped when a preexisting binary resolves unless `OMO_BOOTSTRAP_FORCE_PROVISION=1`; a `--version` probe must match `SG_PINNED_VERSION` or the binary is deleted.

Result is written to `state.json` (`completedForVersion`, `lastStatus: success|degraded`, degraded ledger) and JSONL log lines to `<PLUGIN_DATA>/bootstrap/bootstrap.log`. Runtime failures NEVER exit non-zero; the degraded ledger plus the `npx lazycodex-ai doctor` hint is the error channel.

CLI: `hook session-start` | `worker [--codex-home <dir>] [--once] [--only <step>] [--manifest-dir <dir>]` | `download <manifest> <platform> <destination-dir>`.

## KEY FILES

| File | Purpose |
|------|---------|
| `src/cli.ts` | Entry + barrel exports; command routing; entry guard via `realpathSync` |
| `src/hook.ts` | SessionStart handler: skip logic, detached worker spawn, restart notice |
| `src/worker.ts` | Worker orchestration: flags, locks, state.json, bootstrap.log, step runner |
| `src/setup.ts` | Setup step; esbuild inlines `packages/omo-codex/src/install/*` at build time |
| `src/provision.ts` | ast-grep provisioning via `packages/utils/src/ast-grep` helpers |
| `src/download.ts` | Checksummed manifest downloader: sha256 verify, `.partial` temp + rename, no proxy tunneling in v1 |
| `src/environment.ts` | `CODEX_HOME` resolution (env, then 6-level walk-up for `config.toml`, then `~/.codex`); install-flow detection (npx-local vs marketplace via `lazycodex-install.json` + marketplace source); lock/state paths |
| `hooks/hooks.json` | SessionStart wiring, `commandWindows` PowerShell branch |
| `scripts/bootstrap.ps1` | Windows PowerShell 5.1 hook (see NOTES) |
| `scripts/node-dispatch.ps1` | Generic Windows Node resolver/dispatcher for hook targets; exit 127 when Node unresolved |
| `manifests/node.json` | Pinned Node LTS (win32-x64 zip URL + sha256) |
| `scripts/generate-manifests.mjs` | Regenerates `manifests/node.json`; the ONLY network-touching code here |
| `scripts/build.mjs` | `bun x esbuild` bundle to `dist/cli.js`; keeps a prebuilt dist when esbuild is unavailable |
| `test/*.test.ts` | bun:test suites: download, environment, provision |

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add a worker step | `src/worker.ts` `defaultWorkerSteps()`; return `{ degraded }`, never throw upward |
| Change skip/lock semantics | `src/hook.ts` + `src/environment.ts` `bootstrapLocks()` (stale window from `plugin/scripts/auto-update-state.mjs`) |
| Move the pinned Node LTS | `node scripts/generate-manifests.mjs [--node-version <x.y.z>]`, review + commit the manifest diff |
| Installer-parity behavior | `src/setup.ts`, which wraps `packages/omo-codex/src/install/` modules |
| Windows Node/Git Bash resolution | `scripts/bootstrap.ps1`; hook-level parity checks in `packages/omo-codex/plugin/test/bootstrap-ps-guard.test.mjs` |
| Cross-component orchestration tests | `packages/omo-codex/plugin/test/bootstrap-{hooks,setup,binlinks,orchestration,ps-guard}.test.mjs` |

## NOTES

- **Deliberately NOT in the plugin workspaces array** (`packages/omo-codex/plugin/package.json`). `plugin/scripts/build-components.mjs` builds it on the standalone path: component-local `npm run build`, then a `bun build` re-bundle with `node:` import normalization. Keeping it out of workspaces lets esbuild inline cross-package TS sources (`packages/omo-codex/src/install/*`, `packages/utils/src/ast-grep`) so `PLUGIN_ROOT` ships nothing beyond `dist/cli.js`.
- **Ships in the published payload explicitly:** root `package.json` `files` lists `components/bootstrap/dist/cli.js`, `scripts/bootstrap.ps1`, and `scripts/node-dispatch.ps1` (other component sources are covered by the broader `packages/omo-codex/plugin` glob, but bootstrap's dist is pinned by name).
- **Never persists under `PLUGIN_ROOT`** (the Codex-managed marketplace cache). All state, staging, and logs live under `PLUGIN_DATA` (default `~/.local/share/lazycodex`).
- **Never writes permission keys.** `updateCodexConfig` is called with `autonomousPermissions: false`; approval/sandbox/network policies stay installer-flag-only.
- **Windows:** Codex runs hooks through `%COMSPEC%`, so Node may be absent from PATH. `bootstrap.ps1` resolves Node via `NODE_REPL_NODE_PATH` (env or `config.toml`), then the portable zip pinned by `manifests/node.json` (sha256-verified into `<CODEX_HOME>/runtime/node/`), then common install dirs and PATH; when still unresolved it emits a provisioning-incomplete notice instead of delegating. It resolves Git Bash best-effort (persists `OMO_CODEX_GIT_BASH_PATH` in the USER environment when found via PATH), never mutates the user PATH, logs to `<PLUGIN_DATA>/bootstrap/ps-bootstrap.log`, and always exits 0.
- **Manifests are committed, never generated at build time.** Builds stay offline and deterministic; unit tests inject `fetchImpl`, never the network.
- Component tests run with `bun test test/*.test.ts` even though the runtime is Node; typecheck is `noEmit` with `allowImportingTsExtensions`.
