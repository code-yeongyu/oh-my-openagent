# think-mode — Native Reasoning Variant Hook

## OVERVIEW

Session-tier hook that detects think-mode keywords and sets the native output variant to `high` for supported models. It preserves the selected model and keeps detection, normalization, and switching as separate modules.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook and lifecycle state | `hook.ts` |
| Keyword detection | `detector.ts` |
| Model variant mapping | `switcher.ts` (`HIGH_VARIANT_MAP`, `ALREADY_HIGH`) |
| Public types/exports | `index.ts`, `types.ts` |

## CONVENTIONS

- Strip fenced and inline code before matching keywords so code examples do not activate think mode.
- Normalize provider/model IDs consistently, preserve provider prefixes, and set `output.message.variant` rather than replacing the model.
- Keep multilingual keyword tables and model compatibility mappings in focused modules.
- Per-session `ThinkModeState` lives in a module-level map; clear it with `clearThinkModeState` and on `session.deleted`.
- Skip work when the message already carries a `variant`, when no model is present, or when the model is already a high variant.
- Tests are colocated Bun tests; state reset is explicit.

## ANTI-PATTERNS

- Do not trigger think mode solely from text inside code spans or code fences.
- Do not replace the selected model to obtain a reasoning variant.
- `getHighVariant()` remains a compatibility helper; new hook behavior should use native variants.
- Do not leave session state behind after deletion; the map is process-global.
