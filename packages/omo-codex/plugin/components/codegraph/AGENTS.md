# packages/omo-codex/plugin/components/codegraph/ (CodeGraph MCP Wrapper + Bootstrap Hooks)

**Generated:** 2026-07-17 (7d664b96b)

## OVERVIEW

`@sisyphuslabs/codex-codegraph` (private, Node >=20, bin `omo-codegraph`). Wraps the external CodeGraph CLI (`@colbymchenry/codegraph`, pinned `1.5.0` through the shared `CODEGRAPH_PINNED_VERSION` and the component optionalDependency) behind a stdio MCP server plus Codex lifecycle hooks. Two committed dists ship in the published payload; rebuild `dist/` in the same change as `src/` edits.

Codex wiring (all repo-relative to `packages/omo-codex/plugin/`):
- **MCP:** `.mcp.json` server `codegraph` → `node components/codegraph/dist/serve.js` (`required: false`).
- **SessionStart hook:** `hooks/session-start-checking-codegraph-bootstrap.json` → `dist/cli.js hook session-start` (timeout 5).
- **PostToolUse hook:** `hooks/post-tool-use-checking-codegraph-init-guidance.json`, matcher `^(codegraph[._].*|mcp__codegraph__.*)$` → `dist/cli.js hook post-tool-use`.
- Both hooks registered in `.codex-plugin/plugin.json`; Windows variants dispatch via `components/bootstrap/scripts/node-dispatch.ps1`.

Serve pipeline (`src/serve.ts`): OMO SOT config gate (`[codex].codegraph.enabled=false` → unavailable stub) → resolve binary (`OMO_CODEGRAPH_BIN` env → bundled → provisioned `~/.omo/codegraph/bin` → PATH) → Node support gate (major 20-24; >=25 crashes CodeGraph mid-indexing; `CODEGRAPH_ALLOW_UNSAFE_NODE=1` overrides) → auto-provision into `~/.omo/codegraph` unless `codegraph.auto_provision=false` → bridge JSON-RPC to `codegraph serve --mcp`. Project cwd resolved from `OMO_CODEGRAPH_PROJECT_CWD` → `OMO_CODEGRAPH_SESSION_START_CWD` → `PWD` → wrapper cwd. When the binary is missing/disabled, `mcp-unavailable.ts` still answers `initialize`/`tools/*` with the skip reason so Codex startup never fails.

Hook pipeline (`src/hook.ts` + `src/session-start-*.ts`): `hook session-start` checks only the exact filesystem marker `<projectRoot>/.codegraph/codegraph.db`; it never invokes the upstream CLI for status. An exact database skips as initialized, an ancestor database records `skipped-nested-root`, and only a definitive no-database result may acquire the per-project atomic lock and spawn `hook session-start-worker`. Live locks record `skipped-locked`; stale locks recover into an exponential cooldown instead of spawning immediately. Worker failures and skips persist a cooldown stamp (15 minutes by default, doubling to a 24-hour cap; configurable with Codex-only `codegraph.session_start_cooldown_ms`, minimum 60000), while success clears it. The worker prepares the workspace, invokes only `codegraph init` with a 60-second tree timeout, and records success only after the exact project database appears. Hook suppressions and worker outcomes append to `~/.omo/codegraph/session-start.jsonl`. `hook post-tool-use` emits init guidance when a codegraph tool result indicates an uninitialized project. `cli.js` with no hook subcommand falls through to serve.

## includeCode CONTRACT (commit 4cf383c5b)

`src/mcp-bridge.ts` rewrites the upstream `codegraph_node` contract in-flight: `tools/list` responses get a clarified description + `includeCode` schema description, and `tools/call` results replace "Structural outline only" text. Contract: `includeCode=true` returns leaf-symbol source only; container symbols (classes, interfaces, structs, enums, modules, namespaces) return structural outlines with member lists BY DESIGN: for container source, request a specific member symbol or file mode with `symbolsOnly=false` plus `offset`/`limit`. Pinned by `test/serve-mcp-bridge.test.ts`.

## KEY FILES

| File | Purpose |
|------|---------|
| `src/serve.ts` | MCP entry: config/resolution/Node gates, provisioning, bridge or unavailable stub |
| `src/cli.ts` | Hook CLI router: `hook session-start` / `hook post-tool-use` / `hook session-start-worker` / serve fallback |
| `src/hook.ts` | SessionStart exact-root decision pipeline + detached worker spawn |
| `src/post-tool-use-hook.ts` | PostToolUse init guidance emission |
| `src/session-start-project.ts` | Exact database and ancestor-coverage filesystem probes |
| `src/session-start-lock.ts` | Atomic per-project worker lock + stale recovery |
| `src/session-start-cooldown.ts` | Persistent exponential failure cooldown state |
| `src/session-start-worker.ts` | Background bootstrap orchestration and lock lifecycle |
| `src/session-start-command.ts` | Provision/resolve + bounded `codegraph init` invocation |
| `src/session-start-outcome.ts` | `session-start.jsonl` outcome writer |
| `src/mcp-bridge.ts` | Stdio JSON-RPC forwarder; per-request framed/line response-mode tracking; codegraph_node contract rewrites; awaits stdio writes and SIGKILLs the child on response-forwarding failure |
| `src/mcp-unavailable.ts` | Reason-bearing stub MCP server for disabled/missing binary |
| `src/serve-invocation.ts` | win32 invocation shim: `.cmd`/`.bat` via `cmd.exe /d /s /c`, `.js`/`.mjs`/`.cjs` via `process.execPath` (mirrored by `resolveCodegraphCommandInvocation` in session-start-worker) |
| `src/hook-types.ts` | Shared hook/worker option + outcome types |

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Resolution order, provisioning, Node gate, env, gitignore/workspace prep | `packages/utils/src/codegraph/` (`resolve.ts`, `provision.ts`, `node-support.ts`, `env.ts`, `workspace.ts`, `guidance.ts`), bundled at build time |
| `[codex].codegraph` config keys (`enabled`, `auto_provision`, `trustedCodegraphInstallDir`) | `packages/omo-codex/plugin/shared/src/config-loader.ts` |
| JSON-RPC framing primitives | `packages/mcp-stdio-core/src/` |
| Build / test / typecheck | `bun run build` (bun build → `dist/serve.js` + `dist/cli.js`, target node ESM), `bun test ./test`, `tsc --noEmit` |

## NOTES

- This component tests with `bun test` (unlike the vitest-based `lsp` sibling); given/when/then style.
- `src/` imports reach sibling packages via relative paths (`../../../../../utils/src/...`); they are inlined by `bun build`, so runtime `dist/` has zero deps beyond Node.
- `serve.ts` and SessionStart command provisioning derive their version from the shared `CODEGRAPH_PINNED_VERSION`; the component optionalDependency must match that pin.
- `trustedCodegraphInstallDir` overrides the `~/.omo/codegraph` install dir and is forwarded to children as `CODEGRAPH_INSTALL_DIR`.
- `resolution.source === "env"` is never auto-provisioned over: a user-set `OMO_CODEGRAPH_BIN` pointing at a missing file skips the MCP instead of silently substituting a download.
- `runBridgedCodegraphProcess` awaits every stdio write and races `childExit` against response forwarding; a forwarding error (e.g. parent stdout `EPIPE`) rejects the serve promise, destroys the child pipes, and `SIGKILL`s the codegraph child if still alive so a held-open child is never orphaned. Pinned by `test/serve-mcp-bridge-lifecycle.test.ts` and the held-open case in `test/serve-mcp-bridge.test.ts`.
