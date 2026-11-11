import { spawn } from "node:child_process"
import { readFile, realpath, rm } from "node:fs/promises"
import { join } from "node:path"
import { runtimeHome } from "./bin/lib/agent-dir.js"
import { fetchGitHubReleases, pickUpdateVersion } from "./compiled-update"
import { downloadGeneration, preflightGeneration } from "./compiled-update-download"
import { classifyInstallOwnership, eligibleUpdateLaunch, updatePolicy } from "./update-policy"
import { UpdateStore, writeUpdateRecord } from "./update-store"
import { UPDATE_PROTOCOL } from "./update-store"
import { createLockRecord, parseLockRecord } from "../memory-core/src/locks/lock-record"
import { isLockOwnerProvenDead } from "../memory-core/src/locks/stale-owner"

const CHECK_INTERVAL = 6 * 60 * 60_000

export async function refreshInstallReceipt(store: UpdateStore, bootstrapVersion: string): Promise<void> {
  const path = join(store.root, "..", "install.json")
  let receipt: Record<string, unknown>
  try { receipt = JSON.parse(await readFile(path, "utf8")) }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
  if (receipt.method !== "standalone" || typeof receipt.binPath !== "string"
    || await realpath(receipt.binPath) !== store.launcher) return
  const record = await store.read()
  if (!record?.selected) return
  const generation = await store.generation(record.selected)
  await writeUpdateRecord(path, { ...receipt, version: generation.version, effectiveVersion: generation.version, bootstrapVersion: record.bootstrapVersion ?? bootstrapVersion })
}

export async function updateDiagnosticLines(store?: UpdateStore, launcher?: string): Promise<string[]> {
  const policy = await updatePolicy()
  if (!store && launcher) {
    const ownership = await classifyInstallOwnership(launcher)
    return [`INFO updates: policy ${policy.mode}; ownership ${ownership.kind}; ${
      ownership.kind === "manager-owned" ? ownership.command : ownership.kind === "unknown" ? ownership.reason : "installation is not enrolled"
    }`]
  }
  if (!store) return [`INFO updates: pinned runtime; policy ${policy.mode}${policy.reason ? ` (${policy.reason})` : ""}`]
  const record = await store.read()
  if (!record) return ["INFO updates: installation is not enrolled"]
  return [
    `INFO updates: policy ${policy.mode}; ownership ${record.ownership}; bootstrap ${record.bootstrapVersion ?? "unknown"}`,
    `INFO updates: selected ${record.selected?.split("-omo-")[0] ?? "none"}; previous ${record.previous?.split("-omo-")[0] ?? "none"}; staged ${record.staged?.generation.split("-omo-")[0] ?? "none"}`,
    `INFO updates: last check ${record.lastCheck ? new Date(record.lastCheck).toISOString() : "never"}${record.reason ? `; ${record.reason}` : ""}`,
  ]
}

export async function runUpdateWorker(store: UpdateStore, installationId: string): Promise<void> {
  try {
    await store.transaction(async (tx) => {
      const record = await tx.record()
      if (record.id !== installationId || !record.selected || (record.nextCheck ?? 0) > Date.now()) return
      const policy = await updatePolicy()
      if (policy.mode === "off") return
      const owner = await classifyInstallOwnership(store.launcher)
      if (owner.kind !== "standalone" || owner.path !== store.launcher) return
      const now = Date.now()
      // Persist a due claim before the request. A killed worker cannot trigger a launch storm.
      await tx.updateStatus({ lastCheck: now, nextCheck: now + CHECK_INTERVAL })
      let staging: string | undefined
      try {
        const selected = await store.generation(record.selected)
        const target = pickUpdateVersion(selected.version, await fetchGitHubReleases(), record.asset)
        if (!target) { await tx.updateStatus({ failures: 0, reason: undefined }); return }
        if ((await updatePolicy()).mode !== "auto") {
          await tx.updateStatus({ failures: 0, reason: `omo ${target} is available; run omo update` })
          return
        }
        const candidate = await downloadGeneration({ store, version: target, asset: record.asset, platform: process.platform, arch: process.arch })
        staging = candidate.staging
        const rechecked = await classifyInstallOwnership(store.launcher)
        if ((await updatePolicy()).mode !== "auto" || rechecked.kind !== "standalone" || rechecked.path !== store.launcher) return
        await tx.publish(candidate.staging, candidate.generation)
        staging = undefined
        await tx.updateStatus({
          failures: 0,
          reason: candidate.generation.protocol === UPDATE_PROTOCOL
            ? `omo ${target} is ready for the next interactive launch`
            : `omo ${target} needs bootstrap maintenance after all launcher processes exit`,
        })
      } catch (error) {
        const failures = Math.min((record.failures ?? 0) + 1, 8)
        const reason = error instanceof Error ? error.message : String(error)
        const hint = error instanceof Error && "retryAfterMs" in error && typeof error.retryAfterMs === "number"
          && Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0
        await tx.updateStatus({
          failures, nextCheck: now + Math.min(CHECK_INTERVAL, Math.max(hint, 60_000 * 2 ** failures)),
          reason: reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 240),
        })
      } finally {
        if (staging) await rm(staging, { recursive: true, force: true })
        await tx.gc()
      }
    })
  } catch (error) {
    // A simultaneous launcher/explicit updater won. Never turn a background check
    // into a session failure; its durable state remains the diagnostic source.
    if (!(error instanceof Error && error.name === "LockContentionError")) throw error
  }
}

