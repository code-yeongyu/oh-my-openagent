import { describe, expect, test } from "bun:test"
import { PROMPT_PRESET_MODEL_CASES } from "@code-yeongyu/senpi/prompt-presets"
import { createAtlasAgent } from "./atlas/agent"
import { getHephaestusPrompt, isHephaestusSupportedModel } from "./hephaestus/agent"
import { reconcileNativeModelPrompts } from "./native-model-prompt"
import { REFUSAL_IS_FINAL_RULE } from "./refusal-rule"
import { createSisyphusAgent } from "./sisyphus-agent-factory"
import { buildSisyphusJuniorPrompt } from "./sisyphus-junior/agent"

// One model per Native preset (senpi's own case table) plus an uncatalogued model for the default core,
// so a new preset is covered without editing this file.
const ROUTES = [
  ...PROMPT_PRESET_MODEL_CASES.map((entry) => ({ model: `${entry.providerID}/${entry.modelID}`, preset: entry.preset })),
  { model: "synthetic/vendor/uncatalogued-model", preset: "default" },
]

const once = (prompt: string | undefined) => (prompt ?? "").split(REFUSAL_IS_FINAL_RULE).length - 1

const agents = [
  { name: "sisyphus", render: (model: string) => createSisyphusAgent(model).prompt },
  { name: "sisyphus-junior", render: (model: string) => buildSisyphusJuniorPrompt(model, false) },
  { name: "sisyphus-junior/tasks", render: (model: string) => buildSisyphusJuniorPrompt(model, true) },
  { name: "atlas", render: (model: string) => createAtlasAgent({ model }).prompt },
  { name: "hephaestus", render: (model: string) => getHephaestusPrompt(model), permits: isHephaestusSupportedModel },
]

describe("every agent prompt route carries the refusal-is-final rule exactly once", () => {
  test("the route table covers more than one preset", () => {
    expect(new Set(ROUTES.map((route) => route.preset)).size).toBeGreaterThan(1)
  })

  for (const agent of agents) {
    test(`${agent.name} carries the rule once on every route and after a runtime model switch`, () => {
      const routes = ROUTES.filter((route) => !agent.permits || agent.permits(route.model))
      expect(routes.length).toBeGreaterThan(0)
      const wrong: string[] = []
      for (const route of routes) {
        const prompt = agent.render(route.model)
        if (once(prompt) !== 1) wrong.push(route.model)
        const target = routes.find((other) => other.preset !== route.preset) ?? route
        const switched = [prompt ?? ""]
        reconcileNativeModelPrompts(switched, target.model)
        if (once(switched[0]) !== 1) wrong.push(`${route.model} -> ${target.model}`)
      }
      expect(wrong).toEqual([])
    })
  }

  test("sisyphus-junior keeps the user's prompt_append after the rule", () => {
    const prompt = buildSisyphusJuniorPrompt("anthropic/claude-sonnet-5", false, "APPENDED_BY_THE_USER")
    expect(once(prompt)).toBe(1)
    expect(prompt.endsWith("APPENDED_BY_THE_USER")).toBe(true)
    expect(prompt.indexOf(REFUSAL_IS_FINAL_RULE)).toBeLessThan(prompt.indexOf("APPENDED_BY_THE_USER"))
  })
})
