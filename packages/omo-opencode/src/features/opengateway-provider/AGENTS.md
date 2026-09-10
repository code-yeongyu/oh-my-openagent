# src/features/opengateway-provider/ — OpenGateway Provider Adapter

Earned its file: score 9, distinct domain — small code surface guarding a large generated artifact with its own shape contract.

## OVERVIEW

OpenCode config adapter for the OpenGateway provider plus the checked-in model catalog generated from OpenGateway and models.dev data.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Provider injection | `index.ts` (`applyOpenGatewayProviderConfig`) |
| Catalog data | `opengateway-models.json` |
| Catalog shape/ordering coverage | `opengateway-models.shape.test.ts` |
| Provider config coverage | `index.test.ts` |

## CONVENTIONS

- Provider defaults are injected only when an OpenGateway credential is present.
- User-provided provider and model objects remain authoritative; merge only missing values and deep-clone catalog defaults.
- The catalog JSON uses lexicographically sorted keys, two-space indentation, and a trailing newline.
- Generation is handled by the sibling script directory; this feature consumes the tracked artifact at runtime.

## RELATED

| Where | What |
|-------|------|
| `packages/omo-opencode/scripts/` | Generator that produces `opengateway-models.json` and its retired-model policy |
| `src/config/schema/` | Provider and model configuration shapes merged with these defaults |

## ANTI-PATTERNS

- Do not overwrite complete user model objects with catalog entries.
- Do not add catalog entries that lack tool-call support when sourced from models.dev.
- Do not hand-edit or reformat the generated catalog; update it through the generator and keep its shape tests passing.
