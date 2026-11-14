import { appendFileSync, mkdirSync, rmdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { log } from "../../shared"
import type { OutputLine } from "./types"

/** Where a monitor's output file lives: one directory per parent session under the OS temp dir. */
export function monitorOutputPath(parentSessionId: string, monitorId: string, root = tmpdir()): string {
  return join(root, "omo-monitor", parentSessionId, `${monitorId}.output`)
}

/**
 * Appends every line a monitor prints, stderr prefixed `[stderr] `, so the agent can `read` what the events left out.
 * Lines are buffered and written at most every 250 ms; a write failure disables the file, never the monitor.
 */
export class MonitorOutputFile {
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private failed = false
  private closed = false

  constructor(readonly path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, "")
    } catch (error) {
      this.failed = true
      log("[monitor] Could not create the monitor output file", { path, error: String(error) })
    }
  }

  write(line: OutputLine): void {
    if (this.failed || this.closed) return
    this.buffer.push(line.stream === "stderr" ? `[stderr] ${line.text}` : line.text)
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 250)
    this.timer.unref?.()
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.failed || this.buffer.length === 0) return
    const text = `${this.buffer.join("\n")}\n`
    this.buffer = []
    try {
      appendFileSync(this.path, text)
    } catch (error) {
      this.failed = true
      log("[monitor] Monitor output file write failed; output stays in the ring buffer", {
        path: this.path,
        error: String(error),
      })
    }
  }
}

/**
 * Deletes a monitor's output file once its record is gone, then the session and root directories if that left them
 * empty, so monitors leave nothing behind in the temp dir.
 */
export function removeMonitorOutputFile(path: string): void {
  try {
    rmSync(path, { force: true })
    const sessionDir = dirname(path)
    for (const dir of [sessionDir, dirname(sessionDir)]) {
      rmdirSync(dir)
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOENT") return
    log("[monitor] Could not remove a monitor output file", { path, error: String(error) })
  }
}
