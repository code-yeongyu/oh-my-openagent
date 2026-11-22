import type { LspClient } from "./client.js"
import { INIT_TIMEOUT_MS } from "./constants.js"
import type { ServedFileGroup } from "./directory-server-groups.js"
import type { LspManager } from "./manager.js"
import { realTimerProvider, type TimerProvider } from "./timer-provider.js"

export interface GroupScanOptions {
  readonly manager: Pick<LspManager, "getClient" | "releaseClient">
  readonly groups: readonly ServedFileGroup[]
  /** Files checked at once across all groups, and clients referenced at once. */
  readonly maxConcurrency: number
  readonly signal?: AbortSignal
  readonly timers?: TimerProvider
  /** Checks one file and records its own outcome; it must not throw. */
  readonly checkFile: (client: LspClient, file: string) => Promise<void>
  readonly onGroupUnavailable: (group: ServedFileGroup, error: string) => void
}

/**
 * Runs each group's files on that group's own client. A group acquires its client right before its
 * files are checked and releases it as soon as its last file finished, so at most `maxConcurrency`
 * groups hold a client at once (the same bound as the file workers, below the manager's resident
 * target). A group still starting holds no file slot, so a slow group does not stop a healthy group
 * from checking files, and a group whose client does not start within the manager's init timeout
 * reports that for its own files; that deadline detaches only this scan's wait (the manager owns the
 * startup, see client-startup.ts), so the runner moves on at once. A caller abort, whether it lands
 * while a client starts or while files are checked, lets every group settle and release its client,
 * then throws the abort reason: an aborted scan never returns partial output. As before, the scan
 * also fails when no group got a client.
 */
export async function scanServedGroups(options: GroupScanOptions): Promise<void> {
  const { groups, signal } = options
  const limit = Math.max(1, options.maxConcurrency)
  const fileSlots = createSlots(limit)
  let nextGroup = 0
  let startedGroups = 0
  let firstError: unknown

  const runners = Array.from({ length: Math.min(limit, groups.length) }, async () => {
    for (;;) {
      if (signal?.aborted) return
      const group = groups[nextGroup]
      nextGroup += 1
      if (group === undefined) return
      let client: LspClient
      try {
        client = await acquireWithinInitTimeout(options, group)
      } catch (error) {
        if (signal?.aborted) return
        firstError ??= error
        options.onGroupUnavailable(group, error instanceof Error ? error.message : String(error))
        continue
      }
      startedGroups += 1
      try {
        await Promise.all(
          group.files.map(async (file) => {
            const release = await fileSlots.acquire()
            try {
              if (!signal?.aborted) await options.checkFile(client, file)
            } finally {
              release()
            }
          }),
        )
      } finally {
        options.manager.releaseClient(group.root, group.server, client)
      }
    }
  })
  await Promise.all(runners)

  signal?.throwIfAborted()
  if (startedGroups === 0 && firstError !== undefined) throw firstError
}

async function acquireWithinInitTimeout(options: GroupScanOptions, group: ServedFileGroup): Promise<LspClient> {
  const { signal } = options
  const timers = options.timers ?? realTimerProvider
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", forwardAbort, { once: true })
  if (signal?.aborted) forwardAbort()
  let timedOut = false
  const timer = timers.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, INIT_TIMEOUT_MS)
  try {
    return await options.manager.getClient(group.root, group.server, controller.signal)
  } catch (error) {
    if (timedOut && signal?.aborted !== true) {
      throw new Error(`${group.server.id} did not start within ${INIT_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    timers.clearTimeout(timer)
    signal?.removeEventListener("abort", forwardAbort)
  }
}

interface Slots {
  acquire(): Promise<() => void>
}

/** A FIFO counting semaphore: `acquire` resolves with the release for the slot it took. */
function createSlots(limit: number): Slots {
  let free = limit
  const waiting: (() => void)[] = []
  const release = () => {
    const next = waiting.shift()
    if (next === undefined) free += 1
    else next()
  }
  return {
    acquire() {
      if (free > 0) {
        free -= 1
        return Promise.resolve(release)
      }
      return new Promise((resolve) => waiting.push(() => resolve(release)))
    },
  }
}
