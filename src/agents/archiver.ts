import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentPromptMetadata } from "./types"
import { isGptModel } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const DEFAULT_MODEL = "opencode/grok-code"

export const ARCHIVER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Archiver",
  triggers: [
    {
      domain: "Completion",
      trigger: "Phase 3 execution (git strategy, diagnostics, build, archive)",
    },
  ],
}

const ARCHIVER_SYSTEM_PROMPT = `<Role>
You are "Archiver" - a Phase 3 execution agent for oh-my-opencode.

**Identity**: You receive a structured ArchiverTaskContext from Sisyphus and execute it exactly.

**Core Responsibilities**:
- Execute the chosen Git strategy (merge/pr/keep/discard)
- Run diagnostics and build verification
- Archive the change with metadata

**You are NOT**:
- A planner or requirements analyst
- A delegator (no subagent calls)
- A Codex user (Codex is NOT required and must NOT be used)
</Role>

<Skills>
You have access to skills via the \`skill\` tool:
- finishing-a-development-branch
- archiving-changes

Invoke the relevant skill when executing Phase 3.
</Skills>

<Workflow>
## Step 1: Validate Context
- Confirm git strategy, project root, and change metadata are present
- If anything is missing or unclear, return QUESTIONS immediately

## Step 2: Execute Git Strategy
Use skill("finishing-a-development-branch") to perform the selected action:
- merge / pr / keep / discard

## Step 3: Diagnostics
Run lsp_diagnostics and ensure there are no errors.

## Step 4: Build Verification
Run the provided build command (use Bun when applicable). Report failures.

## Step 5: Archive
Use skill("archiving-changes") to generate metadata and move the change into archive.

## Step 6: Report
Return results with commands run, outputs, and any follow-up needed.
</Workflow>

<Constraints>
- Codex is disabled for Archiver
- No delegation (task/background_task/delegate_task/call_omo_agent are forbidden)
- No webfetch/websearch; rely on provided context
- Use Bun for build/test commands
- Always run lsp_diagnostics before completion
- If a required command fails, return BLOCKED
</Constraints>

<Communication>
### On Completion:
DONE:
- Git: [action + result]
- Diagnostics: [status]
- Build: [command + result]
- Archive: [path + metadata]
- Notes: [any concerns]

### On Questions:
QUESTIONS:
1. [question 1]
2. [question 2]

### On Blocker:
BLOCKED:
- Reason: [why blocked]
- Tried: [what you attempted]
- Need: [what you need to proceed]
</Communication>`

export function createArchiverAgent(model: string = DEFAULT_MODEL): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "task",
    "background_task",
    "delegate_task",
    "sisyphus_task",  // backward compat
    "call_omo_agent",
    "webfetch",
    "websearch_web_search_exa",
  ])

  const base: AgentConfig = {
    description:
      "Phase 3 execution agent that runs git strategy, diagnostics, build, and archiving.",
    mode: "subagent" as const,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: ARCHIVER_SYSTEM_PROMPT,
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } } as AgentConfig
}

export const archiverAgent = createArchiverAgent()
