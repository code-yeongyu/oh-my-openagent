import { describe, expect, it } from "bun:test"
import type { V2AgentInfo, V2ModelInfo, V2ProviderInfo } from "../context-types"
import { createFakePluginContext } from "../fake-plugin-context"
import { createSessionTracker } from "../session-tracker"
import { V2UnsupportedOperationError } from "../unsupported-operation-error"
import { createClientFacade } from "./create-client-facade"

const facadeDeps = () => ({ tracker: createSessionTracker(), warn: () => {} })

function model(overrides: Partial<V2ModelInfo> & Pick<V2ModelInfo, "providerID" | "modelID">): V2ModelInfo {
  return {
    id: overrides.modelID,
    name: overrides.modelID,
    status: "active",
    enabled: true,
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [],
    limit: { context: 200_000, output: 8_000 },
    ...overrides,
  }
}

const providers: V2ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", activation: "enabled" },
  { id: "openai", name: "OpenAI", activation: "auto" },
]

function agent(overrides: Partial<V2AgentInfo> & Pick<V2AgentInfo, "id">): V2AgentInfo {
  return { name: overrides.id, mode: "primary", hidden: false, permissions: [], ...overrides }
}

describe("createClientFacade", () => {
  describe("#given provider.list", () => {
    it("#when called #then connected providers are those with at least one enabled model", async () => {
      // given
      const { context } = createFakePluginContext({
        providers,
        models: [
          model({ providerID: "anthropic", modelID: "claude-opus" }),
          model({ providerID: "openai", modelID: "gpt-x", enabled: false }),
        ],
      })

      // when
      const result = await createClientFacade(context, facadeDeps()).provider.list()

      // then
      expect(result.data?.connected).toEqual(["anthropic"])
      expect(result.data?.all.map((provider) => provider.id)).toEqual(["anthropic", "openai"])
    })

    it("#when called #then each provider carries its models keyed by model id in the 1.x metadata shape", async () => {
      // given
      const { context } = createFakePluginContext({
        providers,
        models: [
          model({
            providerID: "anthropic",
            modelID: "claude-opus",
            name: "Claude Opus",
            variants: [{ id: "high" }],
            limit: { context: 1_000_000, output: 64_000 },
          }),
        ],
      })

      // when
      const result = await createClientFacade(context, facadeDeps()).provider.list()

      // then
      const anthropic = result.data?.all.find((provider) => provider.id === "anthropic")
      expect(anthropic?.models["claude-opus"]).toMatchObject({
        id: "claude-opus",
        providerID: "anthropic",
        name: "Claude Opus",
        tool_call: true,
        reasoning: true,
        attachment: true,
        limit: { context: 1_000_000, output: 64_000 },
        status: "active",
      })
    })

    it("#when the default model is known #then it is reported as that provider's default", async () => {
      // given
      const opus = model({ providerID: "anthropic", modelID: "claude-opus" })
      const { context } = createFakePluginContext({ providers, models: [opus], defaultModel: opus })

      // when
      const result = await createClientFacade(context, facadeDeps()).provider.list()

      // then
      expect(result.data?.default).toEqual({ anthropic: "claude-opus" })
    })
  })

  describe("#given config.get", () => {
    it("#when the host has a default model #then the config names it as provider/model", async () => {
      // given
      const opus = model({ providerID: "anthropic", modelID: "claude-opus" })
      const { context } = createFakePluginContext({ models: [opus], defaultModel: opus })

      // when
      const result = await createClientFacade(context, facadeDeps()).config.get()

      // then
      expect(result.data).toMatchObject({ model: "anthropic/claude-opus" })
    })

    it("#when the host has no default model #then the config has no model key", async () => {
      // given
      const { context } = createFakePluginContext()

      // when
      const result = await createClientFacade(context, facadeDeps()).config.get()

      // then
      expect(result.data && "model" in result.data).toBe(false)
    })
  })

  describe("#given app.agents", () => {
    it("#when called #then host agents come back in the 1.x agent shape", async () => {
      // given
      const { context } = createFakePluginContext({
        agents: [
          agent({ id: "build", description: "Builds", mode: "primary", color: "#112233" }),
          agent({ id: "explore", mode: "subagent", hidden: true, model: { providerID: "openai", id: "gpt-x" } }),
        ],
      })

      // when
      const result = await createClientFacade(context, facadeDeps()).app.agents()

      // then
      expect(result.data).toMatchObject([
        { name: "build", description: "Builds", mode: "primary", color: "#112233", hidden: false },
        { name: "explore", mode: "subagent", hidden: true, model: { providerID: "openai", modelID: "gpt-x" } },
      ])
    })
  })

  describe("#given a V1 client method with no 2.x mapping", () => {
    it("#when it lives in an unmapped namespace #then it rejects naming the exact call", async () => {
      // given
      const { context } = createFakePluginContext()
      const client = createClientFacade(context, facadeDeps())

      // when
      const call = client.session.list()

      // then
      await expect(call).rejects.toBeInstanceOf(V2UnsupportedOperationError)
      await expect(call).rejects.toMatchObject({ operation: "client.session.list" })
    })

    it("#when it lives in a mapped namespace #then it still rejects naming the exact call", async () => {
      // given
      const { context } = createFakePluginContext()
      const client = createClientFacade(context, facadeDeps())

      // when
      const call = client.provider.auth()

      // then
      await expect(call).rejects.toMatchObject({ operation: "client.provider.auth" })
    })

    it("#when the client is awaited directly #then it is not mistaken for a thenable", async () => {
      // given
      const { context } = createFakePluginContext()
      const client = createClientFacade(context, facadeDeps())

      // when
      const resolved = await Promise.resolve(client)

      // then
      expect(resolved).toBe(client)
    })
  })
})
