import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { acknowledgedResidentContinuation, generationAcrossContinuations } from "./__fixtures__/resident-continuation"
import { coldReviveHarness } from "./__fixtures__/cold-revive-harness"

afterEach(cleanupProjects)

describe("resident continuation safety", () => {
  for (const status of ["completed", "interrupted", "error"] as const) {
    test(`#given an acknowledged batch with failed bookkeeping #when ${status}/resident receives a distinct send #then uncertainty prevents replay until resolution`, async () => {
      await acknowledgedResidentContinuation(status)
    })
  }
  for (const generation of [undefined, 1]) {
    test(`#given ${generation ?? "unknown"} recorded generation #when cold, warm, and parked-cold sends continue #then provenance never migrates`, async () => {
      await generationAcrossContinuations(generation)
    })
  }
  test("#given a legacy resumed child #when interrupted with partial output #then continuation bookkeeping preserves unknown provenance", async () => {
    const h = coldReviveHarness({ resume: async (_spec, _path, handle) => ({ ...handle, lastAssistantText: () => "PARTIAL" }) })
    try {
      expect((await h.send()).kind).toBe("revived")
      expect((await h.manager.interruptTask(h.record.task_id)).kind).toBe("interrupted")
      expect(h.store.load(h.record.task_id)?.final_response).toBe("PARTIAL")
      expect(h.store.load(h.record.task_id)?.config_generation).toBeUndefined()
    } finally { await h.dispose() }
  })
})
