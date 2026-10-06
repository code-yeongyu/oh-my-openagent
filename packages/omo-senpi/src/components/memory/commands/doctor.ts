import type { SenpiExtensionAPI } from "../../../extension/types"
import type { MemoryCommandContext, MemoryCommandDeps } from "./types"

export function registerDoctorCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("doctor", {
    description: "Run deterministic memory health checks and repair skill frontmatter.",
    argumentHint: "",
    handler: async (_args: string, ctx: MemoryCommandContext): Promise<string> => {
      const { runDoctor } = await import("#omo-memory-doctor-runtime")
      return runDoctor(deps, ctx)
    },
  })
}
