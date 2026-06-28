/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { buildAgentIdentitySection } from "./dynamic-agent-core-sections"
import { createSisyphusAgent } from "./sisyphus"
import { createHephaestusAgent } from "./hephaestus"
import { mergeAgentConfig } from "./builtin-agents/agent-overrides"

describe("buildAgentIdentitySection", () => {
  describe("#given an agent name and role description", () => {
    describe("#when building the identity section", () => {
      it("#then includes the agent name prominently", () => {
        const result = buildAgentIdentitySection("Sisyphus", "Powerful AI orchestrator from OhMyOpenCode")

        expect(result).toContain("Sisyphus")
      })

      it("#then includes the role description", () => {
        const result = buildAgentIdentitySection("Sisyphus", "Powerful AI orchestrator from OhMyOpenCode")

        expect(result).toContain("Powerful AI orchestrator from OhMyOpenCode")
      })

      it("#then wraps content in an identity XML tag", () => {
        const result = buildAgentIdentitySection("Hephaestus", "Autonomous deep worker")

        expect(result).toContain("<agent-identity>")
        expect(result).toContain("</agent-identity>")
      })

      it("#then explicitly states this identity overrides any prior identity", () => {
        const result = buildAgentIdentitySection("Sisyphus", "Powerful AI orchestrator from OhMyOpenCode")

        expect(result).toMatch(/override|supersede|replace|disregard|instead of/i)
      })
    })
  })

  describe("#given different agent names", () => {
    describe("#when building identity for each", () => {
      it("#then each identity section contains the correct agent name", () => {
        const sisyphus = buildAgentIdentitySection("Sisyphus", "AI orchestrator")
        const hephaestus = buildAgentIdentitySection("Hephaestus", "Autonomous deep worker")
        const oracle = buildAgentIdentitySection("Oracle", "Strategic advisor")

        expect(sisyphus).toContain("Sisyphus")
        expect(sisyphus).not.toContain("Hephaestus")
        expect(hephaestus).toContain("Hephaestus")
        expect(hephaestus).not.toContain("Sisyphus")
        expect(oracle).toContain("Oracle")
      })
    })
  })
})

describe("Sisyphus prompt identity", () => {
  describe("#given a Sisyphus agent created with default model", () => {
    describe("#when checking the prompt", () => {
      it("#then contains the agent identity section with override directive", () => {
        const config = createSisyphusAgent("anthropic/claude-opus-4-7")

        expect(config.prompt).toContain("<agent-identity>")
        expect(config.prompt).toContain("Sisyphus")
        expect(config.prompt).toContain("</agent-identity>")
      })

      it("#then identity section appears before the Role section", () => {
        const config = createSisyphusAgent("anthropic/claude-opus-4-7")
        const prompt = config.prompt ?? ""
        const identityIndex = prompt.indexOf("<agent-identity>")
        const roleIndex = prompt.indexOf("<Role>")

        expect(identityIndex).toBeGreaterThanOrEqual(0)
        expect(roleIndex).toBeGreaterThan(identityIndex)
      })
    })
  })

  describe("#given a Sisyphus agent created with GPT-5.4 model", () => {
    describe("#when checking the prompt", () => {
      it("#then contains the agent identity section", () => {
        const config = createSisyphusAgent("openai/gpt-5.4")

        expect(config.prompt).toContain("<agent-identity>")
        expect(config.prompt).toContain("Sisyphus")
        expect(config.prompt).toContain("</agent-identity>")
      })
    })
  })
})

describe("Hephaestus prompt identity", () => {
  describe("#given a Hephaestus agent created with GPT model", () => {
    describe("#when checking the prompt", () => {
      it("#then contains the agent identity section", () => {
        const config = createHephaestusAgent("openai/gpt-5.4")

        expect(config.prompt).toContain("<agent-identity>")
        expect(config.prompt).toContain("Hephaestus")
        expect(config.prompt).toContain("</agent-identity>")
      })

      it("#then identity section appears at the start of the prompt", () => {
        const config = createHephaestusAgent("openai/gpt-5.4")
        const prompt = config.prompt ?? ""
        const identityIndex = prompt.indexOf("<agent-identity>")

        expect(identityIndex).toBe(0)
      })
    })
  })
})

