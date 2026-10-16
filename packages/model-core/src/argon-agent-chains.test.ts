import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

// #10180: Argon at high thinking takes the place the previous pro model held in the oracle and momus
// chains. The previous pro rung stays directly after it, because GitHub Copilot is not on the Argon
// rung until code-yeongyu/senpi#3379 verifies its thinking control, and an engine pin without the Argon
// row must still land on the previous rung.

const ARGON_RUNG = { providers: ["google", "google-vertex", "opencode"], model: "gemini-4-argon", variant: "high" }
const PREVIOUS_PRO_RUNG = { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.1-pro", variant: "high" }

describe("Argon in the oracle and momus chains (#10180)", () => {
  test.each(["oracle", "momus"])("#given the %s chain #then Argon high sits directly before the previous pro rung", (agent) => {
    const chain = AGENT_MODEL_REQUIREMENTS[agent]?.fallbackChain ?? []
    const argonIndex = chain.findIndex((entry) => entry.model === "gemini-4-argon")

    expect(argonIndex).toBeGreaterThanOrEqual(0)
    expect(chain[argonIndex]).toEqual(ARGON_RUNG)
    expect(chain[argonIndex + 1]).toEqual(PREVIOUS_PRO_RUNG)
  })

  test("#given every agent chain #when a rung names Argon #then it uses a supported thinking level and never routes through Copilot", () => {
    const argonRungs = Object.values(AGENT_MODEL_REQUIREMENTS).flatMap((requirement) =>
      requirement.fallbackChain.filter((entry) => entry.model === "gemini-4-argon"),
    )

    expect(argonRungs.length).toBe(2)
    for (const rung of argonRungs) {
      expect(["low", "medium", "high"]).toContain(rung.variant ?? "")
      expect(rung.providers).not.toContain("github-copilot")
    }
  })
})
