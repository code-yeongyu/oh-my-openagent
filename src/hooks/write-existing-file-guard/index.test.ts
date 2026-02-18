import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { createWriteExistingFileGuardHook } from "./index"

const BLOCK_MESSAGE = "File already exists. Use edit tool instead."

type Hook = ReturnType<typeof createWriteExistingFileGuardHook>

function isCaseInsensitiveFilesystem(directory: string): boolean {
  const probeName = `CaseProbe_${Date.now()}_A.txt`
  const upperPath = join(directory, probeName)
  const lowerPath = join(directory, probeName.toLowerCase())

  writeFileSync(upperPath, "probe")
  try {
    return existsSync(lowerPath)
  } finally {
    rmSync(upperPath, { force: true })
  }
}

describe("createWriteExistingFileGuardHook", () => {
  let tempDir = ""
  let hook: Hook
  let callCounter = 0

  const createFile = (relativePath: string, content = "existing content"): string => {
    const absolutePath = join(tempDir, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content)
    return absolutePath
  }

  const invoke = async (args: {
    tool: string
    sessionID?: string
    outputArgs: Record<string, unknown>
  }): Promise<{ args: Record<string, unknown> }> => {
    callCounter += 1
    const output = { args: args.outputArgs }

    await hook["tool.execute.before"]?.(
      {
        tool: args.tool,
        sessionID: args.sessionID ?? "ses_default",
        callID: `call_${callCounter}`,
      } as never,
      output as never
    )

    return output
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-existing-file-guard-"))
    hook = createWriteExistingFileGuardHook({ directory: tempDir } as never)
    callCounter = 0
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("#given non-existing file #when write executes #then allows", async () => {
    await expect(
      invoke({
        tool: "write",
        outputArgs: { filePath: join(tempDir, "new-file.txt"), content: "new content" },
      })
    ).resolves.toBeDefined()
  })

  test("#given existing file without read or overwrite #when write executes #then blocks", async () => {
    const existingFile = createFile("existing.txt")

    await expect(
      invoke({
        tool: "write",
        outputArgs: { filePath: existingFile, content: "new content" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
  })

  test("#given same-session read #when write executes #then allows once and consumes permission", async () => {
    const existingFile = createFile("consume-once.txt")
    const sessionID = "ses_consume"

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: existingFile },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "first overwrite" },
      })
    ).resolves.toBeDefined()

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "second overwrite" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
  })

  test("#given read in another session #when write executes #then blocks", async () => {
    const existingFile = createFile("cross-session.txt")

    await invoke({
      tool: "read",
      sessionID: "ses_reader",
      outputArgs: { filePath: existingFile },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID: "ses_writer",
        outputArgs: { filePath: existingFile, content: "new content" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
  })

  test("#given overwrite true boolean #when write executes #then bypasses guard and strips overwrite", async () => {
    const existingFile = createFile("overwrite-boolean.txt")

    const output = await invoke({
      tool: "write",
      outputArgs: {
        filePath: existingFile,
        content: "new content",
        overwrite: true,
      },
    })

    expect(output.args.overwrite).toBeUndefined()
  })

  test("#given overwrite true string #when write executes #then bypasses guard and strips overwrite", async () => {
    const existingFile = createFile("overwrite-string.txt")

    const output = await invoke({
      tool: "write",
      outputArgs: {
        filePath: existingFile,
        content: "new content",
        overwrite: "true",
      },
    })

    expect(output.args.overwrite).toBeUndefined()
  })

  test("#given two sessions read same file #when one writes #then other session is invalidated", async () => {
    const existingFile = createFile("invalidate.txt")

    await invoke({
      tool: "read",
      sessionID: "ses_a",
      outputArgs: { filePath: existingFile },
    })
    await invoke({
      tool: "read",
      sessionID: "ses_b",
      outputArgs: { filePath: existingFile },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID: "ses_b",
        outputArgs: { filePath: existingFile, content: "updated by B" },
      })
    ).resolves.toBeDefined()

    await expect(
      invoke({
        tool: "write",
        sessionID: "ses_a",
        outputArgs: { filePath: existingFile, content: "updated by A" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
  })

  test("#given existing file under .sisyphus #when write executes #then always allows", async () => {
    const existingFile = createFile(".sisyphus/plans/plan.txt")

    await expect(
      invoke({
        tool: "write",
        outputArgs: { filePath: existingFile, content: "new plan" },
      })
    ).resolves.toBeDefined()
  })

  test("#given file arg variants #when read then write executes #then supports all variants", async () => {
    const existingFile = createFile("variants.txt")
    const variants: Array<"filePath" | "path" | "file_path"> = [
      "filePath",
      "path",
      "file_path",
    ]

    for (const variant of variants) {
      const sessionID = `ses_${variant}`
      await invoke({
        tool: "read",
        sessionID,
        outputArgs: { [variant]: existingFile },
      })

      await expect(
        invoke({
          tool: "write",
          sessionID,
          outputArgs: { [variant]: existingFile, content: `overwrite via ${variant}` },
        })
      ).resolves.toBeDefined()
    }
  })

  test("#given relative read and absolute write #when same session writes #then allows", async () => {
    createFile("relative-absolute.txt")
    const sessionID = "ses_relative_absolute"
    const relativePath = "relative-absolute.txt"
    const absolutePath = resolve(tempDir, relativePath)

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: relativePath },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: absolutePath, content: "updated" },
      })
    ).resolves.toBeDefined()
  })

  test("#given case-different read path #when writing canonical path #then follows platform behavior", async () => {
    const canonicalFile = createFile("CaseFile.txt")
    const lowerCasePath = join(tempDir, "casefile.txt")
    const sessionID = "ses_case"
    const isCaseInsensitiveFs = isCaseInsensitiveFilesystem(tempDir)

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: lowerCasePath },
    })

    const writeAttempt = invoke({
      tool: "write",
      sessionID,
      outputArgs: { filePath: canonicalFile, content: "updated" },
    })

    if (isCaseInsensitiveFs) {
      await expect(writeAttempt).resolves.toBeDefined()
      return
    }

    await expect(writeAttempt).rejects.toThrow(BLOCK_MESSAGE)
  })

  test("#given read via symlink #when write via real path #then allows overwrite", async () => {
    const targetFile = createFile("real/target.txt")
    const symlinkPath = join(tempDir, "linked-target.txt")
    const sessionID = "ses_symlink"

    try {
      symlinkSync(targetFile, symlinkPath)
    } catch {
      return
    }

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: symlinkPath },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: targetFile, content: "updated via symlink read" },
      })
    ).resolves.toBeDefined()
  })

  test("#given recently active session #when lru evicts #then keeps recent session permission", async () => {
    const existingFile = createFile("lru.txt")
    const hotSession = "ses_hot"

    await invoke({
      tool: "read",
      sessionID: hotSession,
      outputArgs: { filePath: existingFile },
    })

    for (let index = 0; index < 255; index += 1) {
      await invoke({
        tool: "read",
        sessionID: `ses_${index}`,
        outputArgs: { filePath: existingFile },
      })
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2))

    await invoke({
      tool: "read",
      sessionID: hotSession,
      outputArgs: { filePath: existingFile },
    })

    await invoke({
      tool: "read",
      sessionID: "ses_overflow",
      outputArgs: { filePath: existingFile },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID: hotSession,
        outputArgs: { filePath: existingFile, content: "hot session write" },
      })
    ).resolves.toBeDefined()
  })

  test("#given session permissions #when session deleted #then subsequent writes are blocked", async () => {
    const existingFile = createFile("cleanup.txt")
    const sessionID = "ses_cleanup"

    // establish permission by reading the existing file
    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: existingFile },
    })

    // sanity check: write should be allowed while the session is active
    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "first write" },
      })
    ).resolves.toBeDefined()

    // delete the session to trigger cleanup of any stored permissions/state
    await invoke({
      tool: "session.deleted",
      sessionID,
      outputArgs: {},
    })

    // after session deletion, the previous permissions must no longer apply
    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "second write after delete" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
  })
})
