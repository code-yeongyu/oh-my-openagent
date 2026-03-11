import { describe, it, expect, beforeEach } from "bun:test"
import {
  storeBrainId,
  getBrainId,
  hasBrainId,
  clearBrainIds,
  getBrainIdStoreSize,
} from "./brain-id-store"

describe("brain-id-store", () => {
  beforeEach(() => {
    clearBrainIds("ses_test1")
    clearBrainIds("ses_test2")
  })

  describe("#given a stored brain ID", () => {
    describe("#when getBrainId is called with matching session+message", () => {
      it("#then should return the stored brain ID", () => {
        storeBrainId("ses_test1", "msg_001", 42)

        expect(getBrainId("ses_test1", "msg_001")).toBe(42)
      })
    })

    describe("#when hasBrainId is called with matching session+message", () => {
      it("#then should return true", () => {
        storeBrainId("ses_test1", "msg_001", 42)

        expect(hasBrainId("ses_test1", "msg_001")).toBe(true)
      })
    })

    describe("#when getBrainId is called with different message", () => {
      it("#then should return null", () => {
        storeBrainId("ses_test1", "msg_001", 42)

        expect(getBrainId("ses_test1", "msg_999")).toBeNull()
      })
    })

    describe("#when getBrainId is called with different session", () => {
      it("#then should return null", () => {
        storeBrainId("ses_test1", "msg_001", 42)

        expect(getBrainId("ses_test2", "msg_001")).toBeNull()
      })
    })
  })

  describe("#given no stored brain IDs", () => {
    describe("#when getBrainId is called", () => {
      it("#then should return null", () => {
        expect(getBrainId("ses_test1", "msg_001")).toBeNull()
      })
    })

    describe("#when hasBrainId is called", () => {
      it("#then should return false", () => {
        expect(hasBrainId("ses_test1", "msg_001")).toBe(false)
      })
    })
  })

  describe("#given multiple stored brain IDs across sessions", () => {
    describe("#when clearBrainIds is called for one session", () => {
      it("#then should only clear that session's IDs", () => {
        storeBrainId("ses_test1", "msg_001", 42)
        storeBrainId("ses_test1", "msg_002", 43)
        storeBrainId("ses_test2", "msg_001", 99)

        clearBrainIds("ses_test1")

        expect(getBrainId("ses_test1", "msg_001")).toBeNull()
        expect(getBrainId("ses_test1", "msg_002")).toBeNull()
        expect(getBrainId("ses_test2", "msg_001")).toBe(99)
      })
    })
  })

  describe("#given storeBrainId called multiple times for same key", () => {
    describe("#when getBrainId is called", () => {
      it("#then should return the latest value", () => {
        storeBrainId("ses_test1", "msg_001", 42)
        storeBrainId("ses_test1", "msg_001", 99)

        expect(getBrainId("ses_test1", "msg_001")).toBe(99)
      })
    })
  })

  describe("#given multiple entries stored", () => {
    describe("#when getBrainIdStoreSize is called", () => {
      it("#then should return the number of entries", () => {
        const sizeBefore = getBrainIdStoreSize()
        storeBrainId("ses_test1", "msg_001", 42)
        storeBrainId("ses_test1", "msg_002", 43)

        expect(getBrainIdStoreSize()).toBe(sizeBefore + 2)
      })
    })
  })
})
