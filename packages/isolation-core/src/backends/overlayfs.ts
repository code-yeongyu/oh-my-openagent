import { mkdir, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { BACKEND_FILE, IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"
import { markStarted } from "../backend-marker"
import { checked, runtime, type BackendRuntime } from "./runtime"

export class OverlayfsBackend implements IsolationBackend {
  readonly kind = "overlayfs" as const
  readonly clonesTree = true
  constructor(private readonly io: BackendRuntime = runtime) {}
  async probe(_lower: string) {
    return { available: this.io.platform === "linux" && this.io.which("fuse-overlayfs") && this.io.which("fusermount3") && await this.io.accessible("/dev/fuse"), reason: "fuse-overlayfs requires Linux, fusermount3 and accessible /dev/fuse" }
  }
  private async mount(lower: string, base: string) {
    // Commas/colons are option separators even without a shell; reject rather than mis-mount.
    if (/[,:\n\\]/.test(lower + base)) throw new IsolationUnavailableError("overlay paths contain unsupported mount-option separators")
    for (const name of ["upper", "work", "m"]) await mkdir(join(base, name), { recursive: true })
    try {
      await checked(this.io, ["fuse-overlayfs", "-o", `lowerdir=${lower},upperdir=${join(base, "upper")},workdir=${join(base, "work")}`, join(base, "m")])
    } catch (error) {
      const message = String((error as Error).message)
      // A missing or unusable FUSE device is a capability gap other backends can fill.
      if (/\/dev\/fuse|fusermount|permission denied|operation not permitted|fuse device/i.test(message)) {
        throw new IsolationUnavailableError(message)
      }
      throw error
    }
    await this.io.waitMounted(join(base, "m"))
  }
  async start(lower: string, _merged: string, ctx: IsolationContext) {
    const probe = await this.probe(lower)
    if (!probe.available) throw new IsolationUnavailableError(probe.reason)
    await this.mount(lower, ctx.baseDir)
    await markStarted(ctx.baseDir, this.kind, { lower })
  }
  private async unmount(merged: string) {
    if (!await this.io.mounted(merged)) return
    let message = ""
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.io.run(["fusermount3", "-u", merged])
      if (!result.code) return
      message = result.stderr
    }
    throw new Error(`fusermount3 failed: ${message}`)
  }
  async relocate(from: string, to: string) {
    const marker = JSON.parse(await readFile(join(from, BACKEND_FILE), "utf8"))
    if (marker.backend !== this.kind || typeof marker.lower !== "string") throw new Error("Invalid overlay marker")
    // No pathname changes before successful unmount; a busy mount fails closed.
    await this.unmount(join(from, "m"))
    await rename(from, to)
    try { await this.mount(marker.lower, to) } catch (error) {
      // Restore the original parent and mount so ensure can tear down at its known path.
      await this.unmount(join(to, "m"))
      await rename(to, from)
      await this.mount(marker.lower, from)
      throw error
    }
  }
  async stop(merged: string) {
    await this.unmount(merged)
    await rm(dirname(merged), { recursive: true, force: true })
  }
}
