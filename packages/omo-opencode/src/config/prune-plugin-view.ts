import { displayOmoConfigPath, pruneInvalidConfigPaths, type PruneValidator } from "@oh-my-opencode/omo-config-core"
import type * as z from "zod"

import { OhMyOpenCodeConfigSchema } from "./schema"

export type PrunedPluginView = {
  readonly config: Record<string, unknown>
  /** Plugin-schema issues left standing: non-empty only when the view could not be pruned into shape. */
  readonly issues: readonly z.core.$ZodIssue[]
  readonly warnings: readonly string[]
}

const validatePluginRecord: PruneValidator = (record) => {
  const parsed = OhMyOpenCodeConfigSchema.safeParse(record)
  return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues }
}

/**
 * Drop only the values of one OpenCode view that fail the plugin schema, with one warning per
 * dropped key named by its dotted path in the file (`keyPrefix` places a harness-block or profile
 * view inside it). A view that cannot be pruned into shape is returned as-is with its issues.
 */
export function prunePluginView(input: {
  readonly config: Record<string, unknown>
  readonly homeDir: string | undefined
  readonly keyPrefix: string
  readonly path: string
}): PrunedPluginView {
  const validation = OhMyOpenCodeConfigSchema.safeParse(input.config)
  if (validation.success) return { config: input.config, issues: [], warnings: [] }
  const pruned = pruneInvalidConfigPaths(input.config, validation.error.issues, validatePluginRecord)
  if (!pruned.ok) return { config: input.config, issues: validation.error.issues, warnings: [] }
  const file = displayOmoConfigPath(input.path, input.homeDir)
  return {
    config: pruned.config,
    issues: [],
    warnings: pruned.dropped.map((entry) => `config: ${file}: ${input.keyPrefix}${entry.key} ignored (invalid value)`),
  }
}
