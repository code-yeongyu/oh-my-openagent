# Senpi / pi Family Coding-Agent Sessions

The pi family (Senpi, oh-my-pi, gajae-code) shares one session format, so one scanner serves all three under separate platform keys.

| Platform key | Aliases | Config root | Sessions |
|---|---|---|---|
| `senpi` | - | `~/.senpi`, `~/.pi` | `<root>/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` |
| `oh-my-pi` | `omp`, `ohmypi` | `~/.omp` | `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` |
| `gajae-code` | `gjc`, `gajae` | `~/.gjc` | `~/.gjc/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` |

Extra roots scanned for every pi-family platform:

- Named profiles: `<config-root>/profiles/<profile>/agent/sessions/**`.
- XDG stores (macOS/Linux, default profile): `$XDG_DATA_HOME/<app>/sessions/**` and `$XDG_DATA_HOME/<app>/profiles/<profile>/sessions/**`, where `<app>` is `senpi`, `omp`, or `gjc`. XDG flattens the `agent/` path segment.
- A custom `PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` / `GJC_CONFIG_DIR` store: pass that agent directory with `--root`.

`~/.senpi/agent/settings.json`, `models.json`, and `auth.json` provide environment context; oh-my-pi and gajae-code keep the same files plus `config.yml` and `models.yml` next to their sessions directory.

Common event types:

- `session`: includes `id`, `timestamp`, and `cwd`.
- `model_change`: includes `provider` and `modelId`.
- `thinking_level_change`: includes effort metadata.
- `message`: wraps provider-native messages, tool calls, usage, and costs.
- `custom` with `customType: senpi.todo-state`: stores todo state.

Prefer Senpi usage fields when present: `usage.input`, `usage.output`, `usage.cacheRead`, `usage.cacheWrite`, `usage.totalTokens`, and `usage.cost.total`.
