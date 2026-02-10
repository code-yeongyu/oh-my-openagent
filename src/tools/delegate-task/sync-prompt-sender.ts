import type { DelegateTaskArgs, OpencodeClient } from "./types"
import { isPlanFamily } from "./constants"
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { formatDetailedError } from "./error-formatting"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"

export async function sendSyncPrompt(
  client: OpencodeClient,
  input: {
    sessionID: string
    agentToUse: string
    args: DelegateTaskArgs
    systemContent: string | undefined
    categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
  }
): Promise<string | null> {
  try {
    const allowTask = isPlanFamily(input.agentToUse)
    await promptWithModelSuggestionRetry(client, {
      path: { id: input.sessionID },
      body: {
        agent: input.agentToUse,
        system: input.systemContent,
        tools: {
          task: allowTask,
          call_omo_agent: true,
          question: false,
          ...getAgentToolRestrictions(input.agentToUse),
        },
        parts: [{ type: "text", text: input.args.prompt }],
        ...(input.categoryModel ? { model: { providerID: input.categoryModel.providerID, modelID: input.categoryModel.modelID } } : {}),
        ...(input.categoryModel?.variant ? { variant: input.categoryModel.variant } : {}),
      },
    })
  } catch (promptError) {
    if (input.toastManager && input.taskId !== undefined) {
      input.toastManager.removeTask(input.taskId)
    }
    const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return formatDetailedError(new Error(`Agent "${input.agentToUse}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`), {
        operation: "Send prompt to agent",
        args: input.args,
        sessionID: input.sessionID,
        agent: input.agentToUse,
        category: input.args.category,
      })
    }
    return formatDetailedError(promptError, {
      operation: "Send prompt",
      args: input.args,
      sessionID: input.sessionID,
      agent: input.agentToUse,
      category: input.args.category,
    })
  }

  return null
}
