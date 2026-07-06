/// <reference types="bun-types" />

import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import * as childProcess from "node:child_process"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

describe("collectWorktreeDirtyStatus", () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>
  let execSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    execSyncSpy = spyOn(childProcess, "execSync").mockImplementation(() => {
      throw new Error("execSync should not be called")
    })
    execFileSyncSpy = spyOn(childProcess, "execFileSync")
  })

  afterEach(() => {
    execSyncSpy.mockRestore()
    execFileSyncSpy.mockRestore()
  })

  test("dirty status output → lifecycle dirty, hasLocalOnlyChanges true", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, _args: string[], _opts: { cwd?: string }) => {
        return " M src/a.ts\n?? new.txt\n"
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/some-worktree")

    //#then
    expect(result).toEqual({
      lifecycle: "dirty",
      hasLocalOnlyChanges: true,
      statusShort: " M src/a.ts\n?? new.txt",
    })
  })

  test("clean status output → lifecycle clean, hasLocalOnlyChanges false", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, _args: string[], _opts: { cwd?: string }) => {
        return ""
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/some-worktree")

    //#then
    expect(result).toEqual({
      lifecycle: "clean",
      hasLocalOnlyChanges: false,
      statusShort: "",
    })
  })

  test("whitespace-only status output → lifecycle clean", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, _args: string[], _opts: { cwd?: string }) => {
        return "   \n  \n"
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/some-worktree")

    //#then
    expect(result.lifecycle).toBe("clean")
    expect(result.hasLocalOnlyChanges).toBe(false)
  })

  test("thrown git command → lifecycle unknown, never clean", async () => {
    //#given
    execFileSyncSpy.mockImplementation(((_file: string, _args: string[], _opts: { cwd?: string }) => {
      throw new Error("fatal: not a git repository")
    }) as unknown as typeof childProcess.execFileSync)
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/removed-worktree")

    //#then
    expect(result.lifecycle).toBe("unknown")
    expect(result.hasLocalOnlyChanges).toBe(false)
    expect(result.statusShort).toBe("")
    expect(result.errorMessage).toContain("not a git repository")
  })

  test("uses execFileSync with arg arrays (no shell, cwd set, no execSync)", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, _args: string[], _opts: { cwd?: string }) => {
        return ""
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")
    const worktreePath = "/tmp/some-worktree;touch /tmp/pwn"

    //#when
    collectWorktreeDirtyStatus(worktreePath)

    //#then
    expect(execSyncSpy).not.toHaveBeenCalled()
    expect(execFileSyncSpy.mock.calls.length).toBe(1)

    const calls = unsafeTestValue<Array<[string, string[], { cwd?: string; encoding?: string; timeout?: number; stdio?: unknown }]>>(
      execFileSyncSpy.mock.calls,
    )
    const [callFile, callArgs, callOpts] = calls[0]
    expect(callFile).toBe("git")
    expect(callArgs).toEqual(["status", "--short"])
    expect(callOpts).toEqual({
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    expect(callArgs.join(" ")).not.toContain(worktreePath)
  })
})