export async function activateAtLaunch(store: UpdateStore, args: string[], bootstrapVersion: string): Promise<void> {
  if (!eligibleUpdateLaunch(args, process.env, process.stderr.isTTY === true)) return
  const policy = await updatePolicy()
  if (policy.reason) process.stderr.write(`omo: ${policy.reason}\n`)
  if (policy.mode !== "auto") return
  const record = await store.read()
  if (!record?.staged) return
  try {
    await store.transaction(async (tx) => {
      if ((await updatePolicy()).mode !== "auto") return
      const owner = await classifyInstallOwnership(store.launcher)
      if (owner.kind !== "standalone" || owner.path !== store.launcher) return
      await tx.select(async (directory, generation) => {
        await preflightGeneration(directory, generation)
        if ((await updatePolicy()).mode !== "auto") throw new Error("Update policy changed during preflight")
        const currentOwner = await classifyInstallOwnership(store.launcher)
        if (currentOwner.kind !== "standalone" || currentOwner.path !== store.launcher) throw new Error("Installation ownership changed during preflight")
      })
      await refreshInstallReceipt(store, bootstrapVersion)
      await tx.gc()
      const selected = await store.read()
      process.stderr.write(`omo: selected ${record.selected?.split("-omo-")[0]} -> ${selected?.selected?.split("-omo-")[0]}\n`)
    })
  } catch (error) {
    if (!(error instanceof Error && error.name === "LockContentionError")) {
      process.stderr.write(`omo: update deferred (${error instanceof Error ? error.message : String(error)})\n`)
    }
  }
}

export async function startUpdateWorker(store: UpdateStore, executable: string, args: string[]): Promise<void> {
  if (!eligibleUpdateLaunch(args, process.env, process.stderr.isTTY === true)) return
  const policy = await updatePolicy()
  if (policy.mode === "off") return
  const record = await store.read()
  if (!record || (record.nextCheck ?? 0) > Date.now()) {
    if (record?.reason) process.stderr.write(`omo: ${record.reason}\n`)
    return
  }
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(?:OMO_UPDATE_|OMO_PROVISIONED_|SENPI_PRIVATE_|OMO_PRIVATE_)/.test(key)
      || key === "BUN_BE_BUN" || key === "SENPI_BRAND") delete env[key]
  }
  const worker = spawn(executable, ["--omo-update-worker", store.launcher, record.id], {
    env, detached: true, stdio: "ignore", windowsHide: true,
  })
  worker.on("error", () => { /* A later eligible launch retries; no request was made. */ })
  worker.unref()
}

export function updateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(runtimeHome(env), ".omo", "updates")
}

export async function startBootstrapMaintenance(store: UpdateStore, executable: string): Promise<void> {
  const record = await store.read()
  if (!record?.staged) return
  const parent = await createLockRecord("bootstrap-exit")
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(?:OMO_UPDATE_|OMO_PROVISIONED_|SENPI_PRIVATE_|OMO_PRIVATE_)/.test(key) || key === "BUN_BE_BUN") delete env[key]
  }
  const worker = spawn(executable, ["--omo-update-bootstrap", store.launcher, record.id, JSON.stringify(parent)], {
    env, detached: true, stdio: "ignore", windowsHide: true,
  })
  worker.on("error", () => { /* Maintenance stays pending for a later eligible exit. */ })
  worker.unref()
}

export async function runBootstrapMaintenance(store: UpdateStore, installationId: string, rawParent: string): Promise<void> {
  const parent = parseLockRecord(rawParent)
  if (!parent) throw new Error("Bootstrap maintenance requires process-start identity")
  const deadline = Date.now() + 30_000
  while (!(await isLockOwnerProvenDead(parent))) {
    if (Date.now() >= deadline) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if ((await updatePolicy()).mode !== "auto") return
  const owner = await classifyInstallOwnership(store.launcher)
  if (owner.kind !== "standalone" || owner.path !== store.launcher) return
  try {
    await store.transaction(async (tx) => {
      const record = await tx.record()
      if (record.id !== installationId) return
      await tx.maintainBootstrap(async (directory, generation) => {
        await preflightGeneration(directory, generation)
        const currentOwner = await classifyInstallOwnership(store.launcher)
        if ((await updatePolicy()).mode !== "auto" || currentOwner.kind !== "standalone" || currentOwner.path !== store.launcher) {
          throw new Error("Bootstrap maintenance policy or ownership changed")
        }
      })
      await refreshInstallReceipt(store, record.bootstrapVersion ?? "unknown")
    })
  } catch (error) {
    if (!(error instanceof Error && error.name === "LockContentionError")) throw error
  }
}
