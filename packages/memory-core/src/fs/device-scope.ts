import { AsyncLocalStorage } from "node:async_hooks"
import { Buffer } from "node:buffer"
import { dirname } from "node:path"

/**
 * The files of the device a memory store lives on, as the host reaches them (brain/hand split): every operation is one
 * message to the device, which touches its own disk. Structurally the engine's `DeviceFiles`; memory-core stays
 * harness-neutral, so the shape is restated here.
 */
export interface MemoryDeviceFiles {
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array, options?: { readonly exclusive?: boolean }): Promise<void>
  list(path: string): Promise<readonly string[]>
  stat(path: string): Promise<{ readonly kind: "file" | "directory" | "other"; readonly size: number; readonly mtimeMs: number }>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  run(request: MemoryDeviceRun, options?: { readonly signal?: AbortSignal }): Promise<{ readonly code: number | null; readonly signal: string | null; readonly stdout: Uint8Array; readonly stderr: string }>
}

export interface MemoryDeviceRun {
  readonly exe: "git" | "lsof"
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly stdin?: Uint8Array
  readonly timeoutMs?: number
  readonly activityLock?: boolean
}

const deviceScope = new AsyncLocalStorage<MemoryDeviceFiles>()

/** Runs `operation` with every memory-store file and git operation going to `files`; outside it, the local disk as before. */
export function runOnDevice<T>(files: MemoryDeviceFiles, operation: () => Promise<T>): Promise<T> {
  return deviceScope.run(files, operation)
}

export function currentDeviceFiles(): MemoryDeviceFiles | undefined {
  return deviceScope.getStore()
}

export function isOnDevice(): boolean {
  return deviceScope.getStore() !== undefined
}

/** A synchronous filesystem call inside a device scope: it would open the loop machine's disk, so it is refused. */
export class DeviceScopeSyncAccessError extends Error {
  readonly code = "EDEVICESYNC"
  constructor(operation: string) {
    super(`${operation}: synchronous filesystem access is not available on a split session's device files`)
    this.name = "DeviceScopeSyncAccessError"
  }
}

export function refuseSyncOnDevice(operation: string): void {
  if (deviceScope.getStore() !== undefined) throw new DeviceScopeSyncAccessError(operation)
}

const NODE_CODES: Readonly<Record<string, string>> = {
  not_found: "ENOENT",
  exists: "EEXIST",
  not_a_file: "EISDIR",
  aborted: "ABORT_ERR",
  unsupported: "ENOTSUP",
}

/** The device's typed error as the node error code memory-core already branches on (ENOENT, EEXIST, ...). */
function asNodeError(error: unknown): unknown {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return error
  const nodeCode = NODE_CODES[error.code]
  if (nodeCode === undefined) return error
  return Object.assign(new Error(error.message, { cause: error }), { code: nodeCode })
}

async function onDevice<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw asNodeError(error)
  }
}

type PathArgument = string | URL | Buffer

function pathOf(path: unknown): string {
  if (typeof path === "string") return path
  if (path instanceof URL) return path.pathname
  if (Buffer.isBuffer(path)) return path.toString("utf8")
  throw Object.assign(new Error("a device file operation takes a path, not a file handle"), { code: "ENOTSUP" })
}

function encodingOf(options: unknown): BufferEncoding | undefined {
  if (typeof options === "string") return options as BufferEncoding
  if (typeof options === "object" && options !== null && "encoding" in options && typeof options.encoding === "string") return options.encoding as BufferEncoding
  return undefined
}

function flagOf(options: unknown): string {
  if (typeof options === "object" && options !== null && "flag" in options && typeof options.flag === "string") return options.flag
  return "w"
}

function bytesOf(data: unknown, encoding: BufferEncoding | undefined): Uint8Array {
  if (typeof data === "string") return Buffer.from(data, encoding ?? "utf8")
  if (data instanceof Uint8Array) return data
  throw Object.assign(new Error("a device write takes a string or bytes"), { code: "ENOTSUP" })
}

