# Issue #2989 - figma:figma auth notification

## Root cause

`applyMcpConfig()` merged plugin MCP servers last via a plain spread:

```
builtin -> Claude Code .mcp.json -> user mcp -> pluginComponents.mcpServers
```

Claude Code plugin MCPs are namespaced `<plugin>:<server>` (e.g. Figma plugin server
`figma` becomes `figma:figma`). OpenCode keys MCP OAuth state by server name, so stored
tokens for native `figma` never satisfy `figma:figma` and OpenCode re-prompts for auth on
every start. `/mcps` shows both entries; authenticating `figma:figma` fails because that
name is not resolvable by the auth UX path.

## Fix

`packages/omo-opencode/src/plugin-handlers/mcp-config-handler.ts`: plugin MCP entries are
now added individually after builtin/.mcp.json/user sources merge. A namespaced entry
whose bare server name (`<plugin>:<server>` suffix) collides with an already-merged
native server is skipped with a warning log instead of shadowing the OAuth identity.
Non-namespaced entries and unique namespaced entries behave exactly as before.

## WHAT WAS TESTED

Failing-first co-located regression tests in
`packages/omo-opencode/src/plugin-handlers/mcp-config-handler-collision.test.ts`
(new describe block "applyMcpConfig plugin MCP deduplication"):

1. `skips namespaced plugin MCP whose bare server name collides with a native MCP` -
   user config has native `figma`, plugin contributes `figma:figma`; asserts
   `figma:figma` absent, native `figma` preserved, skip warning logged.
2. `keeps namespaced plugin MCP when no native server shares its bare name` -
   control test proving unique plugin MCPs still load.

Commands:

```
bun test packages/omo-opencode/src/plugin-handlers/mcp-config-handler-collision.test.ts packages/omo-opencode/src/plugin-handlers/mcp-config-handler.test.ts
bun test packages/omo-opencode/src/plugin-handlers/ packages/claude-code-compat-core/src/features/claude-code-plugin-loader/mcp-server-loader.test.ts
bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
```

## WHAT WAS OBSERVED

Red first (before fix), verbatim from the run:

```
(fail) applyMcpConfig plugin MCP deduplication > skips namespaced plugin MCP whose bare server name collides with a native MCP [10.94ms]
Expected path: not "figma:figma"
 4 pass
 1 fail
```

After fix: 11 pass / 0 fail across both handler test files.
Scoped sweep (full plugin-handlers dir + compat-core mcp-server-loader tests):
238 pass / 0 fail / 595 expect() calls across 20 files -
`bun-test-scoped.txt`.
Typecheck: `tsgo --noEmit -p packages/omo-opencode/tsconfig.json` exit 0, no output -
`tsgo-omo-opencode.txt`.

## WHY IT IS ENOUGH

The regression test reproduces the exact issue #2989 shape (native `figma` +
plugin-derived `figma:figma`) at the merge seam where the duplicate identity is created,
and pins the warning log. The scoped sweep covers every other consumer of
`applyMcpConfig` merge behavior (collision, disabled_mcps, user-override precedence) plus
the compat-core namespacing loader, all green. Typecheck is clean with no suppressions.

## WHAT WAS OMITTED

No live OpenCode harness QA was driven: this task is timeboxed (15-minute ship window)
and scoped to Bun tests + typecheck + evidence per task directive. Residual risk: a user
who relied on the namespaced plugin MCP overriding a same-named native server now gets
the native definition; the warning log makes this visible. Raw logs contain no secrets;
test fixtures use example.com / figma.com URLs only.
