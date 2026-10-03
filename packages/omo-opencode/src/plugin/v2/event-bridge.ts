import type { V2PluginContext, V2EventSubscribe } from "./types"

/**
 * Bridge the V2 public event stream into the V1 `event` hook handler.
 *
 * V2 event envelope: `{ id, created, type, data, location?, metadata? }`.
 * V1 event envelope: `{ type, properties }`. The handler resolves session ids
 * from `properties.sessionID` (see shared/event-session-id.ts), so the
 * translation is a shallow copy of `data` into `properties`.
 *
 * Renames where V2 changed the type string:
 * - `session.execution.failed` -> `session.error` (V1's reactive error edge)
 *
 * Dropped V1 types with no V2 equivalent are simply never emitted:
 * - `message.updated` / `message.removed` (V2 streams per-message content
 *   updates instead; the model-fallback assistant-finish path is covered by
 *   `session.tool.*` and `session.idle` edges).
 */

const V2_TO_V1_EVENT_TYPES: Record<string, string> = {
  "session.execution.failed": "session.error",
}

export type V1EventShape = { type: string; properties?: Record<string, unknown> }

export function toV1Event(v2Event: Record<string, unknown>): V1EventShape | null {
  const type = typeof v2Event["type"] === "string" ? (v2Event["type"] as string) : undefined
  if (!type) return null
  const data = v2Event["data"]
  const properties =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>) }
      : {}
  const metadata = v2Event["metadata"]
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
      if (properties[key] === undefined) properties[key] = value
    }
  }
  const v1Type = V2_TO_V1_EVENT_TYPES[type] ?? type
  return { type: v1Type, properties }
}

export async function bridgeV2EventStream(args: {
  readonly ctx: V2PluginContext
  readonly onEvent: (event: V1EventShape) => Promise<void> | void
  readonly signal: AbortSignal
}): Promise<void> {
  const subscribe = args.ctx.event.subscribe as V2EventSubscribe
  try {
    for await (const v2Event of subscribe({ signal: args.signal })) {
      const v1Event = toV1Event(v2Event)
      if (!v1Event) continue
      await args.onEvent(v1Event)
    }
  } catch (error) {
    if (args.signal.aborted) return
    throw error
  }
}
