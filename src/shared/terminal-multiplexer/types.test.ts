import { describe, it, expect } from "bun:test"
import type {
  Multiplexer,
  PaneHandle,
  SpawnOptions,
  MultiplexerCapabilities,
  MultiplexerType,
} from "./types"

describe("terminal-multiplexer types", () => {
  //#region PaneHandle
  describe("PaneHandle", () => {
    //#given a PaneHandle type
    //#when creating a valid handle
    //#then it should require label and allow optional nativeId
    it("requires label property", () => {
      const handle: PaneHandle = { label: "agent-1" }
      expect(handle.label).toBe("agent-1")
      expect(handle.nativeId).toBeUndefined()
    })

    it("allows optional nativeId", () => {
      const handle: PaneHandle = { label: "agent-1", nativeId: "%42" }
      expect(handle.label).toBe("agent-1")
      expect(handle.nativeId).toBe("%42")
    })
  })
  //#endregion

  //#region MultiplexerType
  describe("MultiplexerType", () => {
    //#given MultiplexerType union
    //#when assigning valid values
    //#then it should accept tmux and zellij
    it("accepts tmux", () => {
      const type: MultiplexerType = "tmux"
      expect(type).toBe("tmux")
    })

    it("accepts zellij", () => {
      const type: MultiplexerType = "zellij"
      expect(type).toBe("zellij")
    })
  })
  //#endregion

  //#region MultiplexerCapabilities
  describe("MultiplexerCapabilities", () => {
    //#given MultiplexerCapabilities type
    //#when creating capabilities object
    //#then it should have manualLayout and persistentLabels flags
    it("has required capability flags", () => {
      const caps: MultiplexerCapabilities = {
        manualLayout: true,
        persistentLabels: false,
      }
      expect(caps.manualLayout).toBe(true)
      expect(caps.persistentLabels).toBe(false)
    })
  })
  //#endregion

  //#region SpawnOptions
  describe("SpawnOptions", () => {
    //#given SpawnOptions type
    //#when creating spawn options
    //#then it should require label and allow optional splitFrom and direction
    it("requires label", () => {
      const opts: SpawnOptions = { label: "new-pane" }
      expect(opts.label).toBe("new-pane")
    })

    it("allows optional splitFrom and direction", () => {
      const handle: PaneHandle = { label: "parent" }
      const opts: SpawnOptions = {
        label: "child",
        splitFrom: handle,
        direction: "horizontal",
      }
      expect(opts.splitFrom?.label).toBe("parent")
      expect(opts.direction).toBe("horizontal")
    })

    it("accepts vertical direction", () => {
      const opts: SpawnOptions = { label: "pane", direction: "vertical" }
      expect(opts.direction).toBe("vertical")
    })
  })
  //#endregion

  //#region Multiplexer interface
  describe("Multiplexer", () => {
    //#given Multiplexer interface
    //#when used as type constraint
    //#then it should enforce required properties and methods
    it("can be used as type constraint", () => {
      const mockMultiplexer: Multiplexer = {
        type: "tmux",
        capabilities: {
          manualLayout: true,
          persistentLabels: false,
        },
        ensureSession: async () => {},
        killSession: async () => {},
        spawnPane: async () => ({ label: "test" }),
        closePane: async () => {},
        getPanes: async () => [],
      }

      expect(mockMultiplexer.type).toBe("tmux")
      expect(mockMultiplexer.capabilities.manualLayout).toBe(true)
    })

    it("enforces all method signatures", async () => {
      const mockMultiplexer: Multiplexer = {
        type: "zellij",
        capabilities: {
          manualLayout: false,
          persistentLabels: true,
        },
        ensureSession: async (name: string) => {
          expect(name).toBe("test-session")
        },
        killSession: async (name: string) => {
          expect(name).toBe("test-session")
        },
        spawnPane: async (cmd: string, options: SpawnOptions) => {
          expect(cmd).toBe("vim")
          expect(options.label).toBe("editor")
          return { label: options.label }
        },
        closePane: async (handle: PaneHandle) => {
          expect(handle.label).toBe("editor")
        },
        getPanes: async () => {
          return [{ label: "main" }, { label: "editor" }]
        },
      }

      await mockMultiplexer.ensureSession("test-session")
      await mockMultiplexer.killSession("test-session")
      const pane = await mockMultiplexer.spawnPane("vim", { label: "editor" })
      expect(pane.label).toBe("editor")
      await mockMultiplexer.closePane(pane)
      const panes = await mockMultiplexer.getPanes()
      expect(panes).toHaveLength(2)
    })
  })
  //#endregion
})
