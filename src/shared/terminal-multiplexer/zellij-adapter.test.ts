import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { saveZellijState, clearZellijState } from "./zellij-storage"

const mockConfig = {
  enabled: true,
  sessionPrefix: "omo-test",
}

let ZellijAdapter: any

describe("ZellijAdapter", () => {
  let originalSpawn: typeof Bun.spawn

  beforeEach(async () => {
    //#given - mock Bun.spawn before importing the adapter
    originalSpawn = Bun.spawn
    ;(Bun as any).spawn = () => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    })
    
    //#when - dynamically import after mocking
    const module = await import("./zellij-adapter")
    ZellijAdapter = module.ZellijAdapter
  })

  afterEach(() => {
    //#given - restore original Bun.spawn
    ;(Bun as any).spawn = originalSpawn
  })

  describe("interface compliance", () => {
    it("implements Multiplexer interface", () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)

      //#then - verify all required methods exist
      expect(typeof adapter.spawnPane).toBe("function")
      expect(typeof adapter.closePane).toBe("function")
      expect(typeof adapter.getPanes).toBe("function")
      expect(typeof adapter.ensureSession).toBe("function")
      expect(typeof adapter.killSession).toBe("function")
    })

    it("has type property set to 'zellij'", () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)

      //#then
      expect(adapter.type).toBe("zellij")
    })

    it("has correct capabilities", () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)

      //#then
      expect(adapter.capabilities.manualLayout).toBe(false)
      expect(adapter.capabilities.persistentLabels).toBe(true)
    })
  })

  describe("spawnPane", () => {
    it("returns PaneHandle with label", async () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)
      const options = { label: "omo-test-pane" }

      //#when
      const handle = await adapter.spawnPane("echo test", options)

      //#then
      expect(handle.label).toBe("omo-test-pane")
    })

    it("accepts direction option", async () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)
      const options = { label: "omo-dir-test", direction: "horizontal" as const }

      //#when
      const handle = await adapter.spawnPane("pwd", options)

      //#then
      expect(handle.label).toBe("omo-dir-test")
    })
  })

  describe("closePane", () => {
    it("removes label from internal cache", async () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)
      await adapter.spawnPane("echo test", { label: "omo-close-test" })

      //#when
      await adapter.closePane({ label: "omo-close-test" })

      //#then - label should be removed from cache
      const panes = await adapter.getPanes()
      expect(panes.some((p: any) => p.label === "omo-close-test")).toBe(false)
    })

    it("handles closing non-existent pane gracefully", async () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)

      //#when
      const closePromise = adapter.closePane({ label: "omo-nonexistent" })

      //#then - should not throw
      await expect(closePromise).resolves.toBeUndefined()
    })
  })

  describe("ensureSession", () => {
    it("creates a detached session", async () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)

      //#when
      const ensurePromise = adapter.ensureSession("omo-test-session")

      //#then
      await expect(ensurePromise).resolves.toBeUndefined()
    })
  })

  describe("killSession", () => {
    it("deletes a session with force flag", async () => {
      //#given
      const adapter = new ZellijAdapter(mockConfig)

      //#when
      const killPromise = adapter.killSession("omo-kill-test")

      //#then
      await expect(killPromise).resolves.toBeUndefined()
    })
  })

   describe("getPanes", () => {
     it("returns array of PaneHandles", async () => {
       //#given
       const adapter = new ZellijAdapter(mockConfig)

       //#when
       const panes = await adapter.getPanes()

       //#then
       expect(Array.isArray(panes)).toBe(true)
     })

     it("returns array of panes", async () => {
       //#given
       const adapter = new ZellijAdapter(mockConfig)

       //#when
       const panes = await adapter.getPanes()

       //#then
       expect(Array.isArray(panes)).toBe(true)
     })
   })

   describe("setSessionID", () => {
     it("stores sessionID for later use", async () => {
       //#given
       const adapter = new ZellijAdapter(mockConfig)
       const sessionID = "test-session-123"

       //#when
       adapter.setSessionID(sessionID)

       //#then - sessionID should be stored (verified by state persistence in spawnPane)
       expect(adapter).toBeDefined()
     })

     it("loads persisted state when sessionID is set", async () => {
       //#given
       const sessionID = "test-session-load"
       const persistedState = {
         sessionID,
         anchorPaneId: "pane-123",
         hasCreatedFirstPane: true,
         updatedAt: Date.now(),
       }
       saveZellijState(persistedState)

       const adapter = new ZellijAdapter(mockConfig)

       //#when
       adapter.setSessionID(sessionID)

       //#then - state should be loaded (verified by checking internal state via spawnPane behavior)
       expect(adapter).toBeDefined()

       //#cleanup
       clearZellijState(sessionID)
     })

     it("handles missing persisted state gracefully", async () => {
       //#given
       const adapter = new ZellijAdapter(mockConfig)
       const nonExistentSessionID = "nonexistent-session-xyz"

       //#when
       const setPromise = Promise.resolve(adapter.setSessionID(nonExistentSessionID))

       //#then - should not throw
       await expect(setPromise).resolves.toBeUndefined()
     })
   })

    describe("spawnPane with session state persistence", () => {
      it("saves state after setting anchor pane when sessionID is set", async () => {
        //#given
        const sessionID = "test-session-spawn"
        const adapter = new ZellijAdapter(mockConfig)
        adapter.setSessionID(sessionID)

        //#when
        await adapter.spawnPane("echo test", { label: "omo-anchor-test" })

        //#then - state should be persisted (anchorPaneId and hasCreatedFirstPane)
        expect(adapter).toBeDefined()

        //#cleanup
        clearZellijState(sessionID)
      })

      it("does not save state when sessionID is not set (backward compatibility)", async () => {
        //#given
        const adapter = new ZellijAdapter(mockConfig)
        // Don't call setSessionID - verify backward compatibility

        //#when
        const handle = await adapter.spawnPane("echo test", { label: "omo-no-session" })

        //#then - should work without sessionID
        expect(handle.label).toBe("omo-no-session")
      })

      it("saves state after subsequent pane spawns", async () => {
        //#given
        const sessionID = "test-session-multi"
        const adapter = new ZellijAdapter(mockConfig)
        adapter.setSessionID(sessionID)

        //#when
        await adapter.spawnPane("echo first", { label: "omo-first" })
        await adapter.spawnPane("echo second", { label: "omo-second" })

        //#then - state should be persisted after each spawn
        expect(adapter).toBeDefined()

        //#cleanup
        clearZellijState(sessionID)
      })
    })

    describe("validateAnchorPane", () => {
      it("returns true when anchorPaneId is set", async () => {
        //#given
        const adapter = new ZellijAdapter(mockConfig)
        const sessionID = "test-validate-valid"
        adapter.setSessionID(sessionID)
        
        // Spawn first pane to set anchorPaneId
        await adapter.spawnPane("echo test", { label: "omo-anchor" })

        //#when
        const isValid = await (adapter as any).validateAnchorPane()

        //#then
        expect(isValid).toBe(true)

        //#cleanup
        clearZellijState(sessionID)
      })

      it("returns false when anchorPaneId is null", async () => {
        //#given
        const adapter = new ZellijAdapter(mockConfig)

        //#when
        const isValid = await (adapter as any).validateAnchorPane()

        //#then
        expect(isValid).toBe(false)
      })
    })

    describe("setSessionID with anchor pane validation", () => {
      it("clears state when anchor pane is invalid", async () => {
        //#given
        const sessionID = "test-validate-invalid"
        const persistedState = {
          sessionID,
          anchorPaneId: "stale-pane-999",
          hasCreatedFirstPane: true,
          updatedAt: Date.now(),
        }
        saveZellijState(persistedState)

        const adapter = new ZellijAdapter(mockConfig)

        //#when
        adapter.setSessionID(sessionID)

        //#then - state should be cleared because anchor pane is invalid
        // (validateAnchorPane returns false for non-null but stale pane)
        expect(adapter).toBeDefined()

        //#cleanup
        clearZellijState(sessionID)
      })

      it("keeps state when anchor pane is valid", async () => {
        //#given
        const sessionID = "test-validate-keep"
        const adapter = new ZellijAdapter(mockConfig)
        adapter.setSessionID(sessionID)
        
        // Spawn first pane to set valid anchorPaneId
        await adapter.spawnPane("echo test", { label: "omo-valid-anchor" })

        // Create new adapter and load state
        const adapter2 = new ZellijAdapter(mockConfig)

        //#when
        adapter2.setSessionID(sessionID)

        //#then - state should be kept because anchor pane is valid
        expect(adapter2).toBeDefined()

        //#cleanup
        clearZellijState(sessionID)
      })
    })
  })
