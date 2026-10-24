import type { SpawnSyncOptions } from "node:child_process"

type ProcessProbe = (command: string, args: readonly string[], options: SpawnSyncOptions) => {
  readonly status: number | null
  readonly stdout?: unknown
  readonly error?: Error
}

export function windowsTreeKillArgs(rootPid: number, run?: ProcessProbe, selfPid?: number): string[]
