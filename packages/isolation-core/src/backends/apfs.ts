import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Pointer } from "bun:ffi"
import { IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"

import { markStarted } from "../backend-marker"

const CLONE_NOFOLLOW = 0x0001
interface CloneSymbols {
  clonefile(src: Uint8Array, dst: Uint8Array, flags: number): number
  __error(): Pointer
  strerror(errno: number): string
}
class CloneError extends Error {
  constructor(readonly errno: number, message: string) { super(message) }
}

export async function cloneWithSymbols(symbols: CloneSymbols, source: string, destination: string): Promise<void> {
  const { toArrayBuffer } = await import("bun:ffi")
  const src = Buffer.from(`${source}\0`), dst = Buffer.from(`${destination}\0`)
  if (symbols.clonefile(src, dst, CLONE_NOFOLLOW) === 0) return
  // Nothing may call into foreign code between clonefile and reading thread-local errno.
  const errno = new Int32Array(toArrayBuffer(symbols.__error(), 0, 4))[0]!
  const message = `clonefile ${source} -> ${destination}: ${symbols.strerror(errno)}`
  if ([45, 102, 18, 1].includes(errno)) {
    throw Object.assign(new IsolationUnavailableError(message), { errno })
  }
  throw new CloneError(errno, message)
}

export type LoadApfs = () => Promise<CloneSymbols>
async function loadApfs(): Promise<CloneSymbols> {
  const { dlopen, FFIType } = await import("bun:ffi")
  const library = dlopen("/usr/lib/libSystem.B.dylib", {
    clonefile: { args: [FFIType.cstring, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
    __error: { args: [], returns: FFIType.ptr },
    strerror: { args: [FFIType.i32], returns: FFIType.cstring },
  })
  return library.symbols as unknown as CloneSymbols
}

export class ApfsBackend implements IsolationBackend {
  readonly kind = "apfs" as const
  readonly clonesTree = true
  private symbols?: CloneSymbols

  constructor(private readonly load: LoadApfs = loadApfs) {}

  async probe(_repoRoot: string) {
    if (process.platform !== "darwin") return { available: false, reason: "APFS requires macOS" }
    if (!this.symbols) {
      try {
        this.symbols = await this.load()
      } catch (cause) {
        // A missing bun:ffi module is an unavailable capability; anything else
        // (a failed dlopen, for example) is an operational failure that propagates.
        if (cause instanceof Error && "code" in cause
          && ["ERR_UNSUPPORTED_ESM_URL_SCHEME", "ERR_UNKNOWN_BUILTIN_MODULE", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(String(cause.code))) {
          throw new IsolationUnavailableError(`APFS clonefile unavailable: ${String(cause)}`)
        }
        throw cause
      }
    }
    return { available: true }
  }

  async start(lower: string, merged: string, ctx: IsolationContext) {
    if (ctx.crossDevice) throw new IsolationUnavailableError("APFS requires the same device")
    const probe = await this.probe(lower)
    if (!probe.available) throw new IsolationUnavailableError(probe.reason)
    await mkdir(dirname(merged), { recursive: true })
    if ((await stat(lower)).dev !== (await stat(dirname(merged))).dev) throw new IsolationUnavailableError("APFS requires the same device")
    const clone = (src: string, dst: string) => cloneWithSymbols(this.symbols!, src, dst)
    // Some Darwin versions clone special entries instead of rejecting them. Inspect the
    // completed snapshot, not the source, so the fast path still starts with one syscall.
    const hasSpecialEntries = async (dir: string): Promise<boolean> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) { if (await hasSpecialEntries(join(dir, entry.name))) return true }
        else if (!entry.isFile() && !entry.isSymbolicLink()) return true
      }
      return false
    }
    try {
      await clone(lower, merged)
      if (!(await hasSpecialEntries(merged))) {
        await markStarted(ctx.baseDir, this.kind)
        return { strategy_detail: "clonefile" }
      }
    } catch (error) {
      if (!(error instanceof Error && "errno" in error && [22, 45, 102].includes(Number(error.errno)))) throw error
    }
    await rm(merged, { recursive: true, force: true })
    const walk = async (src: string, dst: string): Promise<void> => {
      const info = await lstat(src)
      if (!info.isDirectory()) {
        if (info.isFile() || info.isSymbolicLink()) await clone(src, dst)
        return
      }
      await mkdir(dst, { mode: info.mode })
      for (const entry of await readdir(src)) await walk(join(src, entry), join(dst, entry))
    }
    await walk(lower, merged)
    await markStarted(ctx.baseDir, this.kind)
    return { strategy_detail: "clone_tree" }
  }

  async stop(merged: string) { await rm(merged, { recursive: true, force: true }) }
}
