import { log } from "./logger"

function nowMs(): number {
  const perfNow = globalThis.performance?.now?.bind(globalThis.performance)
  if (perfNow) return perfNow()
  return Date.now()
}

export interface PerfLogger {
  enabled: boolean
  mark: () => number
  measure: (name: string, startMs: number, data?: Record<string, unknown>) => void
}

export function createPerfLogger(): PerfLogger {
  const enabled = process.env.OMO_PROFILE === "1" || process.env.OMO_PROFILE === "true"

  const mark = () => (enabled ? nowMs() : 0)
  const measure = (name: string, startMs: number, data?: Record<string, unknown>) => {
    if (!enabled) return
    const ms = Math.round((nowMs() - startMs) * 100) / 100
    log(`[perf] ${name}`, { ms, ...data })
  }

  return { enabled, mark, measure }
}

