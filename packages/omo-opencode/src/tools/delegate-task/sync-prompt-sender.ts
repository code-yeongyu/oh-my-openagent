import type { SisyphusAgentConfig } from "../../config/schema"
import { stripInvisibleAgentCharacters } from "../../shared/agent-display-names"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import {
  promptWithModelSuggestionRetry,
} from "../../shared/model-suggestion-retry"
import { migrateToolsToPermission } from "../../shared/permission-compat"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { routePromptRetry } from "../../shared/session-route"
import { setSessionTools } from "../../shared/session-tools-store"
import { isPlanFamily } from "./constants"
import { formatDetailedError } from "./error-formatting"
import { buildTaskPrompt } from "./prompt-builder"
import type { DelegatedModelConfig, DelegateTaskArgs, OpencodeClient } from "./types"

type SendSyncPromptDeps = {
  promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry
}

const sendSyncPromptDeps: SendSyncPromptDeps = {
  promptWithModelSuggestionRetry,
}

function buildPromptGenerationParams(model: DelegatedModelConfig | undefined): Record<string, unknown> {
  if (!model) {
    return {}
  }

  const promptOptions: Record<string, unknown> = {
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
    ...(model.thinking ? { thinking: model.thinking } : {}),
  }

  return {
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.top_p !== undefined ? { topP: model.top_p } : {}),
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(Object.keys(promptOptions).length > 0 ? { options: promptOptions } : {}),
  }
}

function isOracleAgent(agentToUse: string): boolean {
  return stripInvisibleAgentCharacters(agentToUse).toLowerCase() === "oracle"
}

function isUnexpectedEofError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  return lowered.includes("unexpected eof") || lowered.includes("json parse error")
}

export function buildSyncPromptTools(
  agentToUse: string,
  permission?: Record<string, "ask" | "allow" | "deny">,
): Record<string, boolean> {
  const userDenied: Record<string, boolean> = {}
  if (permission) {
    for (const [tool, value] of Object.entries(permission)) {
      if (value === "deny") userDenied[tool] = false
    }
  }
  return {
    task: isPlanFamily(agentToUse),
    call_omo_agent: true,
    question: false,
    ...userDenied,
    ...getAgentToolRestrictions(agentToUse),
  }
}

export async function sendSyncPrompt(
  client: OpencodeClient,
  input: {
    sessionID: string
    agentToUse: string
    args: DelegateTaskArgs
    systemContent: string | undefined
    categoryModel: DelegatedModelConfig | undefined
    directory: string
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
    sisyphusAgentConfig?: SisyphusAgentConfig
  },
  deps: SendSyncPromptDeps = sendSyncPromptDeps
): Promise<string | null> {
  const tddEnabled = input.sisyphusAgentConfig?.tdd
  const effectivePrompt = buildTaskPrompt(input.args.prompt, input.agentToUse, tddEnabled)
  const userPermission = input.categoryModel?.tools
    ? migrateToolsToPermission(input.categoryModel.tools)
    : undefined
  const tools = buildSyncPromptTools(input.agentToUse, userPermission)
  setSessionTools(input.sessionID, tools)

  applySessionPromptParams(input.sessionID, input.categoryModel)

  const promptArgs = {
    path: { id: input.sessionID },
    body: {
      agent: stripInvisibleAgentCharacters(input.agentToUse),
      system: input.systemContent,
      tools,
      parts: [createInternalAgentTextPart(effectivePrompt)],
      ...(input.categoryModel
        ? {
            model: {
              providerID: input.categoryModel.providerID,
              modelID: input.categoryModel.modelID,
            },
          }
        : {}),
      ...(input.categoryModel?.variant ? { variant: input.categoryModel.variant } : {}),
      ...buildPromptGenerationParams(input.categoryModel),
    },
  }

  try {
    await deps.promptWithModelSuggestionRetry(client, routePromptRetry(promptArgs, input.directory), {
      queueBehavior: "defer",
      checkStatus: false,
      checkToolState: false,
    })
  } catch (promptError) {
    if (isOracleAgent(input.agentToUse) && isUnexpectedEofError(promptError)) {
      return null
    }

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
