// /sleeptime — display the resolved reflection settings for the bound identity.
//
// Senpi has no Ink overlay equivalent, so this is a read-only view plus the
// config-file path to edit and the manual "reflect now" hint (porting note 10).

import type { SenpiExtensionAPI } from "../../../extension/types"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

const OVERRIDE_MARK = " [agent override]"

function mark(overridden: boolean): string {
  return overridden ? OVERRIDE_MARK : ""
}

export function registerSleeptimeCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("sleeptime", {
    description: "Show the resolved sleeptime reflection settings for this identity.",
    argumentHint: "",
    handler: async (_args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const { settings, configPath } = deps.loadSettings()
      const base = settings.reflection
      const override = settings.agents[identity.identity]?.reflection
      const stepCount = override?.trigger?.step_count ?? base.trigger.step_count
      const onCompaction = override?.trigger?.on_compaction ?? base.trigger.on_compaction
      const merge = override?.merge ?? base.merge
      const category = override?.category ?? base.category
      const timeout = override?.timeout_minutes ?? base.timeout_minutes
      const sandbox = override?.sandbox ?? base.sandbox

      const lines = [
        `# Sleeptime reflection: ${identity.identity}`,
        "",
        `Step trigger: ${stepCount > 0 ? `every ${stepCount} steps` : "off"}${mark(override?.trigger?.step_count !== undefined)}`,
        `On compaction: ${onCompaction ? "on" : "off"}${mark(override?.trigger?.on_compaction !== undefined)}`,
        `Merge policy: ${merge}${mark(override?.merge !== undefined)}`,
        `Category: ${category}${mark(override?.category !== undefined)}`,
        `Timeout: ${timeout} minutes${mark(override?.timeout_minutes !== undefined)}`,
        `Sandbox: ${sandbox}${mark(override?.sandbox !== undefined)}`,
        "",
        `Edit ${configPath ?? "your omo config file"} under memory.reflection, or memory.agents.${identity.identity}.reflection for this identity only.`,
        "Reflect now: /reflect [--recent N | --conversation <ids>] [focus]",
      ]
      return respond(ctx, lines.join("\n"))
    },
  })
}
