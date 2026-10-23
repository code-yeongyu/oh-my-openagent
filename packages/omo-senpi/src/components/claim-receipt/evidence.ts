import { extractMutatedFilePaths, MUTATION_TOOL_NAMES } from "../post-mutation/post-mutation"
import { cellInvokedKinds } from "./cell-commands"
import { invokedKinds } from "./invocations"
import { isRelevantPath, judgeOutput, judgeStructured } from "./signatures"

export type CheckKind = "test" | "typecheck" | "lint" | "build" | "run" | "lsp" | "lookup"
export type CheckOutcome = "passed" | "failed" | "unknown"

export interface CheckEvidence {
  readonly at: number
  readonly entryId: string
  readonly kind: CheckKind
  readonly outcome: CheckOutcome
  readonly command?: string
}

export interface EditEvidence {
  readonly at: number
  readonly entryId: string
  readonly paths: readonly string[]
  readonly relevant: boolean
}

export interface Timeline {
  readonly checks: readonly CheckEvidence[]
  readonly edits: readonly EditEvidence[]
}

type Rec = Record<string, unknown>
type CommandKind = Exclude<CheckKind, "lsp" | "lookup">
const LOOKUP_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "glob", "find", "ls", "lsp_goto_definition", "lsp_find_references", "lsp_symbols", "ast_grep"])
const splitKinds = (line: string) => {
  const all = invokedKinds(line)
  return { kinds: all.filter((kind): kind is CommandKind => kind !== "lookup"), lookup: all.includes("lookup") }
}
interface PendingCheck {
  readonly kinds: readonly CommandKind[]
  readonly command: string
}

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asString = (value: unknown): string => (typeof value === "string" ? value : "")

export function contentText(content: unknown): string {
  if (typeof content === "string") return content
  return asArray(content)
    .map((part) => (isRecord(part) && part["type"] === "text" ? asString(part["text"]) : ""))
    .join("\n")
}

const BACKGROUND_ID = /\bID:\s*([\w-]+)/
const DETACHED_DONE = /Detached eval cell (\S+) \(\w+\) (completed|failed)/
const TERMINAL_DONE = /Background terminal session (\S+) finished: (\w+) \(exit code (-?\d+)\)/
const MONITOR_DESCRIPTION = /Monitor event\(([^)]*)\)/

class TimelineBuilder {
  readonly checks: CheckEvidence[] = []
  readonly edits: EditEvidence[] = []
  readonly #calls = new Map<string, { readonly name: string; readonly args: Rec }>()
  readonly #background = new Map<string, PendingCheck>()
  readonly #detached = new Map<string, PendingCheck>()

  addCheck(at: number, entryId: string, pending: PendingCheck, outcome: CheckOutcome): void {
    for (const kind of pending.kinds) this.checks.push({ at, entryId, kind, outcome, command: pending.command.slice(0, 200) })
  }

  addEdit(at: number, entryId: string, paths: readonly string[]): void {
    this.edits.push({ at, entryId, paths, relevant: paths.length === 0 || paths.some(isRelevantPath) })
  }

  entry(entry: unknown, index: number): void {
    if (!isRecord(entry)) return
    const entryId = asString(entry["id"])
    if (entry["type"] === "custom_message") return this.notification(asString(entry["customType"]), contentText(entry["content"]), entry["details"], index, entryId)
    const message = entry["message"]
    if (entry["type"] !== "message" || !isRecord(message)) return
    if (message["role"] === "assistant") {
      for (const part of asArray(message["content"])) {
        if (isRecord(part) && part["type"] === "toolCall") this.#calls.set(asString(part["id"]), { name: asString(part["name"]), args: isRecord(part["arguments"]) ? part["arguments"] : {} })
      }
      return
    }
    if (message["role"] === "toolResult") this.toolResult(message, index, entryId)
  }

  toolResult(message: Rec, index: number, entryId: string): void {
    const toolName = asString(message["toolName"])
    const callId = asString(message["toolCallId"])
    const args = this.#calls.get(callId)?.args ?? {}
    const isError = message["isError"] === true
    const text = contentText(message["content"])
    if (toolName === "eval") return this.evalResult(callId, args, message["details"], text, isError, index, entryId)
    if (MUTATION_TOOL_NAMES.has(toolName)) {
      if (!isError) this.addEdit(index, entryId, extractMutatedFilePaths({ toolName, input: args, details: message["details"] }))
      return
    }
    if (toolName === "lsp_diagnostics") return this.lsp(text, isError, index, entryId)
    if (LOOKUP_TOOLS.has(toolName)) return this.lookup(isError, text, index, entryId)
    if (toolName === "bash" || toolName === "powershell") {
      const command = asString(args["command"])
      const { kinds, lookup } = splitKinds(command)
      if (kinds.length > 0) this.addCheck(index, entryId, { kinds, command }, judgeStructured(isError, text))
      if (lookup && kinds.length === 0) this.lookup(isError, text, index, entryId)
    }
  }

  lookup(isError: boolean, text: string, at: number, entryId: string): void {
    if (!isError && text.trim() !== "") this.checks.push({ at, entryId, kind: "lookup", outcome: "passed" })
  }

  lsp(text: string, isError: boolean, at: number, entryId: string): void {
    if (isError) return
    const outcome = judgeOutput(text)
    if (outcome !== "unknown") this.checks.push({ at, entryId, kind: "lsp", outcome })
  }

