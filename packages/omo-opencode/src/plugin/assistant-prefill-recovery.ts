import { isRecord } from "@oh-my-opencode/utils"
import type { Message, Part } from "@opencode-ai/sdk"

import { normalizeModelID } from "../shared/model-normalization"

export const ASSISTANT_PREFILL_RECOVERY_TEXT = "[internal] Continue from the previous assistant state."
export const ASSISTANT_PREFILL_RECOVERY_METADATA_KEY = "assistant_prefill_recovery"

const MAX_ASSISTANT_PREFILL_RECOVERY_ATTEMPTS = 3
const RECOVERY_SESSION_TRACK_LIMIT = 256

const ASSISTANT_PREFILL_UNSUPPORTED_PROVIDERS = new Set([
  "anthropic",
  "aws-bedrock-anthropic",
  "github-copilot",
  "github-copilot-enterprise",
  "google-vertex-anthropic",
  "opencode",
  "opencode-go",
  "opencode-zen-proxy",
  "vercel",
])
const ASSISTANT_PREFILL_UNSUPPORTED_MODEL_PREFIXES = [
  "claude-opus-4",
  "claude-sonnet-4-6",
  "claude-mythos",
]

type MessageWithParts = {
  info: Message
  parts: Part[]
}
type MessagesTransformOutput = { messages: MessageWithParts[] }
type UserMessageInfo = Extract<Message, { role: "user" }>
type ModelIdentifier = {
  providerID: string
  modelID: string
}
type RecoveryAttemptTracker = {
  epoch: string
  attempts: number
}

function getSessionID(message: MessageWithParts): string | undefined {
  return message.info.sessionID
}

function findLastUserTurn(messages: MessageWithParts[]): MessageWithParts | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return message
    }
  }

  return undefined
}

function findLastUserMessage(messages: MessageWithParts[]): UserMessageInfo | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return message.info
    }
  }

  return undefined
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readModelIdentifier(info: unknown): ModelIdentifier | undefined {
  if (!isRecord(info)) {
    return undefined
  }

  const model = info["model"]
  const nestedModel = isRecord(model) ? model : undefined
  const providerID = nestedModel
    ? readStringField(nestedModel, "providerID") ?? readStringField(info, "providerID")
    : readStringField(info, "providerID")
  const modelID = nestedModel
    ? readStringField(nestedModel, "modelID") ?? readStringField(info, "modelID")
    : readStringField(info, "modelID")

  return providerID && modelID ? { providerID, modelID } : undefined
}

function findLastUserModel(messages: MessageWithParts[]): ModelIdentifier | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return readModelIdentifier(message.info)
    }
  }

  return undefined
}

function normalizeAssistantPrefillModelID(modelID: string): string {
  const normalizedModelID = normalizeModelID(modelID.toLowerCase())
  return normalizedModelID
    .split(/[/.~:@]+/)
    .find((segment) => segment.startsWith("claude-")) ?? normalizedModelID
}

function hasAnthropicModelNamespace(modelID: string): boolean {
  const normalizedModelID = normalizeModelID(modelID.toLowerCase())
  return /(?:^|[/.~:@])anthropic(?:$|[/.~:@])/.test(normalizedModelID)
}

function providerCanExposeUnsupportedAssistantPrefill(providerID: string, modelID: string): boolean {
  return ASSISTANT_PREFILL_UNSUPPORTED_PROVIDERS.has(providerID) ||
    hasAnthropicModelNamespace(modelID)
}

function shouldRepairAssistantPrefillForModel(model: ModelIdentifier | undefined): boolean {
  if (!model) {
    return false
  }

  const providerID = model.providerID.toLowerCase()
  if (!providerCanExposeUnsupportedAssistantPrefill(providerID, model.modelID)) {
    return false
  }

  const modelID = normalizeAssistantPrefillModelID(model.modelID)
  return ASSISTANT_PREFILL_UNSUPPORTED_MODEL_PREFIXES.some((prefix) => modelID.startsWith(prefix))
}

function isCompactionContinuationPart(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }

  const metadata = part["metadata"]
  return isRecord(metadata) && metadata["compaction_continue"] === true
}

function isAssistantPrefillRecoveryMarkerPart(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }

  const metadata = part["metadata"]
  return isRecord(metadata) && metadata[ASSISTANT_PREFILL_RECOVERY_METADATA_KEY] === true
}

function hasInternalContinuationTrigger(messages: MessageWithParts[]): boolean {
  return findLastUserTurn(messages)?.parts.some(isCompactionContinuationPart) === true
}

function hasOwnRecoveryMarker(messages: MessageWithParts[]): boolean {
  return findLastUserTurn(messages)?.parts.some(isAssistantPrefillRecoveryMarkerPart) === true
}

