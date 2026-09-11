// The resident Kibitzer's wire format. The persona (memory-core
// `recall/assets/kibitzer-persona.md`) is the sidecar's system prompt and describes the protocol;
// this module renders the three envelopes that carry it live state: the SEED that opens a child,
// the WAKE that hands it a new batch of bounded events, and the RESEED that restarts a child at
// the context budget without losing what the previous one already decided.
//
// Three rules hold for every envelope, because the child is a model reading attacker-influenced
// transcript text:
//   1. redact, then cap, then escape - in that order, so a secret can never survive as a truncated
//      fragment and an escaped entity is never cut in half;
//   2. every embedded body has a cap, so no transcript, tool argument or tool result is ever
//      pushed whole;
//   3. the envelope states the read-only contract (no memory write, nudge-only output) and the
//      exact five tools the child may call - the child's registry and its instructions can never
//      disagree.

import { redactUrl } from "@oh-my-opencode/memory-core"

/**
 * The complete model-visible tool registry of the resident sidecar, in registry order. There are no
 * aliases: `memory` is one read-only closure with `search` and `read` operations, never
 * `memory_search` / `memory_read`, and no write-capable tool exists.
 */
export const KIBITZER_SIDECAR_TOOL_NAMES = ["read", "grep", "session_entries", "memory", "nudge"] as const

export type KibitzerSidecarToolName = (typeof KIBITZER_SIDECAR_TOOL_NAMES)[number]

export interface KibitzerFieldCaps {
  /** User prompt text (`memory.recall.event_caps.prompt`). */
  readonly prompt: number
  /** Assistant text (`memory.recall.event_caps.assistant`). */
  readonly assistant: number
  /** Serialized tool arguments (`memory.recall.event_caps.tool_args`). */
  readonly toolArgs: number
  /** Tool result head (`memory.recall.event_caps.result_head`). */
  readonly resultHead: number
  /** Folded event digest; the digest keeps its cursor range even when every body is folded away. */
  readonly digest: number
  /** One-line task summary carried by a reseed. */
  readonly summary: number
  /** Candidate description and excerpt. */
  readonly candidate: number
}

/** Defaults mirror the `memory.recall.event_caps` schema defaults; callers pass resolved config. */
export const KIBITZER_FIELD_CAPS: KibitzerFieldCaps = {
  prompt: 4000,
  assistant: 1500,
  toolArgs: 400,
  resultHead: 600,
  digest: 1024,
  summary: 200,
  candidate: 200,
}

/** Newest events carried whole by one envelope; everything older belongs to the folded digest. */
export const KIBITZER_EVENT_WINDOW = 20

/** Bound on a whole reseed envelope: a restart must never re-explode the context it is escaping. */
export const KIBITZER_RESEED_MAX_CHARS = 4000

export type KibitzerSidecarEventKind = "prompt" | "assistant" | "tool_call" | "tool_result"

/** One bounded, already-redacted parent event. Bodies are re-redacted and capped here regardless. */
export interface KibitzerSidecarEvent {
  /** Parent branch cursor; envelopes render events in ascending cursor order. */
  readonly cursor: number
  readonly kind: KibitzerSidecarEventKind
  /** The parent's tool name for a tool_call / tool_result event (never a sidecar tool). */
  readonly tool?: string
  /** Prompt or assistant text. */
  readonly text?: string
  /** Serialized tool arguments. */
  readonly args?: string
  /** Head of a tool result. */
  readonly resultHead?: string
}

export interface KibitzerSidecarCandidate {
  readonly path: string
  readonly description?: string
  readonly excerpt?: string
  readonly score?: number
}

/** The one-line fold of every event older than the window; the cursor range survives the fold. */
export interface KibitzerSidecarDigest {
  readonly text: string
  readonly cursorFrom: number
  readonly cursorTo: number
  /** How many events the digest stands for. */
  readonly folded: number
}

