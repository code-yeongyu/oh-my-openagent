import { Signal } from "./signal"

const DEFAULT_GRACE_PERIOD_MS = 3000

interface TerminableProcess {
  pid?: number
  kill: (signal?: NodeJS.Signals) => void
  exited?: Promise<unknown>
}

interface GracefulTerminateOptions {
  gracePeriodMs?: number
}

function gracefulTerminate(proc: TerminableProcess, options?: GracefulTerminateOptions): void {
  const gracePeriodMs = options?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS

  proc.kill(Signal.SIGTERM.name)

  const timeoutId = setTimeout(() => {
    try {
      proc.kill(Signal.SIGKILL.name)
    } catch {}
  }, gracePeriodMs)

  if (proc.exited) {
    proc.exited.then(() => clearTimeout(timeoutId)).catch(() => {})
  }
}

export { gracefulTerminate }
export type { GracefulTerminateOptions, TerminableProcess }
