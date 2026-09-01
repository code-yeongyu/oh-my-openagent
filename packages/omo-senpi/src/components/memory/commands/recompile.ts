// /recompile — bust the compiled memory-block cache so the next agent run
// recompiles from HEAD (letta recompileAgentSystemPrompt + cache-evict notice).

import type { SenpiExtensionAPI } from "../../../extension/types"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

export function registerRecompileCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("recompile", {
    description: "Recompile the memory block into the system prompt on the next agent run.",
    argumentHint: "",
    handler: async (_args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      deps.bustPromptCache()
      return respond(
        ctx,
        `memory prompt cache cleared for ${identity.identity}; the next agent run recompiles from HEAD (the current run keeps its prompt)`,
      )
    },
  })
}
