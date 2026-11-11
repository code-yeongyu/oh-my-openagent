/**
 * Regression test for issue #5604: the delegation harness must fail fast when
 * model resolution definitively returns undefined (all configured providers are
 * disconnected) for an agent that requires at least one model to be available.
 *
 * Before this fix, resolveSubagentExecution returned { agentToUse, categoryModel: undefined }
 * without an error, allowing executeSyncTask to proceed and create a child session with
 * no usable model/stream — appearing as a hidden, skipped, or stuck subagent.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test, mock } from "bun:test"
import { resolveSubagentExecution } from "./subagent-resolver"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

/**
 * Build a minimal ExecutorContext whose client.app.agents() returns the given list.
 * The model.list method is omitted so getAvailableModelsForDelegateTask returns an
 * empty Set (relies on the connected-providers cache path instead).
 */
function makeCtxWithAgents(agents: Array<{ name: string; mode: "subagent" | "primary" | "all" }>): ExecutorContext {
  return {
    client: {
      app: {
        agents: async () => ({ data: agents }),
      },
      config: { get: async () => ({ data: {} }) },
    } as unknown as ExecutorContext["client"],
    manager: {} as unknown as ExecutorContext["manager"],
    directory: "/tmp/test",
  }
}

describe("delegation harness fail-fast on unresolvable model (#5604)", () => {
  let hasConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined
  let hasProviderModelsSpy: ReturnType<typeof spyOn> | undefined
  let readConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined
  let readProviderModelsSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    hasConnectedProvidersSpy?.mockRestore()
    hasProviderModelsSpy?.mockRestore()
    readConnectedProvidersSpy?.mockRestore()
    readProviderModelsSpy?.mockRestore()
  })

  function setupDisconnectedProviders(connectedProvider: string): void {
    // Simulate: cache exists (we know the connectivity state), but the only connected
    // provider is NOT in the target agent's fallback chain → resolution returns undefined.
    hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
    hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
    readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([connectedProvider])
    // No provider-models cache → getAvailableModelsForDelegateTask returns empty Set
    readProviderModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
  }

  test("#given hephaestus agent with requiresAnyModel=true #when only a disconnected provider is connected #then resolveSubagentExecution returns a structured error before creating a child session", async () => {
    // hephaestus only supports: openai, github-copilot, opencode, vercel
    // We connect "xai" (not in the chain) → resolution returns undefined
    setupDisconnectedProviders("xai")

    const ctx = makeCtxWithAgents([{ name: "hephaestus", mode: "subagent" }])
    const args = {
      subagent_type: "hephaestus",
      prompt: "write a regression test",
      load_skills: [],
      run_in_background: false as boolean,
      description: "test delegation fail-fast",
    }

    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    expect(result.error).toBeDefined()
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
    // Error must name the agent and mention provider connectivity
    expect(result.error).toContain("hephaestus")
    expect(result.error).toContain("disconnected")
  })

  test("#given sisyphus agent with requiresAnyModel=true #when only xai is connected (not in sisyphus fallback chain) #then returns structured error not silent undefined model", async () => {
    setupDisconnectedProviders("xai")

    const ctx = makeCtxWithAgents([{ name: "sisyphus", mode: "subagent" }])
    const args = {
      subagent_type: "sisyphus",
      prompt: "do some work",
      load_skills: [],
      run_in_background: false as boolean,
      description: "test sisyphus fail-fast",
    }

    const result = await resolveSubagentExecution(args, ctx, "atlas", "")

    expect(result.error).toBeDefined()
    expect(result.agentToUse).toBe("")
    expect(result.error).toContain("sisyphus")
    expect(result.error).toContain("disconnected")
  })

  test("#given hephaestus agent #when a matching provider IS connected #then resolution succeeds without error", async () => {
    // openai IS in hephaestus's fallback chain → should not error
    hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
    hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
    readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    readProviderModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)

    const ctx = makeCtxWithAgents([{ name: "hephaestus", mode: "subagent" }])
    const args = {
      subagent_type: "hephaestus",
      prompt: "write a test",
      load_skills: [],
      run_in_background: false as boolean,
      description: "hephaestus connected",
    }

    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    // No model error — resolution picks openai/gpt-5.5 from the fallback chain
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("hephaestus")
  })

  test("#given hephaestus agent #when cache is cold (no connectivity info) #then skipped sentinel is used and no error is raised", async () => {
    // Cold cache: skip → not a definitive failure, do not error
    hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(false)
    hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
    readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    readProviderModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)

    const ctx = makeCtxWithAgents([{ name: "hephaestus", mode: "subagent" }])
    const args = {
      subagent_type: "hephaestus",
      prompt: "write a test",
      load_skills: [],
      run_in_background: false as boolean,
      description: "cold cache, no error",
    }

    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    // Cold cache = skipped, not an error; categoryModel is undefined (runtime will decide)
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("hephaestus")
    expect(result.categoryModel).toBeUndefined()
  })
})
