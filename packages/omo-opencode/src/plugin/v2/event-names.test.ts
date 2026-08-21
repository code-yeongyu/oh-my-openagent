import { describe, expect, test } from "bun:test"
import { V1_TO_V2_EVENT_NAMES, v1EventNamesForV2Type, v2EventMatchesV1Name } from "./event-names"

describe("event-names", () => {
  describe("#given the v1 to v2 mapping table", () => {
    test("maps session.idle onto idle and successful execution", () => {
      expect(V1_TO_V2_EVENT_NAMES["session.idle"]).toEqual([
        "session.idle",
        "session.execution.succeeded",
      ])
    })

    test("maps session.error onto failed execution and failed step", () => {
      expect(V1_TO_V2_EVENT_NAMES["session.error"]).toEqual([
        "session.execution.failed",
        "session.step.failed",
      ])
    })

    test("keeps identity mappings for shared lifecycle names", () => {
      expect(V1_TO_V2_EVENT_NAMES["session.created"]).toEqual(["session.created"])
      expect(V1_TO_V2_EVENT_NAMES["session.deleted"]).toEqual(["session.deleted"])
    })
  })

  describe("#v2EventMatchesV1Name", () => {
    test("matches mapped aliases", () => {
      expect(v2EventMatchesV1Name("session.execution.succeeded", "session.idle")).toBe(true)
      expect(v2EventMatchesV1Name("session.step.failed", "session.error")).toBe(true)
    })

    test("matches identity names", () => {
      expect(v2EventMatchesV1Name("session.created", "session.created")).toBe(true)
    })

    test("rejects unrelated pairs", () => {
      expect(v2EventMatchesV1Name("session.tool.called", "session.idle")).toBe(false)
      expect(v2EventMatchesV1Name("session.text.delta", "session.error")).toBe(false)
    })

    test("passes through identical unknown names", () => {
      expect(v2EventMatchesV1Name("session.future.thing", "session.future.thing")).toBe(true)
    })
  })

  describe("#v1EventNamesForV2Type", () => {
    test("reverse-maps execution success to session.idle", () => {
      expect(v1EventNamesForV2Type("session.execution.succeeded")).toEqual(["session.idle"])
    })

    test("reverse-maps failure aliases to session.error", () => {
      const names = v1EventNamesForV2Type("session.execution.failed")
      expect(names).toContain("session.error")
      expect(v1EventNamesForV2Type("session.step.failed")).toContain("session.error")
    })

    test("returns identity for shared lifecycle names", () => {
      expect(v1EventNamesForV2Type("session.created")).toEqual(["session.created"])
    })

    test("returns empty array for unknown types", () => {
      expect(v1EventNamesForV2Type("session.totally.unknown")).toEqual([])
    })
  })
})
