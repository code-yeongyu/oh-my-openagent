import type { Clock, ItemStore, Sealer, SyncRepo, Transport, Verifier, WriterLock } from "./ports"

/** Where a crash can be injected: right after each journal marker, or between an effect and its marker. */
export const INBOUND_POINTS = ["captured", "persisted", "downloaded", "verified", "merged", "staged", "render-intent", "render-key", "rendered", "git-commit", "committed", "checkpointed"] as const
export const OUTBOUND_POINTS = ["sealed", "reserved", "uploaded", "append-landed", "appended"] as const
export type EnginePoint = (typeof INBOUND_POINTS)[number] | (typeof OUTBOUND_POINTS)[number]
export type EngineFault = (point: EnginePoint) => void

export class CrashInjected extends Error {
  override readonly name = "CrashInjected"
  constructor(readonly point: string) {
    super(`crash injected at ${point}`)
  }
}

export interface EngineDeps {
  readonly repo: SyncRepo
  readonly store: ItemStore
  readonly transport: Transport
  readonly verifier: Verifier
  readonly sealer: Sealer
  readonly lock: WriterLock
  readonly clock: Clock
  readonly fault?: EngineFault
  readonly log?: (line: string) => void
  /** The plaintext bound per pushed batch; defaults to MAX_BATCH_BYTES. */
  readonly batchBytes?: number
  readonly random?: () => number
}
