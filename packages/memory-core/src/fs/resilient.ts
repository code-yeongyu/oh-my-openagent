// EINTR-resilient filesystem boundary for the memory stack.
//
// The bun-compiled engine surfaces raw EINTR from fs syscalls on macOS under signal load
// (child reaping in the multi-session shared host), which broke live turns: the notice-lock
// candidate open in before_agent_start, the per-tool-call guard scandir, and reflection
// state writes. POSIX defines EINTR as "interrupted before the operation completed", so
// whole-call retry is correct for single-syscall and freshly-opened-descriptor operations.
// The exceptions each live behind a precise seam:
// - multi-syscall writes retry per write(2) with offset tracking (write-all.ts),
// - exclusive ("x"-flag) creates are never auto-retried (creation is ambiguous after EINTR;
//   the owning protocol recovers, e.g. locks/acquire.ts fresh candidates),
// - close(2)/asyncDispose map EINTR to success (descriptor state unspecified, per libuv),
// - FileHandle methods retry only when idempotent (position state forbids replays).
// Memory-stack code imports fs ONLY through this module (no-direct-node-fs tests).

import { Buffer } from "node:buffer"
import * as fsSync from "node:fs"
import * as fsp from "node:fs/promises"

import { currentDeviceFiles, deviceFs, refuseSyncOnDevice, type MemoryDeviceFiles } from "./device-scope"
import { renameWithContentionRetry } from "./rename-contention"
import { fsErrorCode, retryOnEintr, retryOnEintrSync } from "./retry"
import { isExclusiveFlag, openSyncWithExclusivePolicy, writeHandleAll, writePathAll } from "./write-all"

export { EINTR_RETRY_CAP, retryOnEintr, retryOnEintrSync } from "./retry"
export { isExclusiveFlag, openSyncWithExclusivePolicy, writeHandleAll } from "./write-all"

type UnknownFunction = (...args: readonly unknown[]) => unknown

function isFunction(value: unknown): value is UnknownFunction {
  return typeof value === "function"
}

function withAsyncRetry(operation: UnknownFunction): UnknownFunction {
  return (...args) => retryOnEintr(async () => operation(...args))
}

function withSyncRetry(operation: UnknownFunction): UnknownFunction {
  return (...args) => retryOnEintrSync(() => operation(...args))
}

export function resilientNamespace<M extends object>(namespace: M, kind: "async" | "sync"): M {
  const wrapFunction = kind === "async" ? withAsyncRetry : withSyncRetry
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(namespace, {
    get(target, property) {
      if (cache.has(property)) return cache.get(property)
      const value: unknown = Reflect.get(target, property)
      if (!isFunction(value)) return value
      const wrapped = wrapFunction(value)
      const native: unknown = Reflect.get(value, "native")
      if (isFunction(native)) Object.assign(wrapped, { native: wrapFunction(native) })
      cache.set(property, wrapped)
      return wrapped
    },
  })
}

const IDEMPOTENT_HANDLE_METHODS = new Set(["stat", "sync", "datasync", "chmod", "chown", "utimes", "truncate"])

export function wrapFileHandle<H extends object>(handle: H): H {
  return new Proxy(handle, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property)
      if (!isFunction(value)) return value
      const invoke = (args: readonly unknown[]): unknown => Reflect.apply(value, target, [...args])
      if (property === "close" || property === Symbol.asyncDispose) {
        return (...args: readonly unknown[]) => {
          const result = invoke(args)
          if (!(result instanceof Promise)) return result
          return result.catch((error: unknown) => {
            if (fsErrorCode(error) === "EINTR") return undefined
            throw error
          })
        }
      }
      if (typeof property !== "string" || !IDEMPOTENT_HANDLE_METHODS.has(property)) {
        return (...args: readonly unknown[]) => invoke(args)
      }
      return (...args: readonly unknown[]) => {
        const result = invoke(args)
        if (!(result instanceof Promise)) return result
        return result.catch((error: unknown) => {
          if (fsErrorCode(error) !== "EINTR") throw error
          return retryOnEintr(async () => invoke(args))
        })
      }
    },
  })
}

