// /remember <text> — durable memory request turn.
//
// Port of letta src/agent/prompts/remember.md semantics: the main agent owns the
// memory write through its memory tools; the command only delivers an instruction
// turn at a clean idle boundary. Read-only command output never enters the model
// context, but this command's whole purpose is to create a model turn.

import type { SenpiExtensionAPI } from "../../../extension/types"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

export const REMEMBER_INSTRUCTION =
  "[MEMORY REQUEST] Persist this as long-term memory if appropriate. Use your memory tools: " +
  "choose the most appropriate memory file (create one if no relevant file exists), avoid " +
  "duplicates, match the existing formatting of the file, then briefly confirm what you " +
  "remembered and where you stored it."

export function registerRememberCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("remember", {
    description: "Persist text to long-term memory via a memory-tool turn.",
    argumentHint: "<text>",
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const text = args.trim()
      if (text.length === 0) return respond(ctx, "usage: /remember <text>", "error")

      await ctx.waitForIdle?.()
      pi.sendUserMessage(`${REMEMBER_INSTRUCTION}\n\n${text}`)
      return respond(ctx, `memory request sent for ${identity.identity}`)
    },
  })
}
