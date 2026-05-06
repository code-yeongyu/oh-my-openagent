import { afterEach, expect, mock, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function createTempDirectory(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

afterEach(() => {
  mock.restore()
})

test("withLock serializes concurrent work", async () => {
  // given
  const { withLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-serialize-")
  const lockPath = join(rootDirectory, "lock")
  const probePath = join(rootDirectory, "probe.txt")
  await writeFile(probePath, "ready")
  const activeMarkers = new Set<string>()
  const overlapObserved: string[] = []

  // when
  const first = withLock(lockPath, async () => {
    activeMarkers.add("first")
    await writeFile(probePath, "first-start")
    await new Promise((resolve) => setTimeout(resolve, 75))
    if (activeMarkers.has("second")) overlapObserved.push("first")
    activeMarkers.delete("first")
    return "first"
  })

  const second = withLock(lockPath, async () => {
    activeMarkers.add("second")
    if (activeMarkers.has("first")) overlapObserved.push("second")
    const currentProbe = await readFile(probePath, "utf8")
    activeMarkers.delete("second")
    return currentProbe
  })

  const results = await Promise.all([first, second])

  // then
  expect(results[0]).toBe("first")
  expect(results).toHaveLength(2)
  expect(overlapObserved).toEqual([])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite leaves no partial file when rename fails", async () => {
  // given
  const fsPromises = await import("node:fs/promises")
  const rootDirectory = await createTempDirectory("locks-atomic-")
  const targetPath = join(rootDirectory, "target.txt")
  await writeFile(targetPath, "old content")
  const renameCalls: string[] = []

  mock.module("node:fs/promises", () => ({
    ...fsPromises,
    rename: async (from: string, to: string) => {
      renameCalls.push(`${from}->${to}`)
      throw new Error("rename failed")
    },
  }))

  const { atomicWrite } = await import("./locks")

  // when
  const result = atomicWrite(targetPath, "new content")

  // then
  expect(result).rejects.toThrow("rename failed")
  expect(await readFile(targetPath, "utf8")).toBe("old content")
  expect(renameCalls).toHaveLength(1)

  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries.some((entry) => entry.startsWith("target.txt.tmp."))).toBe(false)
  mock.restore()
  await rm(rootDirectory, { recursive: true, force: true })
})

test("detects and reaps stale lock entries", async () => {
  // given
  const { detectStaleLock, reapStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-stale-")
  const lockPath = join(rootDirectory, "lock")
  const staleContent = `fake-owner-name\n999999999\n${Date.now() - 600_000}\n`
  await writeFile(lockPath, staleContent)

  // when
  const staleDetected = await detectStaleLock(lockPath, 300_000)
  await reapStaleLock(lockPath)

  // then
  expect(staleDetected).toBe(true)
  expect(readFile(lockPath, "utf8")).rejects.toThrow()
  await rm(rootDirectory, { recursive: true, force: true })
})
