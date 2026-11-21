import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { buildDynamicSystemPrompt, resolvePreset } from "@code-yeongyu/senpi/prompt-presets"
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all"
import { createSisyphusAgent } from "./sisyphus"
import { createSisyphusJuniorAgentWithOverrides } from "./sisyphus-junior"
import { createHephaestusAgent, isHephaestusSupportedModel } from "./hephaestus"
import { createAtlasAgent } from "./atlas"
import { createOracleAgent } from "./oracle"
import { createMomusAgent } from "./momus"
import { createMetisAgent } from "./metis"
import { getPrometheusPrompt } from "./prometheus/system-prompt"
import { adaptNativePrompt, reconcileNativeModelPrompts } from "./native-model-prompt"
import { frameNativePrompt } from "./native-prompt-frame"
import { REFUSAL_IS_FINAL_RULE } from "./refusal-rule"
import { createGrepTools } from "../tools/grep/tools"
import { createGlobTools } from "../tools/glob/tools"

const toolContext = { directory: "/workspace" } as PluginInput
const toolDefinitions = { ...createGrepTools(toolContext), ...createGlobTools(toolContext) }
const toolSnippets = Object.fromEntries(Object.entries(toolDefinitions).map(([name, tool]) => [name, tool.description]))
const toolNames = Object.keys(toolDefinitions)
const catalog = getBuiltinProviders().flatMap((providerID) =>
  getBuiltinModels(providerID).map((model) => ({ providerID, model })),
)
const agents = [
  {
    name: "sisyphus",
    render: (model: string) => createSisyphusAgent(model, undefined, toolNames).prompt,
    refusalRule: true,
  },
  {
    name: "sisyphus-junior",
    render: (model: string) => createSisyphusJuniorAgentWithOverrides({ model }).prompt,
    refusalRule: true,
  },
  {
    name: "hephaestus",
    render: (model: string) => createHephaestusAgent(model, undefined, toolNames).prompt,
    permits: isHephaestusSupportedModel,
    refusalRule: true,
  },
  { name: "atlas", render: (model: string) => createAtlasAgent({ model }).prompt, refusalRule: true },
  { name: "prometheus", render: (model: string) => getPrometheusPrompt(model) },
  { name: "oracle", render: (model: string) => createOracleAgent(model).prompt },
  { name: "momus", render: (model: string) => createMomusAgent(model).prompt },
  { name: "metis", render: (model: string) => createMetisAgent(model).prompt },
  {
    name: "sisyphus/tasks",
    render: (model: string) => createSisyphusAgent(model, [], toolNames, [], [], true).prompt,
    useTaskSystem: true,
    refusalRule: true,
  },
  {
    name: "sisyphus-junior/tasks",
    render: (model: string) => createSisyphusJuniorAgentWithOverrides({ model }, undefined, true).prompt,
    useTaskSystem: true,
    refusalRule: true,
  },
  {
    name: "hephaestus/tasks",
    render: (model: string) => createHephaestusAgent(model, [], toolNames, [], [], true).prompt,
    permits: isHephaestusSupportedModel,
    useTaskSystem: true,
    refusalRule: true,
  },
]

function registerTools(prompt: string | undefined): string {
  if (prompt === undefined) throw new TypeError("Agent prompt must be a string")
  const system = [prompt]
  reconcileNativeModelPrompts(system, undefined, toolSnippets)
  return system[0]
}

describe("Native rendered-content parity (#9851)", () => {
  for (const agent of agents) {
    test(
      agent.name + " renders Native bytes with real registered tools for every permitted catalog model",
      () => {
        expect(catalog.length).toBeGreaterThan(0)
        const mismatches: string[] = []
        const initial = registerTools(agent.render(agent.permits ? "openai/gpt-5.4" : "anthropic/claude-opus-5-5"))
        expect(initial).toContain("- grep: " + toolDefinitions.grep.description)
        expect(initial).toContain("- glob: " + toolDefinitions.glob.description)
        const initialRole = initial.slice(initial.indexOf("\n</omo-model-core>") + "\n</omo-model-core>".length)
        let checked = 0
        for (const { providerID, model } of catalog) {
          const id = providerID + "/" + model.id
          if (agent.permits && !agent.permits(id)) continue
          // Independent Native inputs: never derive the oracle's snippets from the adapter under test.
          const options = {
            cwd: "",
            selectedTools: toolNames,
            toolSnippets,
            promptGuidelines: [],
            contextFiles: [],
            skills: [],
            surface: "terminal" as const,
            appName: "OmO",
          }
          const preset = resolvePreset(model, { promptPreset: "auto" }, options)
          const core = preset?.prompt ?? buildDynamicSystemPrompt(options)
          const identity =
            "Model: " + JSON.stringify({ provider: model.provider, id: model.id, preset: preset?.name ?? null })
          const body = [
            adaptNativePrompt(core, agent.useTaskSystem),
            // An agent that carries the refusal rule has it stated once in the frame: by the core, or right after it.
            ...(agent.refusalRule && !core.includes(REFUSAL_IS_FINAL_RULE) ? [REFUSAL_IS_FINAL_RULE] : []),
            identity,
          ].join("\n\n")
          // The Hephaestus role rides in the frame context, and a GPT-6.2 preset is rendered without it (#14186).
          const standalone = agent.permits !== undefined && preset?.name === "gpt-6.2"
          const framed = frameNativePrompt(body, {
            model: id,
            tools: toolNames,
            toolSnippets,
            ...(agent.permits ? { restriction: "hephaestus" as const } : {}),
            ...(agent.useTaskSystem ? { useTaskSystem: true } : {}),
            ...(agent.refusalRule ? { refusalRule: true as const } : {}),
            ...(agent.permits ? { role: initialRole.slice("\n\n".length) } : {}),
            ...(standalone ? { standalone: true as const } : {}),
          })
          const rendered = registerTools(agent.render(id))
          const role = rendered.slice(framed.length)
          if (rendered.slice(0, framed.length) !== framed || (role.trim().length === 0) !== standalone)
            mismatches.push(id)
          const switched = [initial]
          reconcileNativeModelPrompts(switched, id)
          if (switched[0] !== framed + (standalone ? "" : initialRole)) mismatches.push(id + " (runtime switch)")
          checked++
        }
        expect(checked).toBeGreaterThan(0)
        expect(mismatches).toEqual([])
        console.log(agent.name + ": " + checked + " catalog prompts compared with real tools")
      },
      120_000,
    )
  }
})
