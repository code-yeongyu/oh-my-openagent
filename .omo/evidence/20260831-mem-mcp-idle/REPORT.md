# Evidence — MCP stdio idle-teardown (#6547), branch `fix/mem-mcp-idle-teardown`

Date: 2026-08-31. Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/memfix-mcp-idle`.
Base: `origin/dev` @ `3abc23c23`. All test runs executed REMOTELY on `mengmotaMac` via
`bun /tmp/omo-mac-test.mjs fix/mem-mcp-idle-teardown -- <packages>`; no local `bun test`.

## Commits

```
278d92faa SEUNGWOO LEE <lifrary>  fix(mcp-stdio-core): destroy stdin on idle timeout so abandoned servers exit   [cherry-pick of PR #6548 867956c5c]
42740d0dd SEUNGWOO LEE <lifrary>  fix(mcp-stdio-core): drop unused handler param and share child-spawn setup      [cherry-pick of PR #6548 d2428a765, conflict resolved keeping dev's onPoll watchdog harness]
0c0a85784 YeonGyu-Kim             fix(ast-grep-mcp): arm the idle timeout on the senpi-hosted stdio server
b9374cd46 YeonGyu-Kim             docs(mcp): record why idle timeouts stay disabled on no-respawn hosts
```

Cherry-pick conflict (`server.test.ts`): dev's `spawnWatchdogChild` had gained an `onPoll`
per-poll stderr harness; PR #6548 refactored the same function into `buildServerScript` +
`spawnServerChild`. Resolution kept the refactor and re-homed dev's `onPoll` block inside the
config string — dev's watchdog semantics and the `parent_poll` tests are unchanged.

## RED — ast-grep idle timeout (SHA `3ef149367`, test-only commit)

`bun /tmp/omo-mac-test.mjs fix/mem-mcp-idle-teardown -- packages/mcp-stdio-core packages/ast-grep-mcp`

```
 4 tests failed:
(fail) ast_grep MCP idle timeout > #given an explicit idle timeout and a live parent that abandons stdin #when the timeout elapses #then the server settles [2003.34ms]
(fail) ast_grep MCP idle timeout > #given OMO_AST_GREP_IDLE_TIMEOUT_MS in the environment and no explicit option #when the timeout elapses #then the server settles [2005.82ms]
(fail) ast_grep MCP idle timeout > #given the idle timeout resolves from option or env #when the server starts #then stdio_started logs the resolved value [2004.89ms]
(fail) ast_grep MCP idle timeout > #given the real CLI spawned the way senpi spawns it #when the parent holds stdin open and never writes #then the child exits on idle [5003.02ms]
  ^ this test timed out after 5000ms.

 331 pass
 2 skip
 4 fail
 1 error
 891 expect() calls
Ran 337 tests across 15 files. [19.22s]
```

All 4 failures are the new behavior tests failing for the right reason (idle hardcoded to 0 /
env unimplemented). The 5th new test (explicit `idleTimeoutMs: 0` stays parked) passed in RED,
pinning the opt-out. Note mcp-stdio-core — including the two idle tests carried in from #6548 —
was green in this same run, proving the cherry-picked core fix works before any ast-grep change.

## GREEN — ast-grep fix (SHA `18fa2f795`, squashed to `0c0a85784`)

Same remote command:

```
 335 pass
 2 skip
 0 fail
 891 expect() calls
Ran 337 tests across 15 files. [10.45s]
```

## GREEN — final, all touched packages (SHA `b9374cd46`)

`bun /tmp/omo-mac-test.mjs fix/mem-mcp-idle-teardown -- packages/mcp-stdio-core packages/ast-grep-mcp packages/lsp-daemon packages/lsp-core packages/git-bash-mcp`

```
 507 pass
 2 skip
 0 fail
1331 expect() calls
Ran 509 tests across 50 files. [15.05s]
```

(2 skips are pre-existing Windows-gated sg-runner tests.)

## Typecheck (SHA `b9374cd46`)

`bun /tmp/omo-mac-typecheck.mjs fix/mem-mcp-idle-teardown packages/mcp-stdio-core packages/ast-grep-mcp packages/lsp-core packages/git-bash-mcp packages/lsp-daemon`
→ exit 0, no diagnostics (tsgo --noEmit per package, matching CI's `typecheck:packages` shape).

## Per-site respawn verdict table

Host respawn evidence gathered from host sources (upstream trees fetched via GitHub API on 2026-08-31):

| # | Site (current line) | Host | Respawn evidence | Decision |
|---|---|---|---|---|
| 1 | `packages/mcp-stdio-core/src/server.ts:67-74` idle callback | n/a (library) | n/a | FIXED by #6548 cherry-pick: idle callback now `config.input.destroy()` |
| 2 | `packages/lsp-daemon/src/proxy.ts:93` `idleTimeoutMs: 0` | opencode v1.18.18 | **NO.** `sst/opencode` `packages/opencode/src/mcp/index.ts` `watch()`: `client.onclose` → delete from `s.clients` + `status: failed "Connection closed"`; reconnect only via explicit user-driven `MCP.add`/`MCP.connect` (the `/mcp` command). No auto-respawn. | Keep disabled; comment added |
| 3 | `packages/lsp-core/src/mcp.ts:77` `idleTimeoutMs: 0` (lsp-tools-mcp CLI, `runMcpStdioServer`) | legacy opencode configs + standalone users of the upstream CLI | **NOT EVIDENCED.** No in-repo client respawns this CLI; opencode (a known host) marks failed without retry. | Keep disabled; comment added |
| 4 | `packages/ast-grep-mcp/src/mcp.ts:284` | senpi (`registerMcpServer`, `lifecycle: "lazy"` — `omo-senpi/src/components/ast-grep/index.ts:43-52`) | **YES.** `code-yeongyu/senpi` `packages/coding-agent/src/core/extensions/builtin/mcp/`: `connection.ts` `transport.onclose` → `markDegraded("transport closed")`; `reconnect.ts` `configureMcpReconnect` subscribes to `degraded` and respawns via `renew()`→`connect()`→`createMcpTransport` with backoff 500ms–8s (breaker 5/30s). Also: the senpi-hosted `memory-server.ts` already ships the 10-min default idle. | **ENABLED**: default 10 min, `OMO_AST_GREP_IDLE_TIMEOUT_MS` env override, explicit option seam; `<= 0` disables |
| 5 | `packages/git-bash-mcp/src/mcp.ts:76` `idleTimeoutMs: 0` | codex on win32 | **NO.** `openai/codex` `codex-rs/codex-mcp/src/rmcp_client.rs`: reconnect-with-backoff exists only for `server_name == CODEX_APPS_MCP_SERVER_NAME`; user-configured stdio servers have no respawn. | Keep disabled; comment added |
| 6 | `packages/omo-codex/plugin/components/codegraph/src/mcp-bridge.ts:84-88` (watchdog only, no idle timer) | codex | **NO** (same codex evidence as #5) | No idle timer added; documented here and in PR body. Note: component ships committed `dist/` and no CI step verifies it, so src-only comment edits would desync dist — documentation kept out of that package |

## Residuals (named for the PR)

- OpenCode `lsp` proxy: an opencode host that abandons the proxy's stdin while staying alive
  still leaks that proxy until the host process dies (watchdog). Closing it requires an
  opencode-side respawn or per-session stdin close — out of this repo's control. This is why
  this PR advances rather than fixes #6547.
- `onIdleTimeout` remains un-awaited and the idle clock arms on message arrival, not handler
  completion (pre-existing shape, unchanged by #6548 and by this PR).

## Adjacent regression found post-review: codegraph unavailable stub (commit `158d5dcaf`)

Incorporating #6548 made the previously-inert default idle timer a real teardown
(`input.destroy()`), so every caller that inherits `DEFAULT_IDLE_TIMEOUT_MS`
changed behavior. Full sweep of `runJsonRpcStdioServer` call sites found one
default-inheritor on a no-respawn host:

- `packages/omo-codex/plugin/components/codegraph/src/mcp-unavailable.ts` — the
  codex "codegraph unavailable" stub inherited the 10-min default and would die
  mid-session on codex (no respawn). **Fixed: explicit `idleTimeoutMs: 0`.**
- `mcp-bridge.ts` was reported as a second call site but is **not a caller** —
  it drives `createParentWatchdog` + manual forward loops and has no idle timer
  to configure; no edit was possible or needed.
- `omo-senpi/src/mcp/memory-server.ts` also inherits the default — senpi host
  (respawn evidenced, verdict row 4), and exactly where the audit said #6548
  "would start working"; left on the default deliberately.

TDD: RED at test-only commit `3dcdf2244` (CI-style invocation
`cd packages/omo-codex/plugin/components/codegraph && bun test ./test/serve-unavailable-idle.test.ts`):

```
(fail) unavailable codegraph MCP idle teardown > #given the codex host (no respawn for exited stdio servers) #when the unavailable stub starts #then the idle timeout is disabled [503.70ms]
Expected to contain: { event: "stdio_started", data: ObjectContaining { idle_timeout_ms: 0 } }
Received: [ { event: "stdio_started", data: { cwd: "...", idle_timeout_ms: 600000 } } ]
```

GREEN at `158d5dcaf`: same invocation, `1 pass / 0 fail`.
Component suite delta (parent `478dd4184` -> tip `158d5dcaf`, same remote clone,
`bun test ./test`): `47 pass / 31 fail / 78 tests / 25 files` ->
`48 pass / 31 fail / 79 tests / 26 files` — exactly +1 passing test, zero new
failures. The 31 failures reproduce identically at the parent commit and are
clone-environment artifacts (no plugin `npm ci`); CI's codex-compatibility job
installs plugin deps and ran these tests green on this PR before this commit.
Component `tsc --noEmit`: exit 0.

mcp-stdio-core gained a pin that an explicitly-zero idle timeout creates no
timer (`idle_timeout` never logged, loop parks on a held-open pipe); suites
green: `336 pass / 2 skip / 0 fail` (mcp-stdio-core + ast-grep-mcp).

Committed dist: the component's `dist/serve.js` + `dist/cli.js` ship committed.
The component-local build script produces different bundler path comments than
the committed artifacts (261-line churn); the artifacts' producing invocation is
the plugin-level `bun run --cwd packages/omo-codex/plugin build` (what CI runs).
Rebuilt that way: dist delta is exactly the fix (`idleTimeoutMs: 0`,
`log: options.lifecycleLog`) plus the previously-desynced #6548
`config.input.destroy()` line — the committed dist had been stale since the
cherry-pick.

Process note: one local `bun test --dry-run` was attempted for discovery;
bun 1.4.0 executes tests under `--dry-run`, so it ran ~3 local tests
unintentionally before being killed. No local results were used as evidence;
all RED/GREEN numbers above are from the remote runner.