const promises = resilientNamespace(fsp, "async")

/** EINTR-retried like every call here, and retried while Windows briefly holds the target open. */
export function rename(from: fsSync.PathLike, to: fsSync.PathLike, admit?: (begin: () => Promise<void>) => Promise<void>): Promise<void> {
  const device = currentDeviceFiles()
  if (device !== undefined) return deviceFs.rename(device, from, to)
  return renameWithContentionRetry(from, to, {
    rename: (source, target) => fsp.rename(source, target), platform: process.platform,
    ...(admit === undefined ? {} : { admit }),
  })
}

/** Re-enter the caller's boundary for every EINTR or Windows-contention retry. */
export function renameSyncWithContentionRetry(
  from: fsSync.PathLike, to: fsSync.PathLike, dispatch: (begin: () => void) => Promise<void>,
): Promise<void> {
  return renameWithContentionRetry(from, to, {
    platform: process.platform,
    rename: (source, target) => dispatch(() => fsSync.renameSync(source, target)),
  })
}
const sync = resilientNamespace(fsSync, "sync")

type AnyFunction = (...args: never[]) => unknown

/** Inside a device scope (a split session's memory store), `device` serves the call; outside it, the local call as before. */
function deviceAware<F extends AnyFunction>(local: F, device: (files: MemoryDeviceFiles, ...args: Parameters<F>) => unknown): F {
  return ((...args: Parameters<F>) => {
    const files = currentDeviceFiles()
    return files === undefined ? local(...args) : device(files, ...args)
  }) as F
}

function unsupportedOnDevice(operation: string) {
  return (): never => deviceFs.unsupported(operation)
}

function refusedSync<F extends AnyFunction>(operation: string, local: F): F {
  const guarded = ((...args: Parameters<F>) => {
    refuseSyncOnDevice(operation)
    return local(...args)
  }) as F
  const native: unknown = Reflect.get(local, "native")
  if (typeof native === "function") Object.assign(guarded, { native: refusedSync(`${operation}.native`, native as AnyFunction) })
  return guarded
}

export const access = deviceAware(promises.access, (files, path) => deviceFs.access(files, path as never))
export const chmod = deviceAware(promises.chmod, unsupportedOnDevice("chmod"))
export const copyFile = deviceAware(promises.copyFile, unsupportedOnDevice("copyFile"))
export const cp = deviceAware(promises.cp, unsupportedOnDevice("cp"))
export const link = deviceAware(promises.link, unsupportedOnDevice("link"))
export const lstat = deviceAware(promises.lstat, (files, path) => deviceFs.stat(files, path as never))
export const mkdir = deviceAware(promises.mkdir, (files, path, options) => deviceFs.mkdir(files, path as never, options))
export const mkdtemp = deviceAware(promises.mkdtemp, unsupportedOnDevice("mkdtemp"))
export const readFile = deviceAware(promises.readFile, (files, path, options) => deviceFs.readFile(files, path as never, options))
export const readdir = deviceAware(promises.readdir, (files, path, options) => deviceFs.readdir(files, path as never, options))
export const readlink = deviceAware(promises.readlink, unsupportedOnDevice("readlink"))
export const realpath = deviceAware(promises.realpath, unsupportedOnDevice("realpath"))
export const rm = deviceAware(promises.rm, (files, path, options) => deviceFs.rm(files, path as never, options))
export const rmdir = deviceAware(promises.rmdir, (files, path) => deviceFs.rm(files, path as never, { recursive: true }))
export const stat = deviceAware(promises.stat, (files, path) => deviceFs.stat(files, path as never))
export const statfs = deviceAware(promises.statfs, unsupportedOnDevice("statfs"))
export const unlink = deviceAware(promises.unlink, (files, path) => deviceFs.unlink(files, path as never))

