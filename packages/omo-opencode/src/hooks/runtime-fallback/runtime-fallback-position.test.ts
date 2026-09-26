import { afterEach, describe, expect, test } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

type RecordedPrompt = {
  model: string
  agent?: string
  partTexts: string[]
}

function createContext(recorded: {
  prompts: RecordedPrompt[]
  aborts: string[]
}): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async (input: { path: { id: string } }) => {
          recorded.aborts.push(input.path.id)
          return {}
        },
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "run the failing task" }],
            },
          ],
        }),
        promptAsync: async (input: {
          path: { id: string }
          body: {
            agent?: string
            model: { providerID: string; modelID: string }
            parts: Array<{ type: string; text?: string }>
          }
        }) => {
          recorded.prompts.push({
            model: `${input.body.model.providerID}/${input.body.model.modelID}`,
            agent: input.body.agent,
            partTexts: input.body.parts.map((part) => part.text ?? ""),
          })
          return {}
        },
        status: async () => ({ data: {} }),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
  SessionCategoryRegistry.clear()
})

describe("runtime fallback position monotonicity (#6751)", () => {
  test("#given primary and first fallback both fail across an internal-abort cycle #when opencode echoes stop/idle/abort-error between hops #then dispatched fallback models only move forward and never revisit failed models", async () => {
    // given - issue #6751 chain shape: the primary itself is chain[0]
    const recorded = { prompts: [] as RecordedPrompt[], aborts: [] as string[] }
    const hook = createRuntimeFallbackHook(createContext(recorded), {
      config: {
        enabled: true,
        retry_on_errors: [429, 503],
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 1,
        notify_on_fallback: false,
        restore_primary_after_cooldown: false,
      },
      pluginConfig: {
        agents: {
          sisyphus: {
            model: "zai/primary",
            fallback_models: ["zai/primary", "go/fallback-a", "zen/fallback-b"],
          },
        },
      },
    })
    const sessionID = "ses_6751_e2e_monotonic"

    // when - primary fails with a retryable provider error
    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, agent: "sisyphus", model: "zai/primary" } },
      },
    })
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          agent: "sisyphus",
          error: { name: "ProviderError", message: "service unavailable", statusCode: 503 },
        },
      },
    })

    // first hop dispatched
    expect(recorded.prompts.map((prompt) => prompt.model)).toEqual(["go/fallback-a"])

    // provider reports it is auto-retrying the first fallback (monthly limit);
    // the real abort helper marks internallyAbortedSessions before aborting
    await hook.event({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          agent: "sisyphus",
          model: "go/fallback-a",
          status: { type: "retry", message: "rate limit exceeded", attempt: 1 },
        },
      },
    })

    // second hop dispatched forward
    expect(recorded.prompts.map((prompt) => prompt.model)).toEqual([
      "go/fallback-a",
      "zen/fallback-b",
    ])

    // opencode echoes our abort back as stop + idle + abort-classified error
    await hook.event({ event: { type: "session.stop", properties: { sessionID } } })
    await hook.event({ event: { type: "session.idle", properties: { sessionID } } })
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError", message: "aborted" } },
      },
    })

    // the second fallback fails too; chain is exhausted so nothing further
    // may be dispatched - in particular never zai/primary or go/fallback-a
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          agent: "sisyphus",
          error: { name: "ProviderError", message: "monthly usage limit reached", statusCode: 503 },
        },
      },
    })

    // then
    expect(recorded.prompts.map((prompt) => prompt.model)).toEqual([
      "go/fallback-a",
      "zen/fallback-b",
    ])
    for (const prompt of recorded.prompts) {
      expect(prompt.partTexts).toContain("run the failing task")
    }
    hook.dispose?.()
  })

  test("#given a genuine user stop with no internal abort in flight #when stop and idle fire #then the next failure starts a fresh cycle at the first chain candidate (legitimate new-cycle reset)", async () => {
    // given
    const recorded = { prompts: [] as RecordedPrompt[], aborts: [] as string[] }
    const hook = createRuntimeFallbackHook(createContext(recorded), {
      config: {
        enabled: true,
        retry_on_errors: [429, 503],
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 1,
        notify_on_fallback: false,
        restore_primary_after_cooldown: false,
      },
      pluginConfig: {
        agents: {
          sisyphus: {
            model: "zai/primary",
            fallback_models: ["zai/primary", "go/fallback-a", "zen/fallback-b"],
          },
        },
      },
    })
    const sessionID = "ses_6751_e2e_genuine_reset"

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, agent: "sisyphus", model: "zai/primary" } },
      },
    })
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          agent: "sisyphus",
          error: { name: "ProviderError", message: "service unavailable", statusCode: 503 },
        },
      },
    })
    expect(recorded.prompts.map((prompt) => prompt.model)).toEqual(["go/fallback-a"])

    // when - genuine user stop (no internal abort flag set by anyone)
    await hook.event({ event: { type: "session.stop", properties: { sessionID } } })
    await hook.event({ event: { type: "session.idle", properties: { sessionID } } })

    // then - a new failure re-prepares from the start of the chain, skipping
    // the equivalent current entry: go/fallback-a again is the legitimate
    // fresh-cycle behavior (cooldown on zai/primary still applies)
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          agent: "sisyphus",
          error: { name: "ProviderError", message: "service unavailable again", statusCode: 503 },
        },
      },
    })
    expect(recorded.prompts.map((prompt) => prompt.model)).toEqual([
      "go/fallback-a",
      "go/fallback-a",
    ])
    hook.dispose?.()
  })
})
