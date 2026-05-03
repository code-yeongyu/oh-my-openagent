import { describe, it, expect } from "bun:test"
import { createCerberusAgent, CERBERUS_PROMPT_METADATA } from "./cerberus"

describe("cerberus agent", () => {
  describe("#given createCerberusAgent factory", () => {
    describe("#when called with a model string", () => {
      const config = createCerberusAgent("test-model")

      it("#then returns mode 'all'", () => {
        expect(config.mode).toBe("all")
      })

      it("#then returns correct model", () => {
        expect(config.model).toBe("test-model")
      })

      it("#then returns maxTokens 32000", () => {
        expect(config.maxTokens).toBe(32000)
      })

      it("#then returns crimson red color", () => {
        expect(config.color).toBe("#DC2626")
      })

      it("#then returns thinking config for non-GPT model", () => {
        const typedConfig = config as Record<string, unknown>
        const thinking = typedConfig.thinking as { type: string; budgetTokens: number }
        expect(thinking.type).toBe("enabled")
        expect(thinking.budgetTokens).toBe(16000)
      })

      it("#then returns a description mentioning Cerberus", () => {
        expect(config.description).toContain("Cerberus")
      })

      it("#then denies call_omo_agent in permission", () => {
        const perm = config.permission as Record<string, string>
        expect(perm["call_omo_agent"]).toBe("deny")
      })

      it("#then allows question in permission", () => {
        const perm = config.permission as Record<string, string>
        expect(perm["question"]).toBe("allow")
      })
    })

    describe("#when called with a GPT model string", () => {
      const gptConfig = createCerberusAgent("openai/gpt-5.3-codex")

      it("#then returns reasoningEffort 'medium'", () => {
        expect(gptConfig.reasoningEffort).toBe("medium")
      })

      it("#then does not return thinking config", () => {
        const typedConfig = gptConfig as Record<string, unknown>
        expect(typedConfig.thinking).toBeUndefined()
      })
    })

    describe("#when checking static mode", () => {
      it("#then static mode is 'all'", () => {
        expect(createCerberusAgent.mode).toBe("all")
      })
    })
  })

  describe("#given CERBERUS_PROMPT_METADATA", () => {
    it("#then has specialist category", () => {
      expect(CERBERUS_PROMPT_METADATA.category).toBe("specialist")
    })

    it("#then has EXPENSIVE cost", () => {
      expect(CERBERUS_PROMPT_METADATA.cost).toBe("EXPENSIVE")
    })

    it("#then has non-empty triggers", () => {
      expect(CERBERUS_PROMPT_METADATA.triggers.length).toBeGreaterThanOrEqual(1)
    })

    it("#then avoidWhen references Hephaestus", () => {
      expect(
        CERBERUS_PROMPT_METADATA.avoidWhen?.join(" ").toLowerCase(),
      ).toContain("hephaestus")
    })

    it("#then useWhen references investigation scenarios", () => {
      const joined = CERBERUS_PROMPT_METADATA.useWhen?.join(" ") ?? ""
      expect(joined.toLowerCase()).toMatch(/bug|error|broken|investigation/)
    })

    it("#then has keyTrigger set", () => {
      expect(CERBERUS_PROMPT_METADATA.keyTrigger).toBeTruthy()
      expect(CERBERUS_PROMPT_METADATA.keyTrigger?.toLowerCase()).toContain(
        "cerberus",
      )
    })

    it("#then has promptAlias set to Cerberus", () => {
      expect(CERBERUS_PROMPT_METADATA.promptAlias).toBe("Cerberus")
    })
  })

  describe("#given system prompt", () => {
    const config = createCerberusAgent("test-model")
    const prompt = config.prompt ?? ""

    it("#then contains 8-phase investigation methodology", () => {
      expect(prompt).toContain("GOAL")
      expect(prompt).toContain("INVESTIGATE")
      expect(prompt).toContain("HYPOTHESIZE")
      expect(prompt).toContain("INSTRUMENT")
      expect(prompt).toContain("FIX")
      expect(prompt).toContain("VERIFY")
    })

    it("#then contains user checkpoint phase", () => {
      expect(prompt.toLowerCase()).toMatch(
        /user checkpoint|user.*confirm|ask.*user|still reproducible/i,
      )
    })

    it("#then contains escape hatch with Oracle consultation", () => {
      expect(prompt.toLowerCase()).toMatch(
        /oracle|3.*approach|escape hatch|revert/i,
      )
    })

    it("#then does not reference call_omo_agent", () => {
      expect(prompt).not.toContain("call_omo_agent")
    })

    it("#then uses task() for sub-agent delegation", () => {
      expect(prompt).toContain("task(subagent_type")
    })
  })
})
