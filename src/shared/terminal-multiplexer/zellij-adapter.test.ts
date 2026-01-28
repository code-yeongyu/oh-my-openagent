import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { ZellijAdapter } from "./zellij-adapter"

const mockConfig = {
  enabled: true,
  sessionPrefix: "omo-test",
}

describe("ZellijAdapter", () => {
  let originalSpawn: typeof Bun.spawn
  let mockSpawn: ReturnType<typeof mock>

  beforeEach(() => {
    //#given - mock Bun.spawn to avoid real subprocess calls
    originalSpawn = Bun.spawn
    mockSpawn = mock(() => ({
      exited: 0,
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
    }))
    ;(Bun as any).spawn = mockSpawn
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
      expect(panes.some((p) => p.label === "omo-close-test")).toBe(false)
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
})
