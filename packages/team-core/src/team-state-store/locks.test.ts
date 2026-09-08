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
  await expect(result).rejects.toThrow("rename failed")
  expect(await readFile(targetPath, "utf8")).toBe("old content")
  expect(renameCalls).toHaveLength(1)

  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries.some((entry) => entry.startsWith("target.txt.tmp."))).toBe(false)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite retries a transient Windows EPERM on rename and then lands the new content", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-win-retry-")
  const targetPath = join(rootDirectory, "state.json")
  await writeFile(targetPath, "old content")
  const delayCalls: number[] = []
  let renameCalls = 0

  const { atomicWrite } = await import("./locks")

  // when
  await atomicWrite(targetPath, "new content", {
    platform: "win32",
    delay: async (ms: number) => {
      delayCalls.push(ms)
    },
    rename: async (from: PathLike, to: PathLike) => {
      renameCalls += 1
      if (renameCalls <= 2) {
        throw createErrnoError("EPERM")
      }
      await rename(from, to)
    },
  })

  // then
  expect(await readFile(targetPath, "utf8")).toBe("new content")
  expect(renameCalls).toBe(3)
  expect(delayCalls).toEqual([50, 100])
  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries.some((entry) => entry.startsWith("state.json.tmp."))).toBe(false)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite stops retrying a Windows rename after the bounded attempts and leaves no partial file", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-win-exhaust-")
  const targetPath = join(rootDirectory, "state.json")
  await writeFile(targetPath, "old content")
  const delayCalls: number[] = []
  let renameCalls = 0

  const { atomicWrite } = await import("./locks")

  // when
  const result = atomicWrite(targetPath, "new content", {
    platform: "win32",
    delay: async (ms: number) => {
      delayCalls.push(ms)
    },
    rename: async () => {
      renameCalls += 1
      throw createErrnoError("EBUSY")
    },
  })

  // then
  await expect(result).rejects.toThrow("EBUSY")
  expect(renameCalls).toBe(5)
  expect(delayCalls).toEqual([50, 100, 150, 200])
  expect(await readFile(targetPath, "utf8")).toBe("old content")
  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries.some((entry) => entry.startsWith("state.json.tmp."))).toBe(false)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite does not retry rename EPERM on POSIX platforms", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-posix-noretry-")
  const targetPath = join(rootDirectory, "state.json")
  await writeFile(targetPath, "old content")
  const delayCalls: number[] = []
  let renameCalls = 0

  const { atomicWrite } = await import("./locks")

  // when
  const result = atomicWrite(targetPath, "new content", {
    platform: "linux",
    delay: async (ms: number) => {
      delayCalls.push(ms)
    },
    rename: async () => {
      renameCalls += 1
      throw createErrnoError("EPERM")
    },
  })

  // then
  await expect(result).rejects.toThrow("EPERM")
  expect(renameCalls).toBe(1)
  expect(delayCalls).toEqual([])
  expect(await readFile(targetPath, "utf8")).toBe("old content")
  await rm(rootDirectory, { recursive: true, force: true })
})

test("atomicWrite does not retry a Windows rename that fails for a non-contention reason", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-win-noretry-")
  const targetPath = join(rootDirectory, "state.json")
  const delayCalls: number[] = []
  let renameCalls = 0

  const { atomicWrite } = await import("./locks")

  // when
  const result = atomicWrite(targetPath, "new content", {
    platform: "win32",
    delay: async (ms: number) => {
      delayCalls.push(ms)
    },
    rename: async () => {
      renameCalls += 1
      throw createErrnoError("ENOENT")
    },
  })

  // then
  await expect(result).rejects.toThrow("ENOENT")
  expect(renameCalls).toBe(1)
  expect(delayCalls).toEqual([])
  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries).toEqual([])
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

test("lock open treats Windows EPERM with an existing parent as possible contention", async () => {
  // given
  const { assertRetryableLockOpenError } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-eperm-win-parent-")
  const lockPath = join(rootDirectory, "lock")
  const accessCalls: string[] = []

  // when
  const result = assertRetryableLockOpenError(lockPath, createErrnoError("EPERM"), {
    platform: "win32",
    access: async (path: PathLike) => {
      accessCalls.push(String(path))
      if (String(path) === lockPath) {
        throw createErrnoError("ENOENT")
      }
    },
  })

  // then
  await expect(result).resolves.toBeUndefined()
  expect(accessCalls).toEqual([lockPath, rootDirectory])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("lock open rethrows EPERM when the lock path does not exist", async () => {
  // given
  const { assertRetryableLockOpenError } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-eperm-missing-")
  const lockPath = join(rootDirectory, "lock")

  // when
  const result = assertRetryableLockOpenError(lockPath, createErrnoError("EPERM"), { platform: "linux" })

  // then
  await expect(result).rejects.toThrow("EPERM")
  await rm(rootDirectory, { recursive: true, force: true })
})

test("lock open rethrows Windows EPERM when the lock parent does not exist", async () => {
  // given
  const { assertRetryableLockOpenError } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-eperm-win-missing-")
  const lockPath = join(rootDirectory, "missing", "lock")

  // when
  const result = assertRetryableLockOpenError(lockPath, createErrnoError("EPERM"), { platform: "win32" })

  // then
  await expect(result).rejects.toThrow("EPERM")
  await rm(rootDirectory, { recursive: true, force: true })
})

test("lock release retries transient EPERM before removing the lock file", async () => {
  // given
  const { reapStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-release-eperm-")
  const lockPath = join(rootDirectory, "lock")
  await writeFile(lockPath, "owner\n123\n456\n")
  const delayCalls: number[] = []
  let unlinkCalls = 0

  // when
  const result = reapStaleLock(lockPath, {
    delay: async (ms: number) => {
      delayCalls.push(ms)
    },
    unlink: async (path: PathLike) => {
      unlinkCalls += 1
      if (unlinkCalls < 3) {
        throw createErrnoError("EPERM")
      }
      await rm(path, { force: true })
    },
  })

  // then
  await expect(result).resolves.toBeUndefined()
  expect(unlinkCalls).toBe(3)
  expect(delayCalls).toEqual([25, 25])
  await expect(readFile(lockPath, "utf8")).rejects.toThrow()
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
  await expect(readFile(lockPath, "utf8")).rejects.toThrow()
  await rm(rootDirectory, { recursive: true, force: true })
})
