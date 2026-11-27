// Which tool result answers THIS step. Each step's prompt carries a nonce of its own. A result is taken only through the
// id it carries itself: the tool message's `tool_call_id` names one assistant tool call; that call must be `tool`, and the
// user message it answered (the one just before it) must carry the nonce. A result that merely arrives after the prompt,
// or answers another call, is never taken.

type Message = {
  readonly role?: unknown
  readonly content?: unknown
  readonly tool_call_id?: unknown
  readonly tool_calls?: unknown
}
type ModelRequest = { readonly messages?: unknown }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : "")).join("\n")
      : ""

const parsed = (raw: string): unknown => {
  try {
    const value: unknown = JSON.parse(raw)
    if (isRecord(value) && isRecord(value["details"]) && "result" in value["details"]) return value["details"]["result"]
    return isRecord(value) && "result" in value ? value["result"] : value
  } catch {
    return { unparsed: raw }
  }
}

/** The result of `tool` for the call made in answer to the prompt carrying `nonce`; undefined until it exists. */
export function toolResultFor(requests: readonly ModelRequest[], tool: string, nonce: string): unknown {
  for (const request of requests) {
    const messages = (Array.isArray(request.messages) ? request.messages : []) as readonly Message[]
    for (const result of messages) {
      if (result.role !== "tool" || typeof result.tool_call_id !== "string") continue
      const at = messages.findIndex(
        (message) =>
          message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.some(
            (call: unknown) =>
              isRecord(call) &&
              call["id"] === result.tool_call_id &&
              isRecord(call["function"]) &&
              call["function"]["name"] === tool,
          ),
      )
      const prompt = at > 0 ? messages[at - 1] : undefined
      if (prompt?.role === "user" && textOf(prompt.content).includes(nonce)) return parsed(textOf(result.content))
    }
  }
  return undefined
}
