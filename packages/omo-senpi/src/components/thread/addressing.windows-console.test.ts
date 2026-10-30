import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"

import { workspaceEntries, type ThreadAddressEntry } from "./addressing"

// Thread scope checks shell out to `git rev-parse --show-toplevel` during ordinary agent usage.
// git.exe is console-subsystem, so on Windows each lookup without windowsHide opens a console
// window that Windows foregrounds and the user's active application loses focus (#8501).
// The probe is observed with spyOn on the module namespace, which mock.restore() undoes after the
// test. mock.module("node:child_process") would not be undone: its fake stayed installed for every
// later file in the same bun process, and the ps/git probes there saw it.

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
      test("#then node:child_process receives windowsHide: true", () => {
        const captured: CapturedExecFileSync[] = []
        spyOn(childProcess, "execFileSync").mockImplementation(((command: string, args: readonly string[], options: Record<string, unknown>) => {
          captured.push({ command, args, options })
          return "/workspace/repo\n"
        }) as unknown as typeof childProcess.execFileSync)

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
