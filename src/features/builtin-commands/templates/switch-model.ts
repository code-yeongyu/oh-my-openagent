export const SWITCH_MODEL_TEMPLATE = `You are helping the user switch the active LLM model for a specific agent.

## WHAT TO DO

1. **Parse the arguments**:
   - No arguments: Show current model assignments for all agents
   - One argument (agent name): Show available model_candidates for that agent
   - Two arguments (agent name + model): Switch the agent to the specified model

2. **Get current model information**:
   - Use \`getCurrentModelInfo()\` from \`src/features/model-switcher\` to get all agent model states
   - This returns: \`{ [agentName]: { active: string | undefined, candidates: string[] } }\`

3. **Validate agent name**:
   - Must be a valid builtin agent name (sisyphus, hephaestus, oracle, explore, librarian, build, plan, etc.)
   - If invalid, show error and list valid agent names

4. **Validate model choice**:
   - When switching, ensure the model is in the agent's \`model_candidates\` list
   - If model not in candidates, show error and display available candidates
   - If \`model_candidates\` is empty or not configured, show appropriate message

5. **Perform the switch**:
   - Call \`setActiveModel(agentName, model)\` from \`src/features/model-switcher\`
   - Confirm the switch with a success message
   - The new model will take effect for the next message in this session

## OUTPUT FORMAT

### When no arguments provided:
\`\`\`
Current Model Assignments

Session ID: $SESSION_ID
Timestamp: $TIMESTAMP

Agent            | Active Model                     | Candidates Available
-----------------|----------------------------------|---------------------
sisyphus         | zai-coding-plan/glm-4.7         | 3 models
hephaestus       | google/antigravity-claude-opus  | 2 models
oracle           | (default from config)            | 0 models (not configured)

To view candidates for an agent: /switch-model <agent-name>
To switch model: /switch-model <agent-name> <model-id>
\`\`\`

### When agent name provided:
\`\`\`
Model Candidates for Agent: sisyphus

Current Active: zai-coding-plan/glm-4.7

Available Candidates:
1. zai-coding-plan/glm-4.7 (current)
2. google/antigravity-claude-opus-4-6-thinking
3. cursor-acp/gpt-5.2

To switch: /switch-model sisyphus <model-id>
Example: /switch-model sisyphus google/antigravity-claude-opus-4-6-thinking
\`\`\`

### When switching model:
\`\`\`
Model Switch Successful

Agent: sisyphus
Previous: zai-coding-plan/glm-4.7
New: google/antigravity-claude-opus-4-6-thinking

The new model will be used for sisyphus starting with the next message.
\`\`\`

### When model not in candidates:
\`\`\`
Error: Invalid Model

Agent: sisyphus
Requested: some-invalid/model

This model is not in the configured candidates for sisyphus.

Available candidates:
- zai-coding-plan/glm-4.7
- google/antigravity-claude-opus-4-6-thinking
- cursor-acp/gpt-5.2

Please choose from the available candidates.
\`\`\`

### When agent has no candidates configured:
\`\`\`
Error: No Model Candidates Configured

Agent: oracle

This agent does not have model_candidates configured in oh-my-opencode.json.
It will use the default model specified in the config.

To enable model switching for this agent, add model_candidates:

{
  "agents": {
    "oracle": {
      "model": "default-model-id",
      "model_candidates": [
        "default-model-id",
        "alternative-model-id"
      ]
    }
  }
}
\`\`\`

## IMPORTANT NOTES

- The switch is **session-scoped** (in-memory only)
- Changes do NOT modify oh-my-opencode.json
- The new model takes effect from the next message
- Always validate before calling \`setActiveModel()\`
- Use clear, actionable error messages

## AVAILABLE FUNCTIONS

Import from \`src/features/model-switcher\`:
- \`getCurrentModelInfo()\`: Get all agent model states
- \`setActiveModel(agentName: string, model: string)\`: Switch agent model
- \`getCandidates(agentName: string)\`: Get model candidates for specific agent
- \`getActiveModel(agentName: string)\`: Get current active model for agent
`
