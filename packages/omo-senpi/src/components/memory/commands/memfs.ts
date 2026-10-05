import type { SenpiExtensionAPI } from "../../../extension/types"
import type { MemoryCommandContext, MemoryCommandDeps } from "./types"

export function registerMemfsCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("memfs", {
    description: "Inspect and maintain the memory filesystem repository.",
    argumentHint: "<status|init|sync|repair|reset|backup|restore|diff|tokens>",
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const { runMemfs } = await import("#omo-memory-memfs-runtime")
      return runMemfs(deps, args, ctx)
    },
  })
}
