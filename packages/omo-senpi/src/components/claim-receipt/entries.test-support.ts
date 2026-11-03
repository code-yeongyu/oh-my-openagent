export type FixtureEntry = Record<string, unknown>

let sequence = 0
const nextId = (): string => `e${(sequence += 1)}`

export function userInput(text: string): FixtureEntry {
  return { type: "message", id: nextId(), message: { role: "user", content: [{ type: "text", text }] } }
}

export function answer(text: string, id = nextId()): FixtureEntry {
  return { type: "message", id, message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } }
}

export function toolCall(callId: string, name: string, args: Record<string, unknown>): FixtureEntry {
  return {
    type: "message",
    id: nextId(),
    message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: callId, name, arguments: args }] },
  }
}

export function toolResult(
  callId: string,
  toolName: string,
  options: { readonly text?: string; readonly details?: unknown; readonly isError?: boolean } = {},
): FixtureEntry {
  return {
    type: "message",
    id: nextId(),
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName,
      content: [{ type: "text", text: options.text ?? "" }],
      details: options.details ?? {},
      isError: options.isError ?? false,
    },
  }
}

export interface CellFixture {
  readonly code: string
  readonly output?: string
  readonly status?: string | null
}

export function evalRun(
  callId: string,
  cell: CellFixture,
  hostCalls: ReadonlyArray<Record<string, unknown>> = [],
): FixtureEntry[] {
  return [
    toolCall(callId, "eval", { language: "js", code: cell.code }),
    toolResult(callId, "eval", {
      text: cell.output ?? "",
      isError: cell.status === "error",
      details: {
        cells: [{ index: 0, code: cell.code, output: cell.output ?? "", status: cell.status === undefined ? "complete" : cell.status }],
        toolCalls: hostCalls,
      },
    }),
  ]
}

export function hostBash(command: string, resultPreview: string, ok = true, extraArgs: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "bash", ok, args: { command, ...extraArgs }, resultPreview }
}

export function customMessage(customType: string, content: string, details?: unknown): FixtureEntry {
  return { type: "custom_message", id: nextId(), customType, content, display: false, ...(details === undefined ? {} : { details }) }
}

export function editResult(callId: string, path: string): FixtureEntry[] {
  return [toolCall(callId, "edit", { path, edits: [] }), toolResult(callId, "edit", { text: "ok" })]
}

export function passingTest(callId: string): FixtureEntry[] {
  return evalRun(callId, { code: "await sh(`bun test src`)", output: " 12 pass\n 0 fail" })
}

export function failingTest(callId: string): FixtureEntry[] {
  return evalRun(callId, { code: "await tool.bash({ command: 'bun test src' })" }, [hostBash("bun test src", " 11 pass\n 1 fail")])
}
