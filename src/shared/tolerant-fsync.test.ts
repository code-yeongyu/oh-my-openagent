import { describe, expect, it } from "bun:test"
import { fsyncSync } from "node:fs"
import type { FileHandle } from "node:fs/promises"

import { isToleratedFsyncError, tolerantFsync, tolerantFsyncSync } from "./tolerant-fsync"

function makeFsError(code: string, message?: string): NodeJS.ErrnoException {
  const error = new Error(message ?? `${code}: simulated`) as NodeJS.ErrnoException
  error.code = code
  return error
}

function fakeHandleWithSyncError(error: NodeJS.ErrnoException): FileHandle {
  return {
    sync: async () => {
      throw error
    },
  } as FileHandle
}

describe("isToleratedFsyncError", () => {
  it("#given EPERM error #when checked #then returns true", () => {
    expect(isToleratedFsyncError(makeFsError("EPERM"))).toBe(true)
  })

  it("#given EACCES error #when checked #then returns true", () => {
    expect(isToleratedFsyncError(makeFsError("EACCES"))).toBe(true)
  })

  it("#given ENOTSUP error #when checked #then returns true", () => {
    expect(isToleratedFsyncError(makeFsError("ENOTSUP"))).toBe(true)
  })

  it("#given EINVAL error #when checked #then returns true", () => {
    expect(isToleratedFsyncError(makeFsError("EINVAL"))).toBe(true)
  })

  it("#given EIO error #when checked #then returns false", () => {
    expect(isToleratedFsyncError(makeFsError("EIO"))).toBe(false)
  })

  it("#given ENOSPC error (disk full) #when checked #then returns false", () => {
    expect(isToleratedFsyncError(makeFsError("ENOSPC"))).toBe(false)
  })

  it("#given EBADF error (bad fd) #when checked #then returns false", () => {
    expect(isToleratedFsyncError(makeFsError("EBADF"))).toBe(false)
  })

  it("#given non-Error value #when checked #then returns false", () => {
    expect(isToleratedFsyncError("EPERM string")).toBe(false)
    expect(isToleratedFsyncError(null)).toBe(false)
    expect(isToleratedFsyncError(undefined)).toBe(false)
    expect(isToleratedFsyncError({ code: "EPERM" })).toBe(false)
  })

  it("#given Error without code #when checked #then returns false", () => {
    expect(isToleratedFsyncError(new Error("no code"))).toBe(false)
  })
})

describe("tolerantFsync (async)", () => {
  it("#given fsync throws EPERM #when called #then resolves without throwing", async () => {
    const handle = fakeHandleWithSyncError(makeFsError("EPERM", "operation not permitted, fsync"))
    await expect(tolerantFsync(handle, "test:async-eperm")).resolves.toBeUndefined()
  })

  it("#given fsync throws EACCES #when called #then resolves without throwing", async () => {
    const handle = fakeHandleWithSyncError(makeFsError("EACCES"))
    await expect(tolerantFsync(handle, "test:async-eacces")).resolves.toBeUndefined()
  })

  it("#given fsync throws ENOTSUP #when called #then resolves without throwing", async () => {
    const handle = fakeHandleWithSyncError(makeFsError("ENOTSUP"))
    await expect(tolerantFsync(handle, "test:async-enotsup")).resolves.toBeUndefined()
  })

  it("#given fsync throws EINVAL #when called #then resolves without throwing", async () => {
    const handle = fakeHandleWithSyncError(makeFsError("EINVAL"))
    await expect(tolerantFsync(handle, "test:async-einval")).resolves.toBeUndefined()
  })

  it("#given fsync throws EIO #when called #then propagates the error", async () => {
    const handle = fakeHandleWithSyncError(makeFsError("EIO"))
    await expect(tolerantFsync(handle, "test:async-eio")).rejects.toThrow("EIO: simulated")
  })

  it("#given fsync throws ENOSPC #when called #then propagates the error", async () => {
    const handle = fakeHandleWithSyncError(makeFsError("ENOSPC"))
    await expect(tolerantFsync(handle, "test:async-enospc")).rejects.toThrow("ENOSPC: simulated")
  })

  it("#given fsync succeeds #when called #then resolves and sync was invoked", async () => {
    let syncCalled = false
    const handle = {
      sync: async () => {
        syncCalled = true
      },
    } as FileHandle
    await tolerantFsync(handle, "test:async-success")
    expect(syncCalled).toBe(true)
  })
})

describe("tolerantFsyncSync (synchronous)", () => {
  it("#given fsyncSync throws EPERM #when called #then returns without throwing", () => {
    const fakeFsync = ((_fileDescriptor: number): void => {
      throw makeFsError("EPERM", "operation not permitted, fsync")
    }) as typeof fsyncSync
    expect(() => tolerantFsyncSync(123, "test:sync-eperm", fakeFsync)).not.toThrow()
  })

  it("#given fsyncSync throws EACCES #when called #then returns without throwing", () => {
    const fakeFsync = ((_fileDescriptor: number): void => {
      throw makeFsError("EACCES")
    }) as typeof fsyncSync
    expect(() => tolerantFsyncSync(123, "test:sync-eacces", fakeFsync)).not.toThrow()
  })

  it("#given fsyncSync throws EIO #when called #then propagates the error", () => {
    const fakeFsync = ((_fileDescriptor: number): void => {
      throw makeFsError("EIO")
    }) as typeof fsyncSync
    expect(() => tolerantFsyncSync(123, "test:sync-eio", fakeFsync)).toThrow("EIO: simulated")
  })

  it("#given fsyncSync succeeds #when called #then returns and impl was invoked", () => {
    let called = false
    const fakeFsync = ((_fileDescriptor: number): void => {
      called = true
    }) as typeof fsyncSync
    tolerantFsyncSync(123, "test:sync-success", fakeFsync)
    expect(called).toBe(true)
  })
})
