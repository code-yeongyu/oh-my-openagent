# Evidence: issue #6573 disabled-provider fallback resolution

## Scope

Static agent and category fallback entries may list several provider mirrors for one underlying
model. The repair excludes the whole entry when any listed provider is disabled, while preserving
explicit user overrides and their variant inheritance.

The policy lives in model-core and is consumed by model-core, delegate-core, builtin agents,
delegation, `call_omo_agent`, `look_at`, Prometheus, and the runtime fallback controller. Product
adapters pass the readonly constraint and do not implement competing filters.

## Evidence files

| File | Contents |
|------|----------|
| `qa-evidence.md` | Real isolated OpenCode server comparison and database-isolation proof |
| `qa-transcript.log` | Sanitized machine-observed model and tool-registration values |
| `gates.md` | Automated gates, generated-artifact freshness, and native Senpi comparison |
| `cleanup-receipt.md` | Process, sandbox, generated-output, and real-state cleanup record |

## Result

- Baseline OpenCode selected the first mirrored OpenAI/OpenAI-Codex entry for Explore and
  Librarian.
- With only `openai-codex` disabled, both selected the next allowed DeepSeek entry.
- Focused regressions cover model-core, delegate-core, category delegation, the real tool
  registry plus actual `call_omo_agent`, builtin agents, `look_at`, Prometheus, and runtime
  fallback chains.
- Generated Senpi extensions are reproducible from source and passed the same product-scope
  native lifecycle checks as pristine `origin/dev`.
- The only full-root test failure is an unrelated stale Codex installer version assertion that
  reproduces identically on pristine `origin/dev`.
