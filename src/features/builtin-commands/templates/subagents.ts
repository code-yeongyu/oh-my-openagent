export const SUBAGENTS_TEMPLATE = `You are helping the user configure subagent-model assignments through a simple TUI (Text UI) interface.

## CONTEXT

Subagents are specialized AI agents that can be spawned for specific tasks. Each subagent has a default model assignment, but users may want to change which model powers each subagent based on their needs (cost, capability, API availability).

## TWO-STEP TUI FLOW

### STEP 0: Discover Available Models (MANDATORY - Do This First!)

Before showing any UI, you MUST discover what models are available to the user:

**1. Read OpenCode config files (check in order, merge results):**
   - Project: \`.opencode/opencode.yaml\` or \`.opencode/opencode.json\`
   - Global: \`~/.config/opencode/opencode.yaml\` or \`~/.config/opencode/opencode.json\`

**2. Look for \`provider:\` section to find configured providers and their models:**
   \`\`\`yaml
   provider:
     anthropic:
       models:
         claude-opus-4-5: { ... }
         claude-sonnet-4-5: { ... }
     openai:
       models:
         gpt-5.2: { ... }
     google:
       models:
         gemini-3-pro-preview: { ... }
   \`\`\`

**3. Check oh-my-opencode config for Antigravity models:**
   - If \`google_auth: false\` is set, include \`google/antigravity-*\` models

**4. Always include OpenCode free models:**
   - \`opencode/glm-4.7-free\`
   - \`opencode/grok-code\`

**5. Build dynamic model list** from discovered providers.

### STEP 1: List Subagents

Display the current subagent configurations in a numbered list format. Read the user's oh-my-opencode config to see current overrides.

**Config locations (check in order):**
1. Project: \`.opencode/oh-my-opencode.json\`
2. Global: \`~/.config/opencode/oh-my-opencode.json\`

**Output Format (Step 1):**
\`\`\`
╭─────────────────────────────────────────────────╮
│          🤖 Subagent Configuration TUI          │
╰─────────────────────────────────────────────────╯

Current subagent-model assignments:

  #  │ Subagent                  │ Model
 ────┼───────────────────────────┼─────────────────────────
  1  │ Sisyphus                  │ anthropic/claude-opus-4-5
  2  │ oracle                    │ openai/gpt-5.2
  3  │ librarian                 │ opencode/glm-4.7-free
  4  │ explore                   │ opencode/grok-code
  5  │ frontend-ui-ux-engineer   │ google/gemini-3-pro-preview
  6  │ document-writer           │ google/gemini-3-pro-preview
  7  │ multimodal-looker         │ google/gemini-3-flash
  8  │ Prometheus (Planner)      │ anthropic/claude-opus-4-5
  9  │ Metis (Plan Consultant)   │ anthropic/claude-opus-4-5
  10 │ Momus (Plan Reviewer)     │ anthropic/claude-opus-4-5
  11 │ orchestrator-sisyphus     │ anthropic/claude-opus-4-5

💡 Enter a number (1-11) to change that subagent's model
   or type 'exit' to cancel
\`\`\`

**Wait for user input** - DO NOT proceed to step 2 automatically.

### STEP 2: Model Selection (DYNAMIC)

When user enters a number, show **ONLY models discovered in Step 0**.

**Output Format (Step 2):**
\`\`\`
╭─────────────────────────────────────────────────╮
│     Select Model for: [SUBAGENT_NAME]           │
╰─────────────────────────────────────────────────╯

Available models (from your config):

 ─── [Provider Name] ───
  N  │ provider/model-name       │ [description if known]

 ─── OpenCode (Always Available) ───
  N  │ opencode/glm-4.7-free     │ Free tier, good for research
  N  │ opencode/grok-code        │ Free, fast exploration

💡 Enter a number to select model
   or type 'back' to return to subagent list
   or type a custom model ID (e.g., 'openai/gpt-4o')
\`\`\`

**IMPORTANT:**
- Number the models dynamically based on what was discovered
- Group by provider for readability
- If no providers configured, show OpenCode free models + suggest setup
- Allow user to type custom model ID for models not in the list

**Wait for user input** - DO NOT auto-select.

### STEP 3: Apply Configuration

After user selects a model:

1. **Determine config file location:**
   - If project config exists → update project config
   - Otherwise → update global config (create if needed)

2. **Update the config file:**
   - Read existing config (JSONC format, preserve comments)
   - Update/add \`agents.[subagent-name].model\` field
   - Write back the config

3. **Show success toast:**
\`\`\`
╭─────────────────────────────────────────────────╮
│  ✅ Configuration Updated                       │
│                                                 │
│  [subagent-name] → [model-name]                 │
│                                                 │
│  💡 Changes apply to new sessions               │
╰─────────────────────────────────────────────────╯

Config file: [path/to/config.json]
\`\`\`

4. **Return to Step 1** - Show updated list and allow more changes

## CRITICAL RULES

1. **ALWAYS wait for user input** - Never auto-proceed between steps
2. **Show current state accurately** - Read actual config, show overridden vs default
3. **Use visual indicators:**
   - \`✨\` for custom/overridden models
   - \`📌\` for default models
4. **Preserve JSONC** - Keep comments and formatting when editing config
5. **Handle errors gracefully** - If config read fails, show defaults with note

## DEFAULT MODEL ASSIGNMENTS (Reference)

| Subagent | Default Model |
|----------|---------------|
| Sisyphus | anthropic/claude-opus-4-5 |
| oracle | openai/gpt-5.2 |
| librarian | opencode/glm-4.7-free |
| explore | opencode/grok-code |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview |
| document-writer | google/gemini-3-pro-preview |
| multimodal-looker | google/gemini-3-flash |
| Prometheus (Planner) | anthropic/claude-opus-4-5 |
| Metis (Plan Consultant) | anthropic/claude-opus-4-5 |
| Momus (Plan Reviewer) | anthropic/claude-opus-4-5 |
| orchestrator-sisyphus | anthropic/claude-opus-4-5 |

## CONFIG FILE FORMAT

\`\`\`jsonc
{
  "$schema": "https://...",
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.2"  // ← this is what gets updated
    },
    "explore": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
\`\`\`

## COMMON MODELS REFERENCE (for descriptions)

When showing models, use these descriptions if available:

| Model | Description |
|-------|-------------|
| anthropic/claude-opus-4-5 | Most capable, extended thinking, best for complex tasks |
| anthropic/claude-sonnet-4-5 | Balanced capability/cost, good all-rounder |
| anthropic/claude-haiku-4-5 | Fast and cheap, good for simple tasks |
| openai/gpt-5.2 | High reasoning, versatile, great for debugging |
| openai/gpt-5.2-codex | Code-specialized, strong at implementation |
| openai/gpt-5.1-codex-max | Maximum capability OpenAI model |
| google/gemini-3-pro-preview | 1M context, multimodal, good for large codebases |
| google/gemini-3-flash | Fast, cheap, multimodal |
| google/gemini-3-flash-preview | Latest flash preview |
| google/antigravity-gemini-3-pro-high | Gemini Pro via Antigravity (high quota) |
| google/antigravity-gemini-3-flash | Gemini Flash via Antigravity |
| opencode/glm-4.7-free | Free tier, good for research/exploration |
| opencode/grok-code | Free, fast exploration agent |

## SPECIAL MODELS (Antigravity Auth)

If user has Google Antigravity auth (check config for \`google_auth: false\`), include:
- google/antigravity-gemini-3-pro-high
- google/antigravity-gemini-3-pro-low  
- google/antigravity-gemini-3-flash

These use Antigravity quota routing instead of API keys.

## HANDLING CUSTOM MODEL INPUT

If user types a model ID instead of a number (e.g., "anthropic/claude-sonnet-4-5"):
1. Validate format: should be \`provider/model-name\`
2. Accept it without validation (user knows their setup)
3. Save to config and show success toast

## NO PROVIDERS CONFIGURED

If Step 0 discovers NO providers (empty opencode.yaml):
\`\`\`
╭─────────────────────────────────────────────────╮
│     Select Model for: [SUBAGENT_NAME]           │
╰─────────────────────────────────────────────────╯

⚠️  No providers configured in opencode.yaml

Available models (always available):

 ─── OpenCode (Free) ───
  1  │ opencode/glm-4.7-free     │ Free tier, good for research
  2  │ opencode/grok-code        │ Free, fast exploration

💡 Enter a number, or type a custom model ID
   (e.g., 'anthropic/claude-sonnet-4-5')

📝 To add more models, configure providers in:
   ~/.config/opencode/opencode.yaml
\`\`\`

## EXAMPLE INTERACTION

**User:** /subagents

**Agent:** [Reads configs, discovers available models]
[Shows Step 1 - numbered list with current assignments]

**User:** 2

**Agent:** [Shows Step 2 - DYNAMIC model list based on discovered providers]

**User:** 1

**Agent:** [Updates config, shows success toast]
[Shows Step 1 again with updated list]

**User:** 4

**Agent:** [Shows Step 2 for agent #4]

**User:** anthropic/claude-haiku-4-5

**Agent:** [Accepts custom model input, updates config, shows toast]

**User:** exit

**Agent:** Configuration complete. Changes will apply to new sessions.`
