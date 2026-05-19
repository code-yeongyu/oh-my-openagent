import type { Message, Part } from "@opencode-ai/sdk"

import { log } from "../shared/logger"
import { normalizeModelID } from "../shared/model-normalization"
import type { CreatedHooks } from "../create-hooks"

const ASSISTANT_PREFILL_RECOVERY_TEXT = "[internal] Continue from the previous assistant state."
const ASSISTANT_PREFILL_UNSUPPORTED_PROVIDERS = new Set([
  "anthropic",
  "google-vertex-anthropic",
  "opencode",
])
const ASSISTANT_PREFILL_UNSUPPORTED_MODEL_PREFIXES = [
  "claude-opus-4-7",
  "claude-opus-4-6",
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

function getSessionID(message: MessageWithParts): string | undefined {
  return message.info.sessionID
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

function findLastUserTurn(messages: MessageWithParts[]): MessageWithParts | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return message
    }
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
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

function shouldRepairAssistantPrefillForModel(model: ModelIdentifier | undefined): boolean {
  if (!model) {
    return false
  }

  const providerID = model.providerID.toLowerCase()
  if (!ASSISTANT_PREFILL_UNSUPPORTED_PROVIDERS.has(providerID)) {
    return false
  }

  const modelID = normalizeModelID(model.modelID.toLowerCase())
  return ASSISTANT_PREFILL_UNSUPPORTED_MODEL_PREFIXES.some((prefix) => modelID.startsWith(prefix))
}

function isCompactionContinuationPart(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }

  const metadata = part["metadata"]
  return isRecord(metadata) && metadata["compaction_continue"] === true
}

function hasInternalContinuationTrigger(messages: MessageWithParts[]): boolean {
  return findLastUserTurn(messages)?.parts.some(isCompactionContinuationPart) === true
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
      },
    ],
  }
}

function ensureUserTurnAfterAssistantTail(output: MessagesTransformOutput): void {
  const lastMessage = output.messages.at(-1)
  if (!lastMessage || lastMessage.info.role !== "assistant") {
    return
  }

  const shouldRepairAssistantTail = hasInternalContinuationTrigger(output.messages) ||
    shouldRepairAssistantPrefillForModel(findLastUserModel(output.messages) ?? readModelIdentifier(lastMessage.info))
  if (!shouldRepairAssistantTail) {
    return
  }

  output.messages.push(createAssistantPrefillRecoveryMessage(lastMessage, output.messages))
}

async function runMessagesTransformHookSafely<I, O>(
  hookName: string,
  handler: ((input: I, output: O) => unknown | Promise<unknown>) | null | undefined,
  input: I,
  output: O,
): Promise<void> {
  if (!handler) return
  try {
    await Promise.resolve(handler(input, output))
  } catch (error) {
    // Isolate per-handler failures so later handlers (notably toolPairValidator)
    // always run. A throw here used to leave orphaned tool_use blocks in the
    // post-compaction payload, producing API 400s like
    // "tool_use ids were found without tool_result blocks immediately after".
    log("[messages-transform] hook execution failed", {
      hook: hookName,
      error,
    })
  }
}

export function createMessagesTransformHandler(args: {
  hooks: CreatedHooks
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    await runMessagesTransformHookSafely(
      "contextInjectorMessagesTransform",
      args.hooks.contextInjectorMessagesTransform?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "teamModeStatusInjector",
      args.hooks.teamModeStatusInjector?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "teamMailboxInjector",
      args.hooks.teamMailboxInjector?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "thinkingBlockValidator",
      args.hooks.thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "toolPairValidator",
      args.hooks.toolPairValidator?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    ensureUserTurnAfterAssistantTail(output)
  }
}
