import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel } from "./types"
import type { AgentOverrideConfig, CategoryConfig } from "../config/schema"
import {
  createAgentToolRestrictions,
  migrateAgentConfig,
  supportsNewPermissionSystem,
} from "../shared/permission-compat"

const SISYPHUS_JUNIOR_PROMPT = `<Role>
Sisyphus-Junior - Focused executor from OhMyOpenCode.
Execute tasks directly. NEVER delegate or spawn other agents.
</Role>

<Critical_Constraints>
BLOCKED ACTIONS (will fail if attempted):
- task tool: BLOCKED
- sisyphus_task tool: BLOCKED

ALLOWED: call_omo_agent - You CAN spawn explore/librarian agents for research.
You work ALONE for implementation. No delegation of implementation tasks.
</Critical_Constraints>

<Work_Context>
## Notepad Location (for recording learnings)
NOTEPAD PATH: .sisyphus/notepads/{plan-name}/
- learnings.md: Record patterns, conventions, successful approaches
- issues.md: Record problems, blockers, gotchas encountered
- decisions.md: Record architectural choices and rationales
- problems.md: Record unresolved issues, technical debt

You SHOULD append findings to notepad files after completing work.

## Plan Location (READ ONLY)
PLAN PATH: .sisyphus/plans/{plan-name}.md

⚠️⚠️⚠️ CRITICAL RULE: NEVER MODIFY THE PLAN FILE ⚠️⚠️⚠️

The plan file (.sisyphus/plans/*.md) is SACRED and READ-ONLY.
- You may READ the plan to understand tasks
- You may READ checkbox items to know what to do
- You MUST NOT edit, modify, or update the plan file
- You MUST NOT mark checkboxes as complete in the plan
- Only the Orchestrator manages the plan file

VIOLATION = IMMEDIATE FAILURE. The Orchestrator tracks plan state.
</Work_Context>

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
const BLOCKED_TOOLS = ["task", "sisyphus_task"]

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

  let toolsConfig: Record<string, unknown> = {}
  if (supportsNewPermissionSystem()) {
    const userPermission = (override?.permission ?? {}) as Record<string, string>
    const basePermission = (baseRestrictions as { permission: Record<string, string> }).permission
    const merged: Record<string, string> = { ...userPermission }
    for (const tool of BLOCKED_TOOLS) {
      merged[tool] = "deny"
    }
    merged.call_omo_agent = "allow"
    toolsConfig = { permission: { ...merged, ...basePermission } }
  } else {
    const userTools = override?.tools ?? {}
    const baseTools = (baseRestrictions as { tools: Record<string, boolean> }).tools
    const merged: Record<string, boolean> = { ...userTools }
    for (const tool of BLOCKED_TOOLS) {
      merged[tool] = false
    }
    merged.call_omo_agent = true
    toolsConfig = { tools: { ...merged, ...baseTools } }
  }

  const base: AgentConfig = {
    description: override?.description ??
      "Sisyphus-Junior - Focused task executor. Same discipline, no delegation.",
    mode: "subagent" as const,
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

export function createSisyphusJuniorAgent(
  categoryConfig: CategoryConfig,
  promptAppend?: string
): AgentConfig {
  const prompt = buildSisyphusJuniorPrompt(promptAppend)
  const model = categoryConfig.model
  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)
  const mergedConfig = migrateAgentConfig({
    ...baseRestrictions,
    ...(categoryConfig.tools ? { tools: categoryConfig.tools } : {}),
  })


  const base: AgentConfig = {
    description:
      "Sisyphus-Junior - Focused task executor. Same discipline, no delegation.",
    mode: "subagent" as const,
    model,
    maxTokens: categoryConfig.maxTokens ?? 64000,
    prompt,
    color: "#20B2AA",
    ...mergedConfig,
  }

  if (categoryConfig.temperature !== undefined) {
    base.temperature = categoryConfig.temperature
  }
  if (categoryConfig.top_p !== undefined) {
    base.top_p = categoryConfig.top_p
  }

  if (categoryConfig.thinking) {
    return { ...base, thinking: categoryConfig.thinking } as AgentConfig
  }

  if (categoryConfig.reasoningEffort) {
    return {
      ...base,
      reasoningEffort: categoryConfig.reasoningEffort,
      textVerbosity: categoryConfig.textVerbosity,
    } as AgentConfig
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}
