# Hook Cadence Control

## Overview

The hook cadence system allows you to control how frequently hooks inject content into the AI assistant's context. Instead of configuring each hook individually, you configure **5 logical groups** that control **13 gatable hooks**. The remaining 32 hooks always fire because they are zero-cost, reactive-safety, state-critical, or have complex types that cannot be wrapped.

## Why Grouped Cadence?

oh-my-opencode uses hooks to inject various types of content (delegation guides, rules, reminders, etc.) into the AI context. Many of these hooks inject substantial content that doesn't change between turns. Re-injecting thousands of static tokens every single turn wastes context window budget and can degrade performance.

With grouped cadence control, you can tune the firing frequency for logical categories of hooks, optimizing token usage while maintaining the right balance of prompt reinforcement.

## Configuration

Add a `hook_cadence` field to your `oh-my-opencode.json` configuration file:

```json
{
  "hook_cadence": {
    "tool_guidance": 2,
    "context_injection": 3,
    "reminders": 3,
    "continuation": 2,
    "error_recovery": 1
  }
}
```

All fields are optional. If omitted, each group uses its default value.

## Cadence Groups

### 1. `tool_guidance` (Default: 2)

**Purpose**: Teaches the agent how to use delegation tools and available skills.

**Hooks**:
- `agent-usage-reminder` — Reminds about agent delegation patterns
- `category-skill-reminder` — Reminds about available skills and categories
- `atlas` — Delegation guidance for orchestrator agents

**What they inject**: Medium-sized prompts (~500-2000 tokens) explaining delegation patterns, available agents, and skill categories.

**Recommended range**: 2-4
- Lower values (2): Agent learns delegation patterns quickly
- Higher values (4): Reduces token usage, but agent may forget delegation options

---

### 2. `context_injection` (Default: 3)

**Purpose**: Injects project-specific context like rules, READMEs, and agent configs.

**Hooks**:
- `rules-injector` — Project `.rules` files
- `directory-agents-injector` — Directory-level agent configurations
- `directory-readme-injector` — README content from directories
- `start-work` — Boulder state and plan context (heavy)

**What they inject**: Variable-sized content (100-5000+ tokens) depending on project structure. `start-work` can be particularly heavy with large boulder states.

**Recommended range**: 3-10
- Lower values (3): Frequent reinforcement of project context
- Higher values (10): Significant token savings for stable projects

---

### 3. `reminders` (Default: 3)

**Purpose**: Periodic reminders about task tools, notepads, and API parameters.

**Hooks**:
- `sisyphus-junior-notepad` — Notepad directive for Atlas workers
- `anthropic-effort` — `effort=max` parameter injection

**What they inject**: Small-to-medium prompts (~200-800 tokens) reminding about available tools and best practices.

**Recommended range**: 2-5
- Lower values (2): Frequent reminders keep tools top-of-mind
- Higher values (5): Reduces repetition for experienced agents

---

### 4. `continuation` (Default: 2)

**Purpose**: Prompts the agent to continue working when idle.

**Hooks**: *(Currently empty - todo-continuation-enforcer has a complex type and cannot be wrapped)*

**Note**: This group is reserved for future continuation hooks. The existing `todo-continuation-enforcer` hook has additional methods beyond handlers, making it incompatible with the wrapper. It always fires (cadence=1).

---

### 5. `error_recovery` (Default: 1)

**Purpose**: Provides recovery guidance when errors occur.

**Hooks**:
- `edit-error-recovery` — Edit failure recovery guidance
- `json-error-recovery` — JSON parse error recovery
- `delegate-task-retry` — Task delegation failure retry
- `anthropic-context-window-limit-recovery` — Token limit compaction trigger

**Note**: `session-recovery` has additional methods beyond handlers and cannot be wrapped. It always fires (cadence=1).

**What they inject**: Small-to-medium prompts (~200-1000 tokens) with error recovery strategies.

**Recommended range**: 1 (always fire)
- These hooks only fire when errors occur
- Skipping error recovery guidance can cause cascading failures
- **Not recommended to increase above 1**

## Which Hooks Are NOT Gatable?

**32 of 45 hooks always fire** regardless of cadence configuration. These fall into five categories:

### Zero Token Cost
These hooks don't inject any prompt content:
- `session-notification`, `background-notification`, `auto-update-checker`, `startup-toast`

### Reactive Safety
These only fire on errors and must not be skipped:
- `ralph-loop`, `stop-continuation-guard`, `unstable-agent-babysitter`

### Transform/Infrastructure
These modify tool output or internal state and would break if skipped:
- `tool-output-truncator`, `grep-output-truncator`, `question-label-truncator`, `comment-checker`, `compaction-context-injector`, `compaction-todo-preserver`, `claude-code-hooks`, `hashline-read-enhancer`, `task-resume-info`

