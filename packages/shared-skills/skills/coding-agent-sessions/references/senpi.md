# Senpi / pi Coding-Agent Sessions

Observed Senpi layout:

- `~/.senpi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`
- `~/.senpi/agent/settings.json`, `models.json`, and `auth.json` provide environment context.
- `~/.pi/agent/sessions/**` can use the same family of JSONL formats.

Common event types:

- `session`: includes `id`, `timestamp`, and `cwd`.
- `model_change`: includes `provider` and `modelId`.
- `thinking_level_change`: includes effort metadata.
- `message`: wraps provider-native messages, tool calls, usage, and costs.
- `custom` with `customType: senpi.todo-state`: stores todo state.

Prefer Senpi usage fields when present: `usage.input`, `usage.output`, `usage.cacheRead`, `usage.cacheWrite`, `usage.totalTokens`, and `usage.cost.total`.
