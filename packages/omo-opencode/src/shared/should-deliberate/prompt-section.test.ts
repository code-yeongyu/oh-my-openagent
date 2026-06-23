import { describe, test, expect } from "bun:test"

import { buildThemisRoutingSection } from "./prompt-section"

describe("buildThemisRoutingSection", () => {
  describe("#given enabled=false", () => {
    test("#when called #then returns empty string", () => {
      expect(buildThemisRoutingSection(false)).toBe("")
    })
  })

  describe("#given enabled=true", () => {
    const section = buildThemisRoutingSection(true)

    test("#when called #then mentions Themis", () => {
      expect(section).toContain("Themis")
    })

    test("#when called #then documents competing-options signal", () => {
      expect(section).toMatch(/competing.options/i)
    })

    test("#when called #then documents conflicting-constraints signal", () => {
      expect(section).toMatch(/conflicting.constraints/i)
    })

    test("#when called #then documents ethical-safety-risk signal", () => {
      expect(section).toMatch(/ethical|safety|risk/i)
    })

    test("#when called #then mentions both /deliberate and task() routes", () => {
      expect(section).toContain("/deliberate")
      expect(section).toMatch(/subagent_type="themis"|subagent_type='themis'/)
    })

    test("#when called #then documents the opt-out mechanism", () => {
      expect(section).toContain("themisAutoTrigger")
    })

    test("#when called #then is non-trivial in length", () => {
      expect(section.length).toBeGreaterThan(200)
    })
  })
})
