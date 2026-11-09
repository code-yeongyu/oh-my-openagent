export const CLAUDE = "pm-claude"
export const GPT = "pm-gpt"
export const ALT = "pm-alt"

const QUOTA_ERROR =
  `403: {"message":"You've reached your usage limit for this billing cycle. Your limit resets 3:20am.",` +
  `"type":"access_terminated_error"}`

// A content-policy refusal and a rejected credential: neither is a usage limit.
const REFUSAL_ERROR = "400: This request was flagged as a possible cybersecurity risk and refused under the content policy."
const AUTH_ERROR = "401: Unauthorized - invalid api key"

const ERRORS = { quota: QUOTA_ERROR, refusal: REFUSAL_ERROR, auth: AUTH_ERROR } as const

export type Step = keyof typeof ERRORS | "complete" | { readonly tool: string } | { readonly partialTool: string }

// `claude-opus-5-5` and `claude-opus-5` are the ids senpi's shipped default chain names
// (`claude-opus-5-5` -> `claude-opus-5:max`). The rung lives on another account, so a usage limit on the
// first never makes the default unreachable by itself: only the child's own fallback policy can.
export const MODELS: Readonly<Record<string, readonly string[]>> = {
  [CLAUDE]: ["primary", "sibling", "claude-opus-5-5"],
  [GPT]: ["parent", "gpt-6-astra"],
  [ALT]: ["rung", "claude-opus-5"],
}

const REASONING = new Set(["claude-opus-5-5", "claude-opus-5"])

export function testModel(id: string) {
  return {
    id,
    name: id,
    reasoning: REASONING.has(id),
    input: ["text"] as Array<"text">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

export function answer(provider: string, model: string, step: Step) {
  const base = {
    role: "assistant" as const,
    api: "openai-completions" as const,
    provider,
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
  }
  const toolCall = (name: string) => ({ type: "toolCall" as const, id: `call-${name}`, name, arguments: {} })
  if (typeof step === "string" && step !== "complete") return stream([], { ...base, content: [], stopReason: "error" as const, errorMessage: ERRORS[step] })
  if (step === "complete") {
    return stream([], { ...base, content: [{ type: "text" as const, text: `${provider}/${model} completed` }], stopReason: "stop" as const })
  }
  if ("tool" in step) return stream([], { ...base, content: [toolCall(step.tool)], stopReason: "toolUse" as const })
  // The limit lands while the call is still streaming: the provider had opened it, then errored.
  const partial = { ...base, content: [toolCall(step.partialTool)], stopReason: "toolUse" as const }
  return stream(
    [{ type: "start", partial }, { type: "toolcall_start", contentIndex: 0, partial }],
    { ...partial, stopReason: "error" as const, errorMessage: QUOTA_ERROR },
  )
}

function stream<Message extends { readonly stopReason: string }>(opening: readonly unknown[], message: Message) {
  const events = [
    ...opening,
    message.stopReason === "error" ? { type: "error", reason: "error", error: message } : { type: "done", reason: message.stopReason, message },
  ]
  return {
    result: () => Promise.resolve(message),
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next(): Promise<IteratorResult<unknown>> {
          const value = events[index]
          index += 1
          return Promise.resolve(value === undefined ? { value: undefined, done: true } : { value, done: false })
        },
      }
    },
  }
}
