// Opt-in timeline for the SIGKILL takeover test (#10959). When OMO_TAKEOVER_TRACE names a file, the test and both
// writer children append one JSON line per event to it, so a failure on a slow runner shows which phase took the
// time or which process ended early. Unset, every call returns at once and nothing is written.

import { appendFileSync, existsSync, readFileSync } from "node:fs"

const TRACE_PATH = process.env.OMO_TAKEOVER_TRACE

export type TakeoverTraceEvent = {
  readonly t: number
  readonly pid: number
  readonly actor: string
  readonly event: string
  readonly detail?: Readonly<Record<string, unknown>>
}

export function takeoverTraceEnabled(): boolean {
  return TRACE_PATH !== undefined && TRACE_PATH !== ""
}

// Synchronous on purpose: a SIGKILLed writer must not lose the lines it wrote before the kill.
export function traceTakeover(actor: string, event: string, detail?: Readonly<Record<string, unknown>>): void {
  if (TRACE_PATH === undefined || TRACE_PATH === "") return
  const line: TakeoverTraceEvent = { t: performance.timeOrigin + performance.now(), pid: process.pid, actor, event, ...(detail === undefined ? {} : { detail }) }
  appendFileSync(TRACE_PATH, `${JSON.stringify(line)}\n`)
}

export function readTakeoverTrace(path: string): TakeoverTraceEvent[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TakeoverTraceEvent)
    .sort((left, right) => left.t - right.t)
}

export function formatTakeoverTimeline(events: readonly TakeoverTraceEvent[]): string {
  const start = events[0]?.t ?? 0
  return events
    .map((event) => `+${(event.t - start).toFixed(1).padStart(9)}ms pid=${String(event.pid)} ${event.actor} ${event.event}${event.detail === undefined ? "" : ` ${JSON.stringify(event.detail)}`}`)
    .join("\n")
}

export function takeoverTimeline(): string | undefined {
  if (TRACE_PATH === undefined || TRACE_PATH === "") return undefined
  return formatTakeoverTimeline(readTakeoverTrace(TRACE_PATH))
}
