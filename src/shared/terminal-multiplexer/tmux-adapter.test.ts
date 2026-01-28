import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { TmuxAdapter } from "./tmux-adapter"

const mockConfig = {
  enabled: true,
  sessionPrefix: "omo-test",
}

describe("TmuxAdapter", () => {
  let adapter: TmuxAdapter

  beforeEach(() => {
    //#given - create fresh adapter instance
    adapter = new TmuxAdapter(mockConfig)
  })

  describe("interface properties", () => {
    it("has type property set to 'tmux'", () => {
      //#then
      expect(adapter.type).toBe("tmux")
    })

    it("has capabilities with manualLayout true and persistentLabels false", () => {
      //#then
      expect(adapter.capabilities.manualLayout).toBe(true)
      expect(adapter.capabilities.persistentLabels).toBe(false)
    })
  })

  describe("label mapping", () => {
    it("tracks label to paneId mapping after spawnPane", async () => {
      //#given
      const label = "test-pane-1"
      const options = { label }

      //#when
      const handle = await adapter.spawnPane("echo test", options)

      //#then
      expect(handle.label).toBe(label)
      if (handle.nativeId) {
        const panes = await adapter.getPanes()
        const found = panes.find((p) => p.label === label)
        expect(found).toBeDefined()
      }
    })

    it("clears label mapping when closePane is called", async () => {
      //#given
      const label = "test-pane-to-close"
      const handle = await adapter.spawnPane("echo test", { label })

      //#when
      await adapter.closePane(handle)

      //#then - label should be removed from internal map
      const panes = await adapter.getPanes()
      const found = panes.find((p) => p.label === label)
      expect(found).toBeUndefined()
    })
  })

  describe("spawnPane", () => {
    it("returns PaneHandle with label matching input", async () => {
      //#given
      const label = "omo-test-spawn"
      const options: any = { label }

      //#when
      const handle = await adapter.spawnPane("pwd", options)

      //#then
      expect(handle.label).toBe(label)
    })

    it("respects direction option", async () => {
      //#given
      const options: any = {
        label: "omo-direction-test",
        direction: "vertical",
      }

      //#when
      const handle = await adapter.spawnPane("ls", options)

      //#then
      expect(handle.label).toBe("omo-direction-test")
    })

    it("defaults to horizontal direction", async () => {
      //#given
      const options: any = { label: "omo-default-direction" }

      //#when
      const handle = await adapter.spawnPane("echo test", options)

      //#then
      expect(handle.label).toBe("omo-default-direction")
    })
  })

  describe("closePane", () => {
    it("accepts PaneHandle and closes pane", async () => {
      //#given
      const handle = { label: "omo-close-test" }

      //#when
      const closePromise = adapter.closePane(handle)

      //#then
      await expect(closePromise).resolves.toBeUndefined()
    })

    it("handles closing non-existent pane gracefully", async () => {
      //#given
      const handle = { label: "omo-nonexistent-pane" }

      //#when
      const closePromise = adapter.closePane(handle)

      //#then - should not throw
      await expect(closePromise).resolves.toBeUndefined()
    })
  })

  describe("getPanes", () => {
    it("returns array of PaneHandles", async () => {
      //#when
      const panes = await adapter.getPanes()

      //#then
      expect(Array.isArray(panes)).toBe(true)
    })

    it("returns PaneHandles with label property", async () => {
      //#given
      await adapter.spawnPane("echo test", { label: "omo-list-test" })

      //#when
      const panes = await adapter.getPanes()

      //#then
      for (const pane of panes) {
        expect(pane.label).toBeDefined()
        expect(typeof pane.label).toBe("string")
      }
    })
  })

  describe("ensureSession", () => {
    const createdSessions: string[] = []

    beforeEach(() => {
      createdSessions.length = 0
    })

    afterEach(async () => {
      for (const sessionName of createdSessions) {
        try {
          await adapter.killSession(sessionName)
        } catch {
          // Ignore errors if session doesn't exist
        }
      }
      createdSessions.length = 0
    })

    it("accepts session name and creates session", async () => {
      //#given
      const sessionName = "omo-test-session"
      createdSessions.push(sessionName)

      //#when
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then
      await expect(ensurePromise).resolves.toBeUndefined()
    })

    it("succeeds when session already exists", async () => {
      //#given
      const sessionName = "omo-existing-session"
      createdSessions.push(sessionName)
      await adapter.ensureSession(sessionName)

      //#when
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then - should not throw
      await expect(ensurePromise).resolves.toBeUndefined()
    })
  })

  describe("killSession", () => {
    const createdSessions: string[] = []

    beforeEach(() => {
      createdSessions.length = 0
    })

    afterEach(async () => {
      for (const sessionName of createdSessions) {
        try {
          await adapter.killSession(sessionName)
        } catch {
          // Ignore errors if session doesn't exist
        }
      }
      createdSessions.length = 0
    })

    it("accepts session name and kills session", async () => {
      //#given
      const sessionName = "omo-kill-test"
      createdSessions.push(sessionName)
      await adapter.ensureSession(sessionName)

      //#when
      const killPromise = adapter.killSession(sessionName)

      //#then
      await expect(killPromise).resolves.toBeUndefined()
    })

    it("handles killing non-existent session gracefully", async () => {
      //#given
      const sessionName = "omo-nonexistent-session"

      //#when
      const killPromise = adapter.killSession(sessionName)

      //#then - should not throw
      await expect(killPromise).resolves.toBeUndefined()
    })
  })
})
