import { describe, expect, it } from "bun:test"
import {
  RecallCorpusCache,
  RecallLedger,
  loadRecallCorpus,
  planRecallQueries,
  renderNudgeMessage,
  sanitizeSessionFilename,
  selectRecallCandidates,
} from "../index"

describe("recall package surface", () => {
  it("#given the package barrel #when the recall surface is imported #then every live recall unit is exported", () => {
    // given / when / then
    expect(typeof loadRecallCorpus).toBe("function")
    expect(typeof RecallCorpusCache).toBe("function")
    expect(typeof planRecallQueries).toBe("function")
    expect(typeof selectRecallCandidates).toBe("function")
    expect(typeof renderNudgeMessage).toBe("function")
    expect(typeof RecallLedger).toBe("function")
    expect(typeof sanitizeSessionFilename).toBe("function")
  })
})
