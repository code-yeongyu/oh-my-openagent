import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface CrashMarkerIo {
  readonly pid: number
  readonly isAlive: (pid: number) => boolean
  readonly now: () => Date
}

export interface AbnormalExit {
  readonly startedAt: string
}

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * One marker file per interactive OmO process under `<stateDir>/feedback/running/<pid>.json`. A clean stop removes it; a
 * marker whose process is gone at the next launch means that run ended abnormally. Reading a stale marker removes it, so
 * each abnormal exit is reported at most once.
 */
export function createCrashMarker(stateDir: () => string, io: CrashMarkerIo) {
  const feedbackDir = () => join(stateDir(), "feedback")
  const runningDir = () => join(feedbackDir(), "running")
  const prefsPath = () => join(feedbackDir(), "crash-prompt.json")
  let own: string | undefined

  return {
    takeAbnormalExits(): AbnormalExit[] {
      let names: string[]
      try {
        names = readdirSync(runningDir())
      } catch {
        return []
      }
      const exits: AbnormalExit[] = []
      for (const name of names) {
        const pid = Number(name.replace(/\.json$/, ""))
        if (!Number.isInteger(pid) || pid === io.pid || io.isAlive(pid)) continue
        const path = join(runningDir(), name)
        let startedAt = "an unknown time"
        try {
          const recorded: unknown = Reflect.get(Object(JSON.parse(readFileSync(path, "utf8"))), "startedAt")
          if (typeof recorded === "string") startedAt = recorded
        } catch {
          // An unreadable marker is still a run that never stopped cleanly; only its start time is unknown.
        }
        rmSync(path, { force: true })
        exits.push({ startedAt })
      }
      return exits
    },
    markRunning(): void {
      mkdirSync(runningDir(), { recursive: true, mode: 0o700 })
      own = join(runningDir(), `${io.pid}.json`)
      writeFileSync(own, JSON.stringify({ pid: io.pid, startedAt: io.now().toISOString() }), { mode: 0o600 })
    },
    markStopped(): void {
      if (own !== undefined) rmSync(own, { force: true })
      own = undefined
    },
    askingDisabled(): boolean {
      try {
        return Reflect.get(Object(JSON.parse(readFileSync(prefsPath(), "utf8"))), "dontAsk") === true
      } catch {
        return false
      }
    },
    disableAsking(): void {
      mkdirSync(feedbackDir(), { recursive: true, mode: 0o700 })
      writeFileSync(prefsPath(), JSON.stringify({ dontAsk: true }), { mode: 0o600 })
    },
  }
}
