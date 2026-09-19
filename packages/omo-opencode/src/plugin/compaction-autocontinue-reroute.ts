import {
  fetchSDKMessages,
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

type RuntimeMessageInfo = {
  readonly agent?: string
  readonly role?: string
  readonly model?: { readonly providerID?: string; readonly modelID?: string }
  readonly providerID?: string
  readonly modelID?: string
}

function readRuntimeInfo(message: SDKMessage | null | undefined): RuntimeMessageInfo | undefined {
  return message?.info as RuntimeMessageInfo | undefined
}

function hasAgentAndModel(message: SDKMessage): boolean {
  const info = readRuntimeInfo(message)
  if (!info) return false
  const providerID = info.model?.providerID ?? info.providerID
  const modelID = info.model?.modelID ?? info.modelID
  return Boolean(info.agent && providerID && modelID)
}

function isInternalContinuationMessage(message: SDKMessage): boolean {
  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts.some((part) => {
    const candidate = part as
      | { synthetic?: boolean; metadata?: { readonly [key: string]: unknown } }
      | undefined
    if (!candidate) return false
    if (candidate.synthetic === true) return true
    return candidate.metadata?.["compaction_continue"] === true
  })
}

function isCompactionArtifact(message: SDKMessage): boolean {
  if (hasCompactionPart(message)) return true
  return readRuntimeInfo(message)?.agent === "compaction"
}

// The working model/agent must be the session's active model from before the
// compaction. Never resolve it from compaction summaries or internal
// auto-continue prompts: those used to be picked up as the "nearest message
// with fields", which re-issued every subsequent continue on the summary's or
// previous continue's model (e.g. glm-5.3-flash) and silently switched the
// session away from the user's selected model via a self-sustaining loop.
function pickActiveSessionMessage(sorted: readonly SDKMessage[]): SDKMessage | null {
  const clean = sorted.filter(
    (message) => !isCompactionArtifact(message) && !isInternalContinuationMessage(message),
  )
  for (let index = clean.length - 1; index >= 0; index -= 1) {
    const message = clean[index]
    if (readRuntimeInfo(message)?.role === "assistant" && hasAgentAndModel(message)) return message
  }
  for (let index = clean.length - 1; index >= 0; index -= 1) {
    const message = clean[index]
    if (hasAgentAndModel(message)) return message
  }
  return null
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

  const active = pickActiveSessionMessage(sorted)
  const workingModel = readMessageModel(active)

  return { triggerModel, workingModel, workingAgent: readRuntimeInfo(active)?.agent ?? null }
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
