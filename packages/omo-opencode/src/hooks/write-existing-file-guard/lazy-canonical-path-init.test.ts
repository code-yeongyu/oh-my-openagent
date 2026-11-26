import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const realFs = await import("node:fs")

describe("createWriteExistingFileGuardHook", () => {
  let tempDir = ""
  let existsSyncMock: ReturnType<typeof mock<typeof realFs.existsSync>>
  let realpathNativeMock: ReturnType<typeof mock<typeof realFs.realpathSync.native>>

  beforeEach(() => {
    // given
    tempDir = mkdtempSync(join(tmpdir(), "write-existing-file-guard-lazy-"))
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("#given hook factory #when created #then defers fs canonical path calls until first tool invocation", async () => {
    // given
    existsSyncMock = mock(realFs.existsSync)
    realpathNativeMock = mock(realFs.realpathSync.native)
    mock.module("fs", () => ({
      ...realFs,
      existsSync: existsSyncMock,
      realpathSync: {
        ...realFs.realpathSync,
        native: realpathNativeMock,
      },
    }))
    const { createWriteExistingFileGuardHook } = await import(`./hook?test=${crypto.randomUUID()}`)
    existsSyncMock.mockClear()
    realpathNativeMock.mockClear()
    const existingFile = join(tempDir, "existing.txt")
    writeFileSync(existingFile, "content")
    // Count only probes of the paths this hook canonicalises: late async work
    // from an earlier file in the same process (a logger flush) also calls
    // existsSync and must not change this hook's observed behaviour.
    const ownPaths = new Set([tempDir, existingFile])
    const ownProbes = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
      calls.filter(([path]) => typeof path === "string" && ownPaths.has(path)).length

    // when
    const hook = createWriteExistingFileGuardHook({ directory: tempDir } as never)

    // then
    expect(ownProbes(existsSyncMock.mock.calls)).toBe(0)
    expect(ownProbes(realpathNativeMock.mock.calls)).toBe(0)

    // when
    await expect(
      hook["tool.execute.before"]?.(
        {
          tool: "write",
          sessionID: "ses_lazy",
          callID: "call_lazy",
        } as never,
        { args: { filePath: existingFile, content: "updated" } } as never,
      ),
    ).rejects.toThrow("File already exists. Use edit tool instead.")

    // then
    expect(ownProbes(existsSyncMock.mock.calls)).toBe(3)
    expect(ownProbes(realpathNativeMock.mock.calls)).toBe(2)
  })

  test("#given realpath throws a non-Error #when canonicalizing an existing path #then it returns the input path fallback", async () => {
    // given
    const thrown = { kind: "realpath-thrown-value" } as const
    existsSyncMock = mock(() => true)
    realpathNativeMock = mock(() => {
      throw thrown
    })
    mock.module("fs", () => ({
      ...realFs,
      existsSync: existsSyncMock,
      realpathSync: {
        ...realFs.realpathSync,
        native: realpathNativeMock,
      },
    }))
    const { toCanonicalPath } = await import(`./hook?test=${crypto.randomUUID()}`)

    // when
    const result = toCanonicalPath(join(tempDir, "existing.txt"))

    // then
    expect(result).toBe(join(tempDir, "existing.txt"))
  })
})
