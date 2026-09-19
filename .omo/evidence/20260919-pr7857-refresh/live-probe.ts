import { tool, type PluginModule } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../../packages/omo-opencode/src/features/background-agent/manager"
import { executeSyncContinuation } from "../../../packages/omo-opencode/src/tools/delegate-task/sync-continuation"
import { createContinuationHooks } from "../../../packages/omo-opencode/src/plugin/hooks/create-continuation-hooks"
import { createEventHookDispatcher, createEventHookRunner } from "../../../packages/omo-opencode/src/plugin/event-hook-dispatcher"
import { createRuntimeFallbackHook } from "../../../packages/omo-opencode/src/hooks/runtime-fallback/hook"
import type { CreatedHooks } from "../../../packages/omo-opencode/src/create-hooks"

export default {
  id: "pr7857-p1-probe",
  server: async (input) => {
    const recovery = process.env.QA_CASE === "recovery"
    const manager = new BackgroundManager({ pluginContext: input, enableParentSessionNotifications: false })
    const runtime = createRuntimeFallbackHook(input, {
      config: { enabled: recovery, timeout_seconds: 30, notify_on_fallback: false },
      pluginConfig: { agents: { build: { model: "openai/pr7857-missing", fallback_models: ["openai/gpt-fake"] } } },
    })
    const continuation = createContinuationHooks({ ctx: input, pluginConfig: {}, backgroundManager: manager,
      isHookEnabled: () => false, safeHookEnabled: false, isRecoveryPending: runtime.isRecoveryPending,
    })
    const forwarded = new WeakMap<object, number>()
    const original = manager.handleEvent.bind(manager)
    manager.handleEvent = event => {
      if (event.type === "session.error") {
        forwarded.set(event, (forwarded.get(event) ?? 0) + 1)
      }
      original(event)
    }
    const report = async (observation: object) => {
      const response = await fetch(`${process.env.QA_CONTROL}/observation`, {
        method: "POST", body: JSON.stringify(observation), headers: { "content-type": "application/json" },
      })
      if (!response.ok) throw new Error(`Observation rejected: ${response.status}`)
    }
    const dispatch = createEventHookDispatcher({ ...continuation, runtimeFallback: runtime } as CreatedHooks, createEventHookRunner())
    return {
      event: async (input) => {
        await dispatch(input)
        if (input.event.type === "session.error" && input.event.properties.sessionID) {
          const sessionID = input.event.properties.sessionID
          const now = Date.now
          let futureVisibility: string | null
          try { Date.now = () => now() + 60000; futureVisibility = manager.getTerminalChildError(sessionID) }
          finally { Date.now = now }
          await report({ sessionID, eventID: input.event.id, forwardingCount: forwarded.get(input.event),
            notificationHookDisabled: continuation.backgroundNotificationHook === null,
            recoveryPending: runtime.isRecoveryPending(sessionID), futureVisibility,
            clockProbeOffsetMs: 60000,
          })
        }
      },
      tool: {
        qa_terminal_child: tool({ description: "Exercise a synchronous child with unavailable model.", args: {},
          async execute(_args, context) {
            const child = await input.client.session.create({ body: { parentID: context.sessionID, title: "PR7857 child" } })
            if (!child.data) throw new Error("Child creation failed")
            const sessionID = child.data.id
            const seed = await input.client.session.prompt({ path: { id: sessionID }, body: {
              noReply: true, agent: "build", model: { providerID: "openai", modelID: "pr7857-missing" },
              parts: [{ type: "text", text: "PR7857_CHILD seed" }],
            } })
            if (seed.error) throw new Error(JSON.stringify(seed.error))
            return executeSyncContinuation({ task_id: sessionID, description: "PR7857 continuation",
              prompt: "PR7857_CHILD trigger", load_skills: [], run_in_background: false,
            }, context, { client: input.client, manager, directory: input.directory, syncPollTimeoutMs: 30000 },
            { sessionID: context.sessionID, messageID: context.messageID })
          },
        }),
      },
    }
  },
} satisfies PluginModule
