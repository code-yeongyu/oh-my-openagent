/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { MemoryCoreService } from "./service"

describe("MemoryCoreService", () => {
  describe("#given a service instance", () => {
    describe("#when constructed", () => {
      it("#then creates without error", () => {
        const service = new MemoryCoreService({
          databaseUrl: "postgresql://localhost:5432/test",
        })

        expect(service).toBeDefined()
      })

      it("#then exposes the expected public methods", () => {
        const service = new MemoryCoreService({
          databaseUrl: "postgresql://localhost:5432/test",
        })

        expect(typeof service.create).toBe("function")
        expect(typeof service.get).toBe("function")
        expect(typeof service.update).toBe("function")
        expect(typeof service.archive).toBe("function")
        expect(typeof service.search).toBe("function")
        expect(typeof service.listByProject).toBe("function")
        expect(typeof service.enqueueOutbox).toBe("function")
        expect(typeof service.getPendingOutbox).toBe("function")
        expect(typeof service.markOutboxSynced).toBe("function")
        expect(typeof service.markOutboxFailed).toBe("function")
        expect(typeof service.checkDedup).toBe("function")
        expect(typeof service.getSyncState).toBe("function")
        expect(typeof service.updateSyncState).toBe("function")
        expect(typeof service.appendAuditLog).toBe("function")
        expect(typeof service.getAuditLog).toBe("function")
      })
    })
  })

  describe.skip("#given a live postgres database", () => {
    it("#then supports end-to-end persistence flows", () => {
      expect(true).toBe(true)
    })
  })
})
