# Hook Cadence Control

## Overview

The hook cadence system allows you to control how frequently hooks inject content into the AI assistant's context. This helps optimize token usage by reducing the frequency of static prompt injections that don't need to appear on every turn.

## Motivation

oh-my-opencode uses hooks to inject various types of content (delegation guides, rules, reminders, etc.) into the AI context. Many of these hooks inject substantial content that doesn't change between turns. Re-injecting thousands of static tokens every single turn wastes context window budget and can degrade performance.

With hook cadence control, you can configure each hook to fire every N turns instead of every turn, allowing you to tune the trade-off between prompt reinforcement and token efficiency.

## Configuration

Add a `hook_cadence` field to your `oh-my-opencode.json` configuration file:

```json
{
  "hook_cadence": {
    "agent-usage-reminder": 3,
    "rules-injector": 5,
    "category-skill-reminder": 4
  }
}
```

### Configuration Format

- **Field name**: `hook_cadence` (optional)
- **Type**: Object mapping hook names to positive integers
- **Keys**: Valid hook names (see [Available Hooks](#available-hooks) below)
- **Values**: Positive integers representing the firing interval
  - `1` = fire every turn (default behavior)
  - `3` = fire on turns 1, 4, 7, 10, ...
  - `5` = fire on turns 1, 6, 11, 16, ...

### Firing Logic

For a hook with cadence `N`:
- The hook fires on turn 1 (first qualifying event)
- Then fires every Nth turn after that
- Formula: `turnCount === 1 || (turnCount - 1) % N === 0`

Example with cadence = 3:
- Turn 1: ✓ fires
- Turn 2: ✗ skipped
- Turn 3: ✗ skipped
- Turn 4: ✓ fires
- Turn 5: ✗ skipped
- Turn 6: ✗ skipped
- Turn 7: ✓ fires
- ...and so on

## Available Hooks

The following hooks support cadence control:

### Session Hooks
- `agent-usage-reminder` - Reminds about agent delegation capabilities
- `context-window-monitor` - Monitors context window usage
- `session-recovery` - Handles session recovery
- `session-notification` - Session notifications
- `think-mode` - Think mode prompts
- `anthropic-context-window-limit-recovery` - Context window limit recovery
- `auto-update-checker` - Checks for updates
- `non-interactive-env` - Non-interactive environment handling
- `interactive-bash-session` - Interactive bash session handling
- `ralph-loop` - Ralph loop detection
- `edit-error-recovery` - Edit error recovery
- `json-error-recovery` - JSON error recovery
- `delegate-task-retry` - Delegate task retry logic
- `start-work` - Start work prompts
- `prometheus-md-only` - Prometheus markdown-only mode
- `sisyphus-junior-notepad` - Sisyphus junior notepad
- `sisyphus-gpt-hephaestus-reminder` - Sisyphus GPT Hephaestus reminder
- `anthropic-effort` - Anthropic effort tracking

### Tool Guard Hooks
- `rules-injector` - Injects rules from `.rules` files
- `comment-checker` - Checks for comments
- `tool-output-truncator` - Truncates tool output
- `directory-agents-injector` - Injects directory-level agents
- `directory-readme-injector` - Injects directory README files
- `empty-task-response-detector` - Detects empty task responses

### Skill Hooks
- `category-skill-reminder` - Reminds about category and skill delegation

## Backward Compatibility

- When `hook_cadence` is not present in the config, all hooks fire every turn (existing behavior)
- Hooks not listed in `hook_cadence` default to cadence = 1 (every turn)
- Existing configurations continue to work without modification

## Implementation Details

### Architecture

The cadence system consists of three main components:

1. **HookCadenceTracker** (`src/plugin/hook-cadence-tracker.ts`)
   - Maintains per-hook, per-session turn counters
   - Implements the firing logic
   - Handles session cleanup

2. **wrapHookWithCadence** (`src/plugin/wrap-hook-with-cadence.ts`)
   - Wraps hook handlers with cadence gating logic
   - Intercepts `tool.execute.after` and `tool.execute.before` handlers
   - Ensures session cleanup events always pass through

3. **Integration in hook factories**
   - `create-session-hooks.ts` - Session-level hooks
   - `create-tool-guard-hooks.ts` - Tool guard hooks
   - `create-skill-hooks.ts` - Skill hooks

### Turn Tracking

- Turns are tracked per-hook per-session
- Each hook has an independent counter
- Counters are automatically cleaned up when sessions are deleted or compacted
- Counters persist across the session lifecycle

### Composability

The cadence system layers on top of existing hook logic:
- Works alongside `isHookEnabled()` checks
- Preserves hooks' internal conditional logic (e.g., `category-skill-reminder` still counts tool calls)
- A hook must pass both gates: enabled AND cadence permits firing

## Usage Examples

### Conservative Token Savings
Reduce frequency of static content while maintaining regular reinforcement:

```json
{
  "hook_cadence": {
    "agent-usage-reminder": 2,
    "rules-injector": 2
  }
}
```

### Aggressive Token Optimization
Maximize token savings for long-running sessions:

```json
{
  "hook_cadence": {
    "agent-usage-reminder": 5,
    "rules-injector": 10,
    "category-skill-reminder": 5
  }
}
```

### Targeted Optimization
Only reduce frequency for the most verbose hooks:

```json
{
  "hook_cadence": {
    "rules-injector": 5
  }
}
```

## Testing

The cadence system includes comprehensive unit tests:

```bash
bun test src/plugin/hook-cadence-tracker.test.ts
```

Test coverage includes:
- Default cadence behavior (cadence = 1)
- Various cadence values (2, 3, 5)
- Independent counters per hook
- Independent counters per session
- Session cleanup
- Empty/undefined config handling

## Performance Impact

### Token Savings
- **agent-usage-reminder** with cadence 3: ~67% reduction in injection frequency
- **rules-injector** with cadence 5: ~80% reduction in injection frequency
- Actual token savings depend on hook content size and session length

### Trade-offs
- **Higher cadence**: More token savings, less frequent reinforcement
- **Lower cadence**: More frequent reinforcement, fewer token savings

### Recommendations
- Start with cadence 2-3 for most hooks
- Use cadence 5-10 for very verbose hooks with static content
- Monitor AI behavior and adjust as needed

## Troubleshooting

### Hook not firing at expected frequency
- Verify the hook name in config matches exactly (case-sensitive)
- Check that the hook is enabled (not in `disabled_hooks`)
- Ensure the hook's qualifying events are actually occurring

### Config validation errors
- Hook names must be valid (see [Available Hooks](#available-hooks))
- Cadence values must be positive integers (> 0)
- Use the JSON schema for validation: `"$schema": "./assets/oh-my-opencode.schema.json"`

### Session state issues
- Session counters are automatically cleaned up on session deletion/compaction
- Each session starts with fresh counters (turn 1 always fires)

## Future Enhancements

Potential improvements for future versions:
- Per-event-type cadence tracking (separate counters for tool.execute vs. event handlers)
- Dynamic cadence adjustment based on context window usage
- Cadence presets (conservative, balanced, aggressive)
- Per-hook cadence recommendations based on content size
