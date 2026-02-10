import { describe, expect, it } from "bun:test"
import { adaptLegacyHooksConfig } from "./hooks-config-adapter"

describe("compat-shims/hooks-config-adapter", () => {
  //#given legacy hooks JSON in object format
  //#when adaptLegacyHooksConfig is called
  //#then it maps known legacy hook names into current names
  it("adapts known legacy hook names", () => {
    const raw = JSON.stringify({
      disabled_hooks: ["sisyphus-orchestrator", "anthropic-auto-compact"],
    })

    const result = adaptLegacyHooksConfig(raw)

    expect(result.disabledHooks).toEqual([
      "atlas",
      "anthropic-context-window-limit-recovery",
    ])
    expect(result.warnings).toHaveLength(0)
  })

  //#given legacy hooks JSON with unknown hook names
  //#when adaptLegacyHooksConfig is called
  //#then it returns warnings without throwing
  it("reports unknown hooks as warnings", () => {
    const raw = JSON.stringify({
      disabled_hooks: ["atlas", "unknown-hook-name"],
    })

    const result = adaptLegacyHooksConfig(raw)

    expect(result.disabledHooks).toEqual(["atlas"])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("unknown-hook-name")
  })

  //#given malformed JSON input
  //#when adaptLegacyHooksConfig is called
  //#then it returns an empty result with warning
  it("handles malformed JSON safely", () => {
    const result = adaptLegacyHooksConfig("not-json")

    expect(result.disabledHooks).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("Invalid hooks.json")
  })
})
