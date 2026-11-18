import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@code-yeongyu/senpi"
import { Text } from "@earendil-works/pi-tui"
import {
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  stripTerminalControls,
} from "@oh-my-opencode/senpi-task/renderer-text"

import type { ThreadToolName, ThreadToolResult } from "../contracts"
import type { AnyTool } from "./internals"

/**
 * What a person at the TUI sees for a thread tool row (#12994). The model still receives the whole
 * result JSON (`internals.ts` `output`); these renderers change only the row: one call line (verb,
 * target, the message's first line) and one outcome line with a few short details. Delivery ids,
 * `message_seq` and full uuids stay out of the collapsed row; an error keeps its code, message and
 * next action; the expanded row adds the full structured result.
 */

type RenderComponent = { render(width: number): string[]; invalidate(): void }
type Args = Readonly<Record<string, unknown>>
type Tone = Extract<ThemeColor, "success" | "warning" | "error" | "muted">
type ResultView = { readonly tone: Tone; readonly headline: string; readonly details: readonly string[] }

const MESSAGE_HEAD_WIDTH = 60
const LABEL_WIDTH = 40
const LIST_HEAD = 5
const OUTBOX_HEAD = 3
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LINK = /^\[((?:\\.|[^\]\\])*)\]\(omo-thread:\/\/v1\/[^)]*\)$/
/** `threadLink`'s label when the session has no name: not a title worth showing. */
const UNNAMED_LINK_LABEL = "thread"

/** Installs the thread family's call and result renderers on one tool definition. */
export function withThreadRenderers(tool: AnyTool): AnyTool {
  const name = tool.name as ThreadToolName
  return { ...tool, renderCall: renderThreadCall(name), renderResult: renderThreadResult(name) }
}

export function renderThreadCall(name: ThreadToolName) {
  return (args: unknown, theme: Theme, _context?: unknown): RenderComponent => {
    const tail = stripTerminalControls(callTail(name, argsOf(args)))
    const head = theme.fg("toolTitle", theme.bold(name))
    return new Text(tail.length === 0 ? head : `${head} ${theme.fg("accent", tail)}`, 0, 0)
  }
}

export function renderThreadResult(name: ThreadToolName) {
  return (
    output: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context?: { readonly args?: unknown },
  ): RenderComponent => {
    const result = resultOf(output)
    const view = result === undefined ? rawView(output) : resultView(name, result, argsOf(context?.args))
    // Every printed field can come from a peer, a device or the model's own arguments: a row is cleaned whole, so no
    // field that skipped `text()` can carry a terminal escape to the screen.
    const lines = [
      theme.fg(view.tone, stripTerminalControls(view.headline)),
      ...view.details.map((line) => theme.fg("muted", `  ${stripTerminalControls(line)}`)),
    ]
    if (options.expanded && result !== undefined)
      lines.push(
        ...JSON.stringify(result, null, 2)
          .split("\n")
          .map((line) => theme.fg("dim", line)),
      )
    return new Text(lines.join("\n"), 0, 0)
  }
}

/** A call's arguments while they stream may be absent or partial: anything that is not an object reads as no arguments. */
function argsOf(value: unknown): Args {
  return typeof value === "object" && value !== null ? (value as Args) : {}
}

