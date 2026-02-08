/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"

const execSyncMock = mock(() => {
  throw new Error("execSync should not be called")
})

const execFileSyncMock = mock((file: string, args: string[], _opts: { cwd?: string }) => {
  if (file !== "git") throw new Error(`unexpected file: ${file}`)
  const subcommand = args[0]

  if (subcommand === "diff") {
    return "1\t2\tfile.ts\n"
  }

  if (subcommand === "status") {
    return " M file.ts\n"
  }

  throw new Error(`unexpected args: ${args.join(" ")}`)
})

mock.module("node:child_process", () => ({
  execSync: execSyncMock,
  execFileSync: execFileSyncMock,
}))

const { collectGitDiffStats } = await import("./collect-git-diff-stats")

describe("collectGitDiffStats", () => {
  test("uses execFileSync with arg arrays (no shell injection)", () => {
    //#given
    const directory = "/tmp/safe-repo;touch /tmp/pwn"

    //#when
    const result = collectGitDiffStats(directory)

    //#then
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).toHaveBeenCalledTimes(2)

    const [firstCallFile, firstCallArgs, firstCallOpts] = execFileSyncMock.mock
      .calls[0]! as unknown as [string, string[], { cwd?: string }]
    expect(firstCallFile).toBe("git")
    expect(firstCallArgs).toEqual(["diff", "--numstat", "HEAD"])
    expect(firstCallOpts.cwd).toBe(directory)
    expect(firstCallArgs.join(" ")).not.toContain(directory)

    const [secondCallFile, secondCallArgs, secondCallOpts] = execFileSyncMock.mock
      .calls[1]! as unknown as [string, string[], { cwd?: string }]
    expect(secondCallFile).toBe("git")
    expect(secondCallArgs).toEqual(["status", "--porcelain"])
    expect(secondCallOpts.cwd).toBe(directory)
    expect(secondCallArgs.join(" ")).not.toContain(directory)

    expect(result).toEqual([
      {
        path: "file.ts",
        added: 1,
        removed: 2,
        status: "modified",
      },
    ])
  })
})