export interface KibitzerSidecarEnvelopeInput {
  readonly sessionId: string
  /** `memory.recall.max_items`: how many nudges this wake may accept. */
  readonly maxItems: number
  readonly events: readonly KibitzerSidecarEvent[]
  readonly candidates: readonly KibitzerSidecarCandidate[]
  readonly digest?: KibitzerSidecarDigest
  /** One line naming what the parent is working on; the seed carries it, a wake usually does not. */
  readonly taskSummary?: string
  /** `memory.recall.tool_budget`: tool calls this wake may spend. */
  readonly toolBudget?: number
  readonly caps?: Partial<KibitzerFieldCaps>
  readonly eventWindow?: number
}

export interface KibitzerReseedInput {
  readonly sessionId: string
  readonly maxItems: number
  /** The newest parent cursor the disposed child had seen; the new child resumes from here. */
  readonly lastCursor: number
  /** One line naming what the parent is working on. */
  readonly taskSummary: string
  /** Paths offered to the disposed child that it declined; they are not worth re-judging. */
  readonly rejectedPaths: readonly string[]
  /** Paths already delivered to the parent; they can never be nudged again. */
  readonly deliveredPaths: readonly string[]
  readonly toolBudget?: number
  readonly caps?: Partial<KibitzerFieldCaps>
  /** Whole-envelope bound; defaults to {@link KIBITZER_RESEED_MAX_CHARS}. */
  readonly maxChars?: number
}

interface ToolContract {
  readonly name: KibitzerSidecarToolName
  readonly args: string
  readonly operations?: string
  readonly summary: string
}

const TOOL_CONTRACTS: readonly ToolContract[] = [
  { name: "read", args: "path, offset?, limit?", summary: "Read one workspace file; the result is capped." },
  { name: "grep", args: "pattern, path?, glob?", summary: "Search the workspace; the match list is capped." },
  { name: "session_entries", args: "since", summary: "Read the parent session entries after a cursor." },
  { name: "memory", args: "operation, query|path", operations: "search,read", summary: "Read memory: search and read only, there is no write operation." },
  { name: "nudge", args: "path, hint", summary: "Your only output: one candidate path and one factual hint of at most 200 characters." },
]

const RULES: readonly { readonly id: string; readonly text: string }[] = [
  { id: "no-memory-write", text: "You never write, edit, move or delete memory, files or state; the parent process owns every write." },
  { id: "nudge-only", text: "Only the nudge tool reaches the primary agent; anything you write outside a tool call is discarded." },
  { id: "silence-default", text: "Stay silent unless a stored memory would change what the primary agent does next." },
]

/** The first turn of a fresh resident child: contract, live events, folded history, candidates. */
export function renderKibitzerSeedPrompt(input: KibitzerSidecarEnvelopeInput): string {
  return renderEnvelope("kibitzer-seed", input)
}

/** Every later turn of the same child: the same contract over the newest batch of events. */
export function renderKibitzerWakePrompt(input: KibitzerSidecarEnvelopeInput): string {
  return renderEnvelope("kibitzer-wake", input)
}

/**
 * The seed of a replacement child after the previous one hit its context budget. It carries the
 * state a restart would otherwise lose - rejected paths, delivered paths, the task summary and the
 * last cursor - and never exceeds its bound: path lists are trimmed (with the omitted counts
 * reported) before the envelope can grow past `maxChars`.
 */
