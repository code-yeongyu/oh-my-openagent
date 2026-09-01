// /facts -- read-only view of the facts pipeline, plus the ONLY manual unpark path.
//
// `/facts retry` clears failure records and triggers one reconcile/launch attempt. It never
// touches queue files or either watermark: parking is a launch-gating fact, not queue state,
// so unparking must not move data. There is no automatic unparking anywhere in the pipeline.

import { FactsFailureStore, type FactsFailureFilter } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { parseCommandArgs } from "./args"
import { formatFactsStatus, readFactsOverview } from "./facts-status"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

function conversationsIn(records: readonly { readonly conversationId: string }[]): string[] {
  return [...new Set(records.map((record) => record.conversationId))].sort()
}

async function runRetry(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  identityPaths: Parameters<typeof readFactsOverview>[0]["identityPaths"],
  conversationId: string | undefined,
): Promise<string> {
  const store = new FactsFailureStore({ identityPaths })
  let before
  try {
    before = await store.readFailures()
  } catch (error) {
    return respond(
      ctx,
      `cannot retry: the failure ledger is unreadable (${error instanceof Error ? error.message : String(error)}); repair or remove failures.json first`,
      "error",
    )
  }

  const matching = before.entries.filter(
    (record) => conversationId === undefined || record.conversationId === conversationId,
  )
  if (matching.length === 0) {
    const scope = conversationId === undefined ? "the facts ledger" : `conversation ${conversationId}`
    return respond(ctx, `no failure records to clear for ${scope}; nothing was retried`, "info")
  }

  const filter: FactsFailureFilter = conversationId === undefined ? {} : { conversationId }
  const removed = await store.clearForRetry(filter)
  // ONE attempt: the extractor owns its own re-entrancy latch, so the command never loops.
  await deps.factsSink?.reconcile()
  const names = conversationsIn(matching)
  return respond(
    ctx,
    `cleared ${removed} record${removed === 1 ? "" : "s"} for ${names.join(", ")}; one launch attempt was triggered`,
  )
}

export function registerFactsCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("facts", {
    description: "Show facts-extraction queue/backoff state, or manually retry parked batches.",
    argumentHint: "[retry [--conversation <id>]]",
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const parsed = parseCommandArgs(args)
      const conversationFlag = parsed.flags.get("conversation")
      const conversationId = typeof conversationFlag === "string" ? conversationFlag : undefined

      if (parsed.positionals[0] === "retry") {
        return runRetry(deps, ctx, identity.identityPaths, conversationId)
      }
      if (parsed.positionals.length > 0) {
        return respond(ctx, `unknown /facts subcommand "${parsed.positionals[0]}"; use /facts or /facts retry`, "error")
      }

      const overview = await readFactsOverview({
        identityPaths: identity.identityPaths,
        now: new Date(deps.now?.() ?? Date.now()),
      })
      return respond(ctx, formatFactsStatus(identity.identity, overview))
    },
  })
}
