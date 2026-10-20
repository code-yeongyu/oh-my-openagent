// The production engine for one memory repository on this device. A device runs one engine per
// repository: the lease `<repo>/.git/omo-sync/engine.lock` is taken without waiting (another
// process on this device already syncing answers null), and a crashed holder is reclaimed by the
// lock layer's dead-owner proof. Applies and renders run under the shared `memory-write` lock, so
// memory tool writes and sync commits never interleave. The account session (transport, verifier,
// sealer) is supplied by the harness once the device is signed in and holds its keys.

import { join } from "node:path"

import { mkdir } from "../../fs/resilient"
import { acquireLock, LockContentionError, releaseLock, withLock } from "../../locks/acquire"
import { memoryWriterLockPath } from "../../locks/domains"
import { createLockRecord } from "../../locks/lock-record"
import { createDeviceItemStore } from "./adapters/device-item-store"
import { createGitSyncRepo } from "./adapters/git-sync-repo"
import { type EngineStatus, SyncEngine } from "./engine"
import type { Clock, Sealer, Transport, Verifier, WriterLock } from "./ports"

/** How long an apply waits for a memory tool write to finish before the cycle is retried. */
const WRITER_WAIT_MS = 30_000

export interface SyncSession {
  readonly transport: Transport
  readonly verifier: Verifier
  readonly sealer: Sealer
}

export interface OpenDeviceSyncOptions {
  readonly repoDir: string
  /** The device's private state (item peer, capture receipts), outside the repository. */
  readonly stateDir: string
  /** The identity's locks directory, shared with the memory tools. */
  readonly locksDir: string
  readonly session: SyncSession
  readonly machineId?: string
  readonly log?: (line: string) => void
}

export interface DeviceSync {
  readonly engine: SyncEngine
  status(): Promise<EngineStatus>
  notifyLocalCommit(): void
  close(): Promise<void>
}

const systemClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
}

export async function openDeviceSync(options: OpenDeviceSyncOptions): Promise<DeviceSync | null> {
  const repo = createGitSyncRepo({ root: options.repoDir })
  const syncDir = join(repo.gitDir, "omo-sync")
  await mkdir(syncDir, { recursive: true })
  // Outside omo-sync/: retiring a copied journal renames that directory, which must not move the lease.
  const leasePath = join(repo.gitDir, "omo-sync-engine.lock")
  const lease = await createLockRecord("memory sync engine")
  try {
    await acquireLock(leasePath, lease, { waitTimeoutMs: 0 })
  } catch (error) {
    if (error instanceof LockContentionError) return null
    throw error
  }
  try {
    await mkdir(options.locksDir, { recursive: true })
    const writer: WriterLock = {
      withLock: async (fn) => withLock(memoryWriterLockPath(options.locksDir), await createLockRecord("memory sync apply"), fn, { waitTimeoutMs: WRITER_WAIT_MS }),
    }
    const store = createDeviceItemStore({
      stateDir: options.stateDir,
      memoryRoot: options.repoDir,
      syncDir,
      ...(options.machineId === undefined ? {} : { machineId: options.machineId }),
    })
    const engine = new SyncEngine({
      repo,
      store,
      ...options.session,
      lock: writer,
      clock: systemClock,
      ...(options.log === undefined ? {} : { log: options.log }),
    })
    let closed = false
    return {
      engine,
      status: () => engine.status(),
      notifyLocalCommit: () => engine.notifyLocalCommit(),
      async close() {
        if (closed) return
        closed = true
        await engine.stop()
        await releaseLock(leasePath, lease)
      },
    }
  } catch (error) {
    await releaseLock(leasePath, lease)
    throw error
  }
}
