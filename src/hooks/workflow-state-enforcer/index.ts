import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import {
  type WorkflowStateEnforcerConfig,
  type WorkflowValidationResult,
  DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
} from "./types"
import * as fs from "fs"
import * as path from "path"

export * from "./types"

export const WORKFLOW_COMMANDS = ["/specify", "/plan", "/tasks", "/implement", "/review", "/test"]

export function detectWorkflowCommand(message: string): string | null {
  const trimmed = message.trim().toLowerCase()
  for (const cmd of WORKFLOW_COMMANDS) {
    if (trimmed === cmd || trimmed.startsWith(cmd + " ") || trimmed.startsWith(cmd + "\n") || trimmed.startsWith(cmd + "\t")) {
      return cmd
    }
  }
  return null
}

/**
 * Check if prerequisite files exist for a workflow command.
 * Searches in common spec folder locations.
 */
export function checkPrerequisites(
  command: string,
  prerequisites: Record<string, string[]>,
  workingDir: string
): WorkflowValidationResult {
  const requiredFiles = prerequisites[command]
  if (!requiredFiles || requiredFiles.length === 0) {
    return { valid: true, command }
  }

  const missingPrerequisites: string[] = []

  const specFolderPatterns = [
    ".cursor/specs",
    "context/specs",
    ".opencode/specs",
  ]

  for (const requiredFile of requiredFiles) {
    let found = false

    for (const pattern of specFolderPatterns) {
      const specDir = path.join(workingDir, pattern)
      if (fs.existsSync(specDir)) {
        try {
          const folders = fs.readdirSync(specDir, { withFileTypes: true })
          for (const folder of folders) {
            if (folder.isDirectory()) {
              const filePath = path.join(specDir, folder.name, requiredFile)
              if (fs.existsSync(filePath)) {
                found = true
                break
              }
            }
          }
        } catch {
          // Ignore read errors
        }
      }
      if (found) break
    }

    // Also check directly in working directory (for non-spec workflows)
    if (!found) {
      const directPath = path.join(workingDir, requiredFile)
      if (fs.existsSync(directPath)) {
        found = true
      }
    }

    if (!found) {
      missingPrerequisites.push(requiredFile)
    }
  }

  if (missingPrerequisites.length > 0) {
    const previousStep = getPreviousStep(command)
    return {
      valid: false,
      command,
      missingPrerequisites,
      suggestion: previousStep
        ? `Run ${previousStep} first to create the required artifacts.`
        : `Create ${missingPrerequisites.join(", ")} before running ${command}.`,
    }
  }

  return { valid: true, command }
}

/**
 * Get the previous workflow step for a command.
 */
function getPreviousStep(command: string): string | null {
  const workflow: Record<string, string> = {
    "/plan": "/specify",
    "/tasks": "/plan",
    "/implement": "/tasks",
    "/review": "/specify",
    "/test": "/specify",
  }
  return workflow[command] || null
}

export function createWorkflowStateEnforcerHook(
  ctx: PluginInput,
  config?: Partial<WorkflowStateEnforcerConfig>
) {
  const finalConfig: WorkflowStateEnforcerConfig = {
    ...DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
    ...config,
  }

  if (!finalConfig.enabled || finalConfig.mode === "disabled") {
    log("Workflow state enforcer disabled")
    return null
  }

  log("Workflow state enforcer initialized", {
    mode: finalConfig.mode,
    workflowAgents: finalConfig.workflow_agents,
  })

  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const promptText = output.parts
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text || "")
        .join(" ")

      const command = detectWorkflowCommand(promptText)
      if (!command) {
        return
      }

      const messageContext = output.message as {
        agent?: string
        model?: { modelID?: string; providerID?: string }
        path?: { cwd?: string; root?: string }
        tools?: Record<string, boolean>
      }

      const workingDir = messageContext.path?.cwd || messageContext.path?.root || process.cwd()
      const expectedAgent = finalConfig.workflow_agents[command]

      const validation = checkPrerequisites(command, finalConfig.prerequisites, workingDir)

      let message = ""

      if (!validation.valid && validation.missingPrerequisites) {
        const missingList = validation.missingPrerequisites.join(", ")
        message = `⚠️ [Workflow] Detected ${command} command but missing prerequisites: ${missingList}

${validation.suggestion}

`
        log(`Workflow prerequisites missing for ${command}: ${missingList}`)
      }

      if (expectedAgent) {
        message += `📋 [Workflow] ${validation.valid ? "Detected" : "If proceeding with"} ${command} command. Recommended agent: ${expectedAgent}

IMPORTANT: Delegate this work to the ${expectedAgent} agent for best results:
\`\`\`typescript
call_omo_agent(subagent_type="${expectedAgent}", run_in_background=false, prompt="[task details]")
\`\`\`

The ${expectedAgent} agent is specialized for this workflow step.`

        log(`Workflow command detected: ${command} → ${expectedAgent}`)
      }

      if (message) {
        const { injectHookMessage } = await import("../../features/hook-message-injector")

        injectHookMessage(input.sessionID, message, {
          agent: messageContext.agent,
          model: messageContext.model,
          path: messageContext.path,
          tools: messageContext.tools,
        })
      }
    },
  }
}