  evalResult(callId: string, args: Rec, details: unknown, text: string, isError: boolean, index: number, entryId: string): void {
    const record = isRecord(details) ? details : {}
    const hostCalls = asArray(record["toolCalls"]).filter(isRecord)
    for (const call of hostCalls) this.hostCall(call, index + 0.5, entryId)
    if (hostCalls.some((call) => call["name"] === "bash")) return
    const cells = asArray(record["cells"]).filter(isRecord)
    const fallback = { code: asString(args["code"]), output: text, status: isError ? "error" : "complete" }
    for (const cell of cells.length > 0 ? cells : [fallback]) {
      this.cell(callId, asString(cell["code"]), asString(cell["output"]), cell["status"], index, entryId)
    }
  }

  hostCall(call: Rec, at: number, entryId: string): void {
    const name = asString(call["name"])
    const args = isRecord(call["args"]) ? call["args"] : {}
    const preview = asString(call["resultPreview"])
    if (MUTATION_TOOL_NAMES.has(name)) {
      if (call["ok"] !== false) this.addEdit(at, entryId, extractMutatedFilePaths({ toolName: name, input: args }))
      return
    }
    if (name === "lsp_diagnostics") return this.lsp(preview, call["ok"] === false, at, entryId)
    if (LOOKUP_TOOLS.has(name)) return this.lookup(call["ok"] === false, preview, at, entryId)
    if (name !== "bash" && name !== "monitor") return
    const command = asString(args["command"])
    const { kinds, lookup } = splitKinds(command)
    if (kinds.length === 0) {
      if (lookup && name === "bash") this.lookup(call["ok"] === false, preview, at, entryId)
      return
    }
    const background = name === "monitor" || args["run_in_background"] === true
    if (background && call["ok"] === false) return
    const backgroundId = background ? BACKGROUND_ID.exec(preview)?.[1] : undefined
    if (backgroundId !== undefined) {
      this.#background.set(backgroundId, { kinds, command })
      if (name === "monitor") this.#background.set(`desc:${asString(args["description"])}`, { kinds, command })
      return
    }
    this.addCheck(at, entryId, { kinds, command }, judgeStructured(call["ok"] === false, preview))
  }

  cell(callId: string, code: string, output: string, status: unknown, index: number, entryId: string): void {
    const { kinds, offset } = cellInvokedKinds(code)
    if (kinds.length === 0) return
    const pending = { kinds, command: code }
    const at = index + (offset + 1) / (code.length + 2)
    // Cell code mixes mutation probes, log greps, scratch writes and composed reports with real runs, so a cell
    // can support a claim but never contradicts one: its failures are not attributed and its writes are not
    // edits. Only structured sources (host calls, tool results, terminal exit codes) produce a failed check, and
    // only edit/write/apply_patch results produce an edit.
    if (status === "complete" && judgeOutput(output) === "passed") return this.addCheck(at, entryId, pending, "passed")
    if (status === "complete" || status === "error") return this.addCheck(at, entryId, pending, "unknown")
    this.#detached.set(callId, pending)
    this.addCheck(at, entryId, pending, "unknown")
  }

  notification(customType: string, content: string, details: unknown, index: number, entryId: string): void {
    if (customType === "omo-senpi:wake") {
      for (const item of asArray(details).filter(isRecord)) {
        const range = asArray(item["contentRange"])
        const [start, end] = [range[0], range[1]]
        const slice = typeof start === "number" && typeof end === "number" ? content.slice(start, end) : content
        this.notification(asString(item["customType"]), slice, item["details"], index, entryId)
      }
      return
    }
    if (customType === "senpi-codemode:notification") {
      const match = DETACHED_DONE.exec(content)
      const pending = match === null ? undefined : this.#detached.get(match[1] ?? "")
      if (match === null || pending === undefined) return
      this.#detached.delete(match[1] ?? "")
      const passed = match[2] === "completed" && judgeOutput(content.slice(match.index + match[0].length)) === "passed"
      this.addCheck(index, entryId, pending, passed ? "passed" : "unknown")
      return
    }
    if (customType === "senpi-terminal:notification") {
      const match = TERMINAL_DONE.exec(content)
      const pending = match === null ? undefined : this.#background.get(match[1] ?? "")
      if (match === null || pending === undefined) return
      this.#background.delete(match[1] ?? "")
      if (match[2] === "killed") return
      this.addCheck(index, entryId, pending, match[3] === "0" ? judgeOutput(content) : "failed")
      return
    }
    if (customType === "senpi-monitor:notification") {
      if (/\bwatcher (?:killed|timed_out)\b|\bwatcher\b[^\n]*\bkilled\b/.test(content)) return
      const ids = asArray(isRecord(details) ? details["monitors"] : undefined).map((monitor) => (isRecord(monitor) ? asString(monitor["id"]) : ""))
      const description = MONITOR_DESCRIPTION.exec(content)?.[1]
      const pending = ids.map((id) => this.#background.get(id)).find((value) => value !== undefined) ?? (description === undefined ? undefined : this.#background.get(`desc:${description}`))
      const outcome = judgeOutput(content)
      if (pending !== undefined && outcome !== "unknown") this.addCheck(index, entryId, pending, outcome)
    }
  }
}

export function buildTimeline(entries: readonly unknown[]): Timeline {
  const builder = new TimelineBuilder()
  entries.forEach((entry, index) => builder.entry(entry, index))
  return { checks: builder.checks, edits: builder.edits }
}
