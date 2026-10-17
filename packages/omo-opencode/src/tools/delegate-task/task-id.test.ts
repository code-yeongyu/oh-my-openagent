import { describe, test, expect } from "bun:test"
import { normalizeContinuationTaskID, CONTINUATION_SESSION_ID_PREFIX } from "./task-id"

describe("normalizeContinuationTaskID", () => {
  describe("#given a model-invented random UUID task_id", () => {
    test("#when normalizing #then returns undefined so a new task spawns (issue #6298)", () => {
      // given - Grok-style over-filled optional parameter
      const invented = "3f9d6c1e-8a4b-4c2d-9e7f-1a2b3c4d5e6f"

      // when
      const result = normalizeContinuationTaskID(invented)

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("#given a background task id passed as task_id", () => {
    test("#when normalizing #then returns undefined because bg_ ids are not continuation session ids", () => {
      // given
      const backgroundTaskID = "bg_01J9XK7Q2M"

      // when
      const result = normalizeContinuationTaskID(backgroundTaskID)

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("#given an empty or whitespace-only task_id", () => {
    test("#when normalizing #then returns undefined", () => {
      // given / when / then
      expect(normalizeContinuationTaskID("")).toBeUndefined()
      expect(normalizeContinuationTaskID("   ")).toBeUndefined()
    })
  })

  describe("#given a non-string task_id", () => {
    test("#when normalizing #then returns undefined", () => {
      // given / when / then
      expect(normalizeContinuationTaskID(undefined)).toBeUndefined()
      expect(normalizeContinuationTaskID(null)).toBeUndefined()
      expect(normalizeContinuationTaskID(123)).toBeUndefined()
    })
  })

  describe("#given a ses_-prefixed continuation id", () => {
    test("#when normalizing #then returns it unchanged", () => {
      // given
      const continuationID = "ses_abc123"

      // when
      const result = normalizeContinuationTaskID(continuationID)

      // then
      expect(result).toBe(continuationID)
    })

    test("#when surrounded by whitespace #then returns the trimmed value", () => {
      // given
      const padded = "  ses_abc123  "

      // when
      const result = normalizeContinuationTaskID(padded)

      // then
      expect(result).toBe("ses_abc123")
    })
  })

  describe("#given a wrong-case prefix", () => {
    test("#when normalizing #then returns undefined because the documented shape is lowercase ses_", () => {
      // given / when / then
      expect(normalizeContinuationTaskID("SES_abc123")).toBeUndefined()
      expect(normalizeContinuationTaskID("Ses_abc123")).toBeUndefined()
    })
  })

  describe("#given the bare prefix with no session content", () => {
    test("#when normalizing #then returns undefined", () => {
      // given / when / then
      expect(normalizeContinuationTaskID("ses_")).toBeUndefined()
    })
  })

  describe("CONTINUATION_SESSION_ID_PREFIX", () => {
    test("#then matches the documented ses_ continuation contract", () => {
      // given / when / then
      expect(CONTINUATION_SESSION_ID_PREFIX).toBe("ses_")
    })
  })
})
