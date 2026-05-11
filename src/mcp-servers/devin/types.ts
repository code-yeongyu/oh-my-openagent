import type { Subprocess } from "bun"

export type DevinSessionStatus = "running" | "completed" | "error" | "cancelled"

export type DevinSession = {
  id: string
  proc: Subprocess
  logPath: string
  startedAt: number
  endedAt?: number
  cwd: string
  prompt: string
  model?: string
  status: DevinSessionStatus
  exitCode?: number
  resumeId?: string
}

export type DevinSessionSnapshot = Omit<DevinSession, "proc"> & {
  output: string
  outputBytes: number
  durationMs: number
  running: boolean
}
