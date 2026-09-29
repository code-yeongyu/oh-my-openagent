import { describe, expect, it } from "bun:test"
import { unsupportedEnabledSystems } from "./v2-gaps"

describe("v2 gaps", () => {
  it("stays silent when gated systems are off", () => {
    // given default (all-off) config
    // when checked
    // then nothing to warn about
    expect(unsupportedEnabledSystems({})).toEqual([])
    expect(unsupportedEnabledSystems({ team_mode: { enabled: false } })).toEqual([])
  })

  it("names each enabled-but-unported system", () => {
    // given systems the v2 port cannot implement yet
    const warnings = unsupportedEnabledSystems({
      team_mode: { enabled: true },
      monitor: { enabled: true },
      goal: { enabled: true },
      openclaw: {},
    })

    // when checked
    // then each is reported
    expect(warnings.length).toBe(4)
    expect(warnings.join(" ")).toContain("team_mode")
    expect(warnings.join(" ")).toContain("monitor")
    expect(warnings.join(" ")).toContain("goal")
    expect(warnings.join(" ")).toContain("openclaw")
  })
})