/** A `fs.Stats`-shaped view of a device stat, for the fields memory-core reads. */
function statsOf(stat: Awaited<ReturnType<MemoryDeviceFiles["stat"]>>) {
  return {
    // A device stat carries no device or inode number; lock identity then rests on mtime and the record (its nonce).
    dev: 0,
    ino: 0,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    mtime: new Date(stat.mtimeMs),
    isFile: () => stat.kind === "file",
    isDirectory: () => stat.kind === "directory",
    isSymbolicLink: () => false,
  }
}

function refuseUnsupported(operation: string): never {
  throw Object.assign(new Error(`${operation}: not available on a split session's device files`), { code: "ENOTSUP" })
}

/** The async filesystem calls memory-core makes, served by the device in scope. */
export const deviceFs = {
  readFile: (files: MemoryDeviceFiles, path: PathArgument, options?: unknown) =>
    onDevice(async () => {
      const bytes = Buffer.from(await files.read(pathOf(path)))
      const encoding = encodingOf(options)
      return encoding === undefined ? bytes : bytes.toString(encoding)
    }),
  writeFile: (files: MemoryDeviceFiles, path: PathArgument, data: unknown, options?: unknown) =>
    onDevice(async () => {
      const flag = flagOf(options)
      if (flag !== "w" && flag !== "wx") refuseUnsupported(`writeFile flag ${flag}`)
      await files.write(pathOf(path), bytesOf(data, encodingOf(options)), { exclusive: flag === "wx" })
    }),
  appendFile: (files: MemoryDeviceFiles, path: PathArgument, data: unknown, options?: unknown) =>
    onDevice(async () => {
      const target = pathOf(path)
      const existing = await files.read(target).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "not_found") return new Uint8Array()
        throw error
      })
      await files.write(target, Buffer.concat([existing, bytesOf(data, encodingOf(options))]))
    }),
  mkdir: (files: MemoryDeviceFiles, path: PathArgument, options?: unknown) =>
    onDevice(async () => {
      const target = pathOf(path)
      const recursive = typeof options === "object" && options !== null && "recursive" in options && options.recursive === true
      if (!recursive && (await files.stat(target).then(() => true, () => false))) {
        throw Object.assign(new Error(`EEXIST: ${target}`), { code: "EEXIST" })
      }
      if (!recursive && !(await files.stat(dirname(target)).then(() => true, () => false))) {
        throw Object.assign(new Error(`ENOENT: ${dirname(target)}`), { code: "ENOENT" })
      }
      await files.mkdir(target)
      return recursive ? target : undefined
    }),
  readdir: (files: MemoryDeviceFiles, path: PathArgument, options?: unknown) =>
    onDevice(async () => {
      const target = pathOf(path)
      const names = [...(await files.list(target))]
      const withFileTypes = typeof options === "object" && options !== null && "withFileTypes" in options && options.withFileTypes === true
      if (!withFileTypes) return names
      return Promise.all(names.map(async (name) => {
        const stat = statsOf(await files.stat(`${target}/${name}`))
        return { name, parentPath: target, path: target, ...stat }
      }))
    }),
  stat: (files: MemoryDeviceFiles, path: PathArgument) => onDevice(async () => statsOf(await files.stat(pathOf(path)))),
  rename: (files: MemoryDeviceFiles, from: PathArgument, to: PathArgument) => onDevice(() => files.rename(pathOf(from), pathOf(to))),
  rm: (files: MemoryDeviceFiles, path: PathArgument, options?: unknown) =>
    onDevice(async () => {
      const target = pathOf(path)
      const force = typeof options === "object" && options !== null && "force" in options && options.force === true
      const exists = await files.stat(target).then(() => true, () => false)
      if (!exists) {
        if (force) return
        throw Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" })
      }
      await files.remove(target)
    }),
  unlink: (files: MemoryDeviceFiles, path: PathArgument) =>
    onDevice(async () => {
      const target = pathOf(path)
      if ((await files.stat(target)).kind === "directory") throw Object.assign(new Error(`EISDIR: ${target}`), { code: "EISDIR" })
      await files.remove(target)
    }),
  access: (files: MemoryDeviceFiles, path: PathArgument) => onDevice(async () => { await files.stat(pathOf(path)) }),
  unsupported: refuseUnsupported,
}
