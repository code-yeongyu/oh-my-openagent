import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { ProviderModelsConfig } from "../../config/schema/provider-models"
import { ProviderPinRegistry } from "../../shared/provider-pin-registry"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createLookAt } from "./tools"

type PromptBody = { model?: unknown; variant?: string }

const toolContext: ToolContext = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "sisyphus",
  directory: "/project",
  worktree: "/project",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

const PROVIDER_MODELS: ProviderModelsConfig = {
  openai: { agents: { "multimodal-looker": { model: "openai/gpt-6.1-sol", variant: "low" } } },
  anthropic: { categories: { quick: { model: "anthropic/claude-haiku-5-5" } } },
}

function createHarness(options?: { providerModels?: ProviderModelsConfig }) {
  const bodies: PromptBody[] = []
  const pinnedDuringPrompt: Array<string | undefined> = []
  const sessionID = `ses_look_${bodies.length}_${Math.random().toString(36).slice(2)}`
  const tool = createLookAt(
    unsafeTestValue({
      client: {
        app: {
          agents: async () => ({
            data: [
              {
                name: "multimodal-looker",
                mode: "subagent",
                model: { providerID: "anthropic", modelID: "claude-opus-5-5" },
              },
            ],
          }),
        },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: sessionID } }),
          prompt: async (input: { body: PromptBody }) => {
            bodies.push(input.body)
            pinnedDuringPrompt.push(ProviderPinRegistry.get(sessionID))
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "a cat" }] }],
          }),
        },
      },
      directory: "/project",
    }),
    options,
  )
  return { tool, bodies, pinnedDuringPrompt, sessionID }
}

describe("look_at provider override", () => {
  test("#given provider omitted #then the prompt body is identical with and without pin sets", async () => {
    // given
    const plain = createHarness()
    const pinned = createHarness({ providerModels: PROVIDER_MODELS })

    // when
    await plain.tool.execute({ file_path: "/test/cat.png", goal: "what is it" }, toolContext)
    await pinned.tool.execute({ file_path: "/test/cat.png", goal: "what is it" }, toolContext)

    // then
    expect(JSON.stringify(pinned.bodies)).toBe(JSON.stringify(plain.bodies))
    expect(plain.bodies[0]?.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-5-5" })
    expect(Object.keys(plain.tool.args)).not.toContain("provider")
    expect(Object.keys(pinned.tool.args)).toContain("provider")
  })

  test("#given provider openai #then multimodal-looker runs on the openai pin and the child is pinned while it runs", async () => {
    // given
    const harness = createHarness({ providerModels: PROVIDER_MODELS })

    // when
    const result = await harness.tool.execute(
      unsafeTestValue({ file_path: "/test/cat.png", goal: "what is it", provider: "openai" }),
      toolContext,
    )

    // then
    expect(result).toBe("a cat")
    expect(harness.bodies[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-6.1-sol" })
    expect(harness.bodies[0]?.variant).toBe("low")
    expect(harness.pinnedDuringPrompt).toEqual(["openai"])
    expect(ProviderPinRegistry.get(harness.sessionID)).toBeUndefined()
  })

  test("#given provider anthropic without a multimodal-looker pin #then it fails naming the key and sends nothing", async () => {
    // given
    const harness = createHarness({ providerModels: PROVIDER_MODELS })

    // when
    const result = await harness.tool.execute(
      unsafeTestValue({ file_path: "/test/cat.png", goal: "what is it", provider: "anthropic" }),
      toolContext,
    )

    // then
    expect(harness.bodies).toHaveLength(0)
    expect(result).toContain('provider "anthropic"')
    expect(result).toContain('agent "multimodal-looker"')
    expect(result).toContain("provider_models.anthropic.agents.multimodal-looker")
  })
})
