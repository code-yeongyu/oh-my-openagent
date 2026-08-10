// /reflect [--recent N | --conversation <ids>] [focus text]
//
// Manual reflection request routed through the trigger-wiring sink, which either
// reserves a run immediately or writes the single pending request slot. There is
// deliberately no --auto selector.

import type { SenpiExtensionAPI } from "../../../extension/types"
import { parseCommandArgs } from "./args"
import {
  requireIdentity,
  respond,
  type ManualReflectionRequest,
  type MemoryCommandContext,
  type MemoryCommandDeps,
} from "./types"

function parseConversationIds(value: string | true | undefined): string[] | undefined {
  if (value === undefined || value === true) return undefined
  const ids = value.split(",").map((id) => id.trim()).filter((id) => id.length > 0)
  return ids.length > 0 ? ids : undefined
}

export function registerReflectCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("reflect", {
    description: "Request a memory reflection run now, optionally scoped and focused.",
    argumentHint: "[--recent N | --conversation <ids>] [focus]",
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const sink = deps.reflectionSink
      if (sink === undefined) {
        return respond(ctx, "reflection is not available in this session; enable memory reflection in the omo config", "error")
      }

      const parsed = parseCommandArgs(args)
      const recentRaw = parsed.flags.get("recent")
      let recentN: number | undefined
      if (recentRaw !== undefined) {
        const value = recentRaw === true ? Number.NaN : Number.parseInt(recentRaw, 10)
        if (!Number.isInteger(value) || value <= 0) {
          return respond(ctx, "--recent expects a positive integer, for example /reflect --recent 5", "error")
        }
        recentN = value
      }

      const conversationIds = parseConversationIds(parsed.flags.get("conversation"))
      const focus = parsed.positionals.join(" ").trim()
      const request: ManualReflectionRequest = {
        ...(focus.length > 0 ? { focus } : {}),
        ...(recentN === undefined ? {} : { recentN }),
        ...(conversationIds === undefined ? {} : { conversationIds }),
      }

      const receipt = await sink.request(request)
      const scope = [
        recentN === undefined ? undefined : `recent ${recentN}`,
        conversationIds === undefined ? undefined : `conversations ${conversationIds.join(", ")}`,
        focus.length > 0 ? `focus "${focus}"` : undefined,
      ].filter((part): part is string => part !== undefined)
      const suffix = scope.length > 0 ? ` (${scope.join("; ")})` : ""

      return respond(
        ctx,
        receipt.disposition === "reserved"
          ? `reflection run ${receipt.runId} reserved${suffix}; it starts at the next idle boundary`
          : `reflection request queued as ${receipt.runId}${suffix}; a run is already active and this request runs next`,
      )
    },
  })
}
