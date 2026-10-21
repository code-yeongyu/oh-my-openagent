import { z } from "zod"

import {
  OmoToolPermissionEntrySchema,
  OmoToolPermissionLayerSchema,
  OmoToolPermissionValueSchema,
} from "@oh-my-opencode/omo-config-core"

export const PermissionGateToolValueSchema = OmoToolPermissionValueSchema
export const PermissionGateToolEntrySchema = OmoToolPermissionEntrySchema
export const PermissionGateToolLayerSchema = OmoToolPermissionLayerSchema

/**
 * Definition of a single effective decision the gate may take.
 *
 * `source` keeps the audit log honest: a reviewer (or the user on Monday) can
 * tell whether a decision came from a session-cached ask, a config override,
 * or the built-in defaults. This is the only place in the gate that names the
 * source; downstream callers (`audit.ts`, the tool.execute.before handler) read
 * it verbatim.
 */
export const PermissionGateDecisionSchema = z.object({
  value: PermissionGateToolValueSchema,
  source: z.enum([
    "default",
    "session_cache",
    "tools_override",
    "agent_override",
    "user_override",
  ]),
  tool: z.string(),
  targetPath: z.string().optional(),
  sessionID: z.string(),
})

export type PermissionGateDecision = z.infer<typeof PermissionGateDecisionSchema>
