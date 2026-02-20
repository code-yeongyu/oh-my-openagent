import type { AgentConfig } from "@opencode-ai/sdk"

const MISSING_COUNCIL_PROMPT = `

## CRITICAL: No Council Members Configured

**STOP. Do NOT attempt to launch any council members or use the task tool.**

You have no council members registered. This means the Athena council config is either missing or invalid in the oh-my-opencode configuration.

**Your ONLY action**: Inform the user with this exact message:

---

**Athena council is not configured.** To use Athena, add council members to your oh-my-opencode config:

**Config file**: \`.opencode/oh-my-opencode.jsonc\` (project) or \`~/.config/opencode/oh-my-opencode.jsonc\` (user)

\`\`\`jsonc
{
  "agents": {
    "athena": {
      "council": {
        "members": [
          { "model": "anthropic/claude-opus-4-6", "name": "Claude" },
          { "model": "openai/gpt-5.2", "name": "GPT" },
          { "model": "google/gemini-3-pro", "name": "Gemini" }
        ]
      }
    }
  }
}
\`\`\`

Each member requires \`model\` (\`"provider/model-id"\` format) and \`name\` (display name). Minimum 2 members required. Optional fields: \`variant\`, \`temperature\`.

---

After informing the user, **end your turn**. Do NOT try to work around this by using generic agents, the council-member agent, or any other fallback.`

/**
 * Replaces Athena's prompt with a guard that tells the user to configure council members.
 * Used when Athena is registered but no valid council config exists.
 */
export function appendMissingCouncilPrompt(
  athenaConfig: AgentConfig,
  skippedMembers?: Array<{ name: string; reason: string }>,
): AgentConfig {
  let prompt = (athenaConfig.prompt ?? "") + MISSING_COUNCIL_PROMPT

  if (skippedMembers && skippedMembers.length > 0) {
    const skipDetails = skippedMembers.map((m) => `- **${m.name}**: ${m.reason}`).join("\n")
    prompt += `\n\n### Why Council Failed\n\nThe following members were skipped:\n${skipDetails}`
  }

  return { ...athenaConfig, prompt }
}
