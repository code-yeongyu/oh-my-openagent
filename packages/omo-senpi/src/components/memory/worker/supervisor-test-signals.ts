import { watch } from "@oh-my-opencode/memory-core/fs"
import { mkdir, readdir, writeFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

export function waitForTestState<T>(
  subscribe: (check: () => void) => () => void,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let checking = false
    let pending = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    const finish = (error?: Error, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe?.()
      if (error !== undefined) reject(error)
      else resolve(value as T)
    }
    // Replay notifications received during an asynchronous probe so the final transition is not lost.
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
    unsubscribe = subscribe(() => { void check() })
    timeout = setTimeout(() => finish(new Error(`waited ${timeoutMs}ms for ${description}`)), timeoutMs)
    void check()
  })
}

export function waitForFilesystemState<T>(
  directory: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return waitForTestState((check) => {
    const watcher = watch(directory, check)
    // The macOS watcher can lose an event immediately after registration.
    const recheck = setInterval(check, 25)
    return () => { watcher.close(); clearInterval(recheck) }
  }, probe, timeoutMs, description)
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
