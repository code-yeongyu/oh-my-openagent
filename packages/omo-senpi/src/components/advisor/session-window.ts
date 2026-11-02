const TASK_CHARS = 1200
const ARGS_CHARS = 240
const RESULT_CHARS = 320
const ASSISTANT_CHARS = 600

export type AdvisorEvent =
  | { readonly kind: "tool"; readonly name: string; readonly args: string; readonly error: boolean; readonly result: string }
  | { readonly kind: "assistant"; readonly text: string }

export interface AdvisorSessionWindow {
  task: string | undefined
  readonly events: AdvisorEvent[]
  toolResults: number
  lastGateAt: number
  lastAdviceAt: number | undefined
  advices: number
  inFlight: boolean
}

export function createAdvisorSessionWindow(): AdvisorSessionWindow {
  return { task: undefined, events: [], toolResults: 0, lastGateAt: 0, lastAdviceAt: undefined, advices: 0, inFlight: false }
}

export function pushAdvisorEvent(window: AdvisorSessionWindow, event: AdvisorEvent, limit: number): void {
  window.events.push(event)
  if (window.events.length > limit) window.events.splice(0, window.events.length - limit)
}

export function toolEvent(name: string, input: unknown, error: boolean, content: unknown): AdvisorEvent {
  return { kind: "tool", name, args: clip(stringify(input), ARGS_CHARS), error, result: clip(textOf(content), RESULT_CHARS) }
}

export function assistantEvent(text: string): AdvisorEvent {
  return { kind: "assistant", text: clip(text, ASSISTANT_CHARS) }
}

export function rememberTask(window: AdvisorSessionWindow, prompt: string): void {
  if (window.task !== undefined) return
  const line = prompt.trim()
  if (line.length > 0) window.task = clip(line, TASK_CHARS)
}

export function renderAdvisorState(window: AdvisorSessionWindow): string {
  const lines = [`TASK:\n${window.task ?? "(unknown)"}`, "", `RECENT ACTIVITY (oldest first, ${window.events.length} events):`]
  window.events.forEach((event, index) => {
    const n = index + 1
    if (event.kind === "assistant") lines.push(`${n}. assistant: ${event.text}`)
    else lines.push(`${n}. tool ${event.name}${event.error ? " [ERROR]" : ""} args=${event.args} -> ${event.result}`)
  })
  return lines.join("\n")
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : ""))
    .join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
