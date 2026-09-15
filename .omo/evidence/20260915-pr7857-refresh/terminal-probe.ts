import { tool, type PluginModule } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../../packages/omo-opencode/src/features/background-agent/manager"
import { executeSyncContinuation } from "../../../packages/omo-opencode/src/tools/delegate-task/sync-continuation"

// Real harness boundary fixture: no mocked client, event, manager or poller.
export default {
  id: "pr7857-terminal-probe",
  server: async (input) => {
    const completions = new Map<string, () => void>()
    const manager = new BackgroundManager({
      pluginContext: input,
      enableParentSessionNotifications: false,
      onSubagentSessionDeleted: async ({ sessionID }) => { completions.get(sessionID)?.() },
    })
    return {
      event: async ({ event }) => { manager.handleEvent(event) },
      tool: {
        qa_terminal_child: tool({
          description: "Exercise a synchronous continuation whose model does not exist.",
          args: { attached: tool.schema.boolean().optional() },
          async execute(args, context) {
            const child = await input.client.session.create({ body: { parentID: context.sessionID, title: "PR7857 child" } })
            if (!child.data) throw new Error("Child creation failed")
            const sessionID = child.data.id
            if (args.attached) {
              const task = await manager.trackTask({ taskId: `qa_${sessionID}`, sessionId: sessionID, parentSessionId: context.sessionID, description: "PR7857 background", agent: "build" })
              let timer: ReturnType<typeof setTimeout> | undefined
              const completed = new Promise<void>((resolve, reject) => {
                completions.set(sessionID, resolve)
                timer = setTimeout(() => reject(new Error("Background completion deadline exceeded")), 30000)
              })
              try {
                await Promise.all([
                  completed,
                  input.client.session.prompt({ path: { id: sessionID }, body: {
                    agent: "build", model: { providerID: "openai", modelID: "gpt-fake" },
                    parts: [{ type: "text", text: "PR7857_BACKGROUND: finish this background task." }],
                  } }).then(result => { if (result.error) throw new Error(JSON.stringify(result.error)) }),
                ])
                if (task.status !== "completed" || manager.findBySession(sessionID) !== task) {
                  throw new Error("Expected retained completed background task before continuation")
                }
              } finally {
                clearTimeout(timer)
                completions.delete(sessionID)
              }
            }
            const seed = await input.client.session.prompt({
              path: { id: sessionID },
              body: { noReply: true, agent: "build", model: { providerID: "openai", modelID: "pr7857-missing" }, parts: [{ type: "text", text: "PR7857 seed" }] },
            })
            if (seed.error) throw new Error(JSON.stringify(seed.error))
            return executeSyncContinuation({
              task_id: sessionID, description: "PR7857 continuation", prompt: "PR7857 trigger", load_skills: [], run_in_background: false,
            }, context, {
              client: input.client, manager, directory: input.directory, syncPollTimeoutMs: 30000,
            }, { sessionID: context.sessionID, messageID: context.messageID })
          },
        }),
      },
    }
  },
} satisfies PluginModule
