import { createOpencodeClient } from "@opencode-ai/sdk"

import { releaseAllPromptAsyncReservationsForTesting } from "../../../packages/omo-opencode/src/hooks/shared/prompt-async-gate"
import { createAbortSessionRequest } from "../../../packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-abort"
import type { HookDeps } from "../../../packages/omo-opencode/src/hooks/runtime-fallback/types"
import { createModelFallbackContinuationController } from "../../../packages/omo-opencode/src/plugin/event-model-fallback-state"
import {
  getPromptReservation,
  setPromptReservation,
} from "../../../packages/omo-opencode/src/shared/prompt-async-gate/reservations"

const server = Bun.serve({
  port: 0,
  fetch: () => Response.json({ name: "NotFoundError", message: "missing test session" }, { status: 404 }),
})

try {
  const client = createOpencodeClient({ baseUrl: server.url.toString() })
  const runtimeSessionID = "sdk-runtime-abort-boundary"
  const reservationToken = Symbol("runtime-boundary")
  setPromptReservation(runtimeSessionID, {
    source: "model-suggestion-retry",
    dedupeKey: "sdk-runtime-abort-boundary",
    reservedAt: Date.now(),
    token: reservationToken,
    expiresAt: Date.now() + 60_000,
  })
  const runtimeDeps = {
    ctx: {
      client: {
        session: {
          abort: client.session.abort,
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
        },
        tui: { showToast: async () => ({}) },
      },
      directory: "/tmp/pr6043-sdk-boundary",
    },
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 0,
      notify_on_fallback: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  } satisfies HookDeps
  const runtimeAbortResult = await createAbortSessionRequest(runtimeDeps)(
    runtimeSessionID,
    "first-prompt-watchdog",
  )

  let modelPromptCalls = 0
  const modelSessionID = "sdk-model-fallback-abort-boundary"
  const continuationsInFlight = new Set<string>()
  const modelController = createModelFallbackContinuationController({
    pluginConfig: {},
    pluginContext: {
      directory: "/tmp/pr6043-sdk-boundary",
      client: {
        session: {
          abort: client.session.abort,
          prompt: async () => {
            modelPromptCalls += 1
            return {}
          },
          promptAsync: async () => {
            modelPromptCalls += 1
            return {}
          },
          summarize: async () => ({}),
        },
      },
    },
    lastKnownModelBySession: new Map(),
    continuationsInFlight,
    lastDispatchedContinuationKeys: new Map(),
  })
  await modelController.autoContinueAfterFallback(modelSessionID, "sdk-boundary", {
    agentName: "sisyphus",
    providerID: "openai",
    dedupeProviderID: "openai",
    modelID: "fallback",
  })

  const result = {
    sdkVersion: "1.15.13",
    runtime: {
      aborted: runtimeAbortResult,
      ownsInternalAbort: runtimeDeps.internallyAbortedSessions.has(runtimeSessionID),
      reservationSource: getPromptReservation(runtimeSessionID)?.source ?? null,
      reservationTokenUnchanged: getPromptReservation(runtimeSessionID)?.token === reservationToken,
    },
    modelFallback: {
      promptCalls: modelPromptCalls,
      continuationStillInFlight: continuationsInFlight.has(modelSessionID),
    },
  }

  if (
    result.runtime.aborted
    || result.runtime.ownsInternalAbort
    || result.runtime.reservationSource !== "model-suggestion-retry"
    || !result.runtime.reservationTokenUnchanged
    || result.modelFallback.promptCalls !== 0
    || result.modelFallback.continuationStillInFlight
  ) {
    throw new Error(`SDK abort boundary assertion failed: ${JSON.stringify(result)}`)
  }

  console.log(JSON.stringify(result, null, 2))
} finally {
  releaseAllPromptAsyncReservationsForTesting()
  server.stop(true)
}
