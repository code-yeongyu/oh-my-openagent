import { createRuntimeFallbackHook } from "../../../packages/omo-opencode/src/hooks/runtime-fallback"
import { SessionCategoryRegistry } from "../../../packages/omo-opencode/src/shared/session-category-registry"

const sessionID = "qa-runtime-fallback-status-free-usage"
const abortCalls: unknown[] = []
const promptCalls: unknown[] = []

SessionCategoryRegistry.register(sessionID, "qa")

const hook = createRuntimeFallbackHook(
  {
    client: {
      session: {
        abort: async (input: unknown) => {
          abortCalls.push(input)
          return {}
        },
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "continue" }],
            },
          ],
        }),
        promptAsync: async (input: unknown) => {
          promptCalls.push(input)
          return {}
        },
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: process.cwd(),
  },
  {
    config: {
      enabled: true,
      retry_on_errors: [429, 500, 502, 503, 504],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    pluginConfig: {
      categories: {
        qa: {
          fallback_models: ["openai/gpt-5.4"],
        },
      },
    },
  },
)

await hook.event({
  event: {
    type: "session.created",
    properties: {
      info: {
        id: sessionID,
        model: "opencode/big-pickle",
      },
    },
  },
})

await hook.event({
  event: {
    type: "session.status",
    properties: {
      sessionID,
      status: {
        type: "retry",
        attempt: 1,
        message: "Free usage exceeded, subscribe to Go",
      },
    },
  },
})

hook.dispose()
SessionCategoryRegistry.clear()

if (abortCalls.length !== 1) {
  throw new Error(`expected one immediate abort, received ${abortCalls.length}`)
}
if (promptCalls.length !== 1) {
  throw new Error(`expected one fallback prompt dispatch, received ${promptCalls.length}`)
}

const promptCall = promptCalls[0]
console.log(JSON.stringify({
  event: "session.status",
  message: "Free usage exceeded, subscribe to Go",
  abortCount: abortCalls.length,
  promptDispatchCount: promptCalls.length,
  promptCall,
}, null, 2))
