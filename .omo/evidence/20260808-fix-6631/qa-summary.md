# QA Evidence - fix(mcp-client-core): propagate request timeouts to the SDK (#6631)

## What was tested

- A live stdio MCP server (`slow-server.ts`) exposing a `wait` tool that sleeps
  for a given number of seconds, driven through the real `SkillMcpManager`
  (`driver.ts`). This is the exact reproduction the issue describes: a 65 second
  tool call over the direct MCP execution path.
- A negative control that reverts only the `manager.ts` threading and re-runs
  both the driver and the new unit tests.
- The new co-located test file
  `packages/mcp-client-core/src/skill-mcp-manager/request-timeouts.test.ts`.
- `bun run typecheck` and the full root `bun test` suite, plus the MCP client and
  skill loader suites on their own.

## What was observed

### Live surface, with the fix (`driver-after-fix.txt`)

```
[no-timeout-config]         FAILED after 60.1s -> McpError: MCP error -32001: Request timed out
[requestTimeoutMs=120000]   OK     after 65.1s -> [{"type":"text","text":"waited 65s"}]
```

The first line reproduces the reported defect against a real server: with no
timeout configured the SDK default of 60000 ms still applies, so a 65 second
tool dies at 60.1 seconds. The second line is the fix: a server that sets
`timeouts.requestTimeoutMs` to 120000 completes the same call at 65.1 seconds.

### Negative control (`negative-control.txt`)

With only the `manager.ts` call-site threading reverted, and the config type,
the resolver, and the tests left in place:

```
6 pass / 2 fail   (both manager propagation tests fail)
[no-timeout-config]         FAILED after 60.1s
[requestTimeoutMs=120000]   FAILED after 60.1s
```

The configured 120 second timeout has no effect without the threading, which
proves the tests and the driver depend on the change rather than on the new
config field existing.

### Unit tests, with the fix (`green.txt`)

`8 pass / 0 fail`. Coverage: no config resolves to `undefined` so the SDK default
stands, server fields map onto the SDK option names, a per-call override wins
field by field, non-positive and non-finite values are dropped,
`resetTimeoutOnProgress: false` is still forwarded, and all six operations
(`listTools`, `listResources`, `listPrompts`, `callTool`, `readResource`,
`getPrompt`) forward the resolved options.

### Typecheck (`typecheck.txt`)

`bun run typecheck` exit 0, no diagnostics.

### Related suites (`related-suites.txt`)

`bun test` over `packages/mcp-client-core`, the `omo-opencode`
`skill-mcp-manager` shim tests, the `claude-code-mcp-loader`, and
`skills-loader-core`: `399 pass / 0 fail`.

### Full root suite (`full-suite.txt`)

Baseline `13295 pass / 28 fail`, with this change `13303 pass / 28 fail`. The
failing-test name sets are identical on both sides. Those 28 are local
environment failures only: this checkout installed with `--ignore-scripts` and
without the frontend provenance submodules, so the senpi and codex runtime
bundles and the ATTRIBUTION pins are absent.

## Why it is enough

The defect is a dropped argument at six SDK call sites, and there was no config
field to drop in the first place. The driver exercises the real production path
end to end against a real MCP server over stdio, shows the 60 second ceiling
before the fix and a successful 65 second call after it, and the negative
control shows the ceiling returns the moment the threading is removed. The unit
tests pin the resolution rules that the driver cannot cover cheaply, in
particular that an unconfigured server sends no request options at all, so the
SDK default is untouched for everyone who does not opt in.

## What was omitted

- No OpenCode harness drive. The change is confined to a Core package with no
  OpenCode surface: it adds an optional config field and forwards it, and the
  `packages/omo-opencode/src/features/skill-mcp-manager/` files are re-export
  shims that are unchanged. The maintainer should say so if a harness-level QA
  run is still wanted here.
- No secrets, tokens, or env dumps appear in any artifact. The test server is
  local and needs no credentials.
