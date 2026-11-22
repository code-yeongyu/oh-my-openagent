// /recompile — bust the compiled memory-block cache so the next agent run
// recompiles from HEAD (letta recompileAgentSystemPrompt + cache-evict notice).

import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"
import { LAZY_MEMORY_COMMANDS, type MemoryCommandPort } from "./metadata"

export function registerRecompileCommand(pi: MemoryCommandPort, deps: MemoryCommandDeps): void {
  pi.registerCommand("recompile", {
    ...LAZY_MEMORY_COMMANDS.recompile,
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
