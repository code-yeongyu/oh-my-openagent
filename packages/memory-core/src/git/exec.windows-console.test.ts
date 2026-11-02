import { afterEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"

// Every git command the memory engine runs - the auto-commit behind the `memory` tool, the
// post-turn sync, every rev-parse/status probe - goes through this one spawn. git.exe is a
// console-subsystem binary, so on Windows a spawn without windowsHide allocates a FRESH console
// window that Windows foregrounds, stealing focus from whatever the human was doing (#8501). The
// flag is inert on posix, so the options object handed to node:child_process is the only place
// this can be proven off Windows.

interface CapturedSpawn {
  readonly executable: string
  readonly argv: readonly string[]
  readonly options: Record<string, unknown>
}

interface SpawnedChildStub {
  readonly stdout: { on: () => void }
  readonly stderr: { on: () => void }
  readonly stdin: { end: () => void }
  readonly kill: () => void
  readonly on: (event: string, handler: (payload: never) => void) => void
}

function closingChild(): SpawnedChildStub {
  return {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    stdin: { end: () => {} },
    kill: () => {},
    on: (event, handler) => {
      if (event === "close") queueMicrotask(() => (handler as (code: number) => void)(0))
    },
  }
}

function missingBinaryChild(): SpawnedChildStub {
  return {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    stdin: { end: () => {} },
    kill: () => {},
    on: (event, handler) => {
      if (event !== "error") return
      const error = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" })
      queueMicrotask(() => (handler as (failure: Error) => void)(error))
    },
  }
}

function captureSpawns(child: (executable: string) => SpawnedChildStub): CapturedSpawn[] {
  const captured: CapturedSpawn[] = []
  mock.module("node:child_process", () => ({
    spawn: (executable: string, argv: readonly string[], options: Record<string, unknown>) => {
      captured.push({ executable, argv, options })
      return child(executable)
    },
  }))
  return captured
}

describe("memory git exec win32 console suppression", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("#given the memory engine running a git command", () => {
    describe("#when the child is spawned", () => {
      test("#then node:child_process receives windowsHide: true", async () => {
        const captured = captureSpawns(() => closingChild())
        const { createNodeGitExec } = await import("./exec")

        const result = await createNodeGitExec().run(["commit", "-m", "memory"], {
          cwd: tmpdir(),
          timeoutMs: 5_000,
        })

        expect(result.code).toBe(0)
        expect(captured).toHaveLength(1)
        expect(captured[0]?.executable).toEqual(process.platform === "win32" ? expect.stringMatching(/^[A-Za-z]:\\.+\\git\.(?:exe|cmd|bat|com)$/i) : "git")
        expect(captured[0]?.options.windowsHide).toBe(true)
      })
    })

    describe("#when the first resolved install root is gone and the next one is spawned", () => {
      test("#then every spawn is hidden", async () => {
        const first = "C:\\Program Files\\Git\\cmd\\git.exe"
        const second = "D:\\Program Files\\Git\\cmd\\git.exe"
        const present = new Set([first, second])
        const captured = captureSpawns((executable) => {
          if (executable !== first) return closingChild()
          present.delete(first)
          return missingBinaryChild()
        })
        const { createNodeGitExec } = await import("./exec")

        await createNodeGitExec({ platform: "win32", isFile: (path) => present.has(path) }).run(["status", "--porcelain"], {
          cwd: tmpdir(),
          timeoutMs: 5_000,
          env: { ProgramFiles: "C:\\Program Files", ProgramW6432: "D:\\Program Files" },
        })

        expect(captured.map((call) => call.executable)).toEqual([first, second])
        expect(captured.map((call) => call.options.windowsHide)).toEqual([true, true])
      })
    })

    describe("#when git resolves to a batch wrapper", () => {
      test("#then cmd.exe runs it explicitly and is hidden", async () => {
        const captured = captureSpawns(() => closingChild())
        const { createNodeGitExec } = await import("./exec")

        await createNodeGitExec({ platform: "win32", isFile: (path) => path === "C:\\Wrap\\git.cmd" }).run(["status"], {
          cwd: tmpdir(),
          timeoutMs: 5_000,
          env: { PATH: "C:\\Wrap", SystemRoot: "C:\\Windows" },
        })

        expect(captured.map((call) => call.executable)).toEqual(["C:\\Windows\\System32\\cmd.exe"])
        expect(captured[0]?.argv).toEqual(["/d", "/s", "/c", "\"\"C:\\Wrap\\git.cmd\" \"status\"\""])
        expect(captured[0]?.options).toMatchObject({ windowsHide: true, windowsVerbatimArguments: true })
      })
    })
  })
})
