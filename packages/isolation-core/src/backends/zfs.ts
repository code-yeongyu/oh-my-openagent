import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { BACKEND_FILE, IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"
import { markStarted } from "../backend-marker"
import { checked, runtime, type BackendRuntime } from "./runtime"

interface ZfsMarker { backend: string; dataset: string; snapshot: string; cloned: boolean }
export class ZfsBackend implements IsolationBackend {
  readonly kind = "zfs" as const
  readonly clonesTree = true
  constructor(private readonly io: BackendRuntime = runtime) {}
  private async dataset(lower: string): Promise<string | undefined> {
    if (!this.io.which("zfs")) return undefined
    const result = await this.io.run(["zfs", "list", "-H", "-o", "name,mountpoint"])
    if (result.code) {
      if (/no datasets|dataset does not exist|pool .* does not exist|permission denied|failed to initialize|no pools available|cannot open/i.test(result.stderr)) return undefined
      throw new Error(`zfs list failed (${result.code}): ${result.stderr}`)
    }
    return result.stdout.split("\n").map((line) => line.split("\t"))
      .find(([, mount]) => mount?.startsWith("/") && resolve(mount) === resolve(lower))?.[0]
  }
  async probe(lower: string) {
    // ZFS delegation is a Linux capability; say so up front on other platforms
    // instead of failing the dataset parse against foreign path forms.
    if (this.io.platform !== "linux") return { available: false, reason: "zfs requires Linux and a delegated ZFS dataset root" }
    return { available: !!await this.dataset(lower), reason: "source must be a delegated ZFS dataset root" }
  }
  /** Capability failures (a dataset not delegated to us) fall through; the rest propagate. */
  private async capable(argv: string[]): Promise<void> {
    try { await checked(this.io, argv) } catch (error) {
      if (/permission denied|dataset does not exist|pool .* does not exist|not delegated/i.test(String((error as Error).message))) {
        throw new IsolationUnavailableError(String((error as Error).message))
      }
      throw error
    }
  }
  async start(lower: string, merged: string, ctx: IsolationContext) {
    const source = await this.dataset(lower)
    if (!source) throw new IsolationUnavailableError("source is not a ZFS dataset root")
    if (!/^[a-zA-Z0-9_.-]+$/.test(ctx.id)) throw new Error("Invalid ZFS isolation id")
    const snapshot = `${source}@omo-${ctx.id}`, dataset = `${source}/omo-${ctx.id}`
    await mkdir(ctx.baseDir, { recursive: true })
    await this.capable(["zfs", "snapshot", snapshot])
    // Persist the snapshot before clone so a crash or clone failure can be reclaimed.
    await writeFile(join(ctx.baseDir, BACKEND_FILE), JSON.stringify({ backend: this.kind, dataset, snapshot, cloned: false }))
    await this.capable(["zfs", "clone", "-o", `mountpoint=${merged}`, snapshot, dataset])
    await writeFile(join(ctx.baseDir, BACKEND_FILE), JSON.stringify({ backend: this.kind, dataset, snapshot, cloned: true }))
    await markStarted(ctx.baseDir, this.kind)
  }
  private async marker(base: string): Promise<ZfsMarker | undefined> {
    let marker: ZfsMarker
    try { marker = JSON.parse(await readFile(join(base, BACKEND_FILE), "utf8")) } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
    if (!marker.dataset && !marker.snapshot) return undefined
    const source = marker.snapshot?.split("@omo-")[0]
    const suffix = marker.snapshot?.split("@omo-")[1]
    if (marker.backend !== "zfs" || !source || !suffix || !/^[a-zA-Z0-9_.-]+$/.test(suffix) || marker.dataset !== `${source}/omo-${suffix}`) throw new Error("Invalid ZFS isolation marker")
    return marker
  }
  async relocate(from: string, to: string) {
    const marker = await this.marker(from)
    if (!marker?.cloned) throw new Error("Missing ZFS clone marker")
    await rename(from, to)
    try { await checked(this.io, ["zfs", "set", `mountpoint=${join(to, "m")}`, marker.dataset]) } catch (error) {
      await rename(to, from)
      throw error
    }
  }
  async stop(merged: string) {
    const marker = await this.marker(dirname(merged))
    if (marker) {
      if (marker.cloned) {
        await checked(this.io, ["zfs", "destroy", "-r", marker.dataset])
        marker.cloned = false
        await writeFile(join(dirname(merged), BACKEND_FILE), JSON.stringify(marker))
      }
      await checked(this.io, ["zfs", "destroy", marker.snapshot])
      await writeFile(join(dirname(merged), BACKEND_FILE), JSON.stringify({ backend: this.kind }))
    }
    await rm(merged, { recursive: true, force: true })
  }
}
