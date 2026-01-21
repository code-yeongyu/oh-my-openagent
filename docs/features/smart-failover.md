# Smart Provider Failover

## 1. Overview
In multi-model environments, providers often hit **429 (Rate Limits)**, **Insufficient Balance**, or **Quota Exhaustion**.
The Smart Failover system provides an automated detection and recovery mechanism, ensuring uninterrupted service by switching to healthy fallback models instantly.

## 2. Key Features
- **Pipe Syntax (`|`)**: Minimalist fallback chain definitions.
- **Instant Failover**: Aborts OpenCode's internal retry loops to trigger immediate model swapping.
- **Error Diagnosis**: Parses `Retry-After` headers and vendor-specific error payloads.
- **Guardrails**:
  - **Context Compatibility**: Skips fallbacks with insufficient context windows.
  - **Half-Open Probation**: Tests cooling providers with a single probe before full recovery.
  - **Memory Safety**: Automatic cleanup upon session deletion.

## 3. Configuration
Smart Failover is enabled by defining a fallback chain in `model`.

### 3.1 Model Fallback Chain
You can define the fallback chain using either:

- **Pipe syntax** (string)
- **Array syntax** (string[])

Both forms are equivalent: the first entry is the primary model, and the rest are fallbacks.

### Example
```jsonc
{
  "model": "openai/gpt-5.2-codex | google/gemini-3-pro",
  "failover": {
    "strategy": "auto"
  }
}
```

### Array Example
```jsonc
{
  "model": ["openai/gpt-5.2-codex", "google/gemini-3-pro"]
}
```

`model` can also be configured per-agent (e.g. `agents.Sisyphus.model`) and in category configs. Those locations also accept either pipe syntax or an array.

### 3.2 Failover Strategy
`failover.strategy` currently does not change runtime behavior. It is accepted by the config schema for forward-compatibility.

Current behavior matches an “auto” style flow:
- Detects retry loops and certain provider errors (e.g. 429 / 5xx, quota/rate-limit signals).
- Moves providers into COOLING with exponential backoff, then PROBATION, and finally HEALTHY after a successful probe.
- Locks providers on balance/quota exhaustion signals and avoids them until reset.

## 4. UI/UX
- **Notification**: A yellow toast appears: `⚠️ Switched to google/gemini-3-pro`.
- **Throttling**: Toasts are shown only once per session to prevent UI spam.
