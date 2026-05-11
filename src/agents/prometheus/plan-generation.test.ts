import { describe, it, expect } from "bun:test"
import { PROMETHEUS_PLAN_GENERATION } from "./plan-generation"

describe("PROMETHEUS_PLAN_GENERATION oracle phase gates", () => {
  describe("#given Prometheus plan generation prompt", () => {
    describe("#when inspecting the registered todo list", () => {
      it("#then includes plan-1b oracle verification after Metis", () => {
        expect(PROMETHEUS_PLAN_GENERATION).toContain(`id: "plan-1b"`)
        expect(PROMETHEUS_PLAN_GENERATION).toMatch(/plan-1b[^\n]*Oracle verification/i)
      })

      it("#then includes plan-2b oracle verification after plan generation", () => {
        expect(PROMETHEUS_PLAN_GENERATION).toContain(`id: "plan-2b"`)
        expect(PROMETHEUS_PLAN_GENERATION).toMatch(/plan-2b[^\n]*Oracle verification/i)
      })

      it("#then includes plan-6b oracle verification before handoff", () => {
        expect(PROMETHEUS_PLAN_GENERATION).toContain(`id: "plan-6b"`)
        expect(PROMETHEUS_PLAN_GENERATION).toMatch(/plan-6b[^\n]*Oracle verification/i)
      })

      it("#then preserves the existing plan-1 through plan-8 todos", () => {
        for (const id of ["plan-1", "plan-2", "plan-3", "plan-4", "plan-5", "plan-6", "plan-7", "plan-8"]) {
          expect(PROMETHEUS_PLAN_GENERATION, `${id} todo must remain`).toContain(`id: "${id}"`)
        }
      })
    })

    describe("#when describing oracle invocations", () => {
      it("#then provides concrete task() calls for all three phase gates", () => {
        const oracleInvocations = PROMETHEUS_PLAN_GENERATION.match(/subagent_type="oracle"/g) ?? []
        expect(oracleInvocations.length).toBeGreaterThanOrEqual(3)
      })

      it("#then names a dedicated Oracle Verification section", () => {
        expect(PROMETHEUS_PLAN_GENERATION).toContain("Oracle Verification (Phase Gates)")
      })

      it("#then declares each gate is blocking with GO/NO-GO verdict format", () => {
        expect(PROMETHEUS_PLAN_GENERATION).toContain("VERDICT: GO/NO-GO")
        expect(PROMETHEUS_PLAN_GENERATION.toLowerCase()).toContain("blocking")
      })

      it("#then forbids skipping the gate on NO-GO", () => {
        const lower = PROMETHEUS_PLAN_GENERATION.toLowerCase()
        expect(lower).toMatch(/no-go is not an excuse to skip|fix the cited issues/)
      })
    })

    describe("#when describing the updated workflow", () => {
      it("#then orders the gates after their respective phases", () => {
        const idxPlan1b = PROMETHEUS_PLAN_GENERATION.indexOf(`id: "plan-1b"`)
        const idxPlan2 = PROMETHEUS_PLAN_GENERATION.indexOf(`id: "plan-2"`)
        const idxPlan2b = PROMETHEUS_PLAN_GENERATION.indexOf(`id: "plan-2b"`)
        const idxPlan6 = PROMETHEUS_PLAN_GENERATION.indexOf(`id: "plan-6"`)
        const idxPlan6b = PROMETHEUS_PLAN_GENERATION.indexOf(`id: "plan-6b"`)

        expect(idxPlan1b, "plan-1b must precede plan-2 (gate runs before next phase)").toBeLessThan(idxPlan2)
        expect(idxPlan2b, "plan-2b must follow plan-2").toBeGreaterThan(idxPlan2)
        expect(idxPlan6b, "plan-6b must follow plan-6").toBeGreaterThan(idxPlan6)
      })
    })
  })
})
