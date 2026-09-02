import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
} from "./model-requirements"

// OpenCode Go served-model catalog, transcribed from the provider's official
// endpoints table (https://opencode.ai/docs/go/, "Endpoints" section,
// retrieved 2026-08-24). Structural fixture so tests stay offline; refresh
// this set when the provider catalog changes.
const OPENCODE_GO_PROVIDED_MODELS: ReadonlySet<string> = new Set([
  "grok-4.5",
  "gpt-5.6-luna",
  "glm-5.3",
  "glm-5.2",
  "glm-5.1",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "longcat-2.0",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "muse-spark-1.2-contributor",
  "qwen3.8-max",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "hy3",
  "ox-alpha-free",
])

function unservedOpenCodeGoRungs(chain: readonly FallbackEntry[]): FallbackEntry[] {
  return chain.filter(
    (entry) => entry.providers.includes("opencode-go") && !OPENCODE_GO_PROVIDED_MODELS.has(entry.model),
  )
}

describe("opencode-go fallback invariant", () => {
  describe("#given the quick category chain", () => {
    test("#then no rung pairs opencode-go with a model Go does not serve", () => {
      // given
      const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

      // when
      const violations = unservedOpenCodeGoRungs(quick.fallbackChain)

      // then
      expect(violations).toEqual([])
    })

    test("#then the qwen3.6-flash rung does not advertise opencode-go (issue #6685)", () => {
      // given
      const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

      // when
      const qwenRung = quick.fallbackChain.find((entry) => entry.model === "qwen3.6-flash")

      // then
      expect(qwenRung).toBeDefined()
      expect(qwenRung?.providers).not.toContain("opencode-go")
    })
  })

  describe("#given every hardcoded category and agent chain", () => {
    test("#then opencode-go only appears on rungs whose model is in the served catalog", () => {
      // given
      const chains = [
        ...Object.entries(CATEGORY_MODEL_REQUIREMENTS),
        ...Object.entries(AGENT_MODEL_REQUIREMENTS),
      ]

      // when
      const violations = chains.flatMap(([name, requirement]) =>
        unservedOpenCodeGoRungs(requirement.fallbackChain).map((entry) => `${name}:${entry.model}`),
      )

      // then
      expect(violations).toEqual([])
    })
  })
})
