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
Modify the `model` field in your `oh-my-opencode.json`.

### Example
```jsonc
{
  "model": "openai/gpt-5.2-codex | google/gemini-3-pro",
  "failover": {
    "strategy": "auto"
  }
}
```

## 4. UI/UX
- **Notification**: A yellow toast appears: `⚠️ Switched to google/gemini-3-pro`.
- **Throttling**: Toasts are shown only once per session to prevent UI spam.
