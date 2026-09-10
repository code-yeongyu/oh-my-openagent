# agents - Agent Definitions and Resolution

## OVERVIEW
Loads markdown, registered, and `omo.json` agent definitions, then resolves persona, tools, execution mode, and a live model.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Loading and precedence | `loader.ts`, `paths.ts`, `markdown.ts`, `omo-overlay.ts` | Markdown locations, registrations, then `omo.json` overlays. |
| Agent resolution | `resolve-agent.ts`, `resolve-agent-categories.ts` | Explicit model, configured models, categories, then builtin fallback. |
| Builtins | `builtin/` | Curated read-only agents and ULW reviewer agents. |
| Invocation policy | `invocation-guard.ts`, `interaction-policy.ts` | Plan gate and one-shot behavior. |
| Tool rules | `schema.ts`, `registry.ts`, `tools.ts` | Definition validation and allow/deny resolution. |

## CONVENTIONS
- `loadAgents` returns `{ agents, diagnostics }`; malformed files are diagnostics rather than silent drops.
- User/project `omo.json` overlays are applied last, so local configuration can override defaults.
- Agent resolution records `resolved_model.source: "agent"`; persona fields remain separate from model selection.
- Builtin fallback tables are hand-mirrored and must not add a `model-core` dependency.

## ANTI-PATTERNS
- A disabled agent resolves as unavailable; do not make it spawnable by bypassing the resolver.
- Do not resolve resume models from stale persisted registries; use live provider/model identity.
- Do not let plan-gated `metis` or `momus` bypass `invocation-guard.ts`.
- Do not use curated read-only names for process-mode team members.

## HOTSPOTS
- `resolve-agent.ts` (264 lines) concentrates persona assembly and the whole model-resolution ladder.
- `resolve-agent-categories.ts` (154) owns category-sourced model selection and chain extension.
- `builtin/` holds the largest persona prompt data; its prompt-level NEVER/ALWAYS text is agent instruction, not code policy.

## QA
```sh
bun test packages/senpi-task/src/agents
```

Parent: [`../AGENTS.md`](../AGENTS.md).
