# scripts/ -- Gateway Catalog Generators

**Generated:** 2026-08-24 / f3642fcda

Earned its file: score 8, distinct domain. Only code in this package outside `src/`; nothing in the plugin bundle imports it. Previously absent from the whole AGENTS.md hierarchy.

## OVERVIEW

4 files: `generate-opengateway-models.ts` (fetches the OpenGateway + models.dev catalogs, writes the tracked `src/features/opengateway-provider/opengateway-models.json`) plus its bun:test suite, and `generate-openference-models.ts` (fetches the Openference `GET /v1/models` catalog, which publishes pricing, limits, modalities and reasoning metadata directly, writes the tracked `src/features/openference-provider/openference-models.json`) plus its bun:test suite.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add/refresh a gateway model models.dev cannot enrich | `MODEL_OVERRIDES` (name, reasoning flag, prices, limits) |
| Map a new owner prefix onto a models.dev provider | `OWNER_TO_MODELS_DEV` |
| Enrichment and filters | `buildOpenGatewayCatalog()` -- one loop: `chat_completions` gate, `retired` status drop, owner catalog -> OpenRouter id-space fallback -> override, `tool_call === true` requirement, retired-reference screen |
| Context-tiered pricing | `baseTier()` -- lowest context tier fills the cache cost fields models.dev leaves off the top-level cost object |
| Output format | `serializeOpenGatewayCatalog()` -- lexicographic keys, 2-space indent, trailing newline |
| Policy coverage | `generate-opengateway-models.test.ts` -- enrichment suite + repo retired-model policy suite |
| Refresh the Openference catalog | `generate-openference-models.ts` -- single-source `GET /v1/models` (no auth, no enrichment); gates: text output, `tool_calling === true`, both limits published; `serializeOpenferenceCatalog()` for the same sorted 2-space output format |

## CONVENTIONS (beyond parent)

- Standalone Bun executable: shebang + `import.meta.main` guard; run by path, never wired into package.json scripts.
- Writes OUTSIDE its own tree: output path derived from `import.meta.url` / `import.meta.dir` (cwd-independent), landing in `src/features/opengateway-provider/` or `src/features/openference-provider/`.
- models.dev answers plain programmatic clients with HTTP 403; `fetchJson` sends a browser user-agent. Openference needs no user-agent: its listing answers unauthenticated clients with the full catalog.
- Remote responses typed `unknown`, cast once at the boundary; external shapes and catalog types are `readonly`.
- Fails loud: non-OK HTTP throws; an empty catalog refuses to overwrite the checked-in JSON.
- Missing pricing/limits default to 0-cost and the 4096 `LIMIT_FLOOR` (OpenGateway). Openference instead DROPS entries with unpublished limits -- its docs state `context_length` / `max_output_tokens` may be absent, and an unpublished output limit must not be guessed for `limit.output`.

## ANTI-PATTERNS

- NEVER spell retired model ids or display names literally in this directory. `script/gpt-mini-reference-audit.test.ts` and `packages/omo-opencode/src/shared/current-model-family.test.ts` scan this source text; ids are `join`-assembled and the family pattern uses character classes so this file cannot match the rule it enforces.
- Retired references are screened in BOTH the model id and the emitted display name; the two legacy GPT point releases stay banned on non-test surfaces, `-codex` variants excepted.
- Do not unsort or reformat the JSON: `src/features/opengateway-provider/opengateway-models.shape.test.ts` pins lexicographic owner-prefixed keys and >= 60 entries; `src/features/openference-provider/openference-models.shape.test.ts` pins lexicographic keys and >= 10 entries (Openference ids are NOT owner-prefixed; some contain spaces).
- `tool_call: true` is a hard requirement for models.dev-sourced entries (the harness routes only tool-capable models); override entries assert it by design.
- The drop filter is `status === "retired"` only; generic `deprecated` status is not a drop reason.
- Distinct from `bun run build:model-capabilities` (root `script/build-model-capabilities.ts`); two separate models.dev consumers, do not conflate.

## COMMANDS

```bash
bun run packages/omo-opencode/scripts/generate-opengateway-models.ts   # network: apis.opengateway.ai + models.dev
bun test packages/omo-opencode/scripts/generate-opengateway-models.test.ts
bun run packages/omo-opencode/scripts/generate-openference-models.ts    # network: api.openference.com (unauthenticated)
bun test packages/omo-opencode/scripts/generate-openference-models.test.ts
```
