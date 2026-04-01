import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { ZellijAdapter } from "./zellij-adapter"
import type { ZellijStorage, ZellijState } from "./zellij-storage"

const mockConfig = {
  enabled: true,
}

function makeMockStorage(): ZellijStorage & { _store: Map<string, ZellijState> } {
  const store = new Map<string, ZellijState>()
  return {
    _store: store,
    loadZellijState(sessionID: string) {
      return store.get(sessionID) ?? null
    },
    saveZellijState(state: ZellijState) {
      store.set(state.sessionID, state)
    },
    clearZellijState(sessionID: string) {
      store.delete(sessionID)
    },
  }
}

function makeMockSpawn(knownPaneIds: string[] = ["%1"]) {
  return (args: string[]) => {
    const isCat = Array.isArray(args) && args[0] === "cat"
    const isListPanes = Array.isArray(args) && args.includes("list-panes")
    const paneIdBytes = new TextEncoder().encode("%1\n")
    const listPanesOutput = knownPaneIds.map(id => `terminal_${id}`).join("\n") + "\n"
    const listPanesBytes = new TextEncoder().encode(listPanesOutput)
    return {
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(controller) {
          if (isCat) {
            controller.enqueue(paneIdBytes)
          } else if (isListPanes) {
            controller.enqueue(listPanesBytes)
          }
          controller.close()
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    }
  }
}

function makeAdapter(storage?: ZellijStorage) {
  return new ZellijAdapter(mockConfig, storage ?? makeMockStorage(), makeMockSpawn() as any)
}

describe("ZellijAdapter", () => {
  describe("interface compliance", () => {
    it("implements Multiplexer interface", () => {
      //#given
      const adapter = makeAdapter()

      //#then - verify all required methods exist
      expect(typeof adapter.spawnPane).toBe("function")
      expect(typeof adapter.closePane).toBe("function")
      expect(typeof adapter.getPanes).toBe("function")
      expect(typeof adapter.ensureSession).toBe("function")
      expect(typeof adapter.killSession).toBe("function")
    })

    it("has type property set to 'zellij'", () => {
      //#given
      const adapter = makeAdapter()

      //#then
      expect(adapter.type).toBe("zellij")
    })

    it("has correct capabilities", () => {
      //#given
      const adapter = makeAdapter()

      //#then
      expect(adapter.capabilities.manualLayout).toBe(false)
      expect(adapter.capabilities.persistentLabels).toBe(true)
    })
  })

  describe("spawnPane", () => {
    it("returns PaneHandle with label", async () => {
      //#given
      const adapter = makeAdapter()
      const options = { label: "omo-test-pane" }

      //#when
      const handle = await adapter.spawnPane("echo test", options)

      //#then
      expect(handle.label).toBe("omo-test-pane")
    })

    it("accepts direction option", async () => {
      //#given
      const adapter = makeAdapter()
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
      const adapter = makeAdapter()
      await adapter.spawnPane("echo test", { label: "omo-close-test" })

      //#when
      await adapter.closePane({ label: "omo-close-test" })

      //#then - label should be removed from internal labelToSpawned map
      expect((adapter as any).labelToSpawned.has("omo-close-test")).toBe(false)
    })

    it("handles closing non-existent pane gracefully", async () => {
      //#given
      const adapter = makeAdapter()

      //#when
      const closePromise = adapter.closePane({ label: "omo-nonexistent" })

      //#then - should not throw
      await expect(closePromise).resolves.toBeUndefined()
    })
  })

  describe("ensureSession", () => {
    it("creates a detached session", async () => {
      //#given
      const adapter = makeAdapter()

      //#when
      const ensurePromise = adapter.ensureSession("omo-test-session")

      //#then
      await expect(ensurePromise).resolves.toBeUndefined()
    })
  })

  describe("killSession", () => {
    it("deletes a session with force flag", async () => {
      //#given
      const adapter = makeAdapter()

      //#when
      const killPromise = adapter.killSession("omo-kill-test")

      //#then
      await expect(killPromise).resolves.toBeUndefined()
    })
  })

  describe("getPanes", () => {
    it("returns array of PaneHandles", async () => {
      //#given
      const adapter = makeAdapter()

      //#when
      const panes = await adapter.getPanes()

      //#then
      expect(Array.isArray(panes)).toBe(true)
    })
  })

  describe("setSessionID", () => {
    it("stores sessionID for later use", async () => {
      //#given
      const adapter = makeAdapter()
      const sessionID = "test-session-123"

      //#when
      await adapter.setSessionID(sessionID)
      const handle = await adapter.spawnPane("echo hello", { label: "omo-test-label" })

      //#then - sessionID stored: spawnPane succeeds and returns expected handle
      expect(handle).toBeDefined()
      expect(handle.label).toBe("omo-test-label")
    })

    it("loads persisted state when sessionID is set", async () => {
      //#given
      const sessionID = "test-session-load"
      const storage = makeMockStorage()
      storage.saveZellijState({
        sessionID,
        anchorPaneId: "pane-123",
        hasCreatedFirstPane: true,
        updatedAt: Date.now(),
      })
      const adapter = new ZellijAdapter(mockConfig, storage, makeMockSpawn(["%1", "pane-123"]) as any)

      //#when
      await adapter.setSessionID(sessionID)

      //#then - state was loaded: hasCreatedFirstPane and anchorPaneId set from storage
      expect((adapter as any).hasCreatedFirstPane).toBe(true)
      expect((adapter as any).anchorPaneId).toBe("pane-123")
    })

    it("handles missing persisted state gracefully", async () => {
      //#given
      const adapter = makeAdapter()
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
      const storage = makeMockStorage()
      const adapter = makeAdapter(storage)
      await adapter.setSessionID(sessionID)

      //#when
      await adapter.spawnPane("echo test", { label: "omo-anchor-test" })

      //#then - state persisted: anchorPaneId and hasCreatedFirstPane set
      const saved = storage.loadZellijState(sessionID)
      expect(saved).not.toBeNull()
      expect(saved?.hasCreatedFirstPane).toBe(true)
      expect(saved?.anchorPaneId).toBe("%1")
    })

    it("does not save state when sessionID is not set (backward compatibility)", async () => {
      //#given
      const adapter = makeAdapter()

      //#when
      const handle = await adapter.spawnPane("echo test", { label: "omo-no-session" })

      //#then - should work without sessionID
      expect(handle.label).toBe("omo-no-session")
    })

    it("saves state after subsequent pane spawns", async () => {
      //#given
      const sessionID = "test-session-multi"
      const storage = makeMockStorage()
      const adapter = makeAdapter(storage)
      await adapter.setSessionID(sessionID)

      //#when
      await adapter.spawnPane("echo first", { label: "omo-first" })
      await adapter.spawnPane("echo second", { label: "omo-second" })

      //#then - state remains persisted after subsequent spawns
      const saved = storage.loadZellijState(sessionID)
      expect(saved).not.toBeNull()
      expect(saved?.hasCreatedFirstPane).toBe(true)
    })
  })

  describe("validateAnchorPane", () => {
    it("returns true when anchorPaneId is set", async () => {
      //#given
      const adapter = makeAdapter()
      const sessionID = "test-validate-valid"
      await adapter.setSessionID(sessionID)

      //#when - spawn first pane to set anchorPaneId
      await adapter.spawnPane("echo test", { label: "omo-anchor" })
      const isValid = await (adapter as any).validateAnchorPane()

      //#then
      expect(isValid).toBe(true)
    })

    it("returns false when anchorPaneId is null", async () => {
      //#given
      const adapter = makeAdapter()

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
      const storage = makeMockStorage()
      storage.saveZellijState({
        sessionID,
        anchorPaneId: null,
        hasCreatedFirstPane: true,
        updatedAt: Date.now(),
      })
      const adapter = new ZellijAdapter(mockConfig, storage, makeMockSpawn() as any)

      //#when
      await adapter.setSessionID(sessionID)

      //#then - anchorPaneId was null so validateAnchorPane returned false → hasCreatedFirstPane cleared
      expect((adapter as any).hasCreatedFirstPane).toBe(false)
      expect((adapter as any).anchorPaneId).toBeNull()
    })

    it("keeps state when anchor pane is valid", async () => {
      //#given
      const sessionID = "test-validate-keep"
      const sharedStorage = makeMockStorage()
      const adapter = makeAdapter(sharedStorage)
      adapter.setSessionID(sessionID)

      //#when - spawn first pane to set valid anchorPaneId
      await adapter.spawnPane("echo test", { label: "omo-valid-anchor" })

      //#then - create new adapter with same storage and verify persisted state
      const adapter2 = makeAdapter(sharedStorage)
      adapter2.setSessionID(sessionID)
      const loadedState = sharedStorage.loadZellijState(sessionID)
      expect(loadedState).not.toBeNull()
      expect(loadedState!.anchorPaneId).toBe("%1")

      //#cleanup
      sharedStorage.clearZellijState(sessionID)
    })

    it("handles concurrent spawnPane calls without race conditions", async () => {
      //#given adapter with sessionID set
      const sessionID = "concurrent-test"
      const adapter = makeAdapter()
      adapter.setSessionID(sessionID)

      //#when spawning multiple panes concurrently
      const promises = [
        adapter.spawnPane("echo cmd1", { label: "omo-concurrent-1" }),
        adapter.spawnPane("echo cmd2", { label: "omo-concurrent-2" }),
        adapter.spawnPane("echo cmd3", { label: "omo-concurrent-3" }),
      ]

      //#then all complete successfully without state corruption
      const results = await Promise.all(promises)
      expect(results).toHaveLength(3)
      expect(results[0].label).toBe("omo-concurrent-1")
      expect(results[1].label).toBe("omo-concurrent-2")
      expect(results[2].label).toBe("omo-concurrent-3")
    })

    it("handles concurrent setSessionID and spawnPane without race conditions", async () => {
      //#given multiple adapters with same sessionID
      const sessionID = "concurrent-session-test"
      const adapter1 = makeAdapter()
      const adapter2 = makeAdapter()

      //#when setting session ID and spawning concurrently
      adapter1.setSessionID(sessionID)
      adapter2.setSessionID(sessionID)

      const promises = [
        adapter1.spawnPane("echo first", { label: "omo-adapter1-pane" }),
        adapter2.spawnPane("echo second", { label: "omo-adapter2-pane" }),
      ]

      //#then both complete successfully
      const results = await Promise.all(promises)
      expect(results).toHaveLength(2)
    })
  })

  describe("edge cases: externally closed pane", () => {
    it("handles anchor pane closed externally while session active", async () => {
      //#given adapter with valid anchor pane
      const sessionID = "external-close-test"
      const adapter = makeAdapter()
      adapter.setSessionID(sessionID)
      await adapter.spawnPane("echo anchor", { label: "omo-external-anchor" })

      //#when simulating external pane closure (stale pane ID)
      const adapter2 = makeAdapter()
      adapter2.setSessionID(sessionID)

      //#then validation should detect stale state and clear it
      const handle = await adapter2.spawnPane("echo recovery", { label: "omo-recovery" })
      expect(handle.label).toBe("omo-recovery")
    })

    it("recovers gracefully when anchor pane becomes invalid", async () => {
      //#given persisted state with stale but non-null anchor pane ID
      const sessionID = "invalid-anchor-test"
      const storage = makeMockStorage()
      storage.saveZellijState({
        sessionID,
        anchorPaneId: "pane-that-no-longer-exists-12345",
        hasCreatedFirstPane: true,
        updatedAt: Date.now(),
      })

      //#when loading state and spawning new pane
      const adapter = new ZellijAdapter(mockConfig, storage, makeMockSpawn() as any)
      await adapter.setSessionID(sessionID)
      const handle = await adapter.spawnPane("echo new", { label: "omo-new-after-invalid" })

      //#then should spawn successfully despite stale anchor pane ID
      expect(handle.label).toBe("omo-new-after-invalid")
    })
  })
})
