import { isRecord } from "@oh-my-opencode/utils"
import type { Message, Part } from "@opencode-ai/sdk"

import { log } from "../shared/logger"
import { normalizeModelID } from "../shared/model-normalization"
import type { CreatedHooks } from "../create-hooks"

const ASSISTANT_PREFILL_RECOVERY_TEXT = "[internal] Continue from the previous assistant state."
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
type MessagesTransformHooks = {
  contextInjectorMessagesTransform?: CreatedHooks["contextInjectorMessagesTransform"]
  teamModeStatusInjector?: CreatedHooks["teamModeStatusInjector"]
  teamMailboxInjector?: CreatedHooks["teamMailboxInjector"]
  toolPairValidator?: CreatedHooks["toolPairValidator"]
  monitorStatusInjector?: CreatedHooks["monitorStatusInjector"]
}
type MessagesTransformHookKey = keyof MessagesTransformHooks
type MessagesTransformHookEntry = {
  readonly key: MessagesTransformHookKey
  readonly name: string
}
type UserMessageInfo = Extract<Message, { role: "user" }>
type ModelIdentifier = {
  providerID: string
  modelID: string
}

const MESSAGES_TRANSFORM_HOOKS = [
  { key: "contextInjectorMessagesTransform", name: "contextInjectorMessagesTransform" },
  { key: "teamModeStatusInjector", name: "teamModeStatusInjector" },
  { key: "teamMailboxInjector", name: "teamMailboxInjector" },
  { key: "toolPairValidator", name: "toolPairValidator" },
  { key: "monitorStatusInjector", name: "monitorStatusInjector" },
] satisfies readonly MessagesTransformHookEntry[]

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
    shouldRepairAssistantPrefillForModel(findLastUserModel(output.messages)) ||
    shouldRepairAssistantPrefillForModel(readModelIdentifier(lastMessage.info))
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
    const hookError = error instanceof Error ? error : new Error(String(error))
    // Isolate per-handler failures so later handlers (notably toolPairValidator)
    // always run. A throw here used to leave orphaned tool_use blocks in the
    // post-compaction payload, producing API 400s like
    // "tool_use ids were found without tool_result blocks immediately after".
    log("[messages-transform] hook execution failed", {
      hook: hookName,
      error: hookError,
    })
  }
}

export function createMessagesTransformHandler(args: {
  hooks: MessagesTransformHooks
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    for (const hook of MESSAGES_TRANSFORM_HOOKS) {
      await runMessagesTransformHookSafely(
        hook.name,
        args.hooks[hook.key]?.["experimental.chat.messages.transform"],
        input,
        output,
      )
    }

    ensureUserTurnAfterAssistantTail(output)
  }
}
