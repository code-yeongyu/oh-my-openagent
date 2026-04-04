# Verification Strategy: arXiv MCP

## 1. Type Safety

```bash
bun run typecheck
```

Verify:
- `McpNameSchema` type union includes `"arxiv"`
- `arxiv` export in `arxiv.ts` matches `RemoteMcpConfig` shape
- Import in `index.ts` resolves correctly
- No new type errors introduced

## 2. Unit Tests

```bash
bun test src/mcp/
```

### Existing test updates verified:
- `index.test.ts`: All 7 existing tests pass with updated count (3 → 4)
- `websearch.test.ts`: Unchanged, still passes (no side effects)

### New test coverage:
- `index.test.ts`: New test "should filter out arxiv when disabled" passes
- Arxiv appears in all "all MCPs" assertions
- Arxiv excluded when in `disabled_mcps`

## 3. Build Verification

```bash
bun run build
```

Verify:
- ESM bundle includes `arxiv.ts` module
- Type declarations emitted for `arxiv` export
- No build errors

## 4. Integration Check

### Config disable path
- Add `"arxiv"` to `disabled_mcps` in test config → verify MCP excluded from `createBuiltinMcps()` output
- This is already covered by the unit test, but can be manually verified:

```typescript
import { createBuiltinMcps } from "./src/mcp"
const withArxiv = createBuiltinMcps([])
console.log(Object.keys(withArxiv)) // ["websearch", "context7", "grep_app", "arxiv"]

const withoutArxiv = createBuiltinMcps(["arxiv"])
console.log(Object.keys(withoutArxiv)) // ["websearch", "context7", "grep_app"]
```

### MCP config handler path
- `mcp-config-handler.ts` calls `createBuiltinMcps()` and merges results
- No changes needed there; arxiv automatically included in the merge
- Verify by checking `applyMcpConfig()` output includes arxiv when not disabled

## 5. LSP Diagnostics

```bash
# Run on all changed files
```

Check `lsp_diagnostics` on:
- `src/mcp/arxiv.ts`
- `src/mcp/types.ts`
- `src/mcp/index.ts`
- `src/mcp/index.test.ts`

All must return 0 errors.

## 6. Endpoint Verification (Manual / Pre-merge)

**Critical:** Before merging, verify the arXiv MCP endpoint URL is actually reachable:

```bash
curl -s -o /dev/null -w "%{http_code}" https://mcp.arxiv.org
```

If the endpoint doesn't exist or returns non-2xx, the MCP will silently fail at runtime (MCP framework handles connection errors gracefully). This is acceptable for a built-in MCP but should be documented.

## 7. Regression Check

Verify no existing functionality is broken:
- `bun test` (full suite) passes
- Existing 3 MCPs (websearch, context7, grep_app) still work
- `disabled_mcps` config still works for all MCPs
- `mcp-config-handler.test.ts` passes (if it has count-based assertions, update them)

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun test src/mcp/` passes (all tests green)
- [ ] `bun run build` succeeds
- [ ] `lsp_diagnostics` clean on all 4 changed files
- [ ] arXiv MCP endpoint URL verified reachable
- [ ] No hardcoded MCP count assertions broken elsewhere in codebase
- [ ] AGENTS.md updated to reflect 4 MCPs
