import { describe, it, expect, beforeEach } from "bun:test"
import { TmuxAdapter } from "./tmux-adapter"

const mockConfig = {
  enabled: true,
  sessionPrefix: "omo-test",
}

const MOCK_TMUX_PATH = "/mock/tmux"

function makeMockSpawn() {
  const panes = new Map<string, string>()
  let nextPaneId = 0

  return (args: string[], _opts?: any) => {
    const subcommand = args[1]

    if (subcommand === "split-window") {
      const paneId = `%${nextPaneId++}`
      panes.set(paneId, "")
      const bytes = new TextEncoder().encode(`${paneId}\n`)
      return {
        exited: Promise.resolve(0),
        stdout: new ReadableStream({
          start(c: ReadableStreamDefaultController) {
            c.enqueue(bytes)
            c.close()
          },
        }),
        stderr: new ReadableStream({
          start(c: ReadableStreamDefaultController) { c.close() },
        }),
      }
    }

    if (subcommand === "select-pane") {
      const tIdx = args.indexOf("-t")
      const titleIdx = args.indexOf("-T")
      if (tIdx !== -1 && titleIdx !== -1) {
        panes.set(args[tIdx + 1], args[titleIdx + 1])
      }
      return {
        exited: Promise.resolve(0),
        stdout: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
        stderr: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
      }
    }

    if (subcommand === "list-panes") {
      const lines = Array.from(panes.entries())
        .map(([id, title]) => `${id},${title}`)
        .join("\n")
      const bytes = new TextEncoder().encode(lines ? lines + "\n" : "")
      return {
        exited: Promise.resolve(0),
        stdout: new ReadableStream({
          start(c: ReadableStreamDefaultController) {
            c.enqueue(bytes)
            c.close()
          },
        }),
        stderr: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
      }
    }

    if (subcommand === "kill-pane") {
      const tIdx = args.indexOf("-t")
      if (tIdx !== -1) {
        panes.delete(args[tIdx + 1])
      }
      return {
        exited: Promise.resolve(0),
        stdout: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
        stderr: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
      }
    }

    return {
      exited: Promise.resolve(0),
      stdout: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
      stderr: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close() } }),
    }
  }
}

function makeAdapter() {
  return new TmuxAdapter(mockConfig, makeMockSpawn() as any, MOCK_TMUX_PATH)
}

describe("TmuxAdapter", () => {
  let adapter: TmuxAdapter

  beforeEach(() => {
    //#given - create fresh adapter instance with mock spawn
    adapter = makeAdapter()
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
    it("accepts session name and creates session", async () => {
      //#given
      const sessionName = `omo-test-session-${Math.random().toString(36).slice(2, 8)}`

      //#when
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then
      await expect(ensurePromise).resolves.toBeUndefined()
    })

    it("succeeds when session already exists", async () => {
      //#given
      const sessionName = `omo-existing-session-${Math.random().toString(36).slice(2, 8)}`
      await adapter.ensureSession(sessionName)

      //#when
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then - should not throw
      await expect(ensurePromise).resolves.toBeUndefined()
    })
  })

  describe("killSession", () => {
    it("accepts session name and kills session", async () => {
      //#given
      const sessionName = `omo-kill-test-${Math.random().toString(36).slice(2, 8)}`
      await adapter.ensureSession(sessionName)

      //#when
      const killPromise = adapter.killSession(sessionName)

      //#then
      await expect(killPromise).resolves.toBeUndefined()
    })

    it("handles killing non-existent session gracefully", async () => {
      //#given
      const sessionName = `omo-nonexistent-session-${Math.random().toString(36).slice(2, 8)}`

      //#when
      const killPromise = adapter.killSession(sessionName)

      //#then - should not throw
      await expect(killPromise).resolves.toBeUndefined()
    })
  })
})
