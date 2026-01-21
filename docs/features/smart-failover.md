# Smart Provider Failover

## 1. Overview
In multi-model environments, providers often hit **429 (Rate Limits)**, **Insufficient Balance**, or **Quota Exhaustion**.
The Smart Failover system provides an automated detection and recovery mechanism, ensuring uninterrupted service by switching to healthy fallback models instantly.

## 2. Key Features
- **Pipe Syntax (`|`)**: Minimalist fallback chain definitions.
- **Array Syntax (`string[]`)**: Equivalent to pipe syntax, easier to edit.
- **Instant Failover**: Aborts OpenCode's internal retry loops to trigger immediate model swapping.
- **Error Diagnosis (Best-Effort)**: Classifies common failures (rate-limit, quota, balance) via pattern matching.
- **Guardrails**:
  - **Context Compatibility**: Skips fallbacks with insufficient context windows.
  - **Probation Recovery**: After a cooldown elapses, a model becomes eligible again (PROBATION) and is cleared back to healthy after the session becomes idle.
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
  "model": "openai/gpt-5.2-codex | google/gemini-3-pro"
}
```

### Array Example
```jsonc
{
  "model": ["openai/gpt-5.2-codex", "google/gemini-3-pro"]
}
```

`model` can also be configured per-agent (e.g. `agents.Sisyphus.model`) and in category configs. Those locations also accept either pipe syntax or an array.

## 4. Default Behavior
- **Triggers**: Retry-loop detection (`session.status: retry`) and certain session errors (`session.error`) mark the current `provider/model` as unavailable and switch to the next available fallback.
- **Cooling + Backoff**: A cooling period is applied with exponential backoff based on repeated failures.
- **Locking**: Balance/quota exhaustion signals lock a specific `provider/model` pair (model key) until reset.
- **Fallback Selection**: Only HEALTHY/PROBATION models are eligible; fallbacks with too-small context windows are skipped.

## 5. Limitations
- **Retry-After**: The implementation does not reliably receive response headers in events, so header-based cooldown is best-effort.
- **Probation**: Recovery is approximated by the session becoming idle, not a dedicated health-check request.

## 6. UI/UX
- **Notification**: A yellow toast appears: `⚠️ Switched to google/gemini-3-pro`.
- **Throttling**: Toasts are shown only once per session to prevent UI spam.
