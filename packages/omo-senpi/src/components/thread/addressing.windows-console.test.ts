import { afterEach, describe, expect, mock, test } from "bun:test"

import type { ThreadAddressEntry } from "./addressing"

// Thread scope checks shell out to `git rev-parse --show-toplevel` during ordinary agent usage.
// git.exe is console-subsystem, so on Windows each lookup without windowsHide opens a console
// window that Windows foregrounds and the user's active application loses focus (#8501).

interface CapturedExecFileSync {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Record<string, unknown>
}

function entry(threadId: string, cwd: string): ThreadAddressEntry {
  return {
    thread_id: threadId,
    name: threadId,
    status: "resumable",
    cwd,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  }
}

describe("thread addressing win32 console suppression", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("#given a workspace scope check that resolves the git worktree root", () => {
    describe("#when git is invoked", () => {
      test("#then node:child_process receives windowsHide: true", async () => {
        const captured: CapturedExecFileSync[] = []
        mock.module("node:child_process", () => ({
          execFileSync: (command: string, args: readonly string[], options: Record<string, unknown>) => {
            captured.push({ command, args, options })
            return "/workspace/repo\n"
          },
        }))
        const { workspaceEntries } = await import("./addressing")

        const scoped = workspaceEntries([entry("t1", "/workspace/repo/app")], "/workspace/repo")

        expect(scoped).toHaveLength(1)
        expect(captured.length).toBeGreaterThan(0)
        expect(captured[0]?.command).toBe("git")
        expect(captured[0]?.args).toContain("--show-toplevel")
        expect(captured.map((call) => call.options.windowsHide)).toEqual(captured.map(() => true))
      })
    })
  })
})
