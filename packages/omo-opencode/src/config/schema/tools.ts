import { z } from "zod"

import {
  OmoToolPermissionEntrySchema,
  OmoToolPermissionLayerSchema,
  OmoToolPermissionValueSchema,
} from "@oh-my-opencode/omo-config-core"

/**
 * Re-export the harness-neutral surface so the opencode side has a single
 * import root. The cross-harness layer schema and the opencode-layer schema
 * intentionally accept the same shape so a single `omo.json` key works for
 * every adapter that opts in.
 */
export const OmoOpenCodeToolPermissionValueSchema = OmoToolPermissionValueSchema
export const OmoOpenCodeToolPermissionEntrySchema = OmoToolPermissionEntrySchema
export const OmoOpenCodeToolPermissionLayerSchema = OmoToolPermissionLayerSchema

/**
 * Per-session runtime override cache, keyed by `tool\0target-path`:
 * the user can flip a single (tool, target-path) to allow or deny mid-session
 * without rebuilding the config. Not present in `omo.json`; lives only at
 * runtime in the session-cache file. The schema is exported for the typed
 * accessor on `pluginConfig` so plugin code does not hand-roll it.
 */
export const OmoOpenCodeSessionToolOverrideLayerSchema = z.record(
  z.string(),
  OmoToolPermissionValueSchema,
)

/**
 * Typed opencode permission profile. Wraps the harness-neutral layer and adds
 * the session override map so plugin code can pass a single typed object to
 * the gate factory.
 */
export const OmoOpenCodePermissionConfigSchema = z.object({
  /** Per-tool permission overrides for the OpenCode plugin. Keys are tool names. */
  tools: OmoOpenCodeToolPermissionLayerSchema.optional(),
  /** Optional in-process override cache. Not user-facing. */
  session_overrides: OmoOpenCodeSessionToolOverrideLayerSchema.optional(),
})

/** Alias used by the root schema import. */
export const ToolsPermissionConfigSchema = OmoOpenCodePermissionConfigSchema

export type OmoOpenCodePermissionConfig = z.infer<typeof OmoOpenCodePermissionConfigSchema>
export type OmoOpenCodeToolPermissionLayer = z.infer<typeof OmoOpenCodeToolPermissionLayerSchema>
export type OmoOpenCodeSessionToolOverrideLayer = z.infer<
  typeof OmoOpenCodeSessionToolOverrideLayerSchema
>
