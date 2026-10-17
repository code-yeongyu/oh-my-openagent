import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { PrWatchManager } from "../../features/pr-watch/manager"

export function createPrWatchTools(manager: PrWatchManager): Record<string, ToolDefinition> {
  return {
    watch_pull_request: tool({
      description: "Watch a GitHub pull request once per minute on the host. Only real check, external remark, or conflict transitions wake this session; observations never authorize merging.",
      args: { reference: tool.schema.string().describe("owner/repo#number") },
      async execute(args, context) {
        return JSON.stringify(await manager.watch(args.reference, context.sessionID, context.directory))
      },
    }),
    unwatch_pull_request: tool({
      description: "Stop this session's PR watch and discard pending undelivered events.",
      args: { watch_id: tool.schema.string() },
      async execute(args, context) {
        await manager.unwatch(args.watch_id, context.sessionID)
        return "PR watch stopped."
      },
    }),
    list_pull_request_watches: tool({
      description: "List this session's PR watches, including active watching state and explicit stop reasons.",
      args: {},
      async execute(_args, context) { return JSON.stringify(manager.list(context.sessionID)) },
    }),
  }
}
