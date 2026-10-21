/**
 * Harness-neutral tool-permission surface for omo.json.
 *
 * Owners of this layer: the opencode plugin (omo-opencode) for the wired
 * consumer, and shared bundle authors (omo-senpi, omo-codex, omo-native)
 * who surface the same schema for cross-harness parity. The `[opencode]`
 * block is the only harness that actually wires `tools.<name>.permission`
 * into the gate in this PR; siblings read the same schema keys to keep
 * autocomplete and round-trips stable.
 */
import { z } from "zod"

export const OmoToolPermissionValueSchema = z.enum(["allow", "ask", "deny"])

export const OmoToolPermissionEntrySchema = z.object({
  permission: OmoToolPermissionValueSchema,
})

export const OmoToolPermissionLayerSchema = z.record(
  z.string(),
  OmoToolPermissionEntrySchema,
)

/**
 * Effective values:
 *
 *   - "allow" - gate passes the call through; no prompt, no audit-of-deny.
 *   - "ask"   - gate prompts (or, in the wired opencode adapter, resolves
 *               to a session-cached decision); first call in a session
 *               for a (tool, target-path) pair requires an explicit
 *               decision, every later call reuses it.
 *   - "deny"  - gate refuses the call with a synthetic tool error and
 *               records the denial in the audit log.
 *
 * Defaults (when a tool is missing from this map): allowed for read-only
 * tools, "ask" for mutating tools. The opencode adapter owns the
 * resolution rules because they are tool-set specific; sibling adapters
 * may opt in or out.
 */
export type OmoToolPermissionValue = z.infer<typeof OmoToolPermissionValueSchema>
export type OmoToolPermissionEntry = z.infer<typeof OmoToolPermissionEntrySchema>
export type OmoToolPermissionLayer = z.infer<typeof OmoToolPermissionLayerSchema>
