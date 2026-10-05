import { watch } from "@oh-my-opencode/memory-core/fs"
import { mkdir, readdir, writeFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

const FILESYSTEM_RECHECK_INTERVAL_MS = 25

export async function waitForFilesystemState<T>(
  directory: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const initial = await probe()
  if (initial !== undefined) return initial
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    let checking = false
    let pending = false
    const timeout = setTimeout(() => finish(new Error(`waited ${timeoutMs}ms for ${description}`)), timeoutMs)
    const watcher = watch(directory, () => { void check() })
    const finish = (error?: Error, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      watcher.close()
      clearInterval(recheck)
      if (error !== undefined) reject(error)
      else resolve(value as T)
    }
    // An event arriving while a probe is in flight used to be dropped outright, and the state this
    // waits for is usually the last thing written to the directory - so that dropped event was
    // never followed by another and the wait hung until its ceiling. Recording the event and
    // re-probing after the in-flight one settles keeps every notification meaningful, and the
    // interval re-read makes arrival depend on the state itself rather than on event delivery.
    const check = async () => {
      if (settled) return
      if (checking) {
        pending = true
        return
      }
      checking = true
      try {
        do {
          pending = false
          const value = await probe()
          if (value !== undefined) {
            finish(undefined, value)
            return
          }
        } while (pending)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      } finally {
        checking = false
      }
    }
    const recheck = setInterval(() => { void check() }, FILESYSTEM_RECHECK_INTERVAL_MS)
    void check()
  })
}

export async function createTestClock(runDir: string, initial: number): Promise<string> {
  const clockDir = join(runDir, "clock-events")
  await mkdir(clockDir, { recursive: true })
  await writeFile(join(clockDir, `000000-${initial}`), "")
  return clockDir
}

export async function advanceTestClock(clockDir: string, value: number): Promise<void> {
  const sequence = (await readdir(clockDir)).length.toString().padStart(6, "0")
  await writeFile(join(clockDir, `${sequence}-${value}`), "")
}
