import type { PluginInput } from "@opencode-ai/plugin"
import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  findPrometheusPlans,
  getPlanProgress,
  createBoulderState,
  getPlanName,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"

export const HOOK_NAME = "start-work"

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkHookOutput {
  parts: Array<{ type: string; text?: string }>
}

export function createStartWorkHook(ctx: PluginInput) {
  return {
    "chat.message": async (
      input: StartWorkHookInput,
      output: StartWorkHookOutput
    ): Promise<void> => {
      const parts = output.parts
      const promptText = parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

      const isStartWorkCommand =
        promptText.includes("Start Sisyphus work session") ||
        promptText.includes("<session-context>")

      if (!isStartWorkCommand) {
        return
      }

      log(`[${HOOK_NAME}] Processing start-work command`, {
        sessionID: input.sessionID,
      })

      const existingState = readBoulderState(ctx.directory)
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()

      let contextInfo = ""

      if (existingState) {
        const progress = getPlanProgress(existingState.active_plan)
        
        if (!progress.isComplete) {
          appendSessionId(ctx.directory, sessionId)
          contextInfo = `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan**: ${existingState.plan_name}
**Path**: ${existingState.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${existingState.session_ids.length + 1} (current session appended)
**Started**: ${existingState.started_at}

The current session (${sessionId}) has been added to session_ids.
Read the plan file and continue from the first unchecked task.`
        } else {
          contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
        }
      }

      if (!existingState || getPlanProgress(existingState.active_plan).isComplete) {
        const plans = findPrometheusPlans(ctx.directory)
        
        if (plans.length === 0) {
          contextInfo += `

## No Plans Found

No Prometheus plan files found at .sisyphus/plans/
Use Prometheus to create a work plan first: /plan "your task"`
        } else if (plans.length === 1) {
          const planPath = plans[0]
          const progress = getPlanProgress(planPath)
          const newState = createBoulderState(planPath, sessionId)
          writeBoulderState(ctx.directory, newState)

          contextInfo += `

## Auto-Selected Plan

**Plan**: ${getPlanName(planPath)}
**Path**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

boulder.json has been created. Read the plan and begin execution.`
        } else {
          const planList = plans.map((p, i) => {
            const progress = getPlanProgress(p)
            const stat = require("node:fs").statSync(p)
            const modified = new Date(stat.mtimeMs).toISOString()
            return `${i + 1}. [${getPlanName(p)}] - Modified: ${modified} - Progress: ${progress.completed}/${progress.total}`
          }).join("\n")

          contextInfo += `

## Multiple Plans Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${planList}

Which plan would you like to work on? Reply with the number or plan name.`
        }
      }

      const verificationEnforcement = `

---

## MANDATORY VERIFICATION ENFORCEMENT (NON-NEGOTIABLE)

**CRITICAL: You MUST perform hands-on verification after completing ALL tasks. Static analysis alone is NOT sufficient.**

### Verification by Deliverable Type

| Type | Tool | How to Verify |
|------|------|---------------|
| **Frontend/UI** | \`/playwright\` skill | Navigate, click, verify visual state, take screenshots |
| **TUI/CLI** | \`interactive_bash\` (tmux) | Run commands interactively, verify output |
| **API/Backend** | \`bash\` with curl/httpie | Send requests, verify responses |
| **Library/Module** | REPL via \`interactive_bash\` | Import, call functions, verify results |

### Verification Workflow

1. **After ALL tasks complete** (not after each task):
   - Start dev server if needed: \`bun run dev\` / \`npm run dev\`
   - Wait for server to be ready
   
2. **For Frontend changes**:
   \`\`\`
   Load /playwright skill → Navigate to page → Interact with UI → Verify expected behavior → Screenshot evidence
   \`\`\`

3. **For TUI/CLI changes**:
   \`\`\`
   interactive_bash(tmux_command="new-session -d -s qa") → send-keys with commands → capture-pane output → verify
   \`\`\`

4. **Evidence required**:
   - Screenshots for visual changes (saved to \`.sisyphus/evidence/\`)
   - Terminal output for CLI changes
   - Response bodies for API changes

### What Static Analysis CANNOT Catch

- Visual rendering issues (wrong colors, broken layouts)
- Animation/transition bugs
- Race conditions in UI interactions
- User flow breakages
- Integration issues between components

### FAILURE TO VERIFY = INCOMPLETE WORK

**Do NOT mark tasks complete or report "done" without hands-on verification.**
If you skip this step, the user will find bugs you could have caught.
`

      const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
      if (idx >= 0 && output.parts[idx].text) {
        output.parts[idx].text = output.parts[idx].text
          .replace(/\$SESSION_ID/g, sessionId)
          .replace(/\$TIMESTAMP/g, timestamp)
        
        output.parts[idx].text += `\n\n---\n${contextInfo}${verificationEnforcement}`
      }

      log(`[${HOOK_NAME}] Context injected`, {
        sessionID: input.sessionID,
        hasExistingState: !!existingState,
      })
    },
  }
}
