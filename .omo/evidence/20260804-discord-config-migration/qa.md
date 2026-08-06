# Isolated OpenCode CLI QA

## What was tested

Surface: real source CLI and runtime config loader in the task-owned worktree.

Input artifact:

`legacy-input.jsonc`

```json
{
  "[opencode]": {
    "agents": {
      "explore": {
        "model": "anthropic/claude-fable-5",
        "variant": "high",
        "fallback_models": [
          {
            "model": "openai/gpt-5.6-sol-fast",
            "variant": "medium"
          }
        ]
      }
    }
  }
}
```

Isolation:

- `source script/agent/qa-sandbox.sh`
- isolated XDG data/config/cache/state directories
- isolated `CODEX_HOME`
- isolated `HOME` for `~/.omo/omo.jsonc`
- `OPENCODE_DISABLE_AUTOUPDATE=1`
- `OPENCODE_DISABLE_MODELS_FETCH=1`

Actions:

1. Run `bun run packages/omo-opencode/src/cli/index.ts config migrate --json`.
2. Hash the migrated `~/.omo/omo.jsonc`.
3. Run the same migration a second time and hash again.
4. Run `bun run packages/omo-opencode/src/cli/index.ts doctor --json --platform=opencode`.
5. Run `validatePluginConfig()` against a project directory under the isolated home.
6. Compare OpenCode session counts before and after.

## What was observed

Migration:

```text
first exit: 0
second exit: 0
first hash:  355e7fec9b8481c9f312576e636bf975ea1807588e037c386d9212165664381a
second hash: 355e7fec9b8481c9f312576e636bf975ea1807588e037c386d9212165664381a
```

The migrated config contains:

```json
{
  "[opencode]": {
    "agents": {
      "explore": {
        "models": [
          {
            "model": "anthropic/claude-fable-5",
            "reasoning": "high"
          },
          {
            "model": "openai/gpt-5.6-sol-fast",
            "reasoning": "medium"
          }
        ]
      }
    }
  },
  "_migrations": [
    "2026-08-reasoning-unification"
  ]
}
```

Doctor configuration checks:

```text
Configuration: pass — Configuration is valid
Configuration: pass — No deprecated reasoning keys found
hasUnknownModels: false
hasDeprecatedHarness: false
```

The overall doctor exit was `1` only because the intentionally empty isolated OpenCode config does not register the plugin. That unrelated system check is expected in this hermetic scenario.

Runtime-loaded agent config:

```json
{
  "valid": true,
  "messages": [],
  "explore": {
    "model": "anthropic/claude-fable-5",
    "reasoning": "high",
    "fallback_models": [
      {
        "model": "openai/gpt-5.6-sol-fast",
        "reasoning": "medium"
      }
    ]
  }
}
```

OpenCode database isolation:

```text
sessions before: 0
sessions after:  0
```

## Why it is enough

- The exact legacy plugin keys reported in Discord and issue #6567 were passed through the real migration command.
- Hash equality proves repeated migration is idempotent.
- The real doctor configuration checks prove the canonical output is accepted and does not produce the reported warning spam.
- The runtime loader proves the migrated canonical chain reaches the execution-facing `model`, `reasoning`, and `fallback_models` fields instead of falling back to defaults.
- Session count equality proves the QA did not pollute the real or isolated OpenCode session database.

## Cleanup receipt

Removed and verified absent:

- `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-qa-sandbox.XXXXXX.S4qmb1Nm5K`
- `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-qa-sandbox.XXXXXX.yuwTgRcO5b`

No server, port, tmux session, browser tab, container, socket, or QA-only environment remains.

After the harness-scope correction, the affected isolated doctor scenario was re-run:

```text
migration exit: 0
Configuration: pass — Configuration is valid
Configuration: pass — No deprecated reasoning keys found
hasUnknownModels: false
hasDeprecatedHarness: false
sessions: 0 → 0
QA root removed: verified
```

## What was omitted

- `.env` contents, provider credentials, auth headers, tokens, and private model-cache data.
- Unrelated doctor output for missing plugin registration and absent model cache, except the summarized reason for the overall exit code.
- The first dummy-model QA run is not used as runtime selection evidence because unknown model IDs correctly resolved to defaults; it is retained only in the cleanup receipt.
