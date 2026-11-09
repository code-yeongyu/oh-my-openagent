import { readFileSync, renameSync, writeFileSync } from "node:fs"
import type { NotBefore } from "./otlp-http"

/**
 * The install's shared "do not send before" time, one epoch-ms number in `<spool dir>.not-before` beside the
 * spool (outside it, so the spool holds only batches). The collector
 * rate-limits per install, so a 429 seen by one process must pause every process of that install, not only the
 * one that received it. The time only moves forward; an unreadable or missing file means "send now".
 */
export function createSpoolNotBefore(dir: string): NotBefore {
  const path = `${dir}.not-before`
  const read = (): number => {
    try {
      const value = Number(readFileSync(path, "utf8").trim())
      return Number.isFinite(value) ? value : 0
    } catch {
      return 0
    }
  }
  return {
    read,
    defer(untilMs: number): void {
      if (untilMs <= read()) return
      const temp = `${path}.${process.pid}.tmp`
      try {
        writeFileSync(temp, String(Math.ceil(untilMs)))
        renameSync(temp, path)
      } catch {
        // Best effort: without the shared file this process still backs off on its own.
      }
    },
  }
}