describe("Agent identity preservation through overrides", () => {
  describe("#given a Sisyphus agent with prompt_append override", () => {
    describe("#when merging the override", () => {
      it("#then identity section is preserved in the merged prompt", () => {
        const baseConfig = createSisyphusAgent("anthropic/claude-opus-4-7")
        const merged = mergeAgentConfig(baseConfig, { prompt_append: "Extra instructions here" })

        expect(merged.prompt).toContain("<agent-identity>")
        expect(merged.prompt).toContain("Sisyphus")
        expect(merged.prompt).toContain("</agent-identity>")
        expect(merged.prompt).toContain("Extra instructions here")
      })
    })
  })

  describe("#given a Sisyphus agent with model override only", () => {
    describe("#when merging the override", () => {
      it("#then identity section is preserved unchanged", () => {
        const baseConfig = createSisyphusAgent("anthropic/claude-opus-4-7")
        const merged = mergeAgentConfig(baseConfig, { model: "openai/gpt-5.4" })

        expect(merged.prompt).toContain("<agent-identity>")
        expect(merged.prompt).toContain("Sisyphus")
        expect(merged.prompt).toContain("</agent-identity>")
      })
    })
  })
})
describe("mergeAgentConfig providerOptions → options translation", () => {
  describe("#given a Sisyphus agent with providerOptions in the override", () => {
    describe("#when merging the override", () => {
      it("#then providerOptions contents appear in options", () => {
        const baseConfig = createSisyphusAgent("anthropic/claude-opus-4-7")
        const merged = mergeAgentConfig(baseConfig, {
          providerOptions: { thinking_token_budget: 4096 },
        })

        expect((merged.options as Record<string, unknown>)?.thinking_token_budget).toBe(4096)
      })

      it("#then providerOptions key is removed from the merged config", () => {
        const baseConfig = createSisyphusAgent("anthropic/claude-opus-4-7")
        const merged = mergeAgentConfig(baseConfig, {
          providerOptions: { thinking_token_budget: 2048 },
        })

        expect(merged.providerOptions).toBeUndefined()
      })

      it("#then existing options are preserved when providerOptions is merged", () => {
        const baseConfig = {
          ...createSisyphusAgent("anthropic/claude-opus-4-7"),
          options: { existing_key: "keep_me" } as unknown,
        }
        const merged = mergeAgentConfig(
          baseConfig as import("@opencode-ai/sdk").AgentConfig,
          { providerOptions: { new_key: "added" } },
        )

        const opts = merged.options as Record<string, unknown>
        expect(opts.existing_key).toBe("keep_me")
        expect(opts.new_key).toBe("added")
      })

      it("#then providerOptions overrides existing options on key collision", () => {
        const baseConfig = {
          ...createSisyphusAgent("anthropic/claude-opus-4-7"),
          options: { shared_key: "old_value" } as unknown,
        }
        const merged = mergeAgentConfig(
          baseConfig as import("@opencode-ai/sdk").AgentConfig,
          { providerOptions: { shared_key: "new_value" } },
        )

        const opts = merged.options as Record<string, unknown>
        expect(opts.shared_key).toBe("new_value")
      })

      it("#then no translation occurs when providerOptions is absent", () => {
        const baseConfig = createSisyphusAgent("anthropic/claude-opus-4-7")
        const merged = mergeAgentConfig(baseConfig, { model: "openai/gpt-5.4" })

        expect(merged.providerOptions).toBeUndefined()
        expect(merged.options).toBeUndefined()
      })
    })
  })

  describe("#given a Hephaestus agent with nested providerOptions", () => {
    describe("#when merging the override", () => {
      it("#then nested object providerOptions is merged into options", () => {
        const baseConfig = createHephaestusAgent("openai/gpt-5.4")
        const merged = mergeAgentConfig(baseConfig, {
          providerOptions: { chat_template_kwargs: { enable_thinking: false } },
        })

        const opts = merged.options as Record<string, unknown>
        expect(opts.chat_template_kwargs).toEqual({ enable_thinking: false })
        expect(merged.providerOptions).toBeUndefined()
      })
    })
  })
})
