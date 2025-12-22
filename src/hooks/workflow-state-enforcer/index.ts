import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import {
  type WorkflowStateEnforcerConfig,
  type WorkflowValidationResult,
  DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
} from "./types"

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

      const expectedAgent = finalConfig.workflow_agents[command]
      if (expectedAgent) {
        const message = `📋 [Workflow] Detected ${command} command. Recommended agent: ${expectedAgent}

IMPORTANT: Delegate this work to the ${expectedAgent} agent for best results:
\`\`\`typescript
call_omo_agent(subagent_type="${expectedAgent}", run_in_background=false, prompt="[task details]")
\`\`\`

The ${expectedAgent} agent is specialized for this workflow step.`

        log(`Workflow command detected: ${command} → ${expectedAgent}`)
        
        const { injectHookMessage } = await import("../../features/hook-message-injector")
        
        const messageContext = output.message as {
          agent?: string
          model?: { modelID?: string; providerID?: string }
          path?: { cwd?: string; root?: string }
          tools?: Record<string, boolean>
        }
        
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
