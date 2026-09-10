# category - Builtin Category Routing

## OVERVIEW
Provider-specific category tables and the resolver select a model, prompt append, and child spec from the live model registry.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Resolution and availability | `resolver.ts` | Parses models, applies gates, selects fallback rungs, and builds results. |
| Builtin metadata | `builtins.ts` | Defaults, descriptions, prompt appends, gate and chain viability checks. |
| Provider tables | `anthropic-categories.ts`, `google-categories.ts`, `kimi-categories.ts`, `openai-categories.ts` | One typed table per provider family. |
| Fallback policy | `fallback-chains.ts` | Explicit ordered model candidates. |

## CONVENTIONS
- Category definitions are aggregated through `index.ts` with named runtime and type exports.
- A category target is exclusive of `subagent_type`; category routing owns model selection.
- `requiresModel` gates builtin categories against the live registry. Independently, dead fallback chains are unavailable; explicit user config opts out.
- Prompt policy is multiline template data and may vary by resolved model, especially in OpenAI tables.

## ANTI-PATTERNS
- Never silently fall through a gated category when its required model is absent.
- Do not import `model-core` into this layer; use the local delegate-core-compatible model shapes.
- Do not treat a registry probe failure as proof that every category is unavailable; resolver fallback behavior is intentional.

## HOTSPOTS
- `resolver.ts` (468 lines) is the behavioral center: model parsing, availability, gating, chain viability, selection, and prompt appends.
- `openai-categories.ts` (231) carries model-dependent prompt-append resolvers.
- `builtins.ts` holds the parallel description/append/gate maps that must stay aligned with provider tables.

## QA
```sh
bun test packages/senpi-task/src/category
```

Parent: [`../AGENTS.md`](../AGENTS.md).
