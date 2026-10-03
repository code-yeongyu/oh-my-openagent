import registerMockProvider, {
  loadMockScript,
  type MockStep,
  stepToAssistantMessage,
  streamMockStep,
} from "../../../../packages/omo-senpi/scripts/qa/mock-provider/index"

export const QA_PROMPT_PREFIX = "macOS computer QA"

const BACKGROUND_REPLY: MockStep = { type: "text", text: "omo macOS QA background reply" }

type ContextMessage = { readonly role?: unknown; readonly content?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textOf(message: ContextMessage): string {
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return ""
  return message.content
    .map((part: unknown) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "")
    .join("")
}

/**
 * Picks the reply from the conversation instead of a call counter: senpi also asks the model for its
 * own reasons (a session title after the first turn), and a counter those requests advance hands the
 * harness's next prompt the wrong step. A tool result is answered with the script's closing text, a QA
 * prompt with its tool call, and anything else with a reply that consumes nothing.
 */
export function chooseStep(messages: readonly ContextMessage[], steps: readonly MockStep[]): MockStep {
  const toolCall = steps.findLast((step) => step.type === "tool_call")
  const closing = steps.findLast((step) => step.type === "text")
  if (messages.at(-1)?.role === "toolResult") return closing ?? BACKGROUND_REPLY
  const lastAnswered = messages.findLastIndex((message) => message.role === "assistant" || message.role === "toolResult")
  const pending = messages.slice(lastAnswered + 1)
  if (pending.some((message) => message.role === "user" && textOf(message).startsWith(QA_PROMPT_PREFIX)))
    return toolCall ?? closing ?? BACKGROUND_REPLY
  return BACKGROUND_REPLY
}

/**
 * Senpi's RPC JSON encoder needs the tool id and name in the first `toolcall_start` partial, which the
 * shared scripted stream leaves empty; this lane fills it in without changing shared QA.
 */
export default function registerMacosProvider(pi: Parameters<typeof registerMockProvider>[0]): void {
  let calls = 0
  registerMockProvider({
    registerProvider(id, provider) {
      pi.registerProvider(id, {
        ...provider,
        streamSimple(_model, context, options) {
          calls += 1
          const messages: readonly ContextMessage[] = Array.isArray(context.messages) ? context.messages : []
          const step = chooseStep(messages, loadMockScript(context.cwd ?? process.cwd()).steps)
          const toolCall = stepToAssistantMessage(step, calls).content[0]
          const stream = streamMockStep(step, calls, options)
          return {
            result: () => stream.result(),
            async *[Symbol.asyncIterator]() {
              for await (const event of stream) {
                if (isRecord(event) && event.type === "toolcall_start" && toolCall?.type === "toolCall") {
                  yield { ...event, partial: { ...(isRecord(event.partial) ? event.partial : {}), content: [toolCall] } }
                } else yield event
              }
            },
          }
        },
      })
    },
  })
}
