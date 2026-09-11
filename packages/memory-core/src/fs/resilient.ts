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
const sync = resilientNamespace(fsSync, "sync")

export const {
  access,
  chmod,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} = promises

export const {
  accessSync,
  chmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} = sync

export const { constants, watch } = fsSync

export const open: typeof fsp.open = async (...args) => {
  const openOnce = (): Promise<fsp.FileHandle> => fsp.open(...args)
  const handle = await (isExclusiveFlag(args[1] ?? "r") ? openOnce() : retryOnEintr(openOnce))
  return wrapFileHandle(handle)
}

function isHandleTarget(value: fsSync.PathLike | fsp.FileHandle): value is fsp.FileHandle {
  return typeof value === "object" && !(value instanceof URL) && !Buffer.isBuffer(value) && "fd" in value
}

export const writeFile: typeof fsp.writeFile = async (file, data, options) => {
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

export const openSync: typeof fsSync.openSync = (path, flags, mode) =>
  openSyncWithExclusivePolicy(fsSync.openSync, path, flags, mode ?? undefined)

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
  try {
    retryOnEintrSync(() => fsSync.statSync(path))
    return true
  } catch {
    return false
  }
}

export type { Dirent, FSWatcher, PathLike, Stats } from "node:fs"
export type { FileHandle } from "node:fs/promises"
