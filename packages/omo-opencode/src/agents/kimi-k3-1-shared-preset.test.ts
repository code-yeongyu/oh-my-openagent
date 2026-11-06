import { describe, expect, test } from "bun:test"
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all"
import { createSisyphusAgent } from "./sisyphus"
import { createSisyphusJuniorAgentWithOverrides } from "./sisyphus-junior"
import { createAtlasAgent } from "./atlas"
import { getNativePromptSource } from "./native-model-prompt"

// Default prompt-routing contract (#11196): every Kimi K3.1 spelling selects Native's kimi-k3-1 preset, not K3's.
const K3_1 = /k3[.-]1|k3p1/i
const catalogK31 = getBuiltinProviders().flatMap((providerID) =>
  getBuiltinModels(providerID).filter((model) => K3_1.test(model.id)).map((model) => `${providerID}/${model.id}`),
)
const models: string[] = [...new Set([...catalogK31, "kimi-coding/k3p1", "moonshotai/kimi-k3.1-pro"])]
const agents = [
  { name: "sisyphus", render: (model: string) => createSisyphusAgent(model).prompt },
  { name: "sisyphus-junior", render: (model: string) => createSisyphusJuniorAgentWithOverrides({ model }).prompt },
  { name: "atlas", render: (model: string) => createAtlasAgent({ model }).prompt },
]

function renderedPreset(prompt: string | undefined): unknown {
  const line = (prompt ?? "").split("\n").find((entry) => entry.startsWith("Model: "))
  return line === undefined ? undefined : JSON.parse(line.slice("Model: ".length)).preset
}

describe("Kimi K3.1 selects the shared Native preset", () => {
  test("the pinned catalog lists Kimi K3.1 models", () => {
    expect(catalogK31.length).toBeGreaterThan(0)
  })

  test.each(models)("%s resolves to the kimi-k3-1 preset", (model: string) => {
    expect(getNativePromptSource(model)).toBe("kimi-k3-1")
  })

  for (const agent of agents) {
    test(`${agent.name} renders the kimi-k3-1 preset for every K3.1 model`, () => {
      const wrong = models.filter((model) => renderedPreset(agent.render(model)) !== "kimi-k3-1")
      expect(wrong).toEqual([])
    })
  }
})
