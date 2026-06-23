export type DeepSeekFrame = { p?: unknown; o?: unknown; v?: unknown }

export const FINISHED_TERMINAL = "FINISHED"
const CONTENT_PATH = "response/content"

export function safeParseFrame(raw: string): DeepSeekFrame | null {
  try {
    return JSON.parse(raw) as DeepSeekFrame
  } catch {
    return null
  }
}

export function extractContentDelta(
  parsed: DeepSeekFrame,
  currentPath: string,
): string | null {
  if (currentPath !== CONTENT_PATH) return null
  if (typeof parsed.v !== "string") return null
  return parsed.v
}

export function extractTerminalStatus(parsed: DeepSeekFrame): string | null {
  if (parsed.p === "response/status" && typeof parsed.v === "string") {
    return parsed.v
  }
  if (typeof parsed.v === "object" && parsed.v !== null && "response" in parsed.v) {
    const inner = (parsed.v as { response?: { status?: unknown } }).response
    if (inner && typeof inner.status === "string") return inner.status
  }
  return null
}

export type OpenAIChunkArgs = {
  id: string
  model: string
  created: number
  delta: Record<string, unknown>
  finish_reason: string | null
}

export function buildOpenAIChunkLine(args: OpenAIChunkArgs): string {
  const obj = {
    id: args.id,
    object: "chat.completion.chunk",
    created: args.created,
    model: args.model,
    choices: [{ index: 0, delta: args.delta, finish_reason: args.finish_reason }],
  }
  return `data: ${JSON.stringify(obj)}\n\n`
}
