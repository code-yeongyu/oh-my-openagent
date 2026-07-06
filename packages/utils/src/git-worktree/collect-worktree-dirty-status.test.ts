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

  test("dirty tracked status output → lifecycle dirty, hasLocalOnlyChanges true", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, args: string[], _opts: { cwd?: string }) => {
        if (args.includes("--ignored")) return ""
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
      ignoredOmoShort: "",
    })
  })

  test("clean status output + no ignored .omo → lifecycle clean, hasLocalOnlyChanges false", async () => {
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
      ignoredOmoShort: "",
    })
  })

  test("whitespace-only status output + no ignored .omo → lifecycle clean", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, args: string[], _opts: { cwd?: string }) => {
        if (args.includes("--ignored")) return ""
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

  test("primary git command throws → lifecycle unknown, never clean", async () => {
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
    expect(result.ignoredOmoShort).toBe("")
    expect(result.errorMessage).toContain("not a git repository")
  })

  test("ignored .omo state only (plain status empty) → lifecycle dirty, surfaces ignored paths", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, args: string[], _opts: { cwd?: string }) => {
        if (args.includes("--ignored")) return "!! .omo/start-work/\n!! .omo/boulder.json\n"
        return ""
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/some-worktree")

    //#then
    expect(result.lifecycle).toBe("dirty")
    expect(result.hasLocalOnlyChanges).toBe(true)
    expect(result.statusShort).toBe("")
    expect(result.ignoredOmoShort).toBe("!! .omo/start-work/\n!! .omo/boulder.json")
  })

  test("primary clean + ignored check throws → lifecycle unknown (never false clean)", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, args: string[], _opts: { cwd?: string }) => {
        if (args.includes("--ignored")) throw new Error("fatal: worktree disappeared")
        return ""
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/some-worktree")

    //#then
    expect(result.lifecycle).toBe("unknown")
    expect(result.hasLocalOnlyChanges).toBe(false)
    expect(result.statusShort).toBe("")
    expect(result.ignoredOmoShort).toBe("")
    expect(result.errorMessage).toContain("ignored .omo check failed")
    expect(result.errorMessage).toContain("worktree disappeared")
  })

  test("primary dirty + ignored check throws → still dirty (ignored failure cannot downgrade)", async () => {
    //#given
    execFileSyncSpy.mockImplementation(
      ((_file: string, args: string[], _opts: { cwd?: string }) => {
        if (args.includes("--ignored")) throw new Error("ignored check boom")
        return " M src/a.ts\n"
      }) as typeof childProcess.execFileSync,
    )
    const { collectWorktreeDirtyStatus } = await import("./collect-worktree-dirty-status")

    //#when
    const result = collectWorktreeDirtyStatus("/tmp/some-worktree")

    //#then
    expect(result.lifecycle).toBe("dirty")
    expect(result.hasLocalOnlyChanges).toBe(true)
    expect(result.statusShort).toBe(" M src/a.ts")
    expect(result.ignoredOmoShort).toBe("")
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
    expect(execFileSyncSpy.mock.calls.length).toBe(2)

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

    const [ignoredFile, ignoredArgs] = calls[1]
    expect(ignoredFile).toBe("git")
    expect(ignoredArgs).toEqual(["status", "--short", "--ignored", "--", ".omo"])
  })
})
