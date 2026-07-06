# omo-config-core - Harness-Neutral OMO Config Schema

Core package for the future `omo.json` config surface. Keep it harness-neutral:
no OpenCode, Codex, Senpi, Pi, or adapter imports.

## Boundaries

- Public API lives in `src/index.ts`.
- Schemas live under `src/schema/` and use Zod v4.
- Keep category field names in exact parity with `packages/omo-opencode/src/config/schema/categories.ts`, including camelCase exceptions.
- Do not add loader, writer, or generated schema code here unless the task explicitly asks for that todo.