function callTail(name: ThreadToolName, args: Args): string {
  const target = label(args.thread)
  const said = quoted(args.message)
  switch (name) {
    case "thread_send":
    case "thread_handoff":
      return joinRendererTokens([target === undefined ? undefined : `-> ${target}`, said])
    case "thread_list":
      return args.all_scope === true ? "all workspaces" : ""
    case "thread_create": {
      const named = quoted(args.name)
      if (typeof args.thread === "string") return `open ${target}`
      if (typeof args.fork_from === "string")
        return joinRendererTokens([`fork ${label(args.fork_from)}`, named === undefined ? undefined : `as ${named}`])
      return joinRendererTokens([
        named ?? "new thread",
        typeof args.device === "string" ? `on ${args.device}` : undefined,
      ])
    }
    case "thread_rename":
      return joinRendererTokens([
        target,
        quoted(args.name) === undefined ? undefined : `-> ${quoted(args.name)}`,
        typeof args.alias === "string" ? `alias ${args.alias}` : undefined,
      ])
    case "thread_set_model":
      return joinRendererTokens([target, typeof args.model === "string" ? `-> ${args.model}` : undefined])
    case "thread_set_reasoning":
      return joinRendererTokens([
        target,
        typeof args.level === "string" ? `-> ${args.level}` : undefined,
        args.scope === "turn" ? "(this turn)" : undefined,
      ])
    case "thread_close":
      return target ?? "this thread"
    case "thread_outbox":
      return label(args.binding_id) ?? ""
    case "thread_outbox_ack":
      return joinRendererTokens([
        label(args.binding_id),
        typeof args.cursor === "number" ? `through #${args.cursor}` : undefined,
      ])
    case "thread_report":
      return joinRendererTokens([text(args.kind), quoted(args.text)])
    case "thread_answer":
      return quoted(args.answer) ?? ""
    default:
      return target ?? ""
  }
}

function resultView(name: ThreadToolName, result: ThreadToolResult, args: Args): ResultView {
  if (result.kind === "error") {
    const { code, message, next_action } = result.error
    return {
      tone: "error",
      headline: `failed: ${code} - ${normalizeRendererText(message)}`,
      details: [`next: ${normalizeRendererText(next_action)}`],
    }
  }
  const r = result as Readonly<Record<string, unknown>>
  const target = linkTitle(r.link) ?? label(args.thread) ?? label(r.thread) ?? "thread"
  switch (name) {
    case "thread_send":
    case "thread_handoff":
      return sendView(r, args)
    case "thread_read":
      return readView(r, target)
    case "thread_list":
      return listView(r)
    case "thread_create": {
      const title = linkTitle(r.link) ?? (text(r.name) || undefined) ?? label(r.thread) ?? "thread"
      const skills = (r.requested_skills ?? r.skills) as readonly string[] | undefined
      const details = [
        ...(skills === undefined || skills.length === 0 ? [] : [`skills: ${skills.join(", ")}`]),
        ...(typeof r.alias === "string" ? [`alias: ${r.alias}`] : []),
        ...device(r),
        ...createProblems(r),
      ]
      const tone = createProblems(r).length === 0 ? "success" : "warning"
      if (r.deduplicated === true) return { tone, headline: `${title} is already open`, details }
      const verb =
        typeof args.thread === "string" ? "opened" : typeof args.fork_from === "string" ? "forked" : "created"
      return { tone, headline: `${verb} ${title}`, details }
    }
    case "thread_interrupt": {
      const turn = typeof r.turn_id === "string" ? ` (turn ${short(r.turn_id)})` : ""
      return r.interrupted === true
        ? { tone: "success", headline: `interrupted ${target}${turn}`, details: device(r) }
        : { tone: "muted", headline: `${target} was idle; nothing to interrupt`, details: device(r) }
    }
    case "thread_close":
      return r.closed === true
        ? { tone: "success", headline: `closed ${target}`, details: device(r) }
        : { tone: "muted", headline: `${target} was not running; nothing to close`, details: device(r) }
    case "thread_rename":
      return {
        tone: "success",
        headline: `renamed to "${text(r.name)}"`,
        details: [...(typeof r.alias === "string" ? [`alias: ${r.alias}`] : []), ...device(r)],
      }
    case "thread_set_model": {
      const model = (r.model ?? {}) as { readonly provider?: string; readonly id?: string }
      return { tone: "success", headline: `${target} now uses ${model.provider}/${model.id}`, details: device(r) }
    }
    case "thread_set_reasoning":
      return {
        tone: "success",
        headline: `${target} reasoning: ${text(r.level)}${r.scope === "turn" ? " for this turn" : ""}`,
        details: device(r),
      }
    case "thread_archive":
      return {
        tone: "success",
        headline: `${r.archived === true ? "archived" : "unarchived"} ${target}`,
        details: device(r),
      }
    case "thread_report":
      return {
        tone: "success",
        headline: reportHeadline(r),
        details: r.deduplicated === true ? ["already reported under this key"] : [],
      }
    case "thread_outbox": {
      const rows =
        (r.rows as
          | readonly {
              readonly cursor: number
              readonly event: string
              readonly text: string
              readonly state: string
            }[]
          | undefined) ?? []
      const pending = rows.filter((row) => row.state === "pending").length
      return {
        tone: "success",
        headline:
          rows.length === 0
            ? "outbox empty"
            : `${plural(rows.length, "outbox row", "outbox rows")}, ${pending} pending`,
        details: [
          ...rows.slice(-OUTBOX_HEAD).map((row) => `#${row.cursor} ${row.event}: ${firstLine(row.text)}`),
          ...(r.status === "active" ? [] : [`binding ${text(r.status)}`]),
        ],
      }
    }
    case "thread_outbox_ack":
      return {
        tone: r.changed === true ? "success" : "muted",
        headline: `${r.changed === true ? "" : "already "}acked through #${r.acked_cursor}`,
        details: [],
      }
    case "thread_answer":
      return { tone: "success", headline: "answer delivered to the waiting question", details: [] }
  }
}

