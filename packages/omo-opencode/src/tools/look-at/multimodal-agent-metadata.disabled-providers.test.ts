import { afterEach, describe, expect, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as modelAvailability from "../../shared/model-availability"
import {
  clearVisionCapableModelsCache,
  setVisionCapableModelsCache,
} from "../../shared/vision-capable-models-cache"
import { resolveMultimodalLookerAgentMetadata } from "./multimodal-agent-metadata"

function createPluginInput(): PluginInput {
  return {
    client: unsafeTestValue<PluginInput["client"]>({
      app: { agents: async () => ({ data: [] }) },
    }),
    project: unsafeTestValue<PluginInput["project"]>({}),
    directory: "/project",
    worktree: "/project",
    serverUrl: new URL("http://localhost"),
    $: unsafeTestValue<PluginInput["$"]>({}),
  }
}

describe("resolveMultimodalLookerAgentMetadata disabled providers", () => {
  const availableModelsSpy = spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
    new Set(["openai/gpt-5.6-sol", "opencode-go/kimi-k3"]),
  )
  const connectedProvidersSpy = spyOn(
    connectedProvidersCache,
    "readConnectedProvidersCache",
  ).mockReturnValue(["openai", "opencode-go"])

  afterEach(() => {
    availableModelsSpy.mockRestore()
    connectedProvidersSpy.mockRestore()
    clearVisionCapableModelsCache()
  })

  test("selects the next vision fallback when its provider is disabled", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      ["openai/gpt-5.6-sol", { providerID: "openai", modelID: "gpt-5.6-sol" }],
      ["opencode-go/kimi-k3", { providerID: "opencode-go", modelID: "kimi-k3" }],
    ]))

    // when
    const result = await resolveMultimodalLookerAgentMetadata(
      createPluginInput(),
      ["openai"],
    )

    // then
    expect(result).toEqual({
      agentModel: { providerID: "opencode-go", modelID: "kimi-k3" },
      agentVariant: undefined,
    })
  })
})
