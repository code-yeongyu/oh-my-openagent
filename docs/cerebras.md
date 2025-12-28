# Cerebras Provider Compatibility Fix

## Problem

When using `opencode run -m cerebras/zai-glm-4.6` with oh-my-opencode enabled, the request fails with:

```
Error: body.maxTokens: property 'body.maxTokens' is unsupported
body.thinking: property 'body.thinking' is unsupported
```

Cerebras API (OpenAI-compatible) does not support:
- `maxTokens` parameter
- `thinking` configuration (extended thinking/reasoning)

## Root Cause

The issue stems from how oh-my-opencode creates agent configurations:

1. **Agent configs are created at plugin load time**, before the `-m` flag is processed
2. The `config` hook receives `config.model = undefined` because OpenCode applies the `-m` flag at session/request level, not config level
3. Agents like Sisyphus and Oracle were hardcoded to add `thinking` and `maxTokens` for non-GPT models:

```typescript
// OLD CODE - sisyphus.ts
if (isThinkingCapableProvider(model)) {
  return { ...base, maxTokens: 64000, thinking: { type: "enabled", budgetTokens: 32000 } }
}
```

4. When `-m cerebras/zai-glm-4.6` is passed, OpenCode uses the Sisyphus agent config (which has `thinking` and `maxTokens` baked in for anthropic model), but tries to send the request to Cerebras - causing the error.

## Solution

### 1. Remove thinking/maxTokens from agent configs

Let OpenCode handle `thinking` and `maxTokens` based on the runtime model, not the config-time model.

**src/agents/sisyphus.ts:**
```typescript
export function createSisyphusAgent(model: string = DEFAULT_MODEL): AgentConfig {
  const base: AgentConfig = {
    description: "...",
    mode: "primary",
    model,
    prompt: SISYPHUS_SYSTEM_PROMPT,
    color: "#00CED1",
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  // Don't set thinking/maxTokens here - let OpenCode handle based on runtime model
  return base
}
```

**src/agents/oracle.ts:**
```typescript
export function createOracleAgent(model: string = DEFAULT_MODEL): AgentConfig {
  const base = {
    description: "...",
    mode: "subagent",
    model,
    temperature: 0.1,
    tools: { write: false, edit: false, task: false, background_task: false },
    prompt: ORACLE_SYSTEM_PROMPT,
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium", textVerbosity: "high" }
  }

  // Don't set thinking here - let OpenCode handle based on runtime model
  return base
}
```

### 2. Filter out OpenCode's default Sisyphus

OpenCode has its own built-in Sisyphus agent with thinking enabled. We must filter it out to prevent it from overriding ours.

**src/index.ts:**
```typescript
const filteredConfigAgents = config.agent ?
  Object.fromEntries(
    Object.entries(config.agent).filter(([key]) => {
      if (key === "build") return false;
      if (key === "plan" && replacePlan) return false;
      if (key === "Sisyphus") return false;  // Always use our Sisyphus
      return true;
    })
  ) : {};
```

## Testing

```bash
# Without oh-my-opencode - works
opencode run -m cerebras/zai-glm-4.6 "which model are you"

# With oh-my-opencode (after fix) - works
opencode run -m cerebras/zai-glm-4.6 "which model are you"
```

## Trade-offs

By removing `thinking` config from agents, we rely on OpenCode to enable extended thinking for supported models. This means:

- **Pro**: Compatible with all providers including Cerebras, Groq, etc.
- **Pro**: The `-m` flag works correctly to override models
- **Con**: Extended thinking may not be automatically enabled for Claude/Gemini unless OpenCode detects and enables it

## Configuration

To use Cerebras as the explore agent:

**~/.config/opencode/oh-my-opencode.json:**
```json
{
  "google_auth": false,
  "agents": {
    "explore": {
      "model": "cerebras/zai-glm-4.6"
    }
  }
}
```

Cerebras is a built-in provider in OpenCode - no custom provider config needed.
