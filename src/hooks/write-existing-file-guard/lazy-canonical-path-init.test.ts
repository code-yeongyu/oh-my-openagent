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
    const existingFile = join(tempDir, "existing.txt")
    writeFileSync(existingFile, "content")

    // when
    const hook = createWriteExistingFileGuardHook({ directory: tempDir } as never)

    // then
    expect(existsSyncMock).toHaveBeenCalledTimes(0)
    expect(realpathNativeMock).toHaveBeenCalledTimes(0)

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
    expect(existsSyncMock).toHaveBeenCalledTimes(3)
    expect(realpathNativeMock).toHaveBeenCalledTimes(2)
  })
})
