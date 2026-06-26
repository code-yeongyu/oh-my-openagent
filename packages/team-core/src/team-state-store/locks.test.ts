import { expect, test } from "bun:test"
import type { Mode, OpenMode, PathLike } from "node:fs"
import { mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function createTempDirectory(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

function createSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolveSignal: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve
  })

  if (resolveSignal === undefined) {
    throw new Error("signal resolver was not initialized")
  }

  return { promise, resolve: resolveSignal }
}

function createErrnoError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

test("withLock serializes concurrent work", async () => {
  // given
  const { withLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-serialize-")
  const lockPath = join(rootDirectory, "lock")
  const probePath = join(rootDirectory, "probe.txt")
  await writeFile(probePath, "ready")
  const activeMarkers = new Set<string>()
  const overlapObserved: string[] = []
  const firstAcquired = createSignal()
  const releaseFirst = createSignal()

  // when
  const first = withLock(lockPath, async () => {
    activeMarkers.add("first")
    await writeFile(probePath, "first-start")
    firstAcquired.resolve()
    await releaseFirst.promise
    if (activeMarkers.has("second")) overlapObserved.push("first")
    activeMarkers.delete("first")
    return "first"
  })

  await firstAcquired.promise

  const second = withLock(lockPath, async () => {
    activeMarkers.add("second")
    if (activeMarkers.has("first")) overlapObserved.push("second")
    const currentProbe = await readFile(probePath, "utf8")
    activeMarkers.delete("second")
    return currentProbe
  })

  releaseFirst.resolve()
  const results = await Promise.all([first, second])

  // then
  expect(results[0]).toBe("first")
  expect(results).toHaveLength(2)
  expect(overlapObserved).toEqual([])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite leaves no partial file when rename fails", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-")
  const targetPath = join(rootDirectory, "target.txt")
  await writeFile(targetPath, "old content")
  const renameCalls: string[] = []

  const { atomicWrite } = await import("./locks")

  // when
  const result = atomicWrite(targetPath, "new content", {
    rename: async (from: PathLike, to: PathLike) => {
      renameCalls.push(`${from}->${to}`)
      throw new Error("rename failed")
    },
  })

  // then
  expect(result).rejects.toThrow("rename failed")
  expect(await readFile(targetPath, "utf8")).toBe("old content")
  expect(renameCalls).toHaveLength(1)

  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries.some((entry) => entry.startsWith("target.txt.tmp."))).toBe(false)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("lock open treats EPERM as contention when the lock path exists", async () => {
  // given
  const { assertRetryableLockOpenError } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-eperm-existing-")
  const lockPath = join(rootDirectory, "lock")
  await writeFile(lockPath, "owner\n123\n456\n")

  // when
  const result = assertRetryableLockOpenError(lockPath, createErrnoError("EPERM"))

  // then
  await expect(result).resolves.toBeUndefined()
  await rm(rootDirectory, { recursive: true, force: true })
})

test("lock open treats EPERM access probes as possible contention", async () => {
  // given
  const { assertRetryableLockOpenError } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-eperm-access-")
  const lockPath = join(rootDirectory, "lock")
  const accessCalls: string[] = []

  // when
  const result = assertRetryableLockOpenError(lockPath, createErrnoError("EPERM"), {
    access: async (path: PathLike) => {
      accessCalls.push(String(path))
      throw createErrnoError("EPERM")
    },
  })

  // then
  await expect(result).resolves.toBeUndefined()
  expect(accessCalls).toEqual([lockPath])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("lock open rethrows EPERM when the lock path does not exist", async () => {
  // given
  const { assertRetryableLockOpenError } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-eperm-missing-")
  const lockPath = join(rootDirectory, "lock")

  // when
  const result = assertRetryableLockOpenError(lockPath, createErrnoError("EPERM"))

  // then
  await expect(result).rejects.toThrow("EPERM")
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite syncs temp files through a writable handle", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-writable-")
  const targetPath = join(rootDirectory, "target.txt")
  const openFlags: string[] = []

  const { atomicWrite } = await import("./locks")

  // when
  await atomicWrite(targetPath, "new content", {
    rename,
    open: async (filePath: PathLike, flags?: OpenMode, mode?: Mode) => {
      openFlags.push(String(flags))
      return await open(filePath, flags, mode)
    },
  })

  // then
  expect(openFlags).toEqual(["wx"])
  expect(await readFile(targetPath, "utf8")).toBe("new content")
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
