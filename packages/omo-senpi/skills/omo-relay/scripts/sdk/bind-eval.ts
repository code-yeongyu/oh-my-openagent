import type {
  FleetPort,
  MachineRef,
  PortAnswer,
  PortError,
  ThreadListOptions,
  ThreadListValue,
  ThreadPort,
  ThreadReadOptions,
  ThreadReadValue,
  ThreadRow,
  ThreadSendOptions,
  ThreadSendValue,
} from "./ports.ts"

/** What an eval cell's `tool.thread_*` call answers: the tool result, whose `text` is the result as JSON. */
export type ToolText = { readonly text: string }

export type EvalThreadTools = {
  thread_list(args: ThreadListOptions): Promise<ToolText>
  thread_read(args: { readonly thread: string } & ThreadReadOptions): Promise<ToolText>
  thread_send(args: { readonly thread: string; readonly message: string } & ThreadSendOptions): Promise<ToolText>
}

export class RelayBindError extends Error {
  readonly code: "sdk_shape"
  readonly next_action: string

  constructor(code: RelayBindError["code"], message: string, nextAction: string) {
    super(message)
    this.name = "RelayBindError"
    this.code = code
    this.next_action = nextAction
  }
}

type Fields = Readonly<Record<string, unknown>>
type ErrorBranch = { readonly kind: "error"; readonly error: PortError }

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unreadable(tool: string, detail: string): ErrorBranch {
  return {
    kind: "error",
    error: {
      code: "unreadable_result",
      message: `${tool} answered something that is not a thread tool result: ${detail}`,
      next_action: `call tool.${tool} directly and read its text; report the answer if it is not JSON`,
    },
  }
}

function portErrorFrom(value: unknown): PortError | undefined {
  if (!isFields(value)) return undefined
  const { code, message, next_action: nextAction } = value
  if (typeof code !== "string" || typeof message !== "string" || typeof nextAction !== "string") return undefined
  return { code, message, next_action: nextAction, ...(value["uncertain"] === true ? { uncertain: true } : {}) }
}

type Parsed = { readonly ok: true; readonly fields: Fields } | { readonly ok: false; readonly answer: ErrorBranch }

function parseAnswer(tool: string, result: ToolText): Parsed {
  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch (thrown) {
    if (thrown instanceof SyntaxError) return { ok: false, answer: unreadable(tool, thrown.message) }
    throw thrown
  }
  if (!isFields(parsed)) return { ok: false, answer: unreadable(tool, "not an object") }
  if (parsed["kind"] === "error") {
    const error = portErrorFrom(parsed["error"])
    const answer =
      error === undefined
        ? unreadable(tool, "an error without code, message and next_action")
        : { kind: "error" as const, error }
    return { ok: false, answer }
  }
  if (parsed["kind"] !== "ok") return { ok: false, answer: unreadable(tool, `kind ${String(parsed["kind"])}`) }
  return { ok: true, fields: parsed }
}

function rowOf(value: unknown): ThreadRow | undefined {
  if (!isFields(value)) return undefined
  const { thread, name, machine } = value
  if (typeof thread !== "string" || typeof name !== "string") return undefined
  return { thread, name, ...(typeof machine === "string" ? { machine } : {}) }
}

function listAnswer(result: ToolText): PortAnswer<ThreadListValue> {
  const parsed = parseAnswer("thread_list", result)
  if (!parsed.ok) return parsed.answer
  const { fields } = parsed
  const rawRows = fields["threads"]
  if (!Array.isArray(rawRows)) return unreadable("thread_list", "no threads array")
  const threads: ThreadRow[] = []
  for (const raw of rawRows) {
    const row = rowOf(raw)
    if (row === undefined) return unreadable("thread_list", "a row without thread and name")
    threads.push(row)
  }
  return { ...fields, kind: "ok", threads }
}

function readAnswer(result: ToolText): PortAnswer<ThreadReadValue> {
  const parsed = parseAnswer("thread_read", result)
  if (!parsed.ok) return parsed.answer
  const { fields } = parsed
  const { thread, items } = fields
  if (typeof thread !== "string" || !Array.isArray(items)) return unreadable("thread_read", "no thread or items")
  return { ...fields, kind: "ok", thread, items }
}

function sendAnswer(result: ToolText): PortAnswer<ThreadSendValue> {
  const parsed = parseAnswer("thread_send", result)
  if (!parsed.ok) return parsed.answer
  const { fields } = parsed
  const { thread } = fields
  if (typeof thread !== "string") return unreadable("thread_send", "no thread")
  return { ...fields, kind: "ok", thread }
}

/** The thread port over an eval cell's `tool` object: `threadPortFromTools(tool)`. */
export function threadPortFromTools(tool: EvalThreadTools): ThreadPort {
  return {
    list: async (options) => listAnswer(await tool.thread_list(options ?? {})),
    read: async (thread, options) => readAnswer(await tool.thread_read({ ...options, thread })),
    send: async (thread, message, options) => sendAnswer(await tool.thread_send({ ...options, thread, message })),
  }
}

function isFleet(value: unknown): value is FleetPort<MachineRef> {
  return isFields(value) && typeof value["listMachines"] === "function" && typeof value["fanout"] === "function"
}

/**
 * The account's fleet client from the module the cell imported:
 * `fleetFromSdk(await import(\`${env("OMO_BUNSHIN_TS_SDK_ROOT")}/sdk.js\`))`. The cell does the import so the skill
 * holds no non-literal import() (the remote-module guard freezes those).
 */
export function fleetFromSdk(sdk: unknown): FleetPort<MachineRef> {
  const fleet = isFields(sdk) ? sdk["bunshin"] : undefined
  if (!isFleet(fleet)) {
    throw new RelayBindError(
      "sdk_shape",
      "the module passed in does not export a bunshin client with listMachines and fanout",
      "in an omo session's eval cell, import sdk.js from OMO_BUNSHIN_TS_SDK_ROOT and pass that module; update omo if it still fails",
    )
  }
  return fleet
}
