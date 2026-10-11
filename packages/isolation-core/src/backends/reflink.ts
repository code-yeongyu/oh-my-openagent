import { mkdir, mkdtemp, open, rm, rmdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"
import { markStarted } from "../backend-marker"
import { exists } from "../git/command"
import { copyBudget, copyTree } from "./copy-tree"
import { runtime, type BackendRuntime } from "./runtime"

export const FICLONE = 0x40049409
export interface ReflinkIoctl { ioctl(dst: number, request: number, src: number): number; errno(): number }
export type LoadReflink = () => Promise<ReflinkIoctl | undefined>
async function loadReflink(): Promise<ReflinkIoctl | undefined> {
  let ffi: typeof import("bun:ffi")
  try { ffi = await import("bun:ffi") } catch (error) {
    if (error instanceof Error && "code" in error && ["ERR_UNSUPPORTED_ESM_URL_SCHEME", "ERR_UNKNOWN_BUILTIN_MODULE", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(String(error.code))) return undefined
    throw error
  }
  const { dlopen, toArrayBuffer } = ffi
  const library = dlopen("libc.so.6", {
    ioctl: { args: ["i32", "u64", "i64"], returns: "i32" },
    __errno_location: { args: [], returns: "ptr" },
  })
  return { ioctl: library.symbols.ioctl, errno: () => new Int32Array(toArrayBuffer(library.symbols.__errno_location()!, 0, 4))[0]! }
}

export class ReflinkBackend implements IsolationBackend {
  readonly kind = "reflink" as const
  readonly clonesTree = true
  private loaded = false
  private ffi?: ReflinkIoctl
  private unavailableReason?: string
  constructor(private readonly io: BackendRuntime = runtime, private readonly load: LoadReflink = loadReflink) {}
  private async initialize() {
    if (!this.loaded) { this.ffi = await this.load(); this.loaded = true }
  }
  private async clone(source: string, destination: string) {
    const src = await open(source, "r")
    try {
      const dst = await open(destination, "wx")
      try {
        if (this.ffi!.ioctl(dst.fd, FICLONE, src.fd) !== 0) {
          const errno = this.ffi!.errno()
          if ([18, 95, 9, 25, 38].includes(errno)) throw new IsolationUnavailableError(`FICLONE unavailable: errno ${errno}`)
          throw new Error(`FICLONE failed: errno ${errno}`)
        }
      } finally { await dst.close() }
    } finally { await src.close() }
  }
  private async cp(source: string, destination: string) {
    const result = await this.io.run(["cp", "-a", "--reflink=always", source, destination])
    if (!result.code) return
    if (result.code === 1 && /failed to clone|Operation not supported|Invalid cross-device link/i.test(result.stderr)) throw new IsolationUnavailableError(result.stderr)
    throw new Error(`cp exited ${result.code}: ${result.stderr}`)
  }
  async probe(lower: string, ctx?: IsolationContext) {
    if (this.io.platform !== "linux") return { available: false, reason: "FICLONE requires Linux" }
    if (!ctx?.baseDir) return { available: false, reason: "reflink probing requires an isolation context to write inside" }
    // Claim the supplied context: probe files live exactly inside the caller's
    // base directory, and a context we had to create is released again so the
    // exclusive publication in ensure is unaffected.
    const target = ctx.baseDir
    const existed = await exists(target)
    await mkdir(target, { recursive: true })
    try {
      if (ctx.crossDevice || await this.io.device(lower) !== await this.io.device(target)) return { available: false, reason: "reflink requires the same device" }
      await this.initialize()
      if (!this.ffi && !this.io.which("cp")) {
        this.unavailableReason = "no FICLONE or cp"
        return { available: false, reason: this.unavailableReason }
      }
      const base = await mkdtemp(join(target, ".omo-reflink-probe-"))
      try {
        await writeFile(join(base, "source"), "x")
        if (this.ffi) await this.clone(join(base, "source"), join(base, "clone"))
        else await this.cp(join(base, "source"), join(base, "clone"))
        this.unavailableReason = undefined
        return { available: true }
      } catch (error) {
        if (error instanceof IsolationUnavailableError) {
          this.unavailableReason = error.message
          return { available: false, reason: error.message }
        }
        throw error
      } finally { await rm(base, { recursive: true, force: true }) }
    } finally {
      if (!existed) await rmdir(target).catch(() => {})
    }
  }
  async start(lower: string, merged: string, ctx: IsolationContext) {
    if (this.io.platform !== "linux") throw new IsolationUnavailableError("FICLONE requires Linux")
    if (await exists(merged)) throw new Error(`reflink destination already exists: ${merged}`)
    await mkdir(dirname(merged), { recursive: true })
    if (ctx.crossDevice || await this.io.device(lower) !== await this.io.device(dirname(merged))) throw new IsolationUnavailableError("reflink requires the same device")
    // Direct start callers get the same lazy initialization as probe callers.
    if (!this.loaded) {
      const probe = await this.probe(lower, ctx)
      if (!probe.available) throw new IsolationUnavailableError(probe.reason)
    }
    if (this.unavailableReason) throw new IsolationUnavailableError(this.unavailableReason)
    try {
      if (this.ffi) await copyTree(lower, merged, (src, dst) => this.clone(src, dst), await copyBudget(ctx.baseDir, ctx.maxCopyBytes))
      else await this.cp(lower, merged)
      await markStarted(ctx.baseDir, this.kind)
    } catch (error) {
      await rm(merged, { recursive: true, force: true })
      throw error
    }
  }
  async stop(merged: string) { await rm(merged, { recursive: true, force: true }) }
}
