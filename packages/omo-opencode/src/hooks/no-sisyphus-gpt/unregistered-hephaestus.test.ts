/// <reference types="bun-types" />

import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  _resetForTesting,
  getSessionAgent,
  registerAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { createNoSisyphusGptHook } from "./index"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const SISYPHUS_DISPLAY = getAgentDisplayName("sisyphus")
const HEPHAESTUS_DISPLAY = getAgentDisplayName("hephaestus")

type HookOutput = {
  message: { agent?: string; variant?: string; [key: string]: unknown }
  parts: unknown[]
}

function createHookContext(showToast: (input: unknown) => Promise<unknown>): PluginInput {
  return unsafeTestValue<PluginInput>({
    client: { tui: { showToast } },
  })
}

describe("no-sisyphus-gpt redirect target availability (#8491)", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("#given Hephaestus is not registered #when Sisyphus runs an unsupported GPT model #then the agent is not switched", async () => {
    // given
    registerAgentName(SISYPHUS_DISPLAY)
    updateSessionAgent("ses_unregistered", SISYPHUS_DISPLAY)
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createNoSisyphusGptHook(createHookContext(showToast))
    const input: { sessionID: string; agent?: string; model: { providerID: string; modelID: string } } = {
      sessionID: "ses_unregistered",
      agent: SISYPHUS_DISPLAY,
      model: { providerID: "openai", modelID: "gpt-4.1" },
    }
    const output: HookOutput = { message: {}, parts: [] }

    // when
    await hook["chat.message"]?.(input, output)

    // then
    expect(input.agent).toBe(SISYPHUS_DISPLAY)
    expect(output.message.agent).toBeUndefined()
    expect(getSessionAgent("ses_unregistered")).toBe(SISYPHUS_DISPLAY)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  test("#given Hephaestus is registered under its display name #when Sisyphus runs an unsupported GPT model #then the agent switches to that registered name", async () => {
    // given
    registerAgentName(SISYPHUS_DISPLAY)
    registerAgentName(HEPHAESTUS_DISPLAY)
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createNoSisyphusGptHook(createHookContext(showToast))
    const input: { sessionID: string; agent?: string; model: { providerID: string; modelID: string } } = {
      sessionID: "ses_registered",
      agent: SISYPHUS_DISPLAY,
      model: { providerID: "openai", modelID: "gpt-4.1" },
    }
    const output: HookOutput = { message: {}, parts: [] }

    // when
    await hook["chat.message"]?.(input, output)

    // then
    expect(input.agent).toBe(HEPHAESTUS_DISPLAY)
    expect(output.message.agent).toBe(HEPHAESTUS_DISPLAY)
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
