import { copyFile, mkdir, open, rm } from "node:fs/promises"
import { dirname, win32 } from "node:path"
import type { Pointer } from "bun:ffi"
import { IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"
import { markStarted } from "../backend-marker"
import { exists } from "../git/command"
import { copyTree } from "./copy-tree"
import { existingParent, runtime, type BackendRuntime } from "./runtime"

export interface WindowsCloneApi {
  open(path: string, write: boolean): number
  resize(handle: number, size: number): void
  duplicate(destination: number, source: number, bytes: number): void
  close(handle: number): void
  clusterSize(path: string): number
}
export interface WindowsSymbols {
  CreateFileW(path: Buffer, access: number, share: number, security: null, disposition: number, flags: number, template: null): Pointer | bigint | null
  SetFilePointerEx(handle: Pointer, offset: bigint, output: null, method: number): number
  SetEndOfFile(handle: Pointer): number
  DeviceIoControl(handle: Pointer, code: number, input: Buffer, length: number, output: null, outputLength: number, returned: Buffer, overlapped: null): number
  CloseHandle(handle: Pointer): number
  GetLastError(): number
  GetDiskFreeSpaceW(path: Buffer, sectors: Buffer, bytes: Buffer, free: Buffer, total: Buffer): number
}
const FSCTL_DUPLICATE_EXTENTS_TO_FILE = 0x00098344

export async function duplicateExtents(api: WindowsCloneApi, source: string, destination: string, size: number): Promise<void> {
  const src = win32.toNamespacedPath(source), dst = win32.toNamespacedPath(destination)
  const cluster = api.clusterSize(src)
  if (size < cluster) { await copyFile(source, destination); return }
  const aligned = Math.floor(size / cluster) * cluster
  const input = api.open(src, false)
  try {
    const output = api.open(dst, true)
    try {
      api.resize(output, Math.ceil(size / cluster) * cluster)
      api.duplicate(output, input, aligned)
      api.resize(output, size)
    } finally { api.close(output) }
  } finally { api.close(input) }
  if (aligned < size) {
    const input = await open(source, "r")
    try {
      const output = await open(destination, "r+")
      try {
        const tail = Buffer.alloc(size - aligned)
        const { bytesRead } = await input.read(tail, 0, tail.length, aligned)
        if (bytesRead !== tail.length) throw new Error("Source changed during ReFS tail copy")
        let written = 0
        while (written < tail.length) {
          const result = await output.write(tail, written, tail.length - written, aligned + written)
          if (!result.bytesWritten) throw new Error("ReFS tail copy made no progress")
          written += result.bytesWritten
        }
      } finally { await output.close() }
    } finally { await input.close() }
  }
}

async function loadWindows(): Promise<WindowsCloneApi> {
  const { dlopen } = await import("bun:ffi")
  const { symbols: s } = dlopen("kernel32.dll", {
    CreateFileW: { args: ["buffer", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "ptr" },
    SetFilePointerEx: { args: ["ptr", "i64", "ptr", "u32"], returns: "i32" },
    SetEndOfFile: { args: ["ptr"], returns: "i32" },
    DeviceIoControl: { args: ["ptr", "u32", "buffer", "u32", "ptr", "u32", "buffer", "ptr"], returns: "i32" },
    CloseHandle: { args: ["ptr"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
    GetDiskFreeSpaceW: { args: ["buffer", "buffer", "buffer", "buffer", "buffer"], returns: "i32" },
  })
  return createWindowsCloneApi(s)
}

export function createWindowsCloneApi(s: WindowsSymbols): WindowsCloneApi {
  const fail = (operation: string): never => {
    const errno = s.GetLastError()
    if ([1, 17, 50, 87].includes(errno)) throw new IsolationUnavailableError(`${operation}: Windows error ${errno}`)
    throw new Error(`${operation}: Windows error ${errno}`)
  }
  const wide = (path: string) => Buffer.from(`${path}\0`, "utf16le")
  return {
    open(path, write) {
      const handle = s.CreateFileW(wide(path), write ? 0x40000000 : 0x80000000, 7, null, write ? 1 : 3, 0x80, null)
      if (!handle || Number(handle) === -1 || Number(handle) >= Number.MAX_SAFE_INTEGER) fail("CreateFileW")
      return Number(handle)
    },
    resize(handle, size) {
      if (!s.SetFilePointerEx(handle as Pointer, BigInt(size), null, 0)) fail("SetFilePointerEx")
      if (!s.SetEndOfFile(handle as Pointer)) fail("SetEndOfFile")
    },
    duplicate(destination, source, bytes) {
      const data = Buffer.alloc(32)
      data.writeBigUInt64LE(BigInt(source), 0)
      data.writeBigInt64LE(BigInt(bytes), 24)
      if (!s.DeviceIoControl(destination as Pointer, FSCTL_DUPLICATE_EXTENTS_TO_FILE, data, data.length, null, 0, Buffer.alloc(4), null)) fail("DeviceIoControl")
    },
    close(handle) { if (!s.CloseHandle(handle as Pointer)) fail("CloseHandle") },
    clusterSize(path) {
      const sectors = Buffer.alloc(4), bytes = Buffer.alloc(4)
      if (!s.GetDiskFreeSpaceW(wide(win32.parse(path).root), sectors, bytes, Buffer.alloc(4), Buffer.alloc(4))) fail("GetDiskFreeSpaceW")
      return sectors.readUInt32LE() * bytes.readUInt32LE()
    },
  }
}

export class BlockCloneBackend implements IsolationBackend {
  readonly kind = "block-clone" as const
  readonly clonesTree = true
  private api?: WindowsCloneApi
  constructor(private readonly io: BackendRuntime = runtime, private readonly load: () => Promise<WindowsCloneApi> = loadWindows) {}
  async probe(lower: string, ctx?: IsolationContext) {
    if (this.io.platform !== "win32" || !this.io.which("fsutil")) return { available: false, reason: "ReFS block clone requires Windows and fsutil" }
    if (ctx && (ctx.crossDevice || await this.io.device(lower) !== await this.io.device(await existingParent(ctx.baseDir)))) return { available: false, reason: "ReFS requires the same volume serial" }
    const result = await this.io.run(["fsutil", "fsinfo", "volumeinfo", win32.parse(lower).root])
    // A probe-time CLI failure says the ReFS capability cannot be established on
    // this volume (missing privileges, transient fsutil errors); it is a capability
    // gap the candidate walk can fall through on, not an operational failure.
    // start()'s failures stay hard errors.
    if (result.code) return { available: false, reason: `fsutil volumeinfo failed (${result.code}): ${result.stderr}` }
    if (!/\bReFS\b/i.test(result.stdout)) return { available: false, reason: "volume is not ReFS" }
    try { this.api ??= await this.load() } catch (error) {
      if (error instanceof Error && "code" in error && ["ERR_UNSUPPORTED_ESM_URL_SCHEME", "ERR_UNKNOWN_BUILTIN_MODULE", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(String(error.code))) return { available: false, reason: "Windows block clone requires bun:ffi" }
      throw error
    }
    return { available: true }
  }
  async start(lower: string, merged: string, ctx: IsolationContext) {
    if (await exists(merged)) throw new Error(`block-clone destination already exists: ${merged}`)
    await mkdir(dirname(merged), { recursive: true })
    if (ctx.crossDevice || await this.io.device(lower) !== await this.io.device(dirname(merged))) throw new IsolationUnavailableError("ReFS requires the same volume serial")
    const probe = await this.probe(lower)
    if (!probe.available) throw new IsolationUnavailableError(probe.reason)
    try {
      await copyTree(win32.toNamespacedPath(lower), win32.toNamespacedPath(merged), (src, dst, size) => duplicateExtents(this.api!, src, dst, size), () => {})
      await markStarted(ctx.baseDir, this.kind)
    } catch (error) {
      await rm(merged, { recursive: true, force: true })
      throw error
    }
  }
  async stop(merged: string) { await rm(win32.toNamespacedPath(merged), { recursive: true, force: true }) }
}