export function renderKibitzerReseedPrompt(input: KibitzerReseedInput): string {
  const caps = resolveCaps(input.caps)
  const bound = input.maxChars ?? KIBITZER_RESEED_MAX_CHARS
  const head = [
    openTag("kibitzer-reseed", [
      ["version", "1"],
      ["session", input.sessionId],
      ["cursor", input.lastCursor],
      ["max-items", input.maxItems],
      ...(input.toolBudget === undefined ? [] : [["tool-budget", input.toolBudget] as const]),
    ]),
    renderContract(),
    renderTask(input.taskSummary, caps),
  ].join("\n")
  const rejected = input.rejectedPaths.map((path) => `<path>${escapeText(path)}</path>`)
  const delivered = input.deliveredPaths.map((path) => `<path>${escapeText(path)}</path>`)
  // The fixed part is measured with the largest omitted counts the lists can produce, so the
  // rendered envelope can only be shorter than the length this budget was computed from.
  const fixed = reseedEnvelope(head, { lines: [], total: rejected.length }, { lines: [], total: delivered.length }).length
  const budget = bound - fixed
  const keptRejected = fitLines(rejected, Math.floor(budget / 2))
  const keptDelivered = fitLines(delivered, budget - keptRejected.used)
  return reseedEnvelope(
    head,
    { lines: keptRejected.lines, total: rejected.length },
    { lines: keptDelivered.lines, total: delivered.length },
  )
}

function reseedEnvelope(
  head: string,
  rejected: { readonly lines: readonly string[]; readonly total: number },
  delivered: { readonly lines: readonly string[]; readonly total: number },
): string {
  return [
    head,
    renderPathList("rejected", rejected.lines, rejected.total),
    renderPathList("delivered", delivered.lines, delivered.total),
    "</kibitzer-reseed>",
    "",
  ].join("\n")
}

function renderPathList(tag: string, lines: readonly string[], total: number): string {
  const open = openTag(tag, [["count", lines.length], ["omitted", total - lines.length]])
  return lines.length === 0 ? `${open}</${tag}>` : [open, ...lines, `</${tag}>`].join("\n")
}

/** Greedily keeps whole lines (with their newline) while they fit the budget; never splits one. */
function fitLines(lines: readonly string[], budget: number): { readonly lines: string[]; readonly used: number } {
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + 1
    if (used + cost > budget) break
    kept.push(line)
    used += cost
  }
  return { lines: kept, used }
}

function renderEnvelope(tag: "kibitzer-seed" | "kibitzer-wake", input: KibitzerSidecarEnvelopeInput): string {
  const caps = resolveCaps(input.caps)
  const window = input.eventWindow ?? KIBITZER_EVENT_WINDOW
  const ordered = [...input.events].sort((left, right) => left.cursor - right.cursor)
  const kept = ordered.length <= window ? ordered : ordered.slice(ordered.length - window)
  const cursors = [
    ...ordered.map((event) => event.cursor),
    ...(input.digest === undefined ? [] : [input.digest.cursorFrom, input.digest.cursorTo]),
  ]
  return [
    openTag(tag, [
      ["version", "1"],
      ["session", input.sessionId],
      ["max-items", input.maxItems],
      ...(input.toolBudget === undefined ? [] : [["tool-budget", input.toolBudget] as const]),
      // The range spans every cursor the envelope knows about, including the ones whose bodies were
      // folded into the digest or dropped by the window: the child must still see the real span.
      ...(cursors.length === 0 ? [] : ([["cursor-from", Math.min(...cursors)], ["cursor-to", Math.max(...cursors)]] as const)),
    ]),
    renderContract(),
    ...(input.taskSummary === undefined ? [] : [renderTask(input.taskSummary, caps)]),
    ...(input.digest === undefined ? [] : [renderDigest(input.digest, caps)]),
    renderEvents(kept, ordered.length - kept.length, caps),
    renderCandidates(input.candidates, input.maxItems, caps),
    `</${tag}>`,
    "",
  ].join("\n")
}

function renderContract(): string {
  return [
    "<contract>",
    ...RULES.map((rule) => `<rule id="${rule.id}">${escapeText(rule.text)}</rule>`),
    ...TOOL_CONTRACTS.map((tool) => [
      openTag("tool", [
        ["name", tool.name],
        ["args", tool.args],
        ...(tool.operations === undefined ? [] : [["operations", tool.operations] as const]),
      ]),
      escapeText(tool.summary),
      "</tool>",
    ].join("")),
    "</contract>",
  ].join("\n")
}

function renderTask(summary: string, caps: KibitzerFieldCaps): string {
  return `<task>\n<summary>${escapeText(singleLine(field(summary, caps.summary)))}</summary>\n</task>`
}

