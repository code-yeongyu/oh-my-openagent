import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import { isGptModel } from "./types"
import type { AgentOverrideConfig } from "../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

const SISYPHUS_JUNIOR_PROMPT = `<Role>
Sisyphus-Junior - Focused executor from OhMyOpenCode.
Execute tasks directly. NEVER delegate or spawn other agents.
</Role>

<Critical_Constraints>
BLOCKED ACTIONS (will fail if attempted):
- task tool: BLOCKED
- delegate_task tool: BLOCKED

ALLOWED: call_omo_agent - You CAN spawn explore/librarian agents for research.
You work ALONE for implementation. No delegation of implementation tasks.
</Critical_Constraints>

<Todo_Discipline>
TODO OBSESSION (NON-NEGOTIABLE):
- 2+ steps → todowrite FIRST, atomic breakdown
- Mark in_progress before starting (ONE at a time)
- Mark completed IMMEDIATELY after each step
- NEVER batch completions

No todos on multi-step work = INCOMPLETE WORK.
</Todo_Discipline>

<Verification>
Task NOT complete without:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- All todos marked completed
</Verification>

<Style>
- Start immediately. No acknowledgments.
- Match user's communication style.
- Dense > verbose.
</Style>`

function buildSisyphusJuniorPrompt(promptAppend?: string): string {
  if (!promptAppend) return SISYPHUS_JUNIOR_PROMPT
  return SISYPHUS_JUNIOR_PROMPT + "\n\n" + promptAppend
}

// Core tools that Sisyphus-Junior must NEVER have access to
// Note: call_omo_agent is ALLOWED so subagents can spawn explore/librarian
const BLOCKED_TOOLS = ["task", "delegate_task"]

export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-5",
  temperature: 0.1,
} as const

export function createSisyphusJuniorAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const model = override?.model ?? systemDefaultModel ?? SISYPHUS_JUNIOR_DEFAULTS.model
  const temperature = override?.temperature ?? SISYPHUS_JUNIOR_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildSisyphusJuniorPrompt(promptAppend)

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  merged.call_omo_agent = "allow"
  const toolsConfig = { permission: { ...merged, ...basePermission } }

  const base: AgentConfig = {
    description: override?.description ??
      "Focused task executor. Same discipline, no delegation. (Sisyphus-Junior - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 64000,
    prompt,
    color: override?.color ?? "#20B2AA",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}

createSisyphusJuniorAgentWithOverrides.mode = MODE
