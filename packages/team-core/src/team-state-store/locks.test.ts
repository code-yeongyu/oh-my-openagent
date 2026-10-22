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

test("atomicWrite does not retry a Windows EACCES rename because only EPERM and EBUSY are contention codes", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-atomic-win-eacces-noretry-")
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
      throw createErrnoError("EACCES")
    },
  })

  // then
  await expect(result).rejects.toThrow("EACCES")
  expect(renameCalls).toBe(1)
  expect(delayCalls).toEqual([])
  expect(await readFile(targetPath, "utf8")).toBe("old content")
  const directoryEntries = await readdir(rootDirectory)
  expect(directoryEntries.some((entry) => entry.startsWith("state.json.tmp."))).toBe(false)
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

test("#given a lock for this pid from a prior process incarnation #when detectStaleLock runs #then it is stale even while the pid is live", async () => {
  // given
  const { detectStaleLock, lockOwnerInstanceId } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-pid-reuse-")
  const lockPath = join(rootDirectory, "lock")
  const priorInstanceId = "00000000-0000-4000-8000-000000000001"
  expect(priorInstanceId).not.toBe(lockOwnerInstanceId)
  await writeFile(lockPath, `prior-owner\n${process.pid}\n${Date.now()}\n${priorInstanceId}\n`)

  // when
  const staleDetected = await detectStaleLock(lockPath, 300_000)

  // then
  expect(staleDetected).toBe(true)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given this process holds the lock #when detectStaleLock runs from the same process #then it is not stale", async () => {
  // given
  const { detectStaleLock, withLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-same-instance-")
  const lockPath = join(rootDirectory, "lock")

  // when
  const staleDetected = await withLock(lockPath, async () => await detectStaleLock(lockPath, 300_000))

  // then
  expect(staleDetected).toBe(false)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given a recycled-pid lock file #when withLock runs #then it reaps and acquires without waiting out the lock timeout", async () => {
  // given
  const { withLock, lockOwnerInstanceId } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-pid-reuse-acquire-")
  const lockPath = join(rootDirectory, "lock")
  await writeFile(lockPath, `prior-owner\n${process.pid}\n${Date.now()}\n00000000-0000-4000-8000-000000000002\n`)
  expect(lockOwnerInstanceId).not.toBe("00000000-0000-4000-8000-000000000002")

  // when
  const result = await withLock(lockPath, async () => "acquired", { staleAfterMs: 300_000 })

  // then
  expect(result).toBe("acquired")
  await expect(readFile(lockPath, "utf8")).rejects.toThrow()
  await rm(rootDirectory, { recursive: true, force: true })
}, 2_000)

test("#given legacy 3-line payloads #when detectStaleLock runs #then only a dead pid is stale", async () => {
  const { detectStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-legacy-3line-")
  const livePath = join(rootDirectory, "live.lock")
  const deadPath = join(rootDirectory, "dead.lock")
  await writeFile(livePath, `legacy-live\n${process.pid}\n${Date.now()}\n`)
  await writeFile(deadPath, `legacy-dead\n999999999\n${Date.now() - 600_000}\n`)
  expect(await detectStaleLock(livePath, 300_000)).toBe(false)
  expect(await detectStaleLock(deadPath, 300_000)).toBe(true)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given a lock held by a live foreign pid #when detectStaleLock runs #then it is not stale", async () => {
  const { detectStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-foreign-live-")
  const lockPath = join(rootDirectory, "lock")
  const child = Bun.spawn([process.execPath, "-e", "process.stdin.resume()"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  try {
    const childPid = child.pid
    if (childPid === undefined) throw new Error("foreign holder spawn produced no pid")
    process.kill(childPid, 0)
    await writeFile(lockPath, `foreign-owner\n${childPid}\n${Date.now()}\nforeign-instance\n`)
    expect(await detectStaleLock(lockPath, 300_000)).toBe(false)
    child.kill()
    await child.exited
    expect(await detectStaleLock(lockPath, 300_000)).toBe(true)
  } finally {
    child.kill()
    await child.exited
    await rm(rootDirectory, { recursive: true, force: true })
  }
})
