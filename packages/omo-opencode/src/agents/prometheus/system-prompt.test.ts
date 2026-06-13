import { describe, it, expect } from "bun:test"
import { getPrometheusPrompt, getPrometheusPromptSource } from "./system-prompt"

describe("getPrometheusPrompt", () => {
  describe("#given question tool is not disabled", () => {
    describe("#when generating prompt", () => {
      it("#then should include Question tool references", () => {
        const prompt = getPrometheusPrompt(undefined, [])

        expect(prompt).toContain("Question({")
      })
    })
  })

  describe("#given question tool is disabled via disabled_tools", () => {
    describe("#when generating prompt", () => {
      it("#then should strip Question tool code examples", () => {
        const prompt = getPrometheusPrompt(undefined, ["question"])

        expect(prompt).not.toContain("Question({")
      })
    })

    describe("#when disabled_tools includes question among other tools", () => {
      it("#then should strip Question tool code examples", () => {
        const prompt = getPrometheusPrompt(undefined, ["todowrite", "question", "interactive_bash"])

        expect(prompt).not.toContain("Question({")
      })
    })
  })

  describe("#given no disabled_tools provided", () => {
    describe("#when generating prompt with undefined", () => {
      it("#then should include Question tool references", () => {
        const prompt = getPrometheusPrompt(undefined, undefined)

        expect(prompt).toContain("Question({")
      })
    })
  })
})

describe("getPrometheusPromptSource Claude per-model routing", () => {
  describe("#given Claude Opus and Fable model ids", () => {
    describe("#when resolving the prompt source", () => {
      it("#then should route each Claude model to its own variant", () => {
        expect(getPrometheusPromptSource("anthropic/claude-opus-4-6")).toBe("claude-opus-4-6")
        expect(getPrometheusPromptSource("anthropic/claude-opus-4-7")).toBe("claude-opus-4-7")
        expect(getPrometheusPromptSource("anthropic/claude-opus-4.8")).toBe("claude-opus-4-8")
        expect(getPrometheusPromptSource("anthropic/claude-fable-5")).toBe("claude-fable-5")
      })

      it("#then should route the [1m] context-window suffix to the same variant", () => {
        expect(getPrometheusPromptSource("anthropic/claude-fable-5[1m]")).toBe("claude-fable-5")
      })
    })
  })

  describe("#given non-Claude-Opus or unknown model ids", () => {
    describe("#when resolving the prompt source", () => {
      it("#then should keep prior routing untouched", () => {
        expect(getPrometheusPromptSource(undefined)).toBe("default")
        expect(getPrometheusPromptSource("anthropic/claude-sonnet-4-6")).toBe("default")
        expect(getPrometheusPromptSource("gpt-5.5")).toBe("gpt")
        expect(getPrometheusPromptSource("gemini-3.1-pro")).toBe("gemini")
      })
    })
  })

  describe("#given Kimi K2.7 vs generic Kimi model ids", () => {
    describe("#when resolving the prompt source", () => {
      it("#then should route K2.7 to its own variant while generic Kimi stays default", () => {
        expect(getPrometheusPromptSource("opencode-go/kimi-k2.7")).toBe("kimi-k2-7")
        expect(getPrometheusPromptSource("kimi-for-coding/k2p7")).toBe("kimi-k2-7")
        expect(getPrometheusPromptSource("opencode-go/kimi-k2.6")).toBe("default")
        expect(getPrometheusPromptSource("moonshotai/kimi-k2.5")).toBe("default")
      })

      it("#then the K2.7 prompt carries a restrained outcome-first self_knowledge block", () => {
        const prompt = getPrometheusPrompt("opencode-go/kimi-k2.7", [])

        expect(prompt).toContain("<self_knowledge>")
        expect(prompt).toContain("Kimi K2.7")
      })
    })
  })
})

describe("getPrometheusPrompt Claude per-model tuning blocks", () => {
  describe("#given a Claude model with a dedicated variant", () => {
    describe("#when generating prompt", () => {
      it("#then should include a self_knowledge block naming that model id", () => {
        const cases: ReadonlyArray<readonly [string, string]> = [
          ["anthropic/claude-opus-4-6", "claude-opus-4-6"],
          ["anthropic/claude-opus-4-7", "claude-opus-4-7"],
          ["anthropic/claude-opus-4-8", "claude-opus-4-8"],
          ["anthropic/claude-fable-5", "claude-fable-5"],
        ]

        for (const [model, expectedId] of cases) {
          const prompt = getPrometheusPrompt(model, [])

          expect(prompt).toContain("<self_knowledge>")
          expect(prompt).toContain(`\`${expectedId}\``)
        }
      })
    })
  })

  describe("#given the Claude Fable 5 model", () => {
    describe("#when generating prompt", () => {
      it("#then should mandate delegated discovery with a wider subagent fan-out", () => {
        const prompt = getPrometheusPrompt("anthropic/claude-fable-5", [])

        expect(prompt).toContain("DELEGATED DISCOVERY MANDATE")
        expect(prompt).toContain("WIDE FAN-OUT BY DEFAULT")
      })

      it("#then should keep the delegated-discovery mandate exclusive to Fable", () => {
        for (const model of [
          "anthropic/claude-opus-4-6",
          "anthropic/claude-opus-4-7",
          "anthropic/claude-opus-4-8",
        ]) {
          const prompt = getPrometheusPrompt(model, [])

          expect(prompt).not.toContain("DELEGATED DISCOVERY MANDATE")
        }
      })
    })
  })

  describe("#given a model without a dedicated Claude variant", () => {
    describe("#when generating prompt", () => {
      it("#then should not include any self_knowledge tuning block", () => {
        expect(getPrometheusPrompt(undefined, [])).not.toContain("<self_knowledge>")
        expect(getPrometheusPrompt("anthropic/claude-sonnet-4-6", [])).not.toContain(
          "<self_knowledge>"
        )
      })
    })
  })
})
