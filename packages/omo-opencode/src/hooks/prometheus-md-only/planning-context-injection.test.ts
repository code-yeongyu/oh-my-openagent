import { describe, expect, test } from "bun:test"
import { injectPlanningContextIfMissing } from "./planning-context-injection"
import { PLANNING_CONSULT_WARNING, PLANNING_CONTEXT_OPEN } from "./constants"

describe("injectPlanningContextIfMissing", () => {
  describe("#given prompt without the planning-context marker", () => {
    test("#when injected #then warning is prepended and marker present", () => {
      // given
      const prompt = "Research auth flows in the codebase"

      // when
      const result = injectPlanningContextIfMissing(prompt)

      // then
      expect(result).toBe(PLANNING_CONSULT_WARNING + prompt)
      expect(result).toContain(PLANNING_CONTEXT_OPEN)
    })
  })

  describe("#given prompt that already contains the planning-context marker", () => {
    test("#when injected #then returned unchanged (idempotent)", () => {
      // given
      const prompt = `Research auth flows\n${PLANNING_CONTEXT_OPEN}\nalready guarded`

      // when
      const result = injectPlanningContextIfMissing(prompt)

      // then
      expect(result).toBe(prompt)
    })
  })
})
