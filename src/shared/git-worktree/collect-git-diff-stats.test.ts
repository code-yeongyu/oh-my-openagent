/// <reference types="bun-types" />

import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"

describe("collectGitDiffStats", () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>
  let execSyncSpy: ReturnType<typeof spyOn>
  let readFileSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    execSyncSpy = spyOn(childProcess, "execSync").mockImplementation(() => {
      throw new Error("execSync should not be called")
    })

    execFileSyncSpy = spyOn(childProcess, "execFileSync").mockImplementation(
      ((file: string, args: string[], _opts: { cwd?: string }) => {
        if (file !== "git") throw new Error(`unexpected file: ${file}`)
        const subcommand = args[0]

        if (subcommand === "diff") return "1\t2\tfile.ts\n"
        if (subcommand === "status") return " M file.ts\n?? new-file.ts\n"
        if (subcommand === "ls-files") return "new-file.ts\n"

        throw new Error(`unexpected args: ${args.join(" ")}`)
      }) as typeof childProcess.execFileSync
    )

    readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation(
      ((_path: unknown, _encoding: unknown) => {
        return "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n"
      }) as typeof fs.readFileSync
    )
  })

  afterEach(() => {
    execSyncSpy.mockRestore()
    execFileSyncSpy.mockRestore()
    readFileSyncSpy.mockRestore()
  })

  test("uses execFileSync with arg arrays (no shell injection)", async () => {
    //#given
    const { collectGitDiffStats } = await import("./collect-git-diff-stats")
    const directory = "/tmp/safe-repo;touch /tmp/pwn"

    //#when
    const result = collectGitDiffStats(directory)

    //#then
    expect(execSyncSpy).not.toHaveBeenCalled()
    expect(execFileSyncSpy.mock.calls.length).toBeGreaterThanOrEqual(3)

    const calls = execFileSyncSpy.mock.calls as unknown as Array<[string, string[], { cwd?: string }]>
    const diffCall = calls.find(([, args]) => args[0] === "diff")
    const statusCall = calls.find(([, args]) => args[0] === "status")
    const untrackedCall = calls.find(([, args]) => args[0] === "ls-files")

    expect(diffCall).toBeDefined()
    expect(statusCall).toBeDefined()
    expect(untrackedCall).toBeDefined()

    const [diffCallFile, diffCallArgs, diffCallOpts] = diffCall!
    expect(diffCallFile).toBe("git")
    expect(diffCallArgs).toEqual(["diff", "--numstat", "HEAD"])
    expect(diffCallOpts.cwd).toBe(directory)
    expect(diffCallArgs.join(" ")).not.toContain(directory)

    const [statusCallFile, statusCallArgs, statusCallOpts] = statusCall!
    expect(statusCallFile).toBe("git")
    expect(statusCallArgs).toEqual(["status", "--porcelain"])
    expect(statusCallOpts.cwd).toBe(directory)
    expect(statusCallArgs.join(" ")).not.toContain(directory)

    const [untrackedCallFile, untrackedCallArgs, untrackedCallOpts] = untrackedCall!
    expect(untrackedCallFile).toBe("git")
    expect(untrackedCallArgs).toEqual(["ls-files", "--others", "--exclude-standard"])
    expect(untrackedCallOpts.cwd).toBe(directory)
    expect(untrackedCallArgs.join(" ")).not.toContain(directory)

    expect(readFileSyncSpy).toHaveBeenCalled()

    expect(result).toEqual([
      {
        path: "file.ts",
        added: 1,
        removed: 2,
        status: "modified",
      },
      {
        path: "new-file.ts",
        added: 10,
        removed: 0,
        status: "added",
      },
    ])
  })
})
