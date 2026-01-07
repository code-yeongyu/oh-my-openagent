# Upstream Sync Migration Guide (January 2026)

This guide documents the changes and new features introduced in the January 2026 upstream sync (LIF-111). This sync brings the latest features and stability improvements from the upstream `code-yeongyu/oh-my-opencode` repository.

## New Features

### 1. Sisyphus Agent
Sisyphus is an experimental senior orchestrator designed for complex, multi-phase projects. It plans obsessively with task breakdowns and delegates strategically to specialists. It can be enabled as the primary orchestrator instead of OmO.

**How to enable:**
Add the following to your `oh-my-opencode.json`:
```json
{
  "sisyphus_agent": {
    "enabled": true
  },
  "primary_orchestrator": "Sisyphus"
}
```

### 2. Preemptive Compaction
Automatically triggers session compaction before hitting hard context limits. By default, it triggers when context usage exceeds 70%.

**Configuration:**
```json
{
  "experimental": {
    "preemptive_compaction": true,
    "threshold": 0.7
  }
}
```

### 3. Compaction Context Injector
Works alongside preemptive compaction to preserve critical session state. When a session is compacted, this hook injects a summary of original requests, current goals, completed work, and remaining tasks to ensure continuity.

### 4. Session Recovery Enhancements
Improved resilience against common LLM session failures:
- **Empty Message Sanitizer**: Prevents API errors caused by empty assistant messages.
- **Thinking Block Validator**: Ensures reasoning continuity for extended thinking models (Claude 4.5/Opus).

### 5. Edit Error Recovery
Automatically attempts to recover from common `edit` tool errors, such as `oldString` not found or multiple matches, by analyzing the file context and providing suggestions or fixes.

### 6. Background Agent Concurrency
Implements model-based concurrency limits for background tasks to prevent hitting provider rate limits and ensure optimal performance.

### 7. OpenCode 1.1.1 Permissions
Full compatibility with OpenCode 1.1.1's new granular permission system. Legacy tool configurations are automatically migrated to the new permission format at runtime.

## New Hooks

The following hooks have been added to improve session stability and performance:

- `preemptive-compaction`: Monitors token usage and triggers proactive compaction.
- `compaction-context-injector`: Preserves critical state during compaction events.
- `empty-message-sanitizer`: Validates and fixes empty assistant messages.
- `thinking-block-validator`: Ensures thinking blocks are correctly formatted and completed.
- `edit-error-recovery`: Auto-recovers from file editing tool failures.

## Breaking Changes

There are no expected breaking changes in this update. Existing configurations and fork-specific tools (Linear, Spec, Memory) remain fully compatible.

## Configuration Changes

New configuration options are available in `oh-my-opencode.json`:

```json
{
  "sisyphus_agent": {
    "enabled": false,
    "model": "anthropic/claude-opus-4-5"
  },
  "primary_orchestrator": "OmO",
  "experimental": {
    "preemptive_compaction": false,
    "threshold": 0.7,
    "dcp": "disabled",
    "auto_resume": false
  },
  "background_agent": {
    "concurrency": {
      "limits": {
        "anthropic/claude-3-5-sonnet": 5,
        "google/gemini-1.5-pro": 3
      }
    }
  }
}
```