function renderDigest(digest: KibitzerSidecarDigest, caps: KibitzerFieldCaps): string {
  const open = openTag("digest", [
    ["cursor-from", digest.cursorFrom],
    ["cursor-to", digest.cursorTo],
    ["folded", digest.folded],
  ])
  return `${open}${escapeText(singleLine(field(digest.text, caps.digest)))}</digest>`
}

function renderEvents(events: readonly KibitzerSidecarEvent[], omitted: number, caps: KibitzerFieldCaps): string {
  const open = openTag("events", [["count", events.length], ["omitted", omitted]])
  if (events.length === 0) return `${open}</events>`
  return [open, ...events.map((event) => renderEvent(event, caps)), "</events>"].join("\n")
}

function renderEvent(event: KibitzerSidecarEvent, caps: KibitzerFieldCaps): string {
  const open = openTag("event", [
    ["cursor", event.cursor],
    ["kind", event.kind],
    ...(event.tool === undefined ? [] : [["tool", event.tool] as const]),
  ])
  const body: string[] = []
  if (event.text !== undefined) {
    body.push(`<text>${escapeText(field(event.text, event.kind === "prompt" ? caps.prompt : caps.assistant))}</text>`)
  }
  if (event.args !== undefined) body.push(`<args>${escapeText(field(event.args, caps.toolArgs))}</args>`)
  if (event.resultHead !== undefined) body.push(`<result>${escapeText(field(event.resultHead, caps.resultHead))}</result>`)
  return [open, ...body, "</event>"].join("\n")
}

function renderCandidates(candidates: readonly KibitzerSidecarCandidate[], maxItems: number, caps: KibitzerFieldCaps): string {
  const open = openTag("candidates", [["count", candidates.length], ["max-items", maxItems]])
  if (candidates.length === 0) return `${open}</candidates>`
  return [open, ...candidates.map((candidate) => renderCandidate(candidate, caps)), "</candidates>"].join("\n")
}

function renderCandidate(candidate: KibitzerSidecarCandidate, caps: KibitzerFieldCaps): string {
  const open = openTag("candidate", [
    ["path", candidate.path],
    ...(candidate.score === undefined ? [] : [["score", candidate.score] as const]),
  ])
  const body: string[] = []
  if (candidate.description !== undefined) {
    body.push(`<description>${escapeText(singleLine(field(candidate.description, caps.candidate)))}</description>`)
  }
  if (candidate.excerpt !== undefined) {
    body.push(`<excerpt>${escapeText(field(candidate.excerpt, caps.candidate))}</excerpt>`)
  }
  return [open, ...body, "</candidate>"].join("\n")
}

function resolveCaps(overrides: Partial<KibitzerFieldCaps> | undefined): KibitzerFieldCaps {
  return overrides === undefined ? KIBITZER_FIELD_CAPS : { ...KIBITZER_FIELD_CAPS, ...overrides }
}

function openTag(name: string, attributes: readonly (readonly [string, string | number])[]): string {
  const rendered = attributes.map(([key, value]) => ` ${key}="${escapeAttribute(String(value))}"`).join("")
  return `<${name}${rendered}>`
}

/**
 * One embedded field: redacted first (a secret must never survive as a truncated fragment), then
 * capped, then - by the caller - escaped, so the cap is measured on the value the child reads.
 */
function field(raw: string, cap: number): string {
  const redacted = stripControl(redactUrl(raw))
  if (redacted.length <= cap) return redacted
  return cap <= 1 ? redacted.slice(0, Math.max(cap, 0)) : `${redacted.slice(0, cap - 1)}…`
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function stripControl(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;")
}

// Attribute values are redacted too: a path or a parent tool name is transcript-derived, so the
// same secret rule applies, and a raw newline or quote inside an attribute would end the envelope.
function escapeAttribute(value: string): string {
  return escapeText(stripControl(redactUrl(value))).replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;")
}
