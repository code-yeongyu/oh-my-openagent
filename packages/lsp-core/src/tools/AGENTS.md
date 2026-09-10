# lsp-core/src/tools — LSP MCP Tool Registry

## OVERVIEW

The model-facing boundary: 9 tool descriptors, argument coercion, dispatch, and the standardized result shape consumed by `src/mcp.ts`. Earned its own file as a distinct contract domain (score 8) whose wording is pinned by a test. Parent: [`packages/lsp-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Tool names, aliases, schemas | `definitions.ts` |
| Name/alias lookup + `coerceToolArguments` | `runtime.ts` |
| `require*` / `optional*` argument extraction | `parameters.ts` |
| JSON-schema helper | `schema.ts` |
| `text()` result builder | `result.ts` |
| Handlers | `status.ts`, `diagnostics.ts`, `navigation.ts` (goto + references), `symbols.ts`, `rename.ts` (prepare + rename), `format.ts`, `install-decision.ts` |
| Result/detail types per tool | `types.ts` |

## CONVENTIONS

- Every descriptor carries a bare `name` (`format`) plus an `lsp_`-prefixed alias (`lsp_format`); `executeLspTool()` accepts either, so both spellings are public.
- Handlers never throw raw errors at the model: an unavailable server becomes `missingDependencyResult(...)`, and a capability the server does not advertise becomes a `status: "unavailable"` detail rather than a failure.
- Results pair human-readable text with a typed `details` object; keep the two in sync when adding a field.
- `coerceToolArguments()` turns any non-record input into `{}` - argument validation belongs in the handler via `parameters.ts`, not in the caller.

## ANTI-PATTERNS

- Never reword a tool name, title, description, or schema casually: `src/tool-surface.test.ts` pins the whole surface, and the text is a model-facing contract.
- Never add a second dispatch path around `LSP_MCP_TOOLS`, and never register a tool without its alias.
- Never let a handler mutate the workspace outside the LSP plan/commit pipeline.

## QA

```bash
bun test packages/lsp-core/src/tools/ packages/lsp-core/src/tool-surface.test.ts
```

The surface test is the gate for any descriptor change; run it with every edit here.
