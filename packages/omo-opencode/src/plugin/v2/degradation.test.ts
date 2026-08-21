import { describe, expect, test } from "bun:test"
import { V2_DEGRADATION_LEDGER, doctorSummary, isDegradedOnV2, listDegradations } from "./degradation"

describe("degradation", () => {
  describe("#given the seeded ledger", () => {
    test("contains every surface with no v2 equivalent", () => {
      // given
      const features = V2_DEGRADATION_LEDGER.map((entry) => entry.feature)
      // then
      expect(features).toContain("chat.message first-message variant gate")
      expect(features).toContain("IntentGate keyword detection")
      expect(features).toContain("command.execute.before slash interception")
      expect(features).toContain("compaction context injection")
      expect(features).toContain("compaction autocontinue")
    })

    test("records tool.definition override as ported", () => {
      // given
      const entry = V2_DEGRADATION_LEDGER.find(
        (candidate) => candidate.feature === "tool.definition dynamic override",
      )
      // then
      expect(entry).toBeDefined()
      expect(entry?.status).toBe("ported")
    })

    test("records chat.params tuning as degraded", () => {
      // given
      const entry = V2_DEGRADATION_LEDGER.find((candidate) => candidate.feature === "chat.params model tuning")
      // then
      expect(entry).toBeDefined()
      expect(entry?.status).toBe("degraded")
    })

    test("every entry carries a v1 surface, reason, and user impact", () => {
      // then
      for (const entry of V2_DEGRADATION_LEDGER) {
        expect(entry.v1Surface.length).toBeGreaterThan(0)
        expect(entry.reason.length).toBeGreaterThan(0)
        expect(entry.userImpact.length).toBeGreaterThan(0)
      }
    })

    test("statuses stay inside the allowed set", () => {
      // given
      const allowed = new Set(["ported", "degraded", "unavailable"])
      // then
      for (const entry of V2_DEGRADATION_LEDGER) {
        expect(allowed.has(entry.status)).toBe(true)
      }
    })
  })

  describe("#listDegradations", () => {
    test("returns the full ledger", () => {
      expect(listDegradations()).toEqual(V2_DEGRADATION_LEDGER)
    })
  })

  describe("#isDegradedOnV2", () => {
    test("is true for degraded entries", () => {
      expect(isDegradedOnV2("chat.message first-message variant gate")).toBe(true)
    })

    test("is true for unavailable entries", () => {
      expect(isDegradedOnV2("compaction autocontinue")).toBe(true)
    })

    test("is false for ported entries", () => {
      expect(isDegradedOnV2("tool.definition dynamic override")).toBe(false)
    })

    test("is false for unknown features", () => {
      expect(isDegradedOnV2("nonexistent feature")).toBe(false)
    })
  })

  describe("#doctorSummary", () => {
    test("emits one line per ledger entry", () => {
      // given
      const lines = doctorSummary()
      // then
      expect(lines).toHaveLength(V2_DEGRADATION_LEDGER.length)
    })

    test("each line names the feature and its status", () => {
      // given
      const lines = doctorSummary()
      // then
      for (const line of lines) {
        expect(line.includes("[ported]") || line.includes("[degraded]") || line.includes("[unavailable]")).toBe(true)
      }
      expect(lines.some((line) => line.includes("chat.message first-message variant gate"))).toBe(true)
    })
  })
})
