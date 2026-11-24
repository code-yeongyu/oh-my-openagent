import { LspClient } from "./client.js"
import { ControlledClock } from "./controlled-clock-test-support.js"
import { LspManager } from "./manager.js"
import type { ResolvedServer } from "./types.js"

export const SERVER: ResolvedServer = { id: "typescript", command: ["fake-ts-ls"], extensions: [".ts"], priority: 1 }
export const IDLE_TIMEOUT_MS = 1_000
export const INIT_TIMEOUT_MS = 5_000
export const REAPER_INTERVAL_MS = 100

export interface Gate {
  readonly promise: Promise<void>
  open(): void
}

function gate(): Gate {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, open: () => resolvePromise?.() }
}

/** A client whose start finishes when `started` opens and whose stop finishes when `stopped` opens. */
class GatedClient extends LspClient {
  readonly started = gate()
  readonly stopped = gate()
  stopCount = 0
  private alive = true

  constructor(root: string, holdStart: boolean, holdStop: boolean, server: ResolvedServer = SERVER) {
    super(root, server)
    if (!holdStart) this.started.open()
    if (!holdStop) this.stopped.open()
  }

  override async start(): Promise<void> {
    await this.started.promise
  }

  override async initialize(): Promise<void> {}

  override async stop(): Promise<void> {
    this.stopCount += 1
    await this.stopped.promise
    this.alive = false
  }

  override isAlive(): boolean {
    return this.alive
  }

  running(): boolean {
    return this.alive && this.stopCount === 0
  }
}

export interface GatedManagerOptions {
  readonly maxResidentClients?: number
  /** Whether the start of the n-th spawned client (0-based) waits for its gate. */
  readonly holdStart?: (index: number) => boolean
  readonly holdStops?: boolean
}

/** A real LspManager over gated fake clients, on a virtual clock that also drives its reaper. */
export function gatedManager(options: GatedManagerOptions = {}) {
  const clock = new ControlledClock()
  const clients: GatedClient[] = []
  const manager = new LspManager({
    maxResidentClients: options.maxResidentClients ?? 6,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    initTimeoutMs: INIT_TIMEOUT_MS,
    reaperIntervalMs: REAPER_INTERVAL_MS,
    now: clock.now,
    timers: clock,
    clientFactory: (root) => {
      const client = new GatedClient(root, options.holdStart?.(clients.length) ?? false, options.holdStops ?? false)
      clients.push(client)
      return client
    },
  })
  return { manager, clients, clock }
}

/** Per pooled key: root, references, counted waiters, still starting. */
export function pool(manager: LspManager) {
  return manager
    .getSnapshot()
    .map((entry) => [entry.root, entry.refCount, entry.pendingWaiters, entry.isInitializing] as const)
}

/**
 * Runs `action` after `turns` microtask turns. Sweeping `turns` lands the action at every step of a
 * promise chain (here: a start finishing and its waiters resuming) without timers or sleeps.
 */
export async function afterMicrotasks(turns: number, action: () => void): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
  action()
}

export const MICROTASK_SWEEP = Array.from({ length: 12 }, (_, turns) => turns)

export function settle<T>(promise: Promise<T>): Promise<{ readonly value?: T; readonly error?: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
}
