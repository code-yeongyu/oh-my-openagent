import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { MAX_TRACKED_PATHS_PER_SESSION } from "./hook"
import { createWriteExistingFileGuardHook } from "./index"

const BLOCK_MESSAGE = "File already exists. Use edit tool instead."
const OUTSIDE_SESSION_MESSAGE = "Path must be inside session directory."

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

  const emitSessionDeleted = async (sessionID: string): Promise<void> => {
    await hook.event?.({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })
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

  test("#given same-session concurrent writes #when only one read permission exists #then allows only one write", async () => {
    const existingFile = createFile("concurrent-consume.txt")
    const sessionID = "ses_concurrent"

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: existingFile },
    })

    const results = await Promise.allSettled([
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "first attempt" },
      }),
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "second attempt" },
      }),
    ])

    const successCount = results.filter((result) => result.status === "fulfilled").length
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )

    expect(successCount).toBe(1)
    expect(failures).toHaveLength(1)
    expect(String(failures[0]?.reason)).toContain(BLOCK_MESSAGE)
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

  test("#given overwrite falsy values #when write executes #then does not bypass guard", async () => {
    const existingFile = createFile("overwrite-falsy.txt")

    for (const overwrite of [false, "false"] as const) {
      await expect(
        invoke({
          tool: "write",
          outputArgs: {
            filePath: existingFile,
            content: "new content",
            overwrite,
          },
        })
      ).rejects.toThrow(BLOCK_MESSAGE)
    }
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

  test("#given tools without file path arg #when write and read execute #then ignores safely", async () => {
    await expect(
      invoke({
        tool: "write",
        outputArgs: { content: "no path" },
      })
    ).resolves.toBeDefined()

    await expect(
      invoke({
        tool: "read",
        outputArgs: {},
      })
    ).resolves.toBeDefined()
  })

  test("#given non-read-write tool #when it executes #then does not grant write permission", async () => {
    const existingFile = createFile("ignored-tool.txt")
    const sessionID = "ses_ignored_tool"

    await invoke({
      tool: "edit",
      sessionID,
      outputArgs: { filePath: existingFile, oldString: "old", newString: "new" },
    })

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "should block" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
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

  test("#given existing file outside session directory #when write executes #then blocks", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "write-existing-file-guard-outside-"))

    try {
      const outsideFile = join(outsideDir, "outside.txt")
      writeFileSync(outsideFile, "outside")

      await expect(
        invoke({
          tool: "write",
          outputArgs: { filePath: outsideFile, content: "attempted overwrite" },
        })
      ).rejects.toThrow(OUTSIDE_SESSION_MESSAGE)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  test("#given session read permission #when session deleted #then permission is cleaned up", async () => {
    const existingFile = createFile("session-cleanup.txt")
    const sessionID = "ses_cleanup"

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: existingFile },
    })

    await emitSessionDeleted(sessionID)

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: existingFile, content: "after cleanup" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)
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
    } catch (error) {
      console.warn(
        "Skipping symlink test: symlinks are not supported or cannot be created in this environment.",
        error
      )
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

  test("#given session reads beyond path cap #when writing oldest and newest #then only newest is authorized", async () => {
    const sessionID = "ses_path_cap"
    const oldestFile = createFile("path-cap/0.txt")
    let newestFile = oldestFile

    await invoke({
      tool: "read",
      sessionID,
      outputArgs: { filePath: oldestFile },
    })

    for (let index = 1; index <= MAX_TRACKED_PATHS_PER_SESSION; index += 1) {
      newestFile = createFile(`path-cap/${index}.txt`)
      await invoke({
        tool: "read",
        sessionID,
        outputArgs: { filePath: newestFile },
      })
    }

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: oldestFile, content: "stale write" },
      })
    ).rejects.toThrow(BLOCK_MESSAGE)

    await expect(
      invoke({
        tool: "write",
        sessionID,
        outputArgs: { filePath: newestFile, content: "fresh write" },
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
