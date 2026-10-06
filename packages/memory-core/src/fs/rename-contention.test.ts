import { describe, expect, it } from "bun:test"
import type { PathLike } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { rename as resilientRename } from "./resilient"
import { renameWithContentionRetry } from "./rename-contention"

function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: rename refused`), { code })
}

function flakyRename(failures: readonly string[]) {
  const calls: Array<[PathLike, PathLike]> = []
  const rename = async (from: PathLike, to: PathLike): Promise<void> => {
    calls.push([from, to])
    const code = failures[calls.length - 1]
    if (code !== undefined) throw fsError(code)
  }
  return { calls, rename }
}

describe("rename under Windows contention", () => {
  it("#given win32 #when the target is held open twice #then the rename retries and lands", async () => {
    const { calls, rename } = flakyRename(["EPERM", "EBUSY"])
    const waits: number[] = []
    await renameWithContentionRetry("a.tmp", "a", { rename, platform: "win32", delaysMs: [5, 7, 9], sleep: async (ms) => { waits.push(ms) } })
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([5, 7])
  })

  it("#given win32 #when the target stays held #then the rename gives up after the retry budget", async () => {
    const { calls, rename } = flakyRename(["EACCES", "EACCES", "EACCES", "EACCES"])
    const settled = renameWithContentionRetry("a.tmp", "a", { rename, platform: "win32", delaysMs: [1, 1], sleep: async () => {} })
    await expect(settled).rejects.toMatchObject({ code: "EACCES" })
    expect(calls).toHaveLength(3)
  })

  it("#given a POSIX platform #when rename reports EPERM #then it fails at once (a real permission error)", async () => {
    const { calls, rename } = flakyRename(["EPERM"])
    const settled = renameWithContentionRetry("a.tmp", "a", { rename, platform: "darwin", delaysMs: [1, 1], sleep: async () => {} })
    await expect(settled).rejects.toMatchObject({ code: "EPERM" })
    expect(calls).toHaveLength(1)
  })

  it("#given win32 #when the source is missing #then it fails at once (not contention)", async () => {
    const { calls, rename } = flakyRename(["ENOENT"])
    const settled = renameWithContentionRetry("a.tmp", "a", { rename, platform: "win32", delaysMs: [1, 1], sleep: async () => {} })
    await expect(settled).rejects.toMatchObject({ code: "ENOENT" })
    expect(calls).toHaveLength(1)
  })

  it("#given the memory fs boundary #when it renames a real file #then the file moves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memory-rename-"))
    await writeFile(join(dir, "state.json.tmp"), "{}\n")
    await resilientRename(join(dir, "state.json.tmp"), join(dir, "state.json"))
    expect(await readFile(join(dir, "state.json"), "utf8")).toBe("{}\n")
  })
})