### State-Critical
These must fire at exact moments to maintain correct state:
- `context-window-monitor`, `preemptive-compaction`, `think-mode`, `keyword-detector`, `thinking-block-validator`, `auto-slash-command`, `prometheus-md-only`, `non-interactive-env`, `interactive-bash-session`, `tasks-todowrite-disabler`, `write-existing-file-guard`, `empty-task-response-detector`, `sisyphus-gpt-hephaestus-reminder`

### Complex Types
These have additional methods beyond handlers and cannot be wrapped:
- `session-recovery` — Has `handleSessionRecovery`, `isRecoverableError`, `setOnAbortCallback`, `setOnRecoveryCompleteCallback` methods
- `todo-continuation-enforcer` — Has `markRecovering`, `markRecoveryComplete`, `cancelAllCountdowns` methods

## Firing Logic

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

## Usage Examples

### Conservative (Frequent Reinforcement)
```json
{
  "hook_cadence": {
    "tool_guidance": 2,
    "context_injection": 2,
    "reminders": 2,
    "continuation": 1,
    "error_recovery": 1
  }
}
```
**Token savings**: ~30-40%  
**Use when**: Short sessions, complex tasks, agent needs frequent guidance

---

### Balanced (Recommended)
```json
{
  "hook_cadence": {
    "tool_guidance": 2,
    "context_injection": 3,
    "reminders": 3,
    "continuation": 2,
    "error_recovery": 1
  }
}
```
**Token savings**: ~50-60%  
**Use when**: Most scenarios (this is the default)

---

### Aggressive (Maximum Savings)
```json
{
  "hook_cadence": {
    "tool_guidance": 4,
    "context_injection": 10,
    "reminders": 5,
    "continuation": 3,
    "error_recovery": 1
  }
}
```
**Token savings**: ~70-80%  
**Use when**: Long sessions, stable projects, experienced agents

---

### Targeted (Heavy Context Only)
```json
{
  "hook_cadence": {
    "context_injection": 10
  }
}
```
**Token savings**: ~40-50%  
**Use when**: You only want to reduce frequency of heavy context injection (rules, READMEs, start-work)

## Backward Compatibility

- When `hook_cadence` is not present in the config, all groups use their default values
- Partial configuration is supported — omitted groups use defaults
- Existing configurations continue to work without modification

## Performance Impact

### Token Savings Potential

- **tool_guidance** with cadence 3: ~67% reduction in injection frequency
- **context_injection** with cadence 5: ~80% reduction in injection frequency
- **reminders** with cadence 4: ~75% reduction in injection frequency

Actual token savings depend on:
- Hook content size (some hooks inject thousands of tokens)
- Session length (longer sessions benefit more)
- Configured cadence values

### Trade-offs

- **Higher cadence**: More token savings, less frequent reinforcement
- **Lower cadence**: More frequent reinforcement, fewer token savings

## Troubleshooting

### Hook not firing at expected frequency
- Verify the group name in config matches exactly (case-sensitive)
- Check that hooks in the group are enabled (not in `disabled_hooks`)
- Ensure the hook's qualifying events are actually occurring

### Config validation errors
- Group names must be exact: `tool_guidance`, `context_injection`, `reminders`, `continuation`, `error_recovery`
- Cadence values must be positive integers (> 0)
- Use the JSON schema for validation: `"$schema": "./assets/oh-my-opencode.schema.json"`

### Agent forgetting context
- Lower the cadence for `context_injection` or `tool_guidance`
- Some agents need more frequent reinforcement than others

### Too much repetition
- Increase cadence for `reminders` or `tool_guidance`
- Long sessions can tolerate higher cadence values

## Implementation Details

### Architecture

The cadence system consists of four main components:

1. **Cadence Groups** (`src/plugin/hook-cadence-groups.ts`)
   - Defines the 5 groups and their hook mappings
   - Provides `resolveHookCadence()` function

2. **HookCadenceTracker** (`src/plugin/hook-cadence-tracker.ts`)
   - Maintains per-hook, per-session turn counters
   - Implements the firing logic
   - Handles session cleanup

3. **wrapHookWithCadence** (`src/plugin/wrap-hook-with-cadence.ts`)
   - Wraps hook handlers with cadence gating logic
   - Intercepts `tool.execute.after` and `tool.execute.before` handlers
   - Ensures session cleanup events always pass through

4. **Integration in hook factories**
   - `create-session-hooks.ts` — Session-level hooks
   - `create-tool-guard-hooks.ts` — Tool guard hooks
   - `create-continuation-hooks.ts` — Continuation hooks
   - `create-skill-hooks.ts` — Skill hooks

### Turn Tracking

- Turns are tracked per-hook per-session
- Each hook has an independent counter
- Counters are automatically cleaned up when sessions are deleted or compacted
- Counters persist across the session lifecycle

## Testing

The cadence system includes comprehensive unit tests:

```bash
bun test src/plugin/hook-cadence-tracker.test.ts
```

Test coverage includes:
- Grouped cadence behavior
- Default values
- Independent counters per hook and session
- Session cleanup
- Hook resolution logic
