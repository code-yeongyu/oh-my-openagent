import type { Signal } from "./signal"

type KillableProcess = {
  pid?: number
  kill: (signal?: NodeJS.Signals) => void
}

function killProcessGroup(proc: KillableProcess, signal: Signal): void {
  const signalName = signal.name

  if (proc.pid === undefined || isNaN(proc.pid)) {
    proc.kill(signalName)
    return
  }

  try {
    process.kill(-proc.pid, signalName as NodeJS.Signals)
  } catch {
    proc.kill(signalName)
  }
}

export { killProcessGroup }
export type { KillableProcess }
