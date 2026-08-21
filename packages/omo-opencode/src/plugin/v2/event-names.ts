import type { V2BusEvent } from "./types"

/**
 * Maps omo's v1 semantic event names onto the v2 beta bus taxonomy
 * (ground truth: SP2 capture + V2Event union of @opencode-ai/client beta).
 * A v1 name may legitimately match several v2 aliases; consumers decide
 * which alias carries the payload they need.
 */
export const V1_TO_V2_EVENT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "session.idle": ["session.idle", "session.execution.succeeded"],
  "session.error": ["session.execution.failed", "session.step.failed"],
  "session.created": ["session.created"],
  "session.deleted": ["session.deleted"],
} as const

/**
 * Tolerant matcher: true when a v2 bus type should trigger a handler
 * registered for the given v1 name. Identical names always match so
 * unknown future events keep pass-through semantics.
 */
export function v2EventMatchesV1Name(v2Type: string, v1Name: string): boolean {
  if (v2Type === v1Name) return true
  return V1_TO_V2_EVENT_NAMES[v1Name]?.includes(v2Type) ?? false
}

/** Reverse lookup: every v1 semantic name carried by this v2 bus type. */
export function v1EventNamesForV2Type(v2Type: string): readonly string[] {
  const names: string[] = []
  for (const [v1Name, v2Names] of Object.entries(V1_TO_V2_EVENT_NAMES)) {
    if (v2Names.includes(v2Type)) names.push(v1Name)
  }
  return names
}

export type V1EventDispatch = (v1Name: string, event: V2BusEvent) => void

/** Dispatches one v2 bus event to every mapped v1 semantic name. */
export function dispatchV2EventToV1Names(event: V2BusEvent, dispatch: V1EventDispatch): void {
  for (const v1Name of v1EventNamesForV2Type(event.type)) {
    dispatch(v1Name, event)
  }
}
