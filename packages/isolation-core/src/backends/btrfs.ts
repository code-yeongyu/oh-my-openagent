import { mkdir, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"
import { markStarted } from "../backend-marker"
import { exists } from "../git/command"
import { checked, existingParent, runtime, type BackendRuntime } from "./runtime"

export class BtrfsBackend implements IsolationBackend {
  readonly kind = "btrfs" as const
  readonly clonesTree = true
  constructor(private readonly io: BackendRuntime = runtime) {}
  async probe(lower: string, ctx?: IsolationContext) {
    if (this.io.platform !== "linux" || !this.io.which("btrfs")) return { available: false, reason: "btrfs requires Linux and btrfs on PATH" }
    if (ctx?.crossDevice) return { available: false, reason: "btrfs requires the same filesystem" }
    const result = await this.io.run(["btrfs", "subvolume", "show", lower])
    if (result.code && /not a btrfs|not a subvolume|cannot find|no such|unknown subvolume|not a directory/i.test(result.stderr)) {
      return { available: false, reason: result.stderr }
    }
    if (result.code && !/operation not permitted|permission denied|could not search b-tree/i.test(result.stderr)) {
      // An I/O or similar operational failure says nothing about btrfs capability.
      throw new Error(`btrfs subvolume show ${lower} failed (${result.code}): ${result.stderr}`)
    }
    if (ctx) {
      // A subvolume reports its own st_dev, so device numbers cannot decide
      // "same filesystem" on the very filesystem this backend exists for.
      // The mount's filesystem UUID can: both paths must live on the same
      // btrfs, or the snapshot's cross-filesystem refusal stands.
      const target = await existingParent(ctx.baseDir)
      const fstype = await this.io.run(["findmnt", "-no", "FSTYPE", "--target", target])
      if (fstype.code || fstype.stdout.toString().trim() !== "btrfs") {
        return { available: false, reason: "btrfs requires the same filesystem" }
      }
      const lowerId = await this.io.run(["findmnt", "-no", "UUID", "--target", lower])
      const targetId = await this.io.run(["findmnt", "-no", "UUID", "--target", target])
      if (lowerId.code || targetId.code || lowerId.stdout.toString().trim() !== targetId.stdout.toString().trim()) {
        return { available: false, reason: "btrfs requires the same filesystem" }
      }
    }
    return { available: true }
  }
  async start(lower: string, merged: string, ctx: IsolationContext) {
    await mkdir(dirname(merged), { recursive: true })
    if (ctx.crossDevice) throw new IsolationUnavailableError("btrfs requires the same device")
    const probe = await this.probe(lower)
    if (!probe.available) throw new IsolationUnavailableError(probe.reason)
    const result = await this.io.run(["btrfs", "subvolume", "snapshot", lower, merged])
    if (result.code) {
      if (/not a subvolume|not a btrfs|operation not permitted|permission denied|operation not supported|cross-device/i.test(result.stderr)) throw new IsolationUnavailableError(result.stderr)
      throw new Error(`btrfs snapshot failed: ${result.stderr}`)
    }
    await markStarted(ctx.baseDir, this.kind)
  }
  async stop(merged: string) {
    if (!await exists(merged)) return
    await checked(this.io, ["btrfs", "subvolume", "delete", merged])
    await rm(merged, { recursive: true, force: true })
  }
}
