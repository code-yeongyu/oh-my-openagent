import type { SieveEvent } from "./stream-sieve"

export function findStarted(
  events: ReadonlyArray<SieveEvent>,
): Array<{ index: number; id: string; name: string }> {
  return events.flatMap((e) =>
    e.type === "tool_call_started"
      ? [{ index: e.index, id: e.id, name: e.name }]
      : [],
  )
}

export function findArgDeltas(
  events: ReadonlyArray<SieveEvent>,
  index: number,
): string[] {
  return events.flatMap((e) =>
    e.type === "tool_call_argument_delta" && e.index === index
      ? [e.argumentsDelta]
      : [],
  )
}

export function findCompletes(
  events: ReadonlyArray<SieveEvent>,
): Array<{ index: number; name: string; arguments: Record<string, unknown> }> {
  return events.flatMap((e) =>
    e.type === "tool_call_complete"
      ? [{ index: e.index, name: e.call.name, arguments: e.call.arguments }]
      : [],
  )
}
