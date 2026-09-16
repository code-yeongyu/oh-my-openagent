import {
  fetchSDKMessages,
  findNearestMessageWithFieldsFromMessages,
  type SDKMessage,
} from "../features/hook-message-injector/sdk-message-lookup"
import { log } from "../shared/logger"

export const COMPACTION_CONTINUE_TEXT =
  "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."

export type CompactionContinueModel = {
  readonly providerID: string
  readonly modelID: string
}

export type CompactionAutocontinuePromptClient = {
  readonly session: {
    messages(input: { readonly path: { readonly id: string } }): Promise<unknown>
    promptAsync(input: {
      readonly path: { readonly id: string }
      readonly query?: { readonly directory?: string }
      readonly body: {
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly agent?: string
        readonly parts: Array<{
          readonly type: "text"
          readonly text: string
          readonly metadata?: { readonly [key: string]: unknown }
        }>
      }
    }): Promise<unknown>
  }
}

export type CompactionContinueRerouteDecision = {
  readonly triggerModel: CompactionContinueModel | null
  readonly workingModel: CompactionContinueModel | null
  readonly workingAgent: string | null
}

function readMessageModel(message: SDKMessage | null | undefined): CompactionContinueModel | null {
  const info = message?.info
  if (!info) return null
  const providerID = info.model?.providerID ?? info.providerID
  const modelID = info.model?.modelID ?? info.modelID
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

function hasCompactionPart(message: SDKMessage): boolean {
  return (
    Array.isArray(message.parts) &&
    message.parts.some((part) => part?.type === "compaction")
  )
}

function sortAscending(messages: readonly SDKMessage[]): SDKMessage[] {
  return [...messages].sort((left, right) => {
    const leftTime = left.info?.time?.created ?? 0
    const rightTime = right.info?.time?.created ?? 0
    if (leftTime !== rightTime) return leftTime - rightTime
    const leftId = typeof left.id === "string" ? left.id : ""
    const rightId = typeof right.id === "string" ? right.id : ""
    return leftId.localeCompare(rightId)
  })
}

export function resolveCompactionContinueModels(
  messages: readonly SDKMessage[],
): CompactionContinueRerouteDecision | null {
  if (!Array.isArray(messages) || messages.length === 0) return null

  const sorted = sortAscending(messages)
  let triggerModel: CompactionContinueModel | null = null
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (hasCompactionPart(sorted[index])) {
      triggerModel = readMessageModel(sorted[index])
      break
    }
  }

  const nearest = findNearestMessageWithFieldsFromMessages(sorted)
  const workingModel =
    nearest?.model?.providerID && nearest.model.modelID
      ? { providerID: nearest.model.providerID, modelID: nearest.model.modelID }
      : null

  return { triggerModel, workingModel, workingAgent: nearest?.agent ?? null }
}

export function shouldRerouteCompactionContinue(
  decision: CompactionContinueRerouteDecision | null,
): decision is CompactionContinueRerouteDecision & { workingModel: CompactionContinueModel } {
  if (!decision || !decision.triggerModel || !decision.workingModel) return false
  return (
    decision.triggerModel.providerID !== decision.workingModel.providerID ||
    decision.triggerModel.modelID !== decision.workingModel.modelID
  )
}

export async function resolveCompactionContinueReroute(
  client: CompactionAutocontinuePromptClient,
  sessionID: string,
): Promise<CompactionContinueRerouteDecision | null> {
  try {
    const messages = await fetchSDKMessages(client, sessionID)
    if (!messages) return null
    return resolveCompactionContinueModels(messages)
  } catch (error) {
    log("[session-compacting] compaction continue reroute lookup failed", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function reissueCompactionContinue(args: {
  client: CompactionAutocontinuePromptClient
  directory?: string
  sessionID: string
  agent: string | null
  workingModel: CompactionContinueModel
}): Promise<boolean> {
  const { client, directory, sessionID, agent, workingModel } = args
  try {
    await client.session.promptAsync({
      path: { id: sessionID },
      ...(directory ? { query: { directory } } : {}),
      body: {
        ...(agent ? { agent } : {}),
        model: { providerID: workingModel.providerID, modelID: workingModel.modelID },
        parts: [
          {
            type: "text",
            text: COMPACTION_CONTINUE_TEXT,
            metadata: { compaction_continue: true },
          },
        ],
      },
    })
    return true
  } catch (error) {
    log("[session-compacting] failed to reissue compaction continue", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
