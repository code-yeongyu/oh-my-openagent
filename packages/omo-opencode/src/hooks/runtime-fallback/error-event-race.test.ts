import { afterEach, expect, test } from "bun:test"
import { createAutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createFallbackState } from "./fallback-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import type { HookDeps } from "./types"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function createDeps(): HookDeps {
  return {
    ctx: {
      directory: "/test/runtime-error-race",
      client: {
        session: {
          abort: async () => ({}),
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
        },
        tui: { showToast: async () => ({}) },
      },
    },
    config: { enabled: true, retry_on_errors: [400], max_fallback_attempts: 3, cooldown_seconds: 60, timeout_seconds: 0, notify_on_fallback: false, restore_primary_after_cooldown: false },
    options: undefined,
    pluginConfig: { agents: { sisyphus: { model: "openai/quality", fallback_models: ["openai/quality-fallback"] } } },
    sessionStates: new Map(), sessionLastAccess: new Map(), sessionRetryInFlight: new Set(), sessionAwaitingFallbackResult: new Set(), sessionFallbackTimeouts: new Map(), sessionStatusRetryKeys: new Map(), internallyAbortedSessions: new Set(),
  }
}

const error = { name: "APIError", data: { statusCode: 400, message: "Model quality not found" } }
const assistantError = (sessionID: string) => ({ info: { sessionID, role: "assistant", agent: "sisyphus", error } })

afterEach(releaseAllPromptAsyncReservationsForTesting)

test("a suspended message error cannot replace the retry generation started by session.error", async () => {
  // given: both event surfaces observe the first failure before the message handler resolves its agent.
  const deps = createDeps()
  const sessionID = "runtime-first-error-race"
  const agent = deferred<string>()
  const readStarted = deferred<void>()
  const messages = deferred<{ data: unknown[] }>()
  const prompts: unknown[] = []
  deps.ctx.client.session.messages = async () => { readStarted.resolve(); return messages.promise }
  deps.ctx.client.session.promptAsync = async (input) => { prompts.push(input); return {} }
  const helpers = createAutoRetryHelpers(deps)
  let resolutionCount = 0
  helpers.resolveAgentForSessionFromContext = () => ++resolutionCount === 1 ? agent.promise : Promise.resolve("sisyphus")
  const messageHandler = createMessageUpdateHandler(deps, helpers)
  const eventHandler = createEventHandler(deps, helpers)

  // when: session.error starts its real retry while message.updated is waiting for context.
  const messageEvent = messageHandler(assistantError(sessionID))
  const sessionEvent = eventHandler({ event: { type: "session.error", properties: { sessionID, agent: "sisyphus", error } } })
  await readStarted.promise
  const winningGeneration = deps.sessionStates.get(sessionID)
  agent.resolve("sisyphus")
  await messageEvent
  messages.resolve({ data: [] })
  await sessionEvent

  // then: the winning retry remains current and submits one concrete fallback prompt.
  expect(deps.sessionStates.get(sessionID)).toBe(winningGeneration)
  expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(1)
  expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("openai/quality-fallback")
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatchObject({ path: { id: sessionID }, body: { model: { providerID: "openai", modelID: "quality-fallback" } } })
  expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
})

test("a delayed error does not overwrite a replacement model generation", async () => {
  // given: context resolution is pending for an error from a previous request.
  const deps = createDeps()
  const sessionID = "runtime-replaced-error-generation"
  deps.sessionStates.set(sessionID, createFallbackState("openai/quality"))
  const agent = deferred<string>()
  const helpers = createAutoRetryHelpers(deps)
  helpers.resolveAgentForSessionFromContext = () => agent.promise
  const handler = createMessageUpdateHandler(deps, helpers)
  const pending = handler(assistantError(sessionID))

  // when: a user/model transition installs another generation before context arrives.
  const replacement = createFallbackState("openai/budget")
  deps.sessionStates.set(sessionID, replacement)
  agent.resolve("sisyphus")
  await pending

  // then: the old error cannot consume a fallback for the replacement request.
  expect(deps.sessionStates.get(sessionID)).toBe(replacement)
  expect(replacement.currentModel).toBe("openai/budget")
  expect(replacement.attemptCount).toBe(0)
})

test("an old error cannot advance the same state after another surface completes its fallback", async () => {
  // given: an error lookup waits while a competing surface retries the existing generation.
  const deps = createDeps()
  const sessionID = "runtime-completed-error-generation"
  deps.pluginConfig = { agents: { sisyphus: { model: "openai/quality", fallback_models: ["openai/quality-fallback", "openai/second-fallback"] } } }
  const state = createFallbackState("openai/quality")
  deps.sessionStates.set(sessionID, state)
  const agent = deferred<string>()
  const prompts: unknown[] = []
  deps.ctx.client.session.messages = async () => ({ data: [
    { info: { role: "user" }, parts: [{ type: "text", text: "work" }] },
    { info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "DONE" }] },
  ] })
  deps.ctx.client.session.promptAsync = async (input) => { prompts.push(input); return {} }
  const helpers = createAutoRetryHelpers(deps)
  let resolutionCount = 0
  helpers.resolveAgentForSessionFromContext = () => ++resolutionCount === 1 ? agent.promise : Promise.resolve("sisyphus")
  const messageHandler = createMessageUpdateHandler(deps, helpers)
  const eventHandler = createEventHandler(deps, helpers)
  const oldError = messageHandler(assistantError(sessionID))

  // when: the other error completes one retry, its visible reply clears pending, and the gate is available again.
  await eventHandler({ event: { type: "session.error", properties: { sessionID, agent: "sisyphus", error } } })
  await messageHandler({ info: { sessionID, role: "assistant", model: { providerID: "openai", modelID: "quality-fallback" }, finish: "stop" } })
  expect(state.pendingFallbackModel).toBeUndefined()
  releaseAllPromptAsyncReservationsForTesting()
  agent.resolve("sisyphus")
  await oldError

  // then: even in-place advancement invalidates the old error; success cannot trigger the next model.
  expect(deps.sessionStates.get(sessionID)).toBe(state)
  expect(state.currentModel).toBe("openai/quality-fallback")
  expect(state.attemptCount).toBe(1)
  expect(prompts).toHaveLength(1)
})
