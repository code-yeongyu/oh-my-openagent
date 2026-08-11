# ULW Run — omo-omp: native OMP adapter for oh-my-openagent

**Status: LIVE — PR #6734 submitted, CI validating.** (2026-08-11)

## Deliverables

- `packages/omo-omp` — adapter package (compose factory for omp's extension loader; task/team/
  telemetry/config-watch/session-keepalive/agent-home/palette/ultrawork/fallback-architect/
  todo-fanout-reminder components; memory MCP server; omo-member child extension; installer).
- `packages/omo-omp/plugin` — installable Pi plugin: `extensions/omo.js` (~1.03 MB),
  `omo-member.js`, `omo-memory-mcp.js`, staged runtimes (lsp-daemon, ast-grep-mcp, agent-toolkit),
  21 synced skills, LICENSE/NOTICE/README, install script.
- `packages/omo-config-core` — `[omp]` harness layer added.
- Docs: root README edition table + install guide "OMP edition".

## The engine-bundle saga (biggest engineering finding)

The senpi-task tool builders + in-process runner statically import the senpi ENGINE
(`@code-yeongyu/senpi` — jsdom, model SDKs, ~15 MB). Bundled into the omp extension, the artifact was
16.3 MB and — worse — failed to LOAD in omp (`Cannot find module '@code-yeongyu/senpi'`, no engine at
runtime). Fix: `senpi-shim` resolve plugin in `build-extension.mjs` rewrites every
`@code-yeongyu/senpi` import to `src/extension/shims/senpi-tool-shim.ts` (defineTool identity + loud
throwers for the never-reachable in-process runtime). Bundle: **16.3 MB → 1.03 MB**, zero engine refs,
loads clean in omp 17.2.12.

bun 1.3.14 quirks hit along the way: `--alias` CLI/API broken on Windows; build API ignores
`outfile`; plugin-enabled builds can't run inside `bun test` (fs interception) — the build moved to a
`--build-out` subprocess mode for the test suite.

## Runtime integration for omp

- Task children: OMP process children — `process.execPath --mode rpc --extension omo-member.js
  --model …` (omp supports `--mode rpc` natively) via `RpcProcessRunner` + `buildSpawn` with a local
  omp-binary resolver (`OMP_BIN`/`omp`), replacing senpi's `resolveSenpiExecutable`.
- Memory reflection child: omp CLI + `PI_NO_PTY=1` (omp's pipe-backend override) + `OMP_MEMORY_REFLECTION`.
- Capability gates: omp's ExtensionAPI lacks `registerMcpServer` (ast-grep) + `registerEntryRenderer`
  (memory) → both components skip cleanly with logged notices at load. Documented in install guide.

## Verification (all done live)

- 850+ unit tests green; 2 Windows symlink-EPERM environmental (pre-existing pattern; Linux CI passes).
- Root `typecheck:packages` green (31 packages).
- Live: plugin installed to `~/.omp/plugins/node_modules/@code-yeongyu/omo-omp` (Windows symlink EPERM
  → copy + lockfile entry), omp 17.2.12 boots, extension loads with zero errors, component hooks fire
  on a real session, model answers through omp.
- CI (PR #6734): build/typecheck/test/compatibility jobs — first run failed on a bun.lock issue:
  Windows-generated lockfile had `file:packages\lsp-core` backslash paths → Linux frozen install
  ENOENT. Normalized to forward slashes (commit 77cb411) — re-run validating.

## Environment notes

- Repo: fork `Qiiks/oh-my-openagent`, branch `omo-omp`, workdir
  `C:\Users\Sanveed\AppData\Local\Temp\omo-omp-work`.
- omp 17.2.12 on the user's machine; plugin installed (copy) at
  `~/.omp/plugins/node_modules/@code-yeongyu/omo-omp`; lockfile entry added to
  `~/.omp/plugins/omp-plugins.lock.json`.
- PR: https://github.com/code-yeongyu/oh-my-openagent/pull/6734
