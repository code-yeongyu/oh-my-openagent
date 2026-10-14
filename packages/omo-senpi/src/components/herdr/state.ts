/**
 * Herdr pane state reducer for the omo reporter.
 *
 * Mirrors senpi's builtin herdr reporter state machine
 * (dist/core/extensions/builtin/herdr/herdr-state.js): blocked question/dialog ids form a set,
 * one active turn flag, plus counts of subagent children, live terminal monitors and other wake
 * sources that keep the pane "working" even between turns. Vendored because the builtin modules
 * are not part of senpi's public exports map.
 */

/** Bus event names emitted on `pi.events` by the host (not the `pi.on` lifecycle stream). */
export const HERDR_BLOCKED_EVENT = "herdr:blocked"
export const TERMINAL_MONITOR_STATE_EVENT = "terminal_monitor_state"
export const WAKE_SOURCE_STATE_EVENT = "wake_source_state"

export type HerdrAgentState = "idle" | "working" | "blocked"

export interface HerdrReportState {
  readonly state: HerdrAgentState
  readonly message?: string
}

export interface HerdrReporterState {
  readonly blocked: ReadonlyMap<string, string>
  readonly turnActive: boolean
  readonly childCount: number
  readonly monitorCount: number
  readonly wakeSources: ReadonlyMap<string, number>
}

export type HerdrStateEvent =
  | { readonly type: "turn"; readonly active: boolean }
  | { readonly type: "children"; readonly count: number }
  | { readonly type: "monitors"; readonly count: number }
  | { readonly type: "wake-source"; readonly source: string; readonly count: number }
  | { readonly type: "blocked"; readonly active: boolean; readonly id: string; readonly label?: string }

export function initialHerdrState(): HerdrReporterState {
  return { blocked: new Map(), turnActive: false, childCount: 0, monitorCount: 0, wakeSources: new Map() }
}

export function reduceHerdrState(state: HerdrReporterState, event: HerdrStateEvent): HerdrReporterState {
  switch (event.type) {
    case "turn":
      return { ...state, turnActive: event.active }
    case "children":
      return { ...state, childCount: event.count }
    case "monitors":
      return { ...state, monitorCount: event.count }
    case "wake-source": {
      if ((state.wakeSources.get(event.source) ?? 0) === event.count) return state
      const wakeSources = new Map(state.wakeSources)
      if (event.count > 0) wakeSources.set(event.source, event.count)
      else wakeSources.delete(event.source)
      return { ...state, wakeSources }
    }
    case "blocked": {
      if (state.blocked.has(event.id) === event.active) return state
      const blocked = new Map(state.blocked)
      if (event.active) blocked.set(event.id, event.label ?? "Waiting for user input")
      else blocked.delete(event.id)
      return { ...state, blocked }
    }
  }
}

// Wake sources already covered by a dedicated field (child count / monitors) or the blocked state.
const REPRESENTED_WAKE_SOURCES: ReadonlySet<string> = new Set(["terminal-monitors", "senpi-task", "ask-user"])

// Same label table the builtin uses, so the pane message stays consistent across reporters.
const WAKE_SOURCE_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  "terminal-background-sessions": ["background session", "background sessions"],
  "senpi-codemode": ["detached eval cell", "detached eval cells"],
  "omo-dag": ["DAG run", "DAG runs"],
  "loop-guard-hard-stop": ["loop-guard recovery pending", "loop-guard recoveries pending"],
}

export function selectHerdrReport(state: HerdrReporterState): HerdrReportState {
  if (state.blocked.size > 0) {
    return { state: "blocked", message: state.blocked.values().next().value }
  }
  const parts: string[] = []
  const childCount = Math.max(state.childCount, state.wakeSources.get("senpi-task") ?? 0)
  if (childCount > 0) parts.push(`${childCount} subagent${childCount === 1 ? "" : "s"} running`)
  if (state.monitorCount > 0) parts.push(`${state.monitorCount} monitor${state.monitorCount === 1 ? "" : "s"} live`)
  for (const [source, count] of [...state.wakeSources].sort(([left], [right]) => left.localeCompare(right))) {
    if (REPRESENTED_WAKE_SOURCES.has(source)) continue
    const label = WAKE_SOURCE_LABELS[source]
    parts.push(label === undefined ? `${count} ${source}` : `${count} ${count === 1 ? label[0] : label[1]}`)
  }
  return state.turnActive || parts.length > 0
    ? { state: "working", message: parts.length > 0 ? parts.join(" + ") : undefined }
    : { state: "idle" }
}

export function isHerdrBlockedEvent(data: unknown): data is { active: boolean; id: string; label?: string } {
  if (typeof data !== "object" || data === null) return false
  const record = data as Record<string, unknown>
  return (
    typeof record.active === "boolean" &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    (record.label === undefined || typeof record.label === "string")
  )
}

export function isTerminalMonitorStateEvent(data: unknown): data is { activeCount: number } {
  if (typeof data !== "object" || data === null) return false
  const record = data as Record<string, unknown>
  return typeof record.activeCount === "number" && Number.isInteger(record.activeCount) && record.activeCount >= 0
}

export function isWakeSourceStateEvent(data: unknown): data is { source: string; activeCount: number } {
  if (typeof data !== "object" || data === null) return false
  const record = data as Record<string, unknown>
  return typeof record.source === "string" && record.source.length > 0 &&
    typeof record.activeCount === "number" && Number.isFinite(record.activeCount)
}
