import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  findPrometheusPlans,
  getPlanProgress,
  createBoulderState,
  getPlanName,
  clearBoulderState,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { getSessionAgent, updateSessionAgent } from "../../features/claude-code-session-state"

export const HOOK_NAME = "start-work"

const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi

/**
 * Count tasks in a plan file by counting markdown checkboxes
 */
function countPlanTasks(planPath: string): number {
  if (!existsSync(planPath)) return 0
  
  try {
    const content = readFileSync(planPath, "utf-8")
    // Count all checkboxes (checked and unchecked)
    const unchecked = (content.match(/^\s*[-*]\s*\[\s*\]/gm) || []).length
    const checked = (content.match(/^\s*[-*]\s*\[[xX]\]/gm) || []).length
    return unchecked + checked
  } catch {
    return 0
  }
}

/**
 * Generate execution mode selection prompt for the agent to ask user
 */
function generateExecutionModePrompt(taskCount: number): string {
  const recommendedMode = taskCount <= 5 ? "sequential" : "parallel"
  const sequentialLabel = taskCount <= 5 
    ? "Sequential execution (Recommended)" 
    : "Sequential execution"
  const parallelLabel = taskCount > 5 
    ? "Parallel execution (Recommended)" 
    : "Parallel execution"

  return `
## Execution Mode Selection Required

**Task Count**: ${taskCount} tasks detected

Before starting execution, ask the user to choose an execution mode using the \`question\` tool:

\`\`\`
question({
  questions: [{
    header: "Execution Mode",
    question: "How would you like to execute the ${taskCount} tasks in this plan?",
    options: [
      { label: "${sequentialLabel}", description: "Execute tasks one by one in order. Best for dependent tasks or ≤5 tasks." },
      { label: "${parallelLabel}", description: "Execute independent tasks in parallel waves. Best for >5 independent tasks." },
      { label: "Auto-select", description: "Let the system decide based on task count and dependencies." }
    ]
  }]
})
\`\`\`

**After user selection**:
- If "Sequential" → Load skill: \`skill("executing-plans")\`
- If "Parallel" → Load skill: \`skill("wave-parallel-execution")\`
- If "Auto-select" → Use "${recommendedMode}" mode based on task count (${taskCount} tasks)

**DO NOT proceed with execution until user has selected a mode.**`
}

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkHookOutput {
  message?: unknown
  parts: Array<{ type: string; text?: string }>
}

function readMessagePathDirectory(message: unknown): { cwd?: string; root?: string } {
  if (!message || typeof message !== "object") {
    return {}
  }

  const maybePath = (message as { path?: unknown }).path
  if (!maybePath || typeof maybePath !== "object") {
    return {}
  }

  const cwd = (maybePath as { cwd?: unknown }).cwd
  const root = (maybePath as { root?: unknown }).root

  return {
    cwd: typeof cwd === "string" ? cwd : undefined,
    root: typeof root === "string" ? root : undefined,
  }
}

function resolveWorkingDirectory(
  defaultDirectory: string,
  output: StartWorkHookOutput
): string {
  const { cwd, root } = readMessagePathDirectory(output.message)
  if (cwd && existsSync(cwd)) {
    return cwd
  }

  if (root && existsSync(root)) {
    return root
  }

  return defaultDirectory
}

function extractUserRequestPlanName(promptText: string): string | null {
  const userRequestMatch = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!userRequestMatch) return null
  
  const rawArg = userRequestMatch[1].trim()
  if (!rawArg) return null

  const normalizedArg = rawArg
    .replace(/\$ARGUMENTS/g, "")
    .replace(/\$\{user_message\}/g, "")
    .trim()

  if (!normalizedArg) return null
  
  const cleanedArg = normalizedArg.replace(KEYWORD_PATTERN, "").trim()
  return cleanedArg || null
}