function queuedLine(delivery: {
  readonly queue_position?: number
  readonly waiting_on?: { readonly kind?: string; readonly device?: string }
}): string {
  const position = delivery.queue_position
  const waiting = delivery.waiting_on
  const where = typeof waiting?.device === "string" ? ` on ${excerptRendererText(waiting.device, LABEL_WIDTH)}` : ""
  switch (waiting?.kind) {
    case "approval":
      return `queued #${position}: waits for approval${where}`
    case "hold":
      return `queued #${position}: thread is paused or stopped${where}; delivers when it resumes`
    case "wake":
      return `queued #${position}: no engine is running the thread${where}; it starts to take the message`
    default:
      return `queued #${position}: waits for the running turn`
  }
}

type Failure = { readonly code?: string; readonly message?: string; readonly next_action?: string }

/** What went wrong after thread_create made the thread: its first message refused, or a later step failed. */
function createProblems(r: Readonly<Record<string, unknown>>): string[] {
  const refused = (r.prompt as { readonly error?: Failure } | undefined)?.error
  const warnings = (r.warnings as readonly Failure[] | undefined) ?? []
  return [
    ...(refused === undefined
      ? []
      : [
          `first message not delivered: ${text(refused.code)} - ${text(refused.message)}`,
          `next: ${text(refused.next_action)}`,
        ]),
    ...warnings.map((warning) => `warning: ${text(warning.code)} - ${text(warning.message)}`),
  ]
}

function sendView(r: Readonly<Record<string, unknown>>, args: Args): ResultView {
  const target = linkTitle(r.link) ?? (text(r.name) || undefined) ?? label(args.thread) ?? label(r.thread) ?? "thread"
  const delivery = (r.delivery ?? {}) as {
    readonly kind?: string
    readonly turn_id?: string
    readonly queue_position?: number
    readonly waiting_on?: { readonly kind?: string; readonly device?: string }
  }
  const mode = r.effective_mode === "follow_up" ? "follow-up " : ""
  const outcome =
    delivery.kind === "started"
      ? `${mode}delivered (turn ${short(delivery.turn_id)})`
      : delivery.kind === "steered"
        ? `steered into the running turn (turn ${short(delivery.turn_id)})`
        : delivery.kind === "queued"
          ? queuedLine(delivery)
          : delivery.kind === "queued_offline"
            ? `queued #${delivery.queue_position}: thread is offline, delivers when it starts`
            : "sent"
  return {
    tone: delivery.kind === "started" || delivery.kind === "steered" ? "success" : "warning",
    headline: `-> ${target}  ${outcome}`,
    details: [
      ...(r.resolved_by === "fuzzy" ? ["matched by fuzzy name"] : []),
      ...(r.deduplicated === true ? ["already sent under this key; not delivered twice"] : []),
      ...device(r),
    ],
  }
}

