import { describe, expect, test } from "bun:test"
import { buildDynamicSystemPrompt, resolvePreset } from "@code-yeongyu/senpi/prompt-presets"
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all"
import { createSisyphusAgent } from "./sisyphus"
import { createSisyphusJuniorAgentWithOverrides } from "./sisyphus-junior"
import { createHephaestusAgent, isHephaestusSupportedModel } from "./hephaestus"
import { createAtlasAgent } from "./atlas"
import { createOracleAgent } from "./oracle"
import { createMomusAgent } from "./momus"
import { createMetisAgent } from "./metis"
import { getPrometheusPrompt, PROMETHEUS_SYSTEM_PROMPT } from "./prometheus/system-prompt"
import { buildOpenCodeRoleAppend } from "./opencode-role-append"
import { adaptNativePrompt, nativePromptOptions, reconcileNativeModelPrompts } from "./native-model-prompt"
import { frameNativePrompt } from "./native-prompt-frame"
import { mergeCategories } from "../shared/merge-categories"
import { getCategoryDescription } from "./atlas/prompt-section-builder"

const catalog = getBuiltinProviders().flatMap((providerID) =>
  getBuiltinModels(providerID).map((model) => ({ providerID, model })),
)
const atlasCategories = Object.keys(mergeCategories()).map((name) => ({ name, description: getCategoryDescription(name) }))
const agents = [
  { name: "sisyphus", render: (model: string) => createSisyphusAgent(model).prompt, role: buildOpenCodeRoleAppend("sisyphus") },
  { name: "sisyphus-junior", render: (model: string) => createSisyphusJuniorAgentWithOverrides({ model }).prompt, role: buildOpenCodeRoleAppend("sisyphus-junior") },
  { name: "hephaestus", render: (model: string) => createHephaestusAgent(model).prompt, role: buildOpenCodeRoleAppend("hephaestus"), permits: isHephaestusSupportedModel },
  { name: "atlas", render: (model: string) => createAtlasAgent({ model }).prompt, role: buildOpenCodeRoleAppend("atlas", { categories: atlasCategories }) },
  { name: "prometheus", render: (model: string) => getPrometheusPrompt(model), role: PROMETHEUS_SYSTEM_PROMPT, tools: ["read", "grep", "glob", "bash", "edit", "write", "question", "skill"] },
  { name: "oracle", render: (model: string) => createOracleAgent(model).prompt, role: buildOpenCodeRoleAppend("oracle") },
  { name: "momus", render: (model: string) => createMomusAgent(model).prompt, role: buildOpenCodeRoleAppend("momus") },
  { name: "metis", render: (model: string) => createMetisAgent(model).prompt, role: buildOpenCodeRoleAppend("metis") },
]

describe("Native rendered-content parity (#9851)", () => {
  for (const agent of agents) {
    test(agent.name + " renders Native bytes for every permitted catalog provider/model", () => {
      // Expected content comes from Native's model object, not the plugin's selection or rendered output.
      expect(catalog.length).toBeGreaterThan(0)
      const mismatches: string[] = []
      const initial = agent.render(agent.name === "hephaestus" ? "openai/gpt-5.4" : "anthropic/claude-opus-5-5")
      expect(typeof initial).toBe("string")
      if (typeof initial !== "string") throw new TypeError("Agent prompt must be a string")
      let checked = 0
      for (const { providerID, model } of catalog) {
        const id = providerID + "/" + model.id
        if (agent.permits && !agent.permits(id)) continue
        const options = nativePromptOptions(agent.tools)
        const preset = resolvePreset(model, { promptPreset: "auto" }, options)
        const core = preset?.prompt ?? buildDynamicSystemPrompt(options)
        const identity = "Model: " + JSON.stringify({ provider: model.provider, id: model.id, preset: preset?.name ?? null })
        const framed = frameNativePrompt([adaptNativePrompt(core), identity].join("\n\n"), {
          model: id,
          tools: agent.tools ?? [],
          ...(agent.name === "hephaestus" ? { restriction: "hephaestus" as const } : {}),
        })
        const expected = [framed, agent.role].join("\n\n")
        if (agent.render(id) !== expected) mismatches.push(id)
        const switched = [initial]
        reconcileNativeModelPrompts(switched, id)
        if (switched[0] !== expected) mismatches.push(id + " (runtime switch)")
        checked++
      }
      expect(checked).toBeGreaterThan(0)
      expect(mismatches).toEqual([])
      console.log(agent.name + ": " + checked + " catalog prompts compared")
    })
  }
})
