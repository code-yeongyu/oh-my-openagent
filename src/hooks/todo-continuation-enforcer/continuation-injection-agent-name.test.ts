/// <reference path="../../../bun-test.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { injectContinuation } from "./continuation-injection"

describe("injectContinuation agent names", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given resolved agent is a lowercase built-in config key #when continuation is injected #then promptAsync receives the registered display name", async () => {
    // given
    let capturedAgent: string | undefined
    const ctx = unsafeTestValue<Parameters<typeof injectContinuation>[0]["ctx"]>({
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: { body: { agent?: string } }) => {
            capturedAgent = input.body.agent
            return {}
          },
        },
      },
    })
    const sessionStateStore = unsafeTestValue<Parameters<typeof injectContinuation>[0]["sessionStateStore"]>({
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    })

    // when
    await injectContinuation({
      ctx,
      sessionID: "ses_lowercase_builtin_agent",
      resolvedInfo: {
        agent: "hephaestus",
        model: { providerID: "openai", modelID: "gpt-5.5" },
      },
      sessionStateStore,
    })

    // then
    expect(capturedAgent).toBe("Hephaestus - Deep Agent")
  })
})