function readView(r: Readonly<Record<string, unknown>>, target: string): ResultView {
  const items = (r.items as readonly { readonly role: string; readonly content: string }[] | undefined) ?? []
  const messages = items.filter((item) => item.role === "user" || item.role === "assistant")
  const latest = messages.at(-1)
  return {
    tone: "success",
    headline:
      latest === undefined
        ? `${target}: no messages`
        : `${target}: ${plural(messages.length, "message", "messages")} (latest: ${firstLine(latest.content)})`,
    details: [
      ...(r.truncated === true ? ["older messages not shown"] : []),
      ...(r.source_incomplete === true ? ["read from the session file; may lag the live thread"] : []),
      ...device(r),
    ],
  }
}

function listView(r: Readonly<Record<string, unknown>>): ResultView {
  const threads = (r.threads as readonly Readonly<Record<string, unknown>>[] | undefined) ?? []
  const where = r.scope === "all" ? "in any workspace" : "in this workspace"
  const headline =
    threads.length === 0
      ? `no threads ${where}`
      : `${plural(threads.length, "thread", "threads")} ${r.scope === "all" ? "across all workspaces" : where}`
  return {
    tone: "success",
    headline,
    details: [
      ...threads.slice(0, LIST_HEAD).map((thread) => {
        const name = (text(thread.name) || undefined) ?? label(thread.thread) ?? "thread"
        const facts = [
          text(thread.state) || text(thread.status),
          text(thread.surface),
          text(thread.machine) || text(thread.device),
        ].filter((fact) => fact.length > 0)
        return `${excerptRendererText(name, LABEL_WIDTH)}  ${facts.join(", ")}`
      }),
      ...more(threads.length),
      ...(typeof r.remote_unavailable === "string" ? [`other devices unavailable: ${r.remote_unavailable}`] : []),
    ],
  }
}

function reportHeadline(r: Readonly<Record<string, unknown>>): string {
  if (r.event === "question") return "question sent; waiting for a reply"
  if (r.event === "completion")
    return r.armed === true ? "completion armed; sent when this run settles" : "completion already written"
  return `${text(r.event)} posted`
}

function device(r: Readonly<Record<string, unknown>>): string[] {
  return typeof r.device === "string" ? [`on device ${r.device}`] : []
}

function more(count: number): string[] {
  return count > LIST_HEAD ? [`... ${count - LIST_HEAD} more`] : []
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The model-facing result: the details carry it; an older replay or a foreign host may carry only the JSON text. */
function resultOf(output: AgentToolResult<unknown>): ThreadToolResult | undefined {
  const details = output.details as { readonly result?: ThreadToolResult } | undefined
  if (details?.result !== undefined) return details.result
  const raw = output.content.find((part) => part.type === "text")
  if (raw === undefined || raw.type !== "text") return undefined
  try {
    const parsed = JSON.parse(raw.text) as ThreadToolResult
    return typeof parsed === "object" && parsed !== null && "kind" in parsed ? parsed : undefined
  } catch {
    return undefined
  }
}

function rawView(output: AgentToolResult<unknown>): ResultView {
  const raw = output.content.find((part) => part.type === "text")
  return { tone: "muted", headline: raw !== undefined && raw.type === "text" ? firstLine(raw.text) : "", details: [] }
}

/** A thread address as a person reads it: `self` is this thread, a uuid its first eight characters, a name as typed. */
function label(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined
  if (value === "self") return "this thread"
  return short(value)
}

function short(value: unknown): string {
  const raw = text(value)
  return UUID.test(raw) ? raw.slice(0, 8) : excerptRendererText(raw, LABEL_WIDTH)
}

function linkTitle(link: unknown): string | undefined {
  if (typeof link !== "string") return undefined
  const match = LINK.exec(link)
  const title = match?.[1]?.replace(/\\(.)/g, "$1")
  return title === undefined || title === UNNAMED_LINK_LABEL ? undefined : excerptRendererText(title, LABEL_WIDTH)
}

function quoted(value: unknown): string | undefined {
  const line = typeof value === "string" ? firstLine(value) : ""
  return line.length === 0 ? undefined : `"${line}"`
}

function firstLine(value: string): string {
  const line = value.split("\n").find((candidate) => candidate.trim().length > 0) ?? ""
  return excerptRendererText(line, MESSAGE_HEAD_WIDTH)
}

function text(value: unknown): string {
  return typeof value === "string" ? normalizeRendererText(value) : ""
}
