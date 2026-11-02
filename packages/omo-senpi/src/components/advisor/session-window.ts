import { redactSensitiveOutput } from "../memory/kibitzer/sensitive-output"

const TASK_CHARS = 4000
const ARGS_CHARS = 400
const RESULT_CHARS = 1200
const WAIT_TOOLS: ReadonlySet<string> = new Set(["bash_output", "task_output", "sleep"])

export interface AdvisorToolEvent {
  readonly tool: string
  readonly args: string
  readonly result: string
  readonly isError: boolean
  readonly isWait: boolean
}

export interface AdvisorSessionWindow {
  task: string | undefined
  readonly calls: AdvisorToolEvent[]
  toolResults: number
  lastAdviceAt: number | undefined
  advices: number
  inFlight: boolean
  lastMessageAt: number
}

export function createAdvisorSessionWindow(now: number): AdvisorSessionWindow {
  return { task: undefined, calls: [], toolResults: 0, lastAdviceAt: undefined, advices: 0, inFlight: false, lastMessageAt: now }
}

export function recordToolResult(window: AdvisorSessionWindow, tool: string, input: unknown, isError: boolean, content: unknown, limit: number): void {
  const args = clip(redactSensitiveOutput(stringify(input)), ARGS_CHARS)
  const result = clip(redactSensitiveOutput(textOf(content)), RESULT_CHARS)
  window.calls.push({ tool, args, result, isError, isWait: WAIT_TOOLS.has(tool) || /\bsleep\s+\d/.test(args) })
  if (window.calls.length > limit) window.calls.splice(0, window.calls.length - limit)
  window.toolResults += 1
}

export function rememberTask(window: AdvisorSessionWindow, prompt: string): void {
  if (window.task !== undefined) return
  const text = redactSensitiveOutput(prompt).trim()
  if (text.length > 0) window.task = text.length > TASK_CHARS ? `${text.slice(0, TASK_CHARS)}...` : text
}

export function trailingRun(calls: readonly AdvisorToolEvent[], same: (a: AdvisorToolEvent, b: AdvisorToolEvent) => boolean): number {
  const last = calls[calls.length - 1]
  if (last === undefined) return 0
  let run = 0
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]
    if (call === undefined || !same(call, last)) break
    run += 1
  }
  return run
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
