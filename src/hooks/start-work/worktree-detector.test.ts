/// <reference types="bun-types" />

import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import * as childProcess from "node:child_process"
import { detectWorktreePath, parseWorktreeListPorcelain, listWorktrees } from "./worktree-detector"

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

describe("parseWorktreeListPorcelain", () => {
  test("#given porcelain output with multiple worktrees #when parsing #then returns all entries", () => {
    // given
    const output = [
      "worktree /home/user/main-repo",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /home/user/worktrees/feature-a",
      "HEAD def5678",
      "branch refs/heads/feature-a",
      "",
    ].join("\n")

    // when
    const result = parseWorktreeListPorcelain(output)

    // then
    expect(result).toEqual([
      { path: "/home/user/main-repo", branch: "main", bare: false },
      { path: "/home/user/worktrees/feature-a", branch: "feature-a", bare: false },
    ])
  })

  test("#given bare worktree #when parsing #then marks bare flag", () => {
    // given
    const output = [
      "worktree /home/user/bare-repo",
      "HEAD abc1234",
      "bare",
      "",
    ].join("\n")

    // when
    const result = parseWorktreeListPorcelain(output)

    // then
    expect(result).toEqual([
      { path: "/home/user/bare-repo", branch: undefined, bare: true },
    ])
  })

  test("#given empty output #when parsing #then returns empty array", () => {
    expect(parseWorktreeListPorcelain("")).toEqual([])
  })

  test("#given output without trailing newline #when parsing #then still captures last entry", () => {
    // given
    const output = [
      "worktree /repo",
      "HEAD abc1234",
      "branch refs/heads/dev",
    ].join("\n")

    // when
    const result = parseWorktreeListPorcelain(output)

    // then
    expect(result).toEqual([
      { path: "/repo", branch: "dev", bare: false },
    ])
  })
})

describe("listWorktrees", () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    execFileSyncSpy = spyOn(childProcess, "execFileSync").mockImplementation(
      ((_file: string, _args: string[]) => "") as typeof childProcess.execFileSync,
    )
  })

  afterEach(() => {
    execFileSyncSpy.mockRestore()
  })

  test("#given valid git repo #when listing #then returns parsed worktree entries", () => {
    // given
    execFileSyncSpy.mockImplementation(
      ((_file: string, _args: string[]) =>
        "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n") as typeof childProcess.execFileSync,
    )

    // when
    const result = listWorktrees("/repo")

    // then
    expect(result).toEqual([{ path: "/repo", branch: "main", bare: false }])
    expect(execFileSyncSpy).toHaveBeenCalledWith(
      "git",
      ["worktree", "list", "--porcelain"],
      expect.objectContaining({ cwd: "/repo" }),
    )
  })

  test("#given non-git directory #when listing #then returns empty array", () => {
    // given
    execFileSyncSpy.mockImplementation((_file: string, _args: string[]) => {
      throw new Error("not a git repository")
    })

    // when
    const result = listWorktrees("/tmp/not-a-repo")

    // then
    expect(result).toEqual([])
  })
})
