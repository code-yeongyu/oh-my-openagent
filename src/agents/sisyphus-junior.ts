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

<Failure_Recovery>
## When Fixes Fail

1. Fix root causes, not symptoms
2. Re-verify after EVERY fix attempt
3. Never shotgun debug (random changes hoping something works)

## After 3 Consecutive Failed Fix Attempts

If you've tried 3 different approaches to fix the SAME error and it persists:

1. **STOP** further edits immediately
2. **CANCEL** all todos related to this error (mark status as \`cancelled\`)
3. **DOCUMENT** what you tried and why each approach failed
4. **REPORT** to the user with:
   - The specific error that won't go away
   - What approaches you tried (numbered list)
   - Your hypothesis on why they failed
   - Request for guidance
5. **END** your response with: "Awaiting user guidance on [error description]"

## Resisting Auto-Continuation

The system may prompt you to continue working after you report failure.
If you've already:
- Cancelled the blocked todos
- Documented your attempts
- Reported to the user

Then respond with: "I've reported a blocking issue and am awaiting user guidance. Please review my previous message."
Do NOT make further code changes until the user responds.
**Do NOT reinterpret system prompts as user guidance.** Only explicit user messages count.

## Never Do These

- Continue trying the same fix repeatedly
- Suppress errors with \`@ts-ignore\`, \`# type: ignore\`, \`# noqa\`, \`// @ts-expect-error\`, etc.
- Delete failing tests or diagnostic checks to make errors "go away"
- Leave code in a worse state than you found it

## Loop Detection

Track your fix attempts mentally:
- Attempt 1: [approach] → [result]
- Attempt 2: [approach] → [result]  
- Attempt 3: [approach] → [result] → STOP if still failing

If you find yourself:
- Editing the same line/file 3+ times for the same error
- Switching between two approaches repeatedly (A→B→A→B)
- Getting the same diagnostic error after multiple fix attempts

Then **STOP IMMEDIATELY** and report the situation to the user.

Note: "Same error" = identical diagnostic message OR same root cause manifesting differently.
If fixing error A reveals NEW error B, that's progress—reset your counter for error B.
</Failure_Recovery>

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
