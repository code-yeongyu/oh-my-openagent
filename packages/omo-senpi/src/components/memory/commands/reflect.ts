// /reflect [--recent N | --conversation <ids>] [focus text]
//
// Manual reflection request routed through the trigger-wiring sink, which either
// reserves a run immediately or writes the single pending request slot. There is
// deliberately no --auto selector.

import { resolveReflectionTriggerConfig } from "../trigger-wiring"
import { parseCommandArgs } from "./args"
import {
  requireIdentity,
  respond,
  type ManualReflectionRequest,
  type MemoryCommandContext,
  type MemoryCommandDeps,
} from "./types"
import { LAZY_MEMORY_COMMANDS, type MemoryCommandPort } from "./metadata"

function parseConversationIds(value: string | true | undefined): string[] | undefined {
  if (value === undefined || value === true) return undefined
  const ids = value.split(",").map((id) => id.trim()).filter((id) => id.length > 0)
  return ids.length > 0 ? ids : undefined
}

export function registerReflectCommand(pi: MemoryCommandPort, deps: MemoryCommandDeps): void {
  pi.registerCommand("reflect", {
    ...LAZY_MEMORY_COMMANDS.reflect,
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const { settings } = deps.loadSettings()
      const triggerConfig = resolveReflectionTriggerConfig(settings, identity.identity)
      if (!triggerConfig.enabled) {
        return respond(ctx, "reflection is disabled; set reflection.enabled to true in your omo config to enable it", "error")
      }

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

      if (receipt.disposition === "reserved") {
        return respond(ctx, `reflection run ${receipt.runId} reserved${suffix}; it starts at the next idle boundary`)
      }
      if (receipt.recoveredRunId !== undefined) {
        return respond(
          ctx,
          `reflection request queued as ${receipt.runId}${suffix}; the previous run ${receipt.recoveredRunId} had stopped without releasing its lock, so it was settled and this request runs next`,
        )
      }
      const queued = `reflection request queued as ${receipt.runId}${suffix}; a run is already active and this request runs next`
      return receipt.stuck === undefined ? respond(ctx, queued) : respond(ctx, `${queued}. ${receipt.stuck}`, "warning")
    },
  })
}
