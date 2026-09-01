import { describe, test, expect, beforeEach } from "bun:test"
import {
  storeToolMetadata,
  consumeToolMetadata,
  getPendingStoreSize,
  clearPendingStore,
} from "./index"

describe("tool-metadata-store", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  describe("storeToolMetadata", () => {
    test("#given metadata with title and metadata, #when stored, #then store size increases", () => {
      //#given
      const sessionID = "ses_abc123"
      const callID = "call_001"
      const data = {
        title: "Test Task",
        metadata: { sessionId: "ses_child", agent: "oracle" },
      }

      //#when
      storeToolMetadata(sessionID, callID, data)

      //#then
      expect(getPendingStoreSize()).toBe(1)
    })
  })

  describe("consumeToolMetadata", () => {
    test("#given stored metadata, #when consumed, #then returns the stored data", () => {
      //#given
      const sessionID = "ses_abc123"
      const callID = "call_001"
      const data = {
        title: "My Task",
        metadata: { sessionId: "ses_sub", run_in_background: true },
      }
      storeToolMetadata(sessionID, callID, data)

      //#when
      const result = consumeToolMetadata(sessionID, callID)

      //#then
      expect(result).toEqual(data)
    })

    test("#given stored metadata, #when consumed twice, #then second call returns undefined", () => {
      //#given
      const sessionID = "ses_abc123"
      const callID = "call_001"
      storeToolMetadata(sessionID, callID, { title: "Task" })

      //#when
      consumeToolMetadata(sessionID, callID)
      const second = consumeToolMetadata(sessionID, callID)

      //#then
      expect(second).toBeUndefined()
      expect(getPendingStoreSize()).toBe(0)
    })

    test("#given no stored metadata, #when consumed, #then returns undefined", () => {
      //#given
      const sessionID = "ses_nonexistent"
      const callID = "call_999"

      //#when
      const result = consumeToolMetadata(sessionID, callID)

      //#then
      expect(result).toBeUndefined()
    })
  })

  describe("isolation", () => {
    test("#given multiple entries, #when consuming one, #then others remain", () => {
      //#given
      storeToolMetadata("ses_1", "call_a", { title: "Task A" })
      storeToolMetadata("ses_1", "call_b", { title: "Task B" })
      storeToolMetadata("ses_2", "call_a", { title: "Task C" })

      //#when
      const resultA = consumeToolMetadata("ses_1", "call_a")

      //#then
      expect(resultA?.title).toBe("Task A")
      expect(getPendingStoreSize()).toBe(2)
      expect(consumeToolMetadata("ses_1", "call_b")?.title).toBe("Task B")
      expect(consumeToolMetadata("ses_2", "call_a")?.title).toBe("Task C")
      expect(getPendingStoreSize()).toBe(0)
    })
  })

  describe("overwrite", () => {
    test("#given existing entry, #when stored again with same key, #then overwrites", () => {
      //#given
      storeToolMetadata("ses_1", "call_a", { title: "Old" })

      //#when
      storeToolMetadata("ses_1", "call_a", { title: "New", metadata: { updated: true } })

      //#then
      const result = consumeToolMetadata("ses_1", "call_a")
      expect(result?.title).toBe("New")
      expect(result?.metadata).toEqual({ updated: true })
    })
  })
})