function readCompletedTime(info: unknown): number {
  if (!isRecord(info)) {
    return 0
  }

  const time = info["time"]
  if (!isRecord(time)) {
    return 0
  }

  const completed = time["completed"]
  return typeof completed === "number" && Number.isFinite(completed) && completed > 0 ? completed : 0
}

function readToolStatus(part: unknown): string | undefined {
  if (!isRecord(part)) {
    return undefined
  }

  const state = part["state"]
  if (!isRecord(state)) {
    return undefined
  }

  const status = state["status"]
  return typeof status === "string" ? status : undefined
}

// A tail is complete when the turn finished normally (time.completed set) or its
// last part is a settled tool call. Anything else (dangling pending/running tool,
// empty payload, text-only partial stream) counts as a genuinely interrupted
// assistant state worth recovering. Unknown tool statuses settle toward
// "complete" so a malformed tail can never drive an injection loop.
function isCompleteAssistantTail(message: MessageWithParts): boolean {
  if (readCompletedTime(message.info) > 0) {
    return true
  }

  const lastPart = message.parts.at(-1)
  if (!lastPart) {
    return false
  }
  if (lastPart.type !== "tool") {
    return false
  }

  const status = readToolStatus(lastPart)
  return status !== "pending" && status !== "running"
}

function createAssistantPrefillRecoveryMessage(
  lastAssistantMessage: MessageWithParts,
  messages: MessageWithParts[],
): MessageWithParts {
  const lastUserMessage = findLastUserMessage(messages)
  const sessionID = getSessionID(lastAssistantMessage) ?? lastUserMessage?.sessionID ?? ""
  const messageID = `${lastAssistantMessage.info.id}_prefill_recovery`
  const model = readModelIdentifier(lastUserMessage) ?? {
    providerID: "internal",
    modelID: "assistant-prefill-guard",
  }

  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: lastUserMessage?.agent ?? "internal",
      model,
      ...(lastUserMessage?.system ? { system: lastUserMessage.system } : {}),
      ...(lastUserMessage?.tools ? { tools: lastUserMessage.tools } : {}),
    },
    parts: [
      {
        id: `${messageID}_text`,
        sessionID,
        messageID,
        type: "text",
        text: ASSISTANT_PREFILL_RECOVERY_TEXT,
        synthetic: true,
        metadata: { [ASSISTANT_PREFILL_RECOVERY_METADATA_KEY]: true },
      },
    ],
  }
}

export function createAssistantPrefillRecoveryGate() {
  const attemptsBySession = new Map<string, RecoveryAttemptTracker>()

  function recoveryEpoch(messages: MessageWithParts[]): string {
    return findLastUserTurn(messages)?.info.id ?? "<no-user-turn>"
  }

  function injectionBudgetExhausted(sessionKey: string, epoch: string): boolean {
    const tracker = attemptsBySession.get(sessionKey)
    return tracker?.epoch === epoch && tracker.attempts >= MAX_ASSISTANT_PREFILL_RECOVERY_ATTEMPTS
  }

  function registerInjection(sessionKey: string, epoch: string): void {
    const tracker = attemptsBySession.get(sessionKey)
    if (tracker && tracker.epoch === epoch) {
      tracker.attempts += 1
      return
    }
    if (!tracker && attemptsBySession.size >= RECOVERY_SESSION_TRACK_LIMIT) {
      const oldest = attemptsBySession.keys().next().value
      if (oldest !== undefined) {
        attemptsBySession.delete(oldest)
      }
    }
    attemptsBySession.set(sessionKey, { epoch, attempts: 1 })
  }

  function maybeAppendRecovery(output: MessagesTransformOutput): void {
    const lastMessage = output.messages.at(-1)
    if (!lastMessage || lastMessage.info.role !== "assistant") {
      return
    }

    const shouldRepairAssistantTail = hasInternalContinuationTrigger(output.messages) ||
      shouldRepairAssistantPrefillForModel(findLastUserModel(output.messages)) ||
      shouldRepairAssistantPrefillForModel(readModelIdentifier(lastMessage.info))
    if (!shouldRepairAssistantTail) {
      return
    }

    // Loop-breakers: never chain onto our own injected continuation, never
    // exceed the per-user-turn attempt cap, and never recover a turn that
    // actually finished (issue #7150: infinite continuation loop).
    if (hasOwnRecoveryMarker(output.messages)) {
      return
    }
    const sessionKey = getSessionID(lastMessage) ?? ""
    const epoch = recoveryEpoch(output.messages)
    if (injectionBudgetExhausted(sessionKey, epoch)) {
      return
    }
    if (isCompleteAssistantTail(lastMessage)) {
      return
    }

    output.messages.push(createAssistantPrefillRecoveryMessage(lastMessage, output.messages))
    registerInjection(sessionKey, epoch)
  }

  return { maybeAppendRecovery }
}
