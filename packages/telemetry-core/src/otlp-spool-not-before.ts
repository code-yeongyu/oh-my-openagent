import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { MAX_RETRY_AFTER_MS, type NotBefore } from "./otlp-http"

/**
 * The install's shared "do not send before" time, one epoch-ms number in `<spool dir>.not-before` beside the
 * spool (outside it, so the spool holds only batches). The collector
 * rate-limits per install, so a 429 seen by one process must pause every process of that install, not only the
 * one that received it. The time only moves forward; an unreadable or missing file means "send now".
 *
 * No process writes a time more than one Retry-After window ahead, so a stored time past that window (a clock
 * set back, a hand-edited file) is cut to the window's end and written back that way: it costs one window, not
 * a pause on every send until the clock catches up.
 */
export function createSpoolNotBefore(dir: string): NotBefore {
  const path = `${dir}.not-before`
  const write = (untilMs: number): void => {
    const temp = `${path}.${process.pid}.tmp`
    try {
      writeFileSync(temp, String(Math.ceil(untilMs)))
      renameSync(temp, path)
    } catch {
      // Best effort: without the shared file this process still backs off on its own. A temp file the
      // failed rename left behind would otherwise stay beside the spool for good. The cleanup is best effort
      // too: `read()` writes, so an error here would turn a skipped write into a failed send.
      try {
        rmSync(temp, { force: true })
      } catch {}
    }
  }
  const read = (): number => {
    let value: number
    try {
      value = Number(readFileSync(path, "utf8").trim())
    } catch {
      return 0
    }
    if (!Number.isFinite(value)) return 0
    const windowEnd = Date.now() + MAX_RETRY_AFTER_MS
    if (value <= windowEnd) return value
    write(windowEnd)
    return windowEnd
  }
  return {
    read,
    defer(untilMs: number): void {
      if (untilMs <= read()) return
      write(untilMs)
    },
  }
}
