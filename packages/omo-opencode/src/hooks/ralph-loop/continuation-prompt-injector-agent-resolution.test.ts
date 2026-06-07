/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import {
  _resetForTesting,
  registerAgentName,
} from "../../features/claude-code-session-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { injectContinuationPrompt } from "./continuation-prompt-injector"

describe("ralph-loop continuation prompt agent resolution", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    _resetForTesting()
  })

  test("#given OpenCode registered agent under display name #when inherited agent is config key #then prompt uses canonical display name", async () => {
    // given
    registerAgentName("Atlas - Plan Executor")
    let capturedAgent: string | undefined
    const ctx = unsafeTestValue<PluginInput>({
      client: {
        session: {
          messages: async () => ({ data: [{ info: { agent: "atlas" } }] }),
          promptAsync: async (input: { readonly body: { readonly agent?: string } }) => {
            capturedAgent = input.body.agent
            return {}
          },
        },
      },
    })

    // when
    await injectContinuationPrompt(ctx, {
      sessionID: "ses_ralph_registered_atlas",
      prompt: "continue",
      directory: "/tmp/test",
      apiTimeoutMs: 50,
    })

    // then
    expect(capturedAgent).toBe("Atlas - Plan Executor")
  })

  test("#when inherited agent is Sisyphus display name #then prompt uses canonical display name", async () => {
    // given
    registerAgentName("Sisyphus - ultraworker")
    let capturedAgent: string | undefined
    const ctx = unsafeTestValue<PluginInput>({
      client: {
        session: {
          messages: async () => ({ data: [{ info: { agent: "Sisyphus - Ultraworker" } }] }),
          promptAsync: async (input: { readonly body: { readonly agent?: string } }) => {
            capturedAgent = input.body.agent
            return {}
          },
        },
      },
    })

    // when
    await injectContinuationPrompt(ctx, {
      sessionID: "ses_ralph_sisyphus_display",
      prompt: "continue",
      directory: "/tmp/test",
      apiTimeoutMs: 50,
    })

    // then: display name with different casing is normalized to canonical
    expect(capturedAgent).toBe("Sisyphus - ultraworker")
  })

  test("#when inherited agent is Sisyphus config key #then prompt uses canonical display name", async () => {
    // given
    registerAgentName("Sisyphus - ultraworker")
    let capturedAgent: string | undefined
    const ctx = unsafeTestValue<PluginInput>({
      client: {
        session: {
          messages: async () => ({ data: [{ info: { agent: "sisyphus" } }] }),
          promptAsync: async (input: { readonly body: { readonly agent?: string } }) => {
            capturedAgent = input.body.agent
            return {}
          },
        },
      },
    })

    // when
    await injectContinuationPrompt(ctx, {
      sessionID: "ses_ralph_sisyphus_config_key",
      prompt: "continue",
      directory: "/tmp/test",
      apiTimeoutMs: 50,
    })

    // then: config key is resolved to the canonical display name the SDK expects
    expect(capturedAgent).toBe("Sisyphus - ultraworker")
  })
})
