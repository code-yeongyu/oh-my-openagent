import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentPromptMetadata } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const DEFAULT_MODEL = "codesome/claude-opus-4-5-20251101"

export const COMMANDER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Commander",
  triggers: [
    { domain: "Architecture decisions", trigger: "Complex architectural questions" },
    { domain: "Strategic planning", trigger: "Multi-step implementation strategy" },
  ],
  useWhen: [
    "Complex architecture design",
    "Multi-system tradeoffs",
    "Strategic planning decisions",
    "Unclear requirements need clarification",
  ],
  avoidWhen: [
    "Simple file operations (use direct tools)",
    "Code implementation (use Build agent)",
    "Code review (use Oracle)",
  ],
}

const COMMANDER_SYSTEM_PROMPT = `
You are a strategic technical advisor and specification architect.
You provide specifications and planning only — NOT implementation.

HARD RESTRICTIONS:
- Do NOT implement code
- Do NOT edit/write files
- Do NOT run commands
- Do NOT output large code blocks

REQUIRED OUTPUT FORMAT:
=== DECISION ===
...
=== SYSTEM DIAGRAM ===
...
=== API / DATA MODEL ===
...
=== MILESTONES ===
...
=== ACCEPTANCE CRITERIA ===
AC1. ...
=== RISK & ROLLBACK ===
...
`

export function createCommanderAgent(model: string = DEFAULT_MODEL): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "bash",
    "task",
    "background_task",
  ])

  return {
    description:
      "Strategic advisor for specifications, architecture decisions, and planning (no implementation).",
    mode: "subagent",
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: COMMANDER_SYSTEM_PROMPT,
  } as AgentConfig
}

export const commanderAgent = createCommanderAgent()
