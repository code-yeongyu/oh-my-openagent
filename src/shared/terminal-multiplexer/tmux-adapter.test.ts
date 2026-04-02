import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { TmuxAdapter } from "./tmux-adapter"

const MOCK_TMUX_PATH = "/mock/tmux"

function emptyStream() {
  return new ReadableStream({
    start(c: ReadableStreamDefaultController) { c.close() },
  })
}

function streamOf(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(c: ReadableStreamDefaultController) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

function makeMockSpawn() {
  const panes = new Map<string, string>()
  const sessions = new Set<string>()
  const calls: string[][] = []
  let nextPaneId = 0

  function spawn(args: string[], _opts?: any) {
    calls.push([...args])
    const subcommand = args[1]

    if (subcommand === "split-window") {
      const paneId = `%${nextPaneId++}`
      panes.set(paneId, "")
      return {
        exited: Promise.resolve(0),
        stdout: streamOf(`${paneId}\n`),
        stderr: emptyStream(),
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
        stdout: emptyStream(),
        stderr: emptyStream(),
      }
    }

    if (subcommand === "list-panes") {
      const lines = Array.from(panes.entries())
        .map(([id, title]) => `${id},${title}`)
        .join("\n")
      return {
        exited: Promise.resolve(0),
        stdout: streamOf(lines ? lines + "\n" : ""),
        stderr: emptyStream(),
      }
    }

    if (subcommand === "kill-pane") {
      const tIdx = args.indexOf("-t")
      if (tIdx !== -1) {
        panes.delete(args[tIdx + 1])
      }
      return {
        exited: Promise.resolve(0),
        stdout: emptyStream(),
        stderr: emptyStream(),
      }
    }

    if (subcommand === "new-session") {
      const sIdx = args.indexOf("-s")
      if (sIdx !== -1) {
        const name = args[sIdx + 1]
        if (sessions.has(name)) {
          return {
            exited: Promise.resolve(1),
            stdout: emptyStream(),
            stderr: streamOf(`duplicate session: ${name}\n`),
          }
        }
        sessions.add(name)
      }
      return {
        exited: Promise.resolve(0),
        stdout: emptyStream(),
        stderr: emptyStream(),
      }
    }

    if (subcommand === "kill-session") {
      const tIdx = args.indexOf("-t")
      if (tIdx !== -1) {
        const name = args[tIdx + 1]
        if (!sessions.has(name)) {
          return {
            exited: Promise.resolve(1),
            stdout: emptyStream(),
            stderr: streamOf(`session not found: ${name}\n`),
          }
        }
        sessions.delete(name)
      }
      return {
        exited: Promise.resolve(0),
        stdout: emptyStream(),
        stderr: emptyStream(),
      }
    }

    if (subcommand === "send-keys") {
      return {
        exited: Promise.resolve(0),
        stdout: emptyStream(),
        stderr: emptyStream(),
      }
    }

    throw new Error(`makeMockSpawn: unhandled tmux subcommand "${subcommand}"`)
  }

  return { spawn, sessions, calls, panes }
}

function makeAdapter() {
  const mock = makeMockSpawn()
  const adapter = new TmuxAdapter(mock.spawn as any, MOCK_TMUX_PATH)
  return { adapter, mock }
}

describe("TmuxAdapter", () => {
  let adapter: TmuxAdapter
  let mock: ReturnType<typeof makeMockSpawn>

  let savedTmux: string | undefined
  let savedTmuxPane: string | undefined

  beforeEach(() => {
    //#given - create fresh adapter instance with mock spawn
    savedTmux = process.env.TMUX
    savedTmuxPane = process.env.TMUX_PANE
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
    process.env.TMUX_PANE = "%0"
    const result = makeAdapter()
    adapter = result.adapter
    mock = result.mock
  })

  afterEach(() => {
    if (savedTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = savedTmux
    if (savedTmuxPane === undefined) delete process.env.TMUX_PANE
    else process.env.TMUX_PANE = savedTmuxPane
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
      expect(handle.nativeId).toBeDefined()
      const panes = await adapter.getPanes()
      const found = panes.find((p) => p.label === label)
      expect(found).toBeDefined()
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
      await adapter.spawnPane("ls", options)

      //#then
      const splitCall = mock.calls.find((c) => c[1] === "split-window")
      expect(splitCall).toBeDefined()
      expect(splitCall).toContain("-v")
    })

    it("defaults to horizontal direction", async () => {
      //#given
      const options: any = { label: "omo-default-direction" }

      //#when
      await adapter.spawnPane("echo test", options)

      //#then
      const splitCall = mock.calls.find((c) => c[1] === "split-window")
      expect(splitCall).toBeDefined()
      expect(splitCall).toContain("-h")
    })
  })

  describe("closePane", () => {
    it("accepts PaneHandle and closes pane", async () => {
      //#given
      const handle = await adapter.spawnPane("echo hello", { label: "omo-close-test", direction: "horizontal" })

      //#when
      await adapter.closePane(handle)

      //#then
      const killCall = mock.calls.find((c) => c[1] === "kill-pane")
      expect(killCall).toBeDefined()
      expect(killCall).toContain(handle.nativeId)
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
    it("calls new-session with correct arguments", async () => {
      //#given
      const sessionName = "omo-test-session"

      //#when
      await adapter.ensureSession(sessionName)

      //#then
      const newSessionCall = mock.calls.find(c => c[1] === "new-session")
      expect(newSessionCall).toEqual([MOCK_TMUX_PATH, "new-session", "-d", "-s", sessionName])
      expect(mock.sessions.has(sessionName)).toBe(true)
    })

    it("handles duplicate session without throwing", async () => {
      //#given
      const sessionName = "omo-existing-session"
      await adapter.ensureSession(sessionName)

      //#when - second call triggers duplicate (mock returns exit 1)
      const ensurePromise = adapter.ensureSession(sessionName)

      //#then - adapter silently handles the non-zero exit
      await expect(ensurePromise).resolves.toBeUndefined()
    })
  })

  describe("killSession", () => {
    it("calls kill-session with correct arguments", async () => {
      //#given
      const sessionName = "omo-kill-test"
      await adapter.ensureSession(sessionName)

      //#when
      await adapter.killSession(sessionName)

      //#then
      const killCall = mock.calls.find(c => c[1] === "kill-session")
      expect(killCall).toEqual([MOCK_TMUX_PATH, "kill-session", "-t", sessionName])
      expect(mock.sessions.has(sessionName)).toBe(false)
    })

    it("handles killing non-existent session gracefully", async () => {
      //#given
      const sessionName = "omo-nonexistent-session"

      //#when - mock returns exit 1 for non-existent session
      const killPromise = adapter.killSession(sessionName)

      //#then - adapter silently handles the non-zero exit
      await expect(killPromise).resolves.toBeUndefined()
    })
  })
})
