/// <reference types="bun-types" />

import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import * as childProcess from "node:child_process"
import { detectWorktreePath } from "./worktree-detector"

describe("detectWorktreePath", () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    execFileSyncSpy = spyOn(childProcess, "execFileSync").mockImplementation(
      ((_file: string, _args: string[]) => "") as typeof childProcess.execFileSync,
    )
  })

  afterEach(() => {
    execFileSyncSpy.mockRestore()
  })

  describe("when directory is a valid git worktree", () => {
    test("#given valid git dir #when detecting #then returns worktree root path", () => {
      execFileSyncSpy.mockImplementation(
        ((_file: string, _args: string[]) => "/home/user/my-repo\n") as typeof childProcess.execFileSync,
      )

      // when
      const result = detectWorktreePath("/home/user/my-repo/src")

      // then
      expect(result).toBe("/home/user/my-repo")
    })

    test("#given git output with trailing newline #when detecting #then trims output", () => {
      execFileSyncSpy.mockImplementation(
        ((_file: string, _args: string[]) => "/projects/worktree-a\n\n") as typeof childProcess.execFileSync,
      )

      const result = detectWorktreePath("/projects/worktree-a")

      expect(result).toBe("/projects/worktree-a")
    })

    test("#given valid dir #when detecting #then calls git rev-parse with cwd", () => {
      execFileSyncSpy.mockImplementation(
        ((_file: string, _args: string[]) => "/repo\n") as typeof childProcess.execFileSync,
      )

      detectWorktreePath("/repo/some/subdir")

      expect(execFileSyncSpy).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--show-toplevel"],
        expect.objectContaining({ cwd: "/repo/some/subdir" }),
      )
    })
  })

  describe("when directory is not a git worktree", () => {
    test("#given non-git directory #when detecting #then returns null", () => {
      execFileSyncSpy.mockImplementation((_file: string, _args: string[]) => {
        throw new Error("not a git repository")
      })

      const result = detectWorktreePath("/tmp/not-a-repo")

      expect(result).toBeNull()
    })

    test("#given non-existent directory #when detecting #then returns null", () => {
      execFileSyncSpy.mockImplementation((_file: string, _args: string[]) => {
        throw new Error("ENOENT: no such file or directory")
      })

      const result = detectWorktreePath("/nonexistent/path")

      expect(result).toBeNull()
    })
  })
})
