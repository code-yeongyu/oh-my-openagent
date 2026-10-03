import type { Message, Part } from "@opencode-ai/sdk"

import { log } from "../shared/logger"
import type { CreatedHooks } from "../create-hooks"

import { createAssistantPrefillRecoveryGate } from "./assistant-prefill-recovery"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformOutput = { messages: MessageWithParts[] }
type MessagesTransformHooks = {
  btwSideContextInjector?: CreatedHooks["btwSideContextInjector"]
  contextInjectorMessagesTransform?: CreatedHooks["contextInjectorMessagesTransform"]
  teamModeStatusInjector?: CreatedHooks["teamModeStatusInjector"]
  teamMailboxInjector?: CreatedHooks["teamMailboxInjector"]
  toolPairValidator?: CreatedHooks["toolPairValidator"]
  monitorStatusInjector?: CreatedHooks["monitorStatusInjector"]
  categorySkillReminder?: CreatedHooks["categorySkillReminder"]
}
type MessagesTransformHookKey = keyof MessagesTransformHooks
type MessagesTransformHookEntry = {
  readonly key: MessagesTransformHookKey
  readonly name: string
  readonly fatal?: boolean
}

const MESSAGES_TRANSFORM_HOOKS = [
  {
    key: "btwSideContextInjector",
    name: "btwSideContextInjector",
    fatal: true,
  },
  { key: "contextInjectorMessagesTransform", name: "contextInjectorMessagesTransform" },
  { key: "teamModeStatusInjector", name: "teamModeStatusInjector" },
  { key: "teamMailboxInjector", name: "teamMailboxInjector" },
  { key: "toolPairValidator", name: "toolPairValidator" },
  { key: "monitorStatusInjector", name: "monitorStatusInjector" },
  { key: "categorySkillReminder", name: "categorySkillReminder" },
] satisfies readonly MessagesTransformHookEntry[]

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
  const assistantPrefillRecoveryGate = createAssistantPrefillRecoveryGate()

  return async (input, output): Promise<void> => {
    for (const hook of MESSAGES_TRANSFORM_HOOKS) {
      const handler =
        args.hooks[hook.key]?.["experimental.chat.messages.transform"]
      if (hook.fatal) {
        if (handler) await Promise.resolve(handler(input, output))
        continue
      }
      await runMessagesTransformHookSafely(
        hook.name,
        handler,
        input,
        output,
      )
    }

    assistantPrefillRecoveryGate.maybeAppendRecovery(output)
  }
}