export const accessSync = refusedSync("accessSync", sync.accessSync)
export const chmodSync = refusedSync("chmodSync", sync.chmodSync)
export const fsyncSync = refusedSync("fsyncSync", sync.fsyncSync)
export const linkSync = refusedSync("linkSync", sync.linkSync)
export const lstatSync = refusedSync("lstatSync", sync.lstatSync)
export const mkdirSync = refusedSync("mkdirSync", sync.mkdirSync)
export const readFileSync = refusedSync("readFileSync", sync.readFileSync)
export const readdirSync = refusedSync("readdirSync", sync.readdirSync)
export const realpathSync = refusedSync("realpathSync", sync.realpathSync)
export const statSync = refusedSync("statSync", sync.statSync)
export const unlinkSync = refusedSync("unlinkSync", sync.unlinkSync)
export const writeFileSync = refusedSync("writeFileSync", sync.writeFileSync)
export const writeSync = refusedSync("writeSync", sync.writeSync)

export const { constants, watch } = fsSync

export const open: typeof fsp.open = async (...args) => {
  if (currentDeviceFiles() !== undefined) deviceFs.unsupported("open")
  const openOnce = (): Promise<fsp.FileHandle> => fsp.open(...args)
  const handle = await (isExclusiveFlag(args[1] ?? "r") ? openOnce() : retryOnEintr(openOnce))
  return wrapFileHandle(handle)
}

function isHandleTarget(value: fsSync.PathLike | fsp.FileHandle): value is fsp.FileHandle {
  return typeof value === "object" && !(value instanceof URL) && !Buffer.isBuffer(value) && "fd" in value
}

export const writeFile: typeof fsp.writeFile = async (file, data, options) => {
  const device = currentDeviceFiles()
  if (device !== undefined) return deviceFs.writeFile(device, file as never, data, options)
  if (typeof data !== "string" && !(data instanceof Uint8Array)) {
    return fsp.writeFile(file, data, options)
  }
  if (isHandleTarget(file)) {
    const parsed = typeof options === "string" ? { encoding: options } : (options ?? {})
    parsed.signal?.throwIfAborted()
    await writeHandleAll(file, data, parsed.encoding ?? undefined, parsed.signal)
    if (parsed.flush === true) await retryOnEintr(() => file.sync())
    return
  }
  return writePathAll(file, data, options ?? undefined, "w")
}

export const appendFile: typeof fsp.appendFile = async (path, data, options) => {
  const device = currentDeviceFiles()
  if (device !== undefined) return deviceFs.appendFile(device, path as never, data, options)
  if (typeof data !== "string" && !(data instanceof Uint8Array)) {
    return fsp.appendFile(path, data, options)
  }
  if (isHandleTarget(path)) {
    const parsed = typeof options === "string" ? { encoding: options } : (options ?? {})
    await writeHandleAll(path, data, parsed.encoding ?? undefined)
    if (parsed.flush === true) await retryOnEintr(() => path.sync())
    return
  }
  return writePathAll(path, data, options ?? undefined, "a")
}

export const openSync: typeof fsSync.openSync = (path, flags, mode) => {
  refuseSyncOnDevice("openSync")
  return openSyncWithExclusivePolicy(fsSync.openSync, path, flags, mode ?? undefined)
}

// close(2) leaves the descriptor state unspecified after EINTR, so retrying risks closing
// a reused fd; treat EINTR as closed, matching wrapFileHandle's close mapping.
export function closeSync(fd: number): void {
  try {
    fsSync.closeSync(fd)
  } catch (error) {
    if (fsErrorCode(error) !== "EINTR") throw error
  }
}

// Node parity: existsSync never throws, but unlike node's, transient EINTR is retried
// instead of being misread as "missing".
export function existsSync(path: fsSync.PathLike): boolean {
  refuseSyncOnDevice("existsSync")
  try {
    retryOnEintrSync(() => fsSync.statSync(path))
    return true
  } catch {
    return false
  }
}

/** `existsSync`'s answer, asynchronously: on a split session's device files as well as on the local disk. */
export async function exists(path: fsSync.PathLike): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export type { BigIntStats, Dirent, FSWatcher, PathLike, Stats } from "node:fs"
export type { FileHandle } from "node:fs/promises"
