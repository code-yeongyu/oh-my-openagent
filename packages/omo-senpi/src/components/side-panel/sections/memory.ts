import { MEMORY_DETAIL_COLUMNS } from "../constants"
import { truncateVisible, wrapVisible } from "../format/truncate"
import { compactTokens, duration } from "../format/units"
import type { PanelMemory, PanelMemoryKibitzer, PanelMemoryReflection, PanelRow } from "../types"
import { field, heading, LABEL_WIDTH } from "./layout"

/** Length of the heading prefix `MEMORY` plus its two-space gutter. */
const HEADING_PREFIX = "MEMORY  ".length

/**
 * Memory: which identity this session writes to, and whether it is actually able to write.
 *
 * The heading always draws, because one machine carries many identities and the wrong one is
 * invisible without this line. Everything below it appears only when it has something to say, so
 * healthy memory with an empty backlog is a single row.
 */
export function buildMemoryRows(memory: PanelMemory | undefined, now: number, width: number): readonly PanelRow[] {
  if (width <= 0 || memory === undefined) return []
  const rows: PanelRow[] = [heading("MEMORY", truncateVisible(memory.identity, Math.max(0, width - HEADING_PREFIX)))]
  const reflection = reflectionRow(memory.reflection, now)
  if (reflection !== undefined) rows.push(reflection)
  const kibitzer = kibitzerRow(memory.kibitzer, now)
  if (kibitzer !== undefined) rows.push(kibitzer)
  if (memory.factsQueued > 0) rows.push(field("facts", `${memory.factsQueued} queued`, "muted"))
  const recall = recallValue(memory)
  if (recall !== undefined) rows.push(field("recall", recall, "muted"))
  return rows
}

/**
 * A parked identity stops learning silently - that is the whole reason this row exists - so it is
 * the one memory row painted as a warning, and it is a handle: the failure detail runs to 512
 * characters and belongs in the frame, not in a 40-column row.
 */
function reflectionRow(reflection: PanelMemoryReflection | undefined, now: number): PanelRow | undefined {
  if (reflection === undefined) return undefined
  const action = { kind: "memory" } as const
  if (reflection.parkedAt === undefined) {
    // A retry streak is information; only a park is a problem.
    return { ...field("reflect", `${reflection.streak} failed`, "muted"), action }
  }
  return { ...field("reflect", `parked · ${probe(reflection.nextProbeAt, now)}`, "warning"), action }
}

/**
 * The kibitzer runs in another process on its own schedule, so without this row its work is
 * invisible: memory quietly updates, or quietly stops. A wake that ended as a diagnostic failure
 * is the tell - three of them in a row are what raise the host's own gate notice.
 */
function kibitzerRow(kibitzer: PanelMemoryKibitzer | undefined, now: number): PanelRow | undefined {
  if (kibitzer === undefined) return undefined
  // A truncated read cannot claim a total, so the count is drawn as the floor it is.
  const count = `${kibitzer.wakes}${kibitzer.partial ? "+" : ""} wakes`
  const when = age(kibitzer.lastWakeAt, now)
  const value = kibitzer.lastFailed ? `${count} · failed ${when}` : `${count} · ${when}`
  return { ...field("kibitz", value, kibitzer.lastFailed ? "warning" : "muted"), action: { kind: "memory" } }
}

function age(at: string | undefined, now: number): string {
  if (at === undefined) return "never"
  const elapsed = now - Date.parse(at)
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now"
  return `${duration(elapsed)} ago`
}

/** A window that has already passed reads as due; a countdown into the negative reads as working. */
function probe(nextProbeAt: string | undefined, now: number): string {
  if (nextProbeAt === undefined) return "probe unknown"
  const remaining = Date.parse(nextProbeAt) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return "probe due"
  return `probe in ${duration(remaining)}`
}

/** What is about to arrive matters more than what already did, so waiting leads. */
function recallValue(memory: PanelMemory): string | undefined {
  const parts: string[] = []
  if (memory.recallPending > 0) parts.push(`${memory.recallPending} waiting`)
  if (memory.recallSurfaced > 0) parts.push(`${memory.recallSurfaced} surfaced`)
  return parts.length === 0 ? undefined : parts.join(" · ")
}

/**
 * The frame behind a clicked memory row: the whole park record, including the detail the column
 * can only hint at. Timestamps stay in the host's own ISO form here - this is the view somebody
 * reads while deciding whether to run `/reflect`, not a glance.
 */
export function buildMemoryDetailRows(memory: PanelMemory, now: number): readonly PanelRow[] {
  const rows: PanelRow[] = [...wrappedDetail("id", memory.identity)]
  const reflection = memory.reflection
  if (reflection !== undefined) {
    rows.push(detail("streak", `${reflection.streak} failed`))
    if (reflection.parkedAt !== undefined) rows.push(detail("parked", reflection.parkedAt))
    if (reflection.nextProbeAt !== undefined) rows.push(detail("probe", reflection.nextProbeAt))
  }
  const kibitzer = memory.kibitzer
  if (kibitzer !== undefined) {
    const parts = [
      `${kibitzer.wakes}${kibitzer.partial ? "+" : ""} wakes`,
      `${kibitzer.nudged} nudged`,
      compactTokens(kibitzer.tokens),
    ]
    rows.push(detail("kibitz", parts.join(" · ")))
    if (kibitzer.lastStatus !== undefined) rows.push(detail("last", `${kibitzer.lastStatus} ${age(kibitzer.lastWakeAt, now)}`))
  }
  rows.push(detail("facts", `${memory.factsQueued} queued`))
  rows.push(detail("recall", recallValue(memory) ?? "nothing held"))
  // The reason and the detail are prose of unbounded length, so they are wrapped into the frame
  // rather than squeezed into the label gutter, where they would have to be cut.
  for (const [text, color] of [
    [reflection?.reason, "warning"],
    [reflection?.detail, "muted"],
  ] as const) {
    if (text === undefined) continue
    rows.push({ text: "" })
    for (const line of wrapVisible(text, MEMORY_DETAIL_COLUMNS)) rows.push({ text: line, color })
  }
  return rows
}

function detail(label: string, value: string): PanelRow {
  return { text: `${label.padEnd(LABEL_WIDTH)}${truncateVisible(value, MEMORY_DETAIL_COLUMNS - LABEL_WIDTH)}` }
}

function wrappedDetail(label: string, value: string): readonly PanelRow[] {
  const indent = " ".repeat(LABEL_WIDTH)
  return wrapVisible(value, MEMORY_DETAIL_COLUMNS - LABEL_WIDTH).map((line, index) => ({
    text: `${index === 0 ? label.padEnd(LABEL_WIDTH) : indent}${line}`,
  }))
}
