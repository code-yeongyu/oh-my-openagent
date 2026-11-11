import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, readFile, realpath, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { parseLockRecord } from "../memory-core/src/locks/lock-record"
import { isLockOwnerProvenDead } from "../memory-core/src/locks/stale-owner"
import { parseBuildInfo } from "./build-info"
import { provisionEmbeddedRuntime, runningExecutablePath, type EmbeddedFile, type EmbeddedManifest } from "./compile-runtime"
import { releaseAssetName, releaseVersionOf } from "./compiled-update"
import { classifyInstallOwnership, eligibleUpdateLaunch } from "./update-policy"
import { activateAtLaunch, startBootstrapMaintenance, startUpdateWorker, updateRoot } from "./update-lifecycle"
import { handOffToProvisionedRuntime } from "./provisioned-handoff"
import { UpdateStore, UPDATE_PROTOCOL, writeUpdateRecord, type Generation } from "./update-store"

export const UPDATE_HANDOFF_ENV = "OMO_UPDATE_HANDOFF"
const HANDOFF = UPDATE_HANDOFF_ENV
export type CompiledSelection = { runtime?: string; launcher?: string; store?: UpdateStore; handoff?: string; dispatched: boolean }

/** The only extraction path used by verified candidates; the target is private staging. */
export async function extractUpdateGeneration(manifest: EmbeddedManifest, embedded: EmbeddedFile[], directory: string): Promise<void> {
  await provisionEmbeddedRuntime(manifest, embedded, directory)
  await copyFile(runningExecutablePath(), join(directory, process.platform === "win32" ? "omo.exe" : "omo"))
  await writeUpdateRecord(join(directory, "runtime-manifest.json"), manifest)
}

/**
 * Called before trust and every static answer. A generation executable is a pin,
 * not a bootstrap: it registers its own process lease and never selects again.
 */
export async function selectCompiledRuntime(manifest: EmbeddedManifest, embedded: EmbeddedFile[], args: string[]): Promise<CompiledSelection> {
  const rawHandoff = process.env[HANDOFF]
  delete process.env[HANDOFF]
  let root = updateRoot()
  const running = await realpath(runningExecutablePath())
  const directory = dirname(running)
  if (basename(dirname(directory)) === "generations") {
    // An absolute generation path stays pinned even if a task changes HOME.
    root = dirname(dirname(directory))
    delete process.env.OMO_PROVISIONED_HANDOFF
    delete process.env.OMO_PROVISIONED_LAUNCHER
    let launcher: string | undefined
    let store: UpdateStore
    if (rawHandoff) {
      try {
        const handoff = JSON.parse(rawHandoff)
        if (typeof handoff.launcher !== "string" || typeof handoff.nonce !== "string"
          || !/^[0-9a-f-]{36}$/.test(handoff.nonce)) throw new Error("Invalid runtime handoff")
        store = new UpdateStore(root, await realpath(handoff.launcher))
        const owner = parseLockRecord(await readFile(join(root, "leases", basename(directory), `${handoff.nonce}.json`), "utf8"))
        const record = await store.read()
        if (!owner || owner.purpose !== `compiled-runtime-use:${store.installKey}`
          || (owner.pid !== process.pid && owner.pid !== process.ppid)
          || await isLockOwnerProvenDead(owner) || record?.id !== handoff.installation) throw new Error("Runtime handoff does not name a live installation lease")
        launcher = store.launcher
      } catch { store = new UpdateStore(root, running) }
    } else { store = new UpdateStore(root, running) }
    // Independent daemon/task children acquire their own lease. They need no inherited
    // authority and remain pinned after the parent launcher exits.
    const lease = await store.lease(basename(directory))
    const record = launcher ? await store.read() : undefined
    return {
      runtime: running, launcher, store: launcher ? store : undefined, dispatched: false,
      handoff: record ? JSON.stringify({ launcher, installation: record.id, nonce: lease.nonce }) : undefined,
    }
  }
  if (parseBuildInfo(manifest.buildInfo) !== undefined) return { dispatched: false }
  // A legacy runtime invoked directly stays pinned; it cannot become a bootstrap via env.
  if (/[\\/]binary-runtime[\\/]/.test(running)) return { dispatched: false }
  const ownership = await classifyInstallOwnership(running)
  if (ownership.kind !== "standalone") {
    if (eligibleUpdateLaunch(args, process.env, process.stderr.isTTY === true)) {
      process.stderr.write(`omo: ${ownership.kind === "manager-owned" ? ownership.command : `automatic updates unavailable: ${ownership.reason}`}\n`)
    }
    return { dispatched: false }
  }
  const store = new UpdateStore(root, ownership.path)
  // Recover local durable state even when checks are disabled or the worker's next
  // network check is hours away. A busy writer leaves readers on the committed record.
  if (existsSync(store.journalPath)) {
    try { await store.transaction(async () => {}) }
    catch (error) {
      if (!(error instanceof Error && error.name === "LockContentionError")) {
        process.stderr.write(`omo: update recovery deferred (${error instanceof Error ? error.message : String(error)})\n`)
      }
    }
  }
  if (!(await store.matchesLauncher())) return { dispatched: false }
  if ((await store.read())?.selected === undefined) {
    await store.transaction(async (tx) => {
      await tx.initialize({
        asset: releaseAssetName(manifest.releaseTarget, process.platform, process.arch),
        channel: releaseVersionOf(manifest.omoAiVersion).includes("-") ? "beta" : "stable",
        ownership: "standalone",
        bootstrapVersion: releaseVersionOf(manifest.omoAiVersion),
      })
      if ((await store.read())?.selected !== undefined) return
      const staging = await store.createStaging()
      try {
        await extractUpdateGeneration(manifest, embedded, staging)
        const generation: Generation = {
          version: releaseVersionOf(manifest.omoAiVersion),
          asset: releaseAssetName(manifest.releaseTarget, process.platform, process.arch),
          digest: createHash("sha256").update(await readFile(running)).digest("hex"),
          protocol: UPDATE_PROTOCOL, backwardCompatible: manifest.updateBackwardCompatible === true,
          payloadDigest: createHash("sha256").update(await readFile(join(staging, "runtime-manifest.json"))).digest("hex"),
        }
        await tx.publish(staging, generation)
        // Enrollment adopts the executable already running, not an untrusted release.
        await tx.select(async () => {})
      } finally { await rm(staging, { recursive: true, force: true }) }
    }, { waitTimeoutMs: 30_000 })
  }
  await activateAtLaunch(store, args, manifest.omoAiVersion)
  const lease = await store.selectedLease()
  if (!lease) return { dispatched: false }
  const selected = await store.generation(lease.id)
  const executable = join(lease.directory, selected.asset.endsWith(".exe") ? "omo.exe" : "omo")
  // A worker launched here cannot activate its download into this already-chosen launch.
  await startUpdateWorker(store, executable, args)
  const record = await store.read()
  const maintainBootstrap = eligibleUpdateLaunch(args, process.env, process.stderr.isTTY === true)
    && record?.staged !== undefined && (await store.generation(record.staged.generation)).protocol !== UPDATE_PROTOCOL
  const env = { ...process.env, [HANDOFF]: JSON.stringify({ launcher: store.launcher, installation: record!.id, nonce: lease.nonce }) }
  try {
    await handOffToProvisionedRuntime(executable, { argv: args, env, ...(maintainBootstrap ? { execve: null } : {}) })
  } finally {
    await lease.release()
    if (maintainBootstrap) await startBootstrapMaintenance(store, executable)
  }
  return { dispatched: true }
}
