import { createRuntimeFallbackHook } from "../../../packages/omo-opencode/src/hooks/runtime-fallback"
import { SessionCategoryRegistry } from "../../../packages/omo-opencode/src/shared/session-category-registry"
import { getSessionPromptParams } from "../../../packages/omo-opencode/src/shared/session-prompt-params-state"

const sessionID = "qa-runtime-fallback-canonical-model-chain"
const abortCalls: unknown[] = []
const promptCalls: unknown[] = []

SessionCategoryRegistry.register(sessionID, "qa-model-chain")

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
        "qa-model-chain": {
          models: [
            "opencode/primary-model",
            {
              model: "openai/canonical-fallback",
              reasoning: "high",
              temperature: 0.3,
              maxTokens: 2048,
            },
          ],
          fallback_models: ["google/legacy-fallback"],
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
        model: "opencode/primary-model",
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

const promptParams = getSessionPromptParams(sessionID)
hook.dispose()
SessionCategoryRegistry.clear()

const serializedPrompt = JSON.stringify(promptCalls[0])
if (abortCalls.length !== 1) throw new Error(`expected one abort, received ${abortCalls.length}`)
if (promptCalls.length !== 1) throw new Error(`expected one fallback prompt, received ${promptCalls.length}`)
if (!serializedPrompt.includes("canonical-fallback")) {
  throw new Error(`canonical fallback missing from prompt: ${serializedPrompt}`)
}
if (serializedPrompt.includes("legacy-fallback")) {
  throw new Error(`legacy fallback unexpectedly won precedence: ${serializedPrompt}`)
}
if (promptParams?.temperature !== 0.3 || promptParams.maxOutputTokens !== 2048) {
  throw new Error(`fallback settings missing from chat.params state: ${JSON.stringify(promptParams)}`)
}
if (promptParams.options?.reasoningEffort !== "high") {
  throw new Error(`fallback reasoning missing from chat.params state: ${JSON.stringify(promptParams)}`)
}

console.log(JSON.stringify({
  abortCount: abortCalls.length,
  promptDispatchCount: promptCalls.length,
  promptCall: promptCalls[0],
  promptParams,
}, null, 2))
