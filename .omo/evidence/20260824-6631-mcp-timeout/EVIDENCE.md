# Evidence: 20260824-6631-mcp-timeout

Upstream issue: code-yeongyu/oh-my-openagent#6631
Branch: issue/6631-mcp-calltool-timeout (worktree oom-wt-6631, base dev @8833800ae)

## WHAT WAS TESTED

1. Failing-first proof: `bun test packages/mcp-client-core/src/skill-mcp-manager/request-options.test.ts` BEFORE implementing `request-options.ts`. Result: `error: Cannot find module './request-options'` (red).
2. After implementation, same command: 12 pass / 0 fail.
   - Unit: `resolveRequestTimeoutMs` precedence (per-call override > server config > undefined), `buildRequestOptions` returns `{ timeout }` or `undefined`.
   - Manager regression: stubbed client asserts the SDK receives request options as the trailing argument for callTool (3rd arg), readResource/getPrompt (2nd arg), listTools/listResources/listPrompts (2nd arg); unconfigured path passes `undefined` so SDK default (60s) is preserved.
3. Scoped suites:
   - `bun test packages/mcp-client-core` -> 23 pass / 0 fail (test-mcp-client-core.txt)
   - `bun test packages/omo-opencode/src/features/skill-mcp-manager packages/omo-opencode/src/tools/skill-mcp packages/claude-code-compat-core` -> 316 pass / 0 fail (test-consumers.txt)
4. Repo typecheck gate: `bun run typecheck` (tsgo root + script + all workspace packages) -> exit 0 (typecheck.txt).

## WHAT WAS OBSERVED

- Root cause: `packages/mcp-client-core/src/skill-mcp-manager/manager.ts:114` called `client.callTool({ name, arguments: args })` with no third argument; SDK `@modelcontextprotocol/sdk` applies `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` when `options?.timeout` is absent. Sibling operations (`listTools`, `listResources`, `listPrompts`, `readResource`, `getPrompt`) had the same omission.
- Fix threads options through every site via centralized `buildRequestOptions()`; new config surface `ClaudeCodeMcpServer.timeout` (per-server ms) + per-call `SkillMcpClientOptions.requestTimeoutMs`; unconfigured behavior unchanged (SDK default).
- No existing test weakened or deleted; no type suppression used.

## WHY IT IS ENOUGH

The regression tests assert the exact argument position the SDK reads (`RequestOptions`) at each of the 6 call sites, covering propagate/override/default-preserve. Consumer suites (omo-opencode skill-mcp-manager feature + skill_mcp tool + claude-code-compat-core) prove no signature or behavioral break for existing callers, and repo-wide tsgo proves type safety across all workspaces.

## WHAT WAS OMITTED

- No live long-running MCP server (>60s tool) end-to-end run: the SDK timeout constant and option plumbing are covered by vendored SDK types plus argument-position assertions; a live 65s server would only re-prove SDK internals.
- Tier-2 `.mcp.json` loader transformer intentionally not extended with `timeout` passthrough (issue scope is the tier-3 skill-embedded direct execution path; tier-2 servers do not route through SkillMcpManager).
- Raw test output files contain no secrets (no env dumps, tokens, or auth headers captured).
