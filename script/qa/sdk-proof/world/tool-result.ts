// Which tool result answers THIS step: each step's prompt carries a nonce of its own, and the result taken is the one the
// fake model received for a tool call made in reply to that very prompt (the newest user message of the request that
// carries the result names the nonce). An earlier call's result arriving late carries another nonce and is never taken.

type Message = { readonly role?: unknown; readonly content?: unknown }
type ModelRequest = { readonly messages?: unknown; readonly answer?: unknown }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : "")).join("\n")
      : ""

/** The result of `tool` answered to the prompt carrying `nonce`, as the session handed it to the model; else undefined. */
export function toolResultFor(requests: readonly ModelRequest[], tool: string, nonce: string): unknown {
  for (const request of requests) {
    const answer = request.answer
    if (!isRecord(answer) || answer["kind"] !== "tool_result" || answer["tool"] !== tool) continue
    const messages = (Array.isArray(request.messages) ? request.messages : []) as readonly Message[]
    const prompt = [...messages].reverse().find((message) => message.role === "user")
    if (prompt === undefined || !textOf(prompt.content).includes(nonce)) continue
    const raw = typeof answer["result"] === "string" ? answer["result"] : ""
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed) && isRecord(parsed["details"]) && "result" in parsed["details"])
        return parsed["details"]["result"]
      return isRecord(parsed) && "result" in parsed ? parsed["result"] : parsed
    } catch {
      return { unparsed: raw }
    }
  }
  return undefined
}
