# Orchestrator-Sisyphus Configuration Examples

The orchestrator model can be configured using the canonical `orchestrator-sisyphus` key:

## Canonical key (recommended)

```json
{
  "agents": {
    "orchestrator-sisyphus": {
      "model": "anthropic/claude-opus-4-5",
      "temperature": 0.1
    }
  }
}
```

## Legacy PascalCase key (auto-normalized)

For backwards compatibility, `Orchestrator-Sisyphus` is automatically normalized to `orchestrator-sisyphus`:

```json
{
  "agents": {
    "Orchestrator-Sisyphus": {
      "model": "anthropic/claude-opus-4-5",
      "temperature": 0.1
    }
  }
}
```

**Note:** This works transparently at config load time. The schema only includes the canonical `orchestrator-sisyphus` key, but the PascalCase variant is accepted and normalized automatically.

## Priority

If both keys are present, `orchestrator-sisyphus` takes precedence:

```json
{
  "agents": {
    "orchestrator-sisyphus": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "Orchestrator-Sisyphus": {
      "model": "anthropic/claude-opus-4-5"
    }
  }
}
```

Result: Uses `anthropic/claude-sonnet-4-5` (canonical key wins)
