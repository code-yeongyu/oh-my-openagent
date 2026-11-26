import type { ThreadToolFailure } from "./errors"
import { refusal } from "./refusal-texts"

/**
 * No leg carries an attachment yet: the gateway delivery on this device has no field for one, and neither has the relay
 * record a send to another device becomes. So a send or a create's first prompt naming attachments (top level or in the
 * object prompt) is refused with this one typed refusal on every surface, before any effect, never sent without them. The root takes it through the core's failure helper
 * (sdk-core/failures.ts re-exports it), never statically, so the refusal registry stays behind the core's boundary
 * (P1c decision 7); the thread facade imports it directly, reaching no core module.
 */
export function attachmentsRefused(input: unknown): ThreadToolFailure | undefined {
  const field = (from: unknown, name: string): unknown =>
    typeof from === "object" && from !== null ? Reflect.get(from, name) : undefined
  const attachments = field(input, "attachments") ?? field(field(input, "prompt"), "attachments")
  if (attachments === undefined) return undefined
  const count = Array.isArray(attachments) ? attachments.length : 1
  return refusal("control.send_attachments_unsupported", { count: String(count) }, { field: "attachments", count })
}
