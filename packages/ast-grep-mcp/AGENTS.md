# packages/ast-grep-mcp - ast-grep stdio MCP

## OVERVIEW

Local stdio MCP server (`@oh-my-opencode/ast-grep-mcp`, private, bin `omo-ast-grep`) exposing structural code search/rewrite via the `sg` (ast-grep) CLI. Server name `ast_grep`, 3 tools: `search`, `rewrite`, `scan`. Built on `mcp-stdio-core` + `utils`.

## STRUCTURE

```
src/
├── cli.ts          # stdio entry (bundled to dist/cli.js by `bun run build`)
├── index.ts        # barrel: AST_GREP_MCP_NAME + mcp exports
├── mcp.ts          # tool defs, JSON-RPC handling, runMcpStdioServer
├── sg-runner.ts    # spawns sg with JSON output, bounded timeout
├── normalize.ts    # match/diagnostic normalization
├── pattern-hints.ts# rejects likely-invalid patterns ($$NAME etc.); `force` bypasses
└── tools/          # search.ts / rewrite.ts / scan.ts implementations
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add/modify a tool schema | `src/mcp.ts` (tool defs) + `src/tools/*.ts` |
| sg process invocation, timeouts | `src/sg-runner.ts` |
| Pattern validation hints | `src/pattern-hints.ts` |
| Senpi plugin staging | `packages/omo-senpi/plugin/scripts/stage-ast-grep-mcp-runtime.mjs` (copies `dist/cli.js` to plugin `runtime/ast-grep-mcp/`) |

## CONVENTIONS

- Rewrite/scan apply is two-phase: bounded JSON preview first, then a separate `--update-all` pass; truncated previews are never applied.
- `rewrite` may only reference metavariables captured by the pattern; empty replacement deletes the match.
- Byte-counted limits: pattern 16 KiB, rewrite/inlineRules 64 KiB (UTF-8 bytes, not chars); runner caps: JSON record 1 MiB, stderr 64 KiB, MCP payload 4 MiB.
- Matches: `maxMatches` 1-500, default 50. Timeout: default and max 300000 ms.

## ANTI-PATTERNS

- Never combine JSON output and mutation in one `sg` invocation (sg cannot do both safely).
- No ambient `sgconfig.yml` discovery in `scan`: exactly one explicit rule source (`ruleFile` XOR `inlineRules`).
- Model-facing tool descriptions are verbatim contracts (`search`'s is marked `do not modify`) — never reword them.
- `sg` CLI name is deprecated in favor of `ast-grep`; the runner still invokes `sg` — don't churn the binary name.
