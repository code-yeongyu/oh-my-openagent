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
//
// The shared blocks (contract, task line, field primitives) live in `sidecar-prompt-blocks`, the
// reseed envelope in `sidecar-prompt-reseed`; this module renders the seed and wake envelopes and
// is the public surface.

import { escapeText, field, openTag, renderContract, renderTask, resolveCaps, singleLine, type KibitzerFieldCaps } from "./sidecar-prompt-blocks"

export { KIBITZER_FIELD_CAPS, KIBITZER_SIDECAR_TOOL_NAMES, type KibitzerFieldCaps, type KibitzerSidecarToolName } from "./sidecar-prompt-blocks"
export { KIBITZER_RESEED_MAX_CHARS, renderKibitzerReseedPrompt, type KibitzerReseedInput } from "./sidecar-prompt-reseed"

/** Newest events carried whole by one envelope; everything older belongs to the folded digest. */
export const KIBITZER_EVENT_WINDOW = 20

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

/** The first turn of a fresh resident child: contract, live events, folded history, candidates. */
export function renderKibitzerSeedPrompt(input: KibitzerSidecarEnvelopeInput): string {
  return renderEnvelope("kibitzer-seed", input)
}

/** Every later turn of the same child: the same contract over the newest batch of events. */
export function renderKibitzerWakePrompt(input: KibitzerSidecarEnvelopeInput): string {
  return renderEnvelope("kibitzer-wake", input)
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
