import { afterEach, describe, expect, test } from "bun:test"
import { createSystemTransformHandler } from "./system-transform"
import { createAtlasAgent } from "../agents/atlas"
import { createHephaestusAgent } from "../agents/hephaestus"
import { createOracleAgent } from "../agents/oracle"
import { createSisyphusAgent } from "../agents/sisyphus"
import { buildSisyphusJuniorPrompt } from "../agents/sisyphus-junior/agent"
import { getPrometheusPrompt } from "../agents/prometheus/system-prompt"
import { clearSisyphusRuntimePromptContext } from "../agents/sisyphus-runtime-prompt-reconciler"
import { createNoHephaestusNonGptHook } from "../hooks/no-hephaestus-non-gpt"
import type { PluginInput } from "@opencode-ai/plugin"

afterEach(clearSisyphusRuntimePromptContext)

describe("per-request Native model prompt selection", () => {
  test.each([
    ["atlas", (model: string) => createAtlasAgent({ model }).prompt ?? ""],
    ["oracle", (model: string) => createOracleAgent(model).prompt ?? ""],
    ["prometheus", (model: string) => getPrometheusPrompt(model)],
  ] as const)("rebuilds %s while preserving user appends and neighboring system text", async (_name, render) => {
    const before = render("anthropic/claude-opus-5-5")
    const output = { system: ["HOST_SENTINEL", before + "\nUSER_APPEND_SENTINEL"] }

    await createSystemTransformHandler()(
      { model: { providerID: "openai", id: "gpt-5.4" } }, output,
    )

    const marker = "\n</omo-model-core>"
    const afterCore = render("openai/gpt-5.4")
    expect(output.system).toEqual(["HOST_SENTINEL",
      afterCore.slice(0, afterCore.indexOf(marker) + marker.length) +
      before.slice(before.indexOf(marker) + marker.length) + "\nUSER_APPEND_SENTINEL",
    ])
  })

  test("keeps a provider namespace inside the model ID", async () => {
    const before = createOracleAgent("anthropic/claude-opus-5-5").prompt ?? ""
    const output = { system: [before] }
    await createSystemTransformHandler()(
      { model: { providerID: "synthetic", id: "vendor/gpt-5.4" } }, output,
    )
    const marker = "\n</omo-model-core>"
    const expected = createOracleAgent("synthetic/vendor/gpt-5.4").prompt ?? ""
    expect(output.system).toEqual([expected.slice(0, expected.indexOf(marker) + marker.length)
      + before.slice(before.indexOf(marker) + marker.length)])
  })

  test("the user's allow_non_gpt_model decision survives the per-request transform", async () => {
    const warnings: unknown[] = []
    const hook = createNoHephaestusNonGptHook({
      client: { tui: { showToast: async (toast: unknown) => { warnings.push(toast) } } },
    } as unknown as PluginInput, { allowNonGptModel: true })
    await hook["chat.message"]({
      sessionID: "override-session", agent: "hephaestus",
      model: { providerID: "anthropic", modelID: "claude-opus-5-5" },
    })
    const previous = createHephaestusAgent("openai/gpt-5.4").prompt
    expect(previous).toBeString()
    const output = { system: [previous] }
    await createSystemTransformHandler()({ model: { providerID: "anthropic", id: "claude-opus-5-5" } }, output)
    expect(warnings).toHaveLength(1)
    expect(output.system).toEqual([previous])
  })

  test("does not interpret unframed custom system prompts", async () => {
    const output = { system: ["CUSTOM_PROMPT_SENTINEL"] }
    await createSystemTransformHandler()(
      { model: { providerID: "openai", id: "gpt-5.4" } }, output,
    )
    expect(output.system).toEqual(["CUSTOM_PROMPT_SENTINEL"])
  })

  test.each([
    ["anthropic", "claude-opus-5-5"],
    ["openai", "gpt-5.2"],
    ["openai", "gpt-4.1"],
  ])("keeps the previous Hephaestus prompt when the runtime switches to %s/%s", async (providerID, id) => {
    const previous = createHephaestusAgent("openai/gpt-5.4").prompt + "\nUSER_APPEND_SENTINEL"
    const output = { system: [previous] }
    await createSystemTransformHandler()({ model: { providerID, id } }, output)
    expect(output.system).toEqual([previous])
  })

  test.each([
    ["sisyphus", (model: string) => createSisyphusAgent(model, [], [], [], [], true).prompt ?? ""],
    ["sisyphus-junior", (model: string) => buildSisyphusJuniorPrompt(model, true)],
    ["hephaestus", (model: string) => createHephaestusAgent(model, [], [], [], [], true).prompt ?? ""],
  ] as const)("preserves %s task tracking when the model changes", async (_name, render) => {
    const output = { system: [render("openai/gpt-5.5") + "\nUSER_APPEND_SENTINEL"] }
    await createSystemTransformHandler()(
      { model: { providerID: "openai", id: "gpt-5.6-sol" } }, output,
    )
    expect(output.system).toEqual([render("openai/gpt-5.6-sol") + "\nUSER_APPEND_SENTINEL"])
    expect(output.system[0]).toContain("task_create")
    expect(output.system[0]).not.toContain("todowrite")
  })
})