function findPlanByName(plans: string[], requestedName: string): string | null {
  const lowerName = requestedName.toLowerCase()
  
  const exactMatch = plans.find(p => getPlanName(p).toLowerCase() === lowerName)
  if (exactMatch) return exactMatch
  
  const partialMatch = plans.find(p => getPlanName(p).toLowerCase().includes(lowerName))
  return partialMatch || null
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

      // Only trigger on actual command execution (contains <session-context> tag)
      // NOT on description text like "Start Sisyphus work session from Prometheus plan"
      const isStartWorkCommand = promptText.includes("<session-context>")

      if (!isStartWorkCommand) {
        return
      }

      log(`[${HOOK_NAME}] Processing start-work command`, {
        sessionID: input.sessionID,
      })

      updateSessionAgent(input.sessionID, "atlas") // Always switch: fixes #1298

      const workingDirectory = resolveWorkingDirectory(ctx.directory, output)

      const existingState = readBoulderState(workingDirectory)
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()

      let contextInfo = ""
      
      const explicitPlanName = extractUserRequestPlanName(promptText)
      
      if (explicitPlanName) {
        log(`[${HOOK_NAME}] Explicit plan name requested: ${explicitPlanName}`, {
          sessionID: input.sessionID,
        })
        
        const allPlans = findPrometheusPlans(workingDirectory)
        const matchedPlan = findPlanByName(allPlans, explicitPlanName)
        
        if (matchedPlan) {
          const progress = getPlanProgress(matchedPlan)
          
          if (progress.isComplete) {
            contextInfo = `
## Plan Already Complete

The requested plan "${getPlanName(matchedPlan)}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
          } else {
            if (existingState) {
              clearBoulderState(workingDirectory)
            }
            const newState = createBoulderState(matchedPlan, sessionId, "atlas")
            writeBoulderState(workingDirectory, newState)
            
            contextInfo = `
## Auto-Selected Plan

**Plan**: ${getPlanName(matchedPlan)}
**Path**: ${matchedPlan}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

boulder.json has been created.
${generateExecutionModePrompt(progress.total)}`
          }
        } else {
          const incompletePlans = allPlans.filter(p => !getPlanProgress(p).isComplete)
          if (incompletePlans.length > 0) {
            const planList = incompletePlans.map((p, i) => {
              const prog = getPlanProgress(p)
              return `${i + 1}. [${getPlanName(p)}] - Progress: ${prog.completed}/${prog.total}`
            }).join("\n")
            
            contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".

Available incomplete plans:
${planList}

Ask the user which plan to work on.`
          } else {
            contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".
No incomplete plans available. Create a new plan with: /plan "your task"`
          }
        }
      } else if (existingState) {
        const progress = getPlanProgress(existingState.active_plan)
        
        if (!progress.isComplete) {
          appendSessionId(workingDirectory, sessionId)
          const remainingTasks = progress.total - progress.completed
          contextInfo = `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan**: ${existingState.plan_name}
**Path**: ${existingState.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${existingState.session_ids.length + 1} (current session appended)
**Started**: ${existingState.started_at}

The current session (${sessionId}) has been added to session_ids.
${generateExecutionModePrompt(remainingTasks)}`
        } else {
          contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
        }
      }

      if ((!existingState && !explicitPlanName) || (existingState && !explicitPlanName && getPlanProgress(existingState.active_plan).isComplete)) {
        const plans = findPrometheusPlans(workingDirectory)
        const incompletePlans = plans.filter(p => !getPlanProgress(p).isComplete)
        
        if (plans.length === 0) {
          contextInfo += `

## No Plans Found

No plan files found in changes/ directory.
Use Prometheus to create a work plan first: /plan "your task"`
        } else if (incompletePlans.length === 0) {
          contextInfo += `

## All Plans Complete

All ${plans.length} plan(s) are complete. Create a new plan with: /plan "your task"`
        } else if (incompletePlans.length === 1) {
          const planPath = incompletePlans[0]
          const progress = getPlanProgress(planPath)
          const newState = createBoulderState(planPath, sessionId, "atlas")
          writeBoulderState(workingDirectory, newState)

          contextInfo += `

## Auto-Selected Plan

**Plan**: ${getPlanName(planPath)}
**Path**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

boulder.json has been created.
${generateExecutionModePrompt(progress.total)}`
        } else {
          const planList = incompletePlans.map((p, i) => {
            const progress = getPlanProgress(p)
            const stat = require("node:fs").statSync(p)
            const modified = new Date(stat.mtimeMs).toISOString()
            return `${i + 1}. [${getPlanName(p)}] - Modified: ${modified} - Progress: ${progress.completed}/${progress.total}`
          }).join("\n")

          contextInfo += `

<system-reminder>
## Multiple Plans Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${planList}

Ask the user which plan to work on. Present the options above and wait for their response.
</system-reminder>`
        }
      }

      const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
      if (idx >= 0 && output.parts[idx].text) {
        const resolvedRequest = explicitPlanName ?? ""
        output.parts[idx].text = output.parts[idx].text
          .replace(/\$SESSION_ID/g, sessionId)
          .replace(/\$TIMESTAMP/g, timestamp)
          .replace(/\$\{user_message\}/g, resolvedRequest)
          .replace(/\$ARGUMENTS/g, resolvedRequest)
        
        output.parts[idx].text += `\n\n---\n${contextInfo}`
      }

      log(`[${HOOK_NAME}] Context injected`, {
        sessionID: input.sessionID,
        hasExistingState: !!existingState,
        workingDirectory,
        pluginDirectory: ctx.directory,
      })
    },
  }
}
