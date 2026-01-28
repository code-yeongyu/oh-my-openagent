import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import type { Multiplexer, PaneHandle, SpawnOptions } from "./types"

const mockSpawn = mock(() =>
  Promise.resolve({
    exitCode: 0,
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
  })
)

const mockConfig = {
  enabled: true,
  sessionPrefix: "omo-test",
}

type AdapterConfig = typeof mockConfig

let TmuxAdapter: new (config: AdapterConfig) => Multiplexer
let ZellijAdapter: new (config: AdapterConfig) => Multiplexer

try {
  TmuxAdapter = require("./tmux-adapter").TmuxAdapter
} catch {
  TmuxAdapter = class NotImplementedTmuxAdapter implements Multiplexer {
    type = "tmux" as const
    capabilities = { manualLayout: true, persistentLabels: false }
    constructor(_config: AdapterConfig) {
      throw new Error("TmuxAdapter not implemented yet")
    }
    async ensureSession(_name: string): Promise<void> {
      throw new Error("TmuxAdapter not implemented yet")
    }
    async killSession(_name: string): Promise<void> {
      throw new Error("TmuxAdapter not implemented yet")
    }
    async spawnPane(_cmd: string, _options: SpawnOptions): Promise<PaneHandle> {
      throw new Error("TmuxAdapter not implemented yet")
    }
    async closePane(_handle: PaneHandle): Promise<void> {
      throw new Error("TmuxAdapter not implemented yet")
    }
    async getPanes(): Promise<PaneHandle[]> {
      throw new Error("TmuxAdapter not implemented yet")
    }
  }
}

try {
  ZellijAdapter = require("./zellij-adapter").ZellijAdapter
} catch {
  ZellijAdapter = class NotImplementedZellijAdapter implements Multiplexer {
    type = "zellij" as const
    capabilities = { manualLayout: false, persistentLabels: true }
    constructor(_config: AdapterConfig) {
      throw new Error("ZellijAdapter not implemented yet")
    }
    async ensureSession(_name: string): Promise<void> {
      throw new Error("ZellijAdapter not implemented yet")
    }
    async killSession(_name: string): Promise<void> {
      throw new Error("ZellijAdapter not implemented yet")
    }
    async spawnPane(_cmd: string, _options: SpawnOptions): Promise<PaneHandle> {
      throw new Error("ZellijAdapter not implemented yet")
    }
    async closePane(_handle: PaneHandle): Promise<void> {
      throw new Error("ZellijAdapter not implemented yet")
    }
    async getPanes(): Promise<PaneHandle[]> {
      throw new Error("ZellijAdapter not implemented yet")
    }
  }
}

describe.each([
  ["TmuxAdapter", () => new TmuxAdapter(mockConfig)],
  ["ZellijAdapter", () => new ZellijAdapter(mockConfig)],
])("%s contract", (_name, createAdapter) => {
  let originalSpawn: typeof Bun.spawn

  beforeEach(() => {
    //#given - mock Bun.spawn to avoid real subprocess calls
    originalSpawn = Bun.spawn
    ;(Bun as any).spawn = mockSpawn
    mockSpawn.mockClear()
  })

  afterEach(() => {
    //#given - restore original Bun.spawn
    ;(Bun as any).spawn = originalSpawn
  })

  describe("spawnPane", () => {
    it("returns PaneHandle with label matching the provided label", async () => {
      //#given
      const adapter = createAdapter()
      const options: SpawnOptions = { label: "omo-test-pane" }

      //#when
      const handle = await adapter.spawnPane("echo test", options)

      //#then
      expect(handle).toBeDefined()
      expect(handle.label).toBe("omo-test-pane")
    })

    it("returns PaneHandle with the specified label", async () => {
      //#given
      const adapter = createAdapter()
      const options: SpawnOptions = { label: "omo-generated-test" }

      //#when
      const handle = await adapter.spawnPane("echo test", options)

      //#then
      expect(handle).toBeDefined()
      expect(handle.label).toBe("omo-generated-test")
    })

    it("spawns pane with specified direction", async () => {
      //#given
      const adapter = createAdapter()
      const options: SpawnOptions = {
        label: "omo-direction-test",
        direction: "horizontal",
      }

      //#when
      const handle = await adapter.spawnPane("pwd", options)

      //#then
      expect(handle).toBeDefined()
      expect(handle.label).toBe("omo-direction-test")
    })
  })

  describe("closePane", () => {
    it("accepts PaneHandle and closes the pane", async () => {
      //#given
      const adapter = createAdapter()
      const handle: PaneHandle = { label: "omo-close-test" }

      //#when
      const closePromise = adapter.closePane(handle)

      //#then
      await expect(closePromise).resolves.toBeUndefined()
    })

    it("handles closing non-existent pane gracefully", async () => {
      //#given
      const adapter = createAdapter()
      const handle: PaneHandle = { label: "omo-nonexistent" }

      //#when
      const closePromise = adapter.closePane(handle)

      //#then - should not throw
      await expect(closePromise).resolves.toBeUndefined()
    })
  })

  describe("getPanes", () => {
    it("returns array of PaneHandles", async () => {
      //#given
      const adapter = createAdapter()

      //#when
      const panes = await adapter.getPanes()

      //#then
      expect(Array.isArray(panes)).toBe(true)
    })

    it("returns PaneHandles with label property", async () => {
      //#given
      const adapter = createAdapter()
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
    it("accepts session name and creates session if not exists", async () => {
      //#given
      const adapter = createAdapter()
      const sessionName = "omo-test-session"

      //#when
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then
      await expect(ensurePromise).resolves.toBeUndefined()
    })

    it("succeeds when session already exists", async () => {
      //#given
      const adapter = createAdapter()
      const sessionName = "omo-existing-session"
      await adapter.ensureSession(sessionName)

      //#when
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then - should not throw
      await expect(ensurePromise).resolves.toBeUndefined()
    })
  })

  describe("killSession", () => {
    it("accepts session name and kills the session", async () => {
      //#given
      const adapter = createAdapter()
      const sessionName = "omo-kill-test"
      await adapter.ensureSession(sessionName)

      //#when
      const killPromise = adapter.killSession(sessionName)

      //#then
      await expect(killPromise).resolves.toBeUndefined()
    })

    it("handles killing non-existent session gracefully", async () => {
      //#given
      const adapter = createAdapter()
      const sessionName = "omo-nonexistent-session"

      //#when
      const killPromise = adapter.killSession(sessionName)

      //#then - should not throw
      await expect(killPromise).resolves.toBeUndefined()
    })
  })

  describe("interface compliance", () => {
    it("implements Multiplexer interface", () => {
      //#given
      const adapter = createAdapter()

      //#then - verify all required methods exist
      expect(typeof adapter.spawnPane).toBe("function")
      expect(typeof adapter.closePane).toBe("function")
      expect(typeof adapter.getPanes).toBe("function")
      expect(typeof adapter.ensureSession).toBe("function")
      expect(typeof adapter.killSession).toBe("function")
    })

    it("has type property", () => {
      //#given
      const adapter = createAdapter()

      //#then
      expect(adapter.type).toBeDefined()
      expect(["tmux", "zellij"]).toContain(adapter.type)
    })

    it("has capabilities property", () => {
      //#given
      const adapter = createAdapter()

      //#then
      expect(adapter.capabilities).toBeDefined()
      expect(typeof adapter.capabilities.manualLayout).toBe("boolean")
      expect(typeof adapter.capabilities.persistentLabels).toBe("boolean")
    })
  })
})
