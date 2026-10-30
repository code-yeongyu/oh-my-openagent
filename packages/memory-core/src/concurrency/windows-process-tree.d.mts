import type { SpawnSyncOptions } from "node:child_process"

type ProcessProbe = (command: string, args: readonly string[], options: SpawnSyncOptions) => {
  readonly status: number | null
  readonly stdout?: unknown
  readonly error?: Error
}

/** rootStartedAt is a UTC FILETIME spawn-time lower bound (100 ns ticks since 1601-01-01). */
export function windowsTreeKillArgs(rootPid: number, run?: ProcessProbe, selfPid?: number, rootStartedAt?: bigint): string[]
